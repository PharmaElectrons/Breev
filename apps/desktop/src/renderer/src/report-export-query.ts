import {
  INVENTORY_REPORT_SENSITIVE_COLUMNS,
  type InventoryReportQuery,
} from "@breev/contracts/local-rest";

export function ordinaryReportExport(query: InventoryReportQuery): {
  blocked: boolean;
  reordered: boolean;
  query: InventoryReportQuery;
} {
  const sensitive = (column: typeof query.sort) =>
    INVENTORY_REPORT_SENSITIVE_COLUMNS.includes(column);
  const blocked =
    query.filters.some((filter) => sensitive(filter.column)) ||
    (query.groupBy !== undefined && sensitive(query.groupBy));
  const reordered = sensitive(query.sort);
  const columns = query.columns?.filter((column) => !sensitive(column));
  return {
    blocked,
    reordered,
    query: {
      ...query,
      ...(reordered ? { sort: "item", direction: "ascending" } : {}),
      ...(columns === undefined
        ? {}
        : { columns: columns.length > 0 ? columns : ["item", "unit"] }),
    },
  };
}
