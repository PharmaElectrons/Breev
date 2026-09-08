import { describe, expect, it } from "vitest";
import {
  PURCHASE_POSTING_ACCOUNT_CODES,
  PURCHASING_CONTRACTS,
  allowancePercentageSchema,
  postedPurchaseJournalSchema,
  postedPurchaseSchema,
  purchaseDraftCreateRequestSchema,
  purchaseDraftDiscardRequestSchema,
  purchaseDraftPostingsPath,
  purchaseDraftRowCommitRequestSchema,
  purchaseDraftResultSchema,
  purchaseDraftSchema,
  purchaseEntryPreferencesSchema,
  purchasePostRequestSchema,
  purchasePostResultSchema,
  purchasingDenialSchema,
  supplierCreateRequestSchema,
} from "./index.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "018f7777-7777-7777-8777-777777777777";
const DRAFT_ID = "018f8888-8888-7888-8888-888888888888";
const POSTING_ID = "018fa000-0000-7000-8000-000000000001";
const ROW_ID = "018fa000-0000-7000-8000-000000000002";
const BATCH_ID = "018fa000-0000-7000-8000-000000000003";
const MOVEMENT_ID = "018fa000-0000-7000-8000-000000000004";
const JOURNAL_ID = "018fa000-0000-7000-8000-000000000005";

