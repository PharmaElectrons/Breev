import { describe, expect, it } from "vitest";

import {
  PERMISSION_NAMES,
  STEP_UP_ACTIONS,
  evaluateStepUpApproval,
  hasPermission,
  type StepUpApprovalInput,
} from "./authorization.js";

describe("identity authorization", () => {
  it("denies every role until an explicit grant exists", () => {
    for (const role of [
      "owner",
      "manager",
      "pharmacist",
      "sales_employee",
      "purchasing_employee",
      "inventory_employee",
      "accountant",
      "support",
    ]) {
      expect(
        hasPermission([], "sales.return.post"),
        `${role} must not carry compile-time authority`,
      ).toBe(false);
    }
  });

  it("allows only the exact named permission that was granted", () => {
    for (const permission of PERMISSION_NAMES) {
      expect(hasPermission([], permission), permission).toBe(false);
      expect(hasPermission([permission], permission), permission).toBe(true);
      expect(
        hasPermission(
          PERMISSION_NAMES.filter((candidate) => candidate !== permission),
          permission,
        ),
        permission,
      ).toBe(false);
    }
  });

  it("preserves the repository permission names in one registry", () => {
    expect(PERMISSION_NAMES).toEqual([
      "attendance.record",
      "catalog.item.manage",
      "devices.pair",
      "draft.price.override",
      "identity.roles.manage",
      "identity.users.manage",
      "licensing.manage",
      "pharmacy.settings.manage",
      "pricing.below_cost",
      "sales.invoice.reverse",
      "sales.return.post",
      "sync.conflict.resolve",
    ]);
  });
});

describe("Step-Up Authorization", () => {
  const approvedInput: StepUpApprovalInput = {
    challenge: {
      action: "identity.user.create",
      actorId: "01991f4d-e800-7000-8000-000000000001",
      authRevision: 4n,
      deviceId: "01991f4d-e800-7000-8000-000000000002",
      expiresAt: new Date("2026-08-26T10:05:00.000Z"),
      pharmacyIdentityRevision: 9n,
      requiredPermission: "identity.users.manage",
      resolved: false,
      roleRevision: 3n,
      sessionId: "01991f4d-e800-7000-8000-000000000003",
      subjectRevision: 9n,
    },
    context: {
      actorId: "01991f4d-e800-7000-8000-000000000001",
      authRevision: 4n,
      deviceId: "01991f4d-e800-7000-8000-000000000002",
      permissions: ["identity.users.manage"],
      pharmacyIdentityRevision: 9n,
      roleRevision: 3n,
      sessionId: "01991f4d-e800-7000-8000-000000000003",
    },
    currentSubjectRevision: 9n,
    now: new Date("2026-08-26T10:04:59.999Z"),
  };

  it("approves a fresh challenge for the same authorized execution context", () => {
    expect(evaluateStepUpApproval(approvedInput)).toBe("approved");
  });

  it("maps administrator password reset to user management", () => {
    expect(STEP_UP_ACTIONS["identity.user.password.reset"]).toBe(
      "identity.users.manage",
    );
  });

  it("expires at the bounded lifetime instead of extending it", () => {
    expect(
      evaluateStepUpApproval({
        ...approvedInput,
        now: approvedInput.challenge.expiresAt,
      }),
    ).toBe("step-up-expired");
  });

  it("rejects a challenge after authority or subject state changes", () => {
    expect(
      evaluateStepUpApproval({
        ...approvedInput,
        context: {
          ...approvedInput.context,
          pharmacyIdentityRevision: 10n,
        },
      }),
    ).toBe("step-up-stale");
    expect(
      evaluateStepUpApproval({
        ...approvedInput,
        currentSubjectRevision: 10n,
      }),
    ).toBe("step-up-stale");
  });

  it("rejects another actor, device, or session", () => {
    for (const context of [
      { ...approvedInput.context, actorId: crypto.randomUUID() },
      { ...approvedInput.context, deviceId: crypto.randomUUID() },
      { ...approvedInput.context, sessionId: crypto.randomUUID() },
    ]) {
      expect(evaluateStepUpApproval({ ...approvedInput, context })).toBe(
        "step-up-context-mismatch",
      );
    }
  });

  it("cannot manufacture a missing permission and cannot be reused", () => {
    expect(
      evaluateStepUpApproval({
        ...approvedInput,
        context: { ...approvedInput.context, permissions: [] },
      }),
    ).toBe("step-up-missing-permission");
    expect(
      evaluateStepUpApproval({
        ...approvedInput,
        challenge: { ...approvedInput.challenge, resolved: true },
      }),
    ).toBe("step-up-reused");
  });
});
