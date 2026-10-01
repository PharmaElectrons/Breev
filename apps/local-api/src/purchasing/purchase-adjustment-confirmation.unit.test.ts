import { describe, expect, it } from "vitest";
import { purchaseAdjustmentConfirmationHash } from "./purchase-adjustment-confirmation.js";

function fixture(): Parameters<typeof purchaseAdjustmentConfirmationHash>[0] {
  const row = {
    baseUnitsPerEnteredUnit: "4",
    batchId: "batch-1",
    costFils: "9007199254740993",
    enteredQuantity: "4",
    expiryDate: "2029-05-31",
    inventoryUnitName: "Strip",
    inventoryUnitQuantity: "16",
    itemDisplayName: "Panadol Extra GSK",
    itemId: "item-1",
    lineageId: "row-1",
    lotNumber: "LOT-1",
    marginPercentage: null,
    notes: "Checked carton",
    ordinal: 1,
    originalRowId: "original-row-1",
    pricingMethod: "by-price" as const,
    retailPriceFils: "10000000000000000",
    unit: { kind: "package-unit" as const, packageUnitName: "Pack" },
  };
  return {
    pharmacyId: "pharmacy-1",
    draft: {
      id: "draft-1",
      version: "2",
      originalPurchaseId: "original-1",
      invoiceDate: "2026-09-30",
      settlementContext: "debt",
      allowancePercentageSnapshot: "2.5",
      invoiceOffer: { mode: "none", value: "0" },
      offerRuleVersion: 1,
      reason: "quantity error",
      evidence: "Final supplier evidence",
      supplierId: "supplier-1",
      supplierNameSnapshot: "Al-Nahrain",
      supplierInvoiceNumber: "INV-1",
    },
    savedRows: [row],
    original: { id: "original-1", rows: [{ ...row }] },
    current: {
      correctionVersion: "0",
      header: { supplierId: "supplier-1" },
      rows: [{ ...row }],
    },
    inventory: [
      {
        batchId: "batch-1",
        quantity: "16",
        status: "active",
        movementCount: "1",
      },
    ],
    preview: {
      offerDeltaFils: "0",
      offerComparison: {
        before: {
          input: { mode: "none", value: "0" },
          ruleVersion: 1,
          basisFils: "0",
          offerFils: "0",
        },
        after: {
          input: { mode: "none", value: "0" },
          ruleVersion: 1,
          basisFils: "0",
          offerFils: "0",
        },
      },
      totalsComparison: {
        before: {
          offerFils: "0",
          primarySupplierCostFils: "4000",
          allowanceFils: "100",
          costAfterDiscountFils: "3900",
        },
        after: {
          offerFils: "0",
          primarySupplierCostFils: "8000",
          allowanceFils: "200",
          costAfterDiscountFils: "7800",
        },
      },
      allowanceDeltaFils: "100",
      costAfterDiscountDeltaFils: "3900",
      draftId: "draft-1",
      draftVersion: "2",
      evidence: "Final supplier evidence",
      reason: "quantity error",
      headerChanges: [],
      headerComparison: {
        before: {
          supplierId: "supplier-1",
          supplierNameSnapshot: "Al-Nahrain",
          supplierInvoiceNumber: "INV-1",
        },
        after: {
          supplierId: "supplier-1",
          supplierNameSnapshot: "Al-Nahrain",
          supplierInvoiceNumber: "INV-1",
        },
      },
      warnings: [],
      primarySupplierCostDeltaFils: "4000",
      quantityDelta: "4",
      rowDeltas: [],
      rowTotals: [],
      stockEffects: [],
      supplierEffects: [],
    },
  };
}

