import { describe, expect, it } from "vitest";
import { pharmacyLocalDateTime, pharmacyLocalToInstant } from "./report-time";
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
});
