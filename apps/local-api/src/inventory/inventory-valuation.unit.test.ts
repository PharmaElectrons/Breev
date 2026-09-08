import { describe, expect, it } from "vitest";

import { calculatePurchaseCosts } from "../purchasing/purchase-costs.js";
import {
  applyWeightedAverageReceipt,
  EMPTY_INVENTORY_VALUATION,
  INVENTORY_VALUATION_METHOD,
  reportedAverageUnitCostScaled,
  valuationValueFils,
  VALUATION_SCALE,
  type InventoryReceipt,
  type InventoryValuationState,
} from "./inventory-valuation.js";

const UNIT = 10n ** BigInt(VALUATION_SCALE);

function receive(
  receipts: readonly InventoryReceipt[],
  from: InventoryValuationState = EMPTY_INVENTORY_VALUATION,
): InventoryValuationState {
  return receipts.reduce(applyWeightedAverageReceipt, from);
}

describe("applyWeightedAverageReceipt", () => {
  it("is the one Phase One costing method", () => {
    expect(INVENTORY_VALUATION_METHOD).toBe("weighted-average-cost");
  });

  it("adds the received quantity and its Carrying Amount", () => {
    const state = applyWeightedAverageReceipt(EMPTY_INVENTORY_VALUATION, {
      carryingAmountFils: 160_000n,
      quantity: 8n,
    });
    expect(state.totalQuantity).toBe(8n);
    expect(state.totalValueScaled).toBe(160_000n * UNIT);
    expect(valuationValueFils(state)).toBe(160_000n);
    expect(reportedAverageUnitCostScaled(state)).toBe(20_000n * UNIT);
  });

  it("conserves quantity and carrying amount over any sequence", () => {
    const receipts: InventoryReceipt[] = [
      { carryingAmountFils: 160_000n, quantity: 8n },
      { carryingAmountFils: 7n, quantity: 3n },
      { carryingAmountFils: 0n, quantity: 5n },
      { carryingAmountFils: 999_999_999n, quantity: 7n },
    ];
    const expectedQuantity = receipts.reduce(
      (total, receipt) => total + receipt.quantity,
      0n,
    );
    const expectedValue = receipts.reduce(
      (total, receipt) => total + receipt.carryingAmountFils,
      0n,
    );
    const forwards = receive(receipts);
    const backwards = receive([...receipts].reverse());
    expect(forwards.totalQuantity).toBe(expectedQuantity);
    expect(forwards.totalValueScaled).toBe(expectedValue * UNIT);
    expect(valuationValueFils(forwards)).toBe(expectedValue);
    // Order cannot change the conserved totals; only exact addition happens.
    expect(backwards).toEqual(forwards);
  });

  it("never lets a rounded average feed back into the stored value", () => {
    // Three fils over seven units averages 0.4285714285... per unit. Whatever
    // the reported average rounds to, the stored value stays exactly 3 fils.
    const state = receive([{ carryingAmountFils: 3n, quantity: 7n }]);
    expect(reportedAverageUnitCostScaled(state)).toBe(4_285_714_286n);
    const next = applyWeightedAverageReceipt(state, {
      carryingAmountFils: 4n,
      quantity: 1n,
    });
    expect(valuationValueFils(next)).toBe(7n);
    expect(next.totalQuantity).toBe(8n);
  });

  it("reports the weighted average, not the last purchase cost", () => {
    const state = receive([
      { carryingAmountFils: 10_000n, quantity: 10n },
      { carryingAmountFils: 30_000n, quantity: 10n },
    ]);
    // 40,000 fils over 20 units is 2,000 -- not the 3,000 of the last receipt.
    expect(reportedAverageUnitCostScaled(state)).toBe(2_000n * UNIT);
  });

  it("values only the Primary Supplier Cost, whatever the allowance is", () => {
    const lines = [
      { enteredQuantity: 2n, primarySupplierCostFils: 80_000n },
      { enteredQuantity: 3n, primarySupplierCostFils: 1_500n },
    ];
    const runs = ["0", "2.5", "40"].map((percentage) => {
      const outcome = calculatePurchaseCosts(lines, percentage);
      if (!outcome.ok) throw new Error(outcome.problem);
      return {
        costAfterDiscountFils: outcome.costs.costAfterDiscountFils,
        state: receive(
          outcome.costs.lines.map((row, index) => ({
            carryingAmountFils: row.linePrimarySupplierCostFils,
            quantity: (lines[index]?.enteredQuantity ?? 0n) * 4n,
          })),
        ),
      };
    });
    // The informational cost moves with the allowance. At 2.5% the exact
    // allowance is 4,112.5 fils, which rounds away from zero to 4,113.
    expect(runs.map((run) => run.costAfterDiscountFils)).toEqual([
      164_500n,
      160_387n,
      98_700n,
    ]);
    // ...and the valuation state does not move at all.
    for (const run of runs) {
      expect(run.state).toEqual(runs[0]?.state);
    }
    const first = runs[0]?.state as InventoryValuationState;
    expect(valuationValueFils(first)).toBe(164_500n);
    expect(first.totalQuantity).toBe(20n);
    expect(reportedAverageUnitCostScaled(first)).toBe(8_225n * UNIT);
  });

  it("stays exact past double precision", () => {
    const state = receive([
      { carryingAmountFils: 9_007_199_254_740_993n, quantity: 1n },
      { carryingAmountFils: 1n, quantity: 1n },
    ]);
    expect(valuationValueFils(state)).toBe(9_007_199_254_740_994n);
    expect(reportedAverageUnitCostScaled(state)).toBe(
      45_035_996_273_704_970_000_000_000n,
    );
  });

  it("has no average until it has stock", () => {
    expect(reportedAverageUnitCostScaled(EMPTY_INVENTORY_VALUATION)).toBe(null);
    expect(valuationValueFils(EMPTY_INVENTORY_VALUATION)).toBe(0n);
  });

  it("refuses a receipt that is not a positive, non-negative-value receipt", () => {
    for (const invalid of [
      { carryingAmountFils: 1n, quantity: 0n },
      { carryingAmountFils: 1n, quantity: -1n },
    ]) {
      expect(() =>
        applyWeightedAverageReceipt(EMPTY_INVENTORY_VALUATION, invalid),
      ).toThrow(RangeError);
    }
    expect(() =>
      applyWeightedAverageReceipt(EMPTY_INVENTORY_VALUATION, {
        carryingAmountFils: -1n,
        quantity: 1n,
      }),
    ).toThrow(RangeError);
  });

  it("refuses a forged floating point operand", () => {
    expect(() =>
      applyWeightedAverageReceipt(EMPTY_INVENTORY_VALUATION, {
        carryingAmountFils: 1.5 as unknown as bigint,
        quantity: 1n,
      }),
    ).toThrow(TypeError);
    expect(() =>
      reportedAverageUnitCostScaled({
        totalQuantity: 1n,
        totalValueScaled: 1.5 as unknown as bigint,
      }),
    ).toThrow(TypeError);
  });
});
