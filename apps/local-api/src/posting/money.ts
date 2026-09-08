/**
 * Exact money and quantity primitives shared by every posting use case.
 *
 * docs/domain.md §"Exact quantities, money, and accounting" is the authority:
 * all posted IQD amounts are signed integer fils where `1 IQD = 1,000 fils`,
 * inventory quantity is an integer count of the product's inventory unit, REST
 * transports both as decimal integer strings, authoritative TypeScript and
 * PostgreSQL values use exact integer types, and binary floating point is
 * forbidden for money, rates, quantities, discounts, valuation, tax, tender,
 * and report totals.
 *
 * Every authoritative value in this module is a `bigint`, so it is exact and
 * unbounded. Nothing here converts to `number`, calls `parseFloat`, or lets a
 * `number` reach a value or the wire: every entry point re-validates its
 * arguments, because a brand can only be forged with a type assertion and the
 * one thing that must never happen is a float escaping into a posted fact.
 *
 * Range: docs/architecture.md §"Local API and PostgreSQL" stores authoritative
 * IQD in PostgreSQL `bigint`. These primitives stay unbounded on purpose --
 * the column that first persists money owns its range check, so an oversized
 * amount is rejected by the schema instead of being silently truncated here.
 *
 * Multiplication, division, rounding, and remainder allocation arrive here
 * with the first posting that produces them. They are gathered in this one
 * module on purpose: docs/domain.md defers exact decimal precision, rounding,
 * and remainder allocation to gate G-01, and this is the only module that
 * decides either. Callers ask for a rounded quotient or an allocated total and
 * never implement one, so when the accountant settles the gate the work is
 * bounded to this file -- rewriting {@link divideExactRounded} or
 * {@link allocateFilsProportionally}, renaming {@link ROUNDING_RULE} or
 * {@link REMAINDER_ALLOCATION_RULE} to whatever was approved, and updating the
 * tests that pin the current behaviour. The constants are labels for the
 * policy, not switches that implement it; changing one alone would only
 * mislabel the algorithm. Until the gate closes both are engineering defaults.
 */

/**
 * `1 IQD = 1,000 fils` (docs/domain.md). Published as a named constant so no
 * caller writes the ratio as a literal. Converting fils to displayed dinars is
 * division, which is G-01 rounding policy and therefore not implemented here.
 */
export const FILS_PER_IQD = 1_000n;

/**
 * A signed amount of Iraqi dinar fils: the authoritative representation of
 * money everywhere inside the local API.
 *
 * The brand makes the type nominal rather than structural. A raw `bigint`, a
 * `number`, and an `InventoryQuantity` are all rejected by the compiler where
 * an `IqdFils` is required, so an amount can enter this type only through
 * {@link iqdFils} or {@link parseFilsString}.
 */
export type IqdFils = bigint & { readonly brand: "iqd-fils" };

/**
 * A signed integer count of a product's inventory unit -- the base unit,
 * meaning the smallest approved sales or movement unit (docs/domain.md).
 *
 * Quantities are signed because movements are signed deltas: a receipt adds
 * and an issue subtracts. That a balance may never go negative is a posting
 * rule enforced where stock is posted ("No post may make stock negative"),
 * not a property of the number type -- otherwise {@link negateQuantity} could
 * not exist. Package units are integer ratios over this base unit, so no
 * conversion ever produces a fractional base-unit balance.
 */
export type InventoryQuantity = bigint & {
  readonly brand: "inventory-quantity";
};

/**
 * The canonical decimal-integer wire grammar, used for both money and
 * quantities: `0`, or an optional `-` followed by a digit string that does not
 * start with `0`.
 *
 * The grammar is deliberately strict and bijective with the integers, so
 * `parse(format(value))` returns the same value and `format(parse(wire))`
 * returns the same string. Rejected, each for a reason:
 *
 * - `""`, `" 1"`, `"1 "`, `"1\n"` -- `BigInt` silently accepts an empty or
 *   whitespace-padded string (`BigInt("")` is `0n`, `BigInt(" 1")` is `1n`),
 *   so the grammar, never `BigInt`, decides what is a valid amount.
 * - `"+1"`, `"-0"`, `"01"`, `"-01"` -- non-canonical spellings of a value that
 *   already has exactly one canonical spelling; accepting them would break the
 *   round trip and would let two request bodies that differ byte for byte
 *   claim to be the same amount.
 * - `"1.0"`, `"1e3"`, `"0x1f"`, `"1_000"`, `"NaN"`, `"Infinity"` -- decimal
 *   points, exponents, radix prefixes and numeric separators are the notations
 *   of binary floating point, which may not carry an authoritative value.
 * - `"١٢٣"` (Arabic-Indic digits), `"１"` (fullwidth) --
 *   `[0-9]` matches ASCII only. Arabic digit shapes are a presentation concern
 *   for the desktop UI; the wire carries one unambiguous encoding.
 *
 * `^` and `$` anchor the whole string here: JavaScript's `$` without the `m`
 * flag matches only at the end of input, never before a trailing newline.
 */
