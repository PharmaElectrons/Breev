export type BmiCategory =
  "underweight" | "normal" | "overweight" | "obese" | "unknown";

export function categorizeBmi(
  bmiString: string | null | undefined,
): BmiCategory {
  if (!bmiString) return "unknown";

  // Parse exact decimal string to an integer representation (multiply by 10 for 1 decimal place)
  // e.g. "18.5" -> 185, "25" -> 250, "30.0" -> 300
  const parts = bmiString.split(".");
  const integerPart = parts[0] || "0";
  const fractionalPart = (parts[1] || "").padEnd(1, "0").substring(0, 1);

  // Use BigInt for exact arithmetic bounds checking
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
