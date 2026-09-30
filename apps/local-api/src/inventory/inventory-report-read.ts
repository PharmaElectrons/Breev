import type { PoolClient } from "pg";
import { reportedAverageUnitCostScaled } from "./inventory-valuation.js";
import type { InventoryMovementReason } from "./inventory-review.js";

// A failed bounded read never yields a partial report or export. No persistent analytics state.
export const INVENTORY_REPORT_FACT_LIMIT = 250_000;
export class InventoryReportTooLarge extends Error {}
export interface InventoryReportFact {
  readonly id: string;
  readonly productId: string;
  readonly batchId: string | null;
  readonly quantity: bigint;
  readonly valueFils: bigint;
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly reason: InventoryMovementReason;
  readonly source: {
    readonly id: string;
    readonly type:
      | "purchase-invoice"
      | "purchase-adjustment"
      | "purchase-return"
      | "count-session";
    readonly ordinal: number;
  };
  readonly movementId: string | null;
}
export interface HistoricalBatch {
  readonly id: string;
  readonly productId: string;
  readonly lot: string | null;
  readonly expiry: string | null;
  readonly events: readonly {
    readonly id: string;
    readonly kind: "expiry-amendment" | "expired" | "recalled" | "quarantined";
    readonly actorId: string | null;
    readonly occurredAt: Date;
    readonly businessDate: string;
    readonly source: "user" | "daily-evaluator";
  }[];
  readonly status: "eligible" | "expired" | "recalled" | "quarantined";
}
export interface AppliedCountReportFact {
  readonly id: string;
  readonly productId: string;
  readonly sessionId: string;
  readonly ordinal: number;
  readonly item: string;
  readonly unit: string;
  readonly observedQuantity: bigint;
  readonly countedQuantity: bigint;
  readonly variance: bigint;
  readonly valueFils: bigint;
  readonly actorId: string;
  readonly appliedAt: Date;
  readonly movementIds: readonly string[];
}
export interface InventoryReportFacts {
  readonly facts: readonly InventoryReportFact[];
  readonly batches: readonly HistoricalBatch[];
  readonly counts: readonly AppliedCountReportFact[];
  readonly countMetadata: ReadonlyMap<
    string,
    {
      readonly item: string;
      readonly unit: string;
      readonly label: string;
      readonly businessDate: null;
      readonly originalDocumentId: null;
    }
  >;
}

