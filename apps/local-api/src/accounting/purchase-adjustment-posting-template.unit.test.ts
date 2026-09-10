import { describe, expect, it } from "vitest";

import { renderPurchaseAdjustmentJournal } from "./purchase-adjustment-posting-template.js";

describe("purchase adjustment posting template", () => {
  it("posts a positive debt Delta to inventory and supplier payable", () => {
    expect(
      renderPurchaseAdjustmentJournal({
        primarySupplierCostDeltaFils: 4_000n,
        settlementContext: "debt",
        supplierEffects: [{ deltaFils: 4_000n, supplierId: "supplier" }],
      }),
    ).toEqual([
      {
        accountCode: "inventory",
        creditFils: 0n,
        debitFils: 4_000n,
        ordinal: 1,
        supplierId: null,
      },
      {
        accountCode: "supplier-payable",
        creditFils: 4_000n,
        debitFils: 0n,
        ordinal: 2,
        supplierId: "supplier",
      },
    ]);
  });

  it("moves a corrected debt between supplier accounts without stock value", () => {
    const lines = renderPurchaseAdjustmentJournal({
      primarySupplierCostDeltaFils: 0n,
      settlementContext: "debt",
      supplierEffects: [
        { deltaFils: -10_000n, supplierId: "before" },
        { deltaFils: 10_000n, supplierId: "after" },
      ],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ debitFils: 10_000n });
    expect(lines[1]).toMatchObject({ creditFils: 10_000n });
  });

  it("produces no journal lines for a non-financial invoice-number fix", () => {
    expect(
      renderPurchaseAdjustmentJournal({
        primarySupplierCostDeltaFils: 0n,
        settlementContext: "cash",
        supplierEffects: [],
      }),
    ).toEqual([]);
  });
});
