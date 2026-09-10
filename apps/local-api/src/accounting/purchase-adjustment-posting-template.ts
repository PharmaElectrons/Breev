import type { PurchasePostingAccountCode } from "@breev/contracts/local-rest";

/** One finite, versioned template for Purchase Invoice Adjustment journals. */
export const PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_ID =
  "purchase.adjustment" as const;
export const PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_VERSION = 1;
export const PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_VERSIONS: readonly number[] =
  [1];

export interface PurchaseAdjustmentSupplierEffect {
  readonly deltaFils: bigint;
  readonly supplierId: string;
}

export interface PurchaseAdjustmentJournalFacts {
  readonly primarySupplierCostDeltaFils: bigint;
  readonly settlementContext: "cash" | "debt";
  readonly supplierEffects: readonly PurchaseAdjustmentSupplierEffect[];
}

export interface PurchaseAdjustmentJournalLine {
  readonly accountCode: PurchasePostingAccountCode;
  readonly creditFils: bigint;
  readonly debitFils: bigint;
  readonly ordinal: number;
  readonly supplierId: string | null;
}

export function renderPurchaseAdjustmentJournal(
  facts: PurchaseAdjustmentJournalFacts,
): readonly PurchaseAdjustmentJournalLine[] {
  const lines: Omit<PurchaseAdjustmentJournalLine, "ordinal">[] = [];
  appendSignedLine(
    lines,
    "inventory",
    facts.primarySupplierCostDeltaFils,
    null,
  );
  if (facts.settlementContext === "cash") {
    if (facts.supplierEffects.some((effect) => effect.deltaFils !== 0n)) {
      throw new RangeError("A cash adjustment cannot move supplier payables");
    }
    appendSignedLine(lines, "cash", -facts.primarySupplierCostDeltaFils, null);
  } else {
    const supplierTotal = facts.supplierEffects.reduce(
      (sum, effect) => sum + effect.deltaFils,
      0n,
    );
    if (supplierTotal !== facts.primarySupplierCostDeltaFils) {
      throw new RangeError(
        "Supplier-payable effects must equal the inventory value Delta",
      );
    }
    for (const effect of facts.supplierEffects) {
      // A positive payable Delta is a credit; the helper's positive value is
      // a debit, so invert it for the liability account.
      appendSignedLine(
        lines,
        "supplier-payable",
        -effect.deltaFils,
        effect.supplierId,
      );
    }
  }
  const result = lines.map((line, index) => ({
    ...line,
    ordinal: index + 1,
  }));
  assertAdjustmentJournalBalanced(result);
  return result;
}

export function assertAdjustmentJournalBalanced(
  lines: readonly PurchaseAdjustmentJournalLine[],
): void {
  const debits = lines.reduce((sum, line) => sum + line.debitFils, 0n);
  const credits = lines.reduce((sum, line) => sum + line.creditFils, 0n);
  if (debits !== credits) {
    throw new RangeError("Adjustment journal debits must equal credits");
  }
}

function appendSignedLine(
  lines: Omit<PurchaseAdjustmentJournalLine, "ordinal">[],
  accountCode: PurchasePostingAccountCode,
  signedDebitFils: bigint,
  supplierId: string | null,
): void {
  if (signedDebitFils === 0n) return;
  lines.push({
    accountCode,
    creditFils: signedDebitFils < 0n ? -signedDebitFils : 0n,
    debitFils: signedDebitFils > 0n ? signedDebitFils : 0n,
    supplierId,
  });
}
