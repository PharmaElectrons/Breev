import {
  INVENTORY_REPORT_DEFINITIONS,
  type InventoryReportExport,
} from "@breev/contracts/local-rest";
import { csvCell } from "./inventory-export-csv.js";
import { reportMessages } from "../shared/report-messages.js";

/** CSV contains the active business projection; technical context stays in the report bundle. */
export function serializeInventoryReportCsv(
  report: InventoryReportExport,
  locale: "ar" | "en",
): string {
  const copy = reportMessages[locale];
  const columns = report.columns.filter((column) =>
    INVENTORY_REPORT_DEFINITIONS[report.kind].columns.includes(column),
  );
  const headers = columns.map(
    (column) =>
      `${copy.columns[column]}${/Fils|Scaled/u.test(column) ? " (IQD)" : ""}`,
  );
  const rows = report.rows.map((row) =>
    columns.map((column) => {
      const value = row.cells[column] ?? "";
      if (value === "") return value;
      if (/Fils|Scaled/u.test(column))
        return exactDecimal(value, column.endsWith("Scaled") ? 13 : 3);
      if (["status", "alert", "availability"].includes(column))
        return copy.states[value] ?? value;
      if (column === "unit") return copy.units[value.toLowerCase()] ?? value;
      return value;
    }),
  );
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function exactDecimal(value: string, places: number): string {
  const number = BigInt(value);
  const digits = (number < 0n ? -number : number)
    .toString()
    .padStart(places + 1, "0");
  return `${number < 0n ? "-" : ""}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}
