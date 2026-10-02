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
    const csv = serializeInventoryCsv(bundle, "en");
    expect(csv).toMatch(/^\uFEFF"Pharmacy ID","Exported at \(UTC\)"/u);
    expect(csv).toContain(
      '"\'=HYPERLINK(""https://example.invalid"", ""دواء"")"',
    );
    expect(csv).toContain('"\'-2"');
    expect(csv).toContain('"","","","10","5","0","0"\r\n');
    expect(csv).not.toContain("Owner");
    expect(csv).not.toContain("weighted-average-cost");
  });

  it("localizes human headings and states while preserving exact source facts", () => {
    const original = JSON.stringify(bundle);
    const ar = serializeInventoryCsv(bundle, "ar");
    expect(ar).toContain('"وقت التصدير (UTC)"');
    expect(ar).toContain('"القيمة (فلس)"');
    expect(ar).toContain('"نشط"');
    expect(ar).toContain('"2026-09-22T00:00:00.000Z"');
    expect(ar).toContain('"\'-2"');
    expect(JSON.stringify(bundle)).toBe(original);
    const exact = {
      ...bundle,
      items: [
        {
          ...bundle.items[0]!,
          balance: "9007199254740993001",
          valueFils: "-1234567",
          averageUnitCostFils: "1.1234567890123",
        },
      ],
    };
    for (const locale of ["ar", "en"] as const) {
      const csv = serializeInventoryCsv(exact, locale);
      expect(csv).toContain('"9007199254740993001"');
      expect(csv).toContain('"\'-1234567"');
      expect(csv).toContain('"1.1234567890123"');
    }
  });

  it("writes a header for an empty inventory", () => {
    expect(
      serializeInventoryCsv({ ...bundle, items: [] }, "en").split("\r\n"),
    ).toHaveLength(2);
  });
});
