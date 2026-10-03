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

function matchingBatchPredicates(
  kind: InventoryReportKind,
  query: InventoryReportQuery,
) {
  if (kind !== "batches-expiry") return [];
  return query.filters.flatMap((filter, index) => {
    const parameter = `$${8 + index}::text`;
    if (filter.column !== "batch") return [];
    if (filter.operator === "eq") return [`lot_number = ${parameter}`];
    if (filter.operator === "contains")
      return [
        `position(lower(normalize(${parameter}, NFKC)) in lower(normalize(lot_number, NFKC))) > 0`,
      ];
    return [];
  });
}

/** Reject provably oversized batch exports before balances, row JSON or sorting.
 * A positive historical receipt guarantees membership. Empty cell strings and
 * source labels give a conservative byte lower bound, never a row-count cap.
 * More selective queries retain the exact size check below. */
async function checkBatchExportSize(
  client: PoolClient,
  pharmacyId: string,
  query: InventoryReportQuery & { from: string; to: string },
  maximumExportBytes: number,
) {
  if (
    query.actorId !== undefined ||
    query.businessFrom !== undefined ||
    query.businessTo !== undefined ||
    query.filters.some(
      (f) => f.column !== "batch" || !["contains", "eq"].includes(f.operator),
    )
  )
    return;
  const uuid = "0".repeat(36);
  const minimumRowBytes = Buffer.byteLength(
    JSON.stringify({
      id: uuid,
      productId: uuid,
      batchId: uuid,
      activityCount: 0,
      source: {
        documentId: uuid,
        documentType: "",
        originalDocumentId: "",
        label: "",
        openable: true,
      },
      cells: Object.fromEntries(
        INVENTORY_REPORT_DEFINITIONS["batches-expiry"].columns.map((c) => [
          c,
          "",
        ]),
      ),
    }),
  );
  const filters = query.filters.map((f, i) =>
    f.operator === "eq"
      ? `batch.lot_number = $${i + 3}::text`
      : `position(lower(normalize($${i + 3}::text, NFKC)) in lower(normalize(batch.lot_number, NFKC))) > 0`,
  );
  const result = await client.query<{ bytes: string | null }>(
    `with introduced as (
      select distinct movement.batch_id from inventory_movements movement
      join purchasing_report_sources source on source.pharmacy_id = $1
        and source.id = movement.source_document_id and source.type = movement.source_document_type
        and source.ordinal = movement.source_row_ordinal
      where movement.pharmacy_id = $1 and movement.quantity > 0
        and movement.reason in ('purchase-receipt', 'purchase-adjustment') and source.posted_at < $2::timestamptz
    ) select sum(${minimumRowBytes} + octet_length(to_jsonb(batch.lot_number)::text) - 2)::text as bytes
      from inventory_batches batch join introduced on introduced.batch_id = batch.id
      where batch.pharmacy_id = $1 ${filters.length === 0 ? "" : `and ${filters.join(" and ")}`}`,
    [pharmacyId, query.to, ...query.filters.map((f) => f.value)],
  );
  if (BigInt(result.rows[0]!.bytes ?? "0") > BigInt(maximumExportBytes))
    throw new InventoryReportExportTooLarge();
}

/** Inventory owns aggregation of frozen quantities/values. Only SQL aggregates
 * and selected rows cross this seam; lifetime facts never enter application memory.
 * All interpolated names come from runtime-validated contract enums. */
