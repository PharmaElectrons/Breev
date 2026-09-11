import { describe, expect, it } from "vitest";

import {
  automaticStateColour,
  consumptionRatePer30Days,
  effectiveStateColour,
  riskIndicators,
} from "./inventory-risk.js";

const now = new Date("2026-09-10T12:00:00.000Z");

describe("inventory risk calculations", () => {
  it("computes trailing consumption as an exact 30-day integer rate", () => {
    expect(
      consumptionRatePer30Days(
        [
          { occurredAt: new Date("2026-06-12T12:00:00.000Z"), quantity: -1n },
          { occurredAt: new Date("2026-06-13T12:00:00.000Z"), quantity: -2n },
          { occurredAt: new Date("2026-08-15T12:00:00.000Z"), quantity: -8n },
          { occurredAt: new Date("2026-09-09T12:00:00.000Z"), quantity: 4n },
          { occurredAt: new Date("2026-06-11T12:00:00.000Z"), quantity: -100n },
        ],
        now,
      ),
    ).toBe(4n);
  });

  it("emits all applicable indicators without using floating point", () => {
    expect(
      riskIndicators({
        balance: 4n,
        coldStorageRequired: true,
        earliestExpiry: "2026-10-01",
        expiredCount: 1n,
        hasBarcode: false,
        maximumLevel: 3n,
        minimumLevel: 5n,
        businessDate: "2026-09-10",
        nearExpiryDays: 90,
        reorderPoint: 4n,
      }),
    ).toEqual([
      "below-minimum",
      "at-or-below-reorder-point",
      "above-maximum",
      "expired",
      "expiring-soon",
      "missing-barcode",
      "cold-storage",
    ]);
  });

  it("uses the fixed precedence and lets manual colour win", () => {
    expect(automaticStateColour(["above-maximum", "missing-barcode"])).toBe(
      "grey",
    );
    expect(automaticStateColour(["above-maximum", "cold-storage"])).toBe(
      "blue",
    );
    expect(automaticStateColour(["expiring-soon", "below-minimum"])).toBe(
      "orange",
    );
    expect(automaticStateColour(["expired", "out-of-stock"])).toBe("red");
    expect(automaticStateColour([])).toBe("green");
    expect(effectiveStateColour("purple", "red")).toBe("purple");
    expect(effectiveStateColour(null, "yellow")).toBe("yellow");
  });
});
