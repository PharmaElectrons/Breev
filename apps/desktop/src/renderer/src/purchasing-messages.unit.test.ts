import { describe, expect, it } from "vitest";

import { purchasingMessages } from "./purchasing-messages";

describe("purchasing translations", () => {
  it("fills every key in Arabic and English", () => {
    for (const locale of ["ar", "en"] as const) {
      const copy = purchasingMessages[locale];
      for (const [key, value] of Object.entries(copy)) {
        if (typeof value === "string") {
          expect(value, `${locale}/${key}`).not.toBe("");
        }
      }
    }
  });

  it("keeps both locales on the same key set", () => {
    expect(Object.keys(purchasingMessages.ar).sort()).toEqual(
      Object.keys(purchasingMessages.en).sort(),
    );
  });
});