function reportSql(
  kind: InventoryReportKind,
  query: InventoryReportQuery,
  rowParam?: string,
) {
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
  const sort =
    query.sort === "item"
      ? "sort_item"
      : numericColumn(query.sort)
        ? `(cells->>'${query.sort}')::numeric`
        : `cells->>'${query.sort}'`;
  const filters =
    query.filters
      .map((filter, index) => {
        // These predicates already selected immutable batch IDs before balances.
        // Reapplying them to JSON cells would rebuild and normalize every row.
        if (
          kind === "batches-expiry" &&
          filter.column === "batch" &&
          ["contains", "eq"].includes(filter.operator)
        )
          return "true";
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
  const batchPredicates = matchingBatchPredicates(kind, query);
  const rowSelection =
    rowParam === undefined
      ? "true"
      : kind === "stocktake-movements"
        ? `application_id = ${rowParam}::uuid`
        : batches
          ? `(batch_id = split_part(${rowParam}::text, ':', 1)::uuid ${kind === "alerts" ? `or (${rowParam}::text like '%:policy' and product_id = split_part(${rowParam}::text, ':', 1)::uuid)` : ""})`
          : `product_id = ${rowParam}::uuid`;
  const selectedFact =
    batchPredicates.length === 0
      ? rowSelection
      : `(${rowSelection}) and batch_id in (select id from matching_batches)`;
  const selectedLedger = selectedFact.replaceAll(
    "application_id",
    "null::uuid",
  );
  // Collapse repeated allocations before joining immutable document labels.
  // Balances still include every effect before To; attribution applies only to activity.
  return `with report_date as (select $7::date)${
    batchPredicates.length === 0
      ? ""
      : `, matching_batches as materialized (
    select id from inventory_batches where pharmacy_id = $1 and ${batchPredicates.join(" and ")}
  )`
  }, allocations as (
    select max(id::text)::uuid as id, product_id, ${batches ? "batch_id" : "null::uuid as batch_id"},
      source_document_id, source_document_type, source_row_ordinal, reason,
      sum(quantity) as quantity,
      sum(case when reason = 'purchase-adjustment' then 0 else carrying_amount_fils end) as value_fils,
      count(*) as fact_count
    from inventory_movements where pharmacy_id = $1 and source_document_type <> 'count-session' and ${selectedLedger}
    group by product_id, ${batches ? "batch_id," : ""} source_document_id, source_document_type, source_row_ordinal, reason
    union all
    select max(id::text)::uuid, product_id, ${batches ? "batch_id" : "null::uuid"},
      source_document_id, source_document_type, source_row_ordinal, 'purchase-adjustment',
      0, sum(carrying_amount_delta_fils), count(*)
    from inventory_value_effects where pharmacy_id = $1 and ${selectedLedger}
    group by product_id, ${batches ? "batch_id," : ""} source_document_id, source_document_type, source_row_ordinal
  ), facts as materialized (
    select allocation.*, source.posted_at, source.actor_id, source.item, source.unit,
      source.business_date, source.original_document_id, source.label,
      null::uuid as movement_id, null::uuid as application_id
    from allocations allocation join purchasing_report_sources source
      on source.pharmacy_id = $1 and source.id = allocation.source_document_id
      and source.type = allocation.source_document_type and source.ordinal = allocation.source_row_ordinal
    where source.posted_at < $3::timestamptz ${kind === "stocktake-movements" ? "and false" : ""}
    union all
    select id, product_id, ${batches ? "batch_id" : "null::uuid"}, source_document_id, source_document_type, source_row_ordinal,
      reason, quantity, value_fils, 1, posted_at, actor_id, item, unit, business_date, original_document_id, label, movement_id, application_id
    from inventory_report_facts where pharmacy_id = $1 and source_document_type = 'count-session'
      and posted_at < $3::timestamptz and ${selectedFact}
      ${kind === "stocktake-movements" ? "and posted_at >= $2::timestamptz" : ""}
  ), activity as (
    select f.id, f.product_id, f.batch_id, f.application_id, f.movement_id, f.quantity, f.value_fils,
           f.posted_at, f.actor_id, f.business_date, coalesce(actor.display_name, f.actor_id::text) as actor,
           ${source} as source, f.reason, f.fact_count
    from facts f left join identity_report_actors actor on actor.pharmacy_id = $1 and actor.id = f.actor_id
    where f.posted_at >= $2::timestamptz and ${attributed("f")}
    ${
      batches
        ? `union all
    select event.id, batch.product_id, event.batch_id, null::uuid, null::uuid, 0, null::bigint, event.occurred_at, event.actor_id,
           event.business_date, coalesce(actor.display_name, event.actor_id::text, 'system'), null::jsonb, event.kind, 1
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
      sum(fact_count)::integer as count, sum(quantity) as quantity, sum(value_fils) as value
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
    left join (select distinct on (batch_id) batch_id, corrected_expiry_date from inventory_batch_expiry_amendments
      where pharmacy_id = $1 and occurred_at < $3::timestamptz order by batch_id, sequence desc) amendment on amendment.batch_id = batch.id
    left join (select distinct on (batch_id) batch_id, kind from inventory_batch_status_events
      where pharmacy_id = $1 and occurred_at < $3::timestamptz order by batch_id, sequence desc) status on status.batch_id = batch.id
    where batch.pharmacy_id = $1
  )`
      : ""
  }, raw_rows as (
    ${
      kind === "stocktake-movements"
        ? `select application.id::text as id, application.product_id, null::uuid as batch_id, line.item_display_name as sort_item,
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
    select p.id::text${kind === "alerts" ? " || ':' || batch.status" : ""} as id, p.product_id, l.item as sort_item,
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
    select product_id::text || ':policy', product_id, l.item, null::uuid, 0, null::jsonb,
      jsonb_build_object('item', l.item, 'unit', l.unit, 'closingQuantity', sum(p.cq)::text,
        'alert', 'historical-policy', 'availability', 'historical-policy-unavailable')
    from positions p join (select distinct on (product_id) product_id, item, unit from facts order by product_id, posted_at desc, id desc) l using (product_id)
    group by product_id, l.item, l.unit`
        : ""
    }`
    }
  ), filtered as ${batches ? "materialized" : "not materialized"} (
    select * ${query.groupBy === undefined ? "" : `, row_number() over (order by ${sort} ${query.direction === "ascending" ? "asc" : "desc"} nulls last, id) as ordinal`}
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
  if (exportAll && kind === "batches-expiry")
    await checkBatchExportSize(client, pharmacyId, query, maximumExportBytes);
  const values = params(pharmacyId, query, businessDate);
  if (exportAll) {
    // Every query shape gets a scalar pre-check before ordered row encoding.
    // Omit envelope keys/quotes and over-subtract jsonb's separator spaces: the
    // result is a lower bound. The exact boundary check still governs acceptance.
    const cells = valuation
      ? "cells"
      : "cells - array['openingValueFils','closingValueFils','periodValueFils','activityValueFils','openingAverageCostScaled','closingAverageCostScaled']";
    const size = await client.query<{ bytes: string | null }>(
      `${reportSql(kind, { ...query, groupBy: undefined })}
      select sum(octet_length((${cells})::text) - ${2 * INVENTORY_REPORT_DEFINITIONS[kind].columns.length}
        + greatest(coalesce(octet_length(source::text), 4) - 10, 0)
        + octet_length(id) + octet_length(product_id::text) + coalesce(octet_length(batch_id::text), 0))::text as bytes
      from filtered`,
      values,
    );
    if (BigInt(size.rows[0]!.bytes ?? "0") > BigInt(maximumExportBytes))
      throw new InventoryReportExportTooLarge();
  }
  const start = (query.page - 1) * query.pageSize;
  const group = query.groupBy;
  const sort =
    query.sort === "item"
      ? "sort_item"
      : numericColumn(query.sort)
        ? `(cells->>'${query.sort}')::numeric`
        : `cells->>'${query.sort}'`;
  const groupedColumns = INVENTORY_REPORT_DEFINITIONS[kind].columns.filter(
    (c) =>
      ["activityQuantity", "activityValueFils", "consumedQuantity"].includes(c),
  );
  // Batch predicates can narrow balances safely: each position belongs to one
  // batch. Actor choices still describe the complete attributed period, rather
  // than disappearing when a column filter matches no rows.
  const actorRows =
    matchingBatchPredicates(kind, query).length === 0
      ? `select distinct a.actor_id as id, a.actor as "displayName" from activity a where a.actor_id is not null`
      : `select actor.id, actor.display_name as "displayName" from identity_report_actors actor
      where actor.pharmacy_id = $1 and ($4::uuid is null or actor.id = $4)
        and (exists (select 1 from inventory_report_facts f where f.pharmacy_id = $1 and f.actor_id = actor.id
          and f.posted_at >= $2::timestamptz and f.posted_at < $3::timestamptz
          and ($5::date is null or f.business_date >= $5) and ($6::date is null or f.business_date <= $6))
        or exists (select 1 from activity a where a.source is null and a.actor_id = actor.id))`;
  const sql = `${reportSql(kind, query)}, page as (
    ${
      group === undefined
        ? `select *, row_number() over () as ordinal from (
      select * from filtered order by ${sort} ${query.direction === "ascending" ? "asc" : "desc"} nulls last, id
      ${exportAll ? "" : `limit ${query.pageSize} offset ${start}`}
    ) sliced`
        : `select * from filtered ${exportAll ? "" : `where ordinal > ${start} and ordinal <= ${start + query.pageSize}`}`
    }
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
  }, encoded as materialized (
    select ordinal, jsonb_build_object('id', id, 'productId', product_id, 'batchId', batch_id,
      'activityCount', activity_count, 'source', source, 'cells', ${valuation ? "cells" : "cells - array['openingValueFils','closingValueFils','periodValueFils','activityValueFils','openingAverageCostScaled','closingAverageCostScaled']"}) as row from page
  ), export_size as (
    -- jsonb text inserts spaces at object separators. The HTTP JSON encoder
    -- does not; count its exact UTF-8 row bytes so smaller exports stay complete.
    select 2 + coalesce(sum(octet_length(row::text) - 11
      - case when row->'source' = 'null'::jsonb then 0 else 9 end
      - greatest(2 * (select count(*) from jsonb_object_keys(row->'cells')) - 1, 0)), 0)
      + greatest(count(*) - 1, 0) as bytes from encoded
  ), payload as (
    select coalesce(jsonb_agg(row order by ordinal), '[]'::jsonb) as rows from encoded
      ${exportAll ? `where (select bytes from export_size) <= ${maximumExportBytes}` : ""}
  )
  select ${exportAll ? `case when (select bytes from export_size) <= ${maximumExportBytes} then payload.rows else null end` : "payload.rows"} as rows,
    (select count(*)::integer from filtered) as "totalRows",
    ${group === undefined ? "'[]'::jsonb" : "coalesce((select jsonb_agg(to_jsonb(g) order by id) from page_groups g), '[]'::jsonb)"} as groups,
    coalesce((select jsonb_agg(to_jsonb(actor) order by actor."displayName", actor.id) from (
      ${actorRows}
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
  // Row IDs are opaque at the contract seam. Unknown IDs have no activity.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::[a-z-]+)?$/iu.test(
      rowId,
    ) ||
    (kind !== "alerts" && rowId.includes(":"))
  )
    return { rows: [], totalRows: 0, page, hasMore: false };
  const values = params(pharmacyId, query, businessDate);
  values.push(rowId);
  const rowParam = `$${values.length}`;
  if (
    !["stocktake-movements", "alerts", "batches-expiry"].includes(kind) &&
    query.filters.length === 0
  )
    return readProductActivity(client, values, rowParam, page, pageSize);
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
    `${reportSql(kind, query, rowParam)}, activity_sources as (
      select distinct product_id, batch_id, source_document_id, source_document_type, source_row_ordinal,
        posted_at, actor_id, business_date, original_document_id, label, reason
      from facts where source_document_type <> 'count-session' and posted_at >= $2::timestamptz
        and ($4::uuid is null or actor_id = $4) and ($5::date is null or business_date >= $5) and ($6::date is null or business_date <= $6)
    ), detailed_activity as not materialized (
      -- Only the first offset + pageSize effects of any one posting can appear
      -- in this page's global (posting time, effect ID) order. Count separately
      -- from the complete aggregates, never from these bounded candidates.
      select effect.id, f.product_id, effect.batch_id, null::uuid as application_id, effect.movement_id,
        effect.quantity, effect.value_fils, f.posted_at, f.actor_id, f.business_date,
        coalesce(actor.display_name, f.actor_id::text) as actor,
        jsonb_build_object('documentId', f.source_document_id, 'documentType', f.source_document_type,
          'originalDocumentId', f.original_document_id, 'label', f.label, 'openable', false) as source, effect.reason
      from activity_sources f join lateral (
        select * from (
          select id, batch_id, id as movement_id, quantity,
            case when reason = 'purchase-adjustment' then 0 else carrying_amount_fils end as value_fils, reason
          from inventory_movements where pharmacy_id = $1 and product_id = f.product_id
            and source_document_id = f.source_document_id and source_document_type = f.source_document_type
            and source_row_ordinal = f.source_row_ordinal and reason = f.reason
            and source_document_type <> 'count-session' ${kind === "alerts" || kind === "batches-expiry" ? "and batch_id = f.batch_id" : ""}
          order by id limit ${page * pageSize}
        ) movements
        union all select * from (
          select id, batch_id, null::uuid, 0, carrying_amount_delta_fils, 'purchase-adjustment'
          from inventory_value_effects where pharmacy_id = $1 and product_id = f.product_id
            and source_document_id = f.source_document_id and source_document_type = f.source_document_type
            and source_row_ordinal = f.source_row_ordinal ${kind === "alerts" || kind === "batches-expiry" ? "and batch_id = f.batch_id" : ""}
          order by id limit ${page * pageSize}
        ) effects
      ) effect on true
      left join identity_report_actors actor on actor.pharmacy_id = $1 and actor.id = f.actor_id
      union all
      select f.id, f.product_id, f.batch_id, f.application_id, f.movement_id, f.quantity, f.value_fils,
        f.posted_at, f.actor_id, f.business_date, coalesce(actor.display_name, f.actor_id::text) as actor,
        jsonb_build_object('documentId', f.source_document_id, 'documentType', f.source_document_type,
          'originalDocumentId', f.original_document_id, 'label', f.label, 'openable', false) as source, f.reason
      from inventory_report_facts f left join identity_report_actors actor on actor.pharmacy_id = $1 and actor.id = f.actor_id
      where f.pharmacy_id = $1 and f.source_document_type = 'count-session' and f.posted_at >= $2::timestamptz and f.posted_at < $3::timestamptz
        and ${kind === "stocktake-movements" ? `f.application_id = ${rowParam}::uuid` : kind === "alerts" || kind === "batches-expiry" ? `f.batch_id = split_part(${rowParam}::text, ':', 1)::uuid` : `f.product_id = ${rowParam}::uuid`}
        and ($4::uuid is null or f.actor_id = $4) and ($5::date is null or f.business_date >= $5) and ($6::date is null or f.business_date <= $6)
      ${kind === "alerts" || kind === "batches-expiry" ? "union all select id, product_id, batch_id, application_id, movement_id, quantity, value_fils, posted_at, actor_id, business_date, actor, source, reason from activity where source is null" : ""}
    ), selected as not materialized (
      select a.* from detailed_activity a join filtered r on r.id = ${rowParam}::text and ${condition}
    ), page as (select * from selected order by posted_at, id limit ${pageSize} offset ${(page - 1) * pageSize})
    select coalesce((select jsonb_agg(jsonb_build_object('id', id, 'movementId', movement_id, 'quantity', quantity::text, 'valueFils', value_fils::text,
      'postedAt', to_char(posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'businessDate', business_date::text, 'actorId', actor_id, 'actor', actor, 'source', source, 'reason', reason)
      order by posted_at, id) from page), '[]'::jsonb) as rows,
      (select coalesce(sum(a.fact_count), 0)::integer from activity a join filtered r on r.id = ${rowParam}::text and ${condition}) as "totalRows"`,
    values,
  );
  const resultPage = result.rows[0]!;
  return {
    ...resultPage,
    page,
    hasMore: page * pageSize < resultPage.totalRows,
  };
}

/** Activity needs exact effect counts and a bounded page, not lifetime balances.
 * Column-filtered activity still evaluates the complete report row above. */
async function readProductActivity(
  client: PoolClient,
  values: unknown[],
  rowParam: string,
  page: number,
  pageSize: number,
): Promise<InventoryReportActivityPage> {
  const result = await client.query<{
    rows: InventoryReportActivityPage["rows"];
    totalRows: number;
  }>(
    `with report_date as (select $7::date), sources as materialized (
      select * from purchasing_report_sources where pharmacy_id = $1
        and posted_at >= $2::timestamptz and posted_at < $3::timestamptz
        and ($4::uuid is null or actor_id = $4)
        and ($5::date is null or business_date >= $5) and ($6::date is null or business_date <= $6)
    ), movement_counts as materialized (
      select m.source_document_type, m.source_document_id, m.source_row_ordinal, count(*) as count
      from inventory_movements m join sources source on source.type = m.source_document_type
        and source.id = m.source_document_id and source.ordinal = m.source_row_ordinal
      where m.pharmacy_id = $1 and m.product_id = ${rowParam}::uuid
      group by m.source_document_type, m.source_document_id, m.source_row_ordinal
    ), value_counts as materialized (
      select e.source_document_type, e.source_document_id, e.source_row_ordinal, count(*) as count
      from inventory_value_effects e join sources source on source.type = e.source_document_type
        and source.id = e.source_document_id and source.ordinal = e.source_row_ordinal
      where e.pharmacy_id = $1 and e.product_id = ${rowParam}::uuid
      group by e.source_document_type, e.source_document_id, e.source_row_ordinal
    ), source_counts as materialized (
      select source.*, coalesce(m.count, 0) as movement_count, coalesce(e.count, 0) as value_count
      from sources source
      left join movement_counts m on m.source_document_type = source.type and m.source_document_id = source.id and m.source_row_ordinal = source.ordinal
      left join value_counts e on e.source_document_type = source.type and e.source_document_id = source.id and e.source_row_ordinal = source.ordinal
    ), count_facts as materialized (
      select * from inventory_report_facts where pharmacy_id = $1 and product_id = ${rowParam}::uuid
        and source_document_type = 'count-session' and posted_at >= $2::timestamptz and posted_at < $3::timestamptz
        and ($4::uuid is null or actor_id = $4)
        and ($5::date is null or business_date >= $5) and ($6::date is null or business_date <= $6)
    ), candidates as (
      select effect.id, effect.movement_id, effect.quantity, effect.value_fils, source.posted_at, source.actor_id,
        source.business_date, source.id as source_document_id, source.type as source_document_type,
        source.original_document_id, source.label, effect.reason
      from source_counts source join lateral (
        select * from (
          select id, id as movement_id, quantity,
            case when reason = 'purchase-adjustment' then 0 else carrying_amount_fils end as value_fils, reason
          from inventory_movements where pharmacy_id = $1 and product_id = ${rowParam}::uuid
            and source_document_type = source.type and source_document_id = source.id and source_row_ordinal = source.ordinal
          order by id limit least(${page * pageSize}, source.movement_count)
        ) movements
        union all select * from (
          select id, null::uuid, 0, carrying_amount_delta_fils, 'purchase-adjustment'
          from inventory_value_effects where pharmacy_id = $1 and product_id = ${rowParam}::uuid
            and source_document_type = source.type and source_document_id = source.id and source_row_ordinal = source.ordinal
          order by id limit least(${page * pageSize}, source.value_count)
        ) effects
      ) effect on true
      union all
      select id, movement_id, quantity, value_fils, posted_at, actor_id, business_date,
        source_document_id, source_document_type, original_document_id, label, reason from count_facts
    ), page as (
      select * from candidates order by posted_at, id limit ${pageSize} offset ${(page - 1) * pageSize}
    ) select coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'movementId', p.movement_id, 'quantity', p.quantity::text, 'valueFils', p.value_fils::text,
      'postedAt', to_char(p.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'businessDate', p.business_date::text, 'actorId', p.actor_id, 'actor', coalesce(actor.display_name, p.actor_id::text),
      'source', jsonb_build_object('documentId', p.source_document_id, 'documentType', p.source_document_type,
        'originalDocumentId', p.original_document_id, 'label', p.label, 'openable', false), 'reason', p.reason)
      order by p.posted_at, p.id) from page p
      left join identity_report_actors actor on actor.pharmacy_id = $1 and actor.id = p.actor_id), '[]'::jsonb) as rows,
      ((select coalesce(sum(movement_count + value_count), 0) from source_counts)
        + (select count(*) from count_facts))::integer as "totalRows"`,
    values,
  );
  const resultPage = result.rows[0]!;
  return {
    ...resultPage,
    page,
    hasMore: page * pageSize < resultPage.totalRows,
  };
}
