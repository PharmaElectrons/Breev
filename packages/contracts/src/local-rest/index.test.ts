import { describe, expect, it } from "vitest";

import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_API_VERSION,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  LOCAL_PROOF_MUTATION_SUCCESS_STATUS,
  LOCAL_SCHEMA_VERSION,
  LocalRestPayloadError,
  LocalRestVersionMismatchError,
  localHealthContract,
  localProofEvidenceContract,
  localProofMutationContract,
  parseLocalProofEvidenceResponse,
  parseLocalProofMutationResponse,
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
    [LOCAL_API_VERSION, "1"],
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

describe("local REST Main device proof contract", () => {
  it("defines the exact protected mutation and browser-defense headers", () => {
    expect(localProofMutationContract).toMatchObject({
      method: "POST",
      path: "/security/device-session-proof",
    });
    expect(
      localProofMutationContract.request.body.parse({ increment: 1 }),
    ).toEqual({ increment: 1 });
    expect(() =>
      localProofMutationContract.request.body.parse({
        increment: 1,
        tenantId: "caller-controlled",
      }),
    ).toThrow();
    expect(BREEV_CSRF_HEADER).toBe("X-Breev-CSRF");
    expect(BREEV_CSRF_VALUE).toBe("1");
    expect(LOCAL_DEVICE_ID_HEADER).toBe("X-Breev-Device-Id");
    expect(LOCAL_DEVICE_SESSION_HEADER).toBe("X-Breev-Device-Session");
  });

  it("accepts the successful mutation response", () => {
    expect(
      parseLocalProofMutationResponse(LOCAL_PROOF_MUTATION_SUCCESS_STATUS, {
        status: "committed",
        mutationCount: "1",
      }),
    ).toEqual({ status: "committed", mutationCount: "1" });
  });

  it.each([400, 401, 403, 413, 415, 421, 429])(
    "accepts the privacy-safe denial response for status %i",
    (statusCode) => {
      expect(
        parseLocalProofMutationResponse(statusCode, {
          status: "denied",
          code: "origin-not-allowed",
          requestId: "0198dcbb-d7e3-7000-8000-000000000001",
        }),
      ).toEqual({
        status: "denied",
        code: "origin-not-allowed",
        requestId: "0198dcbb-d7e3-7000-8000-000000000001",
      });
    },
  );

  it("rejects malformed success and denial payloads", () => {
    expect(() =>
      parseLocalProofMutationResponse(201, {
        status: "committed",
        mutationCount: 1,
      }),
    ).toThrow(LocalRestPayloadError);
    expect(() =>
      parseLocalProofMutationResponse(403, {
        status: "denied",
        code: "secret-leaked",
        requestId: "not-a-uuid",
      }),
    ).toThrow(LocalRestPayloadError);
  });

  it("accepts bounded proof evidence with denial totals", () => {
    expect(localProofEvidenceContract).toMatchObject({
      method: "GET",
      path: "/security/device-session-proof",
    });
    expect(
      parseLocalProofEvidenceResponse(200, {
        mutationCount: "2",
        recentDenialCount: "4",
        denials: [
          { code: "binding-missing", count: "3" },
          { code: "origin-not-allowed", count: "1" },
        ],
      }),
    ).toEqual({
      mutationCount: "2",
      recentDenialCount: "4",
      denials: [
        { code: "binding-missing", count: "3" },
        { code: "origin-not-allowed", count: "1" },
      ],
    });
  });
});
