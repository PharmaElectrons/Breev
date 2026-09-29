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

  describe("Prototype KPI Stacked Cards", () => {
    it("renders all 5 KPI stacked cards with correct prototype labels and tones in English", () => {
      mockPreferences("en");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen();
      expect(markup).toContain('data-tone="emerald"');
      expect(markup).toContain('data-tone="rose"');
      expect(markup).toContain('data-tone="amber"');
      expect(markup).toContain('data-tone="cyan"');
      expect(markup).toContain("Total Sales");
      expect(markup).toContain("Daily Sales");
      expect(markup).toContain("Total Expenses");
      expect(markup).toContain("Today Expenses");
      expect(markup).toContain("Total Profit");
      expect(markup).toContain("Today Profit");
      expect(markup).toContain("Warehouse Cost");
      expect(markup).toContain("Warehouse Retail Value");
      expect(markup).toContain("Total Debts");
      expect(markup).toContain("Near Expiry Ratio");
      expect(markup).toContain("0 IQD");
      expect(markup).toContain("0.0%");
    });

    it("renders all 5 KPI stacked cards with correct prototype labels and tones in Arabic", () => {
      mockPreferences("ar");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen();
      expect(markup).toContain("اجمالي البيع");
      expect(markup).toContain("البيع اليومي");
      expect(markup).toContain("اجمالي الصرفيات");
      expect(markup).toContain("الصرفيات اليوم");
      expect(markup).toContain("اجمالي الربح");
      expect(markup).toContain("ربح اليوم");
      expect(markup).toContain("اجمالي كلفة المخزن");
      expect(markup).toContain("قيمة المخزن - سعر البيع");
      expect(markup).toContain("اجمالي الديون");
      expect(markup).toContain("نسبة قريب الانتهاء");
      expect(markup).toContain("0 د.ع");
      expect(markup).toContain("0.0%");
    });
  });

  describe("Unified Notification Center Strip", () => {
    it("renders notification center tabs and counts in English", () => {
      mockPreferences("en");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen();
      expect(markup).toContain("Unified Notification Center");
      expect(markup).toContain("Item Alerts");
      expect(markup).toContain("Patient Alerts");
      expect(markup).toContain("Invoices &amp; Payments");
      expect(markup).toContain("No active alerts");
    });

    it("renders notification center tabs and counts in Arabic", () => {
      mockPreferences("ar");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen();
      expect(markup).toContain("مركز التنبيهات الموحد");
      expect(markup).toContain("تنبيهات المواد");
      expect(markup).toContain("تنبيهات المرضى");
      expect(markup).toContain("فواتير ومستحقات");
      expect(markup).toContain("لا توجد تنبيهات نشطة");
    });
  });

  describe("Consolidated Performance Analysis Table", () => {
    it("renders table header, title, and all 8 sortable column headers in English", () => {
      mockPreferences("en");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen();
      expect(markup).toContain(
        "Performance Analysis — Top Selling &amp; Most Profitable",
      );
      expect(markup).toContain('placeholder="Search items by name or code..."');
      expect(markup).toContain('aria-label="Table Filters"');
      expect(markup).toContain("Top Selling");
      expect(markup).toContain("Most Profitable");
      expect(markup).toContain("Low Stock");
      expect(markup).toContain("Near Expiry");
      expect(markup).toContain("Suggested Surplus");
      expect(markup).toContain("0 items");
      expect(markup).toContain("Item");
      expect(markup).toContain("Sold Qty");
      expect(markup).toContain("Profit");
      expect(markup).toContain("Profit %");
      expect(markup).toContain("Expiry");
      expect(markup).toContain("Current Stock");
      expect(markup).toContain("Monthly Rate");
      expect(markup).toContain("Suggested Surplus");
      expect(markup).toContain("No data available.");
    });

    it("renders table header, title, and all 8 sortable column headers in Arabic", () => {
      mockPreferences("ar");
      mockIdentity(buildMockAuthenticatedState());

      const markup = renderHomeScreen();
      expect(markup).toContain("تحليل الأداء — الأكثر مبيعاً والأكثر ربحاً");
      expect(markup).toContain('placeholder="بحث عن مادة بالاسم أو الرمز..."');
      expect(markup).toContain('aria-label="Table Filters"');
      expect(markup).toContain("الأكثر مبيعاً");
      expect(markup).toContain("الأعلى ربحاً");
      expect(markup).toContain("نواقص المخزون");
      expect(markup).toContain("قريب الانتهاء");
      expect(markup).toContain("مقترح الفائض");
      expect(markup).toContain("0 مادة");
      expect(markup).toContain("المادة");
      expect(markup).toContain("كمية المباع");
      expect(markup).toContain("الربح");
      expect(markup).toContain("نسبة الربح %");
      expect(markup).toContain("الاكسباير");
      expect(markup).toContain("الكمية الحالية");
      expect(markup).toContain("الصرف الشهري");
      expect(markup).toContain("مقترح الفائض");
      expect(markup).toContain("لا توجد بيانات متاحة حالياً.");
    });
  });

  describe("System Identifiers Support Card with 1-Click Copy", () => {
    it("renders pharmacy ID, device ID, and copy buttons", () => {
      mockPreferences("en");
      mockIdentity(
        buildMockAuthenticatedState({
          pharmacy: {
            id: "018f92a3-b4c5-7def-8901-23456789abcd",
            name: "Al-Shifa",
          },
        }),
      );

      const startup = buildMockStartup({
        startupConfig: {
          deviceId: "018f92a3-0000-7def-8901-000000000001",
          diagnosticReporting: "disabled",
          installationId: "018f92a3-1111-7def-8901-111111111111",
          localApiOrigin: "http://127.0.0.1:4000",
          role: "main",
        },
      });

      const markup = renderHomeScreen(startup);
      expect(markup).toContain("System &amp; Version Information");
      expect(markup).toContain("ID: 018f92a3...");
      expect(markup).toContain("DEV: 018f92a3...");
      expect(markup).toContain('aria-label="Copy Pharmacy ID"');
      expect(markup).toContain('aria-label="Copy Device ID"');
    });
  });
});
