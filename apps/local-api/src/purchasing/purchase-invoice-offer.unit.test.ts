import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  calculateInvoiceOffer,
  calculatePurchaseCostsWithOffer,
  NO_INVOICE_OFFER,
} from "./purchase-invoice-offer.js";

describe("version 1 invoice offer working defaults", () => {
  it("reconciles arbitrary row shares without negative costs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000000 }), {
          minLength: 1,
          maxLength: 30,
        }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (amounts, allowance, offerPart) => {
          const lines = amounts.map((amount) => ({
            enteredQuantity: 1n,
            primarySupplierCostFils: BigInt(amount),
          }));
          const base = calculatePurchaseCostsWithOffer(
            lines,
            String(allowance),
            NO_INVOICE_OFFER,
            1,
          );
          expect(base.ok).toBe(true);
          if (!base.ok) return;
          const offer =
            (base.costs.costAfterDiscountFils * BigInt(offerPart)) / 100n;
          const result = calculatePurchaseCostsWithOffer(
            lines,
            String(allowance),
            { mode: "fixed", value: String(offer) },
            1,
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(
            result.offerShares.reduce((sum, amount) => sum + amount, 0n),
          ).toBe(offer);
          expect(
            result.costs.lines.every(
              (line) => line.costAfterDiscountFils >= 0n,
            ),
          ).toBe(true);
          expect(
            result.costs.lines.reduce(
              (sum, line) => sum + line.costAfterDiscountFils,
              0n,
            ),
          ).toBe(result.costs.costAfterDiscountFils);
          expect(
            result.costs.costAfterDiscountFils +
              result.costs.allowanceFils +
              offer,
          ).toBe(result.costs.primarySupplierCostFils);
        },
      ),
      { numRuns: 200 },
    );
  });
  it.each([
    [{ mode: "none", value: "0" }, "0", 900000n],
    [{ mode: "fixed", value: "50000" }, "50000", 850000n],
    [{ mode: "percentage", value: "5" }, "50000", 850000n],
  ] as const)(
    "keeps allowance, offer and gross valuation separate: %j",
    (input, amount, net) => {
      const result = calculatePurchaseCostsWithOffer(
        [{ enteredQuantity: 10n, primarySupplierCostFils: 100000n }],
        "10",
        input,
        1,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.problem);
      expect(result.invoiceOffer).toMatchObject({
        input,
        ruleVersion: 1,
        offerFils: amount,
      });
      expect(result.costs).toMatchObject({
        primarySupplierCostFils: 1000000n,
        allowanceFils: 100000n,
        costAfterDiscountFils: net,
      });
    },
  );
  it("rounds once and allocates exact remainders in original line order", () => {
    const result = calculatePurchaseCostsWithOffer(
      Array.from({ length: 3 }, () => ({
        enteredQuantity: 1n,
        primarySupplierCostFils: 1n,
      })),
      "0",
      { mode: "percentage", value: "50" },
      1,
    );
    if (!result.ok) throw new Error(result.problem);
    expect(result.invoiceOffer.offerFils).toBe("2");
    expect(result.offerShares).toEqual([1n, 1n, 0n]);
    expect(result.costs.lines.map((row) => row.costAfterDiscountFils)).toEqual([
      0n,
      0n,
      1n,
    ]);
  });
  it("allocates only remaining row cost so separate rounding cannot make a negative net", () => {
    const result = calculatePurchaseCostsWithOffer(
      [1n, 1n].map((cost) => ({
        enteredQuantity: 1n,
        primarySupplierCostFils: cost,
      })),
      "50",
      { mode: "percentage", value: "50" },
      1,
    );
    if (!result.ok) throw new Error(result.problem);
    expect(
      result.costs.lines.every((row) => row.costAfterDiscountFils >= 0n),
    ).toBe(true);
    expect(
      result.costs.lines.reduce(
        (sum, row) => sum + row.costAfterDiscountFils,
        0n,
      ),
    ).toBe(0n);
    expect(result.offerShares).toEqual([0n, 1n]);
  });
  it("refuses combined reductions beyond gross instead of clamping", () => {
    expect(
      calculateInvoiceOffer({ mode: "fixed", value: "91" }, 1, 100n, 10n, [
        90n,
      ]),
    ).toEqual({ ok: false, problem: "offer-exceeds-cost" });
    expect(
      calculateInvoiceOffer(
        { mode: "percentage", value: "100" },
        1,
        100n,
        10n,
        [90n],
      ).ok,
    ).toBe(false);
  });
  it("keeps large exact values beyond Number precision and six decimal rates", () => {
    const gross = 9007199254740993n;
    const result = calculateInvoiceOffer(
      { mode: "percentage", value: "0.000001" },
      1,
      gross,
      0n,
      [gross],
    );
    if (!result.ok) throw new Error(result.problem);
    expect(result.snapshot.offerFils).toBe("90071993");
    expect(
      result.costAfterDiscountFils + BigInt(result.snapshot.offerFils),
    ).toBe(gross);
  });
  it.each([
    { mode: "fixed", value: "-1" },
    { mode: "fixed", value: "1.1" },
    { mode: "percentage", value: "100.000001" },
    { mode: "percentage", value: "1.0000001" },
    { mode: "none", value: "1" },
  ])("rejects invalid input %j", (input) => {
    expect(() =>
      calculateInvoiceOffer(
        input as Parameters<typeof calculateInvoiceOffer>[0],
        1,
        100n,
        0n,
        [100n],
      ),
    ).toThrow();
  });
  it("fails closed for an unsupported policy rather than interpreting old invoices", () => {
    expect(() =>
      calculateInvoiceOffer(NO_INVOICE_OFFER, 2, 100n, 0n, [100n]),
    ).toThrow("Unsupported");
  });
  it("has zero offer for empty no-offer drafts", () => {
    expect(
      calculateInvoiceOffer(NO_INVOICE_OFFER, 1, 0n, 0n, []),
    ).toMatchObject({ ok: true, lineShares: [], costAfterDiscountFils: 0n });
  });
});
