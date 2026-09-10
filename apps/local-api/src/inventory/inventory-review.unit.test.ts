import { describe, expect, it } from "vitest";

import { calculatePurchaseCosts } from "../purchasing/purchase-costs.js";
import { consumptionRatePer30Days } from "./inventory-risk.js";
import {
  deriveInventoryValueFils,
  type InventoryMovementReason,
} from "./inventory-review.js";
import {
  applyWeightedAverageReceipt,
  EMPTY_INVENTORY_VALUATION,
  reportedAverageUnitCostScaled,
  valuationValueFils,
  type InventoryValuationState,
} from "./inventory-valuation.js";

describe("inventory review movement folding", () => {
  it("reconciles a price-only adjustment from one value effect without a movement", () => {
    const value = deriveInventoryValueFils(
      [{ carryingAmountFils: 10_000n, reason: "purchase-receipt" }],
      [2_500n],
    );
    const balance = 10n;
    const valuation = { quantity: 10n, value: 12_500n };

    expect(value).toBe(valuation.value);
    expect(balance).toBe(valuation.quantity);
    expect(value * 10_000_000_000n).toBe(valuation.value * 10_000_000_000n);
  });

  it("counts a quantity adjustment value delta once when movement and effect match", () => {
    const movements: {
      carryingAmountFils: bigint;
      quantity: bigint;
      reason: InventoryMovementReason;
    }[] = [
      {
        carryingAmountFils: 10_000n,
        quantity: 10n,
        reason: "purchase-receipt",
      },
      {
        carryingAmountFils: 2_000n,
        quantity: 2n,
        reason: "purchase-adjustment",
      },
    ];
    const value = deriveInventoryValueFils(movements, [2_000n]);

    expect(
      movements.reduce((total, movement) => total + movement.quantity, 0n),
    ).toBe(12n);
    expect(value).toBe(12_000n);
    expect(value).not.toBe(14_000n);
  });

  it("does not count a negative purchase adjustment as consumption", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");

    expect(
      consumptionRatePer30Days(
        [
          {
            occurredAt: new Date("2026-09-09T12:00:00.000Z"),
            quantity: -6n,
            reason: "purchase-receipt",
          },
          {
            occurredAt: new Date("2026-09-09T12:00:00.000Z"),
            quantity: -90n,
            reason: "purchase-adjustment",
          },
        ],
        now,
      ),
    ).toBe(2n);
  });

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
