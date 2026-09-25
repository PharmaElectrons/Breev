import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModuleNavigation } from "./module-navigation";
import { PreferencesProvider } from "./preferences-provider";
import type { NavigationModule } from "./navigation";

const SAMPLE_MODULES: readonly NavigationModule[] = [
  { availability: "available", hash: "#/dashboard", id: "dashboard" },
  { availability: "available", hash: "#/sales", id: "sales" },
  { availability: "available", hash: "#/purchases", id: "purchases" },
  { availability: "available", hash: "#/inventory", id: "inventory" },
  { availability: "unavailable", hash: "#/basket", id: "basket" },
  { availability: "unavailable", hash: "#/accounts", id: "accounts" },
  { availability: "unavailable", hash: "#/settings", id: "settings" },
];

describe("ModuleNavigation unit tests", () => {
  it("renders nav container with moduleNavigation aria-label and module-nav class", () => {
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

    expect(markup).toContain(
      '<nav aria-describedby="module-navigation-scroll-hint" aria-label="Modules" class="module-nav">',
    );
    expect(markup).toContain(
      '<span class="visually-hidden" id="module-navigation-scroll-hint">If a module is not visible, scroll horizontally to find it.</span>',
    );
    expect(markup).toContain(
      '<span aria-hidden="true" class="module-nav-overflow-cue">›</span>',
    );
    expect(markup).toContain("<ul>");
  });

  it("marks only the active module with aria-current='page'", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PreferencesProvider,
        null,
        createElement(ModuleNavigation, {
          activeModuleId: "sales",
          modules: SAMPLE_MODULES,
        }),
      ),
    );

    expect(markup).toContain(
      'aria-current="page" class="module-tab" data-availability="available" data-module="sales" href="#/sales"',
    );
    expect(markup).not.toContain(
      'data-module="dashboard" href="#/dashboard" aria-current="page"',
    );
    expect(markup).toContain(
      'class="module-tab" data-availability="available" data-module="dashboard" href="#/dashboard"',
    );
  });

  it("renders unavailable module with unavailableBadge in visually-hidden span", () => {
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

    expect(markup).toContain('data-availability="unavailable"');
    expect(markup).toContain(
      '<span class="visually-hidden"> — Not available yet</span>',
    );
  });

  it("returns null when no visible modules remain", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PreferencesProvider,
        null,
        createElement(ModuleNavigation, {
          activeModuleId: "dashboard",
          excludeModuleIds: ["dashboard", "sales"],
          modules: [
            { availability: "available", hash: "#/dashboard", id: "dashboard" },
            { availability: "available", hash: "#/sales", id: "sales" },
          ],
        }),
      ),
    );

    expect(markup).toBe("");
  });

  it("renders all entries as anchor links with critical attributes", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PreferencesProvider,
        null,
        createElement(ModuleNavigation, {
          activeModuleId: "purchases",
          modules: SAMPLE_MODULES,
        }),
      ),
    );

    expect(markup).toContain('href="#/purchases"');
    expect(markup).toContain('data-module="purchases"');
    expect(markup).toContain('data-availability="available"');
    expect(markup).toContain('class="module-tab"');
    expect(markup).not.toContain("<button");
  });
});
