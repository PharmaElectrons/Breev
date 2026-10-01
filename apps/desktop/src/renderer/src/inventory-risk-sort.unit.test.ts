import type { InventoryItem } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { inventoryRiskSortRank } from "./inventory-screen";

describe("inventory risk sorting", () => {
  it("orders rows by medical priority and places unmarked rows last", () => {
    const rows = [
      { label: "none", item: item([]) },
      { label: "expiring", item: item(["expiring-soon", "below-minimum"]) },
      { label: "out-of-stock", item: item(["out-of-stock"]) },
      { label: "expired", item: item(["expired", "missing-barcode"]) },
      { label: "recalled", item: item(["missing-barcode", "recalled"]) },
    ];

    expect(
      rows
        .sort((left, right) =>
          Number(
            inventoryRiskSortRank(left.item) -
              inventoryRiskSortRank(right.item),
          ),
        )
        .map((row) => row.label),
    ).toEqual(["recalled", "expired", "out-of-stock", "expiring", "none"]);
  });
});

function item(riskIndicators: InventoryItem["riskIndicators"]): InventoryItem {
  return { riskIndicators } as InventoryItem;
}
