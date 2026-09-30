import {
  inventoryReportQueryFor,
  type InventoryReportExport,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { serializeInventoryReportCsv } from "./inventory-report-csv.js";

const id = "01990abc-1234-7123-8123-123456789abc";
const query = inventoryReportQueryFor("quantity").parse({
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-09-30T00:00:00.000Z",
});
const report: InventoryReportExport = {
  kind: "quantity",
  pharmacyId: id,
  capturedAt: query.to!,
  exportedAt: query.to!,
  timeZone: "Asia/Baghdad",
  query: { ...query, from: query.from!, to: query.to! },
  dateBasis: "immutable-posting-time",
  balanceBasis: "all-pharmacy-activity",
  sensitivity: "redacted",
  columns: ["item", "closingQuantity"],
  actors: [],
  explanations: ["working-default-columns"],
  groups: [],
  hasMore: false,
  totalRows: 1,
  rows: [
    {
      id,
      productId: id,
      batchId: null,
      movementIds: [],
      source: null,
      activities: [],
      cells: {
        item: '=HYPERLINK("https://example.invalid", "دواء")',
        closingQuantity: "12345678901234567890",
      },
    },
  ],
};

describe("inventory report CSV", () => {
  it("exports all exact strings with a BOM, source basis, and spreadsheet-safe cells", () => {
    const csv = serializeInventoryReportCsv(report);
    expect(csv).toMatch(/^\uFEFF"Pharmacy ID","Report"/u);
    expect(csv).toContain(
      '"\'=HYPERLINK(""https://example.invalid"", ""دواء"")"',
    );
    expect(csv).toContain('"12345678901234567890"');
    expect(csv).toContain('"all-pharmacy-activity"');
    expect(csv).toContain('"Explanations"');
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});
