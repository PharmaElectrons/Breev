import {
  type IdentityAuthenticatedState,
  type IdentityState,
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  type LocalHealthSuccess,
} from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeScreen } from "./home-screen";
import * as identityStateModule from "./identity-state-provider";
import * as preferencesModule from "./preferences-provider";
import type { StartupConnection } from "./use-startup-connection";

const DEFAULT_HANDSHAKE: LocalHealthSuccess = {
  apiVersion: LOCAL_API_VERSION,
  database: "available",
  schemaVersion: LOCAL_SCHEMA_VERSION,
  status: "healthy",
};

function buildMockStartup(
  overrides: Partial<StartupConnection> = {},
): StartupConnection {
  return {
    cancelTerminalPairing: vi.fn(async () => {}),
    checkNow: vi.fn(),
    deviceProof: "idle",
    handshake: DEFAULT_HANDSHAKE,
    lastCheckedAt: new Date("2026-09-23T12:00:00Z"),
    localApiOrigin: "http://127.0.0.1:4000",
    runDeviceProof: vi.fn(async () => {}),
    startupConfig: null,
    state: "ready",
    submitManualEndpoint: vi.fn(async () => {}),
    submitPairingInvitation: vi.fn(async () => {}),
    terminalPairing: null,
    ...overrides,
  };
}

function buildMockAuthenticatedState(
  overrides: Partial<IdentityAuthenticatedState> = {},
): IdentityAuthenticatedState {
  return {
    allowedPermissions: [
      "sales.drafts.manage",
      "purchases.drafts.manage",
      "inventory.review",
      "catalog.item.manage",
      "inventory.reorder.manage",
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
      name: "Breev Pharmacy",
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
      displayName: "Test Pharmacist",
      id: "user-1",
      revision: "1",
      role: {
        id: "role-1",
        key: "pharmacist",
        kind: "built-in",
      },
      status: "active",
      username: "test.pharmacist",
    },
    ...overrides,
  };
}

function mockPreferences(locale: "en" | "ar" = "en"): void {
  vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
    direction: locale === "ar" ? "rtl" : "ltr",
    locale,
    setLocale: vi.fn(),
    setTheme: vi.fn(),
    theme: "light",
  });
}

function mockIdentity(state: IdentityState | null): void {
  vi.spyOn(identityStateModule, "useIdentityState").mockReturnValue({
    refresh: vi.fn(async () => {}),
    setState: vi.fn(),
    state,
  });
}

function renderHomeScreen(
  startup: StartupConnection = buildMockStartup(),
): string {
  return renderToStaticMarkup(createElement(HomeScreen, { startup }));
}

