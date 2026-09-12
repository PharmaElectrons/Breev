import { describe, expect, it } from "vitest";

import {
  COUNT_VARIANCE_DIFFERENCE_TREATMENT,
  COUNT_VARIANCE_POSTING_TEMPLATE_ID,
  renderCountVarianceJournal,
} from "./count-variance-posting-template.js";

describe("Inventory Count variance posting template", () => {
  it("debits the variance account for a shortage and balances", () => {
    const lines = renderCountVarianceJournal({
      carryingAmountFils: -2_000n,
      variance: -2n,
    });
    expect(COUNT_VARIANCE_POSTING_TEMPLATE_ID).toBe("inventory.count");
    expect(COUNT_VARIANCE_DIFFERENCE_TREATMENT).toBe(
      "count-variance-account-pending-g01",
    );
    expect(lines).toEqual([
      expect.objectContaining({
        accountCode: "inventory-count-variance",
        debitFils: 2_000n,
      }),
      expect.objectContaining({
        accountCode: "inventory",
        creditFils: 2_000n,
      }),
    ]);
  });

  it("debits inventory for a surplus and balances", () => {
    const lines = renderCountVarianceJournal({
      carryingAmountFils: 3_000n,
      variance: 3n,
    });
    expect(lines).toEqual([
      expect.objectContaining({ accountCode: "inventory", debitFils: 3_000n }),
      expect.objectContaining({
        accountCode: "inventory-count-variance",
        creditFils: 3_000n,
      }),
    ]);
  });

  it("rejects a zero variance", () => {
    expect(() =>
      renderCountVarianceJournal({ carryingAmountFils: 0n, variance: 0n }),
    ).toThrow(RangeError);
  });
});
