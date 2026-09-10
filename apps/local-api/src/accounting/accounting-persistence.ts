import type { PoolClient } from "pg";

import {
  PURCHASE_POSTING_TEMPLATE_ID,
  PURCHASE_POSTING_TEMPLATE_VERSION,
  renderPurchaseInvoiceJournal,
  type PurchaseInvoiceJournalFacts,
  type PurchaseJournalLine,
} from "./purchase-posting-template.js";
import {
  PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_ID,
  PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_VERSION,
  renderPurchaseAdjustmentJournal,
  type PurchaseAdjustmentJournalFacts,
  type PurchaseAdjustmentJournalLine,
  type PurchaseAdjustmentSupplierEffect,
} from "./purchase-adjustment-posting-template.js";

/**
 * Accounting's own transaction-aware persistence: posting the balanced
 * journal a versioned template produces. This writes only the tables
 * Accounting owns (docs/architecture.md §"Local module ownership") -- the
 * journal entry header and its lines -- and never a Purchasing or Inventory
 * table. The balance itself is never trusted from the caller: it is derived
 * again here from the same pure template every posting use case reads, and a
 * deferred database constraint trigger re-checks it at commit regardless.
 */

export interface PostPurchaseInvoiceJournalInput {
  readonly facts: PurchaseInvoiceJournalFacts;
  readonly pharmacyId: string;
  readonly postedBy: string;
}

export interface PostedJournal {
  readonly entryId: string;
  readonly lines: readonly PurchaseJournalLine[];
  readonly templateId: "purchase.invoice";
  readonly templateVersion: number;
}