const DECIMAL_INTEGER_WIRE = /^(?:0|-?[1-9][0-9]*)$/;

const FILS_LABEL = "An IQD fils amount";
const QUANTITY_LABEL = "An inventory quantity";

/** Brands an exact `bigint` as an IQD fils amount. */
export function iqdFils(value: bigint): IqdFils {
  return assertExactInteger(value, FILS_LABEL) as IqdFils;
}

/** Brands an exact `bigint` as an inventory quantity. */
export function inventoryQuantity(value: bigint): InventoryQuantity {
  return assertExactInteger(value, QUANTITY_LABEL) as InventoryQuantity;
}

/** Reads an IQD fils amount from its decimal integer string wire form. */
export function parseFilsString(wire: string): IqdFils {
  return parseDecimalIntegerWire(wire, FILS_LABEL) as IqdFils;
}

/**
 * Writes an IQD fils amount as its decimal integer string wire form. The
 * result always satisfies the wire grammar: no exponent, no fraction, one
 * leading `-` for negatives, and `"0"` for zero (a `bigint` has no negative
 * zero, so `"-0"` can never be produced).
 */
export function formatFilsString(value: IqdFils): string {
  return formatDecimalIntegerWire(value, FILS_LABEL);
}

/** Reads an inventory quantity from its decimal integer string wire form. */
export function parseQuantityString(wire: string): InventoryQuantity {
  return parseDecimalIntegerWire(wire, QUANTITY_LABEL) as InventoryQuantity;
}

/** Writes an inventory quantity as its decimal integer string wire form. */
export function formatQuantityString(value: InventoryQuantity): string {
  return formatDecimalIntegerWire(value, QUANTITY_LABEL);
}

/** Adds two fils amounts. Integer addition is exact at any magnitude. */
export function addFils(left: IqdFils, right: IqdFils): IqdFils {
  const sum =
    assertExactInteger(left, FILS_LABEL) +
    assertExactInteger(right, FILS_LABEL);
  return sum as IqdFils;
}

/** Reverses the sign of a fils amount -- a debit becomes its credit. */
export function negateFils(value: IqdFils): IqdFils {
  const negated = -assertExactInteger(value, FILS_LABEL);
  return negated as IqdFils;
}

/** Orders two fils amounts: `-1` when left is smaller, `1` when larger. */
export function compareFils(left: IqdFils, right: IqdFils): -1 | 0 | 1 {
  return compareExact(
    assertExactInteger(left, FILS_LABEL),
    assertExactInteger(right, FILS_LABEL),
  );
}

/** Reports whether two fils amounts are the same amount. */
export function equalsFils(left: IqdFils, right: IqdFils): boolean {
  return (
    assertExactInteger(left, FILS_LABEL) ===
    assertExactInteger(right, FILS_LABEL)
  );
}

/** Adds two inventory quantities. Integer addition is exact at any magnitude. */
export function addQuantity(
  left: InventoryQuantity,
  right: InventoryQuantity,
): InventoryQuantity {
  const sum =
    assertExactInteger(left, QUANTITY_LABEL) +
    assertExactInteger(right, QUANTITY_LABEL);
  return sum as InventoryQuantity;
}

/** Reverses the direction of a quantity movement. */
export function negateQuantity(value: InventoryQuantity): InventoryQuantity {
  const negated = -assertExactInteger(value, QUANTITY_LABEL);
  return negated as InventoryQuantity;
}

