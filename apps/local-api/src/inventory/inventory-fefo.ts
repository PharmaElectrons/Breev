import type { BatchEligibilityStatus } from "@breev/contracts/local-rest";

import { HARD_BLOCK_STATUSES, isAllocatable } from "./inventory-eligibility.js";

export interface BatchFact {
  readonly balance: bigint;
  readonly batchId: string;
  readonly effectiveExpiryDate: string | null;
  readonly latestStatusKind:
    "expired" | "postponed" | "quarantined" | "recalled" | null;
  readonly lotNumber: string | null;
  readonly originalExpiryDate: string | null;
  readonly productId: string;
  readonly receivedAt: string;
  readonly status?: BatchEligibilityStatus;
}

export interface FefoAllocationLine {
  readonly batchId?: string;
  readonly productId: string;
  readonly quantity: bigint;
}

export interface FefoAllocation {
  readonly batchId: string;
  readonly effectiveExpiryDate: string | null;
  readonly productId: string;
  readonly quantity: bigint;
  readonly status: "eligible" | "near-expiry";
}

export interface FefoBlockedBatch {
  readonly balance: bigint;
  readonly batchId: string;
  readonly productId: string;
  readonly status: Extract<
    BatchEligibilityStatus,
    (typeof HARD_BLOCK_STATUSES)[number]
  >;
}

export interface FefoShortfall {
  readonly allocatable: bigint;
  readonly productId: string;
  readonly requested: bigint;
}

export interface FefoPlan {
  readonly allocations: readonly FefoAllocation[];
  readonly blocked: readonly FefoBlockedBatch[];
  readonly shortfalls: readonly FefoShortfall[];
}

export function planFefoAllocation(
  batches: readonly BatchFact[],
  lines: readonly FefoAllocationLine[],
): FefoPlan {
  const orderedBatches = [...batches].sort(compareBatches);
  const remaining = new Map(
    orderedBatches.map((batch) => [batch.batchId, batch.balance]),
  );
  const allocations: FefoAllocation[] = [];
  const shortfalls: FefoShortfall[] = [];
  const orderedLines = [...lines].sort(compareLines);

  for (const line of orderedLines) {
    let requested = line.quantity;
    const candidates = orderedBatches.filter(
      (batch) =>
        batch.productId === line.productId &&
        (line.batchId === undefined || line.batchId === batch.batchId),
    );
    for (const batch of candidates) {
      const balance = remaining.get(batch.batchId) ?? 0n;
      const status = effectiveStatus(batch);
      if (balance <= 0n || !isAllocatable(status)) continue;
      if (requested <= 0n) continue;
      const quantity = requested < balance ? requested : balance;
      allocations.push({
        batchId: batch.batchId,
        effectiveExpiryDate: batch.effectiveExpiryDate,
        productId: batch.productId,
        quantity,
        status,
      });
      remaining.set(batch.batchId, balance - quantity);
      requested -= quantity;
    }
    if (requested > 0n) {
      shortfalls.push({
        allocatable: line.quantity - requested,
        productId: line.productId,
        requested: line.quantity,
      });
    }
  }

  const blocked = orderedBatches
    .filter((batch) => {
      const status = effectiveStatus(batch);
      return batch.balance > 0n && isHardBlock(status);
    })
    .map((batch) => ({
      balance: batch.balance,
      batchId: batch.batchId,
      productId: batch.productId,
      status: effectiveStatus(batch) as FefoBlockedBatch["status"],
    }));

  return {
    allocations,
    blocked,
    shortfalls,
  };
}

function effectiveStatus(batch: BatchFact): BatchEligibilityStatus {
  if (batch.status !== undefined) return batch.status;
  switch (batch.latestStatusKind) {
    case "recalled":
      return "recalled";
    case "quarantined":
      return "quarantined";
    case "postponed":
      return "postponed-blocked";
    case "expired":
      return "expired";
    default:
      return "eligible";
  }
}

function isHardBlock(
  status: BatchEligibilityStatus,
): status is (typeof HARD_BLOCK_STATUSES)[number] {
  return (HARD_BLOCK_STATUSES as readonly string[]).includes(status);
}

function compareBatches(left: BatchFact, right: BatchFact): number {
  const leftExpiry = left.effectiveExpiryDate;
  const rightExpiry = right.effectiveExpiryDate;
  if (leftExpiry === null && rightExpiry !== null) return 1;
  if (leftExpiry !== null && rightExpiry === null) return -1;
  if (leftExpiry !== rightExpiry) {
    return (leftExpiry ?? "").localeCompare(rightExpiry ?? "");
  }
  return (
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.batchId.localeCompare(right.batchId)
  );
}

function compareLines(
  left: FefoAllocationLine,
  right: FefoAllocationLine,
): number {
  return (
    left.productId.localeCompare(right.productId) ||
    (left.batchId ?? "").localeCompare(right.batchId ?? "")
  );
}
