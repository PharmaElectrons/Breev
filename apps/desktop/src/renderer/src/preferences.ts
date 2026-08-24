export type Locale = "ar" | "en";
export type Theme = "dark" | "light";
export type Direction = "ltr" | "rtl";

export const LOCALE_STORAGE_KEY = "breev.locale";
export const THEME_STORAGE_KEY = "breev.theme";

interface ReadableStorage {
  getItem(key: string): string | null;
}

const localeTags: Record<Locale, string> = {
  ar: "ar-IQ",
  en: "en-IQ",
};

export function directionForLocale(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export function readStoredLocale(storage: ReadableStorage): Locale {
  return storage.getItem(LOCALE_STORAGE_KEY) === "ar" ? "ar" : "en";
}

export function readStoredTheme(storage: ReadableStorage): Theme {
  return storage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function formatNumber(value: number | bigint, locale: Locale): string {
  return new Intl.NumberFormat(localeTags[locale]).format(value);
}

export function formatDateTime(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(value);
}

export function formatCurrencyFromFils(value: bigint, locale: Locale): string {
  const sign = value < 0n ? "-" : "";
  const absoluteValue = value < 0n ? -value : value;
  const decimalValue = `${sign}${absoluteValue / 1_000n}.${String(
    absoluteValue % 1_000n,
  ).padStart(3, "0")}`;
  const formatter = new Intl.NumberFormat(localeTags[locale], {
    currency: "IQD",
    currencyDisplay: "code",
    maximumFractionDigits: 3,
    minimumFractionDigits: 3,
    style: "currency",
  });

  return formatter.format(decimalValue as unknown as number);
}
