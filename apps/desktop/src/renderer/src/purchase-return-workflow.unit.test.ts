import type { PurchasePostedDetail } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as preferencesModule from "./preferences-provider";
import { PurchaseReturnWorkflow } from "./purchase-return-workflow";

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
    costAfterDiscountFils: "120000",
    discountAmountFils: "0",
    discountPercentage: "0",
    grandTotalCostFils: "120000",
    id: "018fa000-0000-7000-8000-000000000010",
    invoiceDate: "2026-09-08",
    number: { series: "P", value: "000010", year: 2026 },
    paidAmountFils: "120000",
    postedAt: "2026-09-08T10:00:00Z",
    primarySupplierCostFils: "120000",
    returns: [],
    rows: [
      {
        costAfterDiscountFils: "120000",
        enteredQuantity: "3",
        expiryDate: "2028-12-31",
        id: "row-1",
        inventoryQuantity: "3",
        itemDisplayName: "Amoxicillin 500mg",
        itemId: "prod-2",
        lineageId: "lineage-2",
        lotNumber: "LOT-200",
        notes: null,
        primarySupplierCostFils: "40000",
        retailPriceFils: "60000",
        unit: { inventoryUnitName: "شريط", kind: "inventory-unit" },
      },
    ],
    settlementContext: "debt",
    supplierId: "018fa000-0000-7000-8000-000000000002",
    supplierInvoiceNumber: "INV-5512",
    supplierNameSnapshot: "Babylon Pharma",
    version: 1,
    ...overrides,
  } as unknown as PurchasePostedDetail;
}

describe("PurchaseReturnWorkflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders initial start stage with reason and evidence inputs in Arabic", () => {
    mockPreferences("ar");
    const detail = buildMockDetail();
    const markup = renderToStaticMarkup(
      createElement(PurchaseReturnWorkflow, {
        baseUrl: "http://127.0.0.1:4000",
        detail,
        leaveRequest: 0,
        onBack: vi.fn(),
        onDraftActive: vi.fn(),
        onPosted: vi.fn(),
      }),
    );

    expect(markup).toContain("مردود شراء · بضاعة تغادر المخزون فعلياً");
    expect(markup).toContain("سبب المردود");
    expect(markup).toContain("دليل التصرف بالبضاعة");
    expect(markup).toContain("إنشاء مردود شراء");
    expect(markup).toContain("العودة إلى الفاتورة الأصلية");
  });

  it("renders initial start stage with reason and evidence inputs in English", () => {
    mockPreferences("en");
    const detail = buildMockDetail();
    const markup = renderToStaticMarkup(
      createElement(PurchaseReturnWorkflow, {
        baseUrl: "http://127.0.0.1:4000",
        detail,
        leaveRequest: 0,
        onBack: vi.fn(),
        onDraftActive: vi.fn(),
        onPosted: vi.fn(),
      }),
    );

    expect(markup).toContain("Purchase Return · goods physically leave stock");
    expect(markup).toContain("Return reason");
    expect(markup).toContain("Disposition evidence");
    expect(markup).toContain("Create Purchase Return");
    expect(markup).toContain("Back to original invoice");
  });
});
