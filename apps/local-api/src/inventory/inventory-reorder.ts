/**
 * Reorder-basket arithmetic. This module is deliberately framework-free: the
 * Inventory service supplies current balance and maximum-level facts, while
 * persistence and transport own storage and wire validation.
 */

export type ReorderProposalBasis =
  "maximum-minus-balance" | "no-maximum-level" | "balance-at-or-above-maximum";

export interface ReorderProposal {
  readonly basis: ReorderProposalBasis;
  readonly quantity: bigint;
}

export function proposeReorderQuantity(input: {
  readonly balance: bigint;
  readonly maximumLevel: bigint | null;
}): ReorderProposal {
  if (input.maximumLevel === null) {
    return { basis: "no-maximum-level", quantity: 0n };
  }
  if (input.balance >= input.maximumLevel) {
    return { basis: "balance-at-or-above-maximum", quantity: 0n };
  }
  return {
    basis: "maximum-minus-balance",
    quantity: input.maximumLevel - input.balance,
  };
}

export function projectReorder(input: {
  readonly balance: bigint;
  readonly maximumLevel: bigint | null;
  readonly quantity: bigint;
}): {
  readonly projectedLevel: bigint;
  readonly warning: "surplus" | null;
} {
  const projectedLevel = input.balance + input.quantity;
  return {
    projectedLevel,
    warning:
      input.maximumLevel !== null && projectedLevel > input.maximumLevel
        ? "surplus"
        : null,
  };
}

export function resolveReaddQuantity(input: {
  readonly previousQuantity: bigint;
  readonly quantityEditedAt: string | null;
  readonly proposal: ReorderProposal;
}): bigint {
  return input.quantityEditedAt === null
    ? input.proposal.quantity
    : input.previousQuantity;
}
