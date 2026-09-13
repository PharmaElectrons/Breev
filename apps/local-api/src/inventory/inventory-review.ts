import type { PoolClient } from "pg";

import { DEFAULT_NEAR_EXPIRY_DAYS } from "./inventory-receipt-rules.js";
import { reportedAverageUnitCostScaled } from "./inventory-valuation.js";

export interface InventoryBatchPosition {
  readonly balance: bigint;
  readonly batchId: string;
  readonly effectiveExpiryDate: string | null;
  readonly expiryDate: string | null;
  readonly lotNumber: string | null;
  readonly status:
    | "eligible"
    | "near-expiry"
    | "expired"
    | "recalled"
    | "quarantined"
    | "postponed-blocked";
}

export interface InventoryPosition {
  readonly balance: bigint;
  readonly batches: readonly InventoryBatchPosition[];
  readonly earliestExpiry: string | null;
  readonly expiredCount: bigint;
  readonly productId: string;
  readonly reconciliation: "consistent" | "mismatch";
  readonly totalBatchCount: bigint;
  readonly valueFils: bigint;
  readonly averageUnitCostScaled: bigint | null;
  readonly movementCount: bigint;
  readonly movements: readonly {
    readonly occurredAt: Date;
    readonly quantity: bigint;
  }[];
  readonly valuationQuantity: bigint;
  readonly valuationValueScaled: bigint;
}

export type InventoryMovementReason =
  | "purchase-adjustment"
  | "purchase-receipt"
  | "purchase-return"
  | "count-variance";

export function deriveInventoryValueFils(
  movements: readonly {
    readonly carryingAmountFils: bigint;
    readonly reason: InventoryMovementReason;
  }[],
  valueEffects: readonly bigint[],
): bigint {
  return (
    movements.reduce(
      (total, movement) =>
        total +
        (movement.reason === "purchase-adjustment"
          ? 0n
          : movement.carryingAmountFils),
      0n,
    ) + valueEffects.reduce((total, effect) => total + effect, 0n)
  );
}

interface InventoryPositionRow {
  readonly product_id: string;
  readonly balance: string;
  readonly value_fils: string;
  readonly total_batch_count: string;
  readonly earliest_expiry: string | null;
  readonly expired_count: string;
  readonly batches: unknown;
  readonly valuation_quantity: string;
  readonly valuation_value_scaled: string;
  readonly movement_count: string;
  readonly movement_facts: unknown;
}

/**
 * One statement deliberately supplies the complete inventory snapshot. The
 * renderer can sort this data locally, while PostgreSQL keeps movements,
 * batches, and valuation state mutually consistent for one read snapshot.
 * A cursor is the first change if the reference dataset exceeds roughly
 * 300ms.
 */
