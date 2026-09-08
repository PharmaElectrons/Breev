import { postedPurchaseJournalSchema } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { calculatePurchaseCosts } from "../purchasing/purchase-costs.js";
import {
  assertBalanced,
  PURCHASE_POSTING_TEMPLATE_ID,
  PURCHASE_POSTING_TEMPLATE_VERSION,
  PURCHASE_POSTING_TEMPLATE_VERSIONS,
  renderPurchaseInvoiceJournal,
  type PurchaseInvoiceJournalFacts,
  type PurchaseJournalLine,
} from "./purchase-posting-template.js";

const SUPPLIER_ID = "018f7777-7777-7777-8777-777777777777";

function facts(
  overrides: Partial<PurchaseInvoiceJournalFacts> = {},
): PurchaseInvoiceJournalFacts {
  return {
    allowanceFils: 4_000n,
    costAfterDiscountFils: 156_000n,
    primarySupplierCostFils: 160_000n,
    settlementContext: "debt",
    supplierId: SUPPLIER_ID,
    ...overrides,
  };
}

function totals(lines: readonly PurchaseJournalLine[]) {
  return lines.reduce(
    (sums, line) => ({
      credits: sums.credits + line.creditFils,
      debits: sums.debits + line.debitFils,
    }),
    { credits: 0n, debits: 0n },
  );
}

