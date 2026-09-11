import type { Pool, PoolClient } from "pg";

import { addDays, compareDates } from "./business-date.js";
import {
  evaluateBatchEligibility,
  HARD_BLOCK_STATUSES,
} from "./inventory-eligibility.js";
import {
  appendBatchStatusEvent,
  readBatchFacts,
  readNearExpiryDays,
  resolveReceiptClassRuleSet,
} from "./inventory-persistence.js";
import { DEFAULT_NEAR_EXPIRY_DAYS } from "./inventory-receipt-rules.js";

export const INVENTORY_SAFETY_LOCK_NAMESPACE = 165_308_863;

export interface EvaluateBusinessDateInput {
  readonly businessDate: string;
  readonly jobId?: string;
  readonly pharmacyId: string;
  readonly trigger: "catch-up" | "manual" | "scheduled" | "startup";
}

export interface InventorySafetyRunResult {
  readonly alreadyEvaluated: boolean;
  readonly evaluatedBatchCount: number;
  readonly nearExpiryCount: number;
  readonly newlyExpiredCount: number;
}

/**
 * Evaluates exactly one civil business date inside the caller's transaction.
 * The pharmacy advisory lock serializes evaluators, receipt rows are locked in
 * batch-id order, and the immutable run fact is inserted only after all event
 * facts have been appended.
 */
export async function evaluateBusinessDate(
  client: PoolClient,
  input: EvaluateBusinessDateInput,
): Promise<InventorySafetyRunResult> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, $2::bigint))",
    [input.pharmacyId, INVENTORY_SAFETY_LOCK_NAMESPACE],
  );
  const existing = await client.query(
    `select 1 from inventory_batch_safety_runs
     where pharmacy_id = $1 and business_date = $2`,
    [input.pharmacyId, input.businessDate],
  );
  if (existing.rowCount !== 0) {
    return {
      alreadyEvaluated: true,
      evaluatedBatchCount: 0,
      nearExpiryCount: 0,
      newlyExpiredCount: 0,
    };
  }

  await resolveReceiptClassRuleSet(client, input.pharmacyId);
  const nearExpiryDays = await readNearExpiryDays(client, input.pharmacyId);
  const facts = await readBatchFacts(
    client,
    input.pharmacyId,
    {},
    { lock: true },
  );
  const datedFacts = facts.filter(
    (fact) => fact.balance > 0n && fact.effectiveExpiryDate !== null,
  );
  let newlyExpiredCount = 0;
  let nearExpiryCount = 0;
  for (const fact of datedFacts) {
    const status = evaluateBatchEligibility({
      businessDate: input.businessDate,
      effectiveExpiryDate: fact.effectiveExpiryDate,
      latestStatusKind: fact.latestStatusKind,
      nearExpiryDays:
        nearExpiryDays.get(fact.productId) ?? DEFAULT_NEAR_EXPIRY_DAYS,
    });
    if (
      status === "expired" &&
      fact.latestStatusKind !== "expired" &&
      !(HARD_BLOCK_STATUSES as readonly string[]).includes(
        fact.latestStatusKind ?? "",
      )
    ) {
      await appendBatchStatusEvent(client, {
        batchId: fact.batchId,
        businessDate: input.businessDate,
        kind: "expired",
        pharmacyId: input.pharmacyId,
        productId: fact.productId,
        source: "daily-evaluator",
      });
      newlyExpiredCount += 1;
    }
    if (status === "near-expiry") nearExpiryCount += 1;
  }

  await client.query(
    `insert into inventory_batch_safety_runs (
       pharmacy_id, business_date, trigger, evaluated_batch_count,
       newly_expired_count, near_expiry_count, job_id
     ) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (pharmacy_id, business_date) do nothing`,
    [
      input.pharmacyId,
      input.businessDate,
      input.trigger,
      datedFacts.length,
      newlyExpiredCount,
      nearExpiryCount,
      input.jobId ?? null,
    ],
  );
  return {
    alreadyEvaluated: false,
    evaluatedBatchCount: datedFacts.length,
    nearExpiryCount,
    newlyExpiredCount,
  };
}

export interface CatchUpInput {
  readonly onDateCommitted?: (
    businessDate: string,
    index: number,
    total: number,
  ) => Promise<void>;
  readonly jobId?: string;
  readonly pharmacyId: string;
  readonly throughBusinessDate: string;
  readonly trigger: "catch-up" | "manual" | "scheduled" | "startup";
}

export async function catchUp(pool: Pool, input: CatchUpInput): Promise<void> {
  const last = await pool.query<{ business_date: string }>(
    `select business_date::text
     from inventory_batch_safety_runs
     where pharmacy_id = $1
     order by business_date desc
     limit 1`,
    [input.pharmacyId],
  );
  const start =
    last.rows[0]?.business_date === undefined
      ? input.throughBusinessDate
      : addDays(last.rows[0].business_date, 1);
  if (compareDates(start, input.throughBusinessDate) > 0) return;

  const dates: string[] = [];
  let businessDate = start;
  for (;;) {
    dates.push(businessDate);
    if (businessDate === input.throughBusinessDate) break;
    businessDate = addDays(businessDate, 1);
  }

  for (const [index, businessDate] of dates.entries()) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const evaluationInput: EvaluateBusinessDateInput = {
        businessDate,
        pharmacyId: input.pharmacyId,
        trigger: input.trigger,
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      };
      await evaluateBusinessDate(client, evaluationInput);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await input.onDateCommitted?.(businessDate, index + 1, dates.length);
  }
}