describe("Adjustment authoritative confirmation", () => {
  it("is deterministic across object property order and process reconstruction", () => {
    const input = fixture();
    const restored = JSON.parse(JSON.stringify(input)) as ReturnType<
      typeof fixture
    >;
    Object.assign(restored, {
      draft: Object.fromEntries(Object.entries(restored.draft).reverse()),
    });
    expect(purchaseAdjustmentConfirmationHash(restored)).toBe(
      purchaseAdjustmentConfirmationHash(input),
    );
    expect(purchaseAdjustmentConfirmationHash(input)).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });
  it("binds readable header snapshots and duplicate warnings as preview facts", () => {
    const original = fixture();
    const renamed = fixture();
    renamed.preview.headerComparison.after.supplierNameSnapshot =
      "Corrected supplier";
    expect(purchaseAdjustmentConfirmationHash(renamed)).not.toBe(
      purchaseAdjustmentConfirmationHash(original),
    );
    const warning = fixture();
    warning.preview.warnings.push({
      code: "duplicate-supplier-invoice-number",
      operationalRule: "warn-open-decision",
      existingPostingIds: ["purchase-2"],
    });
    expect(purchaseAdjustmentConfirmationHash(warning)).not.toBe(
      purchaseAdjustmentConfirmationHash(original),
    );
  });

  it("binds exact totals to the confirmation", () => {
    const input = fixture();
    const changed = fixture();
    changed.preview.totalsComparison.after.allowanceFils = "201";
    expect(purchaseAdjustmentConfirmationHash(changed)).not.toBe(
      purchaseAdjustmentConfirmationHash(input),
    );
  });

  it.each([
    [
      "pharmacy",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value, { pharmacyId: "pharmacy-2" });
      },
    ],
    ...[
      "id",
      "version",
      "originalPurchaseId",
      "invoiceDate",
      "allowancePercentageSnapshot",
      "evidence",
      "supplierId",
      "supplierNameSnapshot",
      "supplierInvoiceNumber",
    ].map(
      (key) =>
        [
          `saved ${key}`,
          (value: ReturnType<typeof fixture>) => {
            Object.assign(value.draft, { [key]: "changed" });
          },
        ] as const,
    ),
    [
      "reason",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.draft, { reason: "other" });
      },
    ],
    [
      "settlement",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.draft, { settlementContext: "cash" });
      },
    ],
    [
      "null evidence",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.draft, { evidence: null });
      },
    ],
    ...[
      "costFils",
      "enteredQuantity",
      "expiryDate",
      "lotNumber",
      "notes",
      "retailPriceFils",
      "itemId",
      "lineageId",
      "originalRowId",
      "inventoryUnitQuantity",
      "baseUnitsPerEnteredUnit",
      "itemDisplayName",
    ].map(
      (key) =>
        [
          `unchanged-row ${key}`,
          (value: ReturnType<typeof fixture>) => {
            Object.assign(value.savedRows[0]!, { [key]: "changed" });
          },
        ] as const,
    ),
    [
      "unit",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.savedRows[0]!, {
          unit: { kind: "inventory-unit" },
        });
      },
    ],
    [
      "original",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value, { original: { id: "original-2" } });
      },
    ],
    [
      "correction revision",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value, {
          current: { ...value.current, correctionVersion: "1" },
        });
      },
    ],
    [
      "batch balance",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value, {
          inventory: [{ ...value.inventory[0], quantity: "15" }],
        });
      },
    ],
    [
      "movement revision",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value, {
          inventory: [{ ...value.inventory[0], movementCount: "3" }],
        });
      },
    ],
    [
      "batch safety",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value, {
          inventory: [{ ...value.inventory[0], status: "quarantined" }],
        });
      },
    ],
    [
      "offer input",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.draft, {
          invoiceOffer: { mode: "percentage", value: "5" },
        });
      },
    ],
    [
      "offer rule",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.draft, { offerRuleVersion: 2 });
      },
    ],
    [
      "offer result",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.preview, { offerDeltaFils: "1" });
      },
    ],
    [
      "exact effect",
      (value: ReturnType<typeof fixture>) => {
        Object.assign(value.preview, { primarySupplierCostDeltaFils: "4001" });
      },
    ],
  ] as const)(
    "binds %s even when displayed row Deltas are unchanged",
    (_name, mutate) => {
      const input = fixture();
      const before = purchaseAdjustmentConfirmationHash(input);
      mutate(input);
      expect(purchaseAdjustmentConfirmationHash(input)).not.toBe(before);
    },
  );
});
