import { describe, expect, it } from "vitest";
import type {
  Product,
  PurchaseEntryPreferences,
} from "@breev/contracts/local-rest";
import {
  calculatePurchaseRetailPreview,
  purchaseEntryProgression,
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