export async function postPurchaseInvoiceJournal(
  client: PoolClient,
  input: PostPurchaseInvoiceJournalInput,
): Promise<PostedJournal> {
  const lines = renderPurchaseInvoiceJournal(input.facts);
  const entry = await client.query<{ id: string }>(
    `insert into accounting_journal_entries (
       pharmacy_id, template_id, template_version, posted_by
     ) values ($1, $2, $3, $4)
     returning id`,
    [
      input.pharmacyId,
      PURCHASE_POSTING_TEMPLATE_ID,
      PURCHASE_POSTING_TEMPLATE_VERSION,
      input.postedBy,
    ],
  );
  const entryId = entry.rows[0]?.id;
  if (entryId === undefined) {
    throw new Error("The Accounting journal entry was not created");
  }
  for (const line of lines) {
    await client.query(
      `insert into accounting_journal_lines (
         pharmacy_id, entry_id, ordinal, account_code, supplier_id,
         debit_fils, credit_fils
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.pharmacyId,
        entryId,
        line.ordinal,
        line.accountCode,
        line.supplierId,
        line.debitFils.toString(),
        line.creditFils.toString(),
      ],
    );
  }
  return {
    entryId,
    lines,
    templateId: PURCHASE_POSTING_TEMPLATE_ID,
    templateVersion: PURCHASE_POSTING_TEMPLATE_VERSION,
  };
}

export interface ApplyPurchaseSettlementEffectInput {
  readonly pharmacyId: string;
  /** Always the gross Primary Supplier Cost -- Cost After Discount is
   * informational and never reaches either balance (docs/domain.md
   * §"Exact quantities, money, and accounting"). */
  readonly primarySupplierCostFils: bigint;
  readonly settlementContext: "cash" | "debt";
  /** Required for `debt`; ignored for `cash`, which has no supplier side. */
  readonly supplierId: string | null;
}

/**
 * Applies one purchase invoice's AP or Cash Box effect: Accounting's own
 * running balance state, separate from the immutable journal lines that
 * explain it. A debt purchase increments that pharmacy+supplier payable
 * balance; a cash purchase decrements that pharmacy's Cash Box balance.
 * Balances are signed exact `bigint`s -- no policy here forbids a negative
 * balance, because none has been approved.
 *
 * The single `insert ... on conflict do update` statement is its own atomic
 * read-modify-write: two concurrent purchases against the same supplier or
 * Cash Box serialize on the row Postgres locks for the upsert, so neither can
 * read a value the other is about to overwrite.
 */
export async function applyPurchaseSettlementEffect(
  client: PoolClient,
  input: ApplyPurchaseSettlementEffectInput,
): Promise<void> {
  if (input.settlementContext === "debt") {
    if (input.supplierId === null) {
      throw new Error("A debt purchase settlement effect needs a supplier");
    }
    // The supplier's payable balance increases by the full gross cost.
    const delta = input.primarySupplierCostFils;
    await client.query(
      `insert into accounting_supplier_balances (
         pharmacy_id, supplier_id, balance_fils
       ) values ($1, $2, $3::bigint)
       on conflict (pharmacy_id, supplier_id) do update
         set balance_fils = accounting_supplier_balances.balance_fils + excluded.balance_fils,
             updated_at = statement_timestamp()`,
      [input.pharmacyId, input.supplierId, delta.toString()],
    );
    return;
  }
  // The Cash Box balance decreases by the full gross cost: the delta stored
  // and accumulated is negative, so the same additive upsert applies whether
  // the pharmacy's first Cash Box row is being created or an existing one is
  // being adjusted.
  const delta = -input.primarySupplierCostFils;
  await client.query(
    `insert into accounting_cash_box_balances (pharmacy_id, balance_fils)
     values ($1, $2::bigint)
     on conflict (pharmacy_id) do update
       set balance_fils = accounting_cash_box_balances.balance_fils + excluded.balance_fils,
           updated_at = statement_timestamp()`,
    [input.pharmacyId, delta.toString()],
  );
}

export interface PostedPurchaseAdjustmentJournal {
  readonly entryId: string;
  readonly lines: readonly PurchaseAdjustmentJournalLine[];
  readonly templateId: "purchase.adjustment";
  readonly templateVersion: number;
}

export async function postPurchaseAdjustmentJournal(
  client: PoolClient,
  input: {
    readonly facts: PurchaseAdjustmentJournalFacts;
    readonly pharmacyId: string;
    readonly postedBy: string;
  },
): Promise<PostedPurchaseAdjustmentJournal> {
  const lines = renderPurchaseAdjustmentJournal(input.facts);
  const entry = await client.query<{ id: string }>(
    `insert into accounting_journal_entries (
       pharmacy_id, template_id, template_version, posted_by
     ) values ($1, $2, $3, $4)
     returning id`,
    [
      input.pharmacyId,
      PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_ID,
      PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_VERSION,
      input.postedBy,
    ],
  );
  const entryId = entry.rows[0]?.id;
  if (entryId === undefined) {
    throw new Error("The Purchase Adjustment journal was not created");
  }
  for (const line of lines) {
    await client.query(
      `insert into accounting_journal_lines (
         pharmacy_id, entry_id, ordinal, account_code, supplier_id,
         debit_fils, credit_fils
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.pharmacyId,
        entryId,
        line.ordinal,
        line.accountCode,
        line.supplierId,
        line.debitFils.toString(),
        line.creditFils.toString(),
      ],
    );
  }
  return {
    entryId,
    lines,
    templateId: PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_ID,
    templateVersion: PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_VERSION,
  };
}

export async function applyPurchaseAdjustmentSettlementEffects(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly primarySupplierCostDeltaFils: bigint;
    readonly settlementContext: "cash" | "debt";
    readonly supplierEffects: readonly PurchaseAdjustmentSupplierEffect[];
  },
): Promise<void> {
  if (input.settlementContext === "cash") {
    if (input.supplierEffects.some((effect) => effect.deltaFils !== 0n)) {
      throw new Error("A cash adjustment cannot move supplier balances");
    }
    await client.query(
      `insert into accounting_cash_box_balances (pharmacy_id, balance_fils)
       values ($1, $2::bigint)
       on conflict (pharmacy_id) do update
         set balance_fils = accounting_cash_box_balances.balance_fils + excluded.balance_fils,
             updated_at = statement_timestamp()`,
      [input.pharmacyId, (-input.primarySupplierCostDeltaFils).toString()],
    );
    return;
  }
  for (const effect of input.supplierEffects) {
    if (effect.deltaFils === 0n) continue;
    await client.query(
      `insert into accounting_supplier_balances (
         pharmacy_id, supplier_id, balance_fils
       ) values ($1, $2, $3::bigint)
       on conflict (pharmacy_id, supplier_id) do update
         set balance_fils = accounting_supplier_balances.balance_fils + excluded.balance_fils,
             updated_at = statement_timestamp()`,
      [input.pharmacyId, effect.supplierId, effect.deltaFils.toString()],
    );
  }
}
