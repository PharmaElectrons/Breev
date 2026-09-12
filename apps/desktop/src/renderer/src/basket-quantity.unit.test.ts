import { describe, expect, it } from "vitest";

import { describeInventoryUnits } from "./basket-quantity";

describe("describeInventoryUnits", () => {
  it("uses the largest package first and keeps the remainder in the inventory unit", () => {
    expect(
      describeInventoryUnits(
        "Strip",
        [{ baseUnitsPerPackage: "4", name: "Pack" }],
        61n,
      ),
    ).toEqual([
      { count: 15n, unitName: "Pack" },
      { count: 1n, unitName: "Strip" },
    ]);
  });

  it("keeps zero visible in the inventory unit", () => {
    expect(describeInventoryUnits("Strip", [], 0n)).toEqual([
      { count: 0n, unitName: "Strip" },
    ]);
  });

  it("uses only the inventory unit when no packages are defined", () => {
    expect(describeInventoryUnits("Tablet", [], 7n)).toEqual([
      { count: 7n, unitName: "Tablet" },
    ]);
  });
});
