import { describe, expect, it } from "vitest";

import {
  calculateSupplierReduction,
  validatePurchaseReturnEligibility,
} from "./purchase-return.js";

describe("Purchase Return exact rules", () => {
  it("names over-return, ineligible history, and negative-stock independently", () => {
    expect(
      validatePurchaseReturnEligibility({
        availableStock: 5n,
        originalQuantity: 10n,
        previouslyReturnedQuantity: 4n,
        requestedQuantity: 7n,
      }),
    ).toBe("over-return");
    expect(
      validatePurchaseReturnEligibility({
        availableStock: 10n,
        originalQuantity: 10n,
        previouslyReturnedQuantity: 11n,
        requestedQuantity: 1n,
      }),
    ).toBe("ineligible-batch");
    expect(
      validatePurchaseReturnEligibility({
        availableStock: 2n,
        originalQuantity: 10n,
        previouslyReturnedQuantity: 4n,
        requestedQuantity: 3n,
      }),
    ).toBe("negative-stock");
  });

  it("allocates partial Primary Supplier Cost and gives the final return the remainder", () => {
    expect(
      calculateSupplierReduction({
        alreadyReducedFils: 0n,
        originalQuantity: 3n,
        originalSupplierCostFils: 10n,
        previouslyReturnedQuantity: 0n,
        returnQuantity: 1n,
      }),
    ).toBe(3n);
    expect(
      calculateSupplierReduction({
        alreadyReducedFils: 3n,
        originalQuantity: 3n,
        originalSupplierCostFils: 10n,
        previouslyReturnedQuantity: 1n,
        returnQuantity: 2n,
      }),
    ).toBe(7n);
  });

  it("depends on no allowance or Cost After Discount input", () => {
    expect(
      calculateSupplierReduction({
        alreadyReducedFils: 0n,
        originalQuantity: 4n,
        originalSupplierCostFils: 8_000n,
        previouslyReturnedQuantity: 0n,
        returnQuantity: 2n,
      }),
    ).toBe(4_000n);
  });
});
