import type { PurchasePostedDetail } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as preferencesModule from "./preferences-provider";
import { PurchaseAdjustmentWorkflow } from "./purchase-adjustment-workflow";

function mockPreferences(locale: "ar" | "en" = "ar"): void {
  vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
    direction: locale === "ar" ? "rtl" : "ltr",
    locale,
    setLocale: vi.fn(),
    setTheme: vi.fn(),
    theme: "light",
  });
}

function buildMockDetail(
  overrides: Partial<PurchasePostedDetail> = {},
): PurchasePostedDetail {
  return {
    activeAdjustmentDrafts: [],
    activeReturnDrafts: [],
    adjustments: [],
    costAfterDiscountFils: "80000",
    discountAmountFils: "0",
    discountPercentage: "0",
    grandTotalCostFils: "80000",
    id: "018fa000-0000-7000-8000-000000000001",
    invoiceDate: "2026-09-08",
    number: { series: "P", value: "000001", year: 2026 },
    paidAmountFils: "80000",
    postedAt: "2026-09-08T10:00:00Z",
    primarySupplierCostFils: "80000",
    returns: [],
    rows: [
      {
        costAfterDiscountFils: "80000",
        enteredQuantity: "2",
        expiryDate: "2028-12-31",
        id: "row-1",
        inventoryQuantity: "2",
        itemDisplayName: "Panadol Extra",
        itemId: "prod-1",
        lineageId: "lineage-1",
        lotNumber: "LOT-100",
        notes: null,
        primarySupplierCostFils: "40000",
        retailPriceFils: "50000",
        unit: { inventoryUnitName: "شريط", kind: "inventory-unit" },
      },
    ],
    settlementContext: "debt",
    supplierId: "018fa000-0000-7000-8000-000000000002",
    supplierInvoiceNumber: "INV-9921",
    supplierNameSnapshot: "Al-Nahrain Medical",
    version: 1,
    ...overrides,
  } as unknown as PurchasePostedDetail;
}

describe("PurchaseAdjustmentWorkflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders initial start stage with clean original invoice number and supplier snapshot", () => {
    mockPreferences("ar");
    const detail = buildMockDetail();
    const markup = renderToStaticMarkup(
      createElement(PurchaseAdjustmentWorkflow, {
        baseUrl: "http://127.0.0.1:4000",
        detail,
        leaveRequest: 0,
        onBack: vi.fn(),
        onDraftActive: vi.fn(),
        onPosted: vi.fn(),
      }),
    );

    expect(markup).toContain("تعديل فاتورة شراء");
    expect(markup).toContain("INV-9921");
    expect(markup).toContain("Al-Nahrain Medical");
    expect(markup).toContain("إنشاء نسخة التعديل");
    expect(markup).toContain("Panadol Extra");
    // M2 has no Supplier Statement/debt projection, so the Adjustment must not
    // fabricate a balance from Purchase invoices.
    expect(markup).not.toContain("— د.ع");
    expect(markup).not.toContain("ديون المورد");
  });

  it("renders totals section with localized keys and zero placeholder dashes in Arabic", () => {
    mockPreferences("ar");
    const detail = buildMockDetail();
    const markup = renderToStaticMarkup(
      createElement(PurchaseAdjustmentWorkflow, {
        baseUrl: "http://127.0.0.1:4000",
        detail,
        leaveRequest: 0,
        onBack: vi.fn(),
        onDraftActive: vi.fn(),
        onPosted: vi.fn(),
      }),
    );

    expect(markup).toContain("مجموع الكلفة");
    expect(markup).toContain("إضافة مصاريف للفاتورة");
    expect(markup).toContain("خصم %");
    expect(markup).toContain("خصم مبلغ");
    expect(markup).toContain("بعد الخصم");
    expect(markup).toContain("الإجمالي الباقي");
    expect(markup).toContain("إجمالي الراجع");
    expect(markup).toContain("حفظ ومراجعة الفرق");
  });

  it("renders totals and bottom toolbar cleanly in English LTR without hardcoded Arabic", () => {
    mockPreferences("en");
    const detail = buildMockDetail();
    const markup = renderToStaticMarkup(
      createElement(PurchaseAdjustmentWorkflow, {
        baseUrl: "http://127.0.0.1:4000",
        detail,
        leaveRequest: 0,
        onBack: vi.fn(),
        onDraftActive: vi.fn(),
        onPosted: vi.fn(),
      }),
    );

    expect(markup).toContain("Purchase Invoice Adjustment");
    expect(markup).toContain("Total cost");
    expect(markup).toContain("Invoice expenses");
    expect(markup).toContain("Disc %");
    expect(markup).toContain("Disc amount");
    expect(markup).toContain("After discount");
    expect(markup).toContain("Remaining total");
    expect(markup).toContain("Total returned");
    expect(markup).toContain("Save and review Delta");
    expect(markup).toContain("Search invoice");
    expect(markup).toContain("New invoice");
    expect(markup).toContain("Previous &gt;");
  });
});
