import { formatCurrencyFromFils } from "./preferences";

export function formatAdjustmentFils(
  value: string,
  locale: "ar" | "en",
): string {
  return formatCurrencyFromFils(value, locale);
}
