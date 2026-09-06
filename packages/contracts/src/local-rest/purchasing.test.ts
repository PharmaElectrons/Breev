import { describe, expect, it } from "vitest";
import {
  PURCHASING_CONTRACTS,
  allowancePercentageSchema,
  purchaseDraftCreateRequestSchema,
  purchaseDraftDiscardRequestSchema,
  purchaseDraftRowCommitRequestSchema,
  purchaseDraftResultSchema,
  purchaseEntryPreferencesSchema,
  supplierCreateRequestSchema,
} from "./index.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "018f7777-7777-7777-8777-777777777777";
const DRAFT_ID = "018f8888-8888-7888-8888-888888888888";

describe("supplier and purchase draft contracts", () => {
  it("uses exact percentage strings instead of floating point numbers", () => {
    expect(allowancePercentageSchema.parse("1.125000")).toBe("1.125000");
    expect(allowancePercentageSchema.safeParse(1.125).success).toBe(false);
    expect(allowancePercentageSchema.safeParse("100.000001").success).toBe(
      false,
    );
  });

  it("requires the complete header before draft creation", () => {
    const header = {
      idempotencyKey: COMMAND_ID,
      invoiceDate: "2026-09-03",
      settlementContext: "debt",
      supplierId: SUPPLIER_ID,
      supplierInvoiceNumber: "INV-2048",
    } as const;
    expect(purchaseDraftCreateRequestSchema.parse(header)).toEqual(header);
    for (const field of [
      "supplierInvoiceNumber",
      "supplierId",
      "settlementContext",
    ] as const) {
      const missing = { ...header } as Record<string, unknown>;
      delete missing[field];
      expect(
        purchaseDraftCreateRequestSchema.safeParse(missing).success,
        field,
      ).toBe(false);
    }
  });

  it("models the duplicate as a non-blocking typed warning", () => {
    const result = {
      draft: {
        allowanceSnapshot: { basisFils: "0", percentage: "2.5" },
        createdAt: "2026-09-03T12:00:00.000Z",
        id: DRAFT_ID,
        invoiceDate: "2026-09-03",
        settlementContext: "cash",
        status: "active",
        supplierId: SUPPLIER_ID,
        supplierInvoiceNumber: "INV-2048",
        supplierNameSnapshot: "Al-Nahrain",
        updatedAt: "2026-09-03T12:00:00.000Z",
        version: "1",
      },
      warnings: [
        {
          code: "duplicate-supplier-invoice-number",
          existingDraftIds: ["018f9999-9999-7999-8999-999999999999"],
          operationalRule: "warn-open-decision",
        },
      ],
    } as const;
    expect(purchaseDraftResultSchema.parse(result)).toEqual(result);
  });

  it("requires the explicit populated-draft confirmation token", () => {
    expect(
      purchaseDraftDiscardRequestSchema.safeParse({
        expectedVersion: "1",
        idempotencyKey: COMMAND_ID,
      }).success,
    ).toBe(false);
    expect(
      purchaseDraftDiscardRequestSchema.parse({
        confirmation: "discard-populated-purchase-draft",
        expectedVersion: "1",
        idempotencyKey: COMMAND_ID,
      }).confirmation,
    ).toBe("discard-populated-purchase-draft");
  });

  it("has no supplier or draft hard-delete route", () => {
    expect(PURCHASING_CONTRACTS).toHaveLength(13);
    expect(
      PURCHASING_CONTRACTS.map((contract) => contract.method),
    ).not.toContain("DELETE");
  });

  it("requires a version and idempotency key on each row commit", () => {
    const row = {
      costFils: "80000",
      enteredQuantity: "2",
      expectedVersion: "3",
      expiryDate: "2028-10-31",
      idempotencyKey: COMMAND_ID,
      itemId: "018f9999-9999-7999-8999-999999999999",
      lotNumber: "LOT-7",
      notes: null,
      pricing: { method: "by-price", retailPriceFils: "120000" },
      unit: { kind: "package-unit", packageUnitName: "Pack" },
    } as const;
    expect(purchaseDraftRowCommitRequestSchema.parse(row)).toEqual(row);
    expect(
      purchaseDraftRowCommitRequestSchema.safeParse({
        ...row,
        expectedVersion: undefined,
      }).success,
    ).toBe(false);
    expect(
      purchaseDraftRowCommitRequestSchema.safeParse({
        ...row,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);
  });

  it("makes pricing-mode locking structural at the wire boundary", () => {
    const shared = {
      costFils: "80000",
      enteredQuantity: "1",
      expectedVersion: "1",
      expiryDate: null,
      idempotencyKey: COMMAND_ID,
      itemId: "018f9999-9999-7999-8999-999999999999",
      lotNumber: null,
      notes: null,
      unit: { kind: "inventory-unit" },
    } as const;
    expect(
      purchaseDraftRowCommitRequestSchema.safeParse({
        ...shared,
        pricing: {
          marginPercentage: "20",
          method: "by-price",
          retailPriceFils: "100000",
        },
      }).success,
    ).toBe(false);
    expect(
      purchaseDraftRowCommitRequestSchema.safeParse({
        ...shared,
        pricing: {
          marginPercentage: "20",
          method: "by-percentage",
          retailPriceFils: "100000",
        },
      }).success,
    ).toBe(false);
  });

  it("requires every configured column once and keeps Item visible", () => {
    const preferences = {
      afterCommit: "new-row",
      columns: [
        { field: "item", visible: true },
        { field: "quantity", visible: true },
        { field: "cost", visible: true },
        { field: "selling-price", visible: false },
        { field: "expiry", visible: true },
      ],
      detailsPanelFields: ["packaging", "wholesale-price"],
      revision: "1",
    } as const;
    expect(purchaseEntryPreferencesSchema.parse(preferences)).toEqual(
      preferences,
    );
    expect(
      purchaseEntryPreferencesSchema.safeParse({
        ...preferences,
        columns: preferences.columns.map((column) =>
          column.field === "item" ? { ...column, visible: false } : column,
        ),
      }).success,
    ).toBe(false);
  });

  it("requires an effective date on every supplier default", () => {
    expect(
      supplierCreateRequestSchema.parse({
        allowanceEffectiveFrom: "2026-01-01",
        defaultAllowancePercentage: "3.25",
        idempotencyKey: COMMAND_ID,
        name: "Al-Nahrain",
        terms: "Net 30",
      }),
    ).toMatchObject({ defaultAllowancePercentage: "3.25" });
  });
});
