import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModuleNavigation } from "./module-navigation";
import { NavbarCollapseMenu } from "./navbar-collapse-menu";
import { PreferencesProvider } from "./preferences-provider";
import type { NavigationModule } from "./navigation";

const DEFAULT_PROPS = {
  activeModuleId: "dashboard" as const,
  authenticated: true,
  centralSubmissionEnabled: false,
  defaultOpen: true,
  diagnosticAction: "idle" as const,
  exportDiagnostics: vi.fn(async () => {}),
  locale: "en" as const,
  onOpenSubmissionConfirmation: vi.fn(),
  openSupport: vi.fn(async () => {}),
  setLocale: vi.fn(),
  setTheme: vi.fn(),
  submissionAction: "idle" as const,
  supportAction: "idle" as const,
  theme: "light" as const,
};

describe("NavbarCollapseMenu", () => {
  it("renders the collapse menu trigger with localized label in English", () => {
    const markup = renderToStaticMarkup(
      createElement(NavbarCollapseMenu, {
        ...DEFAULT_PROPS,
        defaultOpen: false,
      }),
    );
    expect(markup).toContain("collapse-menu-trigger");
    expect(markup).toContain("Menu");
  });

  it("renders the collapse menu trigger with localized label in Arabic", () => {
    const markup = renderToStaticMarkup(
      createElement(NavbarCollapseMenu, {
        ...DEFAULT_PROPS,
        defaultOpen: false,
        locale: "ar",
      }),
    );
    expect(markup).toContain("collapse-menu-trigger");
    expect(markup).toContain("القائمة");
  });

  it("includes Accounts and Settings links, diagnostics, support, language and theme when open", () => {
    const markup = renderToStaticMarkup(
      createElement(NavbarCollapseMenu, DEFAULT_PROPS),
    );
    expect(markup).toContain('href="#/accounts"');
    expect(markup).toContain("Accounts");
    expect(markup).toContain('href="#/settings"');
    expect(markup).toContain("Settings");
    expect(markup).toContain("Export diagnostic package");
    expect(markup).toContain("Contact support");
    expect(markup).toContain("العربية");
    expect(markup).toContain("Light");
  });

  it("includes central diagnostic report button when enabled", () => {
    const markup = renderToStaticMarkup(
      createElement(NavbarCollapseMenu, {
        ...DEFAULT_PROPS,
        centralSubmissionEnabled: true,
      }),
    );
    expect(markup).toContain("Send diagnostic report");
  });

  it("omits authenticated actions when unauthenticated but retains language and mode", () => {
    const markup = renderToStaticMarkup(
      createElement(NavbarCollapseMenu, {
        ...DEFAULT_PROPS,
        authenticated: false,
      }),
    );
    expect(markup).not.toContain('href="#/accounts"');
    expect(markup).not.toContain('href="#/settings"');
    expect(markup).not.toContain("Export diagnostic package");
    expect(markup).not.toContain("Contact support");
    expect(markup).toContain("العربية");
    expect(markup).toContain("Light");
  });

  it("marks the active module as current page when active", () => {
    const markup = renderToStaticMarkup(
      createElement(NavbarCollapseMenu, {
        ...DEFAULT_PROPS,
        activeModuleId: "accounts",
      }),
    );
    expect(markup).toContain('aria-current="page"');
  });

  it("renders connection status, version pills, and actions when connectionInfo is provided and user is authenticated", () => {
    const markup = renderToStaticMarkup(
      createElement(NavbarCollapseMenu, {
        ...DEFAULT_PROPS,
        connectionInfo: {
          checkNow: vi.fn(),
          deviceProof: "committed",
          handshake: {
            apiVersion: "18",
            database: "available",
            schemaVersion: "18",
            status: "healthy",
          },
          isChecking: false,
          lastCheckedAt: new Date("2026-09-23T12:00:00Z"),
          runDeviceProof: vi.fn(),
          state: "ready",
        },
      }),
    );
    expect(markup).toContain("collapse-menu-connection");
    expect(markup).toContain("18");
    expect(markup).toContain("Check now");
    expect(markup).toContain("collapse-menu-device-proof");
  });
});

describe("ModuleNavigation exclusion", () => {
  const SAMPLE_MODULES: readonly NavigationModule[] = [
    { availability: "available", hash: "#/dashboard", id: "dashboard" },
    { availability: "available", hash: "#/sales", id: "sales" },
    { availability: "unavailable", hash: "#/accounts", id: "accounts" },
    { availability: "unavailable", hash: "#/settings", id: "settings" },
  ];

  it("excludes accounts and settings from horizontal tabs by default", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PreferencesProvider,
        null,
        createElement(ModuleNavigation, {
          activeModuleId: "dashboard",
          modules: SAMPLE_MODULES,
        }),
      ),
    );

    expect(markup).toContain('href="#/dashboard"');
    expect(markup).toContain('href="#/sales"');
    expect(markup).not.toContain('href="#/accounts"');
    expect(markup).not.toContain('href="#/settings"');
  });
});
