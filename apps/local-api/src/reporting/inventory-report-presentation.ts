import {
  INVENTORY_REPORT_DEFINITIONS,
  INVENTORY_REPORT_SENSITIVE_COLUMNS,
  type InventoryReport,
  type InventoryReportActivity,
  type InventoryReportColumn,
  type InventoryReportKind,
  type InventoryReportQuery,
  type InventoryReportRow,
  type InventoryReportSource,
} from "@breev/contracts/local-rest";
import {
  historicalPosition,
  type InventoryReportFacts,
  type InventoryReportFact,
} from "../inventory/inventory-report-read.js";
import { consumptionOverWindow } from "../inventory/inventory-risk.js";
import type { PurchaseReportMetadata } from "../purchasing/purchasing-report-read.js";

export interface ReportPresentationInput {
  readonly kind: InventoryReportKind;
  readonly query: InventoryReportQuery & { from: string; to: string };
  readonly pharmacyId: string;
  readonly capturedAt: string;
  readonly timeZone: string;
  readonly inventory: InventoryReportFacts;
  readonly metadata: ReadonlyMap<string, PurchaseReportMetadata>;
  readonly users: ReadonlyMap<string, string>;
  readonly valuation: boolean;
  readonly purchasesOpenable: boolean;
  readonly purchaseCorrectionsOpenable: boolean;
  readonly countsOpenable: boolean;
  readonly exportAll: boolean;
}

