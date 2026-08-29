import { describe, expect, it } from "vitest";

import {
  fingerprintGroups,
  formatCountdown,
  remainingSeconds,
} from "./pairing-format";

describe("pairing fingerprint digits", () => {
  it("splits twelve digits into four groups of three", () => {
    expect(fingerprintGroups("012345678901")).toEqual([
      "012",
      "345",
      "678",
      "901",
    ]);
  });

  it("keeps leading zeroes that the modulo derivation can produce", () => {
    expect(fingerprintGroups("000000000042")).toEqual([
      "000",
      "000",
      "000",
      "042",
    ]);
  });

  it("refuses anything that is not exactly twelve ASCII digits", () => {
    expect(fingerprintGroups("")).toBeNull();
    expect(fingerprintGroups("01234567890")).toBeNull();
    expect(fingerprintGroups("0123456789012")).toBeNull();
    expect(fingerprintGroups("01234567890a")).toBeNull();
    expect(fingerprintGroups("012 345 678 901")).toBeNull();
    expect(fingerprintGroups("٠١٢٣٤٥٦٧٨٩٠١")).toBeNull();
  });
});

describe("pairing countdown", () => {
  const now = new Date("2026-08-29T10:00:00.000Z");

  it("counts whole seconds down to a future expiry", () => {
    expect(remainingSeconds("2026-08-29T10:05:00.000Z", now)).toBe(300);
  });

  it("clamps a passed expiry to zero", () => {
    expect(remainingSeconds("2026-08-29T09:59:59.000Z", now)).toBe(0);
  });

  it("treats an unparseable expiry as elapsed", () => {
    expect(remainingSeconds("not-a-date", now)).toBe(0);
  });

  it("formats minutes and zero-padded seconds", () => {
    expect(formatCountdown(300)).toBe("5:00");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00");
  });
});