describe("renderPurchaseInvoiceJournal", () => {
  it("is one finite versioned template recorded on every document", () => {
    expect(PURCHASE_POSTING_TEMPLATE_ID).toBe("purchase.invoice");
    expect(PURCHASE_POSTING_TEMPLATE_VERSIONS).toContain(
      PURCHASE_POSTING_TEMPLATE_VERSION,
    );
  });

  it("posts the Primary Supplier Cost on both sides of a debt invoice", () => {
    expect(renderPurchaseInvoiceJournal(facts())).toEqual([
      {
        accountCode: "inventory",
        creditFils: 0n,
        debitFils: 160_000n,
        ordinal: 1,
        supplierId: null,
      },
      {
        accountCode: "supplier-payable",
        creditFils: 160_000n,
        debitFils: 0n,
        ordinal: 2,
        supplierId: SUPPLIER_ID,
      },
    ]);
  });

  it("takes the cash or debt effect from the header context alone", () => {
    const cash = renderPurchaseInvoiceJournal(
      facts({ settlementContext: "cash" }),
    );
    expect(cash[1]).toEqual({
      accountCode: "cash",
      creditFils: 160_000n,
      debitFils: 0n,
      ordinal: 2,
      supplierId: null,
    });
    expect(cash.map((line) => line.accountCode)).not.toContain(
      "supplier-payable",
    );
    // The valuation debit is the same either way: how the invoice is settled
    // never changes what the stock is worth.
    expect(cash[0]).toEqual(renderPurchaseInvoiceJournal(facts())[0]);
  });

  it("posts no allowance line, because settlement owns the allowance", () => {
    for (const settlementContext of ["cash", "debt"] as const) {
      const lines = renderPurchaseInvoiceJournal(facts({ settlementContext }));
      expect(lines, settlementContext).toHaveLength(2);
      expect(lines.map((line) => line.accountCode)).not.toContain(
        "supplier-allowance",
      );
      // The informational net appears nowhere in the entry.
      expect(lines.map((line) => line.creditFils)).not.toContain(156_000n);
    }
  });

  it("changes nothing in the journal when only the allowance changes", () => {
    // Worked literals: one invoice, three supplier allowance percentages. The
    // entry is identical each time; only the informational cost moves.
    const invoice = [{ enteredQuantity: 2n, primarySupplierCostFils: 80_000n }];
    const rendered = ["0", "2.5", "40"].map((percentage) => {
      const costs = calculatePurchaseCosts(invoice, percentage);
      if (!costs.ok) throw new Error(costs.problem);
      return {
        costAfterDiscountFils: costs.costs.costAfterDiscountFils,
        lines: renderPurchaseInvoiceJournal({
          allowanceFils: costs.costs.allowanceFils,
          costAfterDiscountFils: costs.costs.costAfterDiscountFils,
          primarySupplierCostFils: costs.costs.primarySupplierCostFils,
          settlementContext: "debt",
          supplierId: SUPPLIER_ID,
        }),
      };
    });
    expect(rendered.map((entry) => entry.costAfterDiscountFils)).toEqual([
      160_000n,
      156_000n,
      96_000n,
    ]);
    for (const entry of rendered) {
      expect(entry.lines).toEqual(rendered[0]?.lines);
      expect(totals(entry.lines)).toEqual({
        credits: 160_000n,
        debits: 160_000n,
      });
    }
  });

  it("keeps the cash effect on the same basis when only the allowance changes", () => {
    const invoice = [{ enteredQuantity: 2n, primarySupplierCostFils: 80_000n }];
    const cashCredits = ["0", "2.5", "40"].map((percentage) => {
      const costs = calculatePurchaseCosts(invoice, percentage);
      if (!costs.ok) throw new Error(costs.problem);
      return renderPurchaseInvoiceJournal({
        allowanceFils: costs.costs.allowanceFils,
        costAfterDiscountFils: costs.costs.costAfterDiscountFils,
        primarySupplierCostFils: costs.costs.primarySupplierCostFils,
        settlementContext: "cash",
        supplierId: SUPPLIER_ID,
      })[1]?.creditFils;
    });
    expect(cashCredits).toEqual([160_000n, 160_000n, 160_000n]);
  });

  it("balances for both contexts across every allowance", () => {
    for (const percentage of [
      "0",
      "0.000001",
      "2.5",
      "7",
      "33.333333",
      "100",
    ]) {
      const costs = calculatePurchaseCosts(
        [
          { enteredQuantity: 2n, primarySupplierCostFils: 80_000n },
          { enteredQuantity: 3n, primarySupplierCostFils: 1_499n },
        ],
        percentage,
      );
      if (!costs.ok) throw new Error(costs.problem);
      for (const settlementContext of ["cash", "debt"] as const) {
        const lines = renderPurchaseInvoiceJournal({
          allowanceFils: costs.costs.allowanceFils,
          costAfterDiscountFils: costs.costs.costAfterDiscountFils,
          primarySupplierCostFils: costs.costs.primarySupplierCostFils,
          settlementContext,
          supplierId: SUPPLIER_ID,
        });
        const { credits, debits } = totals(lines);
        expect(debits, `${percentage}/${settlementContext}`).toBe(credits);
        expect(debits).toBe(costs.costs.primarySupplierCostFils);
        expect(lines).toHaveLength(2);
      }
    }
  });

  it("produces lines the wire contract accepts as balanced", () => {
    const journal = postedPurchaseJournalSchema.parse({
      entryId: "018fa000-0000-7000-8000-000000000005",
      lines: renderPurchaseInvoiceJournal(facts()).map((line) => ({
        accountCode: line.accountCode,
        creditFils: line.creditFils.toString(),
        debitFils: line.debitFils.toString(),
        ordinal: line.ordinal,
        supplierId: line.supplierId,
      })),
      templateId: PURCHASE_POSTING_TEMPLATE_ID,
      templateVersion: PURCHASE_POSTING_TEMPLATE_VERSION,
    });
    expect(journal.lines).toHaveLength(2);
  });

  it("refuses facts whose two cost values do not reconcile", () => {
    expect(() =>
      renderPurchaseInvoiceJournal(facts({ allowanceFils: 3_999n })),
    ).toThrow(RangeError);
    expect(() =>
      renderPurchaseInvoiceJournal(facts({ costAfterDiscountFils: 160_000n })),
    ).toThrow(RangeError);
  });

  it("refuses a negative or floating point amount", () => {
    expect(() =>
      renderPurchaseInvoiceJournal(
        facts({ allowanceFils: -1n, costAfterDiscountFils: 160_001n }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      renderPurchaseInvoiceJournal(
        facts({ primarySupplierCostFils: 160_000.5 as unknown as bigint }),
      ),
    ).toThrow(TypeError);
  });
});

describe("assertBalanced", () => {
  it("rejects an entry that is short a line, unbalanced, or both-sided", () => {
    const line = (over: Partial<PurchaseJournalLine>): PurchaseJournalLine => ({
      accountCode: "inventory",
      creditFils: 0n,
      debitFils: 0n,
      ordinal: 1,
      supplierId: null,
      ...over,
    });
    expect(() => assertBalanced([line({ debitFils: 1n })])).toThrow(RangeError);
    expect(() =>
      assertBalanced([line({ debitFils: 2n }), line({ creditFils: 1n })]),
    ).toThrow(RangeError);
    expect(() =>
      assertBalanced([
        line({ creditFils: 1n, debitFils: 1n }),
        line({ creditFils: 1n }),
      ]),
    ).toThrow(RangeError);
  });
});
