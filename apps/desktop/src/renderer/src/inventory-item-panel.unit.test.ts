import { describe, expect, it } from "vitest";

import {
  buildInventoryPanelView,
  calendarDaysUntil,
  decomposeInventoryUnits,
  inventoryCoverageDays,
} from "./inventory-item-panel";

const today = new Date(2026, 8, 28);

describe("inventory item panel mapping", () => {
  it("decomposes by the largest package first and ignores a smaller first entry", () => {
    expect(
      decomposeInventoryUnits(25n, [
        { name: "Pack", baseUnitsPerPackage: "4" },
        { name: "Box", baseUnitsPerPackage: "20" },
      ]),
    ).toEqual({
      intermediateCount: 1n,
      intermediateLabel: "Pack",
      largeCount: 1n,
      largeLabel: "Box",
      largeRatio: 20n,
      remainder: 1n,
    });
  });

  it("keeps minimum and maximum in the inventory unit and fills consumption and coverage", () => {
    const view = buildInventoryPanelView(
      {
        inventoryUnitName: "Strip",
        packageUnits: [
          { name: "Pack", baseUnitsPerPackage: "4" },
          { name: "Box", baseUnitsPerPackage: "20" },
        ],
      },
      {
        balance: "25",
        consumptionRatePer30Days: "10",
        earliestExpiry: "2026-10-08",
        maximumLevel: "40",
        minimumLevel: "8",
      },
      "month",
      (value) => value.toString(),
      today,
    );

    expect(view.largeLabel).toBe("Box");
    expect(view.largeCount).toBe("1");
    expect(view.intermediateLabel).toBe("Pack");
    expect(view.intermediateCount).toBe("1");
    expect(view.remainder).toBe("1");
    expect(view.levelUnitName).toBe("Strip");
    expect(view.minimumLevel).toBe("8");
    expect(view.maximumLevel).toBe("40");
    expect(view.largeRatio).toBe(20n);
    expect(view.packagingLine).toBe("1 Box = 20 Strip");
    expect(view.consumption).toBe("10");
    expect(view.coverageDays).toBe("75");
    expect(view.expiryDays).toBe(10);
  });

  it("triples the 30-day rate for a quarter and leaves coverage blank when nothing is consumed", () => {
    const view = buildInventoryPanelView(
      {
        inventoryUnitName: "Strip",
        packageUnits: [],
      },
      {
        balance: "9",
        consumptionRatePer30Days: "0",
        earliestExpiry: null,
        maximumLevel: null,
        minimumLevel: null,
      },
      "quarter",
      (value) => value.toString(),
      today,
    );

    expect(view.consumption).toBe("0");
    expect(view.coverageDays).toBeNull();
    expect(view.largeLabel).toBe("—");
    expect(view.remainder).toBe("9");
    expect(view.expiryDays).toBeNull();
  });

  it("counts calendar days without a millisecond clock", () => {
    expect(calendarDaysUntil("2026-09-28", today)).toBe(0);
    expect(calendarDaysUntil("2026-09-27", today)).toBe(-1);
    expect(calendarDaysUntil("2026-02-31", today)).toBeNull();
    expect(inventoryCoverageDays(0n, 10n)).toBe(0n);
    expect(inventoryCoverageDays(25n, 0n)).toBeNull();
  });
});
