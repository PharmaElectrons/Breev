import { describe, expect, it } from "vitest";
import { preparePurchaseRow, type PurchaseRowProduct } from "./purchase-row.js";

const product = (method: "by-percentage" | "by-price"): PurchaseRowProduct => ({
  displayName: "Panadol Extra GSK",
  id: "0199b0be-1c73-7000-8000-000000000001",
  packaging: {
    defaultUnits: {
      count: { kind: "inventory-unit" },
      purchase: { kind: "package-unit", packageUnitName: "Pack" },
      sale: { kind: "inventory-unit" },
    },
    inventoryUnitName: "Strip",
    packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
    thirdUnit: { name: "Day" },
  },
  pricing:
    method === "by-price"
      ? {
          method,
          retailPriceFils: "120000",
          wholesalePriceFils: null,
        }
      : {
          marginPercentage: "20",
          method,
          retailPriceFils: "100000",
          rounding: "off",
          wholesalePriceFils: null,
        },
});

describe("preparePurchaseRow", () => {
  it("keeps the entered package count and converts it to Inventory Units", () => {
    const result = preparePurchaseRow(product("by-price"), {
      costFils: "80000",
      enteredQuantity: "2",
      pricing: { method: "by-price", retailPriceFils: "120000" },
      unit: { kind: "package-unit", packageUnitName: "Pack" },
    });
    expect(result).toMatchObject({
      facts: {
        baseUnitsPerEnteredUnit: "4",
        enteredQuantity: "2",
        inventoryUnitQuantity: "8",
      },
      ok: true,
    });
  });

  it("calculates By Percentage retail price as margin on selling price", () => {
    const result = preparePurchaseRow(product("by-percentage"), {
      costFils: "80000",
      enteredQuantity: "1",
      pricing: { marginPercentage: "20", method: "by-percentage" },
      unit: { kind: "inventory-unit" },
    });
    expect(result).toMatchObject({
      facts: { retailPriceFils: "100000" },
      ok: true,
    });
  });

  it("rejects a pricing payload that does not match the Product mode", () => {
    expect(
      preparePurchaseRow(product("by-price"), {
        costFils: "80000",
        enteredQuantity: "1",
        pricing: { marginPercentage: "20", method: "by-percentage" },
        unit: { kind: "inventory-unit" },
      }),
    ).toEqual({ ok: false, problem: "pricing-mode-conflict" });
  });

  it.each(["0", "-1", "1.5", "01"])(
    "rejects invalid purchase quantity %s",
    (enteredQuantity) => {
      expect(
        preparePurchaseRow(product("by-price"), {
          costFils: "80000",
          enteredQuantity,
          pricing: { method: "by-price", retailPriceFils: "120000" },
          unit: { kind: "inventory-unit" },
        }),
      ).toEqual({ ok: false, problem: "quantity-invalid" });
    },
  );
});
