import { z } from "zod";

export const LOCAL_API_VERSION = "5" as const;
export const LOCAL_SCHEMA_VERSION = "6" as const;
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
  "devices.pairing.start",
  "devices.revoke",
  "devices.seat.release.request",
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

/**
 * The two families that can refuse an authenticated request at 403.
 *
 * A permission decision is an identity fact. An Additional POS Terminal
 * additionally has to be permitted to operate at all: every request it makes is
 * checked against the currently installed licence, and one that no longer
 * carries `additional-device-pos` is refused with `entitlement-denied` and the
 * capability it lacked. The Main Pharmacy Computer never meets that refusal —
 * it is the device Free Core is defined around.
 */
const identityOrEntitlementDenialSchema = z.union([
  identityDenialSchema,
  licensingDenialSchema,
]);

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
    403: identityOrEntitlementDenialSchema,
    409: identityDenialSchema,
    429: identityDenialSchema,
  },
} as const;
export const identityLogoutContract = {
  method: "POST",
  path: "/identity/logout",
  request: { body: identityLogoutRequestSchema },
  responses: {
    204: z.undefined(),
    401: identityDenialSchema,
    403: identityOrEntitlementDenialSchema,
  },
} as const;
export const identityRolesContract = {
  method: "GET",
  path: "/identity/roles",
  responses: {
    200: identityRolesSchema,
    401: identityDenialSchema,
    403: identityOrEntitlementDenialSchema,
  },
} as const;
export const identityUsersContract = {
  method: "GET",
  path: "/identity/users",
  responses: {
    200: z.strictObject({ users: z.array(identityUserSchema) }),
    401: identityDenialSchema,
    403: identityOrEntitlementDenialSchema,
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
    403: identityOrEntitlementDenialSchema,
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
    403: identityOrEntitlementDenialSchema,
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
    403: identityOrEntitlementDenialSchema,
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
    403: identityOrEntitlementDenialSchema,
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
    403: identityOrEntitlementDenialSchema,
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
    403: identityOrEntitlementDenialSchema,
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
    403: identityOrEntitlementDenialSchema,
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

/**
 * Terminal pairing, seat allocation, and revocation.
 *
 * Two transports carry this family. The Main-side routes run on the loopback
 * listener behind the Main device binding and an authenticated identity
 * session. The `/pairing/*` routes run only on the LAN listener, ahead of the
 * mTLS boundary, because a terminal that has no certificate yet is exactly the
 * caller they exist for.
 */
export const DEVICES_DENIAL_CODES = [
  "body-invalid",
  "device-not-found",
  "device-not-revoked",
  "pairing-attempts-exceeded",
  "pairing-entitlement-missing",
  "pairing-seat-unavailable",
  "pairing-session-conflict",
  "pairing-session-expired",
  "pairing-session-missing",
  "pairing-session-replayed",
  "pairing-signature-invalid",
  "rate-limit-exceeded",
  "seat-release-approver-invalid",
  "seat-release-request-invalid",
] as const;
export const devicesDenialCodeSchema = z.enum(DEVICES_DENIAL_CODES);
export const devicesDenialSchema = z.strictObject({
  status: z.literal("denied"),
  code: devicesDenialCodeSchema,
  requestId: z.uuidv7(),
});

export const PAIRING_INVITATION_PREFIX = "breev-pair://1/" as const;
export const PAIRING_BINDING_PREFIX = "breev-pair://2/" as const;
export const PAIRING_JOIN_SECRET_BYTES = 32 as const;
export const PAIRING_SESSION_LIFETIME_SECONDS = 300 as const;
export const PAIRING_MAX_JOIN_ATTEMPTS = 5 as const;
export const PAIRING_FINGERPRINT_DIGITS = 12 as const;

export const PAIRING_SESSION_STATES = [
  "awaiting-confirmation",
  "cancelled",
  "confirmed",
  "expired",
  "failed",
  "open",
] as const;
export const pairingSessionStateNameSchema = z.enum(PAIRING_SESSION_STATES);
export const pairingCancellationReasonSchema = z.enum([
  "fingerprint-mismatch",
  "user-cancelled",
]);
export const pairingFailureReasonSchema = z.enum(["excess-attempts"]);

const certificateFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const certificatePemSchema = z.string().min(1).max(16_384);
const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u);
/**
 * Transcript signatures travel as standard base64. The join secret keeps the
 * base64url form it has inside the QR, so neither value has to be re-encoded
 * on its way through a URI or a JSON body.
 */
const base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u);
const deviceDisplayNameSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value === value.trim());
const revocationReasonSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim());
const pairingFingerprintDigitsSchema = z.string().regex(/^\d{12}$/u);
const pairingInvitationUriSchema = z
  .string()
  .min(PAIRING_INVITATION_PREFIX.length + 1)
  .max(2_048)
  .startsWith(PAIRING_INVITATION_PREFIX);
