import {
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  LocalRestVersionMismatchError,
} from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { stateFromHealth, stateFromStartupFailure } from "./startup-state";

describe("desktop startup state", () => {
  it("derives ready only from a healthy authoritative response", () => {
    expect(
      stateFromHealth({
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "healthy",
        database: "available",
      }),
    ).toBe("ready");
  });

  it("derives main unavailable from a reachable degraded API", () => {
    expect(
      stateFromHealth({
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "degraded",
        database: "unavailable",
      }),
    ).toBe("main-unavailable");
  });

  it("derives repair required only from the typed repair signal", () => {
    expect(
      stateFromHealth({
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "repair-required",
        repair: { code: "installation-state-invalid" },
      }),
    ).toBe("repair-required");
  });

  it("separates version mismatch from ordinary unavailability", () => {
    expect(
      stateFromStartupFailure(new LocalRestVersionMismatchError("1", "1")),
    ).toBe("incompatible-version");
    expect(stateFromStartupFailure(new TypeError("fetch failed"))).toBe(
      "main-unavailable",
    );
  });
});
