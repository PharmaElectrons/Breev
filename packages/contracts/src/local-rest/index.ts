import { z } from "zod";

export const LOCAL_API_VERSION = "4" as const;
export const LOCAL_SCHEMA_VERSION = "4" as const;
export const LOCAL_HEALTH_SUCCESS_STATUS = 200 as const;
export const LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS = 503 as const;
export const LOCAL_PROOF_EVIDENCE_SUCCESS_STATUS = 200 as const;
export const LOCAL_PROOF_MUTATION_SUCCESS_STATUS = 201 as const;
export const LOCAL_RECOVERY_STATUS_SUCCESS_STATUS = 200 as const;
export const LOCAL_RESTORE_QUARANTINE_STATUS = 503 as const;

export const BREEV_CSRF_HEADER = "X-Breev-CSRF" as const;
export const BREEV_CSRF_VALUE = "1" as const;
export const LOCAL_DEVICE_ID_HEADER = "X-Breev-Device-Id" as const;
export const LOCAL_DEVICE_SESSION_HEADER = "X-Breev-Device-Session" as const;

export const PHARMACY_ROLE_KEYS = [
  "owner",
  "manager",
  "pharmacist",
  "sales_employee",
  "purchasing_employee",
  "inventory_employee",
  "accountant",
  "support",
] as const;
export const FREE_CORE_CAPABILITY_NAMES = [
  "local-sales",
  "local-purchases",
  "local-inventory",
  "basic-accounting",
  "named-patient-table",
  "reports",
  "printing",
  "backup",
  "complete-export",
  "supported-restore",
  "renewal",
] as const;
export const PAID_CAPABILITY_NAMES = [
  "additional-device-pos",
  "ai-services",
  "crm-advanced-reports",
  "one-way-cloud-sync",
  "purchase-invoice-ocr",
  "whatsapp-messaging",
] as const;
export const CAPABILITY_NAMES = [
  ...FREE_CORE_CAPABILITY_NAMES,
  ...PAID_CAPABILITY_NAMES,
] as const;
export const capabilityNameSchema = z.enum(CAPABILITY_NAMES);
export const paidCapabilityNameSchema = z.enum(PAID_CAPABILITY_NAMES);
export const pharmacyRoleKeySchema = z.enum(PHARMACY_ROLE_KEYS);
export const permissionNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u)
  .max(96);
export const stepUpActionSchema = z.enum([
  "identity.role.permissions.update",
  "identity.user.create",
  "identity.user.update",
  "licensing.licence.deactivate",
  "licensing.licence.install",
]);

export const IDENTITY_DENIAL_CODES = [
  "attendance-already-checked-in",
  "attendance-already-checked-out",
  "attendance-disabled",
  "body-invalid",
  "bootstrap-already-complete",
  "bootstrap-required",
  "invalid-credentials",
  "identity-resource-not-found",
  "idempotency-conflict",
  "last-owner-required",
  "permission-denied",
  "rate-limit-exceeded",
  "session-expired",
  "session-missing",
  "session-revoked",
  "step-up-context-mismatch",
  "step-up-expired",
  "step-up-missing-permission",
  "step-up-not-approved",
  "step-up-reused",
  "step-up-stale",
  "step-up-wrong-password",
  "username-taken",
  "version-conflict",
] as const;
export const identityDenialCodeSchema = z.enum(IDENTITY_DENIAL_CODES);
export const identityDenialSchema = z.strictObject({
  status: z.literal("denied"),
  code: identityDenialCodeSchema,
  requestId: z.uuidv7(),
  requiredPermission: permissionNameSchema.optional(),
});

const usernameSchema = z
  .string()
  .min(3)
  .max(64)
  .refine((value) => value === value.trim());
const displayNameSchema = z
  .string()
  .min(1)
  .max(96)
  .refine((value) => value === value.trim());
const passwordSchema = z.string().min(15).max(128);
const decimalRevisionSchema = z.string().regex(/^[1-9]\d*$/u);
const identityCommandFields = {
  idempotencyKey: z.uuid(),
} as const;
export const identityResourceIdSchema = z.uuidv7();

