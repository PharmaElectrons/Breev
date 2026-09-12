import { describe, expect, it } from "vitest";
import {
  PURCHASE_POSTING_ACCOUNT_CODES,
  PURCHASE_ADJUSTMENT_REASONS,
  PURCHASING_CONTRACTS,
  allowancePercentageSchema,
  purchaseAdjustmentDraftCreateRequestSchema,
  purchaseAdjustmentDraftSchema,
  purchaseAdjustmentPostRequestSchema,
  purchaseAdjustmentSummarySchema,
  purchaseReturnDraftCreateRequestSchema,
  purchaseReturnDraftSchema,
  purchaseReturnPostRequestSchema,
  purchaseReturnSummarySchema,
  postedPurchaseReturnSchema,
  purchasePostedDetailSchema,
  purchasePostedListRequestSchema,
  purchasePostedListResponseSchema,
  purchasePostedPath,
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
    expect(PURCHASING_CONTRACTS).toHaveLength(31);
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
      "inventory-count-variance",
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

  it("keeps posted purchase facts read-only while allowing linked drafts", () => {
    const reviewContracts = PURCHASING_CONTRACTS.filter((contract) =>
      contract.path.startsWith("/purchases/posted"),
    );
    expect(reviewContracts.map((contract) => contract.method)).toEqual([
      "GET",
      "GET",
      "POST",
      "GET",
      "GET",
      "POST",
    ]);
    expect(reviewContracts.map((contract) => contract.method)).not.toContain(
      "PUT",
    );
    expect(purchasePostedPath(POSTING_ID)).toBe(
      `/purchases/posted/${POSTING_ID}`,
    );
  });

  it("rejects transformed or unknown posted purchase search input", () => {
    expect(
      purchasePostedListRequestSchema.parse({
        direction: "descending",
        from: "2026-01-01",
        query: "INV-100",
        sort: "number",
        to: "2026-12-31",
      }),
    ).toEqual({
      direction: "descending",
      from: "2026-01-01",
      query: "INV-100",
      sort: "number",
      to: "2026-12-31",
    });
    expect(
      purchasePostedListRequestSchema.safeParse({ query: " INV-100 " }).success,
    ).toBe(false);
    expect(
      purchasePostedListRequestSchema.safeParse({ extra: "unsupported" })
        .success,
    ).toBe(false);
    expect(
      purchasePostedListRequestSchema.safeParse({
        from: "2026-12-31",
        to: "2026-01-01",
      }).success,
    ).toBe(false);
  });

  it("makes server-side cost visibility structural in posted review", () => {
    const posted = postedPurchase();
    const listItem = {
      costAfterDiscountFils: posted.costAfterDiscountFils,
      id: posted.id,
      invoiceDate: posted.invoiceDate,
      itemCount: posted.rows.length,
      number: posted.number,
      postedAt: posted.postedAt,
      primarySupplierCostFils: posted.primarySupplierCostFils,
      settlementContext: posted.settlementContext,
      supplierInvoiceNumber: posted.supplierInvoiceNumber,
      supplierNameSnapshot: posted.supplierNameSnapshot,
    } as const;
    expect(
      purchasePostedListResponseSchema.parse({
        costVisibility: "visible",
        purchases: [listItem],
      }).purchases,
    ).toHaveLength(1);
    expect(
      purchasePostedListResponseSchema.safeParse({
        costVisibility: "hidden-by-permission",
        purchases: [listItem],
      }).success,
    ).toBe(false);
    expect(
      purchasePostedListResponseSchema.parse({
        costVisibility: "hidden-by-permission",
        purchases: [
          {
            ...listItem,
            costAfterDiscountFils: null,
            primarySupplierCostFils: null,
          },
        ],
      }).purchases[0],
    ).toMatchObject({
      costAfterDiscountFils: null,
      primarySupplierCostFils: null,
    });
  });

  it("validates an immutable posted detail snapshot without live master fields", () => {
    const posted = postedPurchase();
    const detail = {
      activeAdjustmentDrafts: [],
      activeReturnDrafts: [],
      adjustments: [],
      allowanceFils: posted.allowanceFils,
      allowancePercentageSnapshot: posted.allowanceSnapshot.percentage,
      costAfterDiscountFils: posted.costAfterDiscountFils,
      costVisibility: "visible",
      canAdjust: true,
      canReturn: true,
      id: posted.id,
      invoiceDate: posted.invoiceDate,
      navigation: {
        nextId: null,
        position: 1,
        previousId: null,
        total: 1,
      },
      number: posted.number,
      postedAt: posted.postedAt,
      postedBy: posted.postedBy,
      primarySupplierCostFils: posted.primarySupplierCostFils,
      returns: [],
      rows: posted.rows.map((row) => ({
        baseUnitsPerEnteredUnit: row.baseUnitsPerEnteredUnit,
        costAfterDiscountFils: row.costAfterDiscountFils,
        enteredQuantity: row.enteredQuantity,
        expiryDate: row.expiryDate,
        id: row.id,
        inventoryUnitName: row.inventoryUnitName,
        inventoryUnitQuantity: row.inventoryUnitQuantity,
        itemDisplayName: row.itemDisplayName,
        itemId: row.itemId,
        linePrimarySupplierCostFils: row.linePrimarySupplierCostFils,
        lotNumber: row.lotNumber,
        ordinal: row.ordinal,
        primarySupplierCostFils: row.primarySupplierCostFils,
        retailPriceFils: row.retailPriceFils,
        unit: row.unit,
      })),
      settlementContext: posted.settlementContext,
      supplierId: posted.supplierId,
      supplierInvoiceNumber: posted.supplierInvoiceNumber,
      supplierNameSnapshot: posted.supplierNameSnapshot,
    } as const;
    expect(purchasePostedDetailSchema.parse(detail)).toEqual(detail);
    expect(
      purchasePostedDetailSchema.safeParse({
        ...detail,
        costVisibility: "hidden-by-setting",
      }).success,
    ).toBe(false);
  });

  it("stores return carrying amount and supplier reduction as distinct exact values", () => {
    const draft = {
      createdAt: "2026-06-16T09:00:00.000Z",
      evidence: "Supplier collection note 44",
      id: DRAFT_ID,
      originalInvoiceDate: "2026-06-15",
      originalNumber: { series: "P", value: "1", year: 2026 },
      originalPurchaseId: POSTING_ID,
      reason: "Damaged packaging",
      rows: [
        {
          batchId: BATCH_ID,
          id: "018fa000-0000-7000-8000-000000000010",
          inventoryUnitName: "Strip",
          itemDisplayName: "Panadol Extra 500 mg tablet GSK",
          itemId: "018fa000-0000-7000-8000-00000000000b",
          originalPurchaseRowId: ROW_ID,
          originalQuantity: "8",
          previouslyReturnedQuantity: "0",
          remainingEligibleQuantity: "8",
          returnQuantity: "3",
        },
      ],
      status: "active",
      supplierId: SUPPLIER_ID,
      supplierNameSnapshot: "Al-Nahrain",
      updatedAt: "2026-06-16T09:00:00.000Z",
      version: "1",
    } as const;
    expect(purchaseReturnDraftSchema.parse(draft)).toEqual(draft);
    expect(
      purchaseReturnDraftCreateRequestSchema.safeParse({
        evidence: "",
        idempotencyKey: COMMAND_ID,
        reason: "Damaged packaging",
      }).success,
    ).toBe(false);

    const summary = {
      confirmationHash: "a".repeat(64),
      draftId: DRAFT_ID,
      draftVersion: "1",
      inventoryCarryingAmountFils: "54000",
      rows: [
        {
          batchId: BATCH_ID,
          carryingAmountFils: "54000",
          carryingAmountPerUnitScaled: "18000000000",
          inventoryUnitName: "Strip",
          itemDisplayName: "Panadol Extra 500 mg tablet GSK",
          itemId: "018fa000-0000-7000-8000-00000000000b",
          originalPurchaseRowId: ROW_ID,
          quantity: "3",
          supplierReductionFils: "60000",
          valuationMethod: "weighted-average-cost",
        },
      ],
      supplierReductionFils: "60000",
    } as const;
    expect(purchaseReturnSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.inventoryCarryingAmountFils).not.toBe(
      summary.supplierReductionFils,
    );
    expect(
      purchaseReturnPostRequestSchema.parse({
        confirmationHash: summary.confirmationHash,
        expectedVersion: "1",
        idempotencyKey: COMMAND_ID,
        stepUpChallengeId: "018fa000-0000-7000-8000-00000000000c",
      }),
    ).toBeDefined();

    const postedReturn = {
      approvalChallengeId: "018fa000-0000-7000-8000-00000000000c",
      deviceId: "018fa000-0000-7000-8000-00000000000d",
      draftId: DRAFT_ID,
      evidence: draft.evidence,
      id: "018fa000-0000-7000-8000-00000000000e",
      inventoryCarryingAmountFils: "54000",
      journal: {
        entryId: JOURNAL_ID,
        lines: [
          {
            accountCode: "supplier-payable",
            creditFils: "0",
            debitFils: "60000",
            ordinal: 1,
            supplierId: SUPPLIER_ID,
          },
          {
            accountCode: "inventory",
            creditFils: "54000",
            debitFils: "0",
            ordinal: 2,
            supplierId: null,
          },
          {
            accountCode: "inventory",
            creditFils: "6000",
            debitFils: "0",
            ordinal: 3,
            supplierId: null,
          },
        ],
        templateId: "purchase.return",
        templateVersion: 1,
        treatment: "inventory-account-offset-pending-g01",
      },
      number: { series: "PR", value: "1", year: 2026 },
      originalInvoiceDate: draft.originalInvoiceDate,
      originalNumber: draft.originalNumber,
      originalPurchaseId: POSTING_ID,
      postedAt: "2026-06-16T09:01:00.000Z",
      postedBy: "018fa000-0000-7000-8000-00000000000a",
      reason: draft.reason,
      rows: [
        {
          ...summary.rows[0],
          id: "018fa000-0000-7000-8000-00000000000f",
          movementId: MOVEMENT_ID,
        },
      ],
      supplierId: SUPPLIER_ID,
      supplierNameSnapshot: draft.supplierNameSnapshot,
      supplierReductionFils: "60000",
    } as const;
    expect(postedPurchaseReturnSchema.parse(postedReturn)).toEqual(
      postedReturn,
    );
  });

  it("publishes exactly the five mandatory adjustment reasons", () => {
    expect(PURCHASE_ADJUSTMENT_REASONS).toEqual([
      "quantity error",
      "price error",
      "invoice-number error",
      "supplier error",
      "other",
    ]);
    expect(
      purchaseAdjustmentDraftCreateRequestSchema.safeParse({
        evidence: null,
        idempotencyKey: COMMAND_ID,
      }).success,
    ).toBe(false);
    expect(
      purchaseAdjustmentDraftCreateRequestSchema.safeParse({
        evidence: null,
        idempotencyKey: COMMAND_ID,
        reason: "return",
      }).success,
    ).toBe(false);
  });

  it("validates durable adjustment drafts, signed summaries, and confirmation", () => {
    const snapshot = {
      baseUnitsPerEnteredUnit: "1",
      batchId: BATCH_ID,
      costFils: "1000",
      enteredQuantity: "8",
      expiryDate: "2028-10-31",
      inventoryUnitName: "Strip",
      inventoryUnitQuantity: "8",
      itemDisplayName: "Panadol",
      itemId: "018fa000-0000-7000-8000-00000000000b",
      lineageId: ROW_ID,
      lotNumber: "LOT-49",
      marginPercentage: null,
      notes: null,
      ordinal: 1,
      originalRowId: ROW_ID,
      pricingMethod: "by-price",
      retailPriceFils: "1200",
      unit: { kind: "inventory-unit" },
    } as const;
    expect(
      purchaseAdjustmentDraftSchema.parse({
        allowancePercentageSnapshot: "2.5",
        createdAt: "2026-06-15T09:00:00.000Z",
        evidence: null,
        id: DRAFT_ID,
        invoiceDate: "2026-06-15",
        originalNumber: { series: "P", value: "1", year: 2026 },
        originalPurchaseId: POSTING_ID,
        reason: "quantity error",
        rows: [{ ...snapshot, id: ROW_ID }],
        settlementContext: "debt",
        status: "active",
        supplierId: SUPPLIER_ID,
        supplierInvoiceNumber: "INV-100",
        supplierNameSnapshot: "Al-Nahrain",
        updatedAt: "2026-06-15T09:01:00.000Z",
        version: "1",
      }).rows,
    ).toHaveLength(1);
    expect(
      purchaseAdjustmentSummarySchema.parse({
        allowanceDeltaFils: "-100",
        confirmationHash: "a".repeat(64),
        costAfterDiscountDeltaFils: "3900",
        draftId: DRAFT_ID,
        draftVersion: "2",
        headerChanges: [],
        primarySupplierCostDeltaFils: "4000",
        quantityDelta: "4",
        rowDeltas: [
          {
            after: snapshot,
            before: {
              ...snapshot,
              enteredQuantity: "4",
              inventoryUnitQuantity: "4",
            },
            changes: [{ after: "8", before: "4", field: "entered-quantity" }],
            kind: "changed",
            lineageId: ROW_ID,
            primarySupplierCostDeltaFils: "4000",
            quantityDelta: "4",
          },
        ],
        stockEffects: [
          {
            batchId: BATCH_ID,
            itemDisplayName: "Panadol",
            itemId: snapshot.itemId,
            primarySupplierCostDeltaFils: "4000",
            quantityDelta: "4",
          },
        ],
        supplierEffects: [
          {
            deltaFils: "4000",
            supplierId: SUPPLIER_ID,
            supplierNameSnapshot: "Al-Nahrain",
          },
        ],
      }).quantityDelta,
    ).toBe("4");
    expect(
      purchaseAdjustmentPostRequestSchema.safeParse({
        expectedVersion: "2",
        idempotencyKey: COMMAND_ID,
      }).success,
    ).toBe(false);
    expect(
      purchasingDenialSchema.parse({
        code: "adjustment-batch-conflict",
        fieldErrors: [
          {
            code: "invalid",
            path: ["rows"],
            rule: "purchase.adjustment.batch-insufficient",
          },
        ],
        requestId: POSTING_ID,
        status: "denied",
      }).fieldErrors[0]?.rule,
    ).toBe("purchase.adjustment.batch-insufficient");
  });
});
