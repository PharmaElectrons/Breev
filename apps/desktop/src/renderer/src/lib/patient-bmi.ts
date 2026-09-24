export type BmiCategory =
  "underweight" | "normal" | "overweight" | "obese" | "unknown";

export function categorizeBmi(
  bmiString: string | null | undefined,
): BmiCategory {
  if (!bmiString) return "unknown";

  const parts = bmiString.split(".");
  const integerPart = parts[0] || "0";
  const fractionalPart = (parts[1] || "").padEnd(1, "0").substring(0, 1);

  let val: bigint;
  try {
    val = BigInt(integerPart + fractionalPart);
  } catch {
    return "unknown";
  }

  if (val < 185n) return "underweight";
  if (val < 250n) return "normal";
  if (val < 300n) return "overweight";
  return "obese";
}