const pairingBindingUriSchema = z
  .string()
  .min(PAIRING_BINDING_PREFIX.length + 1)
  .max(2_048)
  .startsWith(PAIRING_BINDING_PREFIX);

export const pairingSessionStartRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  stepUpChallengeId: z.uuidv7(),
});
/**
 * `qrUri` carries the one-use join secret, so it is the one field of this
 * response that is never written down. A fresh start returns it, straight from
 * the invitation the Main just minted. A replay of the same idempotency key
 * answers from the recorded result, which was stored without it, so no
 * recoverable invitation ever sits in the database. The Main screen falls back
 * to `GET /devices/pairing-sessions/current`, which serves the invitation from
 * this process's bounded memory for as long as the session is open.
 */
export const pairingSessionStartedSchema = z.strictObject({
  caFingerprint: certificateFingerprintSchema,
  expiresAt: z.iso.datetime(),
  qrUri: pairingInvitationUriSchema.optional(),
  sessionId: z.uuidv7(),
});
/**
 * The Main screen renders exactly one of these. `awaiting-confirmation` is the
 * only member that carries the twelve comparison digits and the binding QR,
 * because they exist only once the terminal has proposed a key.
 */
export const pairingSessionViewSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("none") }),
  z.strictObject({
    state: z.literal("open"),
    caFingerprint: certificateFingerprintSchema,
    expiresAt: z.iso.datetime(),
    qrUri: pairingInvitationUriSchema,
    sessionId: z.uuidv7(),
  }),
  z.strictObject({
    state: z.literal("awaiting-confirmation"),
    expiresAt: z.iso.datetime(),
    fingerprintDigits: pairingFingerprintDigitsSchema,
    qrV2Uri: pairingBindingUriSchema,
    sessionId: z.uuidv7(),
    terminalName: deviceDisplayNameSchema,
  }),
  z.strictObject({
    state: z.literal("confirmed"),
    deviceId: z.uuidv7(),
    displayName: deviceDisplayNameSchema,
    sessionId: z.uuidv7(),
  }),
  z.strictObject({
    state: z.literal("cancelled"),
    reason: pairingCancellationReasonSchema,
    sessionId: z.uuidv7(),
  }),
  z.strictObject({ state: z.literal("expired"), sessionId: z.uuidv7() }),
  z.strictObject({
    state: z.literal("failed"),
    reason: pairingFailureReasonSchema,
    sessionId: z.uuidv7(),
  }),
]);
export const pairingSessionConfirmRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});
export const pairingSessionConfirmedSchema = z.strictObject({
  deviceId: z.uuidv7(),
  displayName: deviceDisplayNameSchema,
});
export const pairingSessionCancelRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  reason: pairingCancellationReasonSchema,
});
export const pairingSessionCancelledSchema = z.strictObject({
  status: z.literal("cancelled"),
});

