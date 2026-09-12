import type { ProductPackaging } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import {
  buildCountEntryPreview,
  countEntryCaption,
  countEntryUnits,
  countEntriesFromFields,
} from "./count-entry";

const packaging: ProductPackaging = {
  defaultUnits: {
    count: { kind: "package-unit", packageUnitName: "Pack" },
    purchase: { kind: "inventory-unit" },
    sale: { kind: "inventory-unit" },
  },
  inventoryUnitName: "Strip",
  packageUnits: [
    { baseUnitsPerPackage: "4", name: "Pack" },
    { baseUnitsPerPackage: "20", name: "Box" },
  ],
  thirdUnit: null,
};

describe("count entry preview", () => {
  it("orders controls largest-to-smallest and composes 2 packs plus 1 strip", () => {
    expect(countEntryUnits(packaging).map((unit) => unit.key)).toEqual([
      "Box",
      "Pack",
      "Strip",
    ]);
    const fields = { Box: "", Pack: "2", Strip: "1" };
    expect(countEntriesFromFields(packaging, fields)).toEqual([
      { count: "0", unit: { kind: "package-unit", packageUnitName: "Box" } },
      { count: "2", unit: { kind: "package-unit", packageUnitName: "Pack" } },
      { count: "1", unit: { kind: "inventory-unit" } },
    ]);
    expect(countEntryCaption(packaging, fields)).toEqual({
      countedQuantity: 9n,
      enteredLabel: "2 Pack + 1 Strip",
    });
  });

  it("treats empty controls as zero and identifies invalid input without floating point", () => {
    const preview = buildCountEntryPreview(packaging, {
      Box: "",
      Pack: "2.5",
      Strip: "",
    });
    expect(preview.countedQuantity).toBe(0n);
    expect(preview.hasValue).toBe(true);
    expect(preview.invalidField).toBe("Pack");
  });

  it("accepts an explicitly entered zero while rejecting an entirely empty entry", () => {
    expect(
      buildCountEntryPreview(packaging, { Box: "", Pack: "0", Strip: "" }),
    ).toMatchObject({ countedQuantity: 0n, hasValue: true });
    expect(buildCountEntryPreview(packaging, {})).toMatchObject({
      countedQuantity: 0n,
      hasValue: false,
    });
  });
});
