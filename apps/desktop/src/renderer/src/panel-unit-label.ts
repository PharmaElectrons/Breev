import type { Locale } from "./preferences";

import { countUnitLabel } from "../../shared/unit-display";
export function panelUnitLabel(
  name: string,
  count: bigint,
  locale: Locale,
): string {
  return countUnitLabel(name, count, locale);
}
export function integerFromFormatted(value: string): bigint {
  let negative = false;
  let digits = "";
  for (const char of value) {
    if (char === "-" || char === "−") {
      negative = true;
      continue;
    }
    const indic = "٠١٢٣٤٥٦٧٨٩".indexOf(char);
    if (indic >= 0) {
      digits += String(indic);
      continue;
    }
    const extended = "۰۱۲۳۴۵۶۷۸۹".indexOf(char);
    if (extended >= 0) {
      digits += String(extended);
      continue;
    }
    if (char >= "0" && char <= "9") digits += char;
  }
  const magnitude = digits === "" ? 0n : BigInt(digits);
  return negative ? -magnitude : magnitude;
}

export function unitQuantity(quantity: string): bigint {
  return /^-?\d+$/u.test(quantity) ? BigInt(quantity) : 1n;
}

export function unitCount(value: string | number): bigint {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  return integerFromFormatted(value);
}
