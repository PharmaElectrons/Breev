/**
 * Catalog packaging: one Inventory Unit, the larger packages that convert to
 * it, and the conversions every stock-affecting interface performs.
 *
 * docs/domain.md §"Exact quantities, money, and accounting" is the authority.
 * Inventory quantity is an integer count of the Inventory Unit -- the base
 * unit. Each larger package declares an explicit positive integer ratio to it,
 * so purchasing one pack records four strips, a count of "2 packs + 1 strip"
 * becomes nine strips, and no conversion can leave a fractional base-unit
 * balance. An optional Third Unit is stored for number-of-days or dosage
 * follow-up only; it is never an inventory-balance, purchasing, or sales unit.
 *
 * The Third Unit is excluded structurally rather than by a check that could be
 * forgotten: {@link UnitReference} has exactly two shapes, the base unit and a
 * named package of this product, and the definition refuses a Third Unit name
 * that collides with either. There is therefore no spelling of the Third Unit
 * that any conversion here will convert.
 *
 * Framework-free by design (docs/architecture.md §"Local module ownership"):
 * this module imports no Nest, Drizzle, PostgreSQL, or transport code. It also
 * does not import the REST contract. The contract owns what the wire shape is;
 * this module owns what the arithmetic means, and it re-reads every ratio it is
 * given rather than trusting that some earlier layer already validated it.
 *
 * Counts are `bigint` because they are exact and unbounded. Nothing here
 * converts to `number`: every JS `number` is binary floating point, including
 * the ones that look like whole counts.
 */

import { divideRounded, parseCanonicalInteger } from "./catalog-exact.js";

/** The interfaces that can each start in their own unit. */
export type UnitInterface = "count" | "purchase" | "sale";

export const UNIT_INTERFACES: readonly UnitInterface[] = [
  "count",
  "purchase",
  "sale",
];

/**
 * A unit a stock-affecting interface may work in: the base unit, or one of this
 * product's packages by name. There is no third shape, and that absence is what
 * keeps the Third Unit out of every conversion below.
 */
export type UnitReference =
  | { readonly kind: "inventory-unit" }
  | {
      readonly kind: "package-unit";
      readonly packageUnitName: string;
    };

/** Catalog-owned input accepted by the packaging policy. */
export interface PackagingDefinition {
  readonly inventoryUnitName: string;
  readonly packageUnits: readonly {
    readonly name: string;
    readonly baseUnitsPerPackage: string;
  }[];
  readonly thirdUnit: { readonly name: string } | null;
  readonly defaultUnits: Readonly<Record<UnitInterface, UnitReference>>;
}

/**
 * Validated packaging. Only {@link definePackaging} produces one, so every
 * conversion below can rely on ratios that are already exact positive integers
 * and on unit names that already identify exactly one unit.
 */
export interface Packaging {
  readonly inventoryUnitName: string;
  readonly packageUnits: readonly {
    readonly name: string;
    readonly baseUnitsPerPackage: bigint;
  }[];
  readonly thirdUnitName: string | null;
  readonly defaultUnits: Readonly<Record<UnitInterface, UnitReference>>;
}

export type PackagingProblemCode =
  | "count-negative"
  | "count-not-whole-in-target-unit"
  | "duplicate-unit-name"
  | "package-ratio-invalid"
  | "unit-name-invalid"
  | "unknown-package-unit";

export interface PackagingProblem {
  readonly code: PackagingProblemCode;
  /** The unit the problem is about, or null when it is about none. */
  readonly unitName: string | null;
}

export type PackagingOutcome =
  | { readonly ok: true; readonly packaging: Packaging }
  | { readonly ok: false; readonly problems: readonly PackagingProblem[] };

export type ConversionOutcome =
  | { readonly ok: true; readonly baseUnits: bigint }
  | { readonly ok: false; readonly problem: PackagingProblem };

/** One line of a display decomposition: a unit and how many of it. */
export interface UnitCount {
  readonly unitName: string;
  readonly count: bigint;
}

/** A quantity and its unit, as a mixed-unit entry arrives from a screen. */
export interface UnitQuantity {
  readonly unit: UnitReference;
  readonly count: bigint;
}

