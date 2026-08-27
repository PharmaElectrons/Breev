import { describe, expect, it } from "vitest";

import { observeTrustedTime } from "./trusted-time.js";

describe("observeTrustedTime", () => {
  it("persists the first observation", () => {
    expect(
      observeTrustedTime({ now: date("2026-01-01T00:00:00.000Z") }),
    ).toEqual({
      rollbackDetected: false,
      trustedNow: date("2026-01-01T00:00:00.000Z"),
      nextHighWater: date("2026-01-01T00:00:00.000Z"),
      persistLowerBound: date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("advances in memory without excessive writes inside the persistence cadence", () => {
    expect(
      observeTrustedTime({
        now: date("2026-01-01T00:30:00.000Z"),
        inMemoryHighWater: date("2026-01-01T00:00:00.000Z"),
        persistedLowerBound: date("2026-01-01T00:00:00.000Z"),
      }),
    ).toEqual({
      rollbackDetected: false,
      trustedNow: date("2026-01-01T00:30:00.000Z"),
      nextHighWater: date("2026-01-01T00:30:00.000Z"),
      persistLowerBound: undefined,
    });
  });

  it("persists after one hour", () => {
    expect(
      observeTrustedTime({
        now: date("2026-01-01T01:00:00.000Z"),
        inMemoryHighWater: date("2026-01-01T00:30:00.000Z"),
        persistedLowerBound: date("2026-01-01T00:00:00.000Z"),
      }).persistLowerBound,
    ).toEqual(date("2026-01-01T01:00:00.000Z"));
  });

  it("detects rollback without moving the high-water mark backwards", () => {
    expect(
      observeTrustedTime({
        now: date("2025-12-31T23:59:59.999Z"),
        inMemoryHighWater: date("2026-01-01T00:30:00.000Z"),
        persistedLowerBound: date("2026-01-01T00:00:00.000Z"),
      }),
    ).toEqual({
      rollbackDetected: true,
      trustedNow: date("2026-01-01T00:30:00.000Z"),
      nextHighWater: date("2026-01-01T00:30:00.000Z"),
      persistLowerBound: undefined,
    });
  });
});

function date(value: string): Date {
  return new Date(value);
}