export const identityUserSchema = z.strictObject({
  id: z.uuidv7(),
  displayName: displayNameSchema,
  username: usernameSchema,
  role: pharmacyRoleKeySchema,
  status: z.enum(["active", "locked"]),
  revision: decimalRevisionSchema,
});
export const pharmacySettingsSchema = z.strictObject({
  attendanceEnabled: z.boolean(),
  revision: decimalRevisionSchema,
});
const attendanceStateSchema = z.strictObject({
  status: z.enum(["checked-in", "checked-out"]),
  version: decimalRevisionSchema,
});
export const licenceSummarySchema = z.strictObject({
  formatVersion: z.literal(1),
  keyId: z.string().min(1).max(64),
  licenceId: z.uuidv7(),
  pharmacyId: z.uuidv7(),
  mainDeviceId: z.uuidv7(),
  plan: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
  features: z.array(paidCapabilityNameSchema),
  founderOverrideGrants: z.array(paidCapabilityNameSchema),
  permittedDeviceCount: z.number().int().min(1).max(10_000),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  graceEndsAt: z.iso.datetime(),
});
export const entitlementContextSchema = z.strictObject({
  status: z.enum([
    "licensed",
    "free-core",
    "invalid-licence",
    "expired",
    "clock-rollback",
  ]),
  capabilities: z.array(capabilityNameSchema),
  licence: licenceSummarySchema.nullable(),
});
const authenticatedStateSchema = z.strictObject({
  state: z.literal("authenticated"),
  pharmacy: z.strictObject({
    id: z.uuidv7(),
    name: z.string().min(1).max(160),
  }),
  user: identityUserSchema,
  session: z.strictObject({ id: z.uuidv7(), expiresAt: z.iso.datetime() }),
  allowedPermissions: z.array(permissionNameSchema),
  entitlement: entitlementContextSchema,
  settings: pharmacySettingsSchema,
  attendance: attendanceStateSchema.nullable(),
});
export const identityStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("bootstrap-required") }),
  z.strictObject({ state: z.literal("unauthenticated") }),
  z.strictObject({ state: z.literal("session-expired") }),
  z.strictObject({ state: z.literal("session-revoked") }),
  authenticatedStateSchema,
]);

export const identityBootstrapRequestSchema = z.strictObject({
  pharmacyName: z
    .string()
    .min(1)
    .max(160)
    .refine((value) => value === value.trim()),
  owner: z.strictObject({
    displayName: displayNameSchema,
    username: usernameSchema,
    password: passwordSchema,
  }),
});
export const identityLoginRequestSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});
export const identityLogoutRequestSchema = z.strictObject({});
export const identityStepUpCreateRequestSchema = z.strictObject({
  ...identityCommandFields,
  action: stepUpActionSchema,
  subjectId: z.uuidv7().optional(),
});
export const identityStepUpApproveRequestSchema = z.strictObject({
  ...identityCommandFields,
  password: z.string().min(1).max(128),
});
export const identityStepUpChallengeSchema = z.strictObject({
  id: z.uuidv7(),
  action: stepUpActionSchema,
  expiresAt: z.iso.datetime(),
  status: z.enum(["approved", "pending"]),
});
export const identityCreateUserRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  displayName: displayNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  role: pharmacyRoleKeySchema,
});
export const identityUpdateUserRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  expectedRevision: decimalRevisionSchema,
  role: pharmacyRoleKeySchema.optional(),
  status: z.enum(["active", "locked"]).optional(),
});
export const identityRoleSchema = z.strictObject({
  id: z.uuidv7(),
  key: pharmacyRoleKeySchema,
  revision: decimalRevisionSchema,
  grants: z.array(permissionNameSchema),
});
export const identityRolesSchema = z.strictObject({
  roles: z.array(identityRoleSchema).length(PHARMACY_ROLE_KEYS.length),
  permissions: z.array(permissionNameSchema),
});
export const identityUpdateRolePermissionsRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  expectedRevision: decimalRevisionSchema,
  permissions: z.array(permissionNameSchema).max(128),
});
export const pharmacySettingsUpdateRequestSchema = z.strictObject({
  ...identityCommandFields,
  attendanceEnabled: z.boolean(),
  expectedRevision: decimalRevisionSchema,
});
export const attendanceEventRequestSchema = z.strictObject({
  ...identityCommandFields,
  expectedVersion: decimalRevisionSchema,
  kind: z.enum(["check-in", "check-out"]),
});
export const attendanceEventSchema = z.strictObject({
  id: z.uuidv7(),
  kind: z.enum(["check-in", "check-out"]),
  occurredAt: z.iso.datetime(),
  status: z.enum(["checked-in", "checked-out"]),
  version: decimalRevisionSchema,
});

