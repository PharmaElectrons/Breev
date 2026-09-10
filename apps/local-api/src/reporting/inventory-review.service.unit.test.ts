import { inventorySensitiveExportSchema } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import type { CatalogInventoryFacts } from "../catalog/catalog-inventory.js";
import type { InventoryPosition } from "../inventory/inventory-review.js";
import type { SupplierCostFact } from "../purchasing/purchasing-references.js";
import {
  includeInReview,
  inventoryExportItemView,
} from "./inventory-review.service.js";

const PHARMACY_ID = "01999f00-0000-7000-8000-000000000001";
const PRODUCT_ID = "01999f00-0000-7000-8000-000000000002";
const BATCH_ID = "01999f00-0000-7000-8000-000000000003";
const SUPPLIER_ID = "01999f00-0000-7000-8000-000000000004";
const PURCHASE_ID = "01999f00-0000-7000-8000-000000000005";
const USER_ID = "01999f00-0000-7000-8000-000000000006";

describe("inventory export item view", () => {
  it("serializes bigint batch balances before validating the export schema", () => {
    const fact: CatalogInventoryFacts = {
      coldStorageRequired: false,
      displayName: "Paracetamol",
      hasBarcode: true,
      manualStateColour: null,
      productId: PRODUCT_ID,
      status: "active",
      stockLevels: {
        maximumLevel: 20n,
        minimumLevel: 5n,
        reorderPoint: 8n,
      },
    };
    const position: InventoryPosition = {
      averageUnitCostScaled: 1_000_000_000_000n,
      balance: 12n,
      batches: [
        {
          balance: 12n,
          batchId: BATCH_ID,
          expiryDate: "2027-01-01",
          lotNumber: "LOT-1",
        },
      ],
      earliestExpiry: "2027-01-01",
      expiredCount: 0n,
      movementCount: 1n,
      movements: [],
      productId: PRODUCT_ID,
      reconciliation: "consistent",
      totalBatchCount: 1n,
      valueFils: 1_200n,
      valuationQuantity: 12n,
      valuationValueScaled: 12_000_000_000_000n,
    };
    const supplier: SupplierCostFact = {
      lastCostAfterDiscountFils: "90",
      lastInvoiceDate: "2026-09-10",
      lastPostedPurchaseId: PURCHASE_ID,
      lastPrimarySupplierCostFils: "100",
      productId: PRODUCT_ID,
      receiptCount: "1",
      supplierId: SUPPLIER_ID,
      supplierName: "Example Supplier",
    };

    const item = inventoryExportItemView(fact, position, [supplier]);
    const bundle = inventorySensitiveExportSchema.parse({
      counts: { batches: "1", items: "1", movements: "1" },
      exportedAt: "2026-09-10T12:00:00.000Z",
      exportedBy: { displayName: "Inventory Owner", id: USER_ID },
      items: [item],
      pharmacyId: PHARMACY_ID,
      valuationMethod: "weighted-average-cost",
    });

    expect(bundle.items[0]?.batches).toEqual([
      {
        balance: "12",
        batchId: BATCH_ID,
        expiryDate: "2027-01-01",
        lotNumber: "LOT-1",
      },
    ]);
  });

  it("includes archived products only when they still have stock", () => {
    const archived: CatalogInventoryFacts = {
      coldStorageRequired: false,
      displayName: "Archived item",
      hasBarcode: true,
      manualStateColour: null,
      productId: PRODUCT_ID,
      status: "archived",
      stockLevels: {
        maximumLevel: null,
        minimumLevel: null,
        reorderPoint: null,
      },
    };

    expect(includeInReview(archived, undefined)).toBe(false);
    expect(includeInReview(archived, { balance: 2n })).toBe(true);
    expect(
      includeInReview({ ...archived, status: "merged" }, { balance: 2n }),
    ).toBe(false);
  });
});
