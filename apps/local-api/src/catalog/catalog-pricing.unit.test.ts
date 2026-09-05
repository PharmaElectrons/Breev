import { describe, expect, it } from "vitest";
import type {
  ProductPricing,
  ProductPricingInput,
} from "../../../../packages/contracts/src/local-rest/index.js";

import {
  resolveCatalogPricing,
  type CatalogPricingRequest,
} from "./catalog-pricing.js";

const ROUNDING_CASES = [
  { setting: "off", multiple: 1n },
  { setting: "nearest-250-iqd", multiple: 250_000n },
  { setting: "nearest-500-iqd", multiple: 500_000n },
  { setting: "nearest-1000-iqd", multiple: 1_000_000n },
] as const;

const MARGIN_CASES = [
  { text: "0", scaled: 0n },
  { text: "0.1", scaled: 100_000n },
  { text: "20", scaled: 20_000_000n },
  { text: "33.333333", scaled: 33_333_333n },
  { text: "50", scaled: 50_000_000n },
  { text: "67.125", scaled: 67_125_000n },
  { text: "99.999999", scaled: 99_999_999n },
] as const;

const ONE_HUNDRED_PERCENT = 100_000_000n;

/**
 * An independent oracle for the one rounding a calculated price is allowed.
 *
 * It compares the exact rational `numerator / denominator` against the two
 * neighbouring multiples by cross-multiplication alone -- no division, no
 * intermediate rounding, and no JS number -- so it agrees with the
 * implementation only if the implementation also rounds exactly once. Ties go
 * to the larger multiple, which is the module's away-from-zero rule for the
 * non-negative values a price can take.
 */
function nearestMultipleOfQuotient(
  numerator: bigint,
  denominator: bigint,
  multiple: bigint,
): bigint {
  const step = denominator * multiple;
  const lower = (numerator / step) * multiple;
  const upper = lower + multiple;
  const distanceFromLower = numerator - lower * denominator;
  const distanceFromUpper = upper * denominator - numerator;
  return distanceFromLower < distanceFromUpper ? lower : upper;
}

