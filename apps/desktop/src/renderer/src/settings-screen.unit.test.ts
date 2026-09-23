import type { IdentityAuthenticatedState } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import * as identityStateModule from "./identity-state-provider";
import * as preferencesModule from "./preferences-provider";
import { SettingsRouteView } from "./settings-screen";

function buildMockAuthenticatedState(
  overrides: Partial<IdentityAuthenticatedState> = {},
): IdentityAuthenticatedState {
  return {
    allowedPermissions: [
      "identity.users.manage",
      "identity.roles.manage",
      "pharmacy.settings.manage",
      "licensing.manage",
    ],
    attendance: null,
    entitlement: {
      capabilities: ["local-sales", "reports"],
      licence: {
        features: ["additional-device-pos", "one-way-cloud-sync"],
        formatVersion: 1,
        founderOverrideGrants: [],
        graceEndsAt: "2029-01-14T23:59:59Z",
        issuedAt: "2026-01-01T00:00:00Z",
        keyId: "key-1",
        licenceId: "licence-1",
        mainDeviceId: "device-1",
        permittedDeviceCount: 1,
        pharmacyId: "pharmacy-1",
        plan: "professional",
        expiresAt: "2028-12-31T23:59:59Z",
      },
      status: "licensed",
    },
    pharmacy: {
      id: "pharmacy-1",
      name: "Breev Test Pharmacy",
    },
    session: {
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "session-1",
    },
    settings: {
      attendanceEnabled: true,
      revision: "1",
    },
    state: "authenticated",
    user: {
      displayName: "Test Manager",
      id: "user-1",
      revision: "1",
      role: {
        id: "role-1",
        key: "manager",
        kind: "built-in",
      },
      status: "active",
      username: "test.manager",
    },
    ...overrides,
  };
}

describe("SettingsRouteView", () => {
  it("renders horizontal tabs panel with Password, Roles, and Licence tabs in English", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState(),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings",
      }),
    );

    expect(markup).toContain('data-slot="tabs"');
    expect(markup).toContain('data-orientation="horizontal"');
    expect(markup).toContain("Change my password");
    expect(markup).toContain("Pharmacy settings");
    expect(markup).toContain("User management");
    expect(markup).toContain("Roles &amp; permissions");
    expect(markup).toContain("Licence &amp; devices");
    expect(markup).toContain("attendanceEnabled");
  });

  it("activates the password tab when hash points to password", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState(),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings/password",
      }),
    );

    expect(markup).toContain("change-password-submit");
    expect(markup).toContain("currentPassword");
    expect(markup).toContain("newPassword");
  });

  it("renders tabs in Arabic when locale is ar", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "rtl",
      locale: "ar",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState(),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings",
      }),
    );

    expect(markup).toContain("تغيير كلمة مروري");
    expect(markup).toContain("إعدادات الصيدلية");
    expect(markup).toContain("إدارة المستخدمين");
    expect(markup).toContain("الأدوار والصلاحيات");
    expect(markup).toContain("الترخيص والأجهزة");
  });

  it("hides Roles tab when user lacks identity.roles.manage permission", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState({
        allowedPermissions: ["identity.users.manage"],
      }),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings",
      }),
    );

    expect(markup).toContain("Change my password");
    expect(markup).toContain("User management");
    expect(markup).toContain("Licence &amp; devices");
    expect(markup).not.toContain("Roles &amp; permissions");
  });

  it("hides Users tab when user lacks identity.users.manage permission", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState({
        allowedPermissions: ["identity.roles.manage"],
      }),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings",
      }),
    );

    expect(markup).toContain("Change my password");
    expect(markup).toContain("Roles &amp; permissions");
    expect(markup).not.toContain("User management");
  });

  it("activates the users tab when hash points to users", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState(),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings/users",
      }),
    );

    expect(markup).toContain("add-user-button");
  });

  it("activates the licence tab when hash points to licence", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState(),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings/licence",
      }),
    );

    expect(markup).toContain("Licence status");
    expect(markup).toContain("professional");
  });

  it("activates the pharmacy tab when hash points to pharmacy", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState(),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings/pharmacy",
      }),
    );

    expect(markup).toContain("attendanceEnabled");
  });

  it("hides pharmacy tab when user lacks pharmacy.settings.manage permission", () => {
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      direction: "ltr",
      locale: "en",
      setLocale: vi.fn(),
      setTheme: vi.fn(),
      theme: "light",
    });

    vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
      refresh: vi.fn(async () => {}),
      setState: vi.fn(),
      state: buildMockAuthenticatedState({
        allowedPermissions: ["identity.users.manage"],
      }),
    });

    const markup = renderToStaticMarkup(
      createElement(SettingsRouteView, {
        baseUrl: "http://127.0.0.1:4000",
        hash: "#/settings",
      }),
    );

    expect(markup).not.toContain('value="pharmacy"');
  });
});
