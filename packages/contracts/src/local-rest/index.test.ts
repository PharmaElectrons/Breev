import { describe, expect, it } from "vitest";

import {
  LOCAL_API_VERSION,
  LOCAL_SCHEMA_VERSION,
  LocalRestPayloadError,
  LocalRestVersionMismatchError,
  localHealthContract,
  parseLocalHealthResponse,
} from "./index.js";

describe("local REST health contract", () => {
  it("accepts the healthy handshake", () => {
    const payload = {
      apiVersion: LOCAL_API_VERSION,
      schemaVersion: LOCAL_SCHEMA_VERSION,
      status: "healthy",
      database: "available",
    };

    expect(parseLocalHealthResponse(200, payload)).toEqual(payload);
    expect(localHealthContract.method).toBe("GET");
    expect(localHealthContract.path).toBe("/health");
  });

  it("accepts the database-unavailable handshake", () => {
    const payload = {
      apiVersion: LOCAL_API_VERSION,
      schemaVersion: LOCAL_SCHEMA_VERSION,
      status: "degraded",
      database: "unavailable",
    };

    expect(parseLocalHealthResponse(503, payload)).toEqual(payload);
  });

  it("accepts only the defined repair-required signal", () => {
    const payload = {
      apiVersion: LOCAL_API_VERSION,
      schemaVersion: LOCAL_SCHEMA_VERSION,
      status: "repair-required",
      repair: {
        code: "installation-state-invalid",
      },
    };

    expect(parseLocalHealthResponse(503, payload)).toEqual(payload);
  });

  it.each([
    [200, null],
    [200, { status: "healthy" }],
    [
      200,
      {
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "healthy",
        database: "available",
        unexpected: true,
      },
    ],
    [
      503,
      {
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "healthy",
        database: "available",
      },
    ],
    [
      503,
      {
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "repair-required",
      },
    ],
    [
      503,
      {
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "repair-required",
        repair: { code: "generic-repair" },
      },
    ],
    [
      418,
      {
        apiVersion: LOCAL_API_VERSION,
        schemaVersion: LOCAL_SCHEMA_VERSION,
        status: "healthy",
        database: "available",
      },
    ],
  ])("rejects a malformed payload for status %i", (statusCode, payload) => {
    expect(() => parseLocalHealthResponse(statusCode, payload)).toThrow(
      LocalRestPayloadError,
    );
  });

  it.each([
    ["1", LOCAL_SCHEMA_VERSION],
    [LOCAL_API_VERSION, "2"],
  ])(
    "reports API version %s and schema version %s as incompatible",
    (apiVersion, schemaVersion) => {
      expect(() =>
        parseLocalHealthResponse(200, {
          apiVersion,
          schemaVersion,
          status: "healthy",
          database: "available",
        }),
      ).toThrow(LocalRestVersionMismatchError);
    },
  );
});