export interface UnitChange {
  readonly from: UnitReference;
  readonly to: UnitReference;
  readonly count: bigint;
  /** The price of one `from` unit, in exact IQD fils. */
  readonly unitPriceFils: bigint;
}

export type UnitChangeOutcome =
  | {
      readonly ok: true;
      /** The same quantity counted in the target unit. */
      readonly count: bigint;
      /** The same quantity in base units, unchanged by the unit change. */
      readonly baseUnits: bigint;
      /** The price of one target unit, in exact IQD fils. */
      readonly unitPriceFils: bigint;
      /**
       * False when the price of one target unit was not a whole number of fils
       * and the halfway rule decided it. The quantity is always exact; only a
       * price can need this, because a fils is the smallest exact amount.
       */
      readonly unitPriceExact: boolean;
    }
  | { readonly ok: false; readonly problem: PackagingProblem };

/**
 * Validates a packaging definition. Collects every problem rather than stopping
 * at the first, so a screen can mark all the offending fields at once.
 */
export function definePackaging(
  definition: PackagingDefinition,
): PackagingOutcome {
  const problems: PackagingProblem[] = [];
  const packageUnits: { name: string; baseUnitsPerPackage: bigint }[] = [];
  const claimedNames = new Set<string>();

  const claim = (name: string): void => {
    if (!isUnitName(name)) {
      problems.push({ code: "unit-name-invalid", unitName: name });
      return;
    }
    if (claimedNames.has(name)) {
      problems.push({ code: "duplicate-unit-name", unitName: name });
      return;
    }
    claimedNames.add(name);
  };

  claim(definition.inventoryUnitName);

  for (const unit of definition.packageUnits) {
    claim(unit.name);
    const ratio = parseCanonicalInteger(unit.baseUnitsPerPackage);
    if (ratio === null || ratio < 1n || ratio > 9_223_372_036_854_775_807n) {
      problems.push({ code: "package-ratio-invalid", unitName: unit.name });
      continue;
    }
    packageUnits.push({ name: unit.name, baseUnitsPerPackage: ratio });
  }

  if (definition.thirdUnit !== null) {
    claim(definition.thirdUnit.name);
  }

  const definedNames = new Set(packageUnits.map((unit) => unit.name));
  for (const unitInterface of UNIT_INTERFACES) {
    const unit = definition.defaultUnits[unitInterface];
    if (
      unit.kind === "package-unit" &&
      !definedNames.has(unit.packageUnitName)
    ) {
      problems.push({
        code: "unknown-package-unit",
        unitName: unit.packageUnitName,
      });
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    packaging: {
      inventoryUnitName: definition.inventoryUnitName,
      packageUnits,
      thirdUnitName: definition.thirdUnit?.name ?? null,
      defaultUnits: definition.defaultUnits,
    },
  };
}

/** The unit an interface starts in. A transaction may still change it. */
export function defaultUnitFor(
  packaging: Packaging,
  unitInterface: UnitInterface,
): UnitReference {
  return packaging.defaultUnits[unitInterface];
}

/**
 * Converts a count of one unit into base units. Exact by construction: the
 * ratio is a positive integer, so the product is a whole base-unit count at
 * every magnitude.
 */
export function toBaseUnits(
  packaging: Packaging,
  unit: UnitReference,
  count: bigint,
): ConversionOutcome {
  const ratio = baseUnitsPerUnit(packaging, unit);
  if (ratio === null) {
    return {
      ok: false,
      problem: {
        code: "unknown-package-unit",
        unitName: unit.kind === "package-unit" ? unit.packageUnitName : null,
      },
    };
  }
  assertExactCount(count);
  if (count < 0n) {
    return {
      ok: false,
      problem: { code: "count-negative", unitName: unitName(packaging, unit) },
    };
  }
  return { ok: true, baseUnits: count * ratio };
}

/**
 * Adds a mixed-unit entry into one exact base-unit count: "2 packs + 1 strip"
 * at four strips a pack is nine strips.
 */
export function composeBaseUnits(
  packaging: Packaging,
  entries: readonly UnitQuantity[],
): ConversionOutcome {
  let total = 0n;
  for (const entry of entries) {
    const converted = toBaseUnits(packaging, entry.unit, entry.count);
    if (!converted.ok) return converted;
    total += converted.baseUnits;
  }
  return { ok: true, baseUnits: total };
}

/**
 * Spells an exact base-unit balance in the largest packages that fit, with the
 * remainder in base units. Display only: the ledger keeps the base count, and
 * this returns a different spelling of the same quantity, never a different
 * one. Units that would show zero are left out, except for a zero balance,
 * which still has to appear on a screen.
 */
export function describeBaseUnits(
  packaging: Packaging,
  baseUnits: bigint,
): readonly UnitCount[] {
  assertExactCount(baseUnits);
  if (baseUnits < 0n) {
    throw new RangeError("A base-unit balance to display cannot be negative");
  }

  const descending = [...packaging.packageUnits].sort((left, right) =>
    left.baseUnitsPerPackage < right.baseUnitsPerPackage ? 1 : -1,
  );

  const described: UnitCount[] = [];
  let remaining = baseUnits;
  for (const unit of descending) {
    const count = remaining / unit.baseUnitsPerPackage;
    if (count > 0n) {
      described.push({ unitName: unit.name, count });
      remaining %= unit.baseUnitsPerPackage;
    }
  }
  if (remaining > 0n || described.length === 0) {
    described.push({ unitName: packaging.inventoryUnitName, count: remaining });
  }
  return described;
}

/**
 * Recalculates a quantity and its unit price for a different unit of the same
 * product.
 *
 * The base-unit quantity is what is conserved. A change to a larger unit is
 * refused unless the ratio divides the base count exactly, because rounding it
 * would either invent or destroy stock -- nine strips are not a whole number of
 * four-strip packs, and no fractional base-unit balance ever posts.
 *
 * The price is scaled by the ratio between the two units. A fils is the
 * smallest exact amount, so a price that does not divide evenly is decided by
 * the one halfway rule in `catalog-exact.ts` and reported as inexact rather
 * than silently rounded.
 */
export function recalculateForUnit(
  packaging: Packaging,
  change: UnitChange,
): UnitChangeOutcome {
  const converted = toBaseUnits(packaging, change.from, change.count);
  if (!converted.ok) return converted;

  const targetRatio = baseUnitsPerUnit(packaging, change.to);
  if (targetRatio === null) {
    return {
      ok: false,
      problem: {
        code: "unknown-package-unit",
        unitName:
          change.to.kind === "package-unit" ? change.to.packageUnitName : null,
      },
    };
  }

  const baseUnits = converted.baseUnits;
  if (baseUnits % targetRatio !== 0n) {
    return {
      ok: false,
      problem: {
        code: "count-not-whole-in-target-unit",
        unitName: unitName(packaging, change.to),
      },
    };
  }

  assertExactCount(change.unitPriceFils);
  const sourceRatio = baseUnitsPerUnit(packaging, change.from) ?? 1n;
  const price = divideRounded(change.unitPriceFils * targetRatio, sourceRatio);

  return {
    ok: true,
    count: baseUnits / targetRatio,
    baseUnits,
    unitPriceFils: price.value,
    unitPriceExact: price.exact,
  };
}

/**
 * How many base units one referenced unit holds, or null when the reference
 * names no unit of this product. The base unit is one of itself.
 */
function baseUnitsPerUnit(
  packaging: Packaging,
  unit: UnitReference,
): bigint | null {
  if (unit.kind === "inventory-unit") return 1n;
  const found = packaging.packageUnits.find(
    (candidate) => candidate.name === unit.packageUnitName,
  );
  return found === undefined ? null : found.baseUnitsPerPackage;
}

function unitName(packaging: Packaging, unit: UnitReference): string {
  return unit.kind === "inventory-unit"
    ? packaging.inventoryUnitName
    : unit.packageUnitName;
}

function isUnitName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 40 &&
    name === name.trim()
  );
}

function assertExactCount(count: bigint): void {
  if (typeof count !== "bigint") {
    throw new TypeError(
      `A packaging count must be an exact bigint, received ${typeof count}`,
    );
  }
}
