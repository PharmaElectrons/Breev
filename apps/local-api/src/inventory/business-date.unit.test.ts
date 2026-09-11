import { describe, expect, it } from "vitest";

import {
  addDays,
  businessDateOf,
  businessDatesBetween,
  compareDates,
  daysBetween,
  isValidTimeZone,
  monthBounds,
} from "./business-date.js";

describe("business dates", () => {
  it("uses the pharmacy timezone at the Baghdad midnight boundary", () => {
    expect(
      businessDateOf(new Date("2026-09-10T20:59:00.000Z"), "Asia/Baghdad"),
    ).toBe("2026-09-10");
    expect(
      businessDateOf(new Date("2026-09-10T21:00:00.000Z"), "Asia/Baghdad"),
    ).toBe("2026-09-11");
  });

  it("shows that UTC and Baghdad can disagree", () => {
    const instant = new Date("2026-09-10T21:30:00.000Z");
    expect(businessDateOf(instant, "UTC")).toBe("2026-09-10");
    expect(businessDateOf(instant, "Asia/Baghdad")).toBe("2026-09-11");
  });

  it("performs leap-day and month-rollover arithmetic on ISO dates", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(compareDates("2026-02-01", "2026-01-31")).toBe(1);
    expect(businessDatesBetween("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("validates zones and returns inclusive month bounds", () => {
    expect(isValidTimeZone("Asia/Baghdad")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(() => businessDateOf(new Date(), "Not/AZone")).toThrow(
      "Invalid IANA time zone",
    );
    expect(monthBounds("2026-02")).toEqual({
      end: "2026-02-28",
      start: "2026-02-01",
    });
  });

  it("does not turn business-date output into a timestamp", () => {
    const value = addDays("2026-09-10", 1);
    expect(typeof value).toBe("string");
    expect(value).toBe("2026-09-11");
  });
});
