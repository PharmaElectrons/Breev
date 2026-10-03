import { formatFilsToIqd } from "./product-record";

/** Correction effects may be negative; the shared price formatter takes magnitudes. */
export function formatAdjustmentFils(
  value: string,
  locale: "ar" | "en",
): string {
  return value.startsWith("-")
    ? `−${formatFilsToIqd(value.slice(1), locale)}`
    : formatFilsToIqd(value, locale);
}
