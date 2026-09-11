import type { PoolClient } from "pg";

import {
  evaluateBatchEligibility,
  HARD_BLOCK_STATUSES,
} from "./inventory-eligibility.js";
import {
  type BatchFact,
  type FefoAllocationLine,
  type FefoPlan,
  planFefoAllocation,
} from "./inventory-fefo.js";
import {
  VALUATION_SCALE,
  applyWeightedAverageDepletion,
  applyWeightedAverageReceipt,
  type InventoryReceipt,
  type InventoryValuationState,
} from "./inventory-valuation.js";
import {
  DEFAULT_NEAR_EXPIRY_DAYS,
  DEFAULT_RECEIPT_CLASS_RULES,
  INVENTORY_RECEIPT_CLASSES,
  type InventoryReceiptClass,
  type InventoryReceiptRule,
  type InventoryReceiptRuleSet,
} from "./inventory-receipt-rules.js";
export type { BatchFact } from "./inventory-fefo.js";

/**
 * Inventory's own transaction-aware persistence: batches, movements, and the
 * weighted-average valuation state. Every function here accepts the caller's
 * `PoolClient` and writes only tables Inventory owns (docs/architecture.md
 * §"Local module ownership"). No function opens or commits a transaction of
 * its own, and none imports Nest, Drizzle, or any transport type.
 */

/** Ensures a pharmacy has a configured rule for every receipt class, seeded
 * from {@link DEFAULT_RECEIPT_CLASS_RULES} on first use, then returns the
 * pharmacy's current configured set. A pharmacy that later edits its own
 * rules (a future feature) reads its edited values through this same
 * function; nothing here distinguishes a default row from an edited one. */
export async function resolveReceiptClassRuleSet(
  client: PoolClient,
  pharmacyId: string,
): Promise<InventoryReceiptRuleSet> {
  await client.query(
    `insert into inventory_receipt_class_rules (
       pharmacy_id, class, expiry_required, lot_required, near_expiry_days
     )
     select $1, class_row.class::inventory_receipt_class,
            class_row.expiry_required, class_row.lot_required,
            class_row.near_expiry_days
     from (values
       ('general-item', false, false, ${DEFAULT_NEAR_EXPIRY_DAYS}),
       ('general-item-cold-chain', true, false, ${DEFAULT_NEAR_EXPIRY_DAYS}),
       ('medication', true, false, ${DEFAULT_NEAR_EXPIRY_DAYS}),
       ('medication-cold-chain', true, true, ${DEFAULT_NEAR_EXPIRY_DAYS})
     ) as class_row(class, expiry_required, lot_required, near_expiry_days)
     on conflict (pharmacy_id, class) do nothing`,
    [pharmacyId],
  );
  const result = await client.query<{
    class: string;
    expiry_required: boolean;
    lot_required: boolean;
    near_expiry_days: number;
  }>(
    `select class, expiry_required, lot_required, near_expiry_days
     from inventory_receipt_class_rules
     where pharmacy_id = $1`,
    [pharmacyId],
  );
  const rules: Record<InventoryReceiptClass, InventoryReceiptRule> = {
    ...DEFAULT_RECEIPT_CLASS_RULES,
  };
  const classes: readonly string[] = INVENTORY_RECEIPT_CLASSES;
  for (const row of result.rows) {
    if (!classes.includes(row.class)) continue;
    rules[row.class as InventoryReceiptClass] = {
      expiryRequired: row.expiry_required,
      lotRequired: row.lot_required,
      nearExpiryDays: row.near_expiry_days,
    };
  }
  return rules;
}

export interface ReadBatchFactsFilter {
  readonly batchIds?: readonly string[];
  readonly productIds?: readonly string[];
}

interface BatchFactRow {
  readonly balance: string;
  readonly batch_id: string;
  readonly created_at: Date;
  readonly effective_expiry_date: string | null;
  readonly latest_status_kind: BatchFact["latestStatusKind"];
  readonly lot_number: string | null;
  readonly original_expiry_date: string | null;
  readonly product_id: string;
}

/**
 * Reads the immutable receipt fact together with append-only safety facts and
 * the movement-derived balance. Sale-side posting calls this at the
 * `batch-stock` lock stage inside its own transaction; this module never
 * opens, commits, or owns that transaction.
 */
