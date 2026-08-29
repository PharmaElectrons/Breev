import { describe, expect, it } from "vitest";

import {
  attendanceEventRequestSchema,
  identityCreateUserRequestSchema,
  identityStepUpApproveRequestSchema,
  identityStepUpCreateRequestSchema,
  identityUpdateRolePermissionsRequestSchema,
  identityUpdateUserRequestSchema,
  deviceInventoryContract,
  deviceInventorySchema,
  deviceRevocationContract,
  deviceRevocationPath,
  deviceRevocationRequestSchema,
  devicesDenialSchema,
  pairingCertificateContract,
  pairingChannelStatePath,
  pairingJoinContract,
  pairingJoinRequestSchema,
  pairingSessionCancelRequestSchema,
  pairingSessionConfirmPath,
  pairingSessionConfirmRequestSchema,
  pairingSessionStartContract,
  pairingSessionStartRequestSchema,
  pairingSessionStartedSchema,
  pairingSessionViewSchema,
  seatReleaseApprovalRequestSchema,
  seatReleaseRequestCreateSchema,
  stepUpActionSchema,
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  DEVICES_DENIAL_CODES,
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
  pharmacySettingsUpdateRequestSchema,
} from "./index.js";

const COMMAND_ID = "0198e7ce-7685-7000-8000-000000000001";

describe("identity mutation contracts", () => {
  it.each([
    [
      identityStepUpCreateRequestSchema,
      { action: "identity.user.create", idempotencyKey: COMMAND_ID },
    ],
    [
      identityStepUpApproveRequestSchema,
      { idempotencyKey: COMMAND_ID, password: "current password" },
    ],
    [
      identityCreateUserRequestSchema,
      {
        challengeId: COMMAND_ID,
        displayName: "New User",
        idempotencyKey: COMMAND_ID,
        password: "a sufficiently long private password",
        role: "pharmacist",
        username: "new.user",
      },
    ],
    [
      identityUpdateUserRequestSchema,
      {
        challengeId: COMMAND_ID,
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
        status: "locked",
      },
    ],
    [
      identityUpdateRolePermissionsRequestSchema,
      {
        challengeId: COMMAND_ID,
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
        permissions: ["attendance.record"],
      },
    ],
    [
      pharmacySettingsUpdateRequestSchema,
      {
        attendanceEnabled: true,
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
      },
    ],
    [
      attendanceEventRequestSchema,
      {
        expectedVersion: "1",
        idempotencyKey: COMMAND_ID,
        kind: "check-in",
      },
    ],
    [
      pairingSessionStartRequestSchema,
      { idempotencyKey: COMMAND_ID, stepUpChallengeId: COMMAND_ID },
    ],
    [pairingSessionConfirmRequestSchema, { idempotencyKey: COMMAND_ID }],
    [
      pairingSessionCancelRequestSchema,
      { idempotencyKey: COMMAND_ID, reason: "fingerprint-mismatch" },
    ],
    [
      deviceRevocationRequestSchema,
      {
        idempotencyKey: COMMAND_ID,
        reason: "terminal retired",
        stepUpChallengeId: COMMAND_ID,
      },
    ],
    [
      seatReleaseRequestCreateSchema,
      {
        deviceId: COMMAND_ID,
        idempotencyKey: COMMAND_ID,
        stepUpChallengeId: COMMAND_ID,
      },
    ],
    [
      seatReleaseApprovalRequestSchema,
      {
        approverPassword: "a sufficiently long private password",
        approverUsername: "second.owner",
        idempotencyKey: COMMAND_ID,
      },
    ],
  ])(
    "requires idempotency and current versions for command %s",
    (schema, body) => {
      expect(schema.safeParse(body).success).toBe(true);
      const withoutIdempotency = Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== "idempotencyKey"),
      );
      expect(schema.safeParse(withoutIdempotency).success).toBe(false);
    },
  );
});