/** Only append-only Inventory facts are read; mutable catalog/policy/valuation state is excluded. */
export async function readInventoryReportFacts(
  client: PoolClient,
  pharmacyId: string,
  to: Date,
  businessDate: string,
): Promise<InventoryReportFacts> {
  const result = await client.query<{
    id: string;
    product_id: string;
    batch_id: string | null;
    quantity: string;
    value_fils: string;
    occurred_at: Date;
    created_by: string;
    reason: InventoryMovementReason;
    source_document_id: string;
    source_document_type: InventoryReportFact["source"]["type"];
    source_row_ordinal: number;
    movement_id: string | null;
  }>(
    `select * from (
      select id, product_id, batch_id, quantity::text,
             (case when reason = 'purchase-adjustment' then 0 else carrying_amount_fils end)::text as value_fils,
             occurred_at, created_by, reason, source_document_id, source_document_type, source_row_ordinal, id as movement_id
      from inventory_movements where pharmacy_id = $1 and occurred_at < $2
      union all
      select id, product_id, batch_id, '0'::text, carrying_amount_delta_fils::text,
             occurred_at, created_by, 'purchase-adjustment', source_document_id, source_document_type, source_row_ordinal, null::uuid
      from inventory_value_effects where pharmacy_id = $1 and occurred_at < $2
    ) fact order by occurred_at, id limit $3`,
    [pharmacyId, to, INVENTORY_REPORT_FACT_LIMIT + 1],
  );
  if (result.rows.length > INVENTORY_REPORT_FACT_LIMIT)
    throw new InventoryReportTooLarge();
  const facts = result.rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    batchId: r.batch_id,
    quantity: BigInt(r.quantity),
    valueFils: BigInt(r.value_fils),
    occurredAt: r.occurred_at,
    actorId: r.created_by,
    reason: r.reason,
    source: {
      id: r.source_document_id,
      type: r.source_document_type,
      ordinal: r.source_row_ordinal,
    },
    movementId: r.movement_id,
  }));
  const batchResult = await client.query<{
    id: string;
    product_id: string;
    lot_number: string | null;
    expiry: string | null;
    status: HistoricalBatch["status"];
    events: unknown;
  }>(
    `select batch.id, batch.product_id, batch.lot_number,
            coalesce(amendment.corrected_expiry_date, batch.expiry_date)::text as expiry,
            case when status.kind in ('recalled', 'quarantined') then status.kind
                 when coalesce(amendment.corrected_expiry_date, batch.expiry_date) < $3::date then 'expired' else 'eligible' end as status,
            coalesce(events.facts, '[]'::json) as events
     from inventory_batches batch
     left join lateral (
       select corrected_expiry_date from inventory_batch_expiry_amendments
       where pharmacy_id = $1 and batch_id = batch.id and occurred_at < $2 order by sequence desc limit 1
     ) amendment on true
     left join lateral (
       select kind from inventory_batch_status_events
       where pharmacy_id = $1 and batch_id = batch.id and occurred_at < $2 order by sequence desc limit 1
     ) status on true
     left join lateral (
       select json_agg(event order by event."occurredAt", event.id) as facts from (
         select id, kind, created_by as "actorId", occurred_at as "occurredAt", business_date::text as "businessDate", source
         from inventory_batch_status_events where pharmacy_id = $1 and batch_id = batch.id and occurred_at < $2
         union all
         select id, 'expiry-amendment', created_by, occurred_at, business_date::text, 'user'
         from inventory_batch_expiry_amendments where pharmacy_id = $1 and batch_id = batch.id and occurred_at < $2
       ) event
     ) events on true
     where batch.pharmacy_id = $1 and batch.created_at < $2 order by batch.id limit $4`,
    [pharmacyId, to, businessDate, INVENTORY_REPORT_FACT_LIMIT + 1],
  );
  if (batchResult.rows.length > INVENTORY_REPORT_FACT_LIMIT)
    throw new InventoryReportTooLarge();
  const batches = batchResult.rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    lot: r.lot_number,
    expiry: r.expiry,
    status: r.status,
    events: (
      r.events as (Omit<HistoricalBatch["events"][number], "occurredAt"> & {
        occurredAt: string;
      })[]
    ).map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })),
  }));
  const countResult = await client.query<{
    id: string;
    product_id: string;
    session_id: string;
    ordinal: number;
    item_display_name: string;
    inventory_unit_name: string;
    balance_at_observation: string;
    counted_quantity: string;
    variance: string;
    carrying_amount_fils: string;
    applied_by: string;
    applied_at: Date;
  }>(
    `select application.id, application.product_id, application.session_id, line.ordinal,
             line.item_display_name, line.inventory_unit_name, line.balance_at_observation::text,
             application.counted_quantity::text, application.variance::text, application.carrying_amount_fils::text,
             application.applied_by, application.applied_at
      from inventory_count_variance_applications application
      join inventory_count_lines line on line.pharmacy_id = application.pharmacy_id and line.id = application.line_id
      where application.pharmacy_id = $1 and application.applied_at < $2 order by application.applied_at, application.id limit $3`,
    [pharmacyId, to, INVENTORY_REPORT_FACT_LIMIT + 1],
  );
  if (countResult.rows.length > INVENTORY_REPORT_FACT_LIMIT)
    throw new InventoryReportTooLarge();
  const countMovementIds = new Map<string, string[]>();
  for (const fact of facts) {
    if (fact.source.type !== "count-session" || fact.movementId === null)
      continue;
    const key = `${fact.source.id}:${fact.source.ordinal}`;
    const ids = countMovementIds.get(key) ?? [];
    ids.push(fact.movementId);
    countMovementIds.set(key, ids);
  }
  const counts = countResult.rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    sessionId: r.session_id,
    ordinal: r.ordinal,
    item: r.item_display_name,
    unit: r.inventory_unit_name,
    observedQuantity: BigInt(r.balance_at_observation),
    countedQuantity: BigInt(r.counted_quantity),
    variance: BigInt(r.variance),
    valueFils: BigInt(r.carrying_amount_fils),
    actorId: r.applied_by,
    appliedAt: r.applied_at,
    movementIds: countMovementIds.get(`${r.session_id}:${r.ordinal}`) ?? [],
  }));
  return {
    facts,
    batches,
    counts,
    countMetadata: new Map(
      counts.map((c) => [
        `${c.sessionId}:${c.ordinal}`,
        {
          item: c.item,
          unit: c.unit,
          label: `Count session ${c.sessionId} · ${c.ordinal}`,
          businessDate: null,
          originalDocumentId: null,
        },
      ]),
    ),
  };
}

export interface HistoricalPosition {
  readonly openingQuantity: bigint;
  readonly closingQuantity: bigint;
  readonly periodQuantity: bigint;
  readonly openingValueFils: bigint;
  readonly closingValueFils: bigint;
  readonly periodValueFils: bigint;
  readonly openingAverageCostScaled: bigint | null;
  readonly closingAverageCostScaled: bigint | null;
}
/** Values are sums of frozen carrying amounts; WAC is calculated here, never replayed by Reporting. */
export function historicalPosition(
  facts: readonly InventoryReportFact[],
  from: Date,
): HistoricalPosition {
  let openingQuantity = 0n,
    openingValueFils = 0n,
    closingQuantity = 0n,
    closingValueFils = 0n;
  for (const fact of facts) {
    closingQuantity += fact.quantity;
    closingValueFils += fact.valueFils;
    if (fact.occurredAt < from) {
      openingQuantity += fact.quantity;
      openingValueFils += fact.valueFils;
    }
  }
  const average = (quantity: bigint, value: bigint) =>
    reportedAverageUnitCostScaled({
      totalQuantity: quantity,
      totalValueScaled: value * 10n ** 10n,
    });
  return {
    openingQuantity,
    closingQuantity,
    periodQuantity: closingQuantity - openingQuantity,
    openingValueFils,
    closingValueFils,
    periodValueFils: closingValueFils - openingValueFils,
    openingAverageCostScaled: average(openingQuantity, openingValueFils),
    closingAverageCostScaled: average(closingQuantity, closingValueFils),
  };
}