export async function readBatchFacts(
  client: PoolClient,
  pharmacyId: string,
  filter: ReadBatchFactsFilter,
  options: { readonly lock: boolean },
): Promise<BatchFact[]> {
  if (filter.productIds?.length === 0 || filter.batchIds?.length === 0) {
    return [];
  }
  const values: unknown[] = [pharmacyId];
  const predicates = ["batch.pharmacy_id = $1"];
  if (filter.productIds !== undefined) {
    values.push(filter.productIds);
    predicates.push(`batch.product_id = any($${values.length}::uuid[])`);
  }
  if (filter.batchIds !== undefined) {
    values.push(filter.batchIds);
    predicates.push(`batch.id = any($${values.length}::uuid[])`);
  }
  const lock = options.lock ? "for update of batch" : "";
  const result = await client.query<BatchFactRow>(
    `select batch.id as batch_id,
            batch.product_id,
            batch.lot_number,
            batch.expiry_date::text as original_expiry_date,
            coalesce(amendment.corrected_expiry_date, batch.expiry_date)::text
              as effective_expiry_date,
            batch.created_at,
            coalesce(stock.balance, '0') as balance,
            case
              when status_event.kind = 'expired'
               and amendment.occurred_at > status_event.occurred_at
                then null
              else status_event.kind
            end as latest_status_kind
     from inventory_batches batch
     left join lateral (
       select event.kind, event.occurred_at
       from inventory_batch_status_events event
       where event.pharmacy_id = batch.pharmacy_id
         and event.batch_id = batch.id
       order by event.sequence desc
       limit 1
     ) status_event on true
     left join lateral (
       select amendment_row.corrected_expiry_date, amendment_row.occurred_at
       from inventory_batch_expiry_amendments amendment_row
       where amendment_row.pharmacy_id = batch.pharmacy_id
         and amendment_row.batch_id = batch.id
       order by amendment_row.sequence desc
       limit 1
     ) amendment on true
     left join lateral (
       select sum(movement.quantity)::text as balance
       from inventory_movements movement
       where movement.pharmacy_id = batch.pharmacy_id
         and movement.batch_id = batch.id
     ) stock on true
     where ${predicates.join(" and ")}
     order by batch.id
     ${lock}`,
    values,
  );
  return result.rows.map((row) => ({
    balance: BigInt(row.balance),
    batchId: row.batch_id,
    effectiveExpiryDate: row.effective_expiry_date,
    latestStatusKind: row.latest_status_kind ?? null,
    lotNumber: row.lot_number,
    originalExpiryDate: row.original_expiry_date,
    productId: row.product_id,
    receivedAt: row.created_at.toISOString(),
  }));
}

export async function readNearExpiryDays(
  client: PoolClient,
  pharmacyId: string,
): Promise<Map<string, number>> {
  const result = await client.query<{
    near_expiry_days: number;
    product_id: string;
  }>(
    `select product.id as product_id, rules.near_expiry_days
     from catalog_products product
     join inventory_receipt_class_rules rules
       on rules.pharmacy_id = product.pharmacy_id
      and rules.class = (
        case when product.definition_mode = 'medication'
          then case when product.cold_storage_required
            then 'medication-cold-chain' else 'medication' end
          else case when product.cold_storage_required
            then 'general-item-cold-chain' else 'general-item' end
        end
      )::inventory_receipt_class
     where product.pharmacy_id = $1`,
    [pharmacyId],
  );
  return new Map(
    result.rows.map((row) => [row.product_id, row.near_expiry_days]),
  );
}

export interface BatchStatusEventFact {
  readonly businessDate: string;
  readonly createdBy: string | null;
  readonly deviceId: string | null;
  readonly evidence: string | null;
  readonly id: string;
  readonly kind: "expired" | "recalled" | "quarantined";
  readonly occurredAt: Date;
  readonly reason: string | null;
  readonly source: "user" | "daily-evaluator";
}

export interface BatchExpiryAmendmentFact {
  readonly approvalChallengeId: string;
  readonly businessDate: string;
  readonly correctedExpiryDate: string;
  readonly createdBy: string;
  readonly deviceId: string;
  readonly evidence: string;
  readonly id: string;
  readonly occurredAt: Date;
  readonly originalExpiryDate: string | null;
  readonly reason: string;
}

export interface BatchHistory {
  readonly expiryAmendments: readonly BatchExpiryAmendmentFact[];
  readonly statusEvents: readonly BatchStatusEventFact[];
}

export async function readBatchHistory(
  client: PoolClient,
  pharmacyId: string,
  batchId: string,
): Promise<BatchHistory> {
  const histories = await readBatchHistories(client, pharmacyId, [batchId]);
  return histories.get(batchId) ?? { expiryAmendments: [], statusEvents: [] };
}

