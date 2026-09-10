import { describe, expect, it } from "vitest";

import {
  PURCHASE_RETURN_DIFFERENCE_TREATMENT,
  PURCHASE_RETURN_POSTING_TEMPLATE_ID,
  renderPurchaseReturnJournal,
} from "./purchase-return-posting-template.js";

describe("Purchase Return posting template", () => {
  it("states the two differing values and balances without a variance account", () => {
    const lines = renderPurchaseReturnJournal({
      inventoryCarryingAmountFils: 12_000n,
      supplierId: "01993fff-5f49-7abc-8abc-0123456789ab",
      supplierReductionFils: 10_000n,
    });
    expect(PURCHASE_RETURN_POSTING_TEMPLATE_ID).toBe("purchase.return");
    expect(PURCHASE_RETURN_DIFFERENCE_TREATMENT).toBe(
      "inventory-account-offset-pending-g01",
    );
    expect(lines).toEqual([
      expect.objectContaining({
        accountCode: "supplier-payable",
        debitFils: 10_000n,
      }),
      expect.objectContaining({
        accountCode: "inventory",
        creditFils: 12_000n,
      }),
      expect.objectContaining({
        accountCode: "inventory",
        debitFils: 2_000n,
      }),
    ]);
    expect(new Set(lines.map((line) => line.accountCode))).toEqual(
      new Set(["inventory", "supplier-payable"]),
    );
    expect(lines.reduce((sum, line) => sum + line.debitFils, 0n)).toBe(
      lines.reduce((sum, line) => sum + line.creditFils, 0n),
    );
  });
});
