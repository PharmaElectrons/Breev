import {
  CATALOG_DENIAL_CODES,
  CATALOG_FIELD_ERROR_CODES,
  PRODUCT_DEFINITION_MODES,
  PRODUCT_FOOD_TIMINGS,
  PRODUCT_STATE_COLORS,
  PRODUCT_STATUSES,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { catalogMessages } from "./catalog-messages";

const locales = ["ar", "en"] as const;

describe("catalog translations", () => {
  it("translates every catalog denial code in both locales", () => {
    for (const locale of locales) {
      for (const code of CATALOG_DENIAL_CODES) {
        expect(catalogMessages[locale].denials[code].length).toBeGreaterThan(0);
      }
    }
  });

  it("translates every field error code in both locales", () => {
    for (const locale of locales) {
      for (const code of CATALOG_FIELD_ERROR_CODES) {
        expect(
          catalogMessages[locale].fieldErrors[code].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("translates every product definition mode in both locales", () => {
    for (const locale of locales) {
      for (const mode of PRODUCT_DEFINITION_MODES) {
        expect(
          catalogMessages[locale].definition.modes[mode].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("translates every product food timing in both locales", () => {
    for (const locale of locales) {
      for (const timing of PRODUCT_FOOD_TIMINGS) {
        expect(
          catalogMessages[locale].instructions.foodTimings[timing].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("translates every state color in both locales", () => {
    for (const locale of locales) {
      for (const color of PRODUCT_STATE_COLORS) {
        expect(
          catalogMessages[locale].stateColours.colors[color].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("translates every product status in both locales", () => {
    for (const locale of locales) {
      for (const status of PRODUCT_STATUSES) {
        expect(
          catalogMessages[locale].record.statuses[status].length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("keeps Arabic and English translations distinct", () => {
    for (const code of CATALOG_DENIAL_CODES) {
      expect(catalogMessages.ar.denials[code]).not.toBe(
        catalogMessages.en.denials[code],
      );
    }
    for (const code of CATALOG_FIELD_ERROR_CODES) {
      expect(catalogMessages.ar.fieldErrors[code]).not.toBe(
        catalogMessages.en.fieldErrors[code],
      );
    }
    for (const mode of PRODUCT_DEFINITION_MODES) {
      expect(catalogMessages.ar.definition.modes[mode]).not.toBe(
        catalogMessages.en.definition.modes[mode],
      );
    }
  });
});
