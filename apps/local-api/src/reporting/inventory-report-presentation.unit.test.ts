import { describe, expect, it } from "vitest";
import {
  inventoryReportQueryFor,
  type InventoryReport,
} from "@breev/contracts/local-rest";
import {
  presentInventoryReport,
  presentReportActivity,
} from "./inventory-report-presentation.js";
const id = "019941a0-0000-7000-8000-000000000001";
const source = {
  documentId: id,
  documentType: "purchase-adjustment" as const,
  originalDocumentId: id,
  label: "P1-A01",
  openable: true,
};
const permissions = {
  valuation: false,
  purchasesOpenable: true,
  purchaseCorrectionsOpenable: false,
  countsOpenable: false,
};
function report(): InventoryReport {
  return {
    kind: "value",
    pharmacyId: id,
    capturedAt: "2026-09-30T00:00:00Z",
    timeZone: "Asia/Baghdad",
    query: {
      ...inventoryReportQueryFor("value").parse({
        columns: ["closingValueFils"],
      }),
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-30T00:00:00Z",
    },
    dateBasis: "immutable-posting-time",
    balanceBasis: "all-pharmacy-activity",
    sensitivity: "valuation",
    columns: ["closingValueFils"],
    rows: [
      {
        id,
        productId: id,
        batchId: null,
        source,
        activityCount: 2,
        cells: {
          item: "Frozen item",
          unit: "strip",
          openingQuantity: "10",
          closingQuantity: "8",
          closingValueFils: "800",
        },
      },
    ],
    totalRows: 1,
    hasMore: false,
    actors: [],
    explanations: [],
    groups: [
      {
        id: "group",
        key: "Frozen item",
        item: "Frozen item",
        unit: "strip",
        productId: id,
        rowCount: 1,
        rowIds: [id],
        continuesBefore: false,
        continuesAfter: false,
        totals: { activityQuantity: "-2", activityValueFils: "-200" },
      },
    ],
  };
}
describe("report permission presentation", () => {
  it("redacts rows, groups and selection metadata without changing balances or membership", () => {
    const result = presentInventoryReport(report(), permissions);
    expect(result.rows[0]!.cells.closingValueFils).toBeUndefined();
    expect(result.rows[0]!.cells.closingQuantity).toBe("8");
    expect(result.groups[0]!.totals).toEqual({ activityQuantity: "-2" });
    expect(result.groups[0]!.rowIds).toEqual([id]);
    expect(result.query.columns).toEqual(["item", "unit"]);
    expect(result.rows[0]!.source!.openable).toBe(false);
  });
  it("checks correction permission separately and redacts activity carrying values", () => {
    const result = presentReportActivity(
      {
        id,
        movementId: id,
        quantity: "-2",
        valueFils: "-200",
        postedAt: "2026-09-02T00:00:00Z",
        businessDate: null,
        actorId: id,
        actor: "Owner",
        reason: "purchase-adjustment",
        source,
      },
      permissions,
    );
    expect(result.valueFils).toBeNull();
    expect(result.source!.openable).toBe(false);
    expect(
      presentInventoryReport(report(), {
        ...permissions,
        valuation: true,
        purchaseCorrectionsOpenable: true,
      }).rows[0]!.source!.openable,
    ).toBe(true);
  });
});