function postedPurchase() {
  return {
    allowanceFils: "4000",
    allowanceSnapshot: { basisFils: "160000", percentage: "2.5" },
    costAfterDiscountFils: "156000",
    draftId: DRAFT_ID,
    id: POSTING_ID,
    invoiceDate: "2026-06-15",
    journal: {
      entryId: JOURNAL_ID,
      lines: [
        {
          accountCode: "inventory",
          creditFils: "0",
          debitFils: "160000",
          ordinal: 1,
          supplierId: null,
        },
        {
          accountCode: "supplier-payable",
          creditFils: "160000",
          debitFils: "0",
          ordinal: 2,
          supplierId: SUPPLIER_ID,
        },
      ],
      templateId: "purchase.invoice",
      templateVersion: 1,
    },
    number: { series: "P", value: "1", year: 2026 },
    postedAt: "2026-06-15T09:00:00.000Z",
    postedBy: "018fa000-0000-7000-8000-00000000000a",
    primarySupplierCostFils: "160000",
    rows: [
      {
        baseUnitsPerEnteredUnit: "4",
        batchId: BATCH_ID,
        costAfterDiscountFils: "156000",
        enteredQuantity: "2",
        expiryDate: "2028-10-31",
        id: ROW_ID,
        inventoryUnitName: "Strip",
        inventoryUnitQuantity: "8",
        itemDisplayName: "Panadol Extra 500 mg tablet GSK",
        itemId: "018fa000-0000-7000-8000-00000000000b",
        linePrimarySupplierCostFils: "160000",
        lotNumber: "LOT-49",
        marginPercentage: null,
        movementId: MOVEMENT_ID,
        notes: null,
        ordinal: 1,
        priceCapture: "by-price-propagated",
        pricingMethod: "by-price",
        primarySupplierCostFils: "80000",
        retailPriceFils: "120000",
        unit: { kind: "package-unit", packageUnitName: "Pack" },
      },
    ],
    settlementContext: "debt",
    settlementEffect: { context: "debt", payableFils: "160000" },
    supplierId: SUPPLIER_ID,
    supplierInvoiceNumber: "INV-100",
    supplierNameSnapshot: "Al-Nahrain",
  } as const;
}

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

  it("has no supplier, draft, or posting hard-delete route", () => {
    expect(PURCHASING_CONTRACTS).toHaveLength(14);
    expect(
      PURCHASING_CONTRACTS.map((contract) => contract.method),
    ).not.toContain("DELETE");
    expect(PURCHASING_CONTRACTS.map((contract) => contract.method)).not.toEqual(
      expect.arrayContaining(["PATCH"]),
    );
    expect(purchaseDraftPostingsPath(DRAFT_ID)).toBe(
      `/purchases/drafts/${DRAFT_ID}/postings`,
    );
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

  it("lets the post command carry nothing the draft already owns", () => {
    const request = {
      expectedVersion: "7",
      idempotencyKey: COMMAND_ID,
    } as const;
    expect(purchasePostRequestSchema.parse(request)).toEqual(request);
    for (const restated of [
      { costFils: "80000" },
      { primarySupplierCostFils: "160000" },
      { supplierId: SUPPLIER_ID },
    ]) {
      expect(
        purchasePostRequestSchema.safeParse({ ...request, ...restated })
          .success,
      ).toBe(false);
    }
  });

  it("carries both cost values and keeps the valuation basis pre-discount", () => {
    const posted = postedPurchaseSchema.parse(postedPurchase());
    expect(posted.primarySupplierCostFils).toBe("160000");
    expect(posted.costAfterDiscountFils).toBe("156000");
    expect(
      BigInt(posted.primarySupplierCostFils) - BigInt(posted.allowanceFils),
    ).toBe(BigInt(posted.costAfterDiscountFils));
    // The frozen Carrying Amount is the pre-discount line value, never the
    // informational one.
    expect(posted.rows[0]?.linePrimarySupplierCostFils).toBe("160000");
  });

  it("keeps the supplier balance and the journal on the pre-discount basis", () => {
    const posted = postedPurchaseSchema.parse(postedPurchase());
    const settlement = posted.settlementEffect;
    expect(
      settlement.context === "debt"
        ? settlement.payableFils
        : settlement.tenderFils,
    ).toBe(posted.primarySupplierCostFils);
    const debits = posted.journal.lines.reduce(
      (total, line) => total + BigInt(line.debitFils),
      0n,
    );
    expect(debits).toBe(BigInt(posted.primarySupplierCostFils));
    // The informational cost is stored, but no line and no balance carries it.
    expect(posted.journal.lines.map((line) => line.creditFils)).not.toContain(
      posted.costAfterDiscountFils,
    );
  });

  it("has no account for an allowance the invoice never posts", () => {
    expect(PURCHASE_POSTING_ACCOUNT_CODES).toEqual([
      "cash",
      "inventory",
      "supplier-payable",
    ]);
    const posted = postedPurchase();
    expect(
      postedPurchaseJournalSchema.safeParse({
        ...posted.journal,
        lines: [
          { ...posted.journal.lines[0] },
          { ...posted.journal.lines[1], creditFils: "156000" },
          {
            accountCode: "supplier-allowance",
            creditFils: "4000",
            debitFils: "0",
            ordinal: 3,
            supplierId: SUPPLIER_ID,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("refuses an unbalanced journal at the wire boundary", () => {
    const balanced = postedPurchase().journal;
    expect(postedPurchaseJournalSchema.parse(balanced)).toEqual(balanced);
    expect(
      postedPurchaseJournalSchema.safeParse({
        ...balanced,
        lines: [
          { ...balanced.lines[0], debitFils: "159999" },
          balanced.lines[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      postedPurchaseJournalSchema.safeParse({
        ...balanced,
        lines: [
          { ...balanced.lines[0], creditFils: "160000" },
          balanced.lines[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      postedPurchaseJournalSchema.safeParse({
        ...balanced,
        lines: [balanced.lines[0]],
      }).success,
    ).toBe(false);
  });

  it("keeps every posted money value an exact decimal integer string", () => {
    expect(
      postedPurchaseSchema.safeParse({
        ...postedPurchase(),
        primarySupplierCostFils: 160_000,
      }).success,
    ).toBe(false);
    expect(
      postedPurchaseSchema.safeParse({
        ...postedPurchase(),
        costAfterDiscountFils: "156000.5",
      }).success,
    ).toBe(false);
  });

  it("warns rather than blocks on a duplicate supplier invoice number", () => {
    const result = purchasePostResultSchema.parse({
      posted: postedPurchase(),
      warnings: [
        {
          code: "duplicate-supplier-invoice-number",
          existingPostingIds: ["018fa000-0000-7000-8000-000000000009"],
          operationalRule: "warn-open-decision",
        },
      ],
    });
    expect(result.warnings[0]?.operationalRule).toBe("warn-open-decision");
    expect(
      purchasePostResultSchema.safeParse({
        posted: postedPurchase(),
        warnings: [],
      }).success,
    ).toBe(true);
  });

  it("names the failing field and the rule that refused it", () => {
    const denial = purchasingDenialSchema.parse({
      code: "expiry-required",
      fieldErrors: [
        {
          code: "required",
          path: ["rows", 2, "expiryDate"],
          rule: "purchase.post.expiry-required-at-receipt",
        },
      ],
      requestId: "018fa000-0000-7000-8000-00000000000c",
      status: "denied",
    });
    expect(denial.fieldErrors[0]?.rule).toBe(
      "purchase.post.expiry-required-at-receipt",
    );
    expect(
      purchasingDenialSchema.safeParse({
        code: "expiry-required",
        fieldErrors: [
          { code: "required", path: ["rows"], rule: "made.up.rule" },
        ],
        requestId: "018fa000-0000-7000-8000-00000000000c",
        status: "denied",
      }).success,
    ).toBe(false);
  });

  it("makes a posted draft a terminal status of its own", () => {
    expect(purchaseDraftSchema.shape.status.options).toEqual([
      "active",
      "discarded",
      "posted",
    ]);
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
