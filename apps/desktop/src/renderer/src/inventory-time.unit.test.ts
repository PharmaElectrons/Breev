import { describe, expect, it, vi } from "vitest";
import { formatInventoryTimestamp } from "./inventory-time";
import {
  formatDateOnly,
  formatDecimal,
  formatPercentage,
  formatCurrencyFromFils,
  formatWorkstationClock,
} from "./preferences";
import { generatedReferenceDisplay } from "../../shared/generated-reference-display";
describe("exact presentation and business dates", () => {
  it("keeps fractions, signs, and huge integer precision", () => {
    expect(formatDecimal("-9007199254740993001.1234567890123", "ar")).toBe(
      "-٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٬٩٩٣٬٠٠١٫١٢٣٤٥٦٧٨٩٠١٢٣",
    );
    expect(formatPercentage("12.500", "ar")).toBe("١٢٫٥٠٠٪");
    expect(formatPercentage("12.5", "en")).toBe("12.5%");
    expect(formatCurrencyFromFils("4570367034", "en")).toBe(
      "IQD 4,570,367.034",
    );
    expect(formatCurrencyFromFils("800000", "en")).toBe("IQD 800.000");
    expect(formatCurrencyFromFils("1234567", "ar")).toBe("١٬٢٣٤٫٥٦٧ د.ع");
    expect(formatCurrencyFromFils("-1234567", "en")).toBe("IQD -1,234.567");
    expect(formatCurrencyFromFils(null, "ar")).toBe("—");
  });
  it("anchors Gregorian date-only display across workstation zones", () => {
    try {
      const expected = formatDateOnly("2028-02-29", "en");
      for (const zone of [
        "Asia/Baghdad",
        "America/Los_Angeles",
        "Asia/Tokyo",
      ]) {
        vi.stubEnv("TZ", zone);
        expect(formatDateOnly("2028-02-29", "en")).toBe(expected);
        expect(formatDateOnly("2028-02-29", "ar")).toContain("٢٩");
      }
      expect(formatDateOnly("2027-02-29", "en")).toBe("—");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("uses explicit zones with seconds and fails locally without a known zone", () => {
    expect(
      formatInventoryTimestamp("2026-10-01T22:05:06Z", "en", "Asia/Baghdad"),
    ).toMatch(/Oct 2, 2026.*1:05:06/);
    expect(
      formatInventoryTimestamp(
        "2026-10-01T22:05:06Z",
        "en",
        "America/New_York",
      ),
    ).toMatch(/Oct 1, 2026.*6:05:06/);
    expect(formatInventoryTimestamp("2026-10-01T22:05:06Z", "ar", null)).toBe(
      "توقيت الصيدلية غير متاح",
    );
    expect(formatInventoryTimestamp("bad", "en", "invalid/zone")).toBe(
      "Pharmacy time unavailable",
    );
    expect(formatWorkstationClock(new Date(), "ar")).toMatch(
      /^[٠-٩]{2}:[٠-٩]{2}$/u,
    );
  });
  it("localizes only generated references and preserves IDs and custom evidence", () => {
    const display = (label: string, type = "count-session") =>
      generatedReferenceDisplay(
        { documentType: type, label },
        "ar",
        (n) => n.toString().replace("1", "١"),
        () => "توقيت معروف",
      );
    expect(display("C1/2026 · line 1")).toContain("C1/2026\u2069 · السطر ١");
    expect(
      display("Count session started 2026-10-01 22:05:06+00 · line 1"),
    ).toContain("بدأت جلسة الجرد توقيت معروف · السطر ١");
    expect(
      display("Count session 01990abc-1234-7123-8123-123456789abc · line 1"),
    ).toContain("01990abc-1234-7123-8123-123456789abc");
    expect(display("custom · line 1")).toBe("custom · line 1");
    expect(display("C1/2026 · line 1", "purchase")).toBe("C1/2026 · line 1");
  });
});
