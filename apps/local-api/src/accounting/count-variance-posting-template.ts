import {
  COUNT_VARIANCE_G01_WORKING_DEFAULT,
  type PurchasePostingAccountCode,
} from "@breev/contracts/local-rest";

export const COUNT_VARIANCE_POSTING_TEMPLATE_ID = "inventory.count" as const;
export const COUNT_VARIANCE_POSTING_TEMPLATE_VERSION = 1;
export const COUNT_VARIANCE_POSTING_TEMPLATE_VERSIONS: readonly number[] = [1];
export const COUNT_VARIANCE_DIFFERENCE_TREATMENT =
  COUNT_VARIANCE_G01_WORKING_DEFAULT;

export interface CountVarianceJournalFacts {
  readonly carryingAmountFils: bigint;
  readonly variance: bigint;
}

export interface CountVarianceJournalLine {
  readonly accountCode: PurchasePostingAccountCode;
  readonly creditFils: bigint;
  readonly debitFils: bigint;
  readonly ordinal: number;
  readonly supplierId: null;
}

export function renderCountVarianceJournal(
  facts: CountVarianceJournalFacts,
): readonly CountVarianceJournalLine[] {
  if (facts.variance === 0n) {
    throw new RangeError("A count variance journal needs a non-zero variance");
  }
  if (
    (facts.variance < 0n && facts.carryingAmountFils > 0n) ||
    (facts.variance > 0n && facts.carryingAmountFils < 0n)
  ) {
    throw new RangeError("A count variance value must have the variance sign");
  }
  const amount =
    facts.carryingAmountFils < 0n
      ? -facts.carryingAmountFils
      : facts.carryingAmountFils;
  const shortage = facts.variance < 0n;
  const lines: Omit<CountVarianceJournalLine, "ordinal">[] = [
    {
      accountCode: shortage ? "inventory-count-variance" : "inventory",
      creditFils: 0n,
      debitFils: amount,
      supplierId: null,
    },
    {
      accountCode: shortage ? "inventory" : "inventory-count-variance",
      creditFils: amount,
      debitFils: 0n,
      supplierId: null,
    },
  ];
  const result = lines.map((line, index) => ({
    ...line,
    ordinal: index + 1,
  }));
  const debits = result.reduce((total, line) => total + line.debitFils, 0n);
  const credits = result.reduce((total, line) => total + line.creditFils, 0n);
  if (debits !== credits) {
    throw new RangeError("Count variance journal debits must equal credits");
  }
  return result;
}
