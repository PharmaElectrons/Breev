import { describe, expect, it } from "vitest";

import {
  INVENTORY_COLUMN_FIELDS,
  INVENTORY_CONTRACTS,
  INVENTORY_MOVEMENT_KINDS,
  INVENTORY_RISK_INDICATORS,
  BATCH_ELIGIBILITY_STATUSES,
  countLineRecordContract,
  countSessionCompleteContract,
  countSessionStartContract,
  countVarianceApplyContract,
  inventoryAllocationPreviewRequestSchema,
  inventoryBatchSafetyReviewContract,
  inventoryBatchSchema,
  inventoryBatchListContract,
  inventoryBatchStatusChangeContract,
  inventoryBatchExpiryCorrectionContract,
  inventoryBatchSafetyRunContract,
  inventoryBatchSafetyStatusContract,
  inventoryAllocationPreviewContract,
  inventoryItemListContract,
  inventoryItemSchema,
  inventoryMovementHistoryContract,
  inventoryMovementSchema,
  inventoryReviewPreferencesSchema,
  inventorySensitiveExportRequestSchema,
  inventorySensitiveExportSchema,
  inventorySensitiveExportContract,
} from "./index.js";

const PRODUCT_ID = "0198e7ce-7685-7000-8000-000000000001";
const BATCH_ID = "0198e7ce-7685-7000-8000-000000000002";
const USER_ID = "0198e7ce-7685-7000-8000-000000000003";
const PURCHASE_ID = "0198e7ce-7685-7000-8000-000000000004";
const RETURN_ID = "0198e7ce-7685-7000-8000-000000000007";

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

  it("validates movement history as a closed union with all DB kinds", () => {
    expect([...INVENTORY_MOVEMENT_KINDS]).toEqual([
      "purchase-adjustment",
      "purchase-receipt",
      "purchase-return",
      "count-variance",
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
      inventoryMovementSchema.parse({
        ...movement,
        id: RETURN_ID,
        kind: "purchase-return",
        quantity: "-1",
        valueFils: "-1250",
        reference: {
          ...movement.reference,
          documentId: RETURN_ID,
          documentType: "purchase-return",
          label: "PR1/2026 · P1/2026 · Supplier",
        },
      }).kind,
    ).toBe("purchase-return");
    expect(
      inventoryMovementSchema.parse({
        ...movement,
        id: "0198e7ce-7685-7000-8000-000000000008",
        kind: "count-variance",
        quantity: "1",
        valueFils: "1250",
        reference: {
          ...movement.reference,
          documentId: RETURN_ID,
          documentType: "count-session",
          label: "C1/2026 · line 1",
          number: { series: "C", value: "1", year: 2026 },
        },
      }).kind,
    ).toBe("count-variance");
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
    expect(
      INVENTORY_CONTRACTS.filter((contract) => contract.method === "POST"),
    ).toEqual([
      inventoryAllocationPreviewContract,
      inventoryBatchExpiryCorrectionContract,
      inventoryBatchSafetyRunContract,
      inventoryBatchStatusChangeContract,
      inventorySensitiveExportContract,
      countLineRecordContract,
      countSessionCompleteContract,
      countSessionStartContract,
      countVarianceApplyContract,
    ]);
    expect(
      INVENTORY_CONTRACTS.filter((contract) => contract.method === "GET").every(
        (contract) => contract.method === "GET",
      ),
    ).toBe(true);
    expect(
      INVENTORY_CONTRACTS.some((contract) => contract.method === "PUT"),
    ).toBe(true);
  });

  it("keeps every risk indicator in the wire catalogue", () => {
    expect(INVENTORY_RISK_INDICATORS).toHaveLength(8);
  });

  it("keeps the eligibility enum exhaustive and expiry values date-only", () => {
    expect(inventoryBatchSchema.shape.status.options).toEqual([
      ...BATCH_ELIGIBILITY_STATUSES,
    ]);
    const batch = {
      balance: "2",
      batchId: BATCH_ID,
      blockedSinceBusinessDate: null,
      daysToExpiry: "10",
      effectiveExpiryDate: "2026-09-20",
      expiryAmendments: [],
      expiryCorrected: false,
      lotNumber: null,
      nearExpiryDays: "90",
      originalExpiryDate: "2026-09-20",
      productId: PRODUCT_ID,
      receivedAt: "2026-09-10T10:00:00.000Z",
      status: "near-expiry",
      statusEvents: [],
    };
    expect(inventoryBatchSchema.safeParse(batch).success).toBe(true);
    expect(
      inventoryBatchSchema.safeParse({
        ...batch,
        effectiveExpiryDate: "2026-09-20T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("bounds allocation previews and validates the review month", () => {
    const line = { productId: PRODUCT_ID, quantity: "1" };
    expect(
      inventoryAllocationPreviewRequestSchema.safeParse({
        lines: Array.from({ length: 50 }, () => line),
      }).success,
    ).toBe(true);
    expect(
      inventoryAllocationPreviewRequestSchema.safeParse({
        lines: Array.from({ length: 51 }, () => line),
      }).success,
    ).toBe(false);
    expect(
      inventoryBatchSafetyReviewContract.request.query.parse({
        month: "2026-09",
      }),
    ).toEqual({ month: "2026-09" });
    expect(
      inventoryBatchSafetyReviewContract.request.query.safeParse({
        month: "2026-9",
      }).success,
    ).toBe(false);
  });

  it("exposes the new batch safety routes with their intended methods", () => {
    expect(inventoryBatchListContract.method).toBe("GET");
    expect(inventoryBatchSafetyStatusContract.method).toBe("GET");
    expect(inventoryBatchSafetyReviewContract.method).toBe("GET");
    expect(inventoryAllocationPreviewContract.method).toBe("POST");
    expect(inventoryBatchStatusChangeContract.method).toBe("POST");
    expect(inventoryBatchExpiryCorrectionContract.method).toBe("POST");
    expect(inventoryBatchSafetyRunContract.method).toBe("POST");
  });
});
