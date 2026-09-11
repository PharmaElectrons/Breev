import { describe, expect, it } from "vitest";

import {
  evaluateBatchEligibility,
  HARD_BLOCK_STATUSES,
  isAllocatable,
} from "./inventory-eligibility.js";

describe("batch eligibility", () => {
  const base = {
    businessDate: "2026-09-10",
    effectiveExpiryDate: "2026-09-20",
    nearExpiryDays: 10,
  };

  it("applies regulatory precedence before date warnings", () => {
    expect(
      evaluateBatchEligibility({ ...base, latestStatusKind: "recalled" }),
    ).toBe("recalled");
    expect(
      evaluateBatchEligibility({ ...base, latestStatusKind: "quarantined" }),
    ).toBe("quarantined");
    expect(
      evaluateBatchEligibility({ ...base, latestStatusKind: "postponed" }),
    ).toBe("postponed-blocked");
    expect(
      evaluateBatchEligibility({
        ...base,
        effectiveExpiryDate: "2026-09-01",
        latestStatusKind: null,
      }),
    ).toBe("expired");
    expect(evaluateBatchEligibility({ ...base, latestStatusKind: null })).toBe(
      "near-expiry",
    );
  });

  it("keeps null expiry eligible and only allows the two sellable states", () => {
    expect(
      evaluateBatchEligibility({
        ...base,
        effectiveExpiryDate: null,
        latestStatusKind: null,
      }),
    ).toBe("eligible");
    expect(isAllocatable("eligible")).toBe(true);
    expect(isAllocatable("near-expiry")).toBe(true);
    for (const status of HARD_BLOCK_STATUSES) {
      expect(isAllocatable(status)).toBe(false);
    }
  });

  it("keeps the allocation boundary pure and narrow", () => {
    expect(evaluateBatchEligibility).toHaveLength(1);
    expect(evaluateBatchEligibility.toString()).toMatch(
      /function evaluateBatchEligibility\(input\)/u,
    );
  });
});