export async function readBatchHistories(
  client: PoolClient,
  pharmacyId: string,
  batchIds: readonly string[],
): Promise<ReadonlyMap<string, BatchHistory>> {
  if (batchIds.length === 0) return new Map();
  const [events, amendments] = await Promise.all([
    client.query<{
      batch_id: string;
      business_date: string;
      created_by: string | null;
      device_id: string | null;
      evidence: string | null;
      id: string;
      kind: BatchStatusEventFact["kind"];
      occurred_at: Date;
      reason: string | null;
      source: BatchStatusEventFact["source"];
    }>(
      `select batch_id, id, kind, source, reason, evidence, business_date::text,
              occurred_at, created_by, device_id
       from inventory_batch_status_events
       where pharmacy_id = $1 and batch_id = any($2::uuid[])
       order by batch_id, sequence`,
      [pharmacyId, batchIds],
    ),
    client.query<{
      approval_challenge_id: string;
      batch_id: string;
      business_date: string;
      corrected_expiry_date: string;
      created_by: string;
      device_id: string;
      evidence: string;
      id: string;
      occurred_at: Date;
      original_expiry_date: string | null;
      reason: string;
    }>(
      `select batch_id, id, original_expiry_date::text, corrected_expiry_date::text,
              reason, evidence, business_date::text, occurred_at,
              created_by, device_id, approval_challenge_id
       from inventory_batch_expiry_amendments
       where pharmacy_id = $1 and batch_id = any($2::uuid[])
       order by batch_id, sequence`,
      [pharmacyId, batchIds],
    ),
  ]);
  const histories = new Map<string, BatchHistory>(
    batchIds.map((id) => [id, { expiryAmendments: [], statusEvents: [] }]),
  );
  for (const row of amendments.rows) {
    const history = histories.get(row.batch_id);
    if (history === undefined) continue;
    (history.expiryAmendments as BatchExpiryAmendmentFact[]).push({
      approvalChallengeId: row.approval_challenge_id,
      businessDate: row.business_date,
      correctedExpiryDate: row.corrected_expiry_date,
      createdBy: row.created_by,
      deviceId: row.device_id,
      evidence: row.evidence,
      id: row.id,
      occurredAt: row.occurred_at,
      originalExpiryDate: row.original_expiry_date,
      reason: row.reason,
    });
  }
  for (const row of events.rows) {
    const history = histories.get(row.batch_id);
    if (history === undefined) continue;
    (history.statusEvents as BatchStatusEventFact[]).push({
      businessDate: row.business_date,
      createdBy: row.created_by,
      deviceId: row.device_id,
      evidence: row.evidence,
      id: row.id,
      kind: row.kind,
      occurredAt: row.occurred_at,
      reason: row.reason,
      source: row.source,
    });
  }
  return histories;
}

export async function readBatchCarryingAmounts(
  client: PoolClient,
  pharmacyId: string,
  batchIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (batchIds.length === 0) return new Map();
  const result = await client.query<{
    amount: string | null;
    batch_id: string;
  }>(
    `select ids.batch_id::text,
            (
              coalesce((select sum(movement.carrying_amount_fils)
                        from inventory_movements movement
                        where movement.pharmacy_id = $1
                          and movement.batch_id = ids.batch_id), 0)
              + coalesce((select sum(effect.carrying_amount_delta_fils)
                          from inventory_value_effects effect
                          where effect.pharmacy_id = $1
                            and effect.batch_id = ids.batch_id), 0)
            )::text as amount
     from unnest($2::uuid[]) ids(batch_id)`,
    [pharmacyId, batchIds],
  );
  return new Map(result.rows.map((row) => [row.batch_id, row.amount]));
}

export interface AppendBatchStatusEventInput {
  readonly actorId?: string;
  readonly businessDate: string;
  readonly deviceId?: string;
  readonly evidence?: string;
  readonly kind: "expired" | "recalled" | "quarantined";
  readonly pharmacyId: string;
  readonly productId: string;
  readonly reason?: string;
  readonly source: "user" | "daily-evaluator";
  readonly batchId: string;
}

