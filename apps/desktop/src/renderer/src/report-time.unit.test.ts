import { describe, expect, it } from "vitest";
import {
  pharmacyLocalDateTime,
  pharmacyLocalToInstant,
  reportTimeZoneLabel,
} from "./report-time";
describe("report pharmacy time controls", () => {
  it("round-trips fractional pharmacy time across a month boundary", () => {
    const instant = "2026-08-31T21:00:00.123Z";
    expect(pharmacyLocalDateTime(instant, "Asia/Baghdad")).toBe(
      "2026-09-01T00:00:00.123",
    );
    expect(
      pharmacyLocalToInstant("2026-09-01T00:00:00.123", "Asia/Baghdad"),
    ).toBe(instant);
  });
  it("rejects skipped and repeated daylight-saving times", () => {
    expect(() =>
      pharmacyLocalToInstant("2026-03-08T02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      pharmacyLocalToInstant("2026-11-01T01:30", "America/New_York"),
    ).toThrow();
  });
  it("localizes Arabic zone captions while preserving English IANA captions", () => {
    const instant = "2026-09-01T00:00:00.000Z";
    expect(reportTimeZoneLabel("Asia/Baghdad", "ar", instant)).toBe(
      "توقيت بغداد",
    );
    expect(reportTimeZoneLabel("Asia/Baghdad", "en", instant)).toBe(
      "Asia/Baghdad",
    );
    expect(reportTimeZoneLabel("UTC", "ar", instant)).toBe(
      "التوقيت العالمي المنسق",
    );
    expect(reportTimeZoneLabel("UTC", "en", instant)).toBe("UTC");
    for (const zone of ["America/New_York", "Europe/London", "Asia/Kolkata"]) {
      expect(reportTimeZoneLabel(zone, "ar", instant)).not.toMatch(/[a-z]/iu);
      expect(reportTimeZoneLabel(zone, "en", instant)).toBe(zone);
      expect(
        pharmacyLocalToInstant(pharmacyLocalDateTime(instant, zone), zone),
      ).toBe(instant);
    }
  });
});
