import type { IdentityAuthenticatedState } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { identityMessages } from "./identity-messages";
import { UserManagementPanel } from "./user-management-panel";

function buildMockAuthenticatedState(
  overrides: Partial<IdentityAuthenticatedState> = {},
): IdentityAuthenticatedState {
  return {
    allowedPermissions: ["identity.users.manage"],
    attendance: null,
    entitlement: {
      capabilities: ["local-sales"],
      licence: null,
      status: "free-core",
    },
    pharmacy: {
      id: "pharmacy-1",
      name: "Breev Test Pharmacy",
    },
    session: {
      expiresAt: "2026-01-02T00:00:00Z",
      id: "session-1",
    },
    settings: {
      attendanceEnabled: false,
      revision: "1",
    },
    state: "authenticated",
    user: {
      displayName: "Owner User",
      id: "user-1",
      revision: "1",
      role: {
        id: "role-1",
        key: "owner",
        kind: "built-in",
      },
      status: "active",
      username: "owner",
    },
    ...overrides,
  };
}

describe("UserManagementPanel", () => {
  it("renders user management heading and add user button in English", () => {
    const copy = identityMessages.en;
    const markup = renderToStaticMarkup(
      createElement(UserManagementPanel, {
        baseUrl: "http://127.0.0.1:4000",
        beginStepUp: vi.fn(async () => {}),
        busy: false,
        copy,
        run: vi.fn(async () => undefined),
        state: buildMockAuthenticatedState(),
      }),
    );

    expect(markup).toContain("User management");
    expect(markup).toContain("Add user");
    expect(markup).toContain('id="add-user-button"');
  });

  it("renders user management heading and add user button in Arabic", () => {
    const copy = identityMessages.ar;
    const markup = renderToStaticMarkup(
      createElement(UserManagementPanel, {
        baseUrl: "http://127.0.0.1:4000",
        beginStepUp: vi.fn(async () => {}),
        busy: false,
        copy,
        run: vi.fn(async () => undefined),
        state: buildMockAuthenticatedState(),
      }),
    );

    expect(markup).toContain("إدارة المستخدمين");
    expect(markup).toContain("إضافة مستخدم");
    expect(markup).toContain('id="add-user-button"');
  });
});
