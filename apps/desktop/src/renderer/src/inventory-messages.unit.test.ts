import {
  BATCH_ELIGIBILITY_STATUSES,
  COUNT_LINE_STATUSES,
  INVENTORY_COLUMN_FIELDS,
  INVENTORY_RISK_INDICATORS,
  PRODUCT_STATE_COLORS,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { COUNT_DENIAL_CODES, inventoryMessages } from "./inventory-messages";

describe("inventory translations", () => {
  it("covers every inventory field, risk, and state colour in Arabic and English", () => {
    for (const locale of ["ar", "en"] as const) {
      for (const field of INVENTORY_COLUMN_FIELDS) {
        expect(inventoryMessages[locale].columns[field]).not.toBe("");
      }
      for (const risk of INVENTORY_RISK_INDICATORS) {
        expect(inventoryMessages[locale].riskIndicators[risk]).not.toBe("");
      }
      for (const colour of PRODUCT_STATE_COLORS) {
        expect(inventoryMessages[locale].stateColours[colour]).not.toBe("");
      }
      expect(inventoryMessages[locale].addToBasket).not.toBe("");
      expect(
        inventoryMessages[locale].addToBasketAriaLabel("Panadol"),
      ).not.toBe("");
      expect(inventoryMessages[locale].openBasket).not.toBe("");
      for (const status of BATCH_ELIGIBILITY_STATUSES) {
        expect(inventoryMessages[locale].safety.statusLabels[status]).not.toBe(
          "",
        );
        expect(
          inventoryMessages[locale].safety.statusSentence(status, "3"),
        ).not.toBe("");
      }
      for (const status of COUNT_LINE_STATUSES) {
        expect(inventoryMessages[locale].count.statusLabels[status]).not.toBe(
          "",
        );
      }
      for (const denial of COUNT_DENIAL_CODES) {
        expect(inventoryMessages[locale].count.denialMessages[denial]).not.toBe(
          "",
        );
      }
      expect(
        inventoryMessages[locale].count.savedAnnouncement(
          "Item",
          "9",
          "Strip",
          "+1",
        ),
      ).not.toBe("");
      expect(
        inventoryMessages[locale].count.varianceSentence("8", "9", "+1"),
      ).not.toBe("");
      expect(inventoryMessages[locale].safety.dispositionNote).not.toBe("");
    }
  });

  it("keeps the near-expiry warning bilingual and explicit about saleability", () => {
    expect(
      inventoryMessages.en.safety.statusSentence("near-expiry", "3"),
    ).toContain("sellable");
    expect(
      inventoryMessages.ar.safety.statusSentence("near-expiry", "٣"),
    ).toContain("قابل للبيع");
  });
});
