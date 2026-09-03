import { PAID_CAPABILITY_NAMES } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import {
  FEATURE_SURFACES,
  requiredCapabilityFor,
  type FeatureSurfaceId,
} from "./feature-surfaces";
import { MODULE_DEFINITIONS } from "./navigation";

describe("feature surfaces", () => {
  it("names a surface list for every paid capability", () => {
    expect(Object.keys(FEATURE_SURFACES).sort()).toEqual(
      [...PAID_CAPABILITY_NAMES].sort(),
    );
  });

  it("never lists a surface under two capabilities", () => {
    const seen = new Map<FeatureSurfaceId, string>();
    for (const capability of PAID_CAPABILITY_NAMES) {
      for (const surface of FEATURE_SURFACES[capability]) {
        expect(seen.get(surface), surface).toBeUndefined();
        seen.set(surface, capability);
      }
    }
  });

  it("names only surfaces the shell actually has", () => {
    const moduleIds = new Set<string>(
      MODULE_DEFINITIONS.map((definition) => definition.id),
    );
    for (const capability of PAID_CAPABILITY_NAMES) {
      for (const surface of FEATURE_SURFACES[capability]) {
        expect(
          surface === "devices-panel" || moduleIds.has(surface),
          surface,
        ).toBe(true);
      }
    }
  });

  it("resolves the built surfaces and leaves Free Core surfaces ungated", () => {
    expect(requiredCapabilityFor("messages")).toBe("whatsapp-messaging");
    expect(requiredCapabilityFor("devices-panel")).toBe(
      "additional-device-pos",
    );
    expect(requiredCapabilityFor("sales")).toBeNull();
    expect(requiredCapabilityFor("administration")).toBeNull();
  });
});
