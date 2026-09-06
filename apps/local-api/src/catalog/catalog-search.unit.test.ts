import { describe, expect, it } from "vitest";

import {
  matchesOrderedProductName,
  normalizeProductSearchText,
} from "./catalog-search.js";

describe("Catalog Product search", () => {
  it('matches the fixed acceptance example "panadol gs"', () => {
    expect(matchesOrderedProductName("Panadol Extra GSK", "panadol gs")).toBe(
      true,
    );
  });

  it('matches the fixed acceptance example "extra" wherever it occurs', () => {
    expect(matchesOrderedProductName("Panadol Extra GSK", "extra")).toBe(true);
    expect(matchesOrderedProductName("Cold Extra Relief", "extra")).toBe(true);
  });

  it("requires query parts to finish in their stated order", () => {
    expect(matchesOrderedProductName("Panadol Extra GSK", "gs panadol")).toBe(
      false,
    );
    expect(matchesOrderedProductName("Panadol Extra GSK", "pan gs")).toBe(true);
  });

  it("matches characters in sequence within a part without a prefix anchor", () => {
    expect(matchesOrderedProductName("Panadol Extra GSK", "ndl")).toBe(true);
    expect(matchesOrderedProductName("Panadol Extra GSK", "xrk")).toBe(true);
    expect(matchesOrderedProductName("Panadol Extra GSK", "xkr")).toBe(false);
  });

  it("normalizes case, whitespace, and simple punctuation identically", () => {
    expect(normalizeProductSearchText("  PANADOL---Extra,   GSK!  ")).toBe(
      "panadolextra gsk",
    );
    expect(
      matchesOrderedProductName("Panadol---Extra, GSK!", " PANADOL extra  gs "),
    ).toBe(true);
  });

  it("matches Arabic names under the same ordered subsequence rule", () => {
    expect(
      matchesOrderedProductName("بنادول، إكسترا جي إس كي", "بنادول جي كي"),
    ).toBe(true);
  });

  it("does not invent Arabic orthographic normalization", () => {
    expect(matchesOrderedProductName("إكسترا", "اكسترا")).toBe(false);
  });

  it("does not match an empty or punctuation-only query", () => {
    expect(matchesOrderedProductName("Panadol Extra GSK", "  --  ")).toBe(
      false,
    );
  });
});
