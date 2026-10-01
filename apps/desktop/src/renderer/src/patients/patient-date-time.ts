import type { Locale } from "../preferences";

/** Formats a persisted UTC instant only when the configured pharmacy zone is valid. */
export function formatPatientDateTime(
  instant: string,
  locale: Locale,
  businessTimeZone: string,
): string | null {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime()) || businessTimeZone.trim() === "") {
    return null;
  }

  try {
    const localeTag = locale === "ar" ? "ar-IQ" : "en-IQ";
    return new Intl.DateTimeFormat(localeTag, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: businessTimeZone,
      timeZoneName: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return null;
  }
}
