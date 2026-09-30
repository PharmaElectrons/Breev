import type { InventoryReportExport } from "@breev/contracts/local-rest";
import { csvCell } from "./inventory-export-csv.js";

/** Exact wire strings and explicit basis travel with every exported row. */
export function serializeInventoryReportCsv(
  report: InventoryReportExport,
): string {
  const metadata = [
    "Pharmacy ID",
    "Report",
    "From (UTC, inclusive)",
    "To (UTC, exclusive)",
    "Pharmacy timezone",
    "Balance basis",
    "Sensitivity",
    "Grouping",
    "Applied query",
    "Product ID",
    "Batch ID",
    "Source document ID",
    "Source document type",
    "Movement IDs",
    "Explanations",
  ];
  const rows = report.rows.map((row) => [
    report.pharmacyId,
    report.kind,
    report.query.from,
    report.query.to,
    report.timeZone,
    report.balanceBasis,
    report.sensitivity,
    report.query.groupBy ?? "",
    JSON.stringify(report.query),
    row.productId,
    row.batchId ?? "",
    row.source?.documentId ?? "",
    row.source?.documentType ?? "",
    row.movementIds.join(" "),
    report.explanations.join("; "),
    ...report.columns.map((column) => row.cells[column] ?? ""),
  ]);
  return `\uFEFF${[[...metadata, ...report.columns], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
