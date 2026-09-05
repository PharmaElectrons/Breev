import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  composeBaseUnits,
  definePackaging,
  defaultUnitFor,
  describeBaseUnits,
  type PackagingDefinition,
  recalculateForUnit,
  toBaseUnits,
  type Packaging,
  type UnitReference,
} from "./catalog-packaging.js";

/** 1 pack = 4 strips, 1 carton = 48 strips, and a treatment day counts nothing. */
const DEFINITION: PackagingDefinition = {
  inventoryUnitName: "Strip",
  packageUnits: [
    { name: "Pack", baseUnitsPerPackage: "4" },
    { name: "Carton", baseUnitsPerPackage: "48" },
  ],
  thirdUnit: { name: "Treatment day" },
  defaultUnits: {
    count: { kind: "inventory-unit" },
    purchase: { kind: "package-unit", packageUnitName: "Pack" },
    sale: { kind: "inventory-unit" },
  },
};

const STRIP: UnitReference = { kind: "inventory-unit" };
const PACK: UnitReference = { kind: "package-unit", packageUnitName: "Pack" };
const CARTON: UnitReference = {
  kind: "package-unit",
  packageUnitName: "Carton",
};

function packagingOf(definition: PackagingDefinition = DEFINITION): Packaging {
  const outcome = definePackaging(definition);
  if (!outcome.ok) {
    throw new Error(
      `Unexpected packaging problems: ${JSON.stringify(outcome)}`,
    );
  }
  return outcome.packaging;
}

