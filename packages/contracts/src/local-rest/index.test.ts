import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  attendanceEventRequestSchema,
  catalogDenialCodeSchema,
  catalogDenialSchema,
  catalogMatchingApprovalRequestSchema,
  catalogMatchingBatchOpenRequestSchema,
  productBarcodeAddRequestSchema,
  productBarcodePrintRequestSchema,
  productBarcodeSuggestRequestSchema,
  productSearchRequestSchema,
  productSearchResponseSchema,
  productArchiveContract,
  productArchivePath,
  productArchiveRequestSchema,
  productCreateContract,
  productCreateRequestSchema,
  productDefinitionSchema,
  productPackagingSchema,
  productPricingInputSchema,
  productPricingSchema,
  productThirdUnitSchema,
  inventoryCapableUnitSchema,
  packageUnitRatioSchema,
  DEFAULT_PRODUCT_PRICING_METHOD,
  PRICE_ROUNDING_SETTINGS,
  PRODUCT_PRICING_FIELDS,
  PRODUCT_PRICING_FIELD_EDITABILITY,
  PRODUCT_PRICING_FIELD_STATES,
  PRODUCT_PRICING_METHODS,
  PRODUCT_UNIT_INTERFACES,
  productEditContract,
  productEditRequestSchema,
  productInstructionsSchema,
  productMergeContract,
  productMergePath,
  productMergeRequestSchema,
  productPath,
  productReadContract,
  productSchema,
  productStateColoursSchema,
  CATALOG_CONTRACTS,
  CATALOG_DENIAL_CODES,
  identityChangePasswordRequestSchema,
  identityCreateRoleContract,
  identityCreateRoleRequestSchema,
  identityCreateUserRequestSchema,
  identityRenameRoleContract,
  identityRenameRoleRequestSchema,
  identityResetUserPasswordRequestSchema,
  identityRolePath,
  identityRoleSchema,
  identityRolesSchema,
  identityStepUpApproveRequestSchema,
  identityStepUpCreateRequestSchema,
  identityUpdateRolePermissionsRequestSchema,
  identityUpdateUserRequestSchema,
  identityUserSchema,
  IMPLEMENTED_PERMISSION_NAMES,
  PHARMACY_ROLE_KEYS,
  PHARMACY_ROLE_DISPLAY_NAMES,
  deviceInventoryContract,
  deviceInventorySchema,
  deviceRevocationContract,
  deviceRevocationPath,
  deviceRevocationRequestSchema,
  devicesDenialSchema,
  entitlementContextSchema,
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
        roleId: COMMAND_ID,
        username: "new.user",
      },
    ],
    [
      identityCreateRoleRequestSchema,
      {
        challengeId: COMMAND_ID,
        idempotencyKey: COMMAND_ID,
        name: "Senior cashier",
        permissions: ["catalog.item.manage"],
      },
    ],
    [
      identityRenameRoleRequestSchema,
      {
        challengeId: COMMAND_ID,
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
        name: "Senior cashier",
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
      identityChangePasswordRequestSchema,
      {
        currentPassword: "current password",
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
        newPassword: "a sufficiently long replacement password",
      },
    ],
    [
      identityResetUserPasswordRequestSchema,
      {
        challengeId: COMMAND_ID,
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
        newPassword: "a sufficiently long reset password",
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

describe("identity role contracts", () => {
  const builtIn = {
    grants: ["attendance.record"],
    id: COMMAND_ID,
    key: "manager",
    kind: "built-in",
    revision: "1",
  };
  const custom = {
    grants: [],
    id: COMMAND_ID,
    kind: "custom",
    name: "Senior cashier",
    revision: "1",
  };

  it("carries a built-in role by key and a custom role by name, never both", () => {
    expect(identityRoleSchema.parse(builtIn)).toEqual(builtIn);
    expect(identityRoleSchema.parse(custom)).toEqual(custom);
    for (const malformed of [
      { ...builtIn, name: "Owner" },
      { ...custom, key: "owner" },
      { ...custom, kind: "built-in" },
      { ...builtIn, kind: "system" },
      { ...custom, name: "" },
      { ...custom, name: " Senior cashier" },
      { ...custom, name: "x".repeat(65) },
    ]) {
      expect(
        identityRoleSchema.safeParse(malformed).success,
        JSON.stringify(malformed),
      ).toBe(false);
    }
  });

  it("requires at least the eight built-in roles and accepts custom roles beyond them", () => {
    const eight = PHARMACY_ROLE_KEYS.map((key, index) => ({
      ...builtIn,
      id: `0198e7ce-7685-7000-8000-0000000000${String(index + 10)}`,
      key,
    }));
    expect(
      identityRolesSchema.safeParse({ permissions: [], roles: eight }).success,
    ).toBe(true);
    expect(
      identityRolesSchema.safeParse({
        permissions: [],
        roles: [...eight, custom],
      }).success,
    ).toBe(true);
    expect(
      identityRolesSchema.safeParse({ permissions: [], roles: eight.slice(1) })
        .success,
    ).toBe(false);
    const customOnly = PHARMACY_ROLE_KEYS.map((_, index) => ({
      ...custom,
      id: `0198e7ce-7685-7000-8000-0000000000${String(index + 20)}`,
      name: `Custom ${index + 1}`,
    }));
    expect(
      identityRolesSchema.safeParse({ permissions: [], roles: customOnly })
        .success,
    ).toBe(false);
    expect(
      identityRolesSchema.safeParse({
        permissions: [],
        roles: [
          ...eight,
          {
            ...eight[0],
            id: "0198e7ce-7685-7000-8000-000000000099",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("provides every trimmed built-in role name in both locales", () => {
    for (const locale of ["ar", "en"] as const) {
      expect(Object.keys(PHARMACY_ROLE_DISPLAY_NAMES[locale]).sort()).toEqual(
        [...PHARMACY_ROLE_KEYS].sort(),
      );
      for (const key of PHARMACY_ROLE_KEYS) {
        const name = PHARMACY_ROLE_DISPLAY_NAMES[locale][key];
        expect(name.length).toBeGreaterThan(0);
        expect(name).toBe(name.trim());
      }
    }
  });

  it("assigns a role to a user by id and never by key", () => {
    const create = {
      challengeId: COMMAND_ID,
      displayName: "New User",
      idempotencyKey: COMMAND_ID,
      password: "a sufficiently long private password",
      roleId: COMMAND_ID,
      username: "new.user",
    };
    expect(identityCreateUserRequestSchema.safeParse(create).success).toBe(
      true,
    );
    const { roleId, ...withoutRole } = create;
    expect(roleId).toBe(COMMAND_ID);
    expect(
      identityCreateUserRequestSchema.safeParse({
        ...withoutRole,
        role: "pharmacist",
      }).success,
    ).toBe(false);
    expect(
      identityUpdateUserRequestSchema.safeParse({
        challengeId: COMMAND_ID,
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
        role: "pharmacist",
      }).success,
    ).toBe(false);
    expect(
      identityUpdateUserRequestSchema.safeParse({
        challengeId: COMMAND_ID,
        expectedRevision: "1",
        idempotencyKey: COMMAND_ID,
        roleId: COMMAND_ID,
      }).success,
    ).toBe(true);
    const user = {
      displayName: "A User",
      id: COMMAND_ID,
      revision: "1",
      status: "active",
      username: "a.user",
    };
    expect(
      identityUserSchema.safeParse({ ...user, role: "owner" }).success,
    ).toBe(false);
    expect(
      identityUserSchema.parse({
        ...user,
        role: { id: COMMAND_ID, key: "owner", kind: "built-in" },
      }).role,
    ).toEqual({ id: COMMAND_ID, key: "owner", kind: "built-in" });
    expect(
      identityUserSchema.parse({
        ...user,
        role: { id: COMMAND_ID, kind: "custom", name: "Senior cashier" },
      }).role,
    ).toEqual({ id: COMMAND_ID, kind: "custom", name: "Senior cashier" });
  });

  it("names the role commands and their Step-Up actions", () => {
    expect(stepUpActionSchema.options).toContain("identity.role.create");
    expect(stepUpActionSchema.options).toContain("identity.role.rename");
    expect(stepUpActionSchema.options).toContain("purchase.return.post");
    expect(identityCreateRoleContract.method).toBe("POST");
    expect(identityCreateRoleContract.path).toBe("/identity/roles");
    expect(identityRenameRoleContract.method).toBe("PATCH");
    expect(identityRenameRoleContract.path).toBe("/identity/roles/:roleId");
    expect(identityRolePath(COMMAND_ID)).toBe(`/identity/roles/${COMMAND_ID}`);
  });
});

describe("local REST health contract", () => {
  it("publishes the migrated schema version and an unchanged REST surface", () => {
    expect(LOCAL_API_VERSION).toBe("17");
    expect(LOCAL_SCHEMA_VERSION).toBe("17");
    expect(IMPLEMENTED_PERMISSION_NAMES).toEqual([
      "attendance.record",
      "catalog.item.manage",
      "catalog.item.search",
      "devices.pair",
      "identity.roles.manage",
      "identity.users.manage",
      "inventory.batch_safety.manage",
      "inventory.counts.approve",
      "inventory.counts.record",
      "inventory.review",
      "inventory.valuation.view",
      "licensing.manage",
      "pharmacy.settings.manage",
      "purchases.adjustments.manage",
      "purchases.costs.view",
      "purchases.drafts.manage",
      "purchases.posted.view",
      "purchases.returns.manage",
      "suppliers.manage",
    ]);
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
    expect(stepUpActionSchema.options).toContain(
      "identity.user.password.reset",
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

  it("names the grace-period pairing refusal and the grace entitlement", () => {
    expect(DEVICES_DENIAL_CODES).toContain("pairing-grace-period");
    const licence = {
      formatVersion: 1,
      keyId: "test",
      licenceId: SESSION_ID,
      pharmacyId: SESSION_ID,
      mainDeviceId: SESSION_ID,
      plan: "professional",
      features: ["additional-device-pos"],
      founderOverrideGrants: [],
      permittedDeviceCount: 3,
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      graceEndsAt: "2027-01-08T00:00:00.000Z",
    };
    // Grace keeps the licence visible: the panel shows the signed grace end.
    expect(
      entitlementContextSchema.parse({
        status: "grace",
        capabilities: ["local-sales", "additional-device-pos"],
        licence,
      }).status,
    ).toBe("grace");
    expect(
      entitlementContextSchema.safeParse({
        status: "in-grace",
        capabilities: [],
        licence,
      }).success,
    ).toBe(false);
    expect(
      entitlementContextSchema.safeParse({
        status: "grace",
        capabilities: [],
        licence: null,
      }).success,
    ).toBe(false);
    expect(
      entitlementContextSchema.safeParse({
        status: "free-core",
        capabilities: [],
        licence,
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

const PRODUCT_ID = "0198e7ce-7685-7000-8000-0000000000c1";
const SURVIVOR_PRODUCT_ID = "0198e7ce-7685-7000-8000-0000000000c2";

const MEDICATION_DEFINITION = {
  mode: "medication",
  fields: {
    tradeName: "Panadol Extra",
    strength: "500 mg",
    dosageForm: "Tablet",
    manufacturer: "GSK",
  },
} as const;

const GENERAL_ITEM_DEFINITION = {
  mode: "general-item",
  fields: {
    company: "Nivea",
    subBrand: "Sun Protect",
    typeOfUse: "Sunscreen Lotion",
    property: "SPF 50",
    targetAudience: "Kids",
    size: "200 ml",
  },
} as const;

/**
 * One Inventory Unit, two larger package units, and a Third Unit that is
 * deliberately not reachable from any default: the strip is the base, a pack is
 * four strips, a carton is forty-eight, and a treatment day counts nothing.
 */
const PRODUCT_PACKAGING = {
  inventoryUnitName: "Strip",
  packageUnits: [
    { name: "Pack", baseUnitsPerPackage: "4" },
    { name: "Carton", baseUnitsPerPackage: "48" },
  ],
  thirdUnit: { name: "Treatment day" },
  defaultUnits: {
    count: { kind: "inventory-unit" },
    purchase: { kind: "package-unit", packageUnitName: "Pack" },
    sale: { kind: "inventory-unit" },
  },
} as const;

const PRODUCT_PRICING = {
  method: "by-price",
  retailPriceFils: "100000",
  wholesalePriceFils: null,
} as const;

const PRODUCT_ATTRIBUTES = {
  arabicSearchName: "بنادول إكسترا",
  barcodes: [{ kind: "product", value: "6221033000101" }],
  category: "Analgesics",
  definition: MEDICATION_DEFINITION,
  instructions: {
    usesPerDay: 3,
    usesPerWeek: null,
    usesPerMonth: null,
    foodTiming: "after-food",
  },
  packaging: PRODUCT_PACKAGING,
  pricing: PRODUCT_PRICING,
  scientificName: "Paracetamol",
  sharing: { externallyVisible: true, aiSharingAllowed: false },
  stateColours: { manual: "red", coldStorageRequired: false },
  stockLevels: { maximumLevel: null, minimumLevel: null, reorderPoint: null },
} as const;

const PRODUCT = {
  ...PRODUCT_ATTRIBUTES,
  barcodes: [
    {
      kind: "product",
      source: "provided",
      value: "6221033000101",
    },
  ],
  displayName: "Panadol Extra 500 mg Tablet GSK",
  id: PRODUCT_ID,
  mergedIntoProductId: null,
  nameTemplateVersion: 1,
  revision: "1",
  status: "active",
} as const;

describe("catalog product contracts", () => {
  it("accepts a create body in either definition mode", () => {
    const create = { ...PRODUCT_ATTRIBUTES, idempotencyKey: COMMAND_ID };
    expect(productCreateRequestSchema.parse(create)).toEqual(create);

    const generalItem = { ...create, definition: GENERAL_ITEM_DEFINITION };
    expect(productCreateRequestSchema.parse(generalItem)).toEqual(generalItem);
  });

  it("accepts an edit, an archive, and a merge command", () => {
    const edit = {
      ...PRODUCT_ATTRIBUTES,
      expectedRevision: "4",
      idempotencyKey: COMMAND_ID,
    };
    expect(productEditRequestSchema.parse(edit)).toEqual(edit);

    const archive = { expectedRevision: "4", idempotencyKey: COMMAND_ID };
    expect(productArchiveRequestSchema.parse(archive)).toEqual(archive);

    const merge = { ...archive, survivorProductId: SURVIVOR_PRODUCT_ID };
    expect(productMergeRequestSchema.parse(merge)).toEqual(merge);
  });

  it("makes free-text entry of the generated name impossible on every request", () => {
    // Not refused by a validation rule that could be relaxed: the field simply
    // is not part of any request shape, and the shapes are strict.
    for (const [schema, body] of [
      [
        productCreateRequestSchema,
        { ...PRODUCT_ATTRIBUTES, idempotencyKey: COMMAND_ID },
      ],
      [
        productEditRequestSchema,
        {
          ...PRODUCT_ATTRIBUTES,
          expectedRevision: "4",
          idempotencyKey: COMMAND_ID,
        },
      ],
    ] as const) {
      expect(schema.safeParse(body).success).toBe(true);
      expect(
        schema.safeParse({ ...body, displayName: "Anything At All" }).success,
      ).toBe(false);
      expect(
        schema.safeParse({ ...body, nameTemplateVersion: 1 }).success,
      ).toBe(false);
    }
  });

  it("owns no stock quantity, balance, or expiry anywhere in the family", () => {
    // Catalog does not own them, so there is no field for a route to write and
    // no field for a response to leak. Absence is the mechanism.
    const create = { ...PRODUCT_ATTRIBUTES, idempotencyKey: COMMAND_ID };
    for (const stockField of [
      "quantity",
      "stockBalance",
      "onHand",
      "inventoryBalance",
      "expiryDate",
      "expiresAt",
    ]) {
      expect(
        productCreateRequestSchema.safeParse({ ...create, [stockField]: 10 })
          .success,
        stockField,
      ).toBe(false);
      expect(
        productSchema.safeParse({ ...PRODUCT, [stockField]: 10 }).success,
        stockField,
      ).toBe(false);
    }
    expect(Object.keys(productSchema.shape)).not.toContain("quantity");
    expect(Object.keys(productSchema.shape)).not.toContain("expiryDate");
  });

  it("carries only the active mode's fields, so a mode switch cannot hold two field sets at once", () => {
    expect(
      productDefinitionSchema.safeParse({
        mode: "medication",
        fields: { ...MEDICATION_DEFINITION.fields, company: "Nivea" },
      }).success,
    ).toBe(false);
    expect(
      productDefinitionSchema.safeParse({
        mode: "general-item",
        fields: GENERAL_ITEM_DEFINITION.fields,
        medicationFields: MEDICATION_DEFINITION.fields,
      }).success,
    ).toBe(false);
  });

  it("requires the mandatory naming field and keeps every optional one explicitly present", () => {
    expect(
      productDefinitionSchema.safeParse({
        mode: "medication",
        fields: { ...MEDICATION_DEFINITION.fields, tradeName: "" },
      }).success,
    ).toBe(false);
    // Absent is not the same as unknown: an optional part is always sent, and
    // null is how the pharmacist says they left it empty.
    expect(
      productDefinitionSchema.parse({
        mode: "medication",
        fields: {
          tradeName: "Panadol Extra",
          strength: null,
          dosageForm: null,
          manufacturer: null,
        },
      }),
    ).toMatchObject({ fields: { strength: null } });
    expect(
      productDefinitionSchema.safeParse({
        mode: "medication",
        fields: { tradeName: "Panadol Extra" },
      }).success,
    ).toBe(false);
    expect(
      productDefinitionSchema.safeParse({
        mode: "medication",
        fields: { ...MEDICATION_DEFINITION.fields, strength: " 500 mg" },
      }).success,
    ).toBe(false);
  });

  it("reads a product back with its generated name, template version, and lifecycle", () => {
    expect(productSchema.parse(PRODUCT)).toEqual(PRODUCT);
    expect(
      productSchema.parse({
        ...PRODUCT,
        status: "merged",
        mergedIntoProductId: SURVIVOR_PRODUCT_ID,
      }),
    ).toMatchObject({ mergedIntoProductId: SURVIVOR_PRODUCT_ID });
    expect(
      productSchema.safeParse({ ...PRODUCT, nameTemplateVersion: 2 }).success,
    ).toBe(false);
  });

  it("treats the generated name as a label rather than an identity", () => {
    // Two legitimately distinct products may generate the same string.
    // Uniqueness belongs to the internal id, SKU, barcode, and registration
    // number, so nothing here refuses the duplicate.
    expect(
      productSchema.safeParse({ ...PRODUCT, id: SURVIVOR_PRODUCT_ID }).success,
    ).toBe(true);
  });

  it("persists the sharing controls as metadata and never as an authority", () => {
    const restricted = {
      ...PRODUCT,
      sharing: { externallyVisible: false, aiSharingAllowed: false },
    };
    expect(productSchema.parse(restricted).sharing).toEqual({
      externallyVisible: false,
      aiSharingAllowed: false,
    });
    // A permission or entitlement is what decides access, and neither is
    // expressible in this object.
    expect(Object.keys(productSchema.shape.sharing.shape)).toEqual([
      "externallyVisible",
      "aiSharingAllowed",
    ]);
  });

  it("exposes no delete, cleanup, or repair path in the whole family", () => {
    for (const contract of CATALOG_CONTRACTS) {
      expect(contract.method, contract.path).not.toBe("DELETE");
      expect(["GET", "POST", "PUT"], contract.path).toContain(contract.method);
      expect(contract.path, contract.path).not.toMatch(
        /delete|remove|purge|cleanup|repair|destroy/u,
      );
    }
    expect(CATALOG_CONTRACTS).toHaveLength(12);
    expect(Object.keys(productSchema.shape)).not.toContain("deleted");
    expect(Object.keys(productSchema.shape)).not.toContain("deletedAt");
  });

  it("builds every path the routes declare", () => {
    expect(productPath(PRODUCT_ID)).toBe(`/catalog/products/${PRODUCT_ID}`);
    expect(productArchivePath(PRODUCT_ID)).toBe(
      `/catalog/products/${PRODUCT_ID}/archivals`,
    );
    expect(productMergePath(PRODUCT_ID)).toBe(
      `/catalog/products/${PRODUCT_ID}/merges`,
    );
    expect(productReadContract.path).toBe(productPath(":productId"));
    expect(productEditContract.path).toBe("/catalog/products/:productId");
    expect(productArchiveContract.path).toBe(
      "/catalog/products/:productId/archivals",
    );
    expect(productMergeContract.path).toBe(
      "/catalog/products/:productId/merges",
    );
    expect(productCreateContract.path).toBe("/catalog/products");
  });

  it("answers a permission refusal with the identity family and its own refusals with the catalog family", () => {
    expect(productCreateContract.responses[403]).toBe(
      productEditContract.responses[403],
    );
    expect(
      productCreateContract.responses[401].safeParse({
        status: "denied",
        code: "permission-denied",
        requestId: PRODUCT_ID,
      }).success,
    ).toBe(true);
    expect(catalogDenialCodeSchema.safeParse("permission-denied").success).toBe(
      false,
    );
    expect(CATALOG_DENIAL_CODES).toContain("product-not-found");
    expect(CATALOG_DENIAL_CODES).toContain("version-conflict");
    expect(CATALOG_DENIAL_CODES).toContain("merge-into-self");
  });

  it("names the failing field so a screen can keep the value and the focus", () => {
    const denial = {
      code: "body-invalid",
      fieldErrors: [
        { code: "required", path: ["definition", "fields", "tradeName"] },
        { code: "too-long", path: ["barcodes", 0] },
      ],
      requestId: PRODUCT_ID,
      status: "denied",
    };
    expect(catalogDenialSchema.parse(denial)).toEqual(denial);
    expect(productCreateContract.responses[400].parse(denial)).toEqual(denial);

    // The list is always present, and empty for a denial that is not about a
    // field, so the renderer never has to distinguish absent from empty.
    expect(
      catalogDenialSchema.parse({
        code: "version-conflict",
        fieldErrors: [],
        requestId: PRODUCT_ID,
        status: "denied",
      }).fieldErrors,
    ).toEqual([]);
    expect(
      catalogDenialSchema.safeParse({
        code: "body-invalid",
        requestId: PRODUCT_ID,
        status: "denied",
      }).success,
    ).toBe(false);
    // A field error without a path names nothing and is refused.
    expect(
      catalogDenialSchema.safeParse({
        ...denial,
        fieldErrors: [{ code: "required", path: [] }],
      }).success,
    ).toBe(false);
    expect(
      catalogDenialSchema.safeParse({
        ...denial,
        fieldErrors: [{ code: "unsupported", path: ["category"] }],
      }).success,
    ).toBe(false);
  });

  it("stores item instructions and cold-storage state without a display surface", () => {
    expect(
      productInstructionsSchema.parse({
        usesPerDay: null,
        usesPerWeek: 2,
        usesPerMonth: null,
        foodTiming: "regardless-of-food",
      }),
    ).toMatchObject({ usesPerWeek: 2 });
    expect(
      productInstructionsSchema.safeParse({
        usesPerDay: 0,
        usesPerWeek: null,
        usesPerMonth: null,
        foodTiming: null,
      }).success,
    ).toBe(false);
    expect(
      productInstructionsSchema.safeParse({
        usesPerDay: 1.5,
        usesPerWeek: null,
        usesPerMonth: null,
        foodTiming: null,
      }).success,
    ).toBe(false);
    expect(
      productStateColoursSchema.parse({
        manual: null,
        coldStorageRequired: true,
      }),
    ).toEqual({ manual: null, coldStorageRequired: true });
  });

  it("stores no barcode, one barcode, or several", () => {
    const create = { ...PRODUCT_ATTRIBUTES, idempotencyKey: COMMAND_ID };
    expect(
      productCreateRequestSchema.parse({ ...create, barcodes: [] }).barcodes,
    ).toEqual([]);
    expect(
      productCreateRequestSchema.parse({
        ...create,
        barcodes: [
          { kind: "product", value: "6221033000101" },
          { kind: "package", value: "6221033000118" },
        ],
      }).barcodes,
    ).toHaveLength(2);
    expect(
      productCreateRequestSchema.safeParse({
        ...create,
        barcodes: [{ kind: "product", value: "" }],
      }).success,
    ).toBe(false);
  });
});

describe("catalog search, barcode, and matching contracts", () => {
  it("validates one reusable search request and response shape", () => {
    expect(
      productSearchRequestSchema.parse({ limit: "50", query: "panadol gs" }),
    ).toEqual({ limit: "50", query: "panadol gs" });
    expect(
      productSearchResponseSchema.parse({
        hasMore: false,
        query: "6221033000101",
        resultCount: 1,
        results: [
          {
            matchedBarcode: PRODUCT.barcodes[0],
            matchedField: "barcode",
            product: PRODUCT,
          },
        ],
      }).results[0]?.product.id,
    ).toBe(PRODUCT_ID);
    const invalid = productSearchRequestSchema.safeParse({
      limit: "0",
      query: " panadol ",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining([["limit"], ["query"]]),
      );
    }
  });

  it("returns field paths for invalid add, suggest, print, and approval commands", () => {
    const invalidInputs = [
      [
        productBarcodeAddRequestSchema,
        {
          barcode: { kind: "unit", value: "" },
          expectedRevision: "0",
          idempotencyKey: "not-a-uuid",
        },
      ],
      [
        productBarcodeSuggestRequestSchema,
        {
          expectedRevision: "1",
          idempotencyKey: COMMAND_ID,
          kind: "unit",
        },
      ],
      [
        productBarcodePrintRequestSchema,
        {
          barcode: "6221033000101",
          idempotencyKey: COMMAND_ID,
          locale: "en",
          quantity: 0,
        },
      ],
      [
        catalogMatchingApprovalRequestSchema,
        { expectedRevision: "0", idempotencyKey: COMMAND_ID },
      ],
    ] as const;
    for (const [schema, value] of invalidInputs) {
      const parsed = schema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.every(({ path }) => path.length > 0)).toBe(
          true,
        );
      }
    }
    expect(
      catalogMatchingBatchOpenRequestSchema.parse({
        idempotencyKey: COMMAND_ID,
      }),
    ).toEqual({ idempotencyKey: COMMAND_ID });
  });
});

describe("catalog packaging contracts", () => {
  it("carries every product create and edit body and every product read", () => {
    const create = { ...PRODUCT_ATTRIBUTES, idempotencyKey: COMMAND_ID };
    expect(productCreateRequestSchema.parse(create).packaging).toEqual(
      PRODUCT_PACKAGING,
    );
    expect(
      productEditRequestSchema.parse({
        ...create,
        expectedRevision: "4",
      }).packaging,
    ).toEqual(PRODUCT_PACKAGING);
    expect(productSchema.parse(PRODUCT).packaging).toEqual(PRODUCT_PACKAGING);

    // Packaging is product-specific, so a product cannot be defined without it.
    const withoutPackaging: Record<string, unknown> = { ...create };
    delete withoutPackaging.packaging;
    expect(productCreateRequestSchema.safeParse(withoutPackaging).success).toBe(
      false,
    );
  });

  it("names one Inventory Unit and zero or more larger package units", () => {
    expect(
      productPackagingSchema.parse({
        ...PRODUCT_PACKAGING,
        packageUnits: [],
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "inventory-unit" },
          sale: { kind: "inventory-unit" },
        },
      }).packageUnits,
    ).toEqual([]);
    expect(
      Object.keys(productPackagingSchema.shape.inventoryUnitName.def),
    ).toBeDefined();
    // There is exactly one base unit and it is a single name, so no product can
    // declare two competing units for the inventory ledger to record.
    expect(
      productPackagingSchema.safeParse({
        ...PRODUCT_PACKAGING,
        inventoryUnitName: ["Strip", "Tablet"],
      }).success,
    ).toBe(false);
  });

  it("requires every package ratio to be an explicit positive integer", () => {
    for (const ratio of ["0", "-4", "4.5", "04", "1e3", " 4", "", "٤"]) {
      expect(
        productPackagingSchema.safeParse({
          ...PRODUCT_PACKAGING,
          packageUnits: [{ name: "Pack", baseUnitsPerPackage: ratio }],
          defaultUnits: {
            ...PRODUCT_PACKAGING.defaultUnits,
            purchase: { kind: "inventory-unit" },
          },
        }).success,
        ratio,
      ).toBe(false);
    }
    expect(
      productPackagingSchema.parse({
        ...PRODUCT_PACKAGING,
        packageUnits: [{ name: "Pack", baseUnitsPerPackage: "1" }],
      }).packageUnits[0]?.baseUnitsPerPackage,
    ).toBe("1");
  });

  it("gives each interface its own default, and only an inventory-capable unit can be one", () => {
    expect(
      Object.keys(productPackagingSchema.shape.defaultUnits.shape),
    ).toEqual([...PRODUCT_UNIT_INTERFACES]);
    expect(
      productPackagingSchema.parse(PRODUCT_PACKAGING).defaultUnits,
    ).toEqual(PRODUCT_PACKAGING.defaultUnits);

    // A default may only be the base unit or one of this product's packages.
    // "Third unit" is not one of the shapes, so no interface default can name
    // the follow-up unit however it is spelled.
    expect(
      inventoryCapableUnitSchema.safeParse({ kind: "third-unit" }).success,
    ).toBe(false);
    expect(
      inventoryCapableUnitSchema.safeParse({
        kind: "package-unit",
        packageUnitName: "Pack",
        baseUnitsPerPackage: "4",
      }).success,
    ).toBe(false);
    expect(
      productPackagingSchema.safeParse({
        ...PRODUCT_PACKAGING,
        defaultUnits: {
          ...PRODUCT_PACKAGING.defaultUnits,
          sale: { kind: "package-unit", packageUnitName: "Bundle" },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps the Third Unit separate, optional, and unable to convert anything", () => {
    const packaging = productPackagingSchema.parse(PRODUCT_PACKAGING);
    expect(packaging.thirdUnit).toEqual({ name: "Treatment day" });
    expect(
      productPackagingSchema.parse({ ...PRODUCT_PACKAGING, thirdUnit: null })
        .thirdUnit,
    ).toBeNull();

    // It carries a name and nothing else: no ratio exists for a stock-affecting
    // conversion to reach for, and it is not in the package list.
    expect(Object.keys(productThirdUnitSchema.shape)).toEqual(["name"]);
    expect(
      productPackagingSchema.safeParse({
        ...PRODUCT_PACKAGING,
        thirdUnit: { name: "Treatment day", baseUnitsPerPackage: "30" },
      }).success,
    ).toBe(false);
  });

  it("refuses a unit name that would make a conversion ambiguous", () => {
    for (const packaging of [
      { ...PRODUCT_PACKAGING, inventoryUnitName: "Pack" },
      {
        ...PRODUCT_PACKAGING,
        packageUnits: [
          { name: "Pack", baseUnitsPerPackage: "4" },
          { name: "Pack", baseUnitsPerPackage: "48" },
        ],
      },
      { ...PRODUCT_PACKAGING, thirdUnit: { name: "Pack" } },
      { ...PRODUCT_PACKAGING, thirdUnit: { name: "Strip" } },
    ]) {
      expect(productPackagingSchema.safeParse(packaging).success).toBe(false);
    }
    expect(
      productPackagingSchema.safeParse({
        ...PRODUCT_PACKAGING,
        inventoryUnitName: " Strip",
      }).success,
    ).toBe(false);
  });
});

describe("catalog pricing contracts", () => {
  const BY_PERCENTAGE_INPUT = {
    method: "by-percentage",
    marginPercentage: "20",
    rounding: "nearest-250-iqd",
    wholesalePriceFils: "90000",
    costFils: "80000",
  } as const;

  it("carries pricing on every product create and edit body and every product read", () => {
    const create = { ...PRODUCT_ATTRIBUTES, idempotencyKey: COMMAND_ID };
    expect(productCreateRequestSchema.parse(create).pricing).toEqual(
      PRODUCT_PRICING,
    );
    expect(
      productEditRequestSchema.parse({ ...create, expectedRevision: "4" })
        .pricing,
    ).toEqual(PRODUCT_PRICING);
    expect(productSchema.parse(PRODUCT).pricing).toEqual(PRODUCT_PRICING);

    const withoutPricing: Record<string, unknown> = { ...create };
    delete withoutPricing.pricing;
    expect(productCreateRequestSchema.safeParse(withoutPricing).success).toBe(
      false,
    );
  });

  it("defaults to By Price", () => {
    expect(DEFAULT_PRODUCT_PRICING_METHOD).toBe("by-price");
    expect(PRODUCT_PRICING_METHODS).toContain(DEFAULT_PRODUCT_PRICING_METHOD);
    expect(PRODUCT_PRICING_METHODS).toEqual(["by-percentage", "by-price"]);
  });

  it("publishes field editability as data rather than as a rule each caller repeats", () => {
    expect(PRODUCT_PRICING_FIELD_EDITABILITY).toEqual({
      "by-price": {
        marginPercentage: "unavailable",
        retailPrice: "editable",
        wholesalePrice: "editable",
      },
      "by-percentage": {
        marginPercentage: "editable",
        retailPrice: "locked",
        wholesalePrice: "editable",
      },
    });

    // Every method and every field has a state, so a purchase row asking about
    // any pair gets an answer instead of undefined.
    for (const method of PRODUCT_PRICING_METHODS) {
      for (const field of PRODUCT_PRICING_FIELDS) {
        expect(PRODUCT_PRICING_FIELD_STATES, `${method}.${field}`).toContain(
          PRODUCT_PRICING_FIELD_EDITABILITY[method][field],
        );
      }
    }
  });

  it("keeps the percentage out of By Price and the retail price out of a By Percentage request", () => {
    const byPrice = {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: null,
    };
    expect(productPricingInputSchema.parse(byPrice)).toEqual(byPrice);
    expect(
      productPricingInputSchema.safeParse({
        ...byPrice,
        marginPercentage: "20",
      }).success,
    ).toBe(false);

    expect(productPricingInputSchema.parse(BY_PERCENTAGE_INPUT)).toEqual(
      BY_PERCENTAGE_INPUT,
    );
    // The retail price is the server's consequence of cost and margin, so the
    // manual field is absent from the request rather than refused by a rule.
    expect(
      productPricingInputSchema.safeParse({
        ...BY_PERCENTAGE_INPUT,
        retailPriceFils: "100000",
      }).success,
    ).toBe(false);

    // The approved cost is the calculation input the server needs to produce
    // an initial retail price, so a By Percentage request without it is
    // refused rather than silently calculating from nothing.
    const withoutCost: Record<string, unknown> = { ...BY_PERCENTAGE_INPUT };
    delete withoutCost.costFils;
    expect(productPricingInputSchema.safeParse(withoutCost).success).toBe(
      false,
    );
    // A By Price request calculates nothing, so it never carries a cost.
    expect(
      productPricingInputSchema.safeParse({ ...byPrice, costFils: "80000" })
        .success,
    ).toBe(false);

    // It is read back, because the pharmacist still has to see the price. The
    // cost stays transient calculation input: the server never stores or
    // returns it, so it is absent from the read-back shape.
    const byPercentageWithoutCost: Record<string, unknown> = {
      ...BY_PERCENTAGE_INPUT,
    };
    delete byPercentageWithoutCost.costFils;
    const read = { ...byPercentageWithoutCost, retailPriceFils: "100000" };
    expect(productPricingSchema.parse(read)).toEqual(read);
    expect(
      productPricingSchema.safeParse({ ...read, costFils: "80000" }).success,
    ).toBe(false);
    expect(productPricingSchema.safeParse(BY_PERCENTAGE_INPUT).success).toBe(
      false,
    );
  });

  it("refuses an impossible margin on the selling price", () => {
    for (const margin of [
      "100",
      "100.000000",
      "120",
      "-20",
      "-0.5",
      "20.0000001",
      "020",
      "20.",
      ".2",
      "2e1",
      " 20",
      "",
      "٢٠",
    ]) {
      expect(
        productPricingInputSchema.safeParse({
          ...BY_PERCENTAGE_INPUT,
          marginPercentage: margin,
        }).success,
        margin,
      ).toBe(false);
    }
    for (const margin of ["0", "20", "20.5", "99.999999", "0.000001"]) {
      expect(
        productPricingInputSchema.safeParse({
          ...BY_PERCENTAGE_INPUT,
          marginPercentage: margin,
        }).success,
        margin,
      ).toBe(true);
    }
  });

  it("carries retail and optional wholesale prices as canonical decimal integer fils", () => {
    expect(
      productPricingInputSchema.parse({
        method: "by-price",
        retailPriceFils: "0",
        wholesalePriceFils: "1",
      }),
    ).toMatchObject({ retailPriceFils: "0", wholesalePriceFils: "1" });
    // The wholesale/special price lives in the item record and may be absent.
    expect(
      productPricingInputSchema.parse({
        ...BY_PERCENTAGE_INPUT,
        wholesalePriceFils: null,
      }).wholesalePriceFils,
    ).toBeNull();

    for (const price of ["-1", "1.5", "01", "1e3", " 1", "", "1,000", "١"]) {
      expect(
        productPricingInputSchema.safeParse({
          method: "by-price",
          retailPriceFils: price,
          wholesalePriceFils: null,
        }).success,
        price,
      ).toBe(false);
    }
    expect(
      productPricingInputSchema.safeParse({
        method: "by-price",
        retailPriceFils: "9223372036854775807",
        wholesalePriceFils: null,
      }).success,
    ).toBe(true);
    expect(
      productPricingInputSchema.safeParse({
        method: "by-price",
        retailPriceFils: "9223372036854775808",
        wholesalePriceFils: null,
      }).success,
    ).toBe(false);
  });

  it("carries the rounding setting the calculated price was derived under", () => {
    expect(PRICE_ROUNDING_SETTINGS).toEqual([
      "nearest-1000-iqd",
      "nearest-250-iqd",
      "nearest-500-iqd",
      "off",
    ]);
    for (const rounding of PRICE_ROUNDING_SETTINGS) {
      expect(
        productPricingInputSchema.parse({ ...BY_PERCENTAGE_INPUT, rounding }),
        rounding,
      ).toEqual({ ...BY_PERCENTAGE_INPUT, rounding });
    }
    expect(
      productPricingInputSchema.safeParse({
        ...BY_PERCENTAGE_INPUT,
        rounding: "nearest-100-iqd",
      }).success,
    ).toBe(false);

    // By Price calculates nothing, so there is nothing for a rounding setting
    // to act on and no field to set one.
    expect(
      productPricingInputSchema.safeParse({
        method: "by-price",
        retailPriceFils: "100000",
        wholesalePriceFils: null,
        rounding: "off",
      }).success,
    ).toBe(false);
  });
});

/**
 * Collects the JSON-pointer path of every node in a schema that would carry a
 * JSON number. Reading the published JSON Schema rather than the runtime checks
 * proves the shape as an outside caller sees it, so a numeric field cannot hide
 * behind a union branch, an array item, or a nullable wrapper.
 */
function numericNodePaths(schema: z.ZodType): readonly string[] {
  const found: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        visit(item, `${path}/${index}`);
      }
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const declared = record["type"];
    const types = Array.isArray(declared) ? declared : [declared];
    if (types.includes("number") || types.includes("integer")) {
      found.push(path);
    }
    for (const [key, value] of Object.entries(record)) {
      visit(value, `${path}/${key}`);
    }
  };
  visit(z.toJSONSchema(schema), "");
  return found;
}

describe("catalog authoritative quantity and money values", () => {
  it("puts no JSON number anywhere a quantity or an amount crosses the wire", () => {
    for (const [label, schema] of [
      ["packaging", productPackagingSchema],
      ["pricing input", productPricingInputSchema],
      ["pricing", productPricingSchema],
    ] as const) {
      expect(numericNodePaths(schema), label).toEqual([]);
    }

    // In the whole Product family the only numeric nodes left are the ones that
    // carry neither money nor an inventory quantity: how often an item is used,
    // and which approved naming template generated its display name.
    for (const [label, schema] of [
      ["create", productCreateRequestSchema],
      ["edit", productEditRequestSchema],
      ["product", productSchema],
    ] as const) {
      for (const path of numericNodePaths(schema)) {
        expect(path, `${label}${path}`).toMatch(
          /^\/properties\/(?:instructions\/|nameTemplateVersion)/u,
        );
      }
    }
  });

  it("refuses an authoritative value that arrives as a JS number", () => {
    expect(
      productPricingInputSchema.safeParse({
        method: "by-price",
        retailPriceFils: 100_000,
        wholesalePriceFils: null,
      }).success,
    ).toBe(false);
    expect(
      productPricingInputSchema.safeParse({
        method: "by-percentage",
        marginPercentage: 20,
        rounding: "off",
        wholesalePriceFils: null,
        costFils: "80000",
      }).success,
    ).toBe(false);
    expect(
      productPricingInputSchema.safeParse({
        method: "by-percentage",
        marginPercentage: "20",
        rounding: "off",
        wholesalePriceFils: null,
        costFils: 80_000,
      }).success,
    ).toBe(false);
    expect(
      productPackagingSchema.safeParse({
        ...PRODUCT_PACKAGING,
        packageUnits: [{ name: "Pack", baseUnitsPerPackage: 4 }],
      }).success,
    ).toBe(false);
  });

  it("accepts exactly one spelling of every package ratio it accepts at all", () => {
    // A deterministic sweep rather than a random one: the same ratios are
    // checked on every run, so a failure names a value that can be reproduced.
    for (let ratio = 1n; ratio <= 4_096n; ratio *= 2n) {
      for (const candidate of [ratio, ratio + 1n, ratio - 1n]) {
        const canonical = candidate.toString(10);
        const expected = candidate >= 1n;
        expect(
          packageUnitRatioSchema.safeParse(canonical).success,
          canonical,
        ).toBe(expected);
        for (const alternative of [
          `0${canonical}`,
          `+${canonical}`,
          `${canonical}.0`,
          ` ${canonical}`,
        ]) {
          expect(
            packageUnitRatioSchema.safeParse(alternative).success,
            alternative,
          ).toBe(false);
        }
      }
    }
    expect(
      packageUnitRatioSchema.safeParse("9223372036854775807").success,
    ).toBe(true);
    expect(
      packageUnitRatioSchema.safeParse("9223372036854775808").success,
    ).toBe(false);
  });
});
