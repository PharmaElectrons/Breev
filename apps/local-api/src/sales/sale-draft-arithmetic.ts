const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const CANONICAL_INTEGER = /^(0|[1-9]\d*)$/u;

/**
 * Preserve the line's base-unit quantity when switching its selected unit.
 * Returns undefined when the conversion is fractional or cannot be represented
 * by PostgreSQL's positive bigint quantity columns.
 */
export function saleQuantityAfterUnitChange(input: {
  readonly quantity: string;
  readonly currentBaseUnitsPerUnit: string;
  readonly nextBaseUnitsPerUnit: string;
}): string | undefined {
  const quantity = positiveBigint(input.quantity);
  const currentRatio = positiveBigint(input.currentBaseUnitsPerUnit);
  const nextRatio = positiveBigint(input.nextBaseUnitsPerUnit);
  if (
    quantity === undefined ||
    currentRatio === undefined ||
    nextRatio === undefined
  ) {
    return undefined;
  }

  const baseQuantity = quantity * currentRatio;
  if (baseQuantity > POSTGRES_BIGINT_MAX || baseQuantity % nextRatio !== 0n) {
    return undefined;
  }

  const nextQuantity = baseQuantity / nextRatio;
  if (nextQuantity < 1n || nextQuantity > POSTGRES_BIGINT_MAX) {
    return undefined;
  }
  return nextQuantity.toString();
}

/** Convert captured retail price between package ratios with half-up rounding. */
export function saleUnitPriceFils(input: {
  readonly capturedRetailPriceFils: string;
  readonly capturedUnitRatio: string;
  readonly nextUnitRatio: string;
}): string | undefined {
  const capturedPrice = nonnegativeBigint(input.capturedRetailPriceFils);
  const capturedRatio = positiveBigint(input.capturedUnitRatio);
  const nextRatio = positiveBigint(input.nextUnitRatio);
  if (
    capturedPrice === undefined ||
    capturedRatio === undefined ||
    nextRatio === undefined
  ) {
    return undefined;
  }

  const numerator = capturedPrice * nextRatio;
  const convertedPrice = (numerator + capturedRatio / 2n) / capturedRatio;
  if (convertedPrice > POSTGRES_BIGINT_MAX) return undefined;
  return convertedPrice.toString();
}

/** Calculate the existing half-up percentage discount in integer fils. */
export function saleLineDiscountFils(input: {
  readonly grossFils: string;
  readonly discountPercentage: string;
}): string | undefined {
  const gross = nonnegativeBigint(input.grossFils);
  const percentage = nonnegativeBigint(input.discountPercentage);
  if (gross === undefined || percentage === undefined || percentage > 100n) {
    return undefined;
  }

  return ((gross * percentage + 50n) / 100n).toString();
}

function nonnegativeBigint(value: string): bigint | undefined {
  if (!CANONICAL_INTEGER.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed <= POSTGRES_BIGINT_MAX ? parsed : undefined;
}

function positiveBigint(value: string): bigint | undefined {
  const parsed = nonnegativeBigint(value);
  return parsed !== undefined && parsed > 0n ? parsed : undefined;
}
