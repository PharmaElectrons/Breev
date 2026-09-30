/** Date controls use the pharmacy zone, independently of the workstation zone. */
export function pharmacyLocalDateTime(
  instant: string,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${part("fractionalSecond")}`;
}
export function pharmacyLocalToInstant(
  value: string,
  timeZone: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/u.test(value))
    throw new RangeError("Invalid local date-time");
  const target = new Date(`${value}Z`);
  if (Number.isNaN(target.getTime()))
    throw new RangeError("Invalid local date-time");
  const normalized = target.toISOString().slice(0, -1);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = new Date(target.getTime() + hours * 3600000);
    offsets.add(
      Date.parse(`${pharmacyLocalDateTime(sample.toISOString(), timeZone)}Z`) -
        sample.getTime(),
    );
  }
  const candidates = [...offsets]
    .map((offset) => new Date(target.getTime() - offset))
    .filter(
      (candidate) =>
        pharmacyLocalDateTime(candidate.toISOString(), timeZone) === normalized,
    );
  if (candidates.length !== 1)
    throw new RangeError("Ambiguous or skipped local date-time");
  return candidates[0]!.toISOString();
}
export function reportTimestamp(
  value: string,
  locale: "ar" | "en",
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-IQ", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}
