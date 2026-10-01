import { describe, expect, it } from "vitest";
import {
  parseExactWeight,
  parseExactHeight,
  parseExactDiscount,
  ExactDecimalError,
} from "./patient-exact-decimal.js";

describe("patient-exact-decimal", () => {
  describe("parseExactWeight", () => {
    it("returns valid weight string", () => {
      expect(parseExactWeight("72.5")).toBe("72.5");
      expect(parseExactWeight("0.1")).toBe("0.1");
      expect(parseExactWeight("700.0")).toBe("700.0");
      expect(parseExactWeight("150")).toBe("150");
    });

    it("throws when weight is zero or negative", () => {
      expect(() => parseExactWeight("0")).toThrow(ExactDecimalError);
      expect(() => parseExactWeight("0.0")).toThrow(ExactDecimalError);
      expect(() => parseExactWeight("-5.0")).toThrow(ExactDecimalError);
    });

    it("throws on too many decimal places", () => {
      expect(() => parseExactWeight("72.55")).toThrow(ExactDecimalError);
    });

    it("throws on non-string input", () => {
      // @ts-expect-error test non-string input
      expect(() => parseExactWeight(72.5)).toThrow(ExactDecimalError);
      // @ts-expect-error test null input
      expect(() => parseExactWeight(null)).toThrow(ExactDecimalError);
    });

    it("throws when exceeding maximum weight 700.0", () => {
      expect(() => parseExactWeight("700.1")).toThrow(ExactDecimalError);
      expect(() => parseExactWeight("999.9")).toThrow(ExactDecimalError);
    });
  });

  describe("parseExactHeight", () => {
    it("returns valid height string", () => {
      expect(parseExactHeight("175.5")).toBe("175.5");
      expect(parseExactHeight("50")).toBe("50");
      expect(parseExactHeight("300.0")).toBe("300.0");
    });

    it("throws when height is zero or negative", () => {
      expect(() => parseExactHeight("0")).toThrow(ExactDecimalError);
      expect(() => parseExactHeight("-175.5")).toThrow(ExactDecimalError);
    });

    it("throws when exceeding maximum height 300.0", () => {
      expect(() => parseExactHeight("300.1")).toThrow(ExactDecimalError);
    });

    it("throws on non-string input", () => {
      // @ts-expect-error test non-string input
      expect(() => parseExactHeight(180)).toThrow(ExactDecimalError);
    });
  });

  describe("parseExactDiscount", () => {
    it("returns valid discount string", () => {
      expect(parseExactDiscount("10.00")).toBe("10.00");
      expect(parseExactDiscount("0")).toBe("0");
      expect(parseExactDiscount("5.5")).toBe("5.5");
      expect(parseExactDiscount("100")).toBe("100");
      expect(parseExactDiscount("100.00")).toBe("100.00");
    });

    it("throws when discount exceeds 100", () => {
      expect(() => parseExactDiscount("100.01")).toThrow(ExactDecimalError);
      expect(() => parseExactDiscount("105")).toThrow(ExactDecimalError);
    });

    it("throws when discount is negative", () => {
      expect(() => parseExactDiscount("-1")).toThrow(ExactDecimalError);
    });

    it("throws on non-string input", () => {
      // @ts-expect-error test non-string input
      expect(() => parseExactDiscount(10)).toThrow(ExactDecimalError);
    });
  });
});
