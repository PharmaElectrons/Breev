import { describe, expect, it } from "vitest";
import {
  PURCHASING_CONTRACTS,
  allowancePercentageSchema,
  purchaseDraftCreateRequestSchema,
  purchaseDraftDiscardRequestSchema,
  purchaseDraftResultSchema,
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
    expect(PURCHASING_CONTRACTS).toHaveLength(10);
    expect(
      PURCHASING_CONTRACTS.every((contract) => contract.method !== "DELETE"),
    ).toBe(true);
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
