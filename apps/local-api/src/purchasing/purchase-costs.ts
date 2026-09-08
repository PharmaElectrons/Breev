import {
  allocateFilsProportionally,
  iqdFils,
  multiplyFils,
  parseRateString,
  rateOfFils,
} from "../posting/money.js";

/**
 * The two cost values of a purchase invoice, calculated from exact integers.
 *
 * docs/domain.md §"Exact quantities, money, and accounting": "Every purchase
 * invoice stores two cost values: the **Primary Supplier Cost** (the full
 * nominal cost before supplier allowance/discount) and the calculated **Cost
 * After Discount**. The Primary Supplier Cost is the sole basis for inventory
 * valuation, average item cost, and cost of goods sold... Cost After Discount
 * is informational."
 *
 * That separation is the whole point of this module, and it is structural
 * rather than a convention: {@link PurchaseInvoiceCosts} reports both values,
 * and the Cost After Discount it reports is never an input to anything. The
 * valuation side of the posting reads `linePrimarySupplierCostFils` and cannot
 * reach the informational figure, so changing only the allowance percentage
 * cannot move a batch cost, a movement value, or the weighted average.
 *
 * Framework-free: no Nest, Drizzle, PostgreSQL, or transport type appears here.
 * Every value is an exact `bigint`; the rounding and remainder rules come from
 * `posting/money.ts`, where G-01 will confirm them.
 */

/** One committed draft row, as the facts the money calculation needs. */
export interface PurchaseCostLine {
  /** How many entered units the row received. Positive. */
  readonly enteredQuantity: bigint;
  /** Primary Supplier Cost of one entered unit, in fils. Non-negative. */
  readonly primarySupplierCostFils: bigint;
}

export interface PurchaseLineCosts {
  /**
   * This line's informational share of the invoice after the allowance. The
   * shares add up to the invoice's Cost After Discount exactly, so a line and
   * its invoice total can never disagree by a fils.
   */
  readonly costAfterDiscountFils: bigint;
  /** This line's share of the invoice's calculated allowance. */
  readonly allowanceFils: bigint;
  /**
   * The line's full nominal value before the allowance. This is the amount the
   * batch, the movement's frozen Carrying Amount, and the weighted average are
   * all valued at.
   */
  readonly linePrimarySupplierCostFils: bigint;
}

export interface PurchaseInvoiceCosts {
  /** The invoice's calculated allowance from its snapshot percentage. */
  readonly allowanceFils: bigint;
  /** Informational total after the allowance. Never a valuation basis. */
  readonly costAfterDiscountFils: bigint;
  readonly lines: readonly PurchaseLineCosts[];
  /** The valuation basis: the sum of the lines' nominal values. */
  readonly primarySupplierCostFils: bigint;
}

export type PurchaseCostsProblem =
  "allowance-invalid" | "line-invalid" | "money-overflow" | "no-lines";

export type PurchaseCostsOutcome =
  | { readonly costs: PurchaseInvoiceCosts; readonly ok: true }
  | { readonly ok: false; readonly problem: PurchaseCostsProblem };

/**
 * PostgreSQL's signed `bigint` bound. Every posted fils amount lands in a
 * `bigint` column (docs/architecture.md §"Local API and PostgreSQL"), so an
 * invoice whose total would not fit is refused here with a reason instead of
 * being truncated by the database.
 */
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;

/**
 * Calculates both cost values for a whole invoice.
 *
 * The allowance is taken once, on the invoice total, and then split back
 * across the lines by `allocateFilsProportionally`. Taking it per line and
 * adding the results would round once per line and drift away from the
 * invoice's own allowance by up to one fils per row; splitting a single
 * rounded total cannot drift, because the shares are defined as a partition
 * of it.
 */
export function calculatePurchaseCosts(
  lines: readonly PurchaseCostLine[],
  allowancePercentage: string,
): PurchaseCostsOutcome {
  if (lines.length === 0) return { ok: false, problem: "no-lines" };

  let rate;
  try {
    rate = parseRateString(allowancePercentage);
  } catch {
    return { ok: false, problem: "allowance-invalid" };
  }
  if (rate > 100n * 1_000_000n) {
    return { ok: false, problem: "allowance-invalid" };
  }

  const lineTotals: bigint[] = [];
  let gross = iqdFils(0n);
  for (const line of lines) {
    if (line.enteredQuantity <= 0n || line.primarySupplierCostFils < 0n) {
      return { ok: false, problem: "line-invalid" };
    }
    const lineTotal = multiplyFils(
      iqdFils(line.primarySupplierCostFils),
      line.enteredQuantity,
    );
    if (lineTotal > POSTGRES_BIGINT_MAXIMUM) {
      return { ok: false, problem: "money-overflow" };
    }
    lineTotals.push(lineTotal);
    gross = iqdFils(gross + lineTotal);
    if (gross > POSTGRES_BIGINT_MAXIMUM) {
      return { ok: false, problem: "money-overflow" };
    }
  }

  const allowance = rateOfFils(gross, rate);
  const shares = allocateFilsProportionally(allowance, lineTotals);
  return {
    costs: {
      allowanceFils: allowance,
      costAfterDiscountFils: gross - allowance,
      lines: lineTotals.map((lineTotal, index) => {
        const share = shares[index] ?? 0n;
        return {
          allowanceFils: share,
          costAfterDiscountFils: lineTotal - share,
          linePrimarySupplierCostFils: lineTotal,
        };
      }),
      primarySupplierCostFils: gross,
    },
    ok: true,
  };
}
