import { describe, expect, it } from "vitest";

import { resolveCatalogPricing } from "../catalog/catalog-pricing.js";
import {
  capturePurchaseRetailPrice,
  type PurchasePriceCaptureResult,
  type PurchaseRowPricingFacts,
} from "./purchase-price-capture.js";

const BY_PRICE = {
  method: "by-price",
  retailPriceFils: "100000",
  wholesalePriceFils: "90000",
} as const;
const BY_PERCENTAGE = {
  marginPercentage: "20",
  method: "by-percentage",
  retailPriceFils: "100000",
  rounding: "off",
  wholesalePriceFils: "90000",
} as const;

function required(
  productPricing: Parameters<typeof capturePurchaseRetailPrice>[0],
  row: PurchaseRowPricingFacts,
): PurchasePriceCaptureResult {
  const outcome = capturePurchaseRetailPrice(productPricing, row);
  if (!outcome.ok) throw new Error(`unexpected rejection: ${outcome.problem}`);
  return outcome.result;
}

describe("capturePurchaseRetailPrice", () => {
  it("makes the By Price invoice price the item's current price", () => {
    expect(
      required(BY_PRICE, {
        costFils: "80000",
        marginPercentage: null,
        method: "by-price",
        retailPriceFils: "120000",
      }),
    ).toEqual({
      capture: "by-price-propagated",
      itemPriceUpdateFils: "120000",
      marginPercentage: null,
      retailPriceFils: "120000",
    });
  });

  it("rewrites nothing when By Price approved the price the item already has", () => {
    expect(
      required(BY_PRICE, {
        costFils: "80000",
        marginPercentage: null,
        method: "by-price",
        retailPriceFils: "100000",
      }),
    ).toMatchObject({
      capture: "by-price-propagated",
      itemPriceUpdateFils: null,
      retailPriceFils: "100000",
    });
  });

  it("calculates the By Percentage price and leaves the item record alone", () => {
    // docs/quality.md: cost 80 with a 20% margin yields 100 -- margin on the
    // selling price, never markup on cost.
    expect(
      required(BY_PERCENTAGE, {
        costFils: "80000",
        marginPercentage: "20",
        method: "by-percentage",
        retailPriceFils: "0",
      }),
    ).toEqual({
      capture: "by-percentage-calculated",
      itemPriceUpdateFils: null,
      marginPercentage: "20",
      retailPriceFils: "100000",
    });
  });

  it("recalculates from the current cost rather than the row's stored price", () => {
    const result = required(BY_PERCENTAGE, {
      costFils: "160000",
      marginPercentage: "20",
      method: "by-percentage",
      retailPriceFils: "100000",
    });
    expect(result.retailPriceFils).toBe("200000");
  });

  it("uses the item's current rounding step, in one rounding", () => {
    const rounded = required(
      { ...BY_PERCENTAGE, rounding: "nearest-250-iqd" },
      {
        costFils: "300000",
        marginPercentage: "20",
        method: "by-percentage",
        retailPriceFils: "0",
      },
    );
    // The exact price is 375,000 fils; a 250-IQD step lands it on 500,000.
    expect(rounded.retailPriceFils).toBe("500000");
    // The same answer the item screen and the row commit already produce.
    const viaCatalog = resolveCatalogPricing({
      costFils: "300000",
      marginPercentage: "20",
      method: "by-percentage",
      rounding: "nearest-250-iqd",
      wholesalePriceFils: "90000",
    });
    expect(viaCatalog.ok && viaCatalog.pricing.retailPriceFils).toBe("500000");
  });

  it("refuses a row whose item changed pricing method since entry", () => {
    expect(
      capturePurchaseRetailPrice(BY_PERCENTAGE, {
        costFils: "80000",
        marginPercentage: null,
        method: "by-price",
        retailPriceFils: "120000",
      }),
    ).toEqual({ ok: false, problem: "pricing-mode-changed" });
    expect(
      capturePurchaseRetailPrice(BY_PRICE, {
        costFils: "80000",
        marginPercentage: "20",
        method: "by-percentage",
        retailPriceFils: "0",
      }),
    ).toEqual({ ok: false, problem: "pricing-mode-changed" });
  });

  it("refuses a By Percentage row with no percentage to calculate from", () => {
    expect(
      capturePurchaseRetailPrice(BY_PERCENTAGE, {
        costFils: "80000",
        marginPercentage: null,
        method: "by-percentage",
        retailPriceFils: "0",
      }),
    ).toEqual({ ok: false, problem: "margin-missing" });
  });

  it("refuses a price that is not exact non-negative integer text", () => {
    for (const invalid of [
      "-1",
      "1.5",
      "1e3",
      "",
      "01",
      "9223372036854775808",
    ]) {
      expect(
        capturePurchaseRetailPrice(BY_PRICE, {
          costFils: "80000",
          marginPercentage: null,
          method: "by-price",
          retailPriceFils: invalid,
        }),
        invalid,
      ).toEqual({ ok: false, problem: "retail-price-invalid" });
    }
    expect(
      capturePurchaseRetailPrice(BY_PERCENTAGE, {
        costFils: "1.5",
        marginPercentage: "20",
        method: "by-percentage",
        retailPriceFils: "0",
      }),
    ).toEqual({ ok: false, problem: "retail-price-invalid" });
  });
});
