import { describe, expect, it } from "vitest";
import type {
  Product,
  PurchaseDraftDetail,
  PurchaseEntryPreferences,
} from "@breev/contracts/local-rest";
import {
  calculatePurchaseRetailPreview,
  determineDisplayedProduct,
  formatPurchaseDefaultUnit,
  purchaseEntryProgression,
  updateDraftRowProductAttributes,
} from "./purchase-row-entry";

const preferences: PurchaseEntryPreferences = {
  afterCommit: "new-row",
  columns: [
    { field: "item", visible: true },
    { field: "expiry", visible: true },
    { field: "selling-price", visible: false },
    { field: "quantity", visible: true },
    { field: "cost", visible: true },
  ],
  detailsPanelFields: ["wholesale-price"],
  revision: "1",
};

describe("purchase entry progression", () => {
  it("derives the logical path from configured order and visibility", () => {
    expect(purchaseEntryProgression(preferences, null)).toEqual([
      "item",
      "expiry",
      "quantity",
      "cost",
    ]);
  });

  it("skips a locked By Percentage retail-price field", () => {
    const shown = {
      ...preferences,
      columns: preferences.columns.map((column) => ({
        ...column,
        visible: true,
      })),
    };
    const product = {
      pricing: { method: "by-percentage" },
    } as unknown as Product;
    expect(purchaseEntryProgression(shown, product)).not.toContain(
      "selling-price",
    );
  });

  it("calculates the exact 80-at-20-percent preview as 100", () => {
    expect(calculatePurchaseRetailPreview("80000", "20", "off")).toBe("100000");
  });
});

describe("determineDisplayedProduct", () => {
  const entryProduct = { id: "p1", displayName: "Entry Product" } as Product;
  const committedProduct = {
    id: "p2",
    displayName: "Committed Product",
  } as Product;
  const highlightedProduct = {
    id: "p3",
    displayName: "Highlighted Suggestion",
  } as Product;

  it("returns the committed row product when a row is selected", () => {
    const displayed = determineDisplayedProduct({
      entryRowProduct: entryProduct,
      isRowSelected: true,
      selectedRowProduct: committedProduct,
    });
    expect(displayed).toBe(committedProduct);
  });

  it("returns null when a row is selected but product is still resolving", () => {
    const displayed = determineDisplayedProduct({
      entryRowProduct: entryProduct,
      isRowSelected: true,
      selectedRowProduct: null,
    });
    expect(displayed).toBeNull();
  });

  it("returns the active entry line product when no committed row is selected", () => {
    const displayed = determineDisplayedProduct({
      entryRowProduct: entryProduct,
      isRowSelected: false,
      selectedRowProduct: committedProduct,
    });
    expect(displayed).toBe(entryProduct);
  });

  it("returns the highlighted suggestion product when active entry row is in progress", () => {
    const displayed = determineDisplayedProduct({
      entryRowProduct: entryProduct,
      highlightedProduct,
      isRowSelected: false,
      selectedRowProduct: null,
    });
    expect(displayed).toBe(highlightedProduct);
  });

  it("reverts to active entry line product when highlighted suggestion is cleared", () => {
    const displayed = determineDisplayedProduct({
      entryRowProduct: entryProduct,
      highlightedProduct: null,
      isRowSelected: false,
      selectedRowProduct: null,
    });
    expect(displayed).toBe(entryProduct);
  });

  it("preserves committed row product when a row is selected even if highlightedProduct is set", () => {
    const displayed = determineDisplayedProduct({
      entryRowProduct: entryProduct,
      highlightedProduct,
      isRowSelected: true,
      selectedRowProduct: committedProduct,
    });
    expect(displayed).toBe(committedProduct);
  });

  it("returns null when neither a row is selected nor an entry line is in progress", () => {
    const displayed = determineDisplayedProduct({
      entryRowProduct: null,
      isRowSelected: false,
      selectedRowProduct: null,
    });
    expect(displayed).toBeNull();
  });
});