/** Orders two quantities: `-1` when left is smaller, `1` when larger. */
export function compareQuantity(
  left: InventoryQuantity,
  right: InventoryQuantity,
): -1 | 0 | 1 {
  return compareExact(
    assertExactInteger(left, QUANTITY_LABEL),
    assertExactInteger(right, QUANTITY_LABEL),
  );
}

/** Reports whether two quantities are the same quantity. */
export function equalsQuantity(
  left: InventoryQuantity,
  right: InventoryQuantity,
): boolean {
  return (
    assertExactInteger(left, QUANTITY_LABEL) ===
    assertExactInteger(right, QUANTITY_LABEL)
  );
}

/**
 * The number of decimal places an exact rate keeps. A supplier allowance
 * percentage and a pricing margin are both stored as `numeric(9,6)`, so six
 * places is the precision the database already holds and the wire already
 * transports.
 */
export const RATE_SCALE = 6;

const RATE_UNIT = 10n ** BigInt(RATE_SCALE);

/**
 * A percentage or other rate as an exact integer scaled by `10 ** RATE_SCALE`:
 * `"2.5"` is `2_500_000n`. Branded for the same reason money is -- a rate that
 * arrived through `Number("2.5")` is already the nearest binary fraction to
 * two and a half, and a discount computed from it is not the discount the
 * supplier agreed.
 */
export type ScaledRate = bigint & { readonly brand: "scaled-rate" };

/** `100%` as a {@link ScaledRate}: the denominator of every percentage. */
export const ONE_HUNDRED_PERCENT = (100n * RATE_UNIT) as ScaledRate;

const RATE_WIRE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u;
const RATE_LABEL = "A rate";

/**
 * The halfway behaviour every rounding in a posting applies: **away from
 * zero**, so an exact 2.5 fils becomes 3 and -2.5 becomes -3. Deterministic,
 * symmetric about zero, and independent of the order values are processed in.
 *
 * An engineering default pending G-01 (docs/open-decisions.md).
 */
export const ROUNDING_RULE = "half-away-from-zero" as const;

/**
 * How a rounded total is split across the lines that produced it: give every
 * line its exact floor, then hand the remaining fils out one at a time to the
 * lines with the largest dropped fraction, breaking a tie by line order.
 *
 * The property that matters is that the parts always add back up to the total
 * that was split, so a per-line figure and its invoice total can never
 * disagree by a fils.
 *
 * An engineering default pending G-01 (docs/open-decisions.md).
 */
export const REMAINDER_ALLOCATION_RULE =
  "largest-remainder-then-line-order" as const;

/** Reads an exact rate from its decimal text form. */
export function parseRateString(wire: string): ScaledRate {
  if (typeof wire !== "string") {
    throw new TypeError(
      `${RATE_LABEL} must arrive as exact decimal text, received ${typeof wire}`,
    );
  }
  if (!RATE_WIRE.test(wire)) {
    throw new TypeError(
      `${RATE_LABEL} must be canonical decimal text with at most ${String(RATE_SCALE)} decimal places, received ${previewWire(wire)}`,
    );
  }
  const [whole = "0", fraction = ""] = wire.split(".");
  return BigInt(`${whole}${fraction.padEnd(RATE_SCALE, "0")}`) as ScaledRate;
}

/**
 * Multiplies a fils amount by an exact integer count -- a line's unit cost by
 * its quantity. Integer multiplication is exact at any magnitude, so nothing
 * is rounded and no intermediate loses a fils.
 */
export function multiplyFils(amount: IqdFils, factor: bigint): IqdFils {
  const product =
    assertExactInteger(amount, FILS_LABEL) *
    assertExactInteger(factor, "A multiplier");
  return product as IqdFils;
}

/**
 * Divides exactly and rounds the result to whole fils by {@link ROUNDING_RULE}.
 *
 * Both arguments are plain `bigint` rather than `IqdFils`, because the
 * numerator of a percentage is fils times a scaled rate and the denominator is
 * a scale -- neither is itself an amount of money. Only the result is.
 */
export function divideFilsRounded(
  numerator: bigint,
  denominator: bigint,
): IqdFils {
  return divideExactRounded(numerator, denominator) as IqdFils;
}

