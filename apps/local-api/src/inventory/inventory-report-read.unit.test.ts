import { describe, expect, it } from "vitest";
import {
  historicalPosition,
  type InventoryReportFact,
} from "./inventory-report-read.js";
import { consumptionOverWindow } from "./inventory-risk.js";

const fact = (
  quantity: bigint,
  valueFils: bigint,
  occurredAt: string,
): InventoryReportFact => ({
  id: "id",
  productId: "item",
  batchId: "batch",
  quantity,
  valueFils,
  occurredAt: new Date(occurredAt),
  actorId: "actor",
  reason: "purchase-receipt",
  source: { id: "source", type: "purchase-invoice", ordinal: 1 },
  movementId: "id",
});
describe("Inventory historical calculations", () => {
  it("conserves frozen values including a price-only effect, rounding and depletion", () => {
    const facts = [
      fact(3n, 1000n, "2026-08-31T23:59:59Z"),
      fact(0n, 1n, "2026-09-01T00:00:00Z"),
      fact(-1n, -334n, "2026-09-02T00:00:00Z"),
    ];
    const position = historicalPosition(
      facts,
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(position).toMatchObject({
      openingQuantity: 3n,
      closingQuantity: 2n,
      periodQuantity: -1n,
      openingValueFils: 1000n,
      closingValueFils: 667n,
      periodValueFils: -333n,
      closingAverageCostScaled: 3335000000000n,
    });
    expect(position.openingQuantity + position.periodQuantity).toBe(
      position.closingQuantity,
    );
    expect(position.openingValueFils + position.periodValueFils).toBe(
      position.closingValueFils,
    );
    expect(
      historicalPosition(
        [...facts, fact(-2n, -667n, "2026-09-03T00:00:00Z")],
        new Date("2026-09-01T00:00:00Z"),
      ),
    ).toMatchObject({
      closingQuantity: 0n,
      closingValueFils: 0n,
      closingAverageCostScaled: null,
    });
  });
  it.each([30, 60, 90] as const)(
    "uses exact %i-day demand windows and half-open boundaries",
    (days) => {
      const to = new Date("2026-09-30T12:00:00Z");
      const start = new Date(to.getTime() - days * 86400000);
      const result = consumptionOverWindow(
        [
          { occurredAt: start, quantity: -BigInt(days), eligibleDemand: true },
          {
            occurredAt: new Date(start.getTime() - 1),
            quantity: -1000n,
            eligibleDemand: true,
          },
          { occurredAt: to, quantity: -1000n, eligibleDemand: true },
          { occurredAt: start, quantity: -1000n, eligibleDemand: false },
          { occurredAt: start, quantity: 1000n, eligibleDemand: true },
        ],
        to,
        days,
      );
      expect(result).toEqual({ consumed: BigInt(days), per30Days: 30n });
    },
  );
});