export async function readInventoryPositions(
  client: PoolClient,
  pharmacyId: string,
  businessDate: string,
  nearExpiryDays: ReadonlyMap<string, number>,
  options?: { readonly productIds?: readonly string[] },
): Promise<InventoryPosition[]> {
  const productIds = options?.productIds;
  if (productIds?.length === 0) return [];
  const nearExpiryDaysJson = JSON.stringify(Object.fromEntries(nearExpiryDays));
  const result = await client.query<InventoryPositionRow>(
    `with movement_totals as (
       select product_id,
              sum(quantity)::text as balance,
              sum(carrying_amount_fils) filter (
                where reason <> 'purchase-adjustment'
              )::text as value_fils,
              count(*)::text as movement_count
       from inventory_movements
       where pharmacy_id = $1
         and ($4::uuid[] is null or product_id = any($4))
       group by product_id
     ), value_effect_totals as (
       select product_id,
              sum(carrying_amount_delta_fils)::text as value_fils
       from inventory_value_effects
       where pharmacy_id = $1
         and ($4::uuid[] is null or product_id = any($4))
       group by product_id
     ), movement_facts as (
       select product_id,
              json_agg(
                json_build_object(
                  'occurredAt', occurred_at,
                  'quantity', quantity
                ) order by occurred_at, id
              ) as movement_facts
       from inventory_movements
       where pharmacy_id = $1
         and ($4::uuid[] is null or product_id = any($4))
         and reason not in (
           'purchase-adjustment', 'purchase-return', 'count-variance'
         )
         and quantity < 0
         and occurred_at >= now() - interval '90 days'
       group by product_id
     ), batch_movements as (
       select batch_id, sum(quantity)::text as balance
       from inventory_movements
       where pharmacy_id = $1
         and ($4::uuid[] is null or product_id = any($4))
       group by batch_id
     ), batch_positions as (
       select batch.id as batch_id,
              batch.product_id,
              batch.lot_number,
              batch.created_at,
              batch.expiry_date,
              coalesce(amendment.corrected_expiry_date, batch.expiry_date)
                as effective_expiry_date,
              case
                when status_event.kind = 'recalled' then 'recalled'
                when status_event.kind = 'quarantined' then 'quarantined'
                when coalesce(amendment.corrected_expiry_date, batch.expiry_date)
                     < $2::date then 'expired'
                when coalesce(amendment.corrected_expiry_date, batch.expiry_date)
                     is not null
                 and coalesce(amendment.corrected_expiry_date, batch.expiry_date)
                     <= $2::date + coalesce(($3::jsonb ->> batch.product_id::text)::integer, ${DEFAULT_NEAR_EXPIRY_DAYS})
                   then 'near-expiry'
                else 'eligible'
              end as status,
              coalesce(batch_movement.balance, '0') as balance
       from inventory_batches batch
       left join batch_movements batch_movement on batch_movement.batch_id = batch.id
       left join lateral (
         select amendment_row.corrected_expiry_date
         from inventory_batch_expiry_amendments amendment_row
         where amendment_row.pharmacy_id = batch.pharmacy_id
           and amendment_row.batch_id = batch.id
         order by amendment_row.sequence desc
         limit 1
       ) amendment on true
       left join lateral (
         select event.kind
         from inventory_batch_status_events event
         where event.pharmacy_id = batch.pharmacy_id
           and event.batch_id = batch.id
         order by event.sequence desc
         limit 1
       ) status_event on true
       where batch.pharmacy_id = $1
         and ($4::uuid[] is null or batch.product_id = any($4))
     ), batch_summaries as (
       select product_id,
              count(*)::text as total_batch_count,
              (min(effective_expiry_date) filter (
                where effective_expiry_date is not null and balance::bigint > 0
              ))::text as earliest_expiry,
              count(*) filter (
                where effective_expiry_date < $2::date and balance::bigint > 0
              )::text as expired_count,
              coalesce(
                json_agg(
                  json_build_object(
                  'balance', balance,
                  'batchId', batch_id,
                  'effectiveExpiryDate', effective_expiry_date,
                  'expiryDate', expiry_date,
                  'lotNumber', lot_number,
                  'status', status
                ) order by effective_expiry_date nulls last, created_at, batch_id
                ),
                '[]'::json
              ) as batches
       from batch_positions
       group by product_id
     )
     select movement.product_id,
            coalesce(movement.balance, '0') as balance,
            (
              coalesce(movement.value_fils, '0')::bigint
              + coalesce(value_effect.value_fils, '0')::bigint
            )::text as value_fils,
            coalesce(summary.total_batch_count, '0') as total_batch_count,
            summary.earliest_expiry,
            coalesce(summary.expired_count, '0') as expired_count,
            coalesce(summary.batches, '[]'::json) as batches,
            coalesce(facts.movement_facts, '[]'::json) as movement_facts,
            coalesce(valuation.total_quantity, 0)::text as valuation_quantity,
            coalesce(valuation.total_value_scaled, '0')::text as valuation_value_scaled,
            coalesce(movement.movement_count, '0') as movement_count
     from (
       select product_id from movement_totals
       union
       select product_id from value_effect_totals
       union
       select product_id from batch_summaries
       union
       select product_id from inventory_valuation_state
       where pharmacy_id = $1
         and ($4::uuid[] is null or product_id = any($4))
     ) product
     left join movement_totals movement on movement.product_id = product.product_id
     left join value_effect_totals value_effect
       on value_effect.product_id = product.product_id
     left join batch_summaries summary on summary.product_id = product.product_id
     left join movement_facts facts on facts.product_id = product.product_id
     left join inventory_valuation_state valuation
       on valuation.pharmacy_id = $1 and valuation.product_id = product.product_id
     order by product.product_id`,
    [pharmacyId, businessDate, nearExpiryDaysJson, productIds ?? null],
  );
  return result.rows.map((row) => {
    const batches = Array.isArray(row.batches)
      ? row.batches.map((batch) => {
          const value = batch as Record<string, unknown>;
          return {
            balance: BigInt(String(value.balance)),
            batchId: String(value.batchId),
            effectiveExpiryDate:
              value.effectiveExpiryDate === null
                ? null
                : String(value.effectiveExpiryDate),
            expiryDate:
              value.expiryDate === null ? null : String(value.expiryDate),
            lotNumber:
              value.lotNumber === null ? null : String(value.lotNumber),
            status: String(value.status) as InventoryBatchPosition["status"],
          };
        })
      : [];
    const movements = Array.isArray(row.movement_facts)
      ? row.movement_facts.map((movement) => {
          const value = movement as Record<string, unknown>;
          return {
            occurredAt: new Date(String(value.occurredAt)),
            quantity: BigInt(String(value.quantity)),
          };
        })
      : [];
    const balance = BigInt(row.balance);
    const valueFils = BigInt(row.value_fils);
    const valuationQuantity = BigInt(row.valuation_quantity);
    const valuationValueScaled = BigInt(row.valuation_value_scaled);
    return {
      averageUnitCostScaled: reportedAverageUnitCostScaled({
        totalQuantity: valuationQuantity,
        totalValueScaled: valuationValueScaled,
      }),
      balance,
      batches,
      earliestExpiry: row.earliest_expiry,
      expiredCount: BigInt(row.expired_count),
      movementCount: BigInt(row.movement_count),
      movements,
      productId: row.product_id,
      reconciliation:
        balance === valuationQuantity &&
        valueFils * 10n ** 10n === valuationValueScaled
          ? "consistent"
          : "mismatch",
      totalBatchCount: BigInt(row.total_batch_count),
      valueFils,
      valuationQuantity,
      valuationValueScaled,
    };
  });
}

