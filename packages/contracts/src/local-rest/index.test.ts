import { describe, expect, it } from "vitest";

import {
  attendanceEventRequestSchema,
  catalogDenialCodeSchema,
  catalogDenialSchema,
  productArchiveContract,
  productArchivePath,
  productArchiveRequestSchema,
  productCreateContract,
  productCreateRequestSchema,
  productDefinitionSchema,
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
  identityCreateUserRequestSchema,
  identityResetUserPasswordRequestSchema,
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

describe("local REST health contract", () => {
  it("publishes the migrated schema version and an unchanged REST surface", () => {
    expect(LOCAL_API_VERSION).toBe("8");
    expect(LOCAL_SCHEMA_VERSION).toBe("8");
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

const PRODUCT_ATTRIBUTES = {
  arabicSearchName: "بنادول إكسترا",
  barcodes: ["6221033000101"],
  category: "Analgesics",
  definition: MEDICATION_DEFINITION,
  instructions: {
    usesPerDay: 3,
    usesPerWeek: null,
    usesPerMonth: null,
    foodTiming: "after-food",
  },
  scientificName: "Paracetamol",
  sharing: { externallyVisible: true, aiSharingAllowed: false },
  stateColours: { manual: "red", coldStorageRequired: false },
} as const;

const PRODUCT = {
  ...PRODUCT_ATTRIBUTES,
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
    expect(CATALOG_CONTRACTS).toHaveLength(6);
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
        barcodes: ["6221033000101", "6221033000118"],
      }).barcodes,
    ).toHaveLength(2);
    expect(
      productCreateRequestSchema.safeParse({ ...create, barcodes: [""] })
        .success,
    ).toBe(false);
  });
});
