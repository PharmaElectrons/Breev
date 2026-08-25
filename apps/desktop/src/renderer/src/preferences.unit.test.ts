import { describe, expect, it } from "vitest";

import {
  formatCurrencyFromFils,
  formatDateTime,
  formatNumber,
  readStoredLocale,
  readStoredTheme,
} from "./preferences";

describe("shell presentation preferences", () => {
  it("accepts only the two locale and theme values", () => {
    const values = new Map([
      ["breev.locale", "ar"],
      ["breev.theme", "dark"],
    ]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };

    expect(readStoredLocale(storage)).toBe("ar");
    expect(readStoredTheme(storage)).toBe("dark");

    values.set("breev.locale", "server-state");
    values.set("breev.theme", "system");
    expect(readStoredLocale(storage)).toBe("en");
    expect(readStoredTheme(storage)).toBe("light");
  });

  it("formats numbers with the selected locale", () => {
    expect(formatNumber(1_234_567, "en")).toBe("1,234,567");
    expect(formatNumber(1_234_567, "ar")).toBe("١٬٢٣٤٬٥٦٧");
  });

  it("formats exact integer fils as locale-aware IQD", () => {
    expect(formatCurrencyFromFils(1_234_567n, "en")).toMatch(
      /IQD\s*1,234\.567/u,
    );
    expect(formatCurrencyFromFils(1_234_567n, "ar")).toContain("١٬٢٣٤٫٥٦٧");
    expect(formatCurrencyFromFils(9_007_199_254_740_993_001n, "en")).toMatch(
      /9,007,199,254,740,993\.001/u,
    );
  });

  it("formats dates with the selected locale", () => {
    const value = new Date("2026-08-24T10:30:00Z");

    expect(formatDateTime(value, "en")).toMatch(/2026/u);
    expect(formatDateTime(value, "ar")).toMatch(/٢٠٢٦/u);
  });
});