export interface ProductMovement {
  readonly batchId: string;
  readonly carryingAmountFils: bigint;
  readonly id: string;
  readonly occurredAt: Date;
  readonly productId: string;
  readonly quantity: bigint;
  readonly reason: InventoryMovementReason;
  readonly userId: string;
  readonly sourceDocumentId: string;
  readonly sourceDocumentType:
    | "purchase-adjustment"
    | "purchase-invoice"
    | "purchase-return"
    | "count-session";
  readonly sourceRowOrdinal: number;
}

export async function readProductMovements(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<ProductMovement[]> {
  const result = await client.query<{
    batch_id: string;
    carrying_amount_fils: string;
    id: string;
    occurred_at: string;
    product_id: string;
    quantity: string;
    reason: InventoryMovementReason;
    source_document_id: string;
    source_document_type:
      | "purchase-adjustment"
      | "purchase-invoice"
      | "purchase-return"
      | "count-session";
    source_row_ordinal: number;
    created_by: string;
  }>(
    `select movement.id, movement.product_id, movement.batch_id,
            movement.reason, movement.quantity::text,
            movement.carrying_amount_fils::text, movement.source_document_type,
            movement.source_document_id, movement.source_row_ordinal,
            movement.occurred_at::text, movement.created_by
     from inventory_movements movement
     where movement.pharmacy_id = $1 and movement.product_id = $2
     order by movement.occurred_at, movement.id`,
    [pharmacyId, productId],
  );
  return result.rows.map((row) => ({
    batchId: row.batch_id,
    carryingAmountFils: BigInt(row.carrying_amount_fils),
    id: row.id,
    occurredAt: new Date(row.occurred_at),
    productId: row.product_id,
    quantity: BigInt(row.quantity),
    reason: mapInventoryMovementReason(row.reason),
    sourceDocumentId: row.source_document_id,
    sourceDocumentType: row.source_document_type,
    sourceRowOrdinal: row.source_row_ordinal,
    userId: row.created_by,
  }));
}

function mapInventoryMovementReason(
  reason: InventoryMovementReason,
): InventoryMovementReason {
  switch (reason) {
    case "purchase-adjustment":
    case "purchase-receipt":
    case "purchase-return":
    case "count-variance":
      return reason;
    default:
      return assertNever(reason);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected inventory movement value: ${String(value)}`);
}
