import { describe, expect, it } from "vitest";
import { formatAdjustmentFils } from "./purchase-adjustment-money";

describe("Adjustment signed money presentation", () => {
  it.each([
    ["-320000", "en", "−320 IQD"],
    ["-320000", "ar", "−٣٢٠ د.ع"],
    ["-9007199254740993", "en", "−9,007,199,254,740.993 IQD"],
    ["320001", "en", "320.001 IQD"],
    ["0", "ar", "٠ د.ع"],
  ] as const)("formats %s in %s exactly", (value, locale, expected) => {
    expect(formatAdjustmentFils(value, locale)).toBe(expected);
  });
});
