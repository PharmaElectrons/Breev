import { describe, expect, it } from "vitest";

import { daysUntil } from "./licence-dates";

describe("daysUntil", () => {
  it("counts whole UTC days and floors partial days", () => {
    expect(
      daysUntil("2027-01-01T00:00:00.000Z", "2027-01-15T00:00:00.000Z"),
    ).toBe(14);
    expect(
      daysUntil("2027-01-01T00:00:00.000Z", "2027-01-14T23:59:59.999Z"),
    ).toBe(13);
    expect(
      daysUntil("2027-01-01T00:00:00.000Z", "2027-01-02T01:00:00.000Z"),
    ).toBe(1);
  });

  it("answers zero on the day and a negative count once the instant has passed", () => {
    expect(
      daysUntil("2027-01-01T00:00:00.000Z", "2027-01-01T12:00:00.000Z"),
    ).toBe(0);
    expect(
      daysUntil("2027-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"),
    ).toBe(0);
    expect(
      daysUntil("2027-01-02T00:00:00.000Z", "2027-01-01T00:00:00.000Z"),
    ).toBe(-1);
  });

  it("refuses an unreadable instant instead of guessing", () => {
    expect(() => daysUntil("not a date", "2027-01-01T00:00:00.000Z")).toThrow();
  });
});
