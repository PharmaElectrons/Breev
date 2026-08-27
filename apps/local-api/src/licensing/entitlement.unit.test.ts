import { describe, expect, it } from "vitest";

import {
  authorizeCapability,
  deriveEntitlement,
  FREE_CORE_CAPABILITIES,
} from "./entitlement.js";

describe("deriveEntitlement", () => {
  it("keeps the explicit Free Core available when no licence exists", () => {
    expect(deriveEntitlement({ licence: { status: "missing" }, clockRollbackDetected: false })).toEqual({
      status: "free-core",
      capabilities: FREE_CORE_CAPABILITIES,
      licence: null,
    });
  });

  it("unions signed paid and founder grants with Free Core", () => {
    const entitlement = deriveEntitlement({
      licence: {
        status: "valid",
        claims: {
          formatVersion: 1,
          keyId: "test",
          licenceId: "019b0000-0000-7000-8000-000000000103",
          pharmacyId: "019b0000-0000-7000-8000-000000000101",
          mainDeviceId: "019b0000-0000-7000-8000-000000000102",
          plan: "professional",
          features: ["one-way-cloud-sync"],
          founderOverrideGrants: ["purchase-invoice-ocr"],
          permittedDeviceCount: 3,
          issuedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2028-01-01T00:00:00.000Z",
          graceEndsAt: "2028-01-08T00:00:00.000Z",
        },
      },
      clockRollbackDetected: false,
    });

    expect(entitlement.status).toBe("licensed");
    expect(entitlement.capabilities).toEqual([
      ...FREE_CORE_CAPABILITIES,
      "one-way-cloud-sync",
      "purchase-invoice-ocr",
    ]);
  });

  it("removes only paid capabilities after clock rollback", () => {
    const entitlement = deriveEntitlement({
      licence: { status: "invalid", reason: "expired" },
      clockRollbackDetected: true,
    });
    expect(entitlement).toEqual({
      status: "clock-rollback",
      capabilities: FREE_CORE_CAPABILITIES,
      licence: null,
    });
  });
});

describe("authorizeCapability", () => {
  it.each([
    [false, false, "permission-denied"],
    [false, true, "permission-denied"],
    [true, false, "entitlement-denied"],
    [true, true, "allowed"],
  ] as const)(
    "keeps permission=%s and entitlement=%s orthogonal",
    (hasPermission, hasEntitlement, outcome) => {
      expect(authorizeCapability({ hasPermission, hasEntitlement })).toBe(outcome);
    },
  );
});
