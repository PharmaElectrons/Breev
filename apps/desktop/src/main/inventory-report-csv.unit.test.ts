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
      activityCount: 0,
      source: null,
      cells: {
        item: '=HYPERLINK("https://example.invalid", "دواء")',
        closingQuantity: "12345678901234567890",
      },
    },
  ],
};

describe("inventory report CSV", () => {
  it("exports only active business columns with readable headers and spreadsheet-safe exact cells", () => {
    const csv = serializeInventoryReportCsv(report, "en");
    expect(csv).toMatch(/^\uFEFF"Recorded item","Closing quantity"/u);
    expect(csv).toContain(
      '"\'=HYPERLINK(""https://example.invalid"", ""دواء"")"',
    );
    expect(csv).toContain('"12345678901234567890"');
    expect(csv).not.toContain(id);
    expect(csv).not.toContain("all-pharmacy-activity");
    expect(csv).not.toContain("Explanations");
    expect(csv).not.toContain("filters");
    expect(csv.split("\r\n")).toHaveLength(3);
  });
  it("localizes Arabic headers and preserves exact IQD and WAC decimals", () => {
    const valueReport: InventoryReportExport = {
      ...report,
      kind: "value",
      columns: ["item", "closingValueFils"],
      rows: [
        {
          ...report.rows[0]!,
          cells: { item: "دواء", closingValueFils: "12345678901234567890" },
        },
      ],
    };
    const csv = serializeInventoryReportCsv(valueReport, "ar");
    expect(csv).toContain('"الصنف المسجل","قيمة النهاية (IQD)"');
    expect(csv).toContain('"12345678901234567.890"');
    const wac = serializeInventoryReportCsv(
      {
        ...valueReport,
        kind: "average-cost",
        columns: ["closingAverageCostScaled"],
        rows: [
          {
            ...report.rows[0]!,
            cells: { closingAverageCostScaled: "12345678901234567890" },
          },
        ],
      },
      "en",
    );
    expect(wac).toContain('"1234567.8901234567890"');
  });
});
