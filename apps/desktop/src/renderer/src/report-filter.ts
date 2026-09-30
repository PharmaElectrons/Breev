import {
  normalizeIndicDigits,
  type InventoryReportColumn,
  type InventoryReportQuery,
} from "@breev/contracts/local-rest";

export class ReportFilterError extends Error {
  public constructor(
    public readonly index: number,
    public readonly rule: "number" | "precision",
  ) {
    super(rule);
  }
}
/** Display input stays editable. Only this exact adapter produces ASCII wire integers. */
export function reportFilterValue(
  value: string,
  column: InventoryReportColumn,
): string {
  if (!/Quantity|Fils|Scaled|Per30Days/u.test(column)) return value;
  const places = column.endsWith("Scaled")
    ? 13
    : column.endsWith("Fils")
      ? 3
      : 0;
  let text = normalizeIndicDigits(value)
    .replace(/[\u061c\u200e\u200f\u2066-\u2069]/gu, "")
    .trim();
  if (places > 0)
    text = text
      .replace(/^IQD\s*/iu, "")
      .replace(/\s*(?:IQD|د\.ع)$/iu, "")
      .trim();
  text = text.replace(/^−/u, "-");
  const arabic = /[٫٬]/u.test(text);
  if (arabic && /[.,]/u.test(text)) throw new ReportFilterError(-1, "number");
  const decimal = arabic ? "٫" : ".";
  const group = arabic ? "٬" : ",";
  const sign = text.startsWith("-") ? -1n : 1n;
  text = text.replace(/^[+-]/u, "");
  const parts = text.split(decimal);
  if (parts.length > 2) throw new ReportFilterError(-1, "number");
  const [whole = "", fraction = ""] = parts;
  if (!/^\d+$/u.test(fraction) && parts.length === 2)
    throw new ReportFilterError(-1, "number");
  const grouped = whole.split(group);
  if (
    !grouped.every(
      (part, index) =>
        /^\d+$/u.test(part) &&
        (grouped.length === 1 ||
          (index === 0
            ? part.length >= 1 && part.length <= 3
            : part.length === 3)),
    )
  )
    throw new ReportFilterError(-1, "number");
  if (fraction.length > places) throw new ReportFilterError(-1, "precision");
  const result = (
    sign *
    (BigInt(grouped.join("")) * 10n ** BigInt(places) +
      BigInt(fraction.padEnd(places, "0") || "0"))
  ).toString();
  if (result.length > 80) throw new ReportFilterError(-1, "number");
  return result;
}
export function canonicalReportFilters(
  filters: InventoryReportQuery["filters"],
): InventoryReportQuery["filters"] {
  return filters.map((filter, index) => {
    try {
      return {
        ...filter,
        value: reportFilterValue(filter.value, filter.column),
      };
    } catch (error) {
      if (error instanceof ReportFilterError)
        throw new ReportFilterError(index, error.rule);
      throw error;
    }
  });
}
/** Exact scaled IQD formatting; grouping/digits/separators agree with other cells. */
export function formatReportAverageCost(
  value: bigint,
  locale: "ar" | "en",
): string {
  const scale = 10n ** 13n;
  const absolute = value < 0n ? -value : value;
  const whole = new Intl.NumberFormat(
    locale === "ar" ? "ar-IQ" : "en-IQ",
  ).format(absolute / scale);
  let fraction = (absolute % scale)
    .toString()
    .padStart(13, "0")
    .replace(/0+$/u, "");
  if (locale === "ar")
    fraction = fraction.replace(
      /[0-9]/gu,
      (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!,
    );
  const amount = `${value < 0n ? "-" : ""}${whole}${fraction ? `${locale === "ar" ? "٫" : "."}${fraction}` : ""}`;
  return locale === "ar" ? `${amount} د.ع` : `IQD ${amount}`;
}