export const terminalDeviceSchema = z.strictObject({
  certNotAfter: z.iso.datetime(),
  connected: z.boolean(),
  displayName: deviceDisplayNameSchema,
  id: z.uuidv7(),
  pairedAt: z.iso.datetime(),
  revocationReason: revocationReasonSchema.nullable(),
  revokedAt: z.iso.datetime().nullable(),
  seatReleasedAt: z.iso.datetime().nullable(),
});
/**
 * `permitted` is licence data, never a constant: it is the permitted device
 * count of the currently installed licence, and a licence that raises it
 * raises the limit without a code change.
 */
export const deviceSeatUsageSchema = z.strictObject({
  permitted: z.number().int().min(1).max(10_000),
  used: z.number().int().min(0),
});
/**
 * `seatUsage` is `null` exactly when no valid licence is installed. There is no
 * default device count anywhere in Breev: without licence data the permitted
 * count is not a smaller number, it is unknown, and the Main screen says so
 * rather than showing an invented limit.
 */
export const deviceInventorySchema = z.strictObject({
  devices: z.array(terminalDeviceSchema).max(10_000),
  seatUsage: z.union([deviceSeatUsageSchema, z.null()]),
});

export const deviceRevocationRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  reason: revocationReasonSchema,
  stepUpChallengeId: z.uuidv7(),
});
export const deviceRevocationSchema = z.strictObject({
  revokedAt: z.iso.datetime(),
});

export const seatReleaseRequestCreateSchema = z.strictObject({
  deviceId: z.uuidv7(),
  idempotencyKey: z.uuid(),
  stepUpChallengeId: z.uuidv7(),
});
export const seatReleaseRequestSchema = z.strictObject({
  expiresAt: z.iso.datetime(),
  requestId: z.uuidv7(),
});
/**
 * The second user of the two-user seat release. The approver authenticates
 * inside this request and must be a different active user who holds
 * `devices.pair`; there is no emergency bypass.
 */
export const seatReleaseApprovalRequestSchema = z.strictObject({
  approverPassword: z.string().min(1).max(128),
  approverUsername: usernameSchema,
  idempotencyKey: z.uuid(),
});
export const seatReleaseApprovalSchema = z.strictObject({
  releasedAt: z.iso.datetime(),
});

export const pairingCaCertificateSchema = z.strictObject({
  caCertificatePem: certificatePemSchema,
  installationId: z.uuidv7(),
});
export const pairingJoinRequestSchema = z.strictObject({
  csrPem: z.string().min(1).max(8_192),
  deviceName: deviceDisplayNameSchema,
  joinSecret: base64UrlSchema.length(43),
  sessionId: z.uuidv7(),
  transcriptSignature: base64Schema.max(1_024),
});
export const pairingJoinAcceptedSchema = z.strictObject({
  status: z.literal("bound"),
});
export const pairingChannelStateSchema = z.strictObject({
  state: pairingSessionStateNameSchema,
});
export const pairingCertificateRequestSchema = z.strictObject({
  sessionId: z.uuidv7(),
  signature: base64Schema.max(1_024),
});
export const pairingCertificateSchema = z.strictObject({
  caCertificatePem: certificatePemSchema,
  certificatePem: certificatePemSchema,
  deviceId: z.uuidv7(),
  installationId: z.uuidv7(),
});

const devicesDenialResponses = {
  400: z.union([devicesDenialSchema, identityDenialSchema]),
  401: identityDenialSchema,
  403: z.union([
    devicesDenialSchema,
    identityDenialSchema,
    licensingDenialSchema,
  ]),
  404: z.union([devicesDenialSchema, identityDenialSchema]),
  409: z.union([devicesDenialSchema, identityDenialSchema]),
} as const;