export async function appendBatchStatusEvent(
  client: PoolClient,
  input: AppendBatchStatusEventInput,
): Promise<{ readonly eventId: string }> {
  const sequence = await nextBatchFactSequence(
    client,
    "inventory_batch_status_events",
    input.pharmacyId,
    input.batchId,
  );
  const result = await client.query<{ id: string }>(
    `insert into inventory_batch_status_events (
       pharmacy_id, batch_id, product_id, sequence, kind, source, reason,
       evidence, business_date, created_by, device_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      input.pharmacyId,
      input.batchId,
      input.productId,
      sequence,
      input.kind,
      input.source,
      input.reason ?? null,
      input.evidence ?? null,
      input.businessDate,
      input.actorId ?? null,
      input.deviceId ?? null,
    ],
  );
  const eventId = result.rows[0]?.id;
  if (eventId === undefined)
    throw new Error("The batch status event was not created");
  return { eventId };
}

export interface AppendBatchExpiryAmendmentInput {
  readonly approvalChallengeId: string;
  readonly batchId: string;
  readonly businessDate: string;
  readonly correctedExpiryDate: string;
  readonly createdBy: string;
  readonly deviceId: string;
  readonly evidence: string;
  readonly pharmacyId: string;
  readonly productId: string;
  readonly originalExpiryDate: string | null;
  readonly reason: string;
}

export async function appendBatchExpiryAmendment(
  client: PoolClient,
  input: AppendBatchExpiryAmendmentInput,
): Promise<{ readonly amendmentId: string }> {
  const sequence = await nextBatchFactSequence(
    client,
    "inventory_batch_expiry_amendments",
    input.pharmacyId,
    input.batchId,
  );
  const result = await client.query<{ id: string }>(
    `insert into inventory_batch_expiry_amendments (
       pharmacy_id, batch_id, product_id, sequence, original_expiry_date,
       corrected_expiry_date, reason, evidence, business_date, created_by,
       device_id, approval_challenge_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning id`,
    [
      input.pharmacyId,
      input.batchId,
      input.productId,
      sequence,
      input.originalExpiryDate,
      input.correctedExpiryDate,
      input.reason,
      input.evidence,
      input.businessDate,
      input.createdBy,
      input.deviceId,
      input.approvalChallengeId,
    ],
  );
  const amendmentId = result.rows[0]?.id;
  if (amendmentId === undefined) {
    throw new Error("The batch expiry amendment was not created");
  }
  return { amendmentId };
}

async function nextBatchFactSequence(
  client: PoolClient,
  table: "inventory_batch_expiry_amendments" | "inventory_batch_status_events",
  pharmacyId: string,
  batchId: string,
): Promise<number> {
  const batch = await client.query(
    `select id
     from inventory_batches
     where pharmacy_id = $1 and id = $2
     for update`,
    [pharmacyId, batchId],
  );
  if (batch.rowCount === 0)
    throw new Error("The inventory batch was not found");
  const result = await client.query<{ sequence: number }>(
    `select coalesce(max(sequence), 0) + 1 as sequence
     from ${table}
     where pharmacy_id = $1 and batch_id = $2`,
    [pharmacyId, batchId],
  );
  const sequence = result.rows[0]?.sequence;
  if (sequence === undefined)
    throw new Error("The batch fact sequence was not allocated");
  return sequence;
}

export interface RegulatoryHardBlock {
  readonly batchId: string;
  readonly balance: bigint;
  readonly kind: "regulatory-hard-block";
  readonly productId: string;
  readonly status: (typeof HARD_BLOCK_STATUSES)[number];
}

export interface BatchNotFound {
  readonly batchId: string;
  readonly kind: "batch-not-found";
}

export interface BatchAllocationInsufficient {
  readonly available: bigint;
  readonly batchId: string;
  readonly kind: "batch-insufficient";
  readonly requested: bigint;
}

export type BatchAllocationProblem =
  BatchAllocationInsufficient | BatchNotFound | RegulatoryHardBlock;

export async function allocateFefo(
  client: PoolClient,
  input: {
    readonly businessDate: string;
    readonly lines: readonly FefoAllocationLine[];
    readonly nearExpiryDays: (productId: string) => number;
    readonly pharmacyId: string;
  },
  lock: boolean,
): Promise<FefoPlan | BatchAllocationProblem> {
  const facts = await readBatchFacts(
    client,
    input.pharmacyId,
    { productIds: [...new Set(input.lines.map((line) => line.productId))] },
    { lock },
  );
  const factById = new Map(facts.map((fact) => [fact.batchId, fact]));
  for (const line of input.lines) {
    if (line.batchId === undefined) continue;
    const fact = factById.get(line.batchId);
    if (fact === undefined || fact.productId !== line.productId) {
      return { batchId: line.batchId, kind: "batch-not-found" };
    }
    const status = evaluateBatchEligibility({
      businessDate: input.businessDate,
      effectiveExpiryDate: fact.effectiveExpiryDate,
      latestStatusKind: fact.latestStatusKind,
      nearExpiryDays: input.nearExpiryDays(line.productId),
    });
    if ((HARD_BLOCK_STATUSES as readonly string[]).includes(status)) {
      return {
        batchId: fact.batchId,
        balance: fact.balance,
        kind: "regulatory-hard-block",
        productId: fact.productId,
        status: status as RegulatoryHardBlock["status"],
      };
    }
  }
  return planFefoAllocation(
    facts.map((fact) => ({
      ...fact,
      status: evaluateBatchEligibility({
        businessDate: input.businessDate,
        effectiveExpiryDate: fact.effectiveExpiryDate,
        latestStatusKind: fact.latestStatusKind,
        nearExpiryDays: input.nearExpiryDays(fact.productId),
      }),
    })),
    input.lines,
  );
}

export async function validateBatchAllocation(
  client: PoolClient,
  input: {
    readonly businessDate: string;
    readonly lines: readonly FefoAllocationLine[];
    readonly nearExpiryDays: (productId: string) => number;
    readonly pharmacyId: string;
  },
): Promise<FefoPlan | BatchAllocationProblem> {
  const plan = await allocateFefo(client, input, true);
  if (!("allocations" in plan)) return plan;
  for (const line of input.lines) {
    if (line.batchId === undefined) continue;
    const allocated = plan.allocations
      .filter((allocation) => allocation.batchId === line.batchId)
      .reduce((total, allocation) => total + allocation.quantity, 0n);
    if (allocated < line.quantity) {
      const fact = (
        await readBatchFacts(
          client,
          input.pharmacyId,
          { batchIds: [line.batchId] },
          { lock: false },
        )
      )[0];
      return {
        available: fact?.balance ?? 0n,
        batchId: line.batchId,
        kind: "batch-insufficient",
        requested: line.quantity,
      };
    }
  }
  return plan;
}

export interface ReceiveBatchInput {
  readonly actorId: string;
  readonly expiryDate: string | null;
  readonly lotNumber: string | null;
  readonly pharmacyId: string;
  readonly productId: string;
  readonly quantity: bigint;
}

/** Creates one new batch for a physical receipt. Batches are never merged in
 * this slice: one posted purchase row always creates exactly one batch. */
export async function receiveBatch(
  client: PoolClient,
  input: ReceiveBatchInput,
): Promise<{ batchId: string }> {
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_batches (
       pharmacy_id, product_id, lot_number, expiry_date, quantity, created_by
     ) values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.lotNumber,
      input.expiryDate,
      input.quantity.toString(),
      input.actorId,
    ],
  );
  const batchId = inserted.rows[0]?.id;
  if (batchId === undefined) {
    throw new Error("The Inventory batch was not created");
  }
  return { batchId };
}

export interface RecordPurchaseReceiptMovementInput {
  readonly actorId: string;
  readonly batchId: string;
  readonly carryingAmountFils: bigint;
  readonly pharmacyId: string;
  readonly productId: string;
  readonly quantity: bigint;
  readonly sourceDocumentId: string;
  readonly sourceRowOrdinal: number;
}

/** Appends one purchase-receipt movement. Movements are append-only: this
 * inserts and never updates or deletes a row. */
export async function recordPurchaseReceiptMovement(
  client: PoolClient,
  input: RecordPurchaseReceiptMovementInput,
): Promise<{ movementId: string }> {
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_movements (
       pharmacy_id, product_id, batch_id, reason, quantity, carrying_amount_fils,
       source_document_type, source_document_id, source_row_ordinal, created_by
     ) values ($1, $2, $3, 'purchase-receipt', $4, $5, 'purchase-invoice', $6, $7, $8)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      input.quantity.toString(),
      input.carryingAmountFils.toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const movementId = inserted.rows[0]?.id;
  if (movementId === undefined) {
    throw new Error("The Inventory movement was not created");
  }
  return { movementId };
}

/** Locks, updates, and returns one product's weighted-average valuation
 * state after one receipt. The row is created with an empty state on first
 * use, exactly like {@link resolveReceiptClassRuleSet} seeds its rules. */
export async function applyReceiptToValuation(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
  receipt: InventoryReceipt,
): Promise<InventoryValuationState> {
  await client.query(
    `insert into inventory_valuation_state (pharmacy_id, product_id)
     values ($1, $2)
     on conflict (pharmacy_id, product_id) do nothing`,
    [pharmacyId, productId],
  );
  const locked = await client.query<{
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = $2
     for update`,
    [pharmacyId, productId],
  );
  const current = locked.rows[0];
  if (current === undefined) {
    throw new Error(
      "The Inventory valuation state disappeared inside its command",
    );
  }
  const before: InventoryValuationState = {
    totalQuantity: BigInt(current.total_quantity),
    totalValueScaled: BigInt(current.total_value_scaled),
  };
  const after = applyWeightedAverageReceipt(before, receipt);
  await client.query(
    `update inventory_valuation_state
     set total_quantity = $3::bigint, total_value_scaled = $4::numeric,
         updated_at = statement_timestamp()
     where pharmacy_id = $1 and product_id = $2`,
    [
      pharmacyId,
      productId,
      after.totalQuantity.toString(),
      after.totalValueScaled.toString(),
    ],
  );
  return after;
}

export interface PurchaseAdjustmentInventoryEffect {
  readonly batchId: string;
  readonly primarySupplierCostDeltaFils: bigint;
  readonly productId: string;
  readonly quantityDelta: bigint;
}

export type PurchaseAdjustmentBatchProblem =
  | { readonly batchId: string; readonly kind: "batch-invalid" }
  | {
      readonly availableQuantity: bigint;
      readonly batchId: string;
      readonly kind: "batch-insufficient";
      readonly requestedReduction: bigint;
    };

/** Locks every affected existing batch in id order and validates the summed
 * Delta against its current movement-derived balance. */
export async function validatePurchaseAdjustmentBatches(
  client: PoolClient,
  pharmacyId: string,
  effects: readonly PurchaseAdjustmentInventoryEffect[],
): Promise<PurchaseAdjustmentBatchProblem | undefined> {
  const byBatch = new Map<string, bigint>();
  const byBatchProduct = new Map<string, string>();
  for (const effect of effects) {
    const expectedProduct = byBatchProduct.get(effect.batchId);
    if (expectedProduct !== undefined && expectedProduct !== effect.productId) {
      return { batchId: effect.batchId, kind: "batch-invalid" };
    }
    byBatchProduct.set(effect.batchId, effect.productId);
    byBatch.set(
      effect.batchId,
      (byBatch.get(effect.batchId) ?? 0n) + effect.quantityDelta,
    );
  }
  const batchIds = [...byBatch.keys()].sort();
  if (batchIds.length === 0) return undefined;
  const locked = await client.query<{
    id: string;
    product_id: string;
    status: string;
  }>(
    `select id, product_id, status from inventory_batches
     where pharmacy_id = $1 and id = any($2::uuid[])
     order by id for update`,
    [pharmacyId, batchIds],
  );
  const batchFacts = new Map(locked.rows.map((row) => [row.id, row]));
  for (const batchId of batchIds) {
    const batch = batchFacts.get(batchId);
    if (
      batch?.status !== "active" ||
      batch.product_id !== byBatchProduct.get(batchId)
    ) {
      return { batchId, kind: "batch-invalid" };
    }
  }
  const balances = await client.query<{ batch_id: string; quantity: string }>(
    `select batch_id, coalesce(sum(quantity), 0)::text as quantity
     from inventory_movements
     where pharmacy_id = $1 and batch_id = any($2::uuid[])
     group by batch_id`,
    [pharmacyId, batchIds],
  );
  const current = new Map(
    balances.rows.map((row) => [row.batch_id, BigInt(row.quantity)]),
  );
  for (const batchId of batchIds) {
    const delta = byBatch.get(batchId) ?? 0n;
    const availableQuantity = current.get(batchId) ?? 0n;
    if (availableQuantity + delta < 0n) {
      return {
        availableQuantity,
        batchId,
        kind: "batch-insufficient",
        requestedReduction: -delta,
      };
    }
  }
  return undefined;
}

export async function recordPurchaseAdjustmentMovement(
  client: PoolClient,
  input: RecordPurchaseReceiptMovementInput,
): Promise<{ movementId: string }> {
  if (input.quantity === 0n) {
    throw new RangeError("An adjustment movement quantity cannot be zero");
  }
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_movements (
       pharmacy_id, product_id, batch_id, reason, quantity, carrying_amount_fils,
       source_document_type, source_document_id, source_row_ordinal, created_by
     ) values ($1, $2, $3, 'purchase-adjustment', $4, $5,
               'purchase-adjustment', $6, $7, $8)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      input.quantity.toString(),
      input.carryingAmountFils.toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const movementId = inserted.rows[0]?.id;
  if (movementId === undefined) {
    throw new Error("The Purchase Adjustment movement was not created");
  }
  return { movementId };
}

export async function recordPurchaseAdjustmentValueEffect(
  client: PoolClient,
  input: RecordPurchaseReceiptMovementInput,
): Promise<{ valueEffectId: string }> {
  if (input.quantity === 0n && input.carryingAmountFils === 0n) {
    throw new RangeError("An Inventory value effect cannot be empty");
  }
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_value_effects (
       pharmacy_id, product_id, batch_id, quantity_delta,
       carrying_amount_delta_fils, source_document_type, source_document_id,
       source_row_ordinal, created_by
     ) values ($1, $2, $3, $4, $5, 'purchase-adjustment', $6, $7, $8)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      input.quantity.toString(),
      input.carryingAmountFils.toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const valueEffectId = inserted.rows[0]?.id;
  if (valueEffectId === undefined) {
    throw new Error("The Purchase Adjustment value effect was not created");
  }
  return { valueEffectId };
}

export async function applyPurchaseAdjustmentToValuation(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly primarySupplierCostDeltaFils: bigint;
    readonly productId: string;
    readonly quantityDelta: bigint;
  },
): Promise<InventoryValuationState | undefined> {
  await client.query(
    `insert into inventory_valuation_state (pharmacy_id, product_id)
     values ($1, $2) on conflict (pharmacy_id, product_id) do nothing`,
    [input.pharmacyId, input.productId],
  );
  const locked = await client.query<{
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = $2 for update`,
    [input.pharmacyId, input.productId],
  );
  const current = locked.rows[0];
  if (current === undefined) {
    throw new Error("The Inventory valuation state disappeared");
  }
  const after = {
    totalQuantity: BigInt(current.total_quantity) + input.quantityDelta,
    totalValueScaled:
      BigInt(current.total_value_scaled) +
      input.primarySupplierCostDeltaFils * 10n ** BigInt(VALUATION_SCALE),
  };
  if (after.totalQuantity < 0n || after.totalValueScaled < 0n) {
    return undefined;
  }
  await client.query(
    `update inventory_valuation_state
     set total_quantity = $3::bigint, total_value_scaled = $4::numeric,
         updated_at = statement_timestamp()
     where pharmacy_id = $1 and product_id = $2`,
    [
      input.pharmacyId,
      input.productId,
      after.totalQuantity.toString(),
      after.totalValueScaled.toString(),
    ],
  );
  return after;
}

export async function validatePurchaseAdjustmentValuation(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly primarySupplierCostDeltaFils: bigint;
    readonly productId: string;
    readonly quantityDelta: bigint;
  },
): Promise<boolean> {
  const current = await client.query<{
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = $2`,
    [input.pharmacyId, input.productId],
  );
  const row = current.rows[0];
  const totalQuantity =
    BigInt(row?.total_quantity ?? "0") + input.quantityDelta;
  const totalValueScaled =
    BigInt(row?.total_value_scaled ?? "0") +
    input.primarySupplierCostDeltaFils * 10n ** BigInt(VALUATION_SCALE);
  return totalQuantity >= 0n && totalValueScaled >= 0n;
}

