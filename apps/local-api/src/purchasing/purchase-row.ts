import {
  definePackaging,
  toBaseUnits,
  type PackagingDefinition,
  type UnitReference,
} from "../catalog/catalog-packaging.js";
import {
  resolveCatalogPricing,
  type PriceRoundingSetting,
} from "../catalog/catalog-pricing.js";

const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;

export interface PurchaseRowProduct {
  readonly displayName: string;
  readonly id: string;
  readonly packaging: PackagingDefinition;
  readonly pricing:
    | {
        readonly method: "by-price";
        readonly retailPriceFils: string;
        readonly wholesalePriceFils: string | null;
      }
    | {
        readonly marginPercentage: string;
        readonly method: "by-percentage";
        readonly retailPriceFils: string;
        readonly rounding: PriceRoundingSetting;
        readonly wholesalePriceFils: string | null;
      };
}

export interface PurchaseRowInput {
  readonly costFils: string;
  readonly enteredQuantity: string;
  readonly pricing:
    | { readonly method: "by-price"; readonly retailPriceFils: string }
    | {
        readonly marginPercentage: string;
        readonly method: "by-percentage";
      };
  readonly unit: UnitReference;
}

export interface PurchaseRowFacts {
  readonly baseUnitsPerEnteredUnit: string;
  readonly costFils: string;
  readonly enteredQuantity: string;
  readonly inventoryUnitName: string;
  readonly inventoryUnitQuantity: string;
  readonly marginPercentage: string | null;
  readonly pricingMethod: "by-percentage" | "by-price";
  readonly retailPriceFils: string;
  readonly unit: UnitReference;
}

export type PurchaseRowProblemCode =
  | "cost-invalid"
  | "money-overflow"
  | "pricing-mode-conflict"
  | "quantity-invalid"
  | "unit-invalid";

export type PurchaseRowOutcome =
  | { readonly facts: PurchaseRowFacts; readonly ok: true }
  | { readonly ok: false; readonly problem: PurchaseRowProblemCode };

/**
 * Validates and converts one completed purchase row without framework or
 * persistence concerns. The entered spelling is retained beside the exact
 * Inventory Unit quantity that later stock posting will consume.
 */
export function preparePurchaseRow(
  product: PurchaseRowProduct,
  input: PurchaseRowInput,
): PurchaseRowOutcome {
  if (product.pricing.method !== input.pricing.method) {
    return { ok: false, problem: "pricing-mode-conflict" };
  }

  const quantity = parsePositiveInteger(input.enteredQuantity);
  if (quantity === null) return { ok: false, problem: "quantity-invalid" };
  const cost = parseUnsignedInteger(input.costFils);
  if (cost === null) return { ok: false, problem: "cost-invalid" };
  if (
    cost > POSTGRES_BIGINT_MAXIMUM ||
    cost * quantity > POSTGRES_BIGINT_MAXIMUM
  ) {
    return { ok: false, problem: "money-overflow" };
  }

  const packaging = definePackaging(product.packaging);
  if (!packaging.ok) return { ok: false, problem: "unit-invalid" };
  const converted = toBaseUnits(packaging.packaging, input.unit, quantity);
  if (!converted.ok || converted.baseUnits <= 0n) {
    return { ok: false, problem: "unit-invalid" };
  }
  if (converted.baseUnits > POSTGRES_BIGINT_MAXIMUM) {
    return { ok: false, problem: "quantity-invalid" };
  }
  const baseUnitsPerEnteredUnit = converted.baseUnits / quantity;

  if (input.pricing.method === "by-price") {
    const retail = parseUnsignedInteger(input.pricing.retailPriceFils);
    if (retail === null || retail > POSTGRES_BIGINT_MAXIMUM) {
      return { ok: false, problem: "cost-invalid" };
    }
    return {
      facts: {
        baseUnitsPerEnteredUnit: baseUnitsPerEnteredUnit.toString(),
        costFils: input.costFils,
        enteredQuantity: input.enteredQuantity,
        inventoryUnitName: packaging.packaging.inventoryUnitName,
        inventoryUnitQuantity: converted.baseUnits.toString(),
        marginPercentage: null,
        pricingMethod: "by-price",
        retailPriceFils: input.pricing.retailPriceFils,
        unit: input.unit,
      },
      ok: true,
    };
  }

  if (product.pricing.method !== "by-percentage") {
    return { ok: false, problem: "pricing-mode-conflict" };
  }

  const pricing = resolveCatalogPricing({
    costFils: input.costFils,
    marginPercentage: input.pricing.marginPercentage,
    method: "by-percentage",
    rounding: product.pricing.rounding,
    wholesalePriceFils: product.pricing.wholesalePriceFils,
  });
  if (!pricing.ok) {
    return {
      ok: false,
      problem:
        pricing.problem.code === "cost-invalid"
          ? "cost-invalid"
          : "pricing-mode-conflict",
    };
  }
  return {
    facts: {
      baseUnitsPerEnteredUnit: baseUnitsPerEnteredUnit.toString(),
      costFils: input.costFils,
      enteredQuantity: input.enteredQuantity,
      inventoryUnitName: packaging.packaging.inventoryUnitName,
      inventoryUnitQuantity: converted.baseUnits.toString(),
      marginPercentage: input.pricing.marginPercentage,
      pricingMethod: "by-percentage",
      retailPriceFils: pricing.pricing.retailPriceFils,
      unit: input.unit,
    },
    ok: true,
  };
}

function parseUnsignedInteger(value: string): bigint | null {
  return /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}

function parsePositiveInteger(value: string): bigint | null {
  return /^[1-9][0-9]*$/u.test(value) ? BigInt(value) : null;
}
