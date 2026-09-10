import {
  PURCHASE_RETURN_G01_WORKING_DEFAULT,
  type PurchasePostingAccountCode,
} from "@breev/contracts/local-rest";

export const PURCHASE_RETURN_POSTING_TEMPLATE_ID = "purchase.return" as const;
export const PURCHASE_RETURN_POSTING_TEMPLATE_VERSION = 1;
export const PURCHASE_RETURN_POSTING_TEMPLATE_VERSIONS: readonly number[] = [1];

/**
 * Engineering default pending G-01. It is deliberately named, versioned, and
 * exposed on the posted snapshot. The gross inventory credit always states
 * the frozen WAC Carrying Amount, the supplier debit always states the
 * original-Primary-Cost reduction, and any difference is an explicit offset
 * on the existing Inventory account. This invents no variance account and can
 * be replaced in this one template when the accountant approves G-01.
 */
export const PURCHASE_RETURN_DIFFERENCE_TREATMENT =
  PURCHASE_RETURN_G01_WORKING_DEFAULT;

export interface PurchaseReturnJournalFacts {
  readonly inventoryCarryingAmountFils: bigint;
  readonly supplierId: string;
  readonly supplierReductionFils: bigint;
}

export interface PurchaseReturnJournalLine {
  readonly accountCode: PurchasePostingAccountCode;
  readonly creditFils: bigint;
  readonly debitFils: bigint;
  readonly ordinal: number;
  readonly supplierId: string | null;
}

export function renderPurchaseReturnJournal(
  facts: PurchaseReturnJournalFacts,
): readonly PurchaseReturnJournalLine[] {
  if (
    facts.inventoryCarryingAmountFils < 0n ||
    facts.supplierReductionFils < 0n
  ) {
    throw new RangeError("Purchase Return values cannot be negative");
  }
  const lines: Omit<PurchaseReturnJournalLine, "ordinal">[] = [
    {
      accountCode: "supplier-payable",
      creditFils: 0n,
      debitFils: facts.supplierReductionFils,
      supplierId: facts.supplierId,
    },
    {
      accountCode: "inventory",
      creditFils: facts.inventoryCarryingAmountFils,
      debitFils: 0n,
      supplierId: null,
    },
  ];
  const difference =
    facts.inventoryCarryingAmountFils - facts.supplierReductionFils;
  if (difference !== 0n) {
    lines.push({
      accountCode: "inventory",
      creditFils: difference < 0n ? -difference : 0n,
      debitFils: difference > 0n ? difference : 0n,
      supplierId: null,
    });
  }
  const result = lines.map((line, index) => ({ ...line, ordinal: index + 1 }));
  const debits = result.reduce((sum, line) => sum + line.debitFils, 0n);
  const credits = result.reduce((sum, line) => sum + line.creditFils, 0n);
  if (debits !== credits) {
    throw new RangeError("Purchase Return journal debits must equal credits");
  }
  return result;
}
