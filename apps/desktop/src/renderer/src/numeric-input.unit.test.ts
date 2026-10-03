import { describe, expect, it } from "vitest";
import { normalizeNumericInput } from "./numeric-input";
import {
  buildPricingPayload,
  buildPackagingPayload,
  stepNumericText,
} from "./product-form";
import { calculateRetailPricePreview } from "./product-pricing";
import { productPricingInputSchema } from "@breev/contracts/local-rest";

describe("localized numeric entry boundary", () => {
  const price = (costFils: string, marginPercentage: string) =>
    buildPricingPayload({
      costFils,
      marginPercentage,
      method: "by-percentage",
      retailPriceFils: "",
      wholesalePriceFils: "",
      rounding: "off",
    });
  it.each([
    ["80000", "12.500"],
    ["٨٠٠٠٠", "١٢٫٥٠٠"],
    ["۸۰۰۰۰", "۱۲.۵۰۰"],
  ])("preserves canonical payloads for %s / %s", (cost, margin) => {
    expect(price(cost!, margin!)).toEqual(price("80000", "12.500"));
    expect(calculateRetailPricePreview(cost!, margin!, "off")).toBe(
      calculateRetailPricePreview("80000", "12.500", "off"),
    );
    expect(stepNumericText(margin!, 1, 0.5, 0, 100)).toBe("13");
  });
  it("preserves huge integers and application names", () => {
    expect(normalizeNumericInput("٩٠٠٧١٩٩٢٥٤٧٤٠٩٩٣٠٠١")).toBe(
      "9007199254740993001",
    );
    const payload = buildPackagingPayload({
      defaultUnits: {
        count: { kind: "package-unit", packageUnitName: "Pack of 10" },
        purchase: { kind: "inventory-unit" },
        sale: { kind: "inventory-unit" },
      },
      hasThirdUnit: false,
      inventoryUnitName: "Strip",
      packageUnits: [{ name: "Pack of 10", baseUnitsPerPackage: "٤" }],
      thirdUnitName: "",
    });
    expect(payload.packageUnits).toEqual([
      { name: "Pack of 10", baseUnitsPerPackage: "4" },
    ]);
    expect(payload.defaultUnits.count).toEqual({
      kind: "package-unit",
      packageUnitName: "Pack of 10",
    });
  });
  it.each(["١٬٠٠٠", "1,000", "١٢٫٥.٠", "1e3", "-1", "", "100", "12.1234567"])(
    "retains and rejects invalid margin %s under the wire grammar",
    (value) => {
      expect(
        productPricingInputSchema.safeParse(price("80000", value)).success,
      ).toBe(false);
    },
  );
  it("does not turn nonempty invalid stepper input into zero", () => {
    expect(stepNumericText("malformed", 1, 1, 0)).toBeNull();
    expect(stepNumericText("", 1, 1, 0)).toBe("1");
    expect(normalizeNumericInput("١٫٥")).toBe("1٫5");
    expect(normalizeNumericInput(" ١ ")).toBe(" 1 ");
  });
});
