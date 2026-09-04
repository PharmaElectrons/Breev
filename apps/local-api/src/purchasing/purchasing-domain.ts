import {
  allowancePercentageSchema,
  type AllowancePercentage,
} from "@breev/contracts/local-rest";

export interface AllowanceSnapshot {
  readonly basisFils: bigint;
  readonly percentage: AllowancePercentage;
}

/**
 * Copies the supplier rate into transaction-owned primitive values. No binary
 * floating point participates, and later master-data mutation has no reference
 * through which it could alter the snapshot.
 */
export function copyAllowanceSnapshot(
  percentage: string,
  basisFils = 0n,
): AllowanceSnapshot {
  if (basisFils < 0n) throw new Error("Allowance basis cannot be negative");
  return {
    basisFils,
    percentage: allowancePercentageSchema.parse(percentage),
  };
}
