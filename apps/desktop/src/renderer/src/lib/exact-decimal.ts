import {
  patientWeightRegex,
  patientHeightRegex,
  patientDiscountRegex,
} from "@breev/contracts/local-rest";

/**
 * A completely lossless exact-decimal formatter.
 * Safely formats strings representing decimal values (e.g., from Postgres numeric)
 * without ever converting through JavaScript `number` (IEEE 754 float).
 *
 * Requirements (as per spec):
 * - Must NOT use `Number()` or `parseFloat()`
 * - Must split at `.` and process integer/fractional parts as strings
 */
export function formatCanonicalDecimal(
  value: string | null | undefined,
): string {
  if (!value) return "0";

  // Check if negative
  const isNegative = value.startsWith("-");
  const absoluteValue = isNegative ? value.substring(1) : value;

  // Split integer and fraction
  const parts = absoluteValue.split(".");
  const integerPart = parts[0] || "0";
  const fractionalPart = parts.length > 1 ? parts[1] : "";

  // Apply grouping to integer part (e.g. 1,000,000)
  // This uses a regex to insert commas for thousands separators
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  let result = groupedInteger;

  // Add fraction if it exists (strip trailing zeros if any exist)
  if (fractionalPart) {
    const trimmedFraction = fractionalPart.replace(/0+$/, "");
    if (trimmedFraction.length > 0) {
      result += "." + trimmedFraction;
    }
  }

  // Prepend negative sign if applicable, avoiding "-0"
  if (isNegative && result !== "0") {
    return "-" + result;
  }

  return result;
}

/**
 * Lossless string-based comparison of two positive decimal strings.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareExactDecimal(a: string, b: string): number {
  const [aInt = "0", aFrac = ""] = a.split(".");
  const [bInt = "0", bFrac = ""] = b.split(".");

  const aCleanInt = aInt.replace(/^0+(?=\d)/, "");
  const bCleanInt = bInt.replace(/^0+(?=\d)/, "");

  if (aCleanInt.length !== bCleanInt.length) {
    return aCleanInt.length - bCleanInt.length;
  }
  if (aCleanInt !== bCleanInt) {
    return aCleanInt < bCleanInt ? -1 : 1;
  }

  const maxFracLen = Math.max(aFrac.length, bFrac.length);
  const aPaddedFrac = aFrac.padEnd(maxFracLen, "0");
  const bPaddedFrac = bFrac.padEnd(maxFracLen, "0");

  if (aPaddedFrac !== bPaddedFrac) {
    return aPaddedFrac < bPaddedFrac ? -1 : 1;
  }
  return 0;
}

/**
 * Validates a patient weight string (0.1 to 700.0 kg, max 1 decimal place).
 */
export function isValidPatientWeight(value: string): boolean {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !patientWeightRegex.test(normalized)) {
    return false;
  }
  return (
    compareExactDecimal(normalized, "0.1") >= 0 &&
    compareExactDecimal(normalized, "700.0") <= 0
  );
}

/**
 * Validates a patient height string (0.1 to 300.0 cm, max 1 decimal place).
 */
export function isValidPatientHeight(value: string): boolean {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !patientHeightRegex.test(normalized)) {
    return false;
  }
  return (
    compareExactDecimal(normalized, "0.1") >= 0 &&
    compareExactDecimal(normalized, "300.0") <= 0
  );
}

/**
 * Validates a patient discount percentage string (0.00 to 100.00%, max 2 decimal places).
 */
export function isValidPatientDiscount(value: string): boolean {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !patientDiscountRegex.test(normalized)) {
    return false;
  }
  return (
    compareExactDecimal(normalized, "0") >= 0 &&
    compareExactDecimal(normalized, "100.00") <= 0
  );
}
