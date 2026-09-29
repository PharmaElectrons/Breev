import type { Locale } from "./preferences";

/**
 * Presentation names for the item panel. Catalog unit names stay as stored;
 * Arabic only changes the words the pharmacist sees.
 */
const PACK_FORMS = {
  few: "علب",
  many: "علبة",
  one: "علبة",
  other: "علبة",
  two: "علبتان",
  zero: "علبة",
} as const;

const STRIP_FORMS = {
  few: "أشرطة",
  many: "شريط",
  one: "شريط",
  other: "شريط",
  two: "شريطان",
  zero: "شريط",
} as const;

const PACK_NAMES = new Set(["علبة", "علب", "علبتان", "علبتين"]);
const STRIP_NAMES = new Set(["شريط", "أشرطة", "اشرطة", "شريطان", "شريطين"]);

type CountForm = keyof typeof PACK_FORMS;

export function panelUnitLabel(
  name: string,
  count: bigint,
  locale: Locale,
): string {
  if (locale !== "ar") return name;
  const forms = formsFor(name);
  if (forms === null) return name;
  return forms[countForm(count)];
}

/** Replaces Pack and Strip inside a stored caption. Separators stay put. */
export function localizeUnitPhrase(
  text: string,
  count: bigint,
  locale: Locale,
): string {
  if (locale !== "ar") return text;
  return text.replace(/\b(?:pack|strip)\b/giu, (word) =>
    panelUnitLabel(word, count, locale),
  );
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

function formsFor(name: string): Readonly<Record<CountForm, string>> | null {
  const trimmed = name.trim();
  if (trimmed.toLowerCase() === "pack" || PACK_NAMES.has(trimmed)) {
    return PACK_FORMS;
  }
  if (trimmed.toLowerCase() === "strip" || STRIP_NAMES.has(trimmed)) {
    return STRIP_FORMS;
  }
  return null;
}

function countForm(count: bigint): CountForm {
  const value = count < 0n ? -count : count;
  if (value === 0n) return "zero";
  if (value === 1n) return "one";
  if (value === 2n) return "two";
  const mod100 = value % 100n;
  if (mod100 >= 3n && mod100 <= 10n) return "few";
  if (mod100 >= 11n && mod100 <= 99n) return "many";
  return "other";
}
