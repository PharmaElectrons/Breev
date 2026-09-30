import { describe, expect, it } from "vitest";
import {
  reportFilterValue,
  formatReportAverageCost,
  canonicalReportFilters,
  ReportFilterError,
} from "./report-filter";

describe("exact displayed report filters", () => {
  it.each([
    ["IQD 1,234.567", "1234567"],
    ["-0.001", "-1"],
    ["+42", "42000"],
    ["١٬٢٣٤٫٥٦٧ د.ع", "1234567"],
    ["۱۲۳۴٫۵۶۷", "1234567"],
    ["-١٫٢", "-1200"],
    ["-0.000", "0"],
    ["999999999999999999999999.999", "999999999999999999999999999"],
  ])("converts %s IQD to %s fils", (display, wire) =>
    expect(reportFilterValue(display, "closingValueFils")).toBe(wire),
  );
  it.each(["١٬٢٣٤", "۱٬۲۳۴", "1,234", "1234"])(
    "converts localized quantity %s",
    (value) => expect(reportFilterValue(value, "closingQuantity")).toBe("1234"),
  );
  it("keeps all thirteen IQD places for WAC and formats both locales", () => {
    expect(
      reportFilterValue("IQD -1.0000000000001", "closingAverageCostScaled"),
    ).toBe("-10000000000001");
    expect(
      reportFilterValue("١٫٠٠٠٠٠٠٠٠٠٠٠٠١", "closingAverageCostScaled"),
    ).toBe("10000000000001");
    expect(formatReportAverageCost(-10000000000001n, "en")).toBe(
      "IQD -1.0000000000001",
    );
    expect(formatReportAverageCost(10000000000001n, "ar")).toBe(
      "١٫٠٠٠٠٠٠٠٠٠٠٠٠١ د.ع",
    );
  });
  it.each([
    "1,23",
    "1٬234.567",
    "1٫234.5",
    "1e3",
    "NaN",
    "1.",
    "",
    "--1",
    "1 000",
  ])("rejects malformed/ambiguous %s", (value) =>
    expect(() => reportFilterValue(value, "closingValueFils")).toThrow(
      ReportFilterError,
    ),
  );
  it("rejects excess precision without rounding and identifies the field", () => {
    expect(() => reportFilterValue("1.0001", "closingValueFils")).toThrow(
      "precision",
    );
    expect(() => reportFilterValue("1.0", "closingQuantity")).toThrow(
      "precision",
    );
    expect(() =>
      reportFilterValue("1.00000000000001", "closingAverageCostScaled"),
    ).toThrow("precision");
    try {
      canonicalReportFilters([
        { column: "item", operator: "contains", value: "A" },
        { column: "closingValueFils", operator: "eq", value: "1.0001" },
      ]);
    } catch (error) {
      expect(error).toMatchObject({ index: 1, rule: "precision" });
    }
  });
});
