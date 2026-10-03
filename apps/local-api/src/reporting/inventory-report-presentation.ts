import {
  INVENTORY_REPORT_DEFINITIONS,
  INVENTORY_REPORT_SENSITIVE_COLUMNS,
  type InventoryReport,
  type InventoryReportColumn,
  type InventoryReportSource,
  type InventoryReportActivity,
} from "@breev/contracts/local-rest";

export interface ReportReadPermissions {
  readonly valuation: boolean;
  readonly purchasesOpenable: boolean;
  readonly purchaseCorrectionsOpenable: boolean;
  readonly countsOpenable: boolean;
}
function sourceFor(
  source: InventoryReportSource | null,
  permissions: ReportReadPermissions,
) {
  return source === null
    ? null
    : {
        ...source,
        openable:
          source.documentType === "count-session"
            ? permissions.countsOpenable
            : source.documentType === "purchase-invoice"
              ? permissions.purchasesOpenable
              : permissions.purchaseCorrectionsOpenable,
      };
}
export function presentReportActivity(
  activity: InventoryReportActivity,
  permissions: ReportReadPermissions,
): InventoryReportActivity {
  return {
    ...activity,
    source: sourceFor(activity.source, permissions),
    valueFils: permissions.valuation ? activity.valueFils : null,
  };
}
/** Only permission-aware presentation; aggregation and row selection belong to Inventory. */
export function presentInventoryReport(
  report: InventoryReport,
  permissions: ReportReadPermissions,
): InventoryReport {
  const selectedColumns = (
    report.query.columns ?? INVENTORY_REPORT_DEFINITIONS[report.kind].columns
  ).filter(
    (c) =>
      permissions.valuation || !INVENTORY_REPORT_SENSITIVE_COLUMNS.includes(c),
  );
  const columns: InventoryReportColumn[] =
    selectedColumns.length === 0 ? ["item", "unit"] : selectedColumns;
  const redact = (
    cells: Partial<Record<InventoryReportColumn, string | null | undefined>>,
  ) =>
    Object.fromEntries(
      Object.entries(cells).filter(
        ([column]) =>
          permissions.valuation ||
          !INVENTORY_REPORT_SENSITIVE_COLUMNS.includes(
            column as InventoryReportColumn,
          ),
      ),
    );
  return {
    ...report,
    query: {
      ...report.query,
      ...(permissions.valuation || report.query.columns === undefined
        ? {}
        : {
            columns,
          }),
    },
    columns,
    sensitivity: permissions.valuation ? "valuation" : "redacted",
    rows: report.rows.map((row) => ({
      ...row,
      cells: redact(row.cells),
      source: sourceFor(row.source, permissions),
    })),
    groups: report.groups.map((group) => ({
      ...group,
      totals: redact(group.totals) as typeof group.totals,
    })),
  };
}