/** Presentation composes owner-published facts. It owns no posting or valuation algorithm. */
export function presentInventoryReport(
  input: ReportPresentationInput,
): InventoryReport {
  const { kind, query, inventory, metadata, users } = input;
  const from = new Date(query.from);
  const meta = (f: InventoryReportFact) =>
    metadata.get(`${f.source.id}:${f.source.ordinal}`);
  const sourceOf = (f: InventoryReportFact): InventoryReportSource => ({
    documentId: f.source.id,
    documentType: f.source.type,
    originalDocumentId: meta(f)?.originalDocumentId ?? null,
    label: meta(f)?.label ?? f.source.id,
    openable:
      meta(f) !== undefined &&
      (f.source.type === "count-session"
        ? input.countsOpenable
        : f.source.type === "purchase-invoice"
          ? input.purchasesOpenable
          : input.purchaseCorrectionsOpenable),
  });
  const attributed = (actorId: string | null, date: string | null) =>
    (query.actorId === undefined || query.actorId === actorId) &&
    ((query.businessFrom === undefined && query.businessTo === undefined) ||
      (date !== null &&
        (query.businessFrom === undefined || date >= query.businessFrom) &&
        (query.businessTo === undefined || date <= query.businessTo)));
  const activityOf = (f: InventoryReportFact): InventoryReportActivity => ({
    id: f.id,
    quantity: f.quantity.toString(),
    valueFils: input.valuation ? f.valueFils.toString() : null,
    postedAt: f.occurredAt.toISOString(),
    businessDate: meta(f)?.businessDate ?? null,
    actorId: f.actorId,
    actor: users.get(f.actorId) ?? f.actorId,
    source: sourceOf(f),
    reason: f.reason,
  });
  const activityFacts = (facts: readonly InventoryReportFact[]) =>
    facts.filter(
      (f) =>
        f.occurredAt >= from &&
        attributed(f.actorId, meta(f)?.businessDate ?? null),
    );
  const baseRow = (
    id: string,
    productId: string,
    facts: readonly InventoryReportFact[],
    batchId: string | null = null,
  ): InventoryReportRow => {
    const latest = facts.at(-1);
    const position = historicalPosition(facts, from);
    const selected = activityFacts(facts);
    const quantity = selected.reduce((sum, f) => sum + f.quantity, 0n);
    const value = selected.reduce((sum, f) => sum + f.valueFils, 0n);
    return {
      id,
      productId,
      batchId,
      source: latest === undefined ? null : sourceOf(latest),
      movementIds: selected.flatMap((f) =>
        f.movementId === null ? [] : [f.movementId],
      ),
      cells: {
        item: latest === undefined ? null : (meta(latest)?.item ?? null),
        unit: latest === undefined ? null : (meta(latest)?.unit ?? null),
        openingQuantity: position.openingQuantity.toString(),
        periodQuantity: position.periodQuantity.toString(),
        activityQuantity: quantity.toString(),
        closingQuantity: position.closingQuantity.toString(),
        ...(kind === "value"
          ? {
              openingValueFils: input.valuation
                ? position.openingValueFils.toString()
                : null,
              periodValueFils: input.valuation
                ? position.periodValueFils.toString()
                : null,
              activityValueFils: input.valuation ? value.toString() : null,
              closingValueFils: input.valuation
                ? position.closingValueFils.toString()
                : null,
            }
          : {}),
        ...(kind === "average-cost"
          ? {
              openingAverageCostScaled: input.valuation
                ? (position.openingAverageCostScaled?.toString() ?? null)
                : null,
              closingAverageCostScaled: input.valuation
                ? (position.closingAverageCostScaled?.toString() ?? null)
                : null,
            }
          : {}),
      },
      activities: selected.map(activityOf),
    };
  };
  const byProduct = new Map<string, InventoryReportFact[]>();
  const byBatch = new Map<string, InventoryReportFact[]>();
  for (const f of inventory.facts) {
    const product = byProduct.get(f.productId) ?? [];
    product.push(f);
    byProduct.set(f.productId, product);
    if (f.batchId !== null) {
      const batch = byBatch.get(f.batchId) ?? [];
      batch.push(f);
      byBatch.set(f.batchId, batch);
    }
  }
  let rows: InventoryReportRow[];
  if (kind === "stocktake-movements") {
    rows = inventory.counts
      .filter((c) => c.appliedAt >= from && attributed(c.actorId, null))
      .map((c) => {
        const countFacts = (byProduct.get(c.productId) ?? []).filter(
          (f) => f.source.id === c.sessionId && f.source.ordinal === c.ordinal,
        );
        const source =
          countFacts[0] === undefined ? null : sourceOf(countFacts[0]);
        return {
          id: c.id,
          productId: c.productId,
          batchId: null,
          movementIds: [...c.movementIds],
          source,
          cells: {
            item: c.item,
            unit: c.unit,
            observedQuantity: c.observedQuantity.toString(),
            countedQuantity: c.countedQuantity.toString(),
            activityQuantity: c.variance.toString(),
            activityValueFils: input.valuation ? c.valueFils.toString() : null,
            actor: users.get(c.actorId) ?? c.actorId,
            postedAt: c.appliedAt.toISOString(),
            businessDate: null,
            source: source?.label ?? null,
          },
          activities: countFacts.map(activityOf),
        };
      });
  } else if (kind === "batches-expiry" || kind === "alerts") {
    rows = inventory.batches.flatMap<InventoryReportRow>((batch) => {
      const facts = byBatch.get(batch.id) ?? [];
      const row = baseRow(batch.id, batch.productId, facts, batch.id);
      // A batch label may be absent after full depletion, but the historical product identity remains.
      const productLatest = byProduct.get(batch.productId)?.at(-1);
      const events = batch.events.filter(
        (e) => e.occurredAt >= from && attributed(e.actorId, e.businessDate),
      );
      const activities = [
        ...row.activities,
        ...events.map(
          (e) =>
            ({
              id: e.id,
              quantity: "0",
              valueFils: null,
              postedAt: e.occurredAt.toISOString(),
              businessDate: e.businessDate,
              actorId: e.actorId,
              actor:
                e.source === "daily-evaluator"
                  ? "system"
                  : (users.get(e.actorId ?? "") ?? e.actorId ?? "system"),
              source: null,
              reason: e.kind,
            }) satisfies InventoryReportActivity,
        ),
      ].sort(
        (a, b) =>
          a.postedAt.localeCompare(b.postedAt) || a.id.localeCompare(b.id),
      );
      if (
        (query.actorId !== undefined ||
          query.businessFrom !== undefined ||
          query.businessTo !== undefined) &&
        activities.length === 0
      )
        return [];
      const latest = activities.at(-1);
      const cells = {
        ...row.cells,
        item:
          row.cells.item ??
          (productLatest === undefined
            ? null
            : (meta(productLatest)?.item ?? null)),
        unit:
          row.cells.unit ??
          (productLatest === undefined
            ? null
            : (meta(productLatest)?.unit ?? null)),
        batch: batch.lot,
        expiry: batch.expiry,
        status: batch.status,
        actor: latest?.actor ?? null,
        postedAt: latest?.postedAt ?? null,
        businessDate: latest?.businessDate ?? null,
        source: latest?.source?.label ?? null,
      };
      if (kind === "batches-expiry") return [{ ...row, cells, activities }];
      if (
        batch.status === "eligible" ||
        BigInt(row.cells.closingQuantity ?? "0") <= 0n
      )
        return [];
      return [
        {
          ...row,
          id: `${batch.id}:${batch.status}`,
          cells: {
            item: cells.item,
            unit: cells.unit,
            closingQuantity: cells.closingQuantity,
            batch: cells.batch,
            expiry: cells.expiry,
            alert: batch.status,
            availability: "available" as const,
            actor: cells.actor,
            postedAt: cells.postedAt,
            businessDate: cells.businessDate,
            source: cells.source,
          },
          activities,
        },
      ];
    });
    if (kind === "alerts") {
      for (const [productId, facts] of byProduct) {
        const row = baseRow(`${productId}:policy`, productId, facts);
        rows.push({
          ...row,
          cells: {
            item: row.cells.item,
            unit: row.cells.unit,
            closingQuantity: row.cells.closingQuantity,
            alert: "historical-policy",
            availability: "historical-policy-unavailable",
          },
        });
      }
    }
  } else {
    rows = [...byProduct].map(([productId, facts]) => {
      const row = baseRow(productId, productId, facts);
      if (kind !== "consumption") return row;
      // No M2 movement is posted demand: receipts, corrections, returns, and counts are all excluded.
      const consumption = consumptionOverWindow(
        facts
          .filter((f) => attributed(f.actorId, meta(f)?.businessDate ?? null))
          .map((f) => ({ ...f, eligibleDemand: false })),
        new Date(query.to),
        query.windowDays,
      );
      return {
        ...row,
        cells: {
          ...row.cells,
          consumedQuantity: consumption.consumed.toString(),
          consumptionPer30Days: consumption.per30Days.toString(),
        },
      };
    });
  }
  const columns = (
    query.columns ?? INVENTORY_REPORT_DEFINITIONS[kind].columns
  ).filter(
    (c) => input.valuation || !INVENTORY_REPORT_SENSITIVE_COLUMNS.includes(c),
  );
  if (!input.valuation) {
    rows = rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells).filter(
          ([key]) =>
            !INVENTORY_REPORT_SENSITIVE_COLUMNS.includes(
              key as InventoryReportColumn,
            ),
        ),
      ),
      activities: row.activities.map((a) => ({ ...a, valueFils: null })),
    }));
  }
  rows = rows.filter((row) =>
    query.filters.every((filter) => {
      const value = row.cells[filter.column];
      if (value === undefined || value === null) return false;
      if (filter.operator === "contains")
        return value
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(filter.value.normalize("NFKC").toLocaleLowerCase());
      if (filter.operator === "eq") return value === filter.value;
      return filter.operator === "gte"
        ? BigInt(value) >= BigInt(filter.value)
        : BigInt(value) <= BigInt(filter.value);
    }),
  );
  rows.sort(
    (a, b) =>
      compareCells(a.cells[query.sort], b.cells[query.sort], query.sort) *
        (query.direction === "ascending" ? 1 : -1) || a.id.localeCompare(b.id),
  );
  const grouped = new Map<string, InventoryReportRow[]>();
  if (query.groupBy !== undefined) {
    for (const row of rows) {
      // Product identity keeps totals in compatible Inventory Units, even within actor/status groups.
      const key = JSON.stringify([
        row.cells[query.groupBy] ?? null,
        row.productId,
      ]);
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    }
  }
  const groups = [...grouped.values()].map((group) => ({
    key: group[0]!.cells[query.groupBy!] ?? null,
    productId: group[0]!.productId,
    rowCount: group.length,
    totals: sumReportColumns(group, columns),
  }));
  const totalRows = rows.length;
  const pageRows = input.exportAll
    ? rows
    : rows.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      );
  const explanations: InventoryReport["explanations"] = [
    "working-default-columns",
    "activity-filter-does-not-filter-balances",
  ];
  if (rows.some((row) => row.cells.item == null || row.cells.unit == null))
    explanations.push("historical-label-unavailable");
  if (inventory.facts.some((f) => meta(f)?.businessDate == null))
    explanations.push("business-date-unavailable");
  if (kind === "alerts" || kind === "batches-expiry")
    explanations.push("historical-policy-unavailable");
  if (kind === "consumption") explanations.push("no-eligible-demand");
  return {
    kind,
    pharmacyId: input.pharmacyId,
    capturedAt: input.capturedAt,
    timeZone: input.timeZone,
    query,
    dateBasis: "immutable-posting-time",
    balanceBasis: "all-pharmacy-activity",
    sensitivity: input.valuation ? "valuation" : "redacted",
    columns: [...columns],
    actors: [...users].map(([id, displayName]) => ({ id, displayName })),
    rows: pageRows,
    totalRows,
    hasMore: !input.exportAll && query.page * query.pageSize < totalRows,
    groups,
    explanations,
  };
}

function compareCells(
  a: string | null | undefined,
  b: string | null | undefined,
  column: InventoryReportColumn,
): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  if (/Quantity|Fils|Scaled|Per30Days/u.test(column))
    return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
  return a.localeCompare(b);
}
function sumReportColumns(
  rows: readonly InventoryReportRow[],
  columns: readonly InventoryReportColumn[],
): Partial<Record<InventoryReportColumn, string>> {
  const totals: Partial<Record<InventoryReportColumn, string>> = {};
  // Costs, observations, and balances on repeated alert rows are not additive.
  for (const column of columns.filter((c) =>
    ["activityQuantity", "activityValueFils", "consumedQuantity"].includes(c),
  )) {
    totals[column] = rows
      .reduce((sum, row) => sum + BigInt(row.cells[column] ?? "0"), 0n)
      .toString();
  }
  return totals;
}
