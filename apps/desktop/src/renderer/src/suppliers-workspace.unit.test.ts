import type { Supplier } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as preferencesModule from "./preferences-provider";
import { SuppliersWorkspace } from "./suppliers-workspace";

function mockPreferences(locale: "ar" | "en"): void {
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

function renderWorkspace(): string {
  return renderToStaticMarkup(
    createElement(SuppliersWorkspace, {
      baseUrl: "http://127.0.0.1:4000",
      suppliers: [mockSupplier],
      onChanged: vi.fn(async () => {}),
    }),
  );
}

describe("SuppliersWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the M2 Supplier profile while hiding later accounting surfaces in English", () => {
    mockPreferences("en");

    const markup = renderWorkspace();

    expect(markup).toContain("Al-Razi Scientific Bureau");
    expect(markup).toContain("Supplier profile");
    expect(markup).toContain("Default allowance %");
    expect(markup).toContain("Default payment terms");
    expect(markup).toContain("Due period (days)");
    expect(markup).not.toContain("Account statement");
    expect(markup).not.toContain("Invoice transaction ledger");
    expect(markup).not.toContain("Live balance");
    expect(markup).not.toContain("Max credit limit");
    expect(markup).not.toContain("Due alert window");
  });

  it("keeps the M2 Supplier profile while hiding later accounting surfaces in Arabic", () => {
    mockPreferences("ar");

    const markup = renderWorkspace();

    expect(markup).toContain("بيانات المذخر");
    expect(markup).toContain("نسبة السماح الافتراضية %");
    expect(markup).toContain("طريقة الدفع الافتراضية");
    expect(markup).toContain("فترة الاستحقاق (يوم)");
    expect(markup).not.toContain("كشف حساب");
    expect(markup).not.toContain("تفاصيل حركة الفواتير");
    expect(markup).not.toContain("ديون المذخر");
    expect(markup).not.toContain("حد الدين الأقصى");
    expect(markup).not.toContain("نافذة تنبيه الاستحقاق");
  });
});