describe("formatPurchaseDefaultUnit", () => {
  it("formats inventory unit purchase default", () => {
    const product = {
      packaging: {
        defaultUnits: {
          purchase: { kind: "inventory-unit" as const },
        },
        inventoryUnitName: "Strip",
        packageUnits: [],
      },
    } as unknown as Product;
    expect(formatPurchaseDefaultUnit(product)).toBe("Strip");
  });

  it("formats package unit purchase default with base units and inventory unit name", () => {
    const product = {
      packaging: {
        defaultUnits: {
          purchase: {
            kind: "package-unit" as const,
            packageUnitName: "Box",
          },
        },
        inventoryUnitName: "Strip",
        packageUnits: [
          {
            baseUnitsPerPackage: "10",
            name: "Box",
          },
        ],
      },
    } as unknown as Product;
    expect(formatPurchaseDefaultUnit(product)).toBe("Box (10 Strip)");
  });

  it("falls back to package unit name when package unit not found in packaging definitions", () => {
    const product = {
      packaging: {
        defaultUnits: {
          purchase: {
            kind: "package-unit" as const,
            packageUnitName: "Carton",
          },
        },
        inventoryUnitName: "Vial",
        packageUnits: [],
      },
    } as unknown as Product;
    expect(formatPurchaseDefaultUnit(product)).toBe("Carton");
  });
});

describe("updateDraftRowProductAttributes", () => {
  const existingRows = [
    {
      baseUnitsPerEnteredUnit: "1",
      costFils: "5000",
      enteredQuantity: "2",
      expiryDate: "2027-12-31",
      id: "r1",
      inventoryUnitName: "Strip",
      inventoryUnitQuantity: "2",
      itemDisplayName: "Old Name",
      itemId: "prod-1",
      lotNumber: "LOT123",
      notes: "Fragile",
      ordinal: 1,
      pricingMethod: "by-price" as const,
      retailPriceFils: "7000",
      unit: { kind: "inventory-unit" as const },
    },
    {
      baseUnitsPerEnteredUnit: "1",
      costFils: "3000",
      enteredQuantity: "1",
      expiryDate: null,
      id: "r2",
      inventoryUnitName: "Box",
      inventoryUnitQuantity: "1",
      itemDisplayName: "Other Product",
      itemId: "prod-2",
      lotNumber: null,
      notes: null,
      ordinal: 2,
      pricingMethod: "by-price" as const,
      retailPriceFils: "4500",
      unit: { kind: "inventory-unit" as const },
    },
  ] as unknown as PurchaseDraftDetail["rows"];

  it("updates displayName and inventoryUnitName for rows matching the updated product", () => {
    const updated = {
      id: "prod-1",
      displayName: "New Panadol Name",
      packaging: {
        inventoryUnitName: "Pack",
      },
    } as unknown as Product;

    const { hasChanges, rows } = updateDraftRowProductAttributes(
      existingRows,
      updated,
    );

    expect(hasChanges).toBe(true);
    expect(rows[0]?.itemDisplayName).toBe("New Panadol Name");
    expect(rows[0]?.inventoryUnitName).toBe("Pack");
    // Verify invoice-specific data is completely intact
    expect(rows[0]?.enteredQuantity).toBe("2");
    expect(rows[0]?.costFils).toBe("5000");
    expect(rows[0]?.lotNumber).toBe("LOT123");
    expect(rows[0]?.notes).toBe("Fragile");
    // Other rows are untouched
    expect(rows[1]?.itemDisplayName).toBe("Other Product");
    expect(rows[1]?.inventoryUnitName).toBe("Box");
  });

  it("returns hasChanges: false when attributes are identical", () => {
    const unchanged = {
      id: "prod-1",
      displayName: "Old Name",
      packaging: {
        inventoryUnitName: "Strip",
      },
    } as unknown as Product;

    const { hasChanges, rows } = updateDraftRowProductAttributes(
      existingRows,
      unchanged,
    );

    expect(hasChanges).toBe(false);
    expect(rows).toEqual(existingRows);
  });
});