describe("catalog pricing", () => {
  it("treats percentage as margin on the selling price", () => {
    const pricing: ProductPricingInput = {
      method: "by-percentage",
      marginPercentage: "20",
      rounding: "off",
      wholesalePriceFils: null,
      costFils: "80000",
    };
    const outcome = resolveCatalogPricing(pricing);

    expect(outcome).toEqual({
      ok: true,
      pricing: {
        method: "by-percentage",
        marginPercentage: "20",
        retailPriceFils: "100000",
        rounding: "off",
        wholesalePriceFils: null,
      },
    });
    if (outcome.ok) {
      const contractReadBack: ProductPricing = outcome.pricing;
      expect(contractReadBack.retailPriceFils).toBe("100000");
      expect("costFils" in contractReadBack).toBe(false);
    }
  });

  it("returns the supplied By Price retail price without inventing a percentage", () => {
    const pricing: ProductPricingInput = {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: "90000",
    };
    const outcome = resolveCatalogPricing(pricing);

    expect(outcome).toEqual({
      ok: true,
      pricing: {
        method: "by-price",
        retailPriceFils: "100000",
        wholesalePriceFils: "90000",
      },
    });
    if (outcome.ok) {
      expect("marginPercentage" in outcome.pricing).toBe(false);
    }
  });

  it("keeps wholesale pricing as stored data outside the calculation", () => {
    const request = {
      method: "by-percentage",
      marginPercentage: "20",
      rounding: "off",
      wholesalePriceFils: "1",
      costFils: "80000",
    } as const;

    expect(resolveCatalogPricing(request)).toEqual({
      ok: true,
      pricing: {
        method: "by-percentage",
        marginPercentage: "20",
        rounding: "off",
        wholesalePriceFils: "1",
        retailPriceFils: "100000",
      },
    });
  });

  it("applies each optional rounding setting after calculating the margin price", () => {
    const cases = [
      { setting: "off", costFils: "375000", retailPriceFils: "468750" },
      {
        setting: "nearest-250-iqd",
        costFils: "300000",
        retailPriceFils: "500000",
      },
      {
        setting: "nearest-500-iqd",
        costFils: "200000",
        retailPriceFils: "500000",
      },
      {
        setting: "nearest-1000-iqd",
        costFils: "400000",
        retailPriceFils: "1000000",
      },
    ] as const;

    for (const testCase of cases) {
      const outcome = resolveCatalogPricing({
        method: "by-percentage",
        marginPercentage: "20",
        rounding: testCase.setting,
        wholesalePriceFils: null,
        costFils: testCase.costFils,
      });
      expect(outcome, testCase.setting).toMatchObject({
        ok: true,
        pricing: { retailPriceFils: testCase.retailPriceFils },
      });
    }
  });

  it("applies the rounding step to the exact price rather than to an already-rounded one", () => {
    // A cost of 300 IQD at a 19.999936% margin is exactly
    // 30,000,000,000,000 / 80,000,064 fils -- about 374,999.7, which sits below
    // the 375,000-fils midpoint of the 250-IQD step and therefore rounds down
    // to 250,000 fils. Rounding it to whole fils first would land it exactly on
    // that midpoint and carry it up to 500,000 instead, so this case fails on
    // any implementation that rounds twice.
    expect(
      resolveCatalogPricing({
        method: "by-percentage",
        marginPercentage: "19.999936",
        rounding: "nearest-250-iqd",
        wholesalePriceFils: null,
        costFils: "300000",
      }),
    ).toMatchObject({ ok: true, pricing: { retailPriceFils: "250000" } });

    // The same exact price with rounding off lands once on integer fils, which
    // is where the doubly-rounded answer above would have started.
    expect(
      resolveCatalogPricing({
        method: "by-percentage",
        marginPercentage: "19.999936",
        rounding: "off",
        wholesalePriceFils: null,
        costFils: "300000",
      }),
    ).toMatchObject({ ok: true, pricing: { retailPriceFils: "375000" } });
  });

  it("rejects noncanonical and impossible margins", () => {
    for (const marginPercentage of [
      "",
      "00",
      "01",
      ".5",
      "0.",
      "-1",
      "20.0000000",
      "1e1",
      " 20",
      "100",
      "100.0",
      "101",
      "٢٠",
    ]) {
      expect(
        resolveCatalogPricing({
          method: "by-percentage",
          marginPercentage,
          rounding: "off",
          wholesalePriceFils: null,
          costFils: "80000",
        }),
        marginPercentage,
      ).toEqual({
        ok: false,
        problem: { code: "margin-invalid" },
      });
    }

    const numberedMargin = {
      method: "by-percentage",
      marginPercentage: 20,
      rounding: "off",
      wholesalePriceFils: null,
      costFils: "80000",
    } as unknown as CatalogPricingRequest;
    expect(resolveCatalogPricing(numberedMargin)).toEqual({
      ok: false,
      problem: { code: "margin-invalid" },
    });
  });

  it("rejects negative, noncanonical, and JS-number costs at the authoritative seam", () => {
    expect(
      resolveCatalogPricing({
        method: "by-percentage",
        marginPercentage: "20",
        rounding: "off",
        wholesalePriceFils: null,
        costFils: "-1",
      }),
    ).toEqual({ ok: false, problem: { code: "cost-invalid" } });

    for (const costFils of ["", "01", "1.5", "1e3", " 1"]) {
      expect(
        resolveCatalogPricing({
          method: "by-percentage",
          marginPercentage: "20",
          rounding: "off",
          wholesalePriceFils: null,
          costFils,
        }),
        costFils,
      ).toEqual({ ok: false, problem: { code: "cost-invalid" } });
    }

    const numberedCost: CatalogPricingRequest = {
      method: "by-percentage",
      marginPercentage: "20",
      rounding: "off",
      wholesalePriceFils: null,
      // @ts-expect-error Authoritative costs are canonical decimal strings, never JS numbers.
      costFils: 80_000,
    };
    expect(resolveCatalogPricing(numberedCost)).toEqual({
      ok: false,
      problem: { code: "cost-invalid" },
    });
  });

  it("rejects a By Percentage request with no cost to calculate from", () => {
    const withoutCost = {
      method: "by-percentage",
      marginPercentage: "20",
      rounding: "off",
      wholesalePriceFils: null,
    } as unknown as CatalogPricingRequest;
    expect(resolveCatalogPricing(withoutCost)).toEqual({
      ok: false,
      problem: { code: "cost-invalid" },
    });
  });

  it("rejects non-text and noncanonical stored prices", () => {
    for (const retailPriceFils of [
      80_000,
      -1n,
      "-1",
      "01",
      "1.0",
      "9223372036854775808",
    ] as const) {
      const request = {
        method: "by-price",
        retailPriceFils,
        wholesalePriceFils: null,
      } as unknown as CatalogPricingRequest;
      expect(resolveCatalogPricing(request), String(retailPriceFils)).toEqual({
        ok: false,
        problem: { code: "retail-price-invalid" },
      });
    }

    const request = {
      method: "by-percentage",
      marginPercentage: "20",
      rounding: "off",
      wholesalePriceFils: 90_000,
      costFils: "80000",
    } as unknown as CatalogPricingRequest;
    expect(resolveCatalogPricing(request)).toEqual({
      ok: false,
      problem: { code: "wholesale-price-invalid" },
    });
  });

  it("rejects a rounding value outside the contract", () => {
    const request = {
      method: "by-percentage",
      marginPercentage: "20",
      rounding: "nearest-100-iqd",
      wholesalePriceFils: null,
      costFils: "80000",
    } as unknown as CatalogPricingRequest;

    expect(resolveCatalogPricing(request)).toEqual({
      ok: false,
      problem: { code: "rounding-invalid" },
    });
  });

  it("matches an independent exact oracle across generated margins, costs, and rounding steps", () => {
    for (const margin of MARGIN_CASES) {
      const denominator = ONE_HUNDRED_PERCENT - margin.scaled;
      for (let costFils = 0n; costFils <= 25n; costFils += 1n) {
        for (const rounding of ROUNDING_CASES) {
          const expected = nearestMultipleOfQuotient(
            costFils * ONE_HUNDRED_PERCENT,
            denominator,
            rounding.multiple,
          );
          const outcome = resolveCatalogPricing({
            method: "by-percentage",
            marginPercentage: margin.text,
            rounding: rounding.setting,
            wholesalePriceFils: "9223372036854775807",
            costFils: costFils.toString(),
          });
          expect(
            outcome,
            `${margin.text}/${costFils}/${rounding.setting}`,
          ).toMatchObject({
            ok: true,
            pricing: { retailPriceFils: expected.toString() },
          });
        }
      }
    }
  });

  it("rejects a calculated retail price that cannot fit the bigint store", () => {
    expect(
      resolveCatalogPricing({
        costFils: "9223372036854775807",
        marginPercentage: "99.999999",
        method: "by-percentage",
        rounding: "off",
        wholesalePriceFils: null,
      }),
    ).toEqual({
      ok: false,
      problem: { code: "retail-price-invalid" },
    });
  });
});
