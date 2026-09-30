import type { PoolClient } from "pg";
import {
  INVENTORY_REPORT_DEFINITIONS,
  type InventoryReportKind,
  type InventoryReportQuery,
  type InventoryReportRow,
  type InventoryReport,
  type InventoryReportActivityPage,
} from "@breev/contracts/local-rest";

export interface InventoryReportPage {
  readonly rows: InventoryReportRow[];
  readonly totalRows: number;
  readonly groups: InventoryReport["groups"];
  readonly actors: InventoryReport["actors"];
}
export class InventoryReportExportTooLarge extends Error {}
const numericColumn = (column: string) =>
  /Quantity|Fils|Scaled|Per30Days/u.test(column);

/** Inventory owns aggregation of frozen quantities/values. Only SQL aggregates
 * and selected rows cross this seam; lifetime facts never enter application memory.
 * All interpolated names come from runtime-validated contract enums. */
function reportSql(kind: InventoryReportKind, query: InventoryReportQuery) {
  const batches = kind === "batches-expiry" || kind === "alerts";
  const source = `jsonb_build_object('documentId', f.source_document_id, 'documentType', f.source_document_type,
    'originalDocumentId', f.original_document_id, 'label', f.label, 'openable', false)`;
  const stamp = (expression: string) =>
    `to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const attributed = (
    alias: string,
  ) => `($4::uuid is null or ${alias}.actor_id = $4)
    and ($5::date is null or ${alias}.business_date >= $5)
    and ($6::date is null or ${alias}.business_date <= $6)`;
  const sort = numericColumn(query.sort)
    ? `(cells->>'${query.sort}')::numeric`
    : `cells->>'${query.sort}'`;
  const filters =
    query.filters
      .map((filter, index) => {
        const param = `$${8 + index}`;
        const value = `cells->>'${filter.column}'`;
        if (filter.operator === "contains")
          return `position(lower(normalize(${param}::text, NFKC)) in lower(normalize(${value}, NFKC))) > 0`;
        if (filter.operator === "eq") return `${value} = ${param}::text`;
        return `(${value})::numeric ${filter.operator === "gte" ? ">=" : "<="} ${param}::numeric`;
      })
      .join(" and ") || "true";
  const positionCells = `jsonb_build_object(
    'openingQuantity', p.oq::text, 'closingQuantity', p.cq::text, 'periodQuantity', (p.cq-p.oq)::text,
    'activityQuantity', coalesce(a.quantity, 0)::text
    ${
      kind === "value"
        ? `, 'openingValueFils', p.ov::text, 'closingValueFils', p.cv::text,
    'periodValueFils', (p.cv-p.ov)::text, 'activityValueFils', coalesce(a.value, 0)::text`
        : ""
    }
    ${
      kind === "average-cost"
        ? `, 'openingAverageCostScaled', case when p.oq > 0 then round(p.ov*10000000000/p.oq)::text else null end,
      'closingAverageCostScaled', case when p.cq > 0 then round(p.cv*10000000000/p.cq)::text else null end`
        : ""
    }
    ${kind === "consumption" ? ", 'consumedQuantity', '0', 'consumptionPer30Days', '0'" : ""})`;
  return `with report_date as (select $7::date), facts as materialized (
    select * from inventory_report_facts where pharmacy_id = $1 and posted_at < $3::timestamptz
      ${kind === "stocktake-movements" ? "and source_document_type = 'count-session' and posted_at >= $2::timestamptz" : ""}
  ), activity as (
    select f.id, f.product_id, f.batch_id, f.application_id, f.movement_id, f.quantity, f.value_fils,
           f.posted_at, f.actor_id, f.business_date, coalesce(actor.display_name, f.actor_id::text) as actor,
           ${source} as source, f.reason
    from facts f left join identity_report_actors actor on actor.pharmacy_id = $1 and actor.id = f.actor_id
    where f.posted_at >= $2::timestamptz and ${attributed("f")}
    ${
      batches
        ? `union all
    select event.id, batch.product_id, event.batch_id, null::uuid, null::uuid, 0, null::bigint, event.occurred_at, event.actor_id,
           event.business_date, coalesce(actor.display_name, event.actor_id::text, 'system'), null::jsonb, event.kind
    from (
      select id, batch_id, occurred_at, created_by as actor_id, business_date, kind
      from inventory_batch_status_events where pharmacy_id = $1
      union all select id, batch_id, occurred_at, created_by, business_date, 'expiry-amendment'
      from inventory_batch_expiry_amendments where pharmacy_id = $1
    ) event join inventory_batches batch on batch.pharmacy_id = $1 and batch.id = event.batch_id
    left join identity_report_actors actor on actor.pharmacy_id = $1 and actor.id = event.actor_id
    where event.occurred_at >= $2::timestamptz and event.occurred_at < $3::timestamptz and ${attributed("event")}`
        : ""
    }
  ), positions as materialized (
    -- Aggregate once; joining sparse source dimensions must not recalculate
    -- lifetime positions for each batch. Introduction belongs to this aggregate.
    select ${batches ? "batch_id" : "product_id"} as id, product_id,
      coalesce(sum(quantity) filter (where posted_at < $2::timestamptz), 0) as oq, sum(quantity) as cq,
      coalesce(sum(value_fils) filter (where posted_at < $2::timestamptz), 0) as ov, sum(value_fils) as cv
      ${batches ? ", bool_or(reason in ('purchase-receipt', 'purchase-adjustment') and quantity > 0) as introduced" : ""}
    from facts group by ${batches ? "batch_id, " : ""}product_id
  ), latest as (
    select distinct on (${batches ? "f.batch_id" : "f.product_id"})
      ${batches ? "f.batch_id" : "f.product_id"} as id, f.item, f.unit, ${source} as source
    from facts f order by ${batches ? "f.batch_id" : "f.product_id"}, f.posted_at desc, f.id desc
  ), activity_totals as (
    select ${kind === "stocktake-movements" ? "application_id" : batches ? "batch_id" : "product_id"} as id,
      count(*)::integer as count, sum(quantity) as quantity, sum(value_fils) as value
    from activity group by ${kind === "stocktake-movements" ? "application_id" : batches ? "batch_id" : "product_id"}
  ), latest_activity as (
    select distinct on (${batches ? "batch_id" : "product_id"})
      ${batches ? "batch_id" : "product_id"} as id, actor, posted_at, business_date, source
    from activity order by ${batches ? "batch_id" : "product_id"}, posted_at desc, activity.id desc
  )${
    batches
      ? `, batches as (
    select batch.id, batch.lot_number, coalesce(amendment.corrected_expiry_date, batch.expiry_date) as expiry,
      case when status.kind in ('recalled', 'quarantined') then status.kind
        when coalesce(amendment.corrected_expiry_date, batch.expiry_date) < $7::date then 'expired' else 'eligible' end as status
    from inventory_batches batch
    left join lateral (select corrected_expiry_date from inventory_batch_expiry_amendments
      where pharmacy_id = $1 and batch_id = batch.id and occurred_at < $3::timestamptz order by sequence desc limit 1) amendment on true
    left join lateral (select kind from inventory_batch_status_events
      where pharmacy_id = $1 and batch_id = batch.id and occurred_at < $3::timestamptz order by sequence desc limit 1) status on true
    where batch.pharmacy_id = $1
  )`
      : ""
  }, raw_rows as (
    ${
      kind === "stocktake-movements"
        ? `select application.id::text as id, application.product_id, null::uuid as batch_id,
      coalesce(a.count, 0) as activity_count,
      jsonb_build_object('documentId', application.session_id, 'documentType', 'count-session', 'originalDocumentId', null,
        'label', 'Count session ' || application.session_id || ' · ' || line.ordinal, 'openable', false) as source,
      jsonb_build_object('item', line.item_display_name, 'unit', line.inventory_unit_name,
        'observedQuantity', line.balance_at_observation::text, 'countedQuantity', application.counted_quantity::text,
        'activityQuantity', application.variance::text, 'activityValueFils', application.carrying_amount_fils::text,
        'actor', coalesce(actor.display_name, application.applied_by::text), 'postedAt', ${stamp("application.applied_at")},
        'businessDate', null, 'source', 'Count session ' || application.session_id || ' · ' || line.ordinal) as cells
    from inventory_count_variance_applications application
    join inventory_count_lines line on line.pharmacy_id = $1 and line.id = application.line_id
    left join identity_report_actors actor on actor.pharmacy_id = $1 and actor.id = application.applied_by
    left join activity_totals a on a.id = application.id
    where application.pharmacy_id = $1 and application.applied_at >= $2::timestamptz and application.applied_at < $3::timestamptz
      and ($4::uuid is null or application.applied_by = $4) and $5::date is null and $6::date is null`
        : `
    select p.id::text${kind === "alerts" ? " || ':' || batch.status" : ""} as id, p.product_id,
      ${batches ? "p.id" : "null::uuid"} as batch_id, coalesce(a.count, 0) as activity_count, l.source,
      jsonb_build_object('item', l.item, 'unit', l.unit) ||
      ${
        kind === "alerts"
          ? `jsonb_build_object('closingQuantity', p.cq::text,
        'alert', batch.status, 'availability', 'available')`
          : positionCells
      }
      ${
        batches
          ? `|| jsonb_build_object('batch', batch.lot_number, 'expiry', batch.expiry::text,
        ${kind === "batches-expiry" ? "'status', batch.status," : ""}
        'actor', la.actor, 'postedAt', ${stamp("la.posted_at")}, 'businessDate', la.business_date::text, 'source', la.source->>'label')`
          : ""
      } as cells
    from positions p join latest l on l.id = p.id
    left join activity_totals a on a.id = p.id
    ${
      batches
        ? `join batches batch on batch.id = p.id and p.introduced left join latest_activity la on la.id = p.id
    where (($4::uuid is null and $5::date is null and $6::date is null) or coalesce(a.count, 0) > 0)
    ${kind === "alerts" ? "and batch.status <> 'eligible' and p.cq > 0" : ""}`
        : ""
    }
    ${
      kind === "alerts"
        ? `union all
    select product_id::text || ':policy', product_id, null::uuid, 0, null::jsonb,
      jsonb_build_object('item', l.item, 'unit', l.unit, 'closingQuantity', sum(p.cq)::text,
        'alert', 'historical-policy', 'availability', 'historical-policy-unavailable')
    from positions p join lateral (select item, unit from facts f where f.product_id = p.product_id order by posted_at desc, id desc limit 1) l on true
    group by product_id, l.item, l.unit`
        : ""
    }`
    }
  ), filtered as (
    select *, row_number() over (order by ${sort} ${query.direction === "ascending" ? "asc" : "desc"} nulls last, id) as ordinal
    from raw_rows where ${filters}
  )`;
}
function params(
  pharmacyId: string,
  query: InventoryReportQuery & { from: string; to: string },
  businessDate: string,
) {
  return [
    pharmacyId,
    query.from,
    query.to,
    query.actorId ?? null,
    query.businessFrom ?? null,
    query.businessTo ?? null,
    businessDate,
    ...query.filters.map((f) => f.value),
  ];
}

export async function readInventoryReportPage(
  client: PoolClient,
  pharmacyId: string,
  kind: InventoryReportKind,
  query: InventoryReportQuery & { from: string; to: string },
  businessDate: string,
  exportAll: boolean,
  maximumExportBytes: number,
  valuation = true,
): Promise<InventoryReportPage> {
  const values = params(pharmacyId, query, businessDate);
  const start = (query.page - 1) * query.pageSize;
  const group = query.groupBy;
  const groupedColumns = INVENTORY_REPORT_DEFINITIONS[kind].columns.filter(
    (c) =>
      ["activityQuantity", "activityValueFils", "consumedQuantity"].includes(c),
  );
  const sql = `${reportSql(kind, query)}, page as (
    select * from filtered ${exportAll ? "" : `where ordinal > ${start} and ordinal <= ${start + query.pageSize}`}
  )${
    group === undefined
      ? ""
      : `, group_totals as (
    select jsonb_build_array(cells->>'${group}', product_id, cells->>'unit')::text as id,
      cells->>'${group}' as key, product_id, min(cells->>'item') as item, cells->>'unit' as unit,
      count(*) as row_count, min(ordinal) as first, max(ordinal) as last,
      jsonb_build_object(${groupedColumns.flatMap((c) => [`'${c}'`, `sum(coalesce((cells->>'${c}')::numeric, 0))::text`]).join(",")}) as totals
    from filtered group by cells->>'${group}', product_id, cells->>'unit'
  ), page_groups as (
    select g.id, g.key, g.product_id as "productId", g.item, g.unit, g.row_count as "rowCount", g.totals,
      jsonb_agg(p.id order by p.ordinal) as "rowIds",
      ${exportAll ? "false" : `g.first <= ${start}`} as "continuesBefore",
      ${exportAll ? "false" : `g.last > ${start + query.pageSize}`} as "continuesAfter"
    from group_totals g join page p on g.id = jsonb_build_array(p.cells->>'${group}', p.product_id, p.cells->>'unit')::text
    group by g.id, g.key, g.product_id, g.item, g.unit, g.row_count, g.totals, g.first, g.last
  )`
  }, payload as (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'productId', product_id, 'batchId', batch_id,
      'activityCount', activity_count, 'source', source, 'cells', ${valuation ? "cells" : "cells - array['openingValueFils','closingValueFils','periodValueFils','activityValueFils','openingAverageCostScaled','closingAverageCostScaled']"}) order by ordinal), '[]'::jsonb) as rows from page
  )
  select ${exportAll ? `case when octet_length(payload.rows::text) <= ${maximumExportBytes} then payload.rows else null end` : "payload.rows"} as rows,
    (select count(*)::integer from filtered) as "totalRows",
    ${group === undefined ? "'[]'::jsonb" : "coalesce((select jsonb_agg(to_jsonb(g) order by id) from page_groups g), '[]'::jsonb)"} as groups,
    coalesce((select jsonb_agg(to_jsonb(actor) order by actor."displayName", actor.id) from (
      select distinct a.actor_id as id, a.actor as "displayName" from activity a where a.actor_id is not null
      order by "displayName", id limit 100
    ) actor), '[]'::jsonb) as actors
  from payload`;
  const result = await client.query<InventoryReportPage>(sql, values);
  const page = result.rows[0]!;
  if (page.rows === null) throw new InventoryReportExportTooLarge();
  return page;
}

export async function readInventoryReportActivity(
  client: PoolClient,
  pharmacyId: string,
  kind: InventoryReportKind,
  query: InventoryReportQuery & { from: string; to: string },
  businessDate: string,
  rowId: string,
  page: number,
  pageSize: number,
): Promise<InventoryReportActivityPage> {
  const values = params(pharmacyId, query, businessDate);
  values.push(rowId);
  const rowParam = `$${values.length}`;
  const condition =
    kind === "stocktake-movements"
      ? "a.application_id::text = r.id"
      : kind === "alerts" || kind === "batches-expiry"
        ? "a.batch_id = r.batch_id"
        : "a.product_id = r.product_id";
  const result = await client.query<{
    rows: InventoryReportActivityPage["rows"];
    totalRows: number;
  }>(
    `${reportSql(kind, query)}, selected as (
      select a.* from activity a join filtered r on r.id = ${rowParam} and ${condition}
    ), page as (select * from selected order by posted_at, id limit ${pageSize} offset ${(page - 1) * pageSize})
    select coalesce((select jsonb_agg(jsonb_build_object('id', id, 'movementId', movement_id, 'quantity', quantity::text, 'valueFils', value_fils::text,
      'postedAt', to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'businessDate', business_date::text, 'actorId', actor_id, 'actor', actor, 'source', source, 'reason', reason)
      order by posted_at, id) from page), '[]'::jsonb) as rows,
      (select count(*)::integer from selected) as "totalRows"`,
    values,
  );
  const resultPage = result.rows[0]!;
  return {
    ...resultPage,
    page,
    hasMore: page * pageSize < resultPage.totalRows,
  };
}
