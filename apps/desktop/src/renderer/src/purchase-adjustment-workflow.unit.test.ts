import type { PurchasePostedDetail } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as preferencesModule from "./preferences-provider";
import { PurchaseAdjustmentWorkflow } from "./purchase-adjustment-workflow";

const detail: PurchasePostedDetail = {
  invoiceOffer: {
    input: { mode: "none", value: "0" },
    ruleVersion: 1,
    basisFils: "0",
    offerFils: "0",
  },
  activeAdjustmentDrafts: [],
  activeReturnDrafts: [],
  adjustments: [],
  returns: [],
  allowanceFils: "8000",
  allowancePercentageSnapshot: "2.5",
  costAfterDiscountFils: "312000",
  costVisibility: "visible",
  canAdjust: true,
  canReturn: true,
  primarySupplierCostFils: "320000",
  id: "018fa000-0000-7000-8000-000000000001",
  invoiceDate: "2026-09-08",
  number: { series: "P", value: "1", year: 2026 },
  postedAt: "2026-09-08T10:00:00Z",
  postedBy: "018fa000-0000-7000-8000-000000000003",
  settlementContext: "debt",
  supplierId: "018fa000-0000-7000-8000-000000000002",
  supplierInvoiceNumber: "INV-9921",
  supplierNameSnapshot: "Al-Nahrain Medical",
  navigation: { previousId: null, nextId: null, position: 1, total: 1 },
  rows: [
    {
      allowanceFils: "8000",
      baseUnitsPerEnteredUnit: "1",
      batchId: "018fa000-0000-7000-8000-000000000006",
      costAfterDiscountFils: "312000",
      enteredQuantity: "4",
      expiryDate: "2028-12-31",
      id: "018fa000-0000-7000-8000-000000000004",
      inventoryUnitQuantity: "4",
      inventoryUnitName: "Strip",
      itemDisplayName: "Panadol Extra",
      itemId: "018fa000-0000-7000-8000-000000000005",
      linePrimarySupplierCostFils: "320000",
      lotNumber: "LOT-100",
      marginPercentage: null,
      movementId: "018fa000-0000-7000-8000-000000000007",
      notes: null,
      offerFils: "0",
      ordinal: 1,
      priceCapture: "by-price-propagated",
      pricingMethod: "by-price",
      primarySupplierCostFils: "80000",
      retailPriceFils: "120000",
      unit: { kind: "inventory-unit" },
    },
  ],
};
function render(
  locale: "en" | "ar",
  purchase = detail,
  onNewInvoice?: () => void,
) {
  vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
    locale,
    direction: locale === "ar" ? "rtl" : "ltr",
    theme: "light",
    setLocale: vi.fn(),
    setTheme: vi.fn(),
  });
  return renderToStaticMarkup(
    createElement(PurchaseAdjustmentWorkflow, {
      baseUrl: "http://127.0.0.1:4000",
      detail: purchase,
      navigation: purchase.navigation,
      leaveRequest: 0,
      onBack: vi.fn(),
      onPosted: vi.fn(),
      onDraftActive: vi.fn(),
      onNavigate: vi.fn(),
      onSearch: vi.fn(),
      onReturn: vi.fn(),
      onNewInvoice,
    }),
  );
}
describe("Adjustment actions and authoritative display", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(["en", "ar"] as const)(
    "renders saved gross, allowance and discounted facts distinctly in %s",
    (locale) => {
      const markup = render(locale);
      expect(markup).toContain("INV-9921");
      expect(markup).toContain("Al-Nahrain Medical");
      expect(markup).toContain(locale === "en" ? "IQD 320.000" : "٣٢٠٫٠٠٠ د.ع");
      expect(markup).toContain(locale === "en" ? "IQD 312.000" : "٣١٢٫٠٠٠ د.ع");
      expect(markup).toContain(locale === "en" ? "IQD 8.000" : "٨٫٠٠٠ د.ع");
      expect(markup).toContain(locale === "en" ? "Unavailable" : "غير متاح");
      for (const action of ["previous", "next", "search", "back"])
        expect(markup).toContain('data-adjustment-action="' + action + '"');
      expect(markup).not.toContain(
        locale === "en" ? "New invoice" : "فاتورة جديدة",
      );
      expect(markup).not.toContain("Supplier balance");
    },
  );
  it.each(["en", "ar"] as const)(
    "offers New only with an authorized creation operation in %s",
    (locale) => {
      expect(render(locale, detail, vi.fn())).toContain(
        'data-adjustment-action="new-invoice"',
      );
      expect(render(locale)).not.toContain(
        'data-adjustment-action="new-invoice"',
      );
    },
  );
  it("cannot turn redacted facts into zero or calculate them from rows", () => {
    const markup = render("en", {
      ...detail,
      allowanceFils: null,
      allowancePercentageSnapshot: null,
      primarySupplierCostFils: null,
      costAfterDiscountFils: null,
      costVisibility: "hidden-by-permission",
      invoiceOffer: null,
      rows: detail.rows.map((row) => ({
        ...row,
        linePrimarySupplierCostFils: null,
        primarySupplierCostFils: null,
        costAfterDiscountFils: null,
      })),
    });
    expect(markup).not.toContain("IQD 320.000");
    expect(markup).not.toContain("IQD 0.000");
    expect(markup).toContain("Unavailable");
  });
  it.each(["en", "ar"] as const)(
    "keeps a server-denied Adjustment route read-only in %s",
    (locale) => {
      const markup = render(locale, { ...detail, canAdjust: false });
      expect(markup).toContain('role="alert"');
      expect(markup).not.toContain('data-adjustment-action="save-review"');
      expect(markup).not.toContain("<input");
    },
  );
});
