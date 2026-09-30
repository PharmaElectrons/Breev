import { describe, expect, it } from "vitest";
import {
  inventoryReportQueryFor,
  inventoryReportSchema,
} from "@breev/contracts/local-rest";
import {
  presentInventoryReport,
  type ReportPresentationInput,
} from "./inventory-report-presentation.js";
const productId = "019941a0-0000-7000-8000-000000000001";
const actorId = "019941a0-0000-7000-8000-000000000002";
const otherActorId = "019941a0-0000-7000-8000-000000000003";
const sourceId = "019941a0-0000-7000-8000-000000000004";
function fixture(): ReportPresentationInput {
  return {
    kind: "quantity",
    query: {
      ...inventoryReportQueryFor("quantity").parse({
        actorId,
        groupBy: "item",
        pageSize: 1,
      }),
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-30T00:00:00.000Z",
    },
    pharmacyId: sourceId,
    capturedAt: "2026-09-30T00:00:00.000Z",
    timeZone: "Asia/Baghdad",
    valuation: false,
    purchasesOpenable: false,
    purchaseCorrectionsOpenable: false,
    countsOpenable: false,
    exportAll: false,
    users: new Map([[actorId, "Owner"]]),
    metadata: new Map([
      [
        `${sourceId}:1`,
        {
          item: "Recorded item",
          unit: "strip",
          businessDate: "2026-08-01",
          label: "P1/2026",
          originalDocumentId: null,
        },
      ],
    ]),
    inventory: {
      batches: [],
      counts: [],
      countMetadata: new Map(),
      facts: [
        {
          id: productId,
          productId,
          batchId: null,
          quantity: 10n,
          valueFils: 1000n,
          occurredAt: new Date("2026-08-01T00:00:00Z"),
          actorId,
          reason: "purchase-receipt",
          source: { id: sourceId, type: "purchase-invoice", ordinal: 1 },
          movementId: productId,
        },
        {
          id: otherActorId,
          productId,
          batchId: null,
          quantity: -2n,
          valueFils: -200n,
          occurredAt: new Date("2026-09-02T00:00:00Z"),
          actorId: otherActorId,
          reason: "purchase-return",
          source: { id: sourceId, type: "purchase-return", ordinal: 1 },
          movementId: otherActorId,
        },
      ],
    },
  };
}
describe("report composition", () => {
  it("keeps pharmacy balances when the actor has no period activity", () => {
    const report = inventoryReportSchema.parse(
      presentInventoryReport(fixture()),
    );
    expect(report.rows[0]?.cells).toEqual({
      item: "Recorded item",
      unit: "strip",
      openingQuantity: "10",
      periodQuantity: "-2",
      activityQuantity: "0",
      closingQuantity: "8",
    });
    expect(report.rows[0]?.activities).toEqual([]);
    expect(report.rows[0]?.source?.openable).toBe(false);
    expect(report.groups[0]?.totals).toEqual({ activityQuantity: "0" });
  });
  it("does not silently use current labels or infer absent business dates", () => {
    const input = fixture();
    const report = presentInventoryReport({
      ...input,
      metadata: new Map(),
      query: { ...input.query, actorId: undefined, businessFrom: "2026-09-01" },
    });
    expect(report.rows[0]?.cells.item).toBeNull();
    expect(report.rows[0]?.cells.closingQuantity).toBe("8");
    expect(report.rows[0]?.activities).toHaveLength(0);
    expect(report.explanations).toContain("business-date-unavailable");
  });
});
