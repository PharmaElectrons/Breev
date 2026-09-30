import { describe, expect, it } from "vitest";
import {
  INVENTORY_REPORT_KINDS,
  inventoryReportQueryFor,
  inventoryReportQuerySchema,
  inventoryReportCellsSchema,
  inventoryReportKindSchema,
  inventoryReportProtectedExportRequestSchema,
} from "./inventory-reports.js";

describe("inventory report contracts", () => {
  it("defaults every category to bounded stable paging", () => {
    for (const kind of INVENTORY_REPORT_KINDS)
      expect(inventoryReportQueryFor(kind).parse({})).toMatchObject({
        page: 1,
        pageSize: 50,
        filters: [],
        sort: "item",
      });
  });
  it.each([
    { from: "2026-09-01T00:00:00Z" },
    { from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T00:00:00Z" },
    { from: "2026-10-01T00:00:00Z", to: "2026-09-01T00:00:00Z" },
    { businessFrom: "2026-09-31" },
    { businessFrom: "2026-10-01", businessTo: "2026-09-01" },
    { actorId: "foreign" },
    { pageSize: 101 },
    { page: 0 },
    { sort: "prototype" },
    { mutation: "post" },
    { columns: ["item", "item"] },
  ])("rejects malformed or unsupported query %j", (query) =>
    expect(inventoryReportQuerySchema.safeParse(query).success).toBe(false),
  );
  it("uses kind-specific column, grouping, operator and exact numeric allowlists", () => {
    expect(inventoryReportKindSchema.safeParse("cogs").success).toBe(false);
    for (const query of [
      { sort: "closingValueFils" },
      { groupBy: "actor" },
      { windowDays: 30 },
      {
        filters: [
          { column: "closingQuantity", operator: "contains", value: "1" },
        ],
      },
      {
        filters: [{ column: "closingQuantity", operator: "gte", value: "1.5" }],
      },
      { filters: [{ column: "item", operator: "gte", value: "a" }] },
    ])
      expect(inventoryReportQueryFor("quantity").safeParse(query).success).toBe(
        false,
      );
    expect(
      inventoryReportQueryFor("consumption").parse({ windowDays: 30 })
        .windowDays,
    ).toBe(30);
  });
  it("does not accept floating-point authoritative cells", () => {
    expect(
      inventoryReportCellsSchema.safeParse({ closingQuantity: 10 }).success,
    ).toBe(false);
    expect(
      inventoryReportCellsSchema.safeParse({ closingValueFils: "1.1" }).success,
    ).toBe(false);
    expect(
      inventoryReportCellsSchema.parse({
        closingValueFils: "90071992547409931234",
      }).closingValueFils,
    ).toBe("90071992547409931234");
  });
  it("accepts the desktop's UUID command keys while keeping source challenge IDs UUIDv7", () => {
    expect(
      inventoryReportProtectedExportRequestSchema.safeParse({
        kind: "value",
        query: {},
        challengeId: "019941a0-0000-7000-8000-000000000001",
        idempotencyKey: "b77e37f7-c2fd-4d78-842f-978f6cd68b28",
      }).success,
    ).toBe(true);
  });
});
