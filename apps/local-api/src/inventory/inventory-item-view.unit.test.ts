import { describe, expect, it } from "vitest";

import type { CatalogInventoryFacts } from "../catalog/catalog-inventory.js";
import { inventoryItemView } from "./inventory-item-view.js";
import type { InventoryPosition } from "./inventory-review.js";

const PRODUCT_ID = "01999f00-0000-7000-8000-000000000002";

describe("inventory item risk badges", () => {
  it("flags recalled and quarantined batches without changing the stored balance", () => {
    const item = inventoryItemView(
      fact(),
      position(),
      false,
      new Date("2026-09-10T12:00:00.000Z"),
      "2026-09-10",
      90,
    );

    expect(item.balance).toBe("9");
    expect(item.valueFils).toBeNull();
    expect(item.riskIndicators).toEqual(["recalled", "quarantined"]);
    expect(item.stateColour.automatic).toBe("red");
  });
});

function fact(): CatalogInventoryFacts {
  return {
    coldStorageRequired: false,
    displayName: "Blocked stock",
    hasBarcode: true,
    manualStateColour: null,
    productId: PRODUCT_ID,
    status: "active",
    stockLevels: {
      maximumLevel: null,
      minimumLevel: null,
      reorderPoint: null,
    },
  };
}

function position(): InventoryPosition {
  return {
    averageUnitCostScaled: null,
    balance: 9n,
    batches: [
      batch("recalled", 4n),
      batch("quarantined", 5n),
      batch("recalled", 0n),
    ],
    earliestExpiry: null,
    expiredCount: 0n,
    movementCount: 0n,
    movements: [],
    productId: PRODUCT_ID,
    reconciliation: "consistent",
    totalBatchCount: 3n,
    valueFils: 900n,
    valuationQuantity: 9n,
    valuationValueScaled: 0n,
  };
}

function batch(
  status: InventoryPosition["batches"][number]["status"],
  balance: bigint,
): InventoryPosition["batches"][number] {
  return {
    balance,
    batchId: "01999f00-0000-7000-8000-000000000003",
    effectiveExpiryDate: null,
    expiryDate: null,
    lotNumber: null,
    status,
  };
}
