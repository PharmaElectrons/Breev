import { normalizeNumericInput } from "./numeric-input";
/**
 * Preview the selling price implied by cost, a margin on selling price, and
 * the selected IQD rounding rule. The server remains authoritative when the
 * Product or purchase row is saved.
 */
export function calculateRetailPricePreview(
  cost: string,
  margin: string,
  rounding: "nearest-1000-iqd" | "nearest-250-iqd" | "nearest-500-iqd" | "off",
): string {
  cost = normalizeNumericInput(cost);
  margin = normalizeNumericInput(margin, true);
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(cost) ||
    !/^(?:0|[1-9][0-9]?)(?:\.[0-9]{1,6})?$/u.test(margin)
  ) {
    return "0";
  }
  const [whole = "0", fraction = ""] = margin.split(".");
  const scaled = BigInt(`${whole}${fraction.padEnd(6, "0")}`);
  const hundred = 100_000_000n;
  if (scaled >= hundred) return "0";
  const multiple =
    rounding === "off"
      ? 1n
      : rounding === "nearest-250-iqd"
        ? 250_000n
        : rounding === "nearest-500-iqd"
          ? 500_000n
          : 1_000_000n;
  const numerator = BigInt(cost) * hundred;
  const denominator = (hundred - scaled) * multiple;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return (
    (quotient + (remainder * 2n >= denominator ? 1n : 0n)) *
    multiple
  ).toString();
}
