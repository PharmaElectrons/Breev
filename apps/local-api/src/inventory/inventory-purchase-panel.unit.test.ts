import { describe, expect, it } from "vitest";
import { inventoryUnitBreakdown } from "./inventory-purchase-panel.js";

describe("Inventory's exact purchase panel breakdown", () => {
  it("uses descending integer package sizes and conserves every base unit beyond Number precision", () => {
    const packaging = {
      inventoryUnitName: "Tablet",
      packageUnits: [
        { name: "Strip", baseUnitsPerPackage: "10" },
        { name: "Box", baseUnitsPerPackage: "100" },
      ],
    };
    const quantity = 9_007_199_254_740_993n;
    const result = inventoryUnitBreakdown(quantity, packaging);
    expect(result.map((item) => item.name)).toEqual(["Box", "Strip", "Tablet"]);
    expect(
      BigInt(result[0]!.quantity) * 100n +
        BigInt(result[1]!.quantity) * 10n +
        BigInt(result[2]!.quantity),
    ).toBe(quantity);
    expect(
      inventoryUnitBreakdown(0n, packaging).map((item) => item.quantity),
    ).toEqual(["0", "0", "0"]);
  });
  it("keeps a base-only item in its actual inventory unit", () => {
    expect(
      inventoryUnitBreakdown(3n, {
        inventoryUnitName: "Bottle",
        packageUnits: [],
      }),
    ).toEqual([{ name: "Bottle", quantity: "3" }]);
  });
});