/**
 * The exact `rate` share of `amount`, rounded once to whole fils.
 *
 * The rate is applied to the amount before any division, so the only rounding
 * is the final one: computing a per-unit share first and multiplying it back
 * up would round twice and drift by a fils per line.
 */
export function rateOfFils(amount: IqdFils, rate: ScaledRate): IqdFils {
  assertExactInteger(rate, RATE_LABEL);
  return divideFilsRounded(
    assertExactInteger(amount, FILS_LABEL) * rate,
    ONE_HUNDRED_PERCENT,
  );
}

/**
 * Splits `total` across `weights` under {@link REMAINDER_ALLOCATION_RULE}. The
 * returned shares always sum to exactly `total`.
 *
 * Weights are non-negative and are usually line values. When every weight is
 * zero there is no proportion to split by, so the whole total goes to the
 * first line rather than being silently dropped -- a zero-value invoice with a
 * non-zero allowance is a data problem the caller should see, not one this
 * function should hide by returning less money than it was given.
 */
export function allocateFilsProportionally(
  total: IqdFils,
  weights: readonly bigint[],
): IqdFils[] {
  assertExactInteger(total, FILS_LABEL);
  if (weights.length === 0) {
    throw new RangeError("An allocation needs at least one line");
  }
  let weightTotal = 0n;
  for (const weight of weights) {
    if (assertExactInteger(weight, "An allocation weight") < 0n) {
      throw new RangeError("An allocation weight cannot be negative");
    }
    weightTotal += weight;
  }
  if (weightTotal === 0n) {
    return weights.map((_, index) => (index === 0 ? total : 0n)) as IqdFils[];
  }

  const negative = total < 0n;
  const absoluteTotal = negative ? -total : total;
  const shares: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let assigned = 0n;
  for (const [index, weight] of weights.entries()) {
    const numerator = absoluteTotal * weight;
    const share = numerator / weightTotal;
    shares.push(share);
    remainders.push({ index, remainder: numerator % weightTotal });
    assigned += share;
  }

  remainders.sort((left, right) =>
    left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder
        ? -1
        : 1,
  );
  let leftover = absoluteTotal - assigned;
  for (const target of remainders) {
    if (leftover === 0n) break;
    shares[target.index] = (shares[target.index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  if (leftover !== 0n) {
    throw new RangeError("An allocation remainder exceeded its line count");
  }
  return shares.map((share) => (negative ? -share : share)) as IqdFils[];
}

function divideExactRounded(numerator: bigint, denominator: bigint): bigint {
  assertExactInteger(numerator, "A numerator");
  assertExactInteger(denominator, "A denominator");
  if (denominator === 0n) {
    throw new RangeError("An exact quotient cannot divide by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  // Away from zero on the exact half, so the comparison is `>=`.
  const rounded =
    2n * remainder >= absoluteDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Rejects anything that is not an exact `bigint`. `number` gets its own
 * message because it is the one mistake that would otherwise post a rounded
 * value: every JavaScript `number` is binary floating point, including the
 * ones that look like whole amounts.
 */
function assertExactInteger(value: bigint, label: string): bigint {
  if (typeof value === "number") {
    throw new TypeError(
      `${label} must be an exact bigint: binary floating point cannot carry an authoritative value`,
    );
  }
  if (typeof value !== "bigint") {
    throw new TypeError(
      `${label} must be an exact bigint, received ${typeof value}`,
    );
  }
  return value;
}

function parseDecimalIntegerWire(wire: string, label: string): bigint {
  if (typeof wire !== "string") {
    throw new TypeError(
      `${label} must arrive on the wire as a decimal integer string, received ${typeof wire}`,
    );
  }
  if (!DECIMAL_INTEGER_WIRE.test(wire)) {
    throw new TypeError(
      `${label} must be a canonical decimal integer string, received ${previewWire(wire)}`,
    );
  }
  return BigInt(wire);
}

function formatDecimalIntegerWire(value: bigint, label: string): string {
  return assertExactInteger(value, label).toString(10);
}

function compareExact(left: bigint, right: bigint): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Quotes a rejected wire value for the error message: escaped so control
 * characters stay readable in a log, and truncated so a hostile body cannot
 * write megabytes into it.
 */
function previewWire(wire: string): string {
  const shown = wire.length > 32 ? `${wire.slice(0, 32)}...` : wire;
  return JSON.stringify(shown);
}
