import { describe, expect, it } from "vitest";
import { ageFromDob } from "./patient-form";

describe("ageFromDob", () => {
  it("returns null for empty or null dates", () => {
    expect(ageFromDob(null)).toBeNull();
    expect(ageFromDob(undefined)).toBeNull();
    expect(ageFromDob("")).toBeNull();
    expect(ageFromDob("invalid-date")).toBeNull();
  });

  it("calculates age correctly from valid birth date", () => {
    const today = new Date();
    const thirtyYearsAgo = new Date(
      today.getFullYear() - 30,
      today.getMonth(),
      today.getDate() - 1,
    );
    const dobString = thirtyYearsAgo.toISOString().slice(0, 10);
    expect(ageFromDob(dobString)).toBe(30);
  });

  it("handles birthday not yet occurred this year", () => {
    const today = new Date();
    const almostThirtyYearsAgo = new Date(
      today.getFullYear() - 30,
      today.getMonth(),
      today.getDate() + 5,
    );
    const dobString = almostThirtyYearsAgo.toISOString().slice(0, 10);
    expect(ageFromDob(dobString)).toBe(29);
  });
});
