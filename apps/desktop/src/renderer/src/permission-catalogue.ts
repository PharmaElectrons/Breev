import type { ImplementedPermissionName } from "@breev/contracts/local-rest";

/**
 * The permissions the renderer can name, grouped by the task they belong to.
 *
 * Authorization never reads this file: the local API grants and checks the
 * stable permission ids, and the roles route says which of them are grantable
 * today. This catalogue only decides how those ids are presented — a
 * localized name and description from `identity-messages.ts`, and a group
 * heading — so that no internal id ever appears as user-facing copy. An id
 * the server offers but this catalogue does not know is not shown at all
 * rather than shown raw. The grantable ids come from the shared local contract,
 * and the unit test beside this file requires each id to appear exactly once.
 */
export type ImplementedPermissionId = ImplementedPermissionName;

export type PermissionGroupId =
  | "administration"
  | "attendance"
  | "devices-licensing"
  | "products"
  | "inventory"
  | "purchasing";

export interface PermissionGroup {
  readonly id: PermissionGroupId;
  readonly permissions: readonly ImplementedPermissionId[];
}

/** Presentation order: what an owner reaches for first sits first. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: "administration",
    permissions: [
      "identity.users.manage",
      "identity.roles.manage",
      "pharmacy.settings.manage",
    ],
  },
  {
    id: "products",
    permissions: ["catalog.item.manage", "catalog.item.search"],
  },
  {
    id: "purchasing",
    permissions: [
      "purchases.adjustments.manage",
      "purchases.drafts.manage",
      "purchases.posted.view",
      "purchases.returns.manage",
      "purchases.costs.view",
      "suppliers.manage",
    ],
  },
  {
    id: "inventory",
    permissions: ["inventory.review", "inventory.valuation.view"],
  },
  { id: "attendance", permissions: ["attendance.record"] },
  {
    id: "devices-licensing",
    permissions: ["devices.pair", "licensing.manage"],
  },
];

export const IMPLEMENTED_PERMISSION_IDS: readonly ImplementedPermissionId[] =
  PERMISSION_GROUPS.flatMap((group) => group.permissions);

export function isImplementedPermissionId(
  value: string,
): value is ImplementedPermissionId {
  return (IMPLEMENTED_PERMISSION_IDS as readonly string[]).includes(value);
}

/**
 * The groups to render for the permissions the server says are grantable,
 * in catalogue order, with any group that has nothing to show left out.
 */
export function permissionGroupsFor(
  grantable: readonly string[],
): readonly PermissionGroup[] {
  const offered = new Set(grantable);
  return PERMISSION_GROUPS.map((group) => ({
    id: group.id,
    permissions: group.permissions.filter((permission) =>
      offered.has(permission),
    ),
  })).filter((group) => group.permissions.length > 0);
}

/** The catalogued subset of a permission list, in catalogue order. */
export function cataloguedPermissions(
  permissions: readonly string[],
): readonly ImplementedPermissionId[] {
  const held = new Set(permissions);
  return IMPLEMENTED_PERMISSION_IDS.filter((permission) =>
    held.has(permission),
  );
}
