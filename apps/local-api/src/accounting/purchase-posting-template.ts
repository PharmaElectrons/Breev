import type { PurchasePostingAccountCode } from "@breev/contracts/local-rest";

type PurchaseInvoiceAccountCode = Exclude<
  PurchasePostingAccountCode,
  "inventory-count-variance"
>;

/**
 * The purchase-invoice posting template: the one place a purchase becomes
 * journal lines.
 *
 * docs/domain.md §"Exact quantities, money, and accounting": "Every journal
 * uses double entry and is balanced. Finite, versioned, accountant-approved
 * posting templates translate domain facts. They are not a user-authored rules
 * engine. UI and report code cannot create journal lines."
 *
 * Finite and versioned is why the whole mapping lives in this file and nothing
 * else produces a line. Each posted document records
 * {@link PURCHASE_POSTING_TEMPLATE_VERSION}, so a posting can be explained
 * years later against the exact rules that produced it, and an approved change
 * is a new revision here rather than a refactor spread across the codebase.
 *
 * ## The two lines, on the one basis the domain confirms
 *
 * docs/domain.md §"Exact quantities, money, and accounting" settles which cost
 * value posts: "The Primary Supplier Cost is the sole basis for inventory
 * valuation, average item cost, and cost of goods sold, **and for the
 * supplier's primary accounting balance**. Cost After Discount is
 * informational -- shown on invoices, reviews, and supplier statements -- and
 * never replaces that basis."
 *
 * So both sides of the entry carry the Primary Supplier Cost:
 *
 * - **Debit `inventory`** with it, because stock arrives on the books at its
 *   full nominal value and the batch, the movement's frozen Carrying Amount,
 *   and the weighted average all agree with this debit.
 * - **Credit `supplier-payable` or `cash`** with the same amount, because the
 *   supplier's balance is kept on that basis and the header's cash/debt
 *   context -- nothing else -- decides which of the two it is.
 *
 * The calculated allowance posts **nothing** here. docs/domain.md keeps it out
 * of the invoice deliberately: an allowance "granted at settlement is a
 * separate transaction... and never changes item cost or historical averages",
 * and the settlement records the actual allowance and any Allowance Difference
 * against a balance that still stands at the full cost. The invoice stores its
 * calculated allowance and Cost After Discount as immutable facts and shows
 * them; supplier settlement (#44) is where they become postings.
 *
 * That is why {@link PurchaseInvoiceJournalFacts} still takes both cost values
 * while no line reads the informational one: the template verifies that the
 * invoice's two cost values reconcile before it posts, and structurally cannot
 * turn the informational one into an amount.
 *
 * ## What is still gated
 *
 * The basis above is the confirmed boundary, not a guess. What G-01 still
 * validates is the accountant's golden postings and the final printed
 * presentation: the account codes here are stable identifiers, never displayed
 * names, and the pharmacy-facing names with their chart classification remain a
 * client decision in docs/open-decisions.md. An approved change to the mapping
 * is a new revision of this file recorded on later documents, never a rewrite
 * of the ones already posted.
 *
 * Framework-free: no Nest, Drizzle, PostgreSQL, or transport code. Amounts are
 * exact `bigint` fils.
 */

/** The template identifier recorded on every purchase this file posts. */
export const PURCHASE_POSTING_TEMPLATE_ID = "purchase.invoice" as const;

/** The revision {@link renderPurchaseInvoiceJournal} produces today. */
export const PURCHASE_POSTING_TEMPLATE_VERSION = 1;

/**
 * Every revision whose rows may still exist. A reader must reject a version it
 * does not know rather than guess at the rules behind it, and a retired
 * revision stays listed for as long as documents carry it.
 */
export const PURCHASE_POSTING_TEMPLATE_VERSIONS: readonly number[] = [1];

/** The facts a purchase invoice hands the template. All exact fils. */
export interface PurchaseInvoiceJournalFacts {
  /**
   * The invoice's calculated allowance from its snapshot percentage. Checked
   * for consistency, never posted: it becomes a transaction at settlement.
   */
  readonly allowanceFils: bigint;
  /** The informational net. Checked for consistency, never posted. */
  readonly costAfterDiscountFils: bigint;
  /**
   * The basis every amount in this entry is taken from: valuation, the
   * supplier's balance, and the cash effect alike.
   */
  readonly primarySupplierCostFils: bigint;
  /** The header's cash/debt context. Never inferred from anything else. */
  readonly settlementContext: "cash" | "debt";
  readonly supplierId: string;
}

export interface PurchaseJournalLine {
  readonly accountCode: PurchaseInvoiceAccountCode;
  readonly creditFils: bigint;
  readonly debitFils: bigint;
  /** One-based position, so a stored journal reads in the order posted. */
  readonly ordinal: number;
  /** Set only on a line that moves this supplier's own balance. */
  readonly supplierId: string | null;
}

/**
 * Renders one purchase invoice into balanced double-entry lines.
 *
 * Facts that cannot make a balanced entry throw rather than return: an
 * unbalanced journal is a defect in this file or in its caller, not a business
 * outcome a caller could handle, and the same claim is enforced again by a
 * database constraint so no path can persist one.
 */
export function renderPurchaseInvoiceJournal(
  facts: PurchaseInvoiceJournalFacts,
): readonly PurchaseJournalLine[] {
  assertExactNonNegative(
    facts.primarySupplierCostFils,
    "A Primary Supplier Cost",
  );
  assertExactNonNegative(facts.allowanceFils, "An allowance");
  assertExactNonNegative(facts.costAfterDiscountFils, "A Cost After Discount");
  if (
    facts.costAfterDiscountFils + facts.allowanceFils !==
    facts.primarySupplierCostFils
  ) {
    throw new RangeError(
      "A purchase invoice's Cost After Discount and allowance must add up to its Primary Supplier Cost",
    );
  }

  const lines: readonly PurchaseJournalLine[] = [
    {
      accountCode: "inventory",
      creditFils: 0n,
      debitFils: facts.primarySupplierCostFils,
      ordinal: 1,
      supplierId: null,
    },
    facts.settlementContext === "debt"
      ? {
          accountCode: "supplier-payable",
          creditFils: facts.primarySupplierCostFils,
          debitFils: 0n,
          ordinal: 2,
          supplierId: facts.supplierId,
        }
      : {
          accountCode: "cash",
          creditFils: facts.primarySupplierCostFils,
          debitFils: 0n,
          ordinal: 2,
          supplierId: null,
        },
  ];

  assertBalanced(lines);
  return lines;
}

/**
 * The balance claim, as a reusable check rather than a comment: debits equal
 * credits, and no line is both.
 */
export function assertBalanced(lines: readonly PurchaseJournalLine[]): void {
  if (lines.length < 2) {
    throw new RangeError("A double entry needs at least two lines");
  }
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    assertExactNonNegative(line.debitFils, "A journal debit");
    assertExactNonNegative(line.creditFils, "A journal credit");
    if (line.debitFils > 0n && line.creditFils > 0n) {
      throw new RangeError(
        "A journal line is either a debit or a credit, never both",
      );
    }
    debits += line.debitFils;
    credits += line.creditFils;
  }
  if (debits !== credits) {
    throw new RangeError("Journal debits must equal journal credits");
  }
}

function assertExactNonNegative(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(
      `${label} must be an exact bigint, received ${typeof value}`,
    );
  }
  if (value < 0n) {
    throw new RangeError(`${label} cannot be negative`);
  }
}
