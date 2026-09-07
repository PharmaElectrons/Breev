import { IMPLEMENTED_PERMISSION_NAMES } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { identityMessages } from "./identity-messages";
import {
  cataloguedPermissions,
  IMPLEMENTED_PERMISSION_IDS,
  PERMISSION_GROUPS,
  permissionGroupsFor,
} from "./permission-catalogue";

describe("permission catalogue", () => {
  it("names every implemented permission exactly once", () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect([...grouped].sort()).toEqual(
      [...IMPLEMENTED_PERMISSION_NAMES].sort(),
    );
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(IMPLEMENTED_PERMISSION_IDS).toEqual(grouped);
  });

  it("represents every built-in role in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const copy = identityMessages[locale];
      for (const role of Object.keys(
        copy.roles,
      ) as (keyof typeof copy.roles)[]) {
        expect(
          copy.roles[role].trim().length,
          `${locale} ${role} name`,
        ).toBeGreaterThan(0);
        expect(
          copy.roleDescriptions[role].trim().length,
          `${locale} ${role} description`,
        ).toBeGreaterThan(0);
      }
    }
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