export const pairingSessionStartContract = {
  method: "POST",
  path: "/devices/pairing-sessions",
  request: { body: pairingSessionStartRequestSchema },
  responses: { 201: pairingSessionStartedSchema, ...devicesDenialResponses },
} as const;
export const pairingSessionCurrentContract = {
  method: "GET",
  path: "/devices/pairing-sessions/current",
  responses: { 200: pairingSessionViewSchema, ...devicesDenialResponses },
} as const;
export const pairingSessionConfirmContract = {
  method: "POST",
  path: "/devices/pairing-sessions/:sessionId/confirmation",
  request: { body: pairingSessionConfirmRequestSchema },
  responses: { 201: pairingSessionConfirmedSchema, ...devicesDenialResponses },
} as const;
export const pairingSessionConfirmPath = (sessionId: string): string =>
  `/devices/pairing-sessions/${sessionId}/confirmation`;
export const pairingSessionCancelContract = {
  method: "POST",
  path: "/devices/pairing-sessions/:sessionId/cancellation",
  request: { body: pairingSessionCancelRequestSchema },
  responses: { 201: pairingSessionCancelledSchema, ...devicesDenialResponses },
} as const;
export const pairingSessionCancelPath = (sessionId: string): string =>
  `/devices/pairing-sessions/${sessionId}/cancellation`;
export const deviceInventoryContract = {
  method: "GET",
  path: "/devices",
  responses: { 200: deviceInventorySchema, ...devicesDenialResponses },
} as const;
export const deviceRevocationContract = {
  method: "POST",
  path: "/devices/:deviceId/revocations",
  request: { body: deviceRevocationRequestSchema },
  responses: { 201: deviceRevocationSchema, ...devicesDenialResponses },
} as const;
export const deviceRevocationPath = (deviceId: string): string =>
  `/devices/${deviceId}/revocations`;
export const seatReleaseRequestContract = {
  method: "POST",
  path: "/devices/seat-release-requests",
  request: { body: seatReleaseRequestCreateSchema },
  responses: { 201: seatReleaseRequestSchema, ...devicesDenialResponses },
} as const;
export const seatReleaseApprovalContract = {
  method: "POST",
  path: "/devices/seat-release-requests/:requestId/approvals",
  request: { body: seatReleaseApprovalRequestSchema },
  responses: { 201: seatReleaseApprovalSchema, ...devicesDenialResponses },
} as const;
export const seatReleaseApprovalPath = (requestId: string): string =>
  `/devices/seat-release-requests/${requestId}/approvals`;

export const pairingCaCertificateContract = {
  method: "GET",
  path: "/pairing/ca-certificate",
  responses: { 200: pairingCaCertificateSchema, 400: devicesDenialSchema },
} as const;
export const pairingJoinContract = {
  method: "POST",
  path: "/pairing/joins",
  request: { body: pairingJoinRequestSchema },
  responses: {
    200: pairingJoinAcceptedSchema,
    400: devicesDenialSchema,
    403: devicesDenialSchema,
    404: devicesDenialSchema,
    409: devicesDenialSchema,
    429: devicesDenialSchema,
  },
} as const;
export const pairingChannelStateContract = {
  method: "GET",
  path: "/pairing/sessions/:sessionId/state",
  responses: {
    200: pairingChannelStateSchema,
    400: devicesDenialSchema,
    404: devicesDenialSchema,
    429: devicesDenialSchema,
  },
} as const;
export const pairingChannelStatePath = (sessionId: string): string =>
  `/pairing/sessions/${sessionId}/state`;
export const pairingCertificateContract = {
  method: "POST",
  path: "/pairing/certificates",
  request: { body: pairingCertificateRequestSchema },
  responses: {
    200: pairingCertificateSchema,
    400: devicesDenialSchema,
    403: devicesDenialSchema,
    404: devicesDenialSchema,
    409: devicesDenialSchema,
    429: devicesDenialSchema,
  },
} as const;

export const PAIRING_CHANNEL_PATH_PREFIX = "/pairing/" as const;

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

