import { describe, expect, it } from "vitest";

import { calculateRetailPricePreview } from "./product-pricing";

describe("calculateRetailPricePreview", () => {
  it("applies margin on the selling price with exact integer arithmetic", () => {
    expect(calculateRetailPricePreview("80000", "20", "off")).toBe("100000");
  });

  it("rounds the derived price using the selected IQD increment", () => {
    expect(calculateRetailPricePreview("140000", "20", "nearest-250-iqd")).toBe(
      "250000",
    );
  });

  it("does not preview invalid or non-finite margins", () => {
    expect(calculateRetailPricePreview("80000", "100", "off")).toBe("0");
    expect(calculateRetailPricePreview("80.00", "20", "off")).toBe("0");
  });
});
