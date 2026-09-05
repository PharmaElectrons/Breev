import {
  parseCanonicalInteger,
  parseScaledDecimal,
  roundQuotientToMultiple,
} from "./catalog-exact.js";

export type PriceRoundingSetting =
  "nearest-1000-iqd" | "nearest-250-iqd" | "nearest-500-iqd" | "off";

interface CatalogPricingShared {
  readonly wholesalePriceFils: string | null;
}

export type CatalogPricingRequest =
  | (CatalogPricingShared & {
      readonly method: "by-price";
      readonly retailPriceFils: string;
    })
  | (CatalogPricingShared & {
      readonly method: "by-percentage";
      readonly costFils: string;
      readonly marginPercentage: string;
      readonly rounding: PriceRoundingSetting;
    });

export type CatalogPricing =
  | (CatalogPricingShared & {
      readonly method: "by-price";
      readonly retailPriceFils: string;
    })
  | (CatalogPricingShared & {
      readonly method: "by-percentage";
      readonly marginPercentage: string;
      readonly retailPriceFils: string;
      readonly rounding: PriceRoundingSetting;
    });

export type CatalogPricingProblemCode =
  | "cost-invalid"
  | "margin-invalid"
  | "retail-price-invalid"
  | "rounding-invalid"
  | "wholesale-price-invalid";

export interface CatalogPricingProblem {
  readonly code: CatalogPricingProblemCode;
}

export type CatalogPricingOutcome =
  | { readonly ok: true; readonly pricing: CatalogPricing }
  | { readonly ok: false; readonly problem: CatalogPricingProblem };

const PERCENTAGE_SCALE = 1_000_000n;
const ONE_HUNDRED_PERCENT = 100n * PERCENTAGE_SCALE;
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;

function roundingMultiple(rounding: PriceRoundingSetting): bigint | null {
  switch (rounding) {
    case "off":
      return 1n;
    case "nearest-250-iqd":
      return 250_000n;
    case "nearest-500-iqd":
      return 500_000n;
    case "nearest-1000-iqd":
      return 1_000_000n;
    default:
      return null;
  }
}

function validOptionalPrice(value: string | null): boolean {
  if (value === null) return true;
  const parsed = parseCanonicalInteger(value);
  return parsed !== null && parsed <= POSTGRES_BIGINT_MAXIMUM;
}

/**
 * Resolves contract-shaped editable input into the pricing persistence stores.
 *
 * By Percentage is `cost / (1 - margin)` -- margin on the selling price, not
 * markup on cost, so a cost of 80 IQD at 20% is 100 IQD and never 96. The
 * quotient stays an exact rational all the way to the one rounding that
 * produces the stored price: the configured step is applied straight to it,
 * and "off" is that same step of one fils rather than a second code path.
 * Rounding to fils first and to the dinar step afterwards would round twice and
 * carry a price that sits just below a step midpoint up to the next step.
 *
 * By Price stores the supplied retail price unchanged, because that method
 * calculates nothing.
 */
export function resolveCatalogPricing(
  request: CatalogPricingRequest,
): CatalogPricingOutcome {
  if (!validOptionalPrice(request.wholesalePriceFils)) {
    return { ok: false, problem: { code: "wholesale-price-invalid" } };
  }

  if (request.method === "by-price") {
    const retailPriceFils = parseCanonicalInteger(request.retailPriceFils);
    if (retailPriceFils === null || retailPriceFils > POSTGRES_BIGINT_MAXIMUM) {
      return { ok: false, problem: { code: "retail-price-invalid" } };
    }
    return {
      ok: true,
      pricing: {
        method: "by-price",
        retailPriceFils: request.retailPriceFils,
        wholesalePriceFils: request.wholesalePriceFils,
      },
    };
  }

  const costFils = parseCanonicalInteger(request.costFils);
  if (costFils === null || costFils > POSTGRES_BIGINT_MAXIMUM) {
    return { ok: false, problem: { code: "cost-invalid" } };
  }

  const margin = parseScaledDecimal(request.marginPercentage, 6);
  if (margin === null || margin >= ONE_HUNDRED_PERCENT) {
    return { ok: false, problem: { code: "margin-invalid" } };
  }

  const multiple = roundingMultiple(request.rounding);
  if (multiple === null) {
    return { ok: false, problem: { code: "rounding-invalid" } };
  }

  const retailPriceFils = roundQuotientToMultiple(
    costFils * ONE_HUNDRED_PERCENT,
    ONE_HUNDRED_PERCENT - margin,
    multiple,
  );
  if (retailPriceFils > POSTGRES_BIGINT_MAXIMUM) {
    return { ok: false, problem: { code: "retail-price-invalid" } };
  }

  return {
    ok: true,
    pricing: {
      method: "by-percentage",
      marginPercentage: request.marginPercentage,
      retailPriceFils: retailPriceFils.toString(),
      rounding: request.rounding,
      wholesalePriceFils: request.wholesalePriceFils,
    },
  };
}
