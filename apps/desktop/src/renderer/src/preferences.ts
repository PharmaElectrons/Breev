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

export function formatNumber(
  value: number | bigint | string,
  locale: Locale,
): string {
  if (typeof value === "string") return formatDecimal(value, locale);
  return new Intl.NumberFormat(localeTags[locale]).format(value);
}

/** Canonical exact decimals are presentation data, never binary floating point. */
export function formatDecimal(value: string, locale: Locale): string {
  if (!/^-?\d+(?:\.\d+)?$/u.test(value)) return "—";
  const [whole = "0", fraction] = value.split(".");
  const negative = whole.startsWith("-");
  const integer = BigInt(whole);
  const grouped = new Intl.NumberFormat(localeTags[locale]).format(
    integer < 0n ? -integer : integer,
  );
  const amount = `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `${locale === "ar" ? "٫" : "."}${locale === "ar" ? localizeCurrencyAmount(fraction) : fraction}`}`;
  return amount;
}

/** The input already represents percentage points, e.g. 12.5 means 12.5%. */
export function formatPercentage(
  value: string | number | null | undefined,
  locale: Locale,
): string {
  if (value == null) return "—";
  const amount = formatDecimal(String(value), locale);
  return amount === "—" ? amount : `${amount}${locale === "ar" ? "٪" : "%"}`;
}

/** A Gregorian business date has no time zone; UTC is only a rendering anchor. */
export function formatDateOnly(
  value: string | null | undefined,
  locale: Locale,
): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return "—";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return "—";
  return new Intl.DateTimeFormat(localeTags[locale], {
    calendar: "gregory",
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function formatWorkstationClock(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export function formatDateTime(
  value: Date,
  locale: Locale,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    dateStyle: "medium",
    timeStyle: "medium",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(value);
}

export function formatDate(
  value: Date,
  locale: Locale,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    dateStyle: "medium",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(value);
}

export function formatTime(
  value: Date,
  locale: Locale,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    timeStyle: "medium",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(value);
}

export function formatCurrencyFromFils(
  value: bigint | string | null | undefined,
  locale: Locale = "en",
): string {
  if (typeof value !== "bigint") {
    if (value == null || !/^-?(?:0|[1-9]\d*)$/u.test(value)) return "—";
    value = BigInt(value);
  }
  const sign = value < 0n ? "-" : "";
  const absoluteValue = value < 0n ? -value : value;
  const whole = absoluteValue / 1_000n;
  const fraction = String(absoluteValue % 1_000n).padStart(3, "0");
  const amount = `${sign}${groupIntegerDigits(whole.toString())}.${fraction}`;
  if (locale === "ar") {
    return `${localizeCurrencyAmount(amount)} د.ع`;
  }
  return `IQD ${amount}`;
}

function groupIntegerDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function localizeCurrencyAmount(amount: string): string {
  return amount
    .replace(/[0-9]/gu, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)] ?? digit)
    .replaceAll(",", "٬")
    .replaceAll(".", "٫");
}
