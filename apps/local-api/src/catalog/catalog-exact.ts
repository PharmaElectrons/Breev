/**
 * Exact integer and decimal arithmetic for Catalog packaging and pricing.
 *
 * Internal to Catalog. Nothing here is part of a public module interface: the
 * packaging and pricing modules beside it are, and they are what callers and
 * tests use. It exists so that the one place a division can lose information --
 * the halfway case -- is written once and answered the same way everywhere.
 *
 * Every value is a `bigint`. docs/domain.md §"Exact quantities, money, and
 * accounting" forbids binary floating point for money, rates, quantities,
 * discounts, valuation, tax, tender, and report totals, and a JS `number` is
 * binary floating point whatever it looks like. Exact decimal text (a margin
 * percentage) is read into a scaled integer here and never through
 * `Number`, `parseFloat`, or arithmetic on a `number`.
 *
 * ## The halfway rule
 *
 * When an exact quotient falls precisely between two integers, this module
 * rounds **away from zero** -- 2.5 fils becomes 3, and -2.5 becomes -3. It is
 * deterministic, symmetric about zero, and independent of the order in which
 * values are processed.
 *
 * It is an engineering default, not an accountant's decision. docs/domain.md
 * defers exact decimal precision, rounding, and remainder allocation to gate
 * G-01 in docs/open-decisions.md. Until that gate closes, every Catalog
 * rounding decision goes through {@link divideRounded} or
 * {@link roundQuotientToMultiple}, so closing it changes this file and nothing
 * else.
 */

/** The deterministic halfway behaviour this module applies, named for callers that report it. */
export const HALFWAY_RULE = "half-away-from-zero" as const;

/** An exact quotient, and whether anything had to be rounded to produce it. */
export interface RoundedQuotient {
  readonly value: bigint;
  readonly exact: boolean;
}

/**
 * Divides exactly, rounding a non-integer quotient by the halfway rule above.
 * The denominator must not be zero: a caller that could produce one has a
 * missing check, not a rounding question.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
): RoundedQuotient {
  assertExact(numerator, "A numerator");
  assertExact(denominator, "A denominator");
  if (denominator === 0n) {
    throw new RangeError("An exact quotient cannot divide by zero");
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  if (remainder === 0n) {
    return { value: negative ? -quotient : quotient, exact: true };
  }

  // Away from zero on the exact half, so the comparison is `>=`.
  const rounded =
    2n * remainder >= absoluteDenominator ? quotient + 1n : quotient;
  return { value: negative ? -rounded : rounded, exact: false };
}

/**
 * Rounds the exact quotient `numerator / denominator` to the nearest multiple,
 * in **one** rounding step.
 *
 * This is the only shape a calculated price may take. Landing on integer fils
 * first and then rounding that to a dinar step rounds twice, and two roundings
 * are not one: an exact price of 374,999.7 fils is below the 375,000-fils
 * midpoint and belongs at 250,000 fils under a 250-IQD step, but rounding it to
 * 375,000 fils first puts it exactly on the midpoint and carries it up to
 * 500,000. docs/domain.md §"Exact quantities, money, and accounting" allows
 * deterministic rounding only where the posted amount is produced, so the
 * intermediate keeps full precision and the configured step is applied straight
 * to the rational value.
 *
 * A multiple of one is not a special case: it collapses to a single rounding
 * onto integer fils, which is exactly what "rounding is off" means.
 */
export function roundQuotientToMultiple(
  numerator: bigint,
  denominator: bigint,
  multiple: bigint,
): bigint {
  assertExact(multiple, "A rounding multiple");
  if (multiple <= 0n) {
    throw new RangeError("A rounding multiple must be positive");
  }
  return divideRounded(numerator, denominator * multiple).value * multiple;
}

/**
 * The canonical decimal integer grammar shared by quantities and amounts: `0`,
 * or a digit string that does not start with `0`. Deliberately strict, because
 * `BigInt` itself accepts `""`, `" 1"`, and `"+1"`, and because two spellings
 * of one value would let two different requests claim to be the same quantity.
 */
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;

/**
 * Reads a canonical unsigned decimal integer string, or `null` when the text is
 * not one. A decimal point, an exponent, a sign, a leading zero, a space, or a
 * non-ASCII digit shape all return `null`: they are the notations of binary
 * floating point or of a second spelling, and neither may carry an
 * authoritative value.
 */
export function parseCanonicalInteger(text: string): bigint | null {
  if (typeof text !== "string") return null;
  if (!CANONICAL_UNSIGNED_INTEGER.test(text)) return null;
  return BigInt(text);
}

/**
 * Reads exact decimal text into an integer scaled by `10 ** decimalPlaces`, or
 * `null` when the text is not canonical decimal text within that many places.
 *
 * `"20"` at six places is `20_000_000n`. The text never becomes a `number` on
 * the way, so `"0.1"` stays exactly one tenth instead of the nearest binary
 * fraction to it.
 */
export function parseScaledDecimal(
  text: string,
  decimalPlaces: number,
): bigint | null {
  if (typeof text !== "string") return null;
  const pattern = new RegExp(
    `^(0|[1-9][0-9]*)(?:\\.([0-9]{1,${decimalPlaces}}))?$`,
    "u",
  );
  const match = pattern.exec(text);
  if (match === null) return null;

  const whole = match[1] ?? "";
  const fraction = (match[2] ?? "").padEnd(decimalPlaces, "0");
  return BigInt(`${whole}${fraction}`);
}

function assertExact(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(
      `${label} must be an exact bigint, received ${typeof value}`,
    );
  }
}
