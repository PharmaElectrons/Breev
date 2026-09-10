import { describe, expect, it } from "vitest";

import {
  INVENTORY_COLUMN_FIELDS,
  INVENTORY_CONTRACTS,
  INVENTORY_MOVEMENT_KINDS,
  INVENTORY_RISK_INDICATORS,
  inventoryItemListContract,
  inventoryItemSchema,
  inventoryMovementHistoryContract,
  inventoryMovementSchema,
  inventoryReviewPreferencesSchema,
  inventorySensitiveExportRequestSchema,
  inventorySensitiveExportSchema,
} from "./index.js";

const PRODUCT_ID = "0198e7ce-7685-7000-8000-000000000001";
const BATCH_ID = "0198e7ce-7685-7000-8000-000000000002";
const USER_ID = "0198e7ce-7685-7000-8000-000000000003";
const PURCHASE_ID = "0198e7ce-7685-7000-8000-000000000004";

const columns = INVENTORY_COLUMN_FIELDS.map((field) => ({
  field,
  visible: true,
}));

describe("inventory review contracts", () => {
  it("validates the item query and exact integer representations", () => {
    expect(
      inventoryItemListContract.responses[200].parse({
        fields: { valuation: "granted" },
        items: [
          {
            averageUnitCostFils: "1250",
            balance: "12",
            batches: {
              count: "1",
              earliestExpiry: "2026-12-31",
              expiredCount: "0",
            },
            consumptionRatePer30Days: "3",
            displayName: "Paracetamol",
            productId: PRODUCT_ID,
            reconciliation: "consistent",
            riskIndicators: ["cold-storage"],
            stateColour: { automatic: "blue", effective: "blue", manual: null },
            status: "active",
            stockLevels: {
              maximumLevel: "100",
              minimumLevel: "10",
              reorderPoint: "5",
            },
            valueFils: "15000",
          },
        ],
      }).items[0]?.balance,
    ).toBe("12");
    expect(
      inventoryItemSchema.safeParse({
        productId: PRODUCT_ID,
        displayName: "Item",
        status: "active",
        stateColour: { manual: null, automatic: "green", effective: "green" },
        riskIndicators: [],
        balance: "01",
        valueFils: null,
        averageUnitCostFils: null,
        batches: { count: "0", earliestExpiry: null, expiredCount: "0" },
        stockLevels: {
          minimumLevel: null,
          maximumLevel: null,
          reorderPoint: null,
        },
        consumptionRatePer30Days: "0",
        reconciliation: "consistent",
      }).success,
    ).toBe(false);
  });

  it("validates movement history as a closed union with both DB kinds", () => {
    expect([...INVENTORY_MOVEMENT_KINDS]).toEqual([
      "purchase-adjustment",
      "purchase-receipt",
    ]);
    const movement = {
      batchId: BATCH_ID,
      id: "0198e7ce-7685-7000-8000-000000000005",
      kind: "purchase-receipt",
      occurredAt: "2026-09-10T10:00:00.000Z",
      quantity: "4",
      valueFils: "10000",
      user: { id: USER_ID, displayName: "Owner" },
      reference: {
        documentId: PURCHASE_ID,
        documentType: "purchase",
        label: "P1/2026",
        number: { series: "P", value: "1", year: 2026 },
        openable: true,
      },
    };
    expect(inventoryMovementSchema.parse(movement).kind).toBe(
      "purchase-receipt",
    );
    expect(
      inventoryMovementSchema.parse({
        ...movement,
        id: "0198e7ce-7685-7000-8000-000000000006",
        kind: "purchase-adjustment",
        quantity: "-2",
        valueFils: "-2500",
      }).kind,
    ).toBe("purchase-adjustment");
    expect(
      inventoryMovementHistoryContract.responses[200].parse({
        productId: PRODUCT_ID,
        productDisplayName: "Paracetamol",
        movements: [movement],
      }).movements,
    ).toHaveLength(1);
  });

  it("validates preferences and the Step-Up export command/bundle", () => {
    expect(
      inventoryReviewPreferencesSchema.parse({ columns, revision: "1" }),
    ).toEqual({
      columns,
      revision: "1",
    });
    expect(
      inventoryReviewPreferencesSchema.safeParse({
        columns: columns.map((column) =>
          column.field === "item" ? { ...column, visible: false } : column,
        ),
        revision: "1",
      }).success,
    ).toBe(false);
    expect(
      inventorySensitiveExportRequestSchema.parse({
        challengeId: PURCHASE_ID,
        idempotencyKey: USER_ID,
      }),
    ).toEqual({ challengeId: PURCHASE_ID, idempotencyKey: USER_ID });
    expect(
      inventorySensitiveExportSchema.safeParse({
        pharmacyId: PRODUCT_ID,
        exportedAt: "2026-09-10T10:00:00.000Z",
        exportedBy: { id: USER_ID, displayName: "Owner" },
        valuationMethod: "weighted-average-cost",
        items: [],
        counts: { items: "0", batches: "0", movements: "0" },
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("keeps the inventory transport surface read-only except its two commands", () => {
    expect(INVENTORY_CONTRACTS.map((contract) => contract.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "PUT",
      "POST",
    ]);
    expect(
      INVENTORY_CONTRACTS.slice(0, 3).every(
        (contract) => contract.method === "GET",
      ),
    ).toBe(true);
  });

  it("keeps every risk indicator in the wire catalogue", () => {
    expect(INVENTORY_RISK_INDICATORS).toHaveLength(8);
  });
});
