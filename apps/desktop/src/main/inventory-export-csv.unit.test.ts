import type { InventorySensitiveExport } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { serializeInventoryCsv } from "./inventory-export-csv.js";

const bundle: InventorySensitiveExport = {
  counts: { batches: "0", items: "1", movements: "0" },
  exportedAt: "2026-09-22T00:00:00.000Z",
  exportedBy: {
    displayName: "Owner",
    id: "01990abc-1234-7123-8123-123456789abc",
  },
  items: [
    {
      averageUnitCostFils: null,
      balance: "-2",
      batches: [],
      displayName: '=HYPERLINK("https://example.invalid", "دواء")',
      productId: "01990abc-1234-7123-8123-123456789abd",
      status: "active",
      stockLevels: {
        minimumLevel: null,
        maximumLevel: "10",
        reorderPoint: "5",
      },
      suppliers: [],
      valueFils: null,
    },
  ],
  pharmacyId: "01990abc-1234-7123-8123-123456789abe",
  valuationMethod: "weighted-average-cost",
};

describe("inventory CSV export", () => {
  it("writes a UTF-8 item summary with stable headings, exact values, and inert spreadsheet cells", () => {
    const csv = serializeInventoryCsv(bundle);
    expect(csv).toMatch(/^\uFEFF"Pharmacy ID","Exported at \(UTC\)"/u);
    expect(csv).toContain(
      '"\'=HYPERLINK(""https://example.invalid"", ""دواء"")"',
    );
    expect(csv).toContain('"\'-2"');
    expect(csv).toContain('"","","","10","5","0","0"\r\n');
    expect(csv).not.toContain("Owner");
    expect(csv).not.toContain("weighted-average-cost");
  });

  it("writes a header for an empty inventory", () => {
    expect(
      serializeInventoryCsv({ ...bundle, items: [] }).split("\r\n"),
    ).toHaveLength(2);
  });
});