export interface PurchaseReturnBatchRequest {
  readonly batchId: string;
  readonly productId: string;
  readonly quantity: bigint;
}

export type PurchaseReturnBatchProblem =
  | { readonly batchId: string; readonly kind: "ineligible-batch" }
  | {
      readonly availableQuantity: bigint;
      readonly batchId: string;
      readonly kind: "negative-stock";
      readonly requestedQuantity: bigint;
    };

/** Locks all affected batch rows in deterministic id order and validates the
 * movement-derived balance. The lock is held by the caller's transaction. */
export async function lockPurchaseReturnBatches(
  client: PoolClient,
  pharmacyId: string,
  requests: readonly PurchaseReturnBatchRequest[],
): Promise<PurchaseReturnBatchProblem | undefined> {
  const quantities = new Map<string, bigint>();
  const products = new Map<string, string>();
  for (const request of requests) {
    const product = products.get(request.batchId);
    if (product !== undefined && product !== request.productId) {
      return { batchId: request.batchId, kind: "ineligible-batch" };
    }
    products.set(request.batchId, request.productId);
    quantities.set(
      request.batchId,
      (quantities.get(request.batchId) ?? 0n) + request.quantity,
    );
  }
  const batchIds = [...quantities.keys()].sort();
  const locked = await client.query<{
    id: string;
    product_id: string;
    status: string;
  }>(
    `select id, product_id, status from inventory_batches
     where pharmacy_id = $1 and id = any($2::uuid[])
     order by id for update`,
    [pharmacyId, batchIds],
  );
  const facts = new Map(locked.rows.map((row) => [row.id, row]));
  for (const batchId of batchIds) {
    const row = facts.get(batchId);
    if (row?.status !== "active" || row.product_id !== products.get(batchId)) {
      return { batchId, kind: "ineligible-batch" };
    }
  }
  const balances = await client.query<{ batch_id: string; quantity: string }>(
    `select batch_id, coalesce(sum(quantity), 0)::text as quantity
     from inventory_movements
     where pharmacy_id = $1 and batch_id = any($2::uuid[])
     group by batch_id`,
    [pharmacyId, batchIds],
  );
  const available = new Map(
    balances.rows.map((row) => [row.batch_id, BigInt(row.quantity)]),
  );
  for (const batchId of batchIds) {
    const requestedQuantity = quantities.get(batchId) ?? 0n;
    const availableQuantity = available.get(batchId) ?? 0n;
    if (requestedQuantity > availableQuantity) {
      return {
        availableQuantity,
        batchId,
        kind: "negative-stock",
        requestedQuantity,
      };
    }
  }
  return undefined;
}

