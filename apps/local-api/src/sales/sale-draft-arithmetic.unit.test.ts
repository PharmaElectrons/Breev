import { describe, expect, it } from "vitest";

import {
  saleLineDiscountFils,
  saleQuantityAfterUnitChange,
  saleUnitPriceFils,
} from "./sale-draft-arithmetic.js";

const BIGINT_MAX = "9223372036854775807";

describe("Sale Draft arithmetic", () => {
  it("preserves base quantity across integral unit changes", () => {
    expect(
      saleQuantityAfterUnitChange({
        quantity: "3",
        currentBaseUnitsPerUnit: "4",
        nextBaseUnitsPerUnit: "2",
      }),
    ).toBe("6");
    expect(
      saleQuantityAfterUnitChange({
        quantity: "6",
        currentBaseUnitsPerUnit: "2",
        nextBaseUnitsPerUnit: "4",
      }),
    ).toBe("3");
  });

  it("rejects fractional unit changes and invalid or overflowing quantities", () => {
    expect(
      saleQuantityAfterUnitChange({
        quantity: "1",
        currentBaseUnitsPerUnit: "2",
        nextBaseUnitsPerUnit: "3",
      }),
    ).toBeUndefined();
    expect(
      saleQuantityAfterUnitChange({
        quantity: BIGINT_MAX,
        currentBaseUnitsPerUnit: "1",
        nextBaseUnitsPerUnit: "1",
      }),
    ).toBe(BIGINT_MAX);
    expect(
      saleQuantityAfterUnitChange({
        quantity: BIGINT_MAX,
        currentBaseUnitsPerUnit: "2",
        nextBaseUnitsPerUnit: "1",
      }),
    ).toBeUndefined();
    expect(
      saleQuantityAfterUnitChange({
        quantity: "1",
        currentBaseUnitsPerUnit: "0",
        nextBaseUnitsPerUnit: "1",
      }),
    ).toBeUndefined();
  });

  it("converts captured prices with exact bigint half-up rounding and range checks", () => {
    expect(
      saleUnitPriceFils({
        capturedRetailPriceFils: "100001",
        capturedUnitRatio: "2",
        nextUnitRatio: "3",
      }),
    ).toBe("150002");
    expect(
      saleUnitPriceFils({
        capturedRetailPriceFils: "100000",
        capturedUnitRatio: "4",
        nextUnitRatio: "2",
      }),
    ).toBe("50000");
    expect(
      saleUnitPriceFils({
        capturedRetailPriceFils: "9223372036854775806",
        capturedUnitRatio: "3",
        nextUnitRatio: "2",
      }),
    ).toBe("6148914691236517204");
    expect(
      saleUnitPriceFils({
        capturedRetailPriceFils: BIGINT_MAX,
        capturedUnitRatio: "1",
        nextUnitRatio: "1",
      }),
    ).toBe(BIGINT_MAX);
    expect(
      saleUnitPriceFils({
        capturedRetailPriceFils: BIGINT_MAX,
        capturedUnitRatio: "1",
        nextUnitRatio: "2",
      }),
    ).toBeUndefined();
  });

  it("rounds line discounts to fils at half values and handles the endpoints", () => {
    expect(
      saleLineDiscountFils({ grossFils: "5", discountPercentage: "10" }),
    ).toBe("1");
    expect(
      saleLineDiscountFils({ grossFils: "4", discountPercentage: "10" }),
    ).toBe("0");
    expect(
      saleLineDiscountFils({ grossFils: "900", discountPercentage: "0" }),
    ).toBe("0");
    expect(
      saleLineDiscountFils({ grossFils: "900", discountPercentage: "100" }),
    ).toBe("900");
    expect(
      saleLineDiscountFils({
        grossFils: BIGINT_MAX,
        discountPercentage: "50",
      }),
    ).toBe("4611686018427387904");
    expect(
      saleLineDiscountFils({
        grossFils: BIGINT_MAX,
        discountPercentage: "101",
      }),
    ).toBeUndefined();
    expect(
      saleLineDiscountFils({
        grossFils: "9223372036854775808",
        discountPercentage: "50",
      }),
    ).toBeUndefined();
  });
});
