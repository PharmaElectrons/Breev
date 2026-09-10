import { describe, expect, it } from "vitest";

import { calculatePurchaseCosts } from "../purchasing/purchase-costs.js";
import {
  applyWeightedAverageReceipt,
  EMPTY_INVENTORY_VALUATION,
  reportedAverageUnitCostScaled,
  valuationValueFils,
  type InventoryValuationState,
} from "./inventory-valuation.js";

describe("inventory review movement folding", () => {
  it("reconciles balance, value, and WAC from movement fixtures", () => {
    const movements = [
      { carryingAmountFils: 100_000n, quantity: 10n },
      { carryingAmountFils: 37_500n, quantity: 5n },
    ];
    const balance = movements.reduce(
      (total, movement) => total + movement.quantity,
      0n,
    );
    const receipts = movements.filter((movement) => movement.quantity > 0n);
    const valuation = receipts.reduce(
      applyWeightedAverageReceipt,
      EMPTY_INVENTORY_VALUATION,
    );

    expect(balance).toBe(15n);
    expect(valuationValueFils(valuation)).toBe(137_500n);
    expect(reportedAverageUnitCostScaled(valuation)).toBe(91_666_666_666_667n);
  });

  it("keeps WAC on Primary Supplier Cost when an allowance is present", () => {
    const lines = [
      { enteredQuantity: 10n, primarySupplierCostFils: 1_000n },
      { enteredQuantity: 4n, primarySupplierCostFils: 2_000n },
    ];
    const costs = calculatePurchaseCosts(lines, "7");
    if (!costs.ok) throw new Error(costs.problem);
    const valuation = costs.costs.lines.reduce(
      (state: InventoryValuationState, line, index) =>
        applyWeightedAverageReceipt(state, {
          carryingAmountFils: line.linePrimarySupplierCostFils,
          quantity: (lines[index]?.enteredQuantity ?? 0n) * 2n,
        }),
      EMPTY_INVENTORY_VALUATION,
    );

    expect(costs.costs.costAfterDiscountFils).toBe(16_740n);
    expect(valuationValueFils(valuation)).toBe(18_000n);
    expect(valuation.totalQuantity).toBe(28n);
    expect(reportedAverageUnitCostScaled(valuation)).toBe(6_428_571_428_571n);
  });
});
