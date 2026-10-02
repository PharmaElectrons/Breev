import { normalizeIndicDigits } from "@breev/contracts/local-rest";

/** Normalize representations only; each field keeps its existing validator. */
export function normalizeNumericInput(value: string, decimal = false): string {
  const digits = normalizeIndicDigits(value);
  return decimal ? digits.replaceAll("٫", ".") : digits;
}

/** Preserve whole-number arrow stepping without a floating point HTML control. */
export function stepIntegerInput(
  value: string,
  direction: 1 | -1,
  min: bigint,
  max?: bigint,
): string | null {
  const text = normalizeNumericInput(value);
  if (text !== "" && !/^[0-9]+$/u.test(text)) return null;
  const next = (text === "" ? 0n : BigInt(text)) + BigInt(direction);
  if (next < min || (max !== undefined && next > max)) return null;
  return next.toString();
}
