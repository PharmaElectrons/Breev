import { describe, expect, it } from "vitest";

import { identityMessages } from "./identity-messages";
import {
  cataloguedPermissions,
  IMPLEMENTED_PERMISSION_IDS,
  PERMISSION_GROUPS,
  permissionGroupsFor,
} from "./permission-catalogue";

/**
 * The seven permissions the local API implements today. This list is pinned
 * in apps/local-api/src/identity-access/authorization.unit.test.ts as
 * IMPLEMENTED_PERMISSION_NAMES; the renderer cannot import it across the
 * workspace boundary, so both sides pin the same seven names.
 */
const SERVER_IMPLEMENTED_PERMISSIONS = [
  "attendance.record",
  "catalog.item.manage",
  "devices.pair",
  "identity.roles.manage",
  "identity.users.manage",
  "licensing.manage",
  "pharmacy.settings.manage",
] as const;

describe("permission catalogue", () => {
  it("names every implemented permission exactly once", () => {
    expect([...IMPLEMENTED_PERMISSION_IDS].sort()).toEqual([
      ...SERVER_IMPLEMENTED_PERMISSIONS,
    ]);
    expect(new Set(IMPLEMENTED_PERMISSION_IDS).size).toBe(
      IMPLEMENTED_PERMISSION_IDS.length,
    );
  });

  it("carries a localized name, description, and group heading in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const copy = identityMessages[locale];
      for (const permission of IMPLEMENTED_PERMISSION_IDS) {
        const label = copy.permissionLabels[permission];
        expect(
          label.name.trim().length,
          `${locale} ${permission}`,
        ).toBeGreaterThan(0);
        expect(
          label.description.trim().length,
          `${locale} ${permission}`,
        ).toBeGreaterThan(0);
        // Internal ids never reach the screen: no label may echo one.
        expect(label.name).not.toMatch(
          /[a-z]+\.[a-z_]+\.[a-z_]+|[a-z]+\.[a-z_]+/u,
        );
        expect(label.description).not.toContain(permission);
      }
      for (const group of PERMISSION_GROUPS) {
        expect(copy.permissionGroups[group.id].trim().length).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("renders only the groups the server offers, in catalogue order", () => {
    expect(
      permissionGroupsFor(["licensing.manage", "attendance.record"]).map(
        (group) => group.id,
      ),
    ).toEqual(["attendance", "devices-licensing"]);
    expect(permissionGroupsFor(["sales.return.post"])).toEqual([]);
  });

  it("drops an unknown id instead of showing it raw", () => {
    expect(
      cataloguedPermissions(["sync.conflict.resolve", "devices.pair"]),
    ).toEqual(["devices.pair"]);
  });
});