describe("catalog packaging definition", () => {
  it("accepts one inventory unit with zero or more larger packages", () => {
    expect(definePackaging(DEFINITION).ok).toBe(true);
    expect(
      definePackaging({
        inventoryUnitName: "Strip",
        packageUnits: [],
        thirdUnit: null,
        defaultUnits: {
          count: STRIP,
          purchase: STRIP,
          sale: STRIP,
        },
      }).ok,
    ).toBe(true);
  });

  it("refuses a ratio that is not an explicit positive integer", () => {
    for (const ratio of [
      "0",
      "-4",
      "4.5",
      "04",
      "4e0",
      " 4",
      "",
      "٤",
      "9223372036854775808",
    ]) {
      const outcome = definePackaging({
        ...DEFINITION,
        packageUnits: [{ name: "Pack", baseUnitsPerPackage: ratio }],
        defaultUnits: { ...DEFINITION.defaultUnits, purchase: PACK },
      });
      expect(outcome.ok, ratio).toBe(false);
      if (!outcome.ok) {
        expect(
          outcome.problems.map((problem) => problem.code),
          ratio,
        ).toContain("package-ratio-invalid");
      }
    }
    expect(
      definePackaging({
        ...DEFINITION,
        packageUnits: [{ name: "Single", baseUnitsPerPackage: "1" }],
        defaultUnits: { ...DEFINITION.defaultUnits, purchase: STRIP },
      }).ok,
    ).toBe(true);
  });

  it("refuses a unit name that would make a conversion ambiguous", () => {
    for (const definition of [
      { ...DEFINITION, inventoryUnitName: "Pack" },
      {
        ...DEFINITION,
        packageUnits: [
          { name: "Pack", baseUnitsPerPackage: "4" },
          { name: "Pack", baseUnitsPerPackage: "48" },
        ],
      },
      { ...DEFINITION, thirdUnit: { name: "Pack" } },
      { ...DEFINITION, thirdUnit: { name: "Strip" } },
    ]) {
      const outcome = definePackaging(definition);
      expect(outcome.ok, definition.inventoryUnitName).toBe(false);
      if (!outcome.ok) {
        expect(outcome.problems.map((problem) => problem.code)).toContain(
          "duplicate-unit-name",
        );
      }
    }
  });

  it("refuses an interface default that names no package of this product", () => {
    const outcome = definePackaging({
      ...DEFINITION,
      defaultUnits: {
        ...DEFINITION.defaultUnits,
        sale: { kind: "package-unit", packageUnitName: "Bundle" },
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.problems).toEqual([
        { code: "unknown-package-unit", unitName: "Bundle" },
      ]);
    }
  });

  it("gives each interface its own default unit", () => {
    const packaging = packagingOf();
    expect(defaultUnitFor(packaging, "purchase")).toEqual(PACK);
    expect(defaultUnitFor(packaging, "sale")).toEqual(STRIP);
    expect(defaultUnitFor(packaging, "count")).toEqual(STRIP);
  });
});

describe("catalog packaging conversion", () => {
  it("converts a package to the base unit exactly: 1 pack is 4 strips", () => {
    const packaging = packagingOf();
    expect(toBaseUnits(packaging, PACK, 1n)).toEqual({
      ok: true,
      baseUnits: 4n,
    });
    expect(toBaseUnits(packaging, PACK, 3n)).toEqual({
      ok: true,
      baseUnits: 12n,
    });
    expect(toBaseUnits(packaging, CARTON, 2n)).toEqual({
      ok: true,
      baseUnits: 96n,
    });
    expect(toBaseUnits(packaging, STRIP, 7n)).toEqual({
      ok: true,
      baseUnits: 7n,
    });
    expect(toBaseUnits(packaging, STRIP, 0n)).toEqual({
      ok: true,
      baseUnits: 0n,
    });
  });

  it("composes a mixed-unit entry: 2 packs + 1 strip is 9 strips", () => {
    const packaging = packagingOf();
    expect(
      composeBaseUnits(packaging, [
        { unit: PACK, count: 2n },
        { unit: STRIP, count: 1n },
      ]),
    ).toEqual({ ok: true, baseUnits: 9n });
    expect(composeBaseUnits(packaging, [])).toEqual({
      ok: true,
      baseUnits: 0n,
    });
    expect(
      composeBaseUnits(packaging, [
        { unit: CARTON, count: 1n },
        { unit: PACK, count: 1n },
        { unit: STRIP, count: 3n },
      ]),
    ).toEqual({ ok: true, baseUnits: 55n });
  });

  it("decomposes a base balance for display, largest package first, remainder last", () => {
    const packaging = packagingOf();
    expect(describeBaseUnits(packaging, 9n)).toEqual([
      { unitName: "Pack", count: 2n },
      { unitName: "Strip", count: 1n },
    ]);
    expect(describeBaseUnits(packaging, 55n)).toEqual([
      { unitName: "Carton", count: 1n },
      { unitName: "Pack", count: 1n },
      { unitName: "Strip", count: 3n },
    ]);
    expect(describeBaseUnits(packaging, 8n)).toEqual([
      { unitName: "Pack", count: 2n },
    ]);
    expect(describeBaseUnits(packaging, 3n)).toEqual([
      { unitName: "Strip", count: 3n },
    ]);
    // Nothing on hand is still a balance the screen has to show.
    expect(describeBaseUnits(packaging, 0n)).toEqual([
      { unitName: "Strip", count: 0n },
    ]);
  });

  it("refuses a negative count instead of inventing a direction", () => {
    const packaging = packagingOf();
    expect(toBaseUnits(packaging, PACK, -1n)).toEqual({
      ok: false,
      problem: { code: "count-negative", unitName: "Pack" },
    });
    expect(describeBaseUnits(packaging, 9n)).toHaveLength(2);
  });

  it("keeps the Third Unit out of every stock-affecting conversion", () => {
    const packaging = packagingOf();
    // There is no unit reference shape that names the Third Unit, so the only
    // way to try is to spell its name as a package -- and no package has it.
    const asPackage: UnitReference = {
      kind: "package-unit",
      packageUnitName: "Treatment day",
    };
    expect(toBaseUnits(packaging, asPackage, 30n)).toEqual({
      ok: false,
      problem: { code: "unknown-package-unit", unitName: "Treatment day" },
    });
    expect(
      composeBaseUnits(packaging, [{ unit: asPackage, count: 30n }]),
    ).toEqual({
      ok: false,
      problem: { code: "unknown-package-unit", unitName: "Treatment day" },
    });
    expect(
      describeBaseUnits(packaging, 9n).map((entry) => entry.unitName),
    ).not.toContain("Treatment day");
  });
});

describe("catalog packaging unit change", () => {
  it("recalculates quantity and unit price exactly when the ratio divides", () => {
    const packaging = packagingOf();
    expect(
      recalculateForUnit(packaging, {
        from: PACK,
        to: STRIP,
        count: 2n,
        unitPriceFils: 100_000n,
      }),
    ).toEqual({
      ok: true,
      count: 8n,
      baseUnits: 8n,
      unitPriceFils: 25_000n,
      unitPriceExact: true,
    });
    expect(
      recalculateForUnit(packaging, {
        from: STRIP,
        to: PACK,
        count: 8n,
        unitPriceFils: 25_000n,
      }),
    ).toEqual({
      ok: true,
      count: 2n,
      baseUnits: 8n,
      unitPriceFils: 100_000n,
      unitPriceExact: true,
    });
  });

  it("refuses a change that would leave a fractional base-unit balance", () => {
    const packaging = packagingOf();
    // 9 strips are not a whole number of packs, so the change is refused rather
    // than rounded: no fractional base-unit balance ever posts.
    expect(
      recalculateForUnit(packaging, {
        from: STRIP,
        to: PACK,
        count: 9n,
        unitPriceFils: 25_000n,
      }),
    ).toEqual({
      ok: false,
      problem: { code: "count-not-whole-in-target-unit", unitName: "Pack" },
    });
  });

  it("reports a unit price that could not be split exactly instead of hiding it", () => {
    const packaging = packagingOf();
    const outcome = recalculateForUnit(packaging, {
      from: PACK,
      to: STRIP,
      count: 1n,
      unitPriceFils: 10n,
    });
    // 10 fils a pack is 2.5 fils a strip. Fils are the smallest exact amount,
    // so the price rounds by the one halfway rule and says that it did.
    expect(outcome).toEqual({
      ok: true,
      count: 4n,
      baseUnits: 4n,
      unitPriceFils: 3n,
      unitPriceExact: false,
    });
  });

  it("keeps the base balance whole for arbitrary counts and ratios", () => {
    const maximum = 9_223_372_036_854_775_807n;
    const ratioArbitrary = fc.oneof(
      fc.constantFrom(1n, 2n, maximum - 1n, maximum),
      fc.bigInt({ min: 1n, max: maximum }),
    );
    const countArbitrary = fc.oneof(
      fc.constantFrom(0n, 1n, maximum - 1n, maximum),
      fc.bigInt({ min: 0n, max: maximum }),
    );

    fc.assert(
      fc.property(
        ratioArbitrary,
        countArbitrary,
        countArbitrary,
        (ratio, packs, remainderCandidate) => {
          const strips = remainderCandidate % ratio;
          const packaging = packagingOf({
            inventoryUnitName: "Strip",
            packageUnits: [
              { name: "Pack", baseUnitsPerPackage: ratio.toString() },
            ],
            thirdUnit: null,
            defaultUnits: { count: STRIP, purchase: PACK, sale: STRIP },
          });
          const composed = composeBaseUnits(packaging, [
            { unit: PACK, count: packs },
            { unit: STRIP, count: strips },
          ]);
          expect(composed.ok, `${ratio}/${packs}/${strips}`).toBe(true);
          if (!composed.ok) return;

          const baseUnits = composed.baseUnits;
          expect(baseUnits).toBe(packs * ratio + strips);

          // The display decomposition is a different spelling of the same
          // exact base count, never a different quantity.
          const described = describeBaseUnits(packaging, baseUnits);
          const recomposed = composeBaseUnits(
            packaging,
            described.map((entry) => ({
              unit:
                entry.unitName === "Strip"
                  ? STRIP
                  : ({
                      kind: "package-unit",
                      packageUnitName: entry.unitName,
                    } as const),
              count: entry.count,
            })),
          );
          expect(recomposed).toEqual({ ok: true, baseUnits });

          // Changing to the package unit is refused unless it divides, and
          // when it is allowed it returns to the same base count.
          const change = recalculateForUnit(packaging, {
            from: STRIP,
            to: PACK,
            count: baseUnits,
            unitPriceFils: 1_000n,
          });
          if (strips === 0n) {
            expect(change).toMatchObject({ ok: true, baseUnits });
          } else {
            expect(change.ok, `${ratio}/${packs}/${strips}`).toBe(false);
          }
        },
      ),
      { numRuns: 500, seed: 47 },
    );
  });
});
