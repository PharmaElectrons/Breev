import { describe, expect, it } from "vitest";
import { formatPatientDateTime } from "./patient-date-time";

describe("formatPatientDateTime", () => {
  it("uses the configured pharmacy zone instead of the workstation zone", () => {
    const formatted = formatPatientDateTime(
      "2026-01-01T00:30:00.000Z",
      "en",
      "America/Los_Angeles",
    );

    expect(formatted).not.toBeNull();
    expect(formatted).toContain("Dec 31, 2025");
    expect(formatted).toContain("4:30");
    expect(formatted).toContain("PST");
  });

  it("does not fall back to the workstation zone for invalid zone or instant", () => {
    expect(
      formatPatientDateTime("2026-01-01T00:30:00.000Z", "en", "not-a-zone"),
    ).toBeNull();
    expect(formatPatientDateTime("not-an-instant", "ar", "Asia/Baghdad")).toBe(
      null,
    );
    expect(formatPatientDateTime("2026-01-01T00:30:00.000Z", "en", " ")).toBe(
      null,
    );
  });
});