describe("local REST health contract", () => {
  it("publishes the migrated schema version and an unchanged REST surface", () => {
    expect(LOCAL_API_VERSION).toBe("5");
    expect(LOCAL_SCHEMA_VERSION).toBe("6");
  });

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

  it("accepts the post-bootstrap user-authentication denial", () => {
    expect(
      parseLocalProofMutationResponse(401, {
        status: "denied",
        code: "session-missing",
        requestId: "0198dcbb-d7e3-7000-8000-000000000001",
      }),
    ).toEqual({
      status: "denied",
      code: "session-missing",
      requestId: "0198dcbb-d7e3-7000-8000-000000000001",
    });
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

describe("terminal pairing contracts", () => {
  const SESSION_ID = "0198e7ce-7685-7000-8000-000000000042";

  it("names the pairing Step-Up actions the server enforces", () => {
    expect(stepUpActionSchema.options).toContain("devices.pairing.start");
    expect(stepUpActionSchema.options).toContain("devices.revoke");
    expect(stepUpActionSchema.options).toContain(
      "devices.seat.release.request",
    );
  });

  it("keeps every pairing denial reason distinct and privacy-safe", () => {
    expect(new Set(DEVICES_DENIAL_CODES).size).toBe(
      DEVICES_DENIAL_CODES.length,
    );
    expect(
      devicesDenialSchema.parse({
        status: "denied",
        code: "pairing-session-replayed",
        requestId: SESSION_ID,
      }),
    ).toEqual({
      status: "denied",
      code: "pairing-session-replayed",
      requestId: SESSION_ID,
    });
    expect(() =>
      devicesDenialSchema.parse({
        status: "denied",
        code: "pairing-session-replayed",
        requestId: SESSION_ID,
        joinSecret: "leaked",
      }),
    ).toThrow();
  });

  it("publishes the Main-side and pairing-channel paths", () => {
    expect(pairingSessionStartContract.path).toBe("/devices/pairing-sessions");
    expect(deviceInventoryContract.path).toBe("/devices");
    expect(deviceRevocationContract.method).toBe("POST");
    expect(deviceRevocationPath(SESSION_ID)).toBe(
      `/devices/${SESSION_ID}/revocations`,
    );
    expect(pairingSessionConfirmPath(SESSION_ID)).toBe(
      `/devices/pairing-sessions/${SESSION_ID}/confirmation`,
    );
    expect(pairingChannelStatePath(SESSION_ID)).toBe(
      `/pairing/sessions/${SESSION_ID}/state`,
    );
    expect(pairingJoinContract.path).toBe("/pairing/joins");
    expect(pairingCertificateContract.path).toBe("/pairing/certificates");
  });

  it("requires proof of possession alongside the one-use join secret", () => {
    const join = {
      csrPem:
        "-----BEGIN CERTIFICATE REQUEST-----\nAA==\n-----END CERTIFICATE REQUEST-----\n",
      deviceName: "Counter 2",
      joinSecret: "A".repeat(43),
      sessionId: SESSION_ID,
      transcriptSignature: "Zm9v",
    };
    expect(pairingJoinRequestSchema.safeParse(join).success).toBe(true);
    const withoutProof = Object.fromEntries(
      Object.entries(join).filter(([key]) => key !== "transcriptSignature"),
    );
    expect(pairingJoinRequestSchema.safeParse(withoutProof).success).toBe(
      false,
    );
    expect(
      pairingJoinRequestSchema.safeParse({ ...join, joinSecret: "short" })
        .success,
    ).toBe(false);
  });

  it("carries the invitation on a fresh start and omits it on a replay", () => {
    const started = {
      caFingerprint: "a".repeat(64),
      expiresAt: "2026-01-01T00:00:00.000Z",
      qrUri: "breev-pair://1/payload",
      sessionId: SESSION_ID,
    };
    expect(pairingSessionStartedSchema.parse(started)).toEqual(started);

    // The recorded idempotency result, and every replay answered from it. The
    // invitation carries the one-use join secret, so it is never written down
    // and the response is valid without it.
    const { qrUri, ...replayed } = started;
    expect(qrUri).toBe("breev-pair://1/payload");
    expect(pairingSessionStartedSchema.parse(replayed)).toEqual(replayed);
    expect(
      pairingSessionStartedSchema.safeParse({ ...replayed, qrUri: null })
        .success,
    ).toBe(false);
    expect(
      pairingSessionStartedSchema.safeParse({
        ...started,
        joinSecret: "leaked",
      }).success,
    ).toBe(false);
  });

  it("reports no seat usage at all when no licence is installed", () => {
    const devices = [
      {
        certNotAfter: "2027-01-01T00:00:00.000Z",
        connected: false,
        displayName: "Counter 1",
        id: SESSION_ID,
        pairedAt: "2026-01-01T00:00:00.000Z",
        revocationReason: null,
        revokedAt: null,
        seatReleasedAt: null,
      },
    ];
    expect(
      deviceInventorySchema.parse({ devices, seatUsage: null }).seatUsage,
    ).toBeNull();
    expect(
      deviceInventorySchema.parse({
        devices,
        seatUsage: { permitted: 3, used: 2 },
      }).seatUsage,
    ).toEqual({ permitted: 3, used: 2 });
    // Absent is not the same as unknown: the field is always present, and a
    // permitted count of zero is not a thing a licence can say.
    expect(deviceInventorySchema.safeParse({ devices }).success).toBe(false);
    expect(
      deviceInventorySchema.safeParse({
        devices,
        seatUsage: { permitted: 0, used: 0 },
      }).success,
    ).toBe(false);
  });

  it("exposes the comparison digits only while a terminal awaits confirmation", () => {
    expect(
      pairingSessionViewSchema.parse({
        state: "awaiting-confirmation",
        expiresAt: "2026-01-01T00:00:00.000Z",
        fingerprintDigits: "012345678901",
        qrV2Uri: "breev-pair://2/payload",
        sessionId: SESSION_ID,
        terminalName: "Counter 2",
      }),
    ).toMatchObject({ fingerprintDigits: "012345678901" });
    expect(
      pairingSessionViewSchema.safeParse({
        state: "open",
        caFingerprint: "a".repeat(64),
        expiresAt: "2026-01-01T00:00:00.000Z",
        qrUri: "breev-pair://1/payload",
        sessionId: SESSION_ID,
        fingerprintDigits: "012345678901",
      }).success,
    ).toBe(false);
    expect(
      pairingSessionViewSchema.safeParse({
        state: "awaiting-confirmation",
        expiresAt: "2026-01-01T00:00:00.000Z",
        fingerprintDigits: "01234567890",
        qrV2Uri: "breev-pair://2/payload",
        sessionId: SESSION_ID,
        terminalName: "Counter 2",
      }).success,
    ).toBe(false);
  });
});
