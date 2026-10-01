import { describe, expect, it } from "vitest";
import { purchaseItemDetailsSchema } from "./index.js";

const facts = {
  productId: "019c0000-0000-7000-8000-000000000001",
  displayName: "Panel item",
  scientificName: null,
  category: null,
  barcode: null,
  visibleFields: ["packaging", "wholesale-price"],
  packaging: {
    inventoryUnitName: "Strip",
    packageUnits: [{ name: "Box", baseUnitsPerPackage: "4" }],
  },
  pricingMethod: "by-price",
  retailPriceFils: "0",
  wholesalePriceFils: null,
  businessDate: "2026-10-01",
  inventoryVisibility: "visible",
  inventory: {
    balance: "0",
    breakdown: [
      { name: "Box", quantity: "0" },
      { name: "Strip", quantity: "0" },
    ],
    minimumLevel: "0",
    maximumLevel: null,
    reconciliation: "consistent",
    alerts: ["out-of-stock"],
    batches: [],
  },
  costVisibility: "visible",
  averageCostVisibility: "visible",
  averageUnitCostFils: null,
  lastPostedCost: null,
};
describe("authoritative Purchasing item details wire facts", () => {
  it("distinguishes zero from unavailable and permits exact values beyond Number precision", () => {
    expect(purchaseItemDetailsSchema.parse(facts)).toMatchObject({
      retailPriceFils: "0",
      wholesalePriceFils: null,
      inventory: { minimumLevel: "0", maximumLevel: null },
    });
    expect(
      purchaseItemDetailsSchema.safeParse({
        ...facts,
        inventory: { ...facts.inventory, balance: "9007199254740993" },
      }).success,
    ).toBe(true);
  });
  it("rejects leaked stock or valuation when denied", () => {
    expect(
      purchaseItemDetailsSchema.safeParse({
        ...facts,
        inventoryVisibility: "hidden-by-permission",
      }).success,
    ).toBe(false);
    expect(
      purchaseItemDetailsSchema.safeParse({
        ...facts,
        averageCostVisibility: "hidden-by-setting",
        averageUnitCostFils: "100",
      }).success,
    ).toBe(false);
    expect(
      purchaseItemDetailsSchema.safeParse({
        ...facts,
        costVisibility: "hidden-by-permission",
        lastPostedCost: {
          purchaseId: facts.productId,
          invoiceDate: facts.businessDate,
          enteredUnitName: "Strip",
          enteredQuantity: "1",
          primarySupplierCostFils: "100",
          costAfterDiscountFils: "90",
        },
      }).success,
    ).toBe(false);
  });
  it("rejects floating amounts, negative balances, clinical aliases and non-integer days", () => {
    expect(
      purchaseItemDetailsSchema.safeParse({
        ...facts,
        inventory: {
          ...facts.inventory,
          batches: [
            {
              id: facts.productId,
              balance: "1",
              lotNumber: null,
              originalExpiryDate: facts.businessDate,
              effectiveExpiryDate: facts.businessDate,
              daysRemaining: 0.5,
              status: "eligible",
            },
          ],
        },
      }).success,
    ).toBe(false);
    for (const retailPriceFils of [100, "1.2", "01", "-1"])
      expect(
        purchaseItemDetailsSchema.safeParse({ ...facts, retailPriceFils })
          .success,
      ).toBe(false);
    expect(
      purchaseItemDetailsSchema.safeParse({
        ...facts,
        inventory: { ...facts.inventory, balance: "-1" },
      }).success,
    ).toBe(false);
    expect(
      purchaseItemDetailsSchema.safeParse({
        ...facts,
        packaging: { ...facts.packaging, thirdUnit: { name: "Treatment day" } },
      }).success,
    ).toBe(false);
  });
});
