import { describe, expect, it } from "vitest";
import {
  formatCanonicalDecimal,
  compareExactDecimal,
  isValidPatientWeight,
  isValidPatientHeight,
  isValidPatientDiscount,
} from "./exact-decimal.js";
import { categorizeBmi } from "./patient-bmi.js";

describe("formatCanonicalDecimal", () => {
  it("formats standard integers with grouping", () => {
    expect(formatCanonicalDecimal("1000")).toBe("1,000");
    expect(formatCanonicalDecimal("1000000")).toBe("1,000,000");
    expect(formatCanonicalDecimal("100")).toBe("100");
  });

  it("preserves exact fractional string without floating-point conversion", () => {
    expect(formatCanonicalDecimal("123.4567890123456789")).toBe(
      "123.4567890123456789",
    );
    expect(formatCanonicalDecimal("99999999999999999.99")).toBe(
      "99,999,999,999,999,999.99",
    );
  });

  it("handles null or undefined by returning 0", () => {
    expect(formatCanonicalDecimal(null)).toBe("0");
    expect(formatCanonicalDecimal(undefined)).toBe("0");
    expect(formatCanonicalDecimal("")).toBe("0");
  });

  it("strips trailing zeros from fractional part but leaves significant zeros", () => {
    expect(formatCanonicalDecimal("10.50")).toBe("10.5");
    expect(formatCanonicalDecimal("10.050")).toBe("10.05");
    expect(formatCanonicalDecimal("10.00")).toBe("10");
  });

  it("preserves negative signs correctly", () => {
    expect(formatCanonicalDecimal("-1000.5")).toBe("-1,000.5");
    expect(formatCanonicalDecimal("-0.5")).toBe("-0.5");
    expect(formatCanonicalDecimal("-0.00")).toBe("0"); // Edge case: -0 is formatted as 0
  });
});

describe("compareExactDecimal", () => {
  it("compares decimal strings correctly without floating point loss", () => {
    expect(compareExactDecimal("10", "10")).toBe(0);
    expect(compareExactDecimal("10.0", "10")).toBe(0);
    expect(compareExactDecimal("10.5", "10.25")).toBeGreaterThan(0);
    expect(compareExactDecimal("0.1", "0.09")).toBeGreaterThan(0);
    expect(compareExactDecimal("700.0", "700.1")).toBeLessThan(0);
  });
});

describe("isValidPatientWeight", () => {
  it("accepts valid weights within 0.1 to 700.0", () => {
    expect(isValidPatientWeight("0.1")).toBe(true);
    expect(isValidPatientWeight("75.5")).toBe(true);
    expect(isValidPatientWeight("75,5")).toBe(true); // comma normalization
    expect(isValidPatientWeight("700")).toBe(true);
    expect(isValidPatientWeight("700.0")).toBe(true);
  });

  it("rejects invalid weights", () => {
    expect(isValidPatientWeight("0")).toBe(false);
    expect(isValidPatientWeight("0.0")).toBe(false);
    expect(isValidPatientWeight("700.1")).toBe(false);
    expect(isValidPatientWeight("1000")).toBe(false);
    expect(isValidPatientWeight("abc")).toBe(false);
    expect(isValidPatientWeight("75.55")).toBe(false); // max 1 decimal
    expect(isValidPatientWeight("")).toBe(false);
    expect(isValidPatientWeight("   ")).toBe(false);
  });
});

describe("isValidPatientHeight", () => {
  it("accepts valid heights within 0.1 to 300.0", () => {
    expect(isValidPatientHeight("0.1")).toBe(true);
    expect(isValidPatientHeight("175")).toBe(true);
    expect(isValidPatientHeight("175.5")).toBe(true);
    expect(isValidPatientHeight("300")).toBe(true);
    expect(isValidPatientHeight("300.0")).toBe(true);
  });

  it("rejects invalid heights", () => {
    expect(isValidPatientHeight("0")).toBe(false);
    expect(isValidPatientHeight("300.1")).toBe(false);
    expect(isValidPatientHeight("abc")).toBe(false);
    expect(isValidPatientHeight("175.25")).toBe(false);
  });
});

describe("isValidPatientDiscount", () => {
  it("accepts valid discounts within 0 to 100.00", () => {
    expect(isValidPatientDiscount("0")).toBe(true);
    expect(isValidPatientDiscount("0.00")).toBe(true);
    expect(isValidPatientDiscount("15")).toBe(true);
    expect(isValidPatientDiscount("15.5")).toBe(true);
    expect(isValidPatientDiscount("15.50")).toBe(true);
    expect(isValidPatientDiscount("100")).toBe(true);
    expect(isValidPatientDiscount("100.00")).toBe(true);
  });

  it("rejects invalid discounts", () => {
    expect(isValidPatientDiscount("-1")).toBe(false);
    expect(isValidPatientDiscount("100.01")).toBe(false);
    expect(isValidPatientDiscount("15.555")).toBe(false);
    expect(isValidPatientDiscount("invalid")).toBe(false);
  });
});

describe("categorizeBmi (exact arithmetic)", () => {
  it("correctly identifies exact boundaries without float precision loss", () => {
    expect(categorizeBmi("18.4")).toBe("underweight");
    expect(categorizeBmi("18.5")).toBe("normal");

    expect(categorizeBmi("24.9")).toBe("normal");
    expect(categorizeBmi("25.0")).toBe("overweight");

    expect(categorizeBmi("29.9")).toBe("overweight");
    expect(categorizeBmi("30.0")).toBe("obese");
    expect(categorizeBmi("300.0")).toBe("obese");
  });

  it("handles null, undefined, and unparseable input", () => {
    expect(categorizeBmi(null)).toBe("unknown");
    expect(categorizeBmi(undefined)).toBe("unknown");
    expect(categorizeBmi("")).toBe("unknown");
    expect(categorizeBmi("invalid")).toBe("unknown");
  });
});
