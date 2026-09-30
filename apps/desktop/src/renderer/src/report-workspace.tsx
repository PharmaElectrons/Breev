import type {
  InventoryReport,
  InventoryReportColumn,
  InventoryReportQuery,
  InventoryReportRow,
  InventoryReportSource,
} from "@breev/contracts/local-rest";
import { reportMessages } from "./report-messages";
import { formatCurrencyFromFils, formatNumber } from "./preferences";
import { reportTimestamp } from "./report-time";

export function reportCell(
  value: string | null | undefined,
  column: InventoryReportColumn,
  locale: "ar" | "en",
  timeZone: string,
): string {
  const copy = reportMessages[locale];
  if (value == null)
    return column === "item" || column === "unit" ? copy.unitUnavailable : "—";
  if (column.endsWith("Fils"))
    return formatCurrencyFromFils(BigInt(value), locale);
  if (column.endsWith("Scaled")) {
    const cost = BigInt(value),
      scale = 10n ** 13n;
    const tail = (cost % scale)
      .toString()
      .padStart(13, "0")
      .replace(/0+$/u, "");
    return `${formatNumber(cost / scale, locale)}${tail === "" ? "" : `.${tail}`} ${locale === "ar" ? "د.ع" : "IQD"}`;
  }
  if (/Quantity|Per30Days/u.test(column))
    return formatNumber(BigInt(value), locale);
  if (column === "postedAt") return reportTimestamp(value, locale, timeZone);
  return copy.states[value] ?? value;
}

/** Shared report controls/table seam for the purchase report family as well. */
export function ReportColumnFilters({
  filters,
  columns,
  locale,
  onChange,
}: {
  readonly filters: InventoryReportQuery["filters"];
  readonly columns: readonly InventoryReportColumn[];
  readonly locale: "ar" | "en";
  readonly onChange: (filters: InventoryReportQuery["filters"]) => void;
}): React.JSX.Element {
  const copy = reportMessages[locale];
  return (
    <fieldset className="report-column-filters">
      <legend>{copy.addFilter}</legend>
      {filters.map((filter, index) => (
        <div className="report-filter-row" key={index}>
          <label>
            {copy.columnsLabel}
            <select
              value={filter.column}
              onChange={(e) => {
                const column = e.target.value as InventoryReportColumn;
                onChange(
                  filters.map((f, i) =>
                    i === index
                      ? {
                          ...f,
                          column,
                          operator: /Quantity|Fils|Scaled|Per30Days/u.test(
                            column,
                          )
                            ? "eq"
                            : "contains",
                        }
                      : f,
                  ),
                );
              }}
            >
              {columns.map((c) => (
                <option key={c} value={c}>
                  {copy.columns[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.operator}
            <select
              value={filter.operator}
              onChange={(e) =>
                onChange(
                  filters.map((f, i) =>
                    i === index
                      ? {
                          ...f,
                          operator: e.target.value as typeof filter.operator,
                        }
                      : f,
                  ),
                )
              }
            >
              {(/Quantity|Fils|Scaled|Per30Days/u.test(filter.column)
                ? ["eq", "gte", "lte"]
                : ["contains", "eq"]
              ).map((op) => (
                <option key={op} value={op}>
                  {copy[op as "eq" | "gte" | "lte" | "contains"]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.filterValue}
            <input
              value={filter.value}
              onChange={(e) =>
                onChange(
                  filters.map((f, i) =>
                    i === index ? { ...f, value: e.target.value } : f,
                  ),
                )
              }
            />
          </label>
          <button
            className="quiet-button"
            type="button"
            aria-label={`${copy.removeFilter} ${index + 1}`}
            onClick={() => onChange(filters.filter((_, i) => i !== index))}
          >
            {copy.removeFilter}
          </button>
        </div>
      ))}
      <button
        className="quiet-button"
        type="button"
        disabled={filters.length >= 12}
        onClick={() =>
          onChange([
            ...filters,
            { column: "item", operator: "contains", value: "" },
          ])
        }
      >
        {copy.addFilter}
      </button>
    </fieldset>
  );
}

export function ReportTable({
  report,
  locale,
  onSort,
  onActivity,
  onSource,
}: {
  readonly report: InventoryReport;
  readonly locale: "ar" | "en";
  readonly onSort: (column: InventoryReportColumn) => void;
  readonly onActivity: (row: InventoryReportRow, opener: HTMLElement) => void;
  readonly onSource: (
    source: InventoryReportSource,
    opener: HTMLElement,
  ) => void;
}): React.JSX.Element {
  const copy = reportMessages[locale];
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <caption className="visually-hidden">
          {copy.categories[report.kind]}
        </caption>
        <thead>
          <tr>
            {report.columns.map((column) => (
              <th
                scope="col"
                key={column}
                aria-sort={
                  report.query.sort === column ? report.query.direction : "none"
                }
              >
                <button type="button" onClick={() => onSort(column)}>
                  {copy.columns[column]}{" "}
                  {report.query.sort === column
                    ? report.query.direction === "ascending"
                      ? "↑"
                      : "↓"
                    : ""}
                </button>
              </th>
            ))}
            <th scope="col">{copy.activity}</th>
            <th scope="col">{copy.openSource}</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.id}>
              {report.columns.map((column, index) =>
                index === 0 ? (
                  <th key={column} scope="row">
                    <bdi>
                      {reportCell(
                        row.cells[column],
                        column,
                        locale,
                        report.timeZone,
                      )}
                    </bdi>
                  </th>
                ) : (
                  <td key={column}>
                    <bdi>
                      {reportCell(
                        row.cells[column],
                        column,
                        locale,
                        report.timeZone,
                      )}
                    </bdi>
                  </td>
                ),
              )}
              <td>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={(e) => onActivity(row, e.currentTarget)}
                >
                  {copy.activity} ({formatNumber(row.activities.length, locale)}
                  )
                </button>
              </td>
              <td>
                {row.source === null ? (
                  "—"
                ) : (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={!row.source.openable}
                    onClick={(e) => {
                      if (row.source !== null)
                        onSource(row.source, e.currentTarget);
                    }}
                  >
                    {row.source.label}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
