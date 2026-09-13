import { SALES_DENIAL_CODES } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { salesMessages } from "./sales-messages";

describe("sales translations", () => {
  it("fills every key and denial in Arabic and English", () => {
    for (const locale of ["ar", "en"] as const) {
      const copy = salesMessages[locale];
      for (const denial of SALES_DENIAL_CODES) {
        expect(copy.denialMessages[denial], `${locale}/${denial}`).not.toBe("");
      }
      for (const [key, value] of Object.entries(copy)) {
        if (typeof value === "string") {
          expect(value, `${locale}/${key}`).not.toBe("");
        }
      }
      expect(copy.addToBasketAriaLabel("Panadol")).toContain("Panadol");
      expect(copy.searchResultCount(3)).toContain("3");
      expect(copy.versionLabel("2")).toContain("2");
      expect(copy.openedBy("Layla")).toContain("Layla");
      expect(copy.draftHeading("today")).toContain("today");
      expect(copy.resumeAriaLabel("today")).toContain("today");
    }
  });

  it("keeps both locales on the same key set", () => {
    expect(Object.keys(salesMessages.ar).sort()).toEqual(
      Object.keys(salesMessages.en).sort(),
    );
  });
});
