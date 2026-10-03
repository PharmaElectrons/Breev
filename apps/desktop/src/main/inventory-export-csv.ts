import type { InventorySensitiveExport } from "@breev/contracts/local-rest";

import { inventoryExportMessages } from "../shared/inventory-export-messages.js";

// The CSV is an item summary. The existing JSON remains the complete export
// with batch and supplier detail.
export function serializeInventoryCsv(
  bundle: InventorySensitiveExport,
  locale: "ar" | "en",
): string {
  const copy = inventoryExportMessages[locale];
  const rows = bundle.items.map((item) => [
    bundle.pharmacyId,
    bundle.exportedAt,
    item.productId,
    item.displayName,
    copy.states[item.status] ?? item.status,
    item.balance,
    item.valueFils ?? "",
    item.averageUnitCostFils ?? "",
    item.stockLevels.minimumLevel ?? "",
    item.stockLevels.maximumLevel ?? "",
    item.stockLevels.reorderPoint ?? "",
    String(item.batches.length),
    String(item.suppliers.length),
  ]);
  return `\uFEFF${[copy.headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  // Spreadsheet applications can execute formula-like cells, even after a
  // quoted CSV import. Prefix such values with a literal apostrophe.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
