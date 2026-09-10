import { divideFilsRounded } from "../posting/money.js";

export type PurchaseReturnEligibilityProblem =
  "ineligible-batch" | "negative-stock" | "over-return";

export interface PurchaseReturnEligibility {
  readonly availableStock: bigint;
  readonly originalQuantity: bigint;
  readonly previouslyReturnedQuantity: bigint;
  readonly requestedQuantity: bigint;
}

export function validatePurchaseReturnEligibility(
  input: PurchaseReturnEligibility,
): PurchaseReturnEligibilityProblem | undefined {
  for (const value of [
    input.availableStock,
    input.originalQuantity,
    input.previouslyReturnedQuantity,
    input.requestedQuantity,
  ]) {
    if (typeof value !== "bigint") {
      throw new TypeError(
        "Purchase Return quantities must be exact bigint values",
      );
    }
  }
  if (
    input.originalQuantity <= 0n ||
    input.previouslyReturnedQuantity < 0n ||
    input.previouslyReturnedQuantity > input.originalQuantity
  ) {
    return "ineligible-batch";
  }
  if (input.requestedQuantity <= 0n) return "over-return";
  if (
    input.requestedQuantity >
    input.originalQuantity - input.previouslyReturnedQuantity
  ) {
    return "over-return";
  }
  if (input.requestedQuantity > input.availableStock) return "negative-stock";
  return undefined;
}

export interface SupplierReductionInput {
  readonly alreadyReducedFils: bigint;
  readonly originalQuantity: bigint;
  readonly originalSupplierCostFils: bigint;
  readonly previouslyReturnedQuantity: bigint;
  readonly returnQuantity: bigint;
}

/**
 * Derives the supplier-side reduction only from the original invoice's
 * Primary Supplier Cost. The final eligible return receives the exact
 * remainder so multiple partial returns reconcile to the original line.
 */
export function calculateSupplierReduction(
  input: SupplierReductionInput,
): bigint {
  const problem = validatePurchaseReturnEligibility({
    availableStock: input.originalQuantity,
    originalQuantity: input.originalQuantity,
    previouslyReturnedQuantity: input.previouslyReturnedQuantity,
    requestedQuantity: input.returnQuantity,
  });
  if (problem !== undefined && problem !== "negative-stock") {
    throw new RangeError(`Supplier reduction cannot use ${problem}`);
  }
  if (
    input.originalSupplierCostFils < 0n ||
    input.alreadyReducedFils < 0n ||
    input.alreadyReducedFils > input.originalSupplierCostFils
  ) {
    throw new RangeError("Supplier reduction history is invalid");
  }
  const remainingQuantity =
    input.originalQuantity - input.previouslyReturnedQuantity;
  if (input.returnQuantity === remainingQuantity) {
    return input.originalSupplierCostFils - input.alreadyReducedFils;
  }
  return divideFilsRounded(
    input.originalSupplierCostFils * input.returnQuantity,
    input.originalQuantity,
  );
}
