import type {
  PurchaseDraft,
  PurchasePostedListItem,
  Supplier,
} from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as preferencesModule from "./preferences-provider";
import * as purchasingApiModule from "./purchasing-api";
import { SuppliersWorkspace } from "./suppliers-workspace";

function mockPreferences(locale: "ar" | "en" = "ar"): void {
  vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
    direction: locale === "ar" ? "rtl" : "ltr",
    locale,
    setLocale: vi.fn(),
    setTheme: vi.fn(),
    theme: "light",
  });
}

const mockSupplier: Supplier = {
  allowanceEffectiveFrom: "2026-09-01",
  defaultAllowancePercentage: "5",
  id: "018f0000-0000-7000-8000-000000000001",
  mergedIntoSupplierId: null,
  name: "Al-Razi Scientific Bureau",
  revision: "1",
  status: "active",
  terms: JSON.stringify({
    address: "Baghdad - Al-Saadoun",
    alertWindowDays: 7,
    creditLimit: 50000,
    duePeriodDays: 30,
    paymentTerms: "credit",
    phone: "07700000000",
  }),
};

describe("SuppliersWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders workspace layout with suppliers list and empty transaction state when no posted purchases exist", () => {
    mockPreferences("ar");
    vi.spyOn(purchasingApiModule, "requestPostedPurchases").mockResolvedValue({
      costVisibility: "visible",
      purchases: [],
    });

    const markup = renderToStaticMarkup(
      createElement(SuppliersWorkspace, {
        baseUrl: "http://127.0.0.1:4000",
        suppliers: [mockSupplier],
        drafts: [],
        onChanged: vi.fn(async () => {}),
      }),
    );

    expect(markup).toContain("Al-Razi Scientific Bureau");
    expect(markup).toContain("تفاصيل حركة الفواتير");
    expect(markup).toContain("لا حركات لهذا المذخر.");
  });

  it("does not count unposted drafts as debt or transactions", () => {
    mockPreferences("ar");
    vi.spyOn(purchasingApiModule, "requestPostedPurchases").mockResolvedValue({
      costVisibility: "visible",
      purchases: [],
    });

    // An unposted draft exists for this supplier with 500,000 IQD debt
    const unpostedDraft: PurchaseDraft = {
      allowanceSnapshot: {
        basisFils: "500000000",
        percentage: "0",
      },
      createdAt: "2026-09-20T00:00:00.000Z",
      id: "018f0000-0000-7000-8000-000000000099",
      invoiceDate: "2026-09-20",
      settlementContext: "debt",
      status: "active",
      supplierId: mockSupplier.id,
      supplierInvoiceNumber: "DRAFT-UNPOSTED-99",
      supplierNameSnapshot: mockSupplier.name,
      updatedAt: "2026-09-20T00:00:00.000Z",
      version: "1",
    };

    const markup = renderToStaticMarkup(
      createElement(SuppliersWorkspace, {
        baseUrl: "http://127.0.0.1:4000",
        suppliers: [mockSupplier],
        drafts: [unpostedDraft], // Unposted draft passed
        onChanged: vi.fn(async () => {}),
      }),
    );

    // Unposted draft invoice number must NOT appear in the transaction ledger
    expect(markup).not.toContain("DRAFT-UNPOSTED-99");
    // Table shows empty transactions
    expect(markup).toContain("لا حركات لهذا المذخر.");
  });

  it("renders posted purchases in transaction ledger and correctly calculates debt balance", () => {
    mockPreferences("ar");
    const postedDebt: PurchasePostedListItem = {
      costAfterDiscountFils: "300000000",
      id: "018f0000-0000-7000-8000-000000000002",
      invoiceDate: "2026-09-15",
      itemCount: 3,
      number: { series: "P", value: "1", year: 2026 },
      postedAt: "2026-09-15T10:00:00.000Z",
      primarySupplierCostFils: "300000000",
      settlementContext: "debt",
      supplierInvoiceNumber: "INV-POSTED-001",
      supplierNameSnapshot: mockSupplier.name,
    };
    const postedCash: PurchasePostedListItem = {
      costAfterDiscountFils: "100000000",
      id: "018f0000-0000-7000-8000-000000000003",
      invoiceDate: "2026-09-16",
      itemCount: 1,
      number: { series: "P", value: "2", year: 2026 },
      postedAt: "2026-09-16T11:00:00.000Z",
      primarySupplierCostFils: "100000000",
      settlementContext: "cash",
      supplierInvoiceNumber: "INV-POSTED-002",
      supplierNameSnapshot: mockSupplier.name,
    };

    const markup = renderToStaticMarkup(
      createElement(SuppliersWorkspace, {
        baseUrl: "http://127.0.0.1:4000",
        initialPostedPurchases: [postedDebt, postedCash],
        initialSelectedId: mockSupplier.id,
        suppliers: [mockSupplier],
        onChanged: vi.fn(async () => {}),
      }),
    );

    // Shows posted purchase invoice numbers
    expect(markup).toContain("INV-POSTED-001");
    expect(markup).toContain("INV-POSTED-002");
    // Shows status as posted
    expect(markup).toContain("معتمدة");
    // Shows debt balance (only from debt invoice: 300,000 د.ع)
    expect(markup).toContain("300,000 د.ع");
  });
});