export const LICENSING_DENIAL_CODES = [
  "clock-rollback",
  "entitlement-denied",
  "idempotency-conflict",
  "licence-invalid",
] as const;
export const licensingDenialCodeSchema = z.enum(LICENSING_DENIAL_CODES);
export const licensingDenialSchema = z.strictObject({
  status: z.literal("denied"),
  code: licensingDenialCodeSchema,
  requestId: z.uuidv7(),
  requiredCapability: paidCapabilityNameSchema.optional(),
});
export const licenceInstallRequestSchema = z.strictObject({
  challengeId: z.uuidv7(),
  encodedLicence: z.string().min(1).max(6_000),
  idempotencyKey: z.uuid(),
});
export const licenceDeactivateRequestSchema = z.strictObject({
  challengeId: z.uuidv7(),
  idempotencyKey: z.uuid(),
});
export const capabilityProofRequestSchema = z.strictObject({
  capability: paidCapabilityNameSchema,
});
export const capabilityProofSuccessSchema = z.strictObject({
  status: z.literal("allowed"),
  capability: paidCapabilityNameSchema,
});

export const identityStateContract = {
  method: "GET",
  path: "/identity/state",
  responses: { 200: identityStateSchema },
} as const;
export const identityBootstrapContract = {
  method: "POST",
  path: "/identity/bootstrap",
  request: { body: identityBootstrapRequestSchema },
  responses: {
    201: authenticatedStateSchema,
    400: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const identityLoginContract = {
  method: "POST",
  path: "/identity/login",
  request: { body: identityLoginRequestSchema },
  responses: {
    200: authenticatedStateSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    409: identityDenialSchema,
    429: identityDenialSchema,
  },
} as const;
export const identityLogoutContract = {
  method: "POST",
  path: "/identity/logout",
  request: { body: identityLogoutRequestSchema },
  responses: { 204: z.undefined(), 401: identityDenialSchema },
} as const;
export const identityRolesContract = {
  method: "GET",
  path: "/identity/roles",
  responses: {
    200: identityRolesSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
  },
} as const;
export const identityUsersContract = {
  method: "GET",
  path: "/identity/users",
  responses: {
    200: z.strictObject({ users: z.array(identityUserSchema) }),
    401: identityDenialSchema,
    403: identityDenialSchema,
  },
} as const;
export const identityCreateUserContract = {
  method: "POST",
  path: "/identity/users",
  request: { body: identityCreateUserRequestSchema },
  responses: {
    201: identityUserSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const identityUpdateUserContract = {
  method: "PATCH",
  path: "/identity/users/:userId",
  request: { body: identityUpdateUserRequestSchema },
  responses: {
    200: identityUserSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
    404: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const identityUserPath = (userId: string): string =>
  `/identity/users/${userId}`;
export const identityStepUpCreateContract = {
  method: "POST",
  path: "/identity/step-up-challenges",
  request: { body: identityStepUpCreateRequestSchema },
  responses: {
    201: identityStepUpChallengeSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
    404: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const identityStepUpApprovePath = (challengeId: string): string =>
  `/identity/step-up-challenges/${challengeId}/approve`;
export const identityStepUpApproveContract = {
  method: "POST",
  path: "/identity/step-up-challenges/:challengeId/approve",
  request: { body: identityStepUpApproveRequestSchema },
  responses: {
    200: identityStepUpChallengeSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
    404: identityDenialSchema,
    409: identityDenialSchema,
    429: identityDenialSchema,
  },
} as const;
export const identityRolePermissionsPath = (roleId: string): string =>
  `/identity/roles/${roleId}/permissions`;
export const identityUpdateRolePermissionsContract = {
  method: "PUT",
  path: "/identity/roles/:roleId/permissions",
  request: { body: identityUpdateRolePermissionsRequestSchema },
  responses: {
    200: identityRoleSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
    404: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const pharmacySettingsContract = {
  method: "PATCH",
  path: "/pharmacy/settings",
  request: { body: pharmacySettingsUpdateRequestSchema },
  responses: {
    200: pharmacySettingsSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const attendanceEventContract = {
  method: "POST",
  path: "/attendance/events",
  request: { body: attendanceEventRequestSchema },
  responses: {
    201: attendanceEventSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const licenceInstallContract = {
  method: "POST",
  path: "/licensing/licences",
  request: { body: licenceInstallRequestSchema },
  responses: {
    201: entitlementContextSchema,
    400: z.union([identityDenialSchema, licensingDenialSchema]),
    401: identityDenialSchema,
    403: z.union([identityDenialSchema, licensingDenialSchema]),
    404: identityDenialSchema,
    409: z.union([identityDenialSchema, licensingDenialSchema]),
  },
} as const;
export const licenceDeactivateContract = {
  method: "POST",
  path: "/licensing/licence-deactivations",
  request: { body: licenceDeactivateRequestSchema },
  responses: {
    201: entitlementContextSchema,
    400: z.union([identityDenialSchema, licensingDenialSchema]),
    401: identityDenialSchema,
    403: z.union([identityDenialSchema, licensingDenialSchema]),
    404: identityDenialSchema,
    409: z.union([identityDenialSchema, licensingDenialSchema]),
  },
} as const;
export const capabilityProofContract = {
  method: "POST",
  path: "/licensing/capability-proof",
  request: { body: capabilityProofRequestSchema },
  responses: {
    200: capabilityProofSuccessSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: z.union([identityDenialSchema, licensingDenialSchema]),
  },
} as const;

export const localHealthQuerySchema = z.strictObject({});

const localHealthVersionFields = {
  apiVersion: z.literal(LOCAL_API_VERSION),
  schemaVersion: z.literal(LOCAL_SCHEMA_VERSION),
} as const;

export const localHealthSuccessSchema = z.strictObject({
  ...localHealthVersionFields,
  status: z.literal("healthy"),
  database: z.literal("available"),
});

export const localHealthDatabaseUnavailableSchema = z.strictObject({
  ...localHealthVersionFields,
  status: z.literal("degraded"),
  database: z.literal("unavailable"),
});

export const localHealthRepairRequiredSchema = z.strictObject({
  ...localHealthVersionFields,
  status: z.literal("repair-required"),
  repair: z.strictObject({
    code: z.literal("installation-state-invalid"),
  }),
});

export const localHealthContract = {
  method: "GET",
  path: "/health",
  request: {
    query: localHealthQuerySchema,
  },
  responses: {
    [LOCAL_HEALTH_SUCCESS_STATUS]: localHealthSuccessSchema,
    [LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS]: z.union([
      localHealthDatabaseUnavailableSchema,
      localHealthRepairRequiredSchema,
    ]),
  },
} as const;

export const LOCAL_SECURITY_DENIAL_CODES = [
  "binding-invalid",
  "binding-missing",
  "body-invalid",
  "cert-chain-invalid",
  "cert-expired",
  "cert-installation-mismatch",
  "cert-not-yet-valid",
  "cert-role-mismatch",
  "content-type-not-allowed",
  "cors-preflight-not-allowed",
  "csrf-header-missing",
  "device-revoked",
  "host-not-allowed",
  "mtls-cert-invalid",
  "mtls-cert-missing",
  "origin-not-allowed",
  "rate-limit-exceeded",
  "request-too-large",
  "session-binding-invalid",
  "tls-version-rejected",
] as const;

export const localSecurityDenialCodeSchema = z.enum(
  LOCAL_SECURITY_DENIAL_CODES,
);

export const localSecurityDenialSchema = z.strictObject({
  status: z.literal("denied"),
  code: localSecurityDenialCodeSchema,
  requestId: z.uuidv7(),
});

const nonNegativeIntegerStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u);

export const localProofMutationRequestSchema = z.strictObject({
  increment: z.literal(1),
});

export const localProofMutationSuccessSchema = z.strictObject({
  status: z.literal("committed"),
  mutationCount: nonNegativeIntegerStringSchema,
});

export const localProofEvidenceSuccessSchema = z.strictObject({
  mutationCount: nonNegativeIntegerStringSchema,
  recentDenialCount: nonNegativeIntegerStringSchema,
  denials: z
    .array(
      z.strictObject({
        code: localSecurityDenialCodeSchema,
        count: nonNegativeIntegerStringSchema,
      }),
    )
    .max(localSecurityDenialCodeSchema.options.length),
});

const localSecurityDenialResponses = {
  400: localSecurityDenialSchema,
  401: localSecurityDenialSchema,
  403: localSecurityDenialSchema,
  413: localSecurityDenialSchema,
  415: localSecurityDenialSchema,
  421: localSecurityDenialSchema,
  429: localSecurityDenialSchema,
} as const;

export const localProofMutationContract = {
  method: "POST",
  path: "/security/device-session-proof",
  request: {
    body: localProofMutationRequestSchema,
  },
  responses: {
    [LOCAL_PROOF_MUTATION_SUCCESS_STATUS]: localProofMutationSuccessSchema,
    ...localSecurityDenialResponses,
    401: z.union([localSecurityDenialSchema, identityDenialSchema]),
  },
} as const;

export const localProofEvidenceContract = {
  method: "GET",
  path: localProofMutationContract.path,
  responses: {
    [LOCAL_PROOF_EVIDENCE_SUCCESS_STATUS]: localProofEvidenceSuccessSchema,
    ...localSecurityDenialResponses,
  },
} as const;

export const recoveryPointStatusSchema = z.enum([
  "in_progress",
  "verified",
  "failed",
  "corrupted",
]);
export const recoveryBackupTypeSchema = z.enum([
  "hourly_recovery_point",
  "daily_snapshot",
]);

/** Privacy-safe recovery point metadata: no paths, hosts, or key material. */
export const recoveryPointSummarySchema = z.strictObject({
  backupType: recoveryBackupTypeSchema,
  completedAt: z.iso.datetime().nullable(),
  encryptedSizeBytes: z.number().int().nonnegative().nullable(),
  id: z.uuid(),
  manifestVerifiedAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime(),
  status: recoveryPointStatusSchema,
  walEndLsn: z.string().nullable(),
  walStartLsn: z.string().nullable(),
});

export const restoreQuarantineStateSchema = z.strictObject({
  clearedAt: z.iso.datetime().nullable(),
  isQuarantined: z.boolean(),
  quarantineReason: z.string().nullable(),
  quarantinedAt: z.iso.datetime().nullable(),
});

export const localRecoveryStatusSuccessSchema = z.strictObject({
  latestRecoveryPoint: recoveryPointSummarySchema.nullable(),
  quarantine: restoreQuarantineStateSchema,
});

/**
 * Every normal-use route answers with this body while the dataset is in
 * Restore Quarantine.
 */
export const localRestoreQuarantineDenialSchema = z.strictObject({
  code: z.literal("restore-quarantine"),
  quarantinedAt: z.iso.datetime().nullable(),
  reason: z.string().nullable(),
});

export const localRecoveryStatusContract = {
  method: "GET",
  path: "/recovery/status",
  responses: {
    [LOCAL_RECOVERY_STATUS_SUCCESS_STATUS]: localRecoveryStatusSuccessSchema,
    ...localSecurityDenialResponses,
  },
} as const;

export type LocalHealthSuccess = z.infer<typeof localHealthSuccessSchema>;
export type LocalHealthDatabaseUnavailable = z.infer<
  typeof localHealthDatabaseUnavailableSchema
>;
export type LocalHealthRepairRequired = z.infer<
  typeof localHealthRepairRequiredSchema
>;
export type LocalHealthResponse =
  | LocalHealthSuccess
  | LocalHealthDatabaseUnavailable
  | LocalHealthRepairRequired;
export type LocalHealthStatusCode = keyof typeof localHealthContract.responses;
export type LocalSecurityDenialCode = z.infer<
  typeof localSecurityDenialCodeSchema
>;
export type LocalSecurityDenial = z.infer<typeof localSecurityDenialSchema>;
export type LocalProofMutationRequest = z.infer<
  typeof localProofMutationRequestSchema
>;
export type LocalProofMutationSuccess = z.infer<
  typeof localProofMutationSuccessSchema
>;
export type LocalProofEvidenceSuccess = z.infer<
  typeof localProofEvidenceSuccessSchema
>;
export type PharmacyRoleKey = z.infer<typeof pharmacyRoleKeySchema>;
export type CapabilityName = z.infer<typeof capabilityNameSchema>;
export type PaidCapabilityName = z.infer<typeof paidCapabilityNameSchema>;
export type EntitlementContext = z.infer<typeof entitlementContextSchema>;
export type LicensingDenial = z.infer<typeof licensingDenialSchema>;
export type LicenceInstallRequest = z.infer<typeof licenceInstallRequestSchema>;
export type LicenceDeactivateRequest = z.infer<
  typeof licenceDeactivateRequestSchema
>;
export type CapabilityProofRequest = z.infer<
  typeof capabilityProofRequestSchema
>;
export type CapabilityProofSuccess = z.infer<
  typeof capabilityProofSuccessSchema
>;
export type StepUpAction = z.infer<typeof stepUpActionSchema>;
export type IdentityDenialCode = z.infer<typeof identityDenialCodeSchema>;
export type IdentityDenial = z.infer<typeof identityDenialSchema>;
export type IdentityUser = z.infer<typeof identityUserSchema>;
export type PharmacySettings = z.infer<typeof pharmacySettingsSchema>;
export type IdentityState = z.infer<typeof identityStateSchema>;
export type IdentityAuthenticatedState = z.infer<
  typeof authenticatedStateSchema
>;
export type IdentityBootstrapRequest = z.infer<
  typeof identityBootstrapRequestSchema
>;
export type IdentityLoginRequest = z.infer<typeof identityLoginRequestSchema>;
export type IdentityStepUpCreateRequest = z.infer<
  typeof identityStepUpCreateRequestSchema
>;
export type IdentityStepUpApproveRequest = z.infer<
  typeof identityStepUpApproveRequestSchema
>;
export type IdentityStepUpChallenge = z.infer<
  typeof identityStepUpChallengeSchema
>;
export type IdentityCreateUserRequest = z.infer<
  typeof identityCreateUserRequestSchema
>;
export type IdentityUpdateUserRequest = z.infer<
  typeof identityUpdateUserRequestSchema
>;
export type IdentityRole = z.infer<typeof identityRoleSchema>;
export type IdentityRoles = z.infer<typeof identityRolesSchema>;
export type IdentityUpdateRolePermissionsRequest = z.infer<
  typeof identityUpdateRolePermissionsRequestSchema
>;
export type PharmacySettingsUpdateRequest = z.infer<
  typeof pharmacySettingsUpdateRequestSchema
>;
export type AttendanceEventRequest = z.infer<
  typeof attendanceEventRequestSchema
>;
export type AttendanceEvent = z.infer<typeof attendanceEventSchema>;
export type RecoveryPointStatus = z.infer<typeof recoveryPointStatusSchema>;
export type RecoveryBackupType = z.infer<typeof recoveryBackupTypeSchema>;
export type RecoveryPointSummary = z.infer<typeof recoveryPointSummarySchema>;
export type RestoreQuarantineState = z.infer<
  typeof restoreQuarantineStateSchema
>;
export type LocalRecoveryStatusSuccess = z.infer<
  typeof localRecoveryStatusSuccessSchema
>;
export type LocalRestoreQuarantineDenial = z.infer<
  typeof localRestoreQuarantineDenialSchema
>;

export class LocalRestVersionMismatchError extends Error {
  public constructor(
    public readonly receivedApiVersion: string,
    public readonly receivedSchemaVersion: string,
  ) {
    super(
      `Local REST version mismatch: expected API ${LOCAL_API_VERSION} and schema ${LOCAL_SCHEMA_VERSION}, received API ${receivedApiVersion} and schema ${receivedSchemaVersion}`,
    );
    this.name = "LocalRestVersionMismatchError";
  }
}

export class LocalRestPayloadError extends Error {
  public constructor(public readonly statusCode: number) {
    super(`Local REST returned an invalid payload for status ${statusCode}`);
    this.name = "LocalRestPayloadError";
  }
}

export function parseLocalHealthResponse(
  statusCode: number,
  payload: unknown,
): LocalHealthResponse {
  throwOnVersionMismatch(payload);

  const schema =
    statusCode === LOCAL_HEALTH_SUCCESS_STATUS
      ? localHealthContract.responses[LOCAL_HEALTH_SUCCESS_STATUS]
      : statusCode === LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS
        ? localHealthContract.responses[
            LOCAL_HEALTH_DATABASE_UNAVAILABLE_STATUS
          ]
        : undefined;

  if (schema === undefined) {
    throw new LocalRestPayloadError(statusCode);
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new LocalRestPayloadError(statusCode);
  }

  return result.data;
}

export function parseLocalProofMutationResponse(
  statusCode: number,
  payload: unknown,
): LocalProofMutationSuccess | LocalSecurityDenial | IdentityDenial {
  if (statusCode === LOCAL_PROOF_MUTATION_SUCCESS_STATUS) {
    return parseContractResponse(
      statusCode,
      payload,
      localProofMutationSuccessSchema,
    );
  }
  if (statusCode === 401) {
    return parseContractResponse(
      statusCode,
      payload,
      localProofMutationContract.responses[401],
    );
  }
  if (isSecurityDenialStatus(statusCode)) {
    return parseContractResponse(
      statusCode,
      payload,
      localSecurityDenialSchema,
    );
  }
  throw new LocalRestPayloadError(statusCode);
}

export function parseLocalProofEvidenceResponse(
  statusCode: number,
  payload: unknown,
): LocalProofEvidenceSuccess | LocalSecurityDenial {
  if (statusCode === LOCAL_PROOF_EVIDENCE_SUCCESS_STATUS) {
    return parseContractResponse(
      statusCode,
      payload,
      localProofEvidenceSuccessSchema,
    );
  }
  if (isSecurityDenialStatus(statusCode)) {
    return parseContractResponse(
      statusCode,
      payload,
      localSecurityDenialSchema,
    );
  }
  throw new LocalRestPayloadError(statusCode);
}

export function parseLocalRecoveryStatusResponse(
  statusCode: number,
  payload: unknown,
): LocalRecoveryStatusSuccess | LocalSecurityDenial {
  if (statusCode === LOCAL_RECOVERY_STATUS_SUCCESS_STATUS) {
    return parseContractResponse(
      statusCode,
      payload,
      localRecoveryStatusSuccessSchema,
    );
  }
  if (isSecurityDenialStatus(statusCode)) {
    return parseContractResponse(
      statusCode,
      payload,
      localSecurityDenialSchema,
    );
  }
  throw new LocalRestPayloadError(statusCode);
}

function isSecurityDenialStatus(statusCode: number): boolean {
  return Object.hasOwn(localSecurityDenialResponses, statusCode);
}

function parseContractResponse<T>(
  statusCode: number,
  payload: unknown,
  schema: z.ZodType<T> | undefined,
): T {
  if (schema === undefined) {
    throw new LocalRestPayloadError(statusCode);
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new LocalRestPayloadError(statusCode);
  }
  return result.data;
}

function throwOnVersionMismatch(payload: unknown): void {
  if (!isRecord(payload)) {
    return;
  }

  const apiVersion = payload.apiVersion;
  const schemaVersion = payload.schemaVersion;
  if (typeof apiVersion !== "string" || typeof schemaVersion !== "string") {
    return;
  }

  if (
    apiVersion !== LOCAL_API_VERSION ||
    schemaVersion !== LOCAL_SCHEMA_VERSION
  ) {
    throw new LocalRestVersionMismatchError(apiVersion, schemaVersion);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
