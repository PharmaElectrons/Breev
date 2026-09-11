import type { BatchEligibilityStatus } from "@breev/contracts/local-rest";

import { daysBetween } from "./business-date.js";

export type InventoryBatchStatusKind =
  "expired" | "postponed" | "quarantined" | "recalled";

export interface BatchEligibilityInput {
  readonly businessDate: string;
  readonly effectiveExpiryDate: string | null;
  readonly latestStatusKind: InventoryBatchStatusKind | null;
  readonly nearExpiryDays: number;
}

export type { BatchEligibilityStatus };

export const HARD_BLOCK_STATUSES = [
  "expired",
  "recalled",
  "quarantined",
  "postponed-blocked",
] as const satisfies readonly BatchEligibilityStatus[];

export function evaluateBatchEligibility(
  input: BatchEligibilityInput,
): BatchEligibilityStatus {
  const {
    latestStatusKind,
    effectiveExpiryDate,
    businessDate,
    nearExpiryDays,
  } = input;
  if (latestStatusKind === "recalled") return "recalled";
  if (latestStatusKind === "quarantined") return "quarantined";
  if (latestStatusKind === "postponed") return "postponed-blocked";
  if (
    effectiveExpiryDate !== null &&
    daysBetween(businessDate, effectiveExpiryDate) < 0
  ) {
    return "expired";
  }
  if (
    effectiveExpiryDate !== null &&
    daysBetween(businessDate, effectiveExpiryDate) <= nearExpiryDays
  ) {
    return "near-expiry";
  }
  return "eligible";
}

export function isAllocatable(
  status: BatchEligibilityStatus,
): status is "eligible" | "near-expiry" {
  return status === "eligible" || status === "near-expiry";
}
