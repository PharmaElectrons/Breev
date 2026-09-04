import { describe, expect, it } from "vitest";

import {
  catalogHash,
  MODULE_DEFINITIONS,
  moduleIdForHash,
  moduleImplemented,
  navigationModules,
  normalizeHash,
  type ModuleId,
} from "./navigation";
import { navigationMessages } from "./navigation-messages";

const FREE_CORE_ACCESS = {
  allowedPermissions: ["catalog.item.manage", "purchases.drafts.manage"],
  capabilities: ["local-sales", "reports"],
} as const;

function idsFor(access: {
  allowedPermissions: readonly string[];
  capabilities: readonly ("local-sales" | "reports" | "whatsapp-messaging")[];
}): ModuleId[] {
  return navigationModules(access).map((module) => module.id);
}

describe("navigationModules", () => {
  it("never offers an excluded or deferred prototype module", () => {
    const ids = MODULE_DEFINITIONS.map((definition) => definition.id).join(" ");
    for (const forbidden of [
      "clinic",
      "delivery",
      "ecommerce",
      "marketing",
      "external",
      "integration",
    ]) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it("hides a paid surface completely when its capability is not granted", () => {
    expect(idsFor(FREE_CORE_ACCESS)).not.toContain("messages");
  });

  it("shows a paid surface once its capability is granted", () => {
    expect(
      idsFor({
        allowedPermissions: [],
        capabilities: ["whatsapp-messaging"],
      }),
    ).toContain("messages");
  });

  it("omits a module the user does not hold the permission for", () => {
    expect(idsFor({ allowedPermissions: [], capabilities: [] })).not.toContain(
      "products",
    );
    expect(idsFor(FREE_CORE_ACCESS)).toContain("products");
  });

  it("marks implemented workspaces available and unbuilt required surfaces unavailable", () => {
    const modules = navigationModules(FREE_CORE_ACCESS);
    const availability = new Map(
      modules.map((module) => [module.id, module.availability]),
    );
    expect(availability.get("products")).toBe("available");
    expect(availability.get("administration")).toBe("available");
    expect(availability.get("dashboard")).toBe("available");
    expect(availability.get("sales")).toBe("unavailable");
    expect(availability.get("purchases")).toBe("available");
    expect(availability.get("reports")).toBe("unavailable");
  });

  it("keeps the client prototype's module order", () => {
    expect(idsFor(FREE_CORE_ACCESS)).toEqual([
      "dashboard",
      "sales",
      "purchases",
      "inventory",
      "products",
      "patients",
      "basket",
      "reports",
      "accounts",
      "administration",
      "settings",
    ]);
  });
});

describe("moduleIdForHash", () => {
  it("falls back to the administration workspace at the bare origin", () => {
    expect(moduleIdForHash("")).toBe("administration");
    expect(moduleIdForHash("#")).toBe("administration");
    expect(moduleIdForHash("#/")).toBe("administration");
  });

  it("resolves the whole Catalog hash family", () => {
    expect(moduleIdForHash("#/catalog")).toBe("products");
    expect(moduleIdForHash("#/catalog/products")).toBe("products");
    expect(moduleIdForHash("#/catalog/products/new")).toBe("products");
    expect(moduleIdForHash("#/catalog/products/abc-123")).toBe("products");
    expect(moduleIdForHash("#/catalog/products/abc-123/edit")).toBe("products");
    expect(moduleIdForHash("#catalog/products")).toBe("products");
  });

  it("resolves an unbuilt surface so a deep link explains itself", () => {
    expect(moduleIdForHash("#/sales")).toBe("sales");
    expect(moduleIdForHash("#/reports")).toBe("reports");
  });

  it("sends an unknown hash to the default workspace", () => {
    expect(moduleIdForHash("#/clinic")).toBe("administration");
    expect(moduleIdForHash("#/delivery")).toBe("administration");
  });
});

describe("moduleImplemented", () => {
  it("does not consult permissions, because hiding is never enforcement", () => {
    expect(moduleImplemented("products")).toBe(true);
    expect(moduleImplemented("purchases")).toBe(true);
    expect(moduleImplemented("administration")).toBe(true);
    expect(moduleImplemented("dashboard")).toBe(true);
    expect(moduleImplemented("sales")).toBe(false);
    expect(moduleImplemented("messages")).toBe(false);
  });
});

describe("normalizeHash and catalogHash", () => {
  it("treats the marker, leading slash, and trailing slash as noise", () => {
    expect(normalizeHash("#/catalog/products/")).toBe("/catalog/products");
    expect(normalizeHash("catalog/products")).toBe("/catalog/products");
    expect(normalizeHash("#")).toBe("");
  });

  it("gives the Catalog screen a complete hash even at the bare origin", () => {
    expect(catalogHash("")).toBe("#/catalog/products");
    expect(catalogHash("#catalog/products/new")).toBe("#/catalog/products/new");
  });
});

describe("navigationMessages", () => {
  it("labels every module in both locales", () => {
    for (const definition of MODULE_DEFINITIONS) {
      for (const locale of ["ar", "en"] as const) {
        expect(
          navigationMessages[locale].modules[definition.id].label.length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("explains every unavailable surface in both locales", () => {
    for (const definition of MODULE_DEFINITIONS) {
      if (definition.implemented) {
        continue;
      }
      for (const locale of ["ar", "en"] as const) {
        expect(
          navigationMessages[locale].modules[definition.id].unavailableReason
            .length,
        ).toBeGreaterThan(0);
      }
    }
  });
});
