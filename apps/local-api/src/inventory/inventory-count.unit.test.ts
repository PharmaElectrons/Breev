import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  composeCountEntries,
  countVariance,
  pickSurplusBatch,
  splitCarryingAmount,
  valueCountVariance,
} from "./inventory-count.js";
import {
  definePackaging,
  type PackagingDefinition,
} from "../catalog/catalog-packaging.js";

const PACKAGING_DEFINITION: PackagingDefinition = {
  inventoryUnitName: "Strip",
  packageUnits: [{ name: "Pack", baseUnitsPerPackage: "4" }],
  thirdUnit: null,
  defaultUnits: {
    count: { kind: "package-unit", packageUnitName: "Pack" },
    purchase: { kind: "package-unit", packageUnitName: "Pack" },
    sale: { kind: "inventory-unit" },
  },
};

function packaging() {
  const result = definePackaging(PACKAGING_DEFINITION);
  if (!result.ok) throw new Error("The count test packaging is invalid");
  return result.packaging;
}

describe("inventory count domain", () => {
  it("converts 2 packs and 1 strip to 9 strips with a preserved label", () => {
    expect(
      composeCountEntries(packaging(), [
        { unit: { kind: "package-unit", packageUnitName: "Pack" }, count: 2n },
        { unit: { kind: "inventory-unit" }, count: 1n },
      ]),
    ).toEqual({
      countedQuantity: 9n,
      enteredLabel: "2 Pack + 1 Strip",
      ok: true,
    });
  });

  it("composes arbitrary non-negative integer counts at arbitrary positive ratios", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 100n }),
        fc.bigInt({ min: 0n, max: 1_000n }),
        (ratio, count) => {
          const definition: PackagingDefinition = {
            ...PACKAGING_DEFINITION,
            packageUnits: [
              { name: "Pack", baseUnitsPerPackage: ratio.toString() },
            ],
          };
          const result = definePackaging(definition);
          if (!result.ok) return false;
          const composed = composeCountEntries(result.packaging, [
            { unit: { kind: "package-unit", packageUnitName: "Pack" }, count },
          ]);
          return composed.ok && composed.countedQuantity === ratio * count;
        },
      ),
    );
  });

  it("keeps variance and signed fils splits exact", () => {
    expect(countVariance(9n, 8n)).toBe(1n);
    expect(countVariance(6n, 8n)).toBe(-2n);
    const allocations = [{ quantity: 2n }, { quantity: 3n }, { quantity: 5n }];
    expect(splitCarryingAmount(-101n, allocations)).toEqual([-20n, -30n, -51n]);
    expect(
      splitCarryingAmount(-101n, allocations).reduce(
        (total, share) => total + share,
        0n,
      ),
    ).toBe(-101n);
  });

  it("conserves WAC quantity and value for both variance directions", () => {
    const shortage = valueCountVariance(
      { totalQuantity: 10n, totalValueScaled: 100_000n * 10_000_000_000n },
      -2n,
    );
    if ("problem" in shortage) throw new Error(shortage.problem);
    expect(shortage.carryingAmountFils).toBe(-20_000n);
    expect(shortage.nextState.totalQuantity).toBe(8n);
    expect(shortage.nextState.totalValueScaled).toBe(80_000n * 10_000_000_000n);

    const surplus = valueCountVariance(
      { totalQuantity: 8n, totalValueScaled: 80_000n * 10_000_000_000n },
      2n,
    );
    if ("problem" in surplus) throw new Error(surplus.problem);
    expect(surplus.carryingAmountFils).toBe(20_000n);
    expect(surplus.nextState.totalQuantity).toBe(10n);
    expect(surplus.nextState.totalValueScaled).toBe(100_000n * 10_000_000_000n);

    fc.assert(
      fc.property(
        fc.bigInt({ min: 2n, max: 1_000n }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        (quantity, unitValue) => {
          const state = {
            totalQuantity: quantity,
            totalValueScaled: quantity * unitValue * 10_000_000_000n,
          };
          const amount = valueCountVariance(state, -1n);
          if ("problem" in amount) return false;
          const replenished = valueCountVariance(amount.nextState, 1n);
          if ("problem" in replenished) return false;
          return (
            amount.nextState.totalQuantity >= 0n &&
            amount.nextState.totalValueScaled >= 0n &&
            replenished.nextState.totalQuantity >= 0n &&
            replenished.nextState.totalValueScaled >= 0n
          );
        },
      ),
    );
  });

  it("picks the newest eligible batch by receipt time then id", () => {
    const facts = [
      {
        batchId: "batch-a",
        balance: 1n,
        effectiveExpiryDate: null,
        latestStatusKind: null,
        lotNumber: null,
        originalExpiryDate: null,
        productId: "product",
        receivedAt: "2026-01-01T00:00:00.000Z",
        status: "eligible" as const,
      },
      {
        batchId: "batch-b",
        balance: 0n,
        effectiveExpiryDate: null,
        latestStatusKind: null,
        lotNumber: null,
        originalExpiryDate: null,
        productId: "product",
        receivedAt: "2026-01-02T00:00:00.000Z",
        status: "near-expiry" as const,
      },
    ];
    expect(pickSurplusBatch(facts)?.batchId).toBe("batch-b");
  });
});
