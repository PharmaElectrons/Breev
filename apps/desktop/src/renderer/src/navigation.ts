import type { CapabilityName } from "@breev/contracts/local-rest";

import { requiredCapabilityFor } from "./feature-surfaces";
import type { ModuleId } from "./module-ids";

export type { ModuleId } from "./module-ids";

/**
 * The Phase One module surfaces the production shell may show.
 *
 * Excluded and deferred prototype modules are absent by construction, not
 * filtered at render time: the Clinic tab is outside project scope
 * (docs/product.md §Excluded), and delivery, e-commerce, marketing, and
 * external integration are deferred (docs/product.md §Deferred), so Breev must
 * not advertise them at all — an "unavailable" entry would still promise scope
 * the product has not sold.
 */
export type ModuleAvailability = "available" | "unavailable";

interface ModuleDefinition {
  readonly hash: string;
  readonly id: ModuleId;
  /**
   * `true` once the surface has real server authority behind it. A required
   * surface that is not implemented still appears, marked unavailable, because
   * the requirements call for it and hiding it would misrepresent the product.
   */
  readonly implemented: boolean;
  /**
   * A named permission the user must already hold. The renderer receives
   * allowed navigation (docs/workflows.md §Start and connect step 4); the local
   * API still authorizes every request independently.
   */
  readonly requiredPermission: string | null;
}

/** Tab order follows the client prototype's own module bar. */
export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  {
    hash: "#/dashboard",
    id: "dashboard",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/sales",
    id: "sales",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/purchases",
    id: "purchases",
    implemented: true,
    requiredPermission: "purchases.drafts.manage",
  },
  {
    hash: "#/inventory",
    id: "inventory",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/catalog/products",
    id: "products",
    implemented: true,
    requiredPermission: "catalog.item.manage",
  },
  {
    hash: "#/patients",
    id: "patients",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/messages",
    id: "messages",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/basket",
    id: "basket",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/reports",
    id: "reports",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/accounts",
    id: "accounts",
    implemented: false,
    requiredPermission: null,
  },
  {
    hash: "#/administration",
    id: "administration",
    implemented: true,
    requiredPermission: null,
  },
  {
    hash: "#/settings",
    id: "settings",
    implemented: false,
    requiredPermission: null,
  },
] as const;

export const DEFAULT_MODULE_ID: ModuleId = "administration";

/**
 * Where a request for a surface the user may not have lands instead.
 *
 * Administration carries neither a permission nor a capability requirement, so
 * it is always in an authenticated user's allowed navigation and can never
 * bounce a redirect back to itself.
 */
export function defaultModuleHash(): string {
  const fallback = MODULE_DEFINITIONS.find(
    (definition) => definition.id === DEFAULT_MODULE_ID,
  );
  if (fallback === undefined) {
    throw new Error("The default module is missing from the registry");
  }
  return fallback.hash;
}

export interface NavigationAccess {
  readonly allowedPermissions: readonly string[];
  readonly capabilities: readonly CapabilityName[];
}

export interface NavigationModule {
  readonly availability: ModuleAvailability;
  readonly hash: string;
  readonly id: ModuleId;
}

/**
 * The allowed navigation for one authenticated context.
 *
 * A surface disappears when its paid capability (from the feature registry in
 * `feature-surfaces.ts`) is not granted or when the user does not hold its
 * named permission. Missing entitlement hides the surface completely rather
 * than disabling it — docs/product.md: "Menus and functions not enabled for a
 * pharmacy are hidden completely, not shown as disabled buttons". UI hiding is
 * never the enforcement boundary. Everything else is listed, and a surface
 * without an implementation behind it says so instead of pretending to work.
 */
export function navigationModules(
  access: NavigationAccess,
): readonly NavigationModule[] {
  const permissions = new Set(access.allowedPermissions);
  const capabilities = new Set<string>(access.capabilities);

  return MODULE_DEFINITIONS.filter((definition) => {
    const requiredCapability = requiredCapabilityFor(definition.id);
    if (requiredCapability !== null && !capabilities.has(requiredCapability)) {
      return false;
    }
    return (
      definition.requiredPermission === null ||
      permissions.has(definition.requiredPermission)
    );
  }).map((definition) => ({
    availability: definition.implemented ? "available" : "unavailable",
    hash: definition.hash,
    id: definition.id,
  }));
}

/**
 * Whether a module has real server authority behind it.
 *
 * Routing asks this, not the navigation list, because hiding a tab is a
 * convenience and never an access decision: a deep link still reaches the
 * screen, and the local API still authorizes every request it makes.
 */
export function moduleImplemented(id: ModuleId): boolean {
  return (
    MODULE_DEFINITIONS.find((definition) => definition.id === id)
      ?.implemented ?? false
  );
}

/**
 * Resolve the module a location hash addresses.
 *
 * Catalog owns a family of hashes (`#/catalog/products/<id>`, `/new`, `/edit`),
 * so prefix matching, not equality, decides. An unknown or empty hash falls
 * back to the administration workspace, which is what the shell has always
 * shown at the bare origin.
 */
export function moduleIdForHash(hash: string): ModuleId {
  const normalized = normalizeHash(hash);
  if (normalized === "") {
    return DEFAULT_MODULE_ID;
  }
  for (const definition of MODULE_DEFINITIONS) {
    const path = normalizeHash(definition.hash);
    if (normalized === path || normalized.startsWith(`${path}/`)) {
      return definition.id;
    }
  }
  if (normalized === "/catalog" || normalized.startsWith("/catalog/")) {
    return "products";
  }
  return DEFAULT_MODULE_ID;
}

/** `#/catalog/products` and `#catalog/products` both mean `/catalog/products`. */
export function normalizeHash(hash: string): string {
  const withoutMarker = hash.startsWith("#") ? hash.slice(1) : hash;
  if (withoutMarker === "" || withoutMarker === "/") {
    return "";
  }
  const withLeadingSlash = withoutMarker.startsWith("/")
    ? withoutMarker
    : `/${withoutMarker}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

/** The catalog screen reads the full path, not just the owning module. */
export function catalogHash(hash: string): string {
  const normalized = normalizeHash(hash);
  return normalized === "" ? "#/catalog/products" : `#${normalized}`;
}
