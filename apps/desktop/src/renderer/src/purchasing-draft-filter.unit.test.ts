import { describe, expect, it } from "vitest";
import type { PurchaseDraft } from "@breev/contracts/local-rest";
import { filterPurchaseDrafts } from "./purchasing-draft-filter";

function dummyDraft(overrides?: Partial<PurchaseDraft>): PurchaseDraft {
  return {
    allowanceSnapshot: {
      basisFils: "0",
      percentage: "0",
    },
    createdAt: "2026-09-01T10:00:00Z",
    id: "018f0000-0000-7000-8000-000000000001",
    invoiceDate: "2026-09-15",
    settlementContext: "cash",
    status: "active",
    supplierId: "018f0000-0000-7000-8000-000000000002",
    supplierInvoiceNumber: "INV-1001",
    supplierNameSnapshot: "Al-Amal Medical Co.",
    updatedAt: "2026-09-01T10:00:00Z",
    version: "1",
    ...overrides,
  };
}

const SAMPLE_DRAFTS: readonly PurchaseDraft[] = [
  dummyDraft({
    id: "018f0000-0000-7000-8000-000000000001",
    invoiceDate: "2026-08-31",
    settlementContext: "cash",
    supplierInvoiceNumber: "INV-AUG-31",
    supplierNameSnapshot: "Babylon Pharma",
  }),
  dummyDraft({
    id: "018f0000-0000-7000-8000-000000000002",
    invoiceDate: "2026-09-15",
    settlementContext: "debt",
    supplierInvoiceNumber: "INV-SEP-15",
    supplierNameSnapshot: "Al-Amal Medical Co.",
  }),
  dummyDraft({
    id: "018f0000-0000-7000-8000-000000000003",
    invoiceDate: "2026-09-30",
    settlementContext: "cash",
    supplierInvoiceNumber: "INV-SEP-30",
    supplierNameSnapshot: "Tigris Supplies",
  }),
];

describe("filterPurchaseDrafts", () => {
  it("matches all drafts when date is empty and valid", () => {
    const result = filterPurchaseDrafts(SAMPLE_DRAFTS, {
      context: "all",
      date: "",
      isDateInvalid: false,
      locale: "en",
      query: "",
    });

    expect(result).toHaveLength(3);
  });

  it("filters to matching date on a valid Day 31 (e.g. August 31)", () => {
    const result = filterPurchaseDrafts(SAMPLE_DRAFTS, {
      context: "all",
      date: "2026-08-31",
      isDateInvalid: false,
      locale: "en",
      query: "",
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.supplierInvoiceNumber).toBe("INV-AUG-31");
  });

  it("returns zero matches on a valid Day 31 when no draft exists for that day", () => {
    const result = filterPurchaseDrafts(SAMPLE_DRAFTS, {
      context: "all",
      date: "2026-10-31",
      isDateInvalid: false,
      locale: "en",
      query: "",
    });

    expect(result).toHaveLength(0);
  });

  it("returns zero matches when isDateInvalid is true (e.g. Day 31 on 30-day months like September, April, June, November)", () => {
    // When the browser sanitizes an impossible date like 2026-09-31 to empty string,
    // isDateInvalid is set to true. The filter MUST NOT fall back to matching all drafts.
    const result = filterPurchaseDrafts(SAMPLE_DRAFTS, {
      context: "all",
      date: "",
      isDateInvalid: true,
      locale: "en",
      query: "",
    });

    expect(result).toHaveLength(0);
  });

  it("combines date filtering with text search and context filtering", () => {
    const result = filterPurchaseDrafts(SAMPLE_DRAFTS, {
      context: "cash",
      date: "2026-08-31",
      isDateInvalid: false,
      locale: "en",
      query: "Babylon",
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.supplierInvoiceNumber).toBe("INV-AUG-31");

    const mismatchedContext = filterPurchaseDrafts(SAMPLE_DRAFTS, {
      context: "debt",
      date: "2026-08-31",
      isDateInvalid: false,
      locale: "en",
      query: "Babylon",
    });

    expect(mismatchedContext).toHaveLength(0);
  });
});
