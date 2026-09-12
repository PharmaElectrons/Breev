import {
  REORDER_PROPOSAL_BASES,
  REORDER_WARNINGS,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { BASKET_DENIAL_CODES, basketMessages } from "./basket-messages";

describe("basket translations", () => {
  it("covers every reorder enum and denial in Arabic and English", () => {
    for (const locale of ["ar", "en"] as const) {
      const copy = basketMessages[locale];
      for (const basis of REORDER_PROPOSAL_BASES) {
        expect(copy.proposalBasis[basis]).not.toBe("");
      }
      for (const warning of REORDER_WARNINGS) {
        expect(copy.projectionWarnings[warning]).not.toBe("");
      }
      for (const denial of BASKET_DENIAL_CODES) {
        expect(copy.denialMessages[denial]).not.toBe("");
      }
      expect(
        copy.quantityCaption([{ count: "15", unitName: "Pack" }]),
      ).not.toBe("");
      expect(copy.archivedRow).not.toBe("");
      expect(copy.archivedOrderedRow).not.toBe("");
      expect(copy.mergedRow).not.toBe("");
      expect(
        copy.alreadyInBasketAnnouncement("Panadol", "52", "Strip"),
      ).toContain("52");
      expect(copy.notSaved).not.toBe("");
    }
  });

  it("announces the saved surplus projection in both locales", () => {
    expect(
      basketMessages.en.savedAnnouncement("Panadol", "60", "Strip", {
        maximumLevel: "60",
        projectedLevel: "68",
        warning: "surplus",
      }),
    ).toBe(
      "Saved 60 Strip for Panadol — projected 68 exceeds the maximum 60 and could create surplus or waste.",
    );
    expect(
      basketMessages.ar.savedAnnouncement("بانادول", "٦٠", "شريط", {
        maximumLevel: "٦٠",
        projectedLevel: "٦٨",
        warning: "surplus",
      }),
    ).toContain("قد يسبب فائضاً أو هدراً");
  });
});
