/**
 * Pharmacy business dates are civil dates, not elapsed milliseconds. This
 * module keeps timezone conversion at the edge and performs every later date
 * operation on validated ISO strings.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const SUPPORTED_TIME_ZONES = new Set([
  "UTC",
  ...Intl.supportedValuesOf("timeZone"),
]);

export function isValidTimeZone(zone: string): boolean {
  return SUPPORTED_TIME_ZONES.has(zone);
}

export function businessDateOf(instant: Date, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("The instant is invalid");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const values = new Map(
    parts
      .filter(
        (
          part,
        ): part is Intl.DateTimeFormatPart & {
          type: "year" | "month" | "day";
        } =>
          part.type === "year" || part.type === "month" || part.type === "day",
      )
      .map((part) => [part.type, part.value]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("The business date formatter returned incomplete parts");
  }
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function compareDates(left: string, right: string): -1 | 0 | 1 {
  validateIsoDate(left);
  validateIsoDate(right);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addDays(isoDate: string, amount: number): string {
  validateIsoDate(isoDate);
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("The date offset must be a safe integer");
  }
  const [year, month, day] = parseDate(isoDate);
  const shifted = civilFromDays(daysFromCivil(year, month, day) + amount);
  const result = `${String(shifted.year).padStart(4, "0")}-${String(
    shifted.month,
  ).padStart(2, "0")}-${String(shifted.day).padStart(2, "0")}`;
  validateIsoDate(result);
  return result;
}

export function daysBetween(from: string, to: string): number {
  validateIsoDate(from);
  validateIsoDate(to);
  const [fromYear, fromMonth, fromDay] = parseDate(from);
  const [toYear, toMonth, toDay] = parseDate(to);
  return (
    daysFromCivil(toYear, toMonth, toDay) -
    daysFromCivil(fromYear, fromMonth, fromDay)
  );
}

export function businessDatesBetween(
  afterExclusive: string | null,
  throughInclusive: string,
): string[] {
  validateIsoDate(throughInclusive);
  if (afterExclusive !== null) validateIsoDate(afterExclusive);
  if (
    afterExclusive !== null &&
    compareDates(afterExclusive, throughInclusive) >= 0
  ) {
    return [];
  }
  const dates: string[] = [];
  let next =
    afterExclusive === null ? throughInclusive : addDays(afterExclusive, 1);
  while (compareDates(next, throughInclusive) <= 0) {
    dates.push(next);
    next = addDays(next, 1);
  }
  return dates;
}

export function monthBounds(month: string): {
  readonly end: string;
  readonly start: string;
} {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)) {
    throw new RangeError(`Invalid business month: ${month}`);
  }
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = daysInMonth(year, monthNumber);
  return {
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
    start: `${month}-01`,
  };
}

function validateIsoDate(value: string): void {
  const [year, month, day] = parseDate(value);
  if (year < 1 || year > 9999 || month < 1 || month > 12) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }
}

function parseDate(value: string): [number, number, number] {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) throw new RangeError(`Invalid ISO date: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// Howard Hinnant's proleptic-Gregorian civil-date conversion, expressed only
// in integer calendar arithmetic so Date's timezone and millisecond rules do
// not leak into business-date calculations.
function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const monthOfYear = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthOfYear + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(dayCount: number): {
  readonly day: number;
  readonly month: number;
  readonly year: number;
} {
  const shifted = dayCount + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthOfYear = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthOfYear + 2) / 5) + 1;
  const month = monthOfYear + (monthOfYear < 10 ? 3 : -9);
  return { day, month, year: year + (month <= 2 ? 1 : 0) };
}