export interface PurchaseReturnValuationRequest {
  readonly key: string;
  readonly productId: string;
  readonly quantity: bigint;
}

export interface PurchaseReturnValuationEffect {
  readonly carryingAmountFils: bigint;
  readonly carryingAmountPerUnitScaled: bigint;
  readonly key: string;
  readonly productId: string;
  readonly quantity: bigint;
}

export interface PurchaseReturnValuationPlan {
  readonly effects: readonly PurchaseReturnValuationEffect[];
  readonly states: ReadonlyMap<string, InventoryValuationState>;
}

/** Locks WAC rows in product-id order, then values outbound rows in caller
 * order. Passing the stable Purchase row ordinal as that order makes rounding
 * and final-remainder allocation reproducible. */
export async function preparePurchaseReturnValuation(
  client: PoolClient,
  pharmacyId: string,
  requests: readonly PurchaseReturnValuationRequest[],
): Promise<PurchaseReturnValuationPlan | undefined> {
  const productIds = [...new Set(requests.map((row) => row.productId))].sort();
  const locked = await client.query<{
    product_id: string;
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select product_id, total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = any($2::uuid[])
     order by product_id for update`,
    [pharmacyId, productIds],
  );
  const states = new Map<string, InventoryValuationState>(
    locked.rows.map((row) => [
      row.product_id,
      {
        totalQuantity: BigInt(row.total_quantity),
        totalValueScaled: BigInt(row.total_value_scaled),
      },
    ]),
  );
  const effects: PurchaseReturnValuationEffect[] = [];
  for (const request of requests) {
    const state = states.get(request.productId);
    if (state === undefined || request.quantity > state.totalQuantity) {
      return undefined;
    }
    const result = applyWeightedAverageDepletion(state, {
      quantity: request.quantity,
    });
    states.set(request.productId, result.state);
    effects.push({
      carryingAmountFils: result.carryingAmountFils,
      carryingAmountPerUnitScaled: result.carryingAmountPerUnitScaled,
      key: request.key,
      productId: request.productId,
      quantity: request.quantity,
    });
  }
  return { effects, states };
}

export async function applyPurchaseReturnValuation(
  client: PoolClient,
  pharmacyId: string,
  plan: PurchaseReturnValuationPlan,
): Promise<void> {
  for (const productId of [...plan.states.keys()].sort()) {
    const state = plan.states.get(productId)!;
    await client.query(
      `update inventory_valuation_state
       set total_quantity = $3::bigint, total_value_scaled = $4::numeric,
           updated_at = statement_timestamp()
       where pharmacy_id = $1 and product_id = $2`,
      [
        pharmacyId,
        productId,
        state.totalQuantity.toString(),
        state.totalValueScaled.toString(),
      ],
    );
  }
}

export async function recordPurchaseReturnMovement(
  client: PoolClient,
  input: RecordPurchaseReceiptMovementInput & {
    readonly supplierReductionFils: bigint;
  },
): Promise<{ movementId: string }> {
  if (input.quantity <= 0n || input.carryingAmountFils < 0n) {
    throw new RangeError(
      "A Purchase Return movement must remove positive stock value",
    );
  }
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_movements (
       pharmacy_id, product_id, batch_id, reason, quantity,
       carrying_amount_fils, supplier_reduction_fils, source_document_type,
       source_document_id, source_row_ordinal, created_by
     ) values ($1, $2, $3, 'purchase-return', $4, $5, $6,
               'purchase-return', $7, $8, $9)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      (-input.quantity).toString(),
      (-input.carryingAmountFils).toString(),
      (-input.supplierReductionFils).toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const movementId = inserted.rows[0]?.id;
  if (movementId === undefined) {
    throw new Error("The Purchase Return movement was not created");
  }
  return { movementId };
}