/**
 * Reading the denial evidence is an authenticated operation. A device binding
 * alone — the Main headers, or an Additional POS Terminal's certificate —
 * proves which machine is asking, never that anyone is signed in on it, so this
 * route answers the identity denial family too.
 */
export const localProofEvidenceContract = {
  method: "GET",
  path: localProofMutationContract.path,
  responses: {
    [LOCAL_PROOF_EVIDENCE_SUCCESS_STATUS]: localProofEvidenceSuccessSchema,
    ...localSecurityDenialResponses,
    401: z.union([localSecurityDenialSchema, identityDenialSchema]),
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

/**
 * Recovery metadata describes the pharmacy's backups and its quarantine state,
 * so it is readable only by a signed-in user. A paired device with no user
 * session — an Additional POS Terminal that has only presented its certificate
 * — is refused with the identity denial family.
 */
export const localRecoveryStatusContract = {
  method: "GET",
  path: "/recovery/status",
  responses: {
    [LOCAL_RECOVERY_STATUS_SUCCESS_STATUS]: localRecoveryStatusSuccessSchema,
    ...localSecurityDenialResponses,
    401: z.union([localSecurityDenialSchema, identityDenialSchema]),
    403: z.union([
      localSecurityDenialSchema,
      identityDenialSchema,
      licensingDenialSchema,
    ]),
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

export type DevicesDenialCode = z.infer<typeof devicesDenialCodeSchema>;
export type DevicesDenial = z.infer<typeof devicesDenialSchema>;
export type PairingSessionStateName = z.infer<
  typeof pairingSessionStateNameSchema
>;
export type PairingCancellationReason = z.infer<
  typeof pairingCancellationReasonSchema
>;
export type PairingFailureReason = z.infer<typeof pairingFailureReasonSchema>;
export type PairingSessionStartRequest = z.infer<
  typeof pairingSessionStartRequestSchema
>;
export type PairingSessionStarted = z.infer<typeof pairingSessionStartedSchema>;
export type PairingSessionView = z.infer<typeof pairingSessionViewSchema>;
export type PairingSessionConfirmRequest = z.infer<
  typeof pairingSessionConfirmRequestSchema
>;
export type PairingSessionConfirmed = z.infer<
  typeof pairingSessionConfirmedSchema
>;
export type PairingSessionCancelRequest = z.infer<
  typeof pairingSessionCancelRequestSchema
>;
export type PairingSessionCancelled = z.infer<
  typeof pairingSessionCancelledSchema
>;
export type TerminalDeviceSummary = z.infer<typeof terminalDeviceSchema>;
export type DeviceSeatUsage = z.infer<typeof deviceSeatUsageSchema>;
export type DeviceInventory = z.infer<typeof deviceInventorySchema>;
export type DeviceRevocationRequest = z.infer<
  typeof deviceRevocationRequestSchema
>;
export type DeviceRevocation = z.infer<typeof deviceRevocationSchema>;
export type SeatReleaseRequestCreate = z.infer<
  typeof seatReleaseRequestCreateSchema
>;
export type SeatReleaseRequest = z.infer<typeof seatReleaseRequestSchema>;
export type SeatReleaseApprovalRequest = z.infer<
  typeof seatReleaseApprovalRequestSchema
>;
export type SeatReleaseApproval = z.infer<typeof seatReleaseApprovalSchema>;
export type PairingCaCertificate = z.infer<typeof pairingCaCertificateSchema>;
export type PairingJoinRequest = z.infer<typeof pairingJoinRequestSchema>;
export type PairingJoinAccepted = z.infer<typeof pairingJoinAcceptedSchema>;
export type PairingChannelState = z.infer<typeof pairingChannelStateSchema>;
export type PairingCertificateRequest = z.infer<
  typeof pairingCertificateRequestSchema
>;
export type PairingCertificate = z.infer<typeof pairingCertificateSchema>;

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
