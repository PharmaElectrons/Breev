import { describe, expect, it } from "vitest";

import {
  calculatePurchaseCosts,
  type PurchaseCostLine,
  type PurchaseInvoiceCosts,
} from "./purchase-costs.js";

function line(costFils: bigint, quantity: bigint): PurchaseCostLine {
  return { enteredQuantity: quantity, primarySupplierCostFils: costFils };
}

function required(
  lines: readonly PurchaseCostLine[],
  percentage: string,
): PurchaseInvoiceCosts {
  const outcome = calculatePurchaseCosts(lines, percentage);
  if (!outcome.ok) throw new Error(`unexpected rejection: ${outcome.problem}`);
  return outcome.costs;
}

describe("calculatePurchaseCosts", () => {
  it("stores the pre-discount basis and the calculated Cost After Discount", () => {
    const costs = required([line(80_000n, 2n)], "2.5");
    expect(costs.primarySupplierCostFils).toBe(160_000n);
    expect(costs.allowanceFils).toBe(4_000n);
    expect(costs.costAfterDiscountFils).toBe(156_000n);
    expect(costs.lines).toEqual([
      {
        allowanceFils: 4_000n,
        costAfterDiscountFils: 156_000n,
        linePrimarySupplierCostFils: 160_000n,
      },
    ]);
  });

  it("reproduces the client's five-invoice allowance example", () => {
    // docs/quality.md §"Requirement acceptance scenarios": Primary Supplier
    // Cost 5,000 and Cost After Discount 4,650 means a calculated allowance of
    // 350, which is exactly 7%.
    const costs = required([line(1_000n, 5n)], "7");
    expect(costs.primarySupplierCostFils).toBe(5_000n);
    expect(costs.allowanceFils).toBe(350n);
    expect(costs.costAfterDiscountFils).toBe(4_650n);
  });

  it("leaves the valuation basis untouched when only the allowance changes", () => {
    const lines = [line(80_000n, 2n), line(1_500n, 3n)];
    const low = required(lines, "0");
    const high = required(lines, "17.5");
    expect(high.primarySupplierCostFils).toBe(low.primarySupplierCostFils);
    expect(high.lines.map((row) => row.linePrimarySupplierCostFils)).toEqual(
      low.lines.map((row) => row.linePrimarySupplierCostFils),
    );
    // Only the informational side moved.
    expect(high.costAfterDiscountFils).not.toBe(low.costAfterDiscountFils);
    expect(low.allowanceFils).toBe(0n);
    expect(low.costAfterDiscountFils).toBe(low.primarySupplierCostFils);
  });

  it("reconciles the line shares with the invoice totals exactly", () => {
    for (const percentage of [
      "0",
      "0.000001",
      "1",
      "2.5",
      "33.333333",
      "100",
    ]) {
      const costs = required(
        [line(3n, 1n), line(1n, 1n), line(1n, 1n), line(999_997n, 1n)],
        percentage,
      );
      const sum = (
        pick: (row: PurchaseInvoiceCosts["lines"][number]) => bigint,
      ) => costs.lines.reduce((total, row) => total + pick(row), 0n);
      expect(
        sum((row) => row.linePrimarySupplierCostFils),
        percentage,
      ).toBe(costs.primarySupplierCostFils);
      expect(
        sum((row) => row.allowanceFils),
        percentage,
      ).toBe(costs.allowanceFils);
      expect(
        sum((row) => row.costAfterDiscountFils),
        percentage,
      ).toBe(costs.costAfterDiscountFils);
      expect(
        costs.primarySupplierCostFils - costs.allowanceFils,
        percentage,
      ).toBe(costs.costAfterDiscountFils);
    }
  });

  it("rounds the invoice allowance once instead of once per line", () => {
    // Three lines of one fils at 50%: per-line rounding would give three
    // allowances of one fils and a 3-fils total, but half of three fils is
    // 1.5, which rounds away from zero to 2.
    const costs = required([line(1n, 1n), line(1n, 1n), line(1n, 1n)], "50");
    expect(costs.allowanceFils).toBe(2n);
    expect(costs.lines.map((row) => row.allowanceFils)).toEqual([1n, 1n, 0n]);
    expect(costs.costAfterDiscountFils).toBe(1n);
  });

  it("stays exact past double precision", () => {
    const costs = required([line(9_007_199_254_740_993n, 1n)], "1");
    expect(costs.primarySupplierCostFils).toBe(9_007_199_254_740_993n);
    expect(costs.allowanceFils).toBe(90_071_992_547_410n);
    expect(costs.costAfterDiscountFils).toBe(8_917_127_262_193_583n);
  });

  it("refuses an invoice with no committed rows", () => {
    expect(calculatePurchaseCosts([], "2.5")).toEqual({
      ok: false,
      problem: "no-lines",
    });
  });

  it("refuses a line that is not a positive receipt of a real cost", () => {
    for (const invalid of [
      line(80_000n, 0n),
      line(80_000n, -1n),
      line(-1n, 1n),
    ]) {
      expect(calculatePurchaseCosts([invalid], "2.5")).toEqual({
        ok: false,
        problem: "line-invalid",
      });
    }
  });

  it("refuses a total that would not survive its bigint column", () => {
    const maximum = 9_223_372_036_854_775_807n;
    expect(calculatePurchaseCosts([line(maximum, 2n)], "0")).toEqual({
      ok: false,
      problem: "money-overflow",
    });
    expect(
      calculatePurchaseCosts([line(maximum, 1n), line(1n, 1n)], "0"),
    ).toEqual({ ok: false, problem: "money-overflow" });
  });

  it("refuses an allowance that is not exact decimal text in range", () => {
    for (const invalid of ["", "2.5000001", "-1", "101", "2e1", "0x2"]) {
      expect(calculatePurchaseCosts([line(1n, 1n)], invalid), invalid).toEqual({
        ok: false,
        problem: "allowance-invalid",
      });
    }
    expect(
      calculatePurchaseCosts([line(1n, 1n)], 2.5 as unknown as string),
    ).toEqual({ ok: false, problem: "allowance-invalid" });
  });
});
