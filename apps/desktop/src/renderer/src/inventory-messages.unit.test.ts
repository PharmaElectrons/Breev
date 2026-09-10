import {
  INVENTORY_COLUMN_FIELDS,
  INVENTORY_RISK_INDICATORS,
  PRODUCT_STATE_COLORS,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { inventoryMessages } from "./inventory-messages";

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
    }
  });
});