describe("HomeScreen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication and state gating", () => {
    it("returns null when identity state is null", () => {
      mockPreferences("en");
      mockIdentity(null);
      const markup = renderHomeScreen();
      expect(markup).toBe("");
    });

    it("returns null when user is unauthenticated", () => {
      mockPreferences("en");
      mockIdentity({ state: "unauthenticated" });
      const markup = renderHomeScreen();
      expect(markup).toBe("");
    });
  });

  describe("Welcome greeting and role display", () => {
    it("renders welcome greeting with pharmacy name and built-in role display name in English", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          pharmacy: { id: "ph-1", name: "Al-Shifa Pharmacy" },
          user: {
            displayName: "Sarah Smith",
            id: "u-1",
            revision: "1",
            role: { id: "r-1", key: "pharmacist", kind: "built-in" },
            status: "active",
            username: "sarah",
          },
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain("Welcome to");
      expect(markup).toContain("Al-Shifa Pharmacy");
      expect(markup).toContain("Logged in as sarah with Pharmacist role.");
    });

    it("renders welcome greeting with pharmacy name and built-in role display name in Arabic", () => {
      mockPreferences("ar");
      mockIdentity(
        buildMockAuthenticatedState({
          pharmacy: { id: "ph-1", name: "صيدلية الشفاء" },
          user: {
            displayName: "أحمد علي",
            id: "u-1",
            revision: "1",
            role: { id: "r-1", key: "owner", kind: "built-in" },
            status: "active",
            username: "ahmed",
          },
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain("مرحباً بك في");
      expect(markup).toContain("صيدلية الشفاء");
      expect(markup).toContain("أنت متصل بحساب ahmed بصلاحية المالك.");
    });

    it("renders custom role name verbatim for custom roles", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          pharmacy: { id: "ph-1", name: "Al-Shifa Pharmacy" },
          user: {
            displayName: "John Doe",
            id: "u-2",
            revision: "1",
            role: {
              id: "cr-1",
              kind: "custom",
              name: "Lead Dispensary Chemist",
            },
            status: "active",
            username: "john.chemist",
          },
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain(
        "Logged in as john.chemist with Lead Dispensary Chemist role.",
      );
    });
  });

  describe("Startup system ready badge", () => {
    it("renders system ready badge when startup.state === 'ready' in English", () => {
      mockPreferences("en");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen(buildMockStartup({ state: "ready" }));
      expect(markup).toContain("System Ready &amp; Operational");
      expect(markup).toContain("home-status-dot");
    });

    it("renders system ready badge when startup.state === 'ready' in Arabic", () => {
      mockPreferences("ar");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen(buildMockStartup({ state: "ready" }));
      expect(markup).toContain("النظام جاهز ومتاح للعمل المحلي");
      expect(markup).toContain("home-status-dot");
    });

    it("renders status title fallback when startup.state !== 'ready'", () => {
      mockPreferences("en");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen(
        buildMockStartup({
          handshake: null,
          state: "connecting",
        }),
      );
      expect(markup).not.toContain("System Ready &amp; Operational");
      expect(markup).toContain("Connecting");
    });
  });

  describe("Quick access module cards permission filtering", () => {
    it("renders only settings card when no module permissions are granted", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: [],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="settings"');
      expect(markup).toContain('href="#/settings"');
      expect(markup).not.toContain('data-module="sales"');
      expect(markup).not.toContain('data-module="purchases"');
      expect(markup).not.toContain('data-module="inventory"');
      expect(markup).not.toContain('data-module="products"');
      expect(markup).not.toContain('data-module="basket"');
    });

    it("shows sales card only when sales.drafts.manage is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["sales.drafts.manage"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="sales"');
      expect(markup).toContain('href="#/sales"');
      expect(markup).not.toContain('data-module="purchases"');
      expect(markup).not.toContain('data-module="inventory"');
      expect(markup).not.toContain('data-module="products"');
      expect(markup).not.toContain('data-module="basket"');
    });

    it("shows purchases card when purchases.drafts.manage is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["purchases.drafts.manage"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="purchases"');
      expect(markup).toContain('href="#/purchases"');
      expect(markup).not.toContain('data-module="sales"');
    });

    it("shows purchases card when purchases.posted.view is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["purchases.posted.view"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="purchases"');
      expect(markup).toContain('href="#/purchases"');
    });

    it("shows inventory card when inventory.review is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["inventory.review"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="inventory"');
      expect(markup).toContain('href="#/inventory"');
      expect(markup).not.toContain('data-module="sales"');
    });

    it("shows inventory card when inventory.counts.record is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["inventory.counts.record"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="inventory"');
      expect(markup).toContain('href="#/inventory"');
    });

    it("shows products card when catalog.item.manage is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["catalog.item.manage"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="products"');
      expect(markup).toContain('href="#/catalog/products"');
      expect(markup).not.toContain('data-module="sales"');
    });

    it("shows basket card when inventory.reorder.manage is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["inventory.reorder.manage"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="basket"');
      expect(markup).toContain('href="#/basket"');
      expect(markup).not.toContain('data-module="sales"');
    });

    it("shows basket card when inventory.reorder.confirm is allowed", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: ["inventory.reorder.confirm"],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="basket"');
      expect(markup).toContain('href="#/basket"');
    });

    it("renders all cards when all corresponding permissions are granted", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: [
            "sales.drafts.manage",
            "purchases.drafts.manage",
            "inventory.review",
            "catalog.item.manage",
            "inventory.reorder.manage",
          ],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('data-module="sales"');
      expect(markup).toContain('data-module="purchases"');
      expect(markup).toContain('data-module="inventory"');
      expect(markup).toContain('data-module="products"');
      expect(markup).toContain('data-module="basket"');
      expect(markup).toContain('data-module="settings"');
    });
  });

  describe("Summary cards and links", () => {
    it("renders connection summary card with link to #/settings/connection and API versions when handshake exists", () => {
      mockPreferences("en");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen(
        buildMockStartup({
          handshake: {
            apiVersion: LOCAL_API_VERSION,
            database: "available",
            schemaVersion: LOCAL_SCHEMA_VERSION,
            status: "healthy",
          },
        }),
      );

      expect(markup).toContain('href="#/settings/connection"');
      expect(markup).toContain("Connection status");
      expect(markup).toContain("View Connection Status");
      expect(markup).toContain(
        `Local API version ${LOCAL_API_VERSION} · Schema version ${LOCAL_SCHEMA_VERSION}`,
      );
    });

    it("renders connection summary card with fallback status title when handshake is null", () => {
      mockPreferences("en");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen(
        buildMockStartup({
          handshake: null,
          state: "starting",
        }),
      );

      expect(markup).toContain('href="#/settings/connection"');
      expect(markup).toContain("Starting");
    });

    it("renders licence summary card with link to #/settings/licence and plan name", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          entitlement: {
            capabilities: [],
            licence: {
              features: [],
              formatVersion: 1,
              founderOverrideGrants: [],
              graceEndsAt: "2029-01-14T23:59:59Z",
              issuedAt: "2026-01-01T00:00:00Z",
              keyId: "key-1",
              licenceId: "licence-1",
              mainDeviceId: "device-1",
              permittedDeviceCount: 1,
              pharmacyId: "pharmacy-1",
              plan: "enterprise",
              expiresAt: "2028-12-31T23:59:59Z",
            },
            status: "licensed",
          },
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('href="#/settings/licence"');
      expect(markup).toContain("Licence &amp; Security");
      expect(markup).toContain("Manage Licence");
      expect(markup).toContain("Plan: enterprise · Offline-first");
    });

    it("falls back to Core / الأساسية plan when licence is null", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          entitlement: {
            capabilities: [],
            licence: null,
            status: "free-core",
          },
        }),
      );

      const markupEn = renderHomeScreen();
      expect(markupEn).toContain("Plan: Core · Offline-first");

      mockPreferences("ar");
      const markupAr = renderHomeScreen();
      expect(markupAr).toContain("خطة الأساسية · محلي بدون اتصال");
    });
  });

  describe("Localization (English and Arabic)", () => {
    it("renders all dashboard labels, section titles, card text, and actions in English", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: [
            "sales.drafts.manage",
            "purchases.drafts.manage",
            "inventory.review",
            "catalog.item.manage",
            "inventory.reorder.manage",
          ],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('aria-label="Home"');
      expect(markup).toContain("Quick Access Modules");
      expect(markup).toContain("POS Active");
      expect(markup).toContain("Point of sale, sales drafts, and dispensing");
      expect(markup).toContain("Open");
      expect(markup).toContain("View Connection Status");
      expect(markup).toContain("Manage Licence");
    });

    it("renders all dashboard labels, section titles, card text, and actions in Arabic", () => {
      mockPreferences("ar");
      mockIdentity(
        buildMockAuthenticatedState({
          allowedPermissions: [
            "sales.drafts.manage",
            "purchases.drafts.manage",
            "inventory.review",
            "catalog.item.manage",
            "inventory.reorder.manage",
          ],
        }),
      );

      const markup = renderHomeScreen();
      expect(markup).toContain('aria-label="الرئيسية"');
      expect(markup).toContain("الأقسام السريعة");
      expect(markup).toContain("البيع المباشر");
      expect(markup).toContain("نقطة البيع، إصدار الفواتير وصرف الأدوية");
      expect(markup).toContain("فتح القسم");
      expect(markup).toContain("عرض تفاصيل الاتصال");
      expect(markup).toContain("إدارة الترخيص");
      expect(markup).toContain("حالة الاتصال");
      expect(markup).toContain("الترخيص والأمان");
    });
  });
});
