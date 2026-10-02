import { describe, expect, it } from "vitest";
import { formatAdjustmentFils } from "./purchase-adjustment-money";

describe("Adjustment signed money presentation", () => {
  it.each([
    ["-320000", "en", "IQD -320.000"],
    ["-320000", "ar", "-٣٢٠٫٠٠٠ د.ع"],
    ["-9007199254740993", "en", "IQD -9,007,199,254,740.993"],
    ["320001", "en", "IQD 320.001"],
    ["0", "ar", "٠٫٠٠٠ د.ع"],
  ] as const)("formats %s in %s exactly", (value, locale, expected) => {
    expect(formatAdjustmentFils(value, locale)).toBe(expected);
  });
});
