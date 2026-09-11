import { describe, expect, it } from "vitest";

import {
  checkReceiptEvidence,
  DEFAULT_RECEIPT_CLASS_RULES,
  INVENTORY_RECEIPT_CLASSES,
  receiptClassOf,
  receiptRuleFor,
  type InventoryReceiptProduct,
  type InventoryReceiptRuleSet,
} from "./inventory-receipt-rules.js";

const MEDICATION: InventoryReceiptProduct = {
  coldStorageRequired: false,
  definitionMode: "medication",
};
const COLD_MEDICATION: InventoryReceiptProduct = {
  coldStorageRequired: true,
  definitionMode: "medication",
};
const GENERAL: InventoryReceiptProduct = {
  coldStorageRequired: false,
  definitionMode: "general-item",
};
const COLD_GENERAL: InventoryReceiptProduct = {
  coldStorageRequired: true,
  definitionMode: "general-item",
};

/**
 * A pharmacy configuration that differs from the shipped default in both
 * directions: every medication must carry a lot, and general cold-chain stock
 * no longer needs an expiry.
 */
const CONFIGURED: InventoryReceiptRuleSet = {
  "general-item": {
    expiryRequired: false,
    lotRequired: false,
    nearExpiryDays: 90,
  },
  "general-item-cold-chain": {
    expiryRequired: false,
    lotRequired: false,
    nearExpiryDays: 90,
  },
  medication: { expiryRequired: true, lotRequired: true, nearExpiryDays: 90 },
  "medication-cold-chain": {
    expiryRequired: true,
    lotRequired: true,
    nearExpiryDays: 90,
  },
};

describe("receiptClassOf", () => {
  it("derives the class from product facts Catalog already stores", () => {
    expect(receiptClassOf(MEDICATION)).toBe("medication");
    expect(receiptClassOf(COLD_MEDICATION)).toBe("medication-cold-chain");
    expect(receiptClassOf(GENERAL)).toBe("general-item");
    expect(receiptClassOf(COLD_GENERAL)).toBe("general-item-cold-chain");
  });

  it("has a rule for every class it can name", () => {
    for (const receiptClass of INVENTORY_RECEIPT_CLASSES) {
      expect(
        DEFAULT_RECEIPT_CLASS_RULES[receiptClass],
        receiptClass,
      ).toBeDefined();
    }
    expect(Object.keys(DEFAULT_RECEIPT_CLASS_RULES).sort()).toEqual(
      [...INVENTORY_RECEIPT_CLASSES].sort(),
    );
  });
});

describe("DEFAULT_RECEIPT_CLASS_RULES", () => {
  it("is the current G-02 engineering default, not approved policy", () => {
    // Recorded as behaviour so that closing G-02 has to change this test with
    // the table, rather than quietly redefining what was already shipped.
    expect(receiptRuleFor(MEDICATION)).toEqual({
      expiryRequired: true,
      lotRequired: false,
      nearExpiryDays: 90,
    });
    expect(receiptRuleFor(COLD_MEDICATION)).toEqual({
      expiryRequired: true,
      lotRequired: true,
      nearExpiryDays: 90,
    });
    expect(receiptRuleFor(COLD_GENERAL)).toEqual({
      expiryRequired: true,
      lotRequired: false,
      nearExpiryDays: 90,
    });
    // A plain general item never interrupts the keyboard row flow for evidence
    // its supplier may not print at all.
    expect(receiptRuleFor(GENERAL)).toEqual({
      expiryRequired: false,
      lotRequired: false,
      nearExpiryDays: 90,
    });
  });

  it("cannot be edited in place by a caller that reads it", () => {
    expect(Object.isFrozen(DEFAULT_RECEIPT_CLASS_RULES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RECEIPT_CLASS_RULES.medication)).toBe(true);
  });
});

describe("receiptRuleFor", () => {
  it("uses the shipped default when no configuration is supplied", () => {
    expect(receiptRuleFor(MEDICATION)).toEqual(
      DEFAULT_RECEIPT_CLASS_RULES.medication,
    );
    expect(receiptRuleFor(MEDICATION, DEFAULT_RECEIPT_CLASS_RULES)).toEqual(
      receiptRuleFor(MEDICATION),
    );
  });

  it("uses the pharmacy's configured rule when one is supplied", () => {
    expect(receiptRuleFor(MEDICATION, CONFIGURED)).toEqual({
      expiryRequired: true,
      lotRequired: true,
      nearExpiryDays: 90,
    });
    expect(receiptRuleFor(COLD_GENERAL, CONFIGURED)).toEqual({
      expiryRequired: false,
      lotRequired: false,
      nearExpiryDays: 90,
    });
  });
});

describe("checkReceiptEvidence", () => {
  it("accepts a receipt that carries what its rule requires", () => {
    expect(
      checkReceiptEvidence(receiptRuleFor(MEDICATION), {
        expiryDate: "2028-10-31",
        lotNumber: null,
      }),
    ).toBe(null);
    expect(
      checkReceiptEvidence(receiptRuleFor(COLD_MEDICATION), {
        expiryDate: "2028-10-31",
        lotNumber: "LOT-49",
      }),
    ).toBe(null);
    expect(
      checkReceiptEvidence(receiptRuleFor(GENERAL), {
        expiryDate: null,
        lotNumber: null,
      }),
    ).toBe(null);
  });

  it("names the missing evidence rather than refusing without a reason", () => {
    expect(
      checkReceiptEvidence(receiptRuleFor(MEDICATION), {
        expiryDate: null,
        lotNumber: "LOT-1",
      }),
    ).toBe("expiry-required");
    expect(
      checkReceiptEvidence(receiptRuleFor(COLD_MEDICATION), {
        expiryDate: "2028-10-31",
        lotNumber: null,
      }),
    ).toBe("lot-required");
  });

  it("reports the sale-blocking gap first when both are missing", () => {
    expect(
      checkReceiptEvidence(receiptRuleFor(COLD_MEDICATION), {
        expiryDate: null,
        lotNumber: null,
      }),
    ).toBe("expiry-required");
  });

  it("follows a configured override in both directions", () => {
    const noLot = { expiryDate: "2028-10-31", lotNumber: null };
    // The default accepts a medication with no lot; this pharmacy does not.
    expect(checkReceiptEvidence(receiptRuleFor(MEDICATION), noLot)).toBe(null);
    expect(
      checkReceiptEvidence(receiptRuleFor(MEDICATION, CONFIGURED), noLot),
    ).toBe("lot-required");

    const nothing = { expiryDate: null, lotNumber: null };
    // The default requires an expiry on cold-chain general stock; this
    // pharmacy has configured it away.
    expect(checkReceiptEvidence(receiptRuleFor(COLD_GENERAL), nothing)).toBe(
      "expiry-required",
    );
    expect(
      checkReceiptEvidence(receiptRuleFor(COLD_GENERAL, CONFIGURED), nothing),
    ).toBe(null);
  });

  it("never requires evidence a rule does not ask for", () => {
    expect(
      checkReceiptEvidence(
        { expiryRequired: false, lotRequired: false, nearExpiryDays: 90 },
        { expiryDate: null, lotNumber: null },
      ),
    ).toBe(null);
    expect(
      checkReceiptEvidence(receiptRuleFor(COLD_GENERAL), {
        expiryDate: "2028-10-31",
        lotNumber: null,
      }),
    ).toBe(null);
  });
});
