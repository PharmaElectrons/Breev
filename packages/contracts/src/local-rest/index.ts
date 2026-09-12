import { z } from "zod";

export const LOCAL_API_VERSION = "18" as const;
export const LOCAL_SCHEMA_VERSION = "18" as const;
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
export type PharmacyRoleKey = (typeof PHARMACY_ROLE_KEYS)[number];

/**
 * Breev's own built-in role names. These names are product vocabulary, not
 * pharmacy data, and the server reserves every localized value for built-in
 * roles.
 */
export const PHARMACY_ROLE_DISPLAY_NAMES: Readonly<
  Record<"ar" | "en", Readonly<Record<PharmacyRoleKey, string>>>
> = {
  ar: {
    owner: "المالك",
    manager: "المدير",
    pharmacist: "الصيدلي",
    sales_employee: "موظف المبيعات",
    purchasing_employee: "موظف المشتريات",
    inventory_employee: "موظف المخزون",
    accountant: "المحاسب",
    support: "الدعم المحلي",
  },
  en: {
    owner: "Owner",
    manager: "Manager",
    pharmacist: "Pharmacist",
    sales_employee: "Sales employee",
    purchasing_employee: "Purchasing employee",
    inventory_employee: "Inventory employee",
    accountant: "Accountant",
    support: "Local support",
  },
};
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
/**
 * Permissions backed by a live local operation and therefore grantable in the
 * role editor. Keep presentation metadata in the renderer; this shared list is
 * the authority boundary both the local API and desktop must agree on.
 */
export const IMPLEMENTED_PERMISSION_NAMES = [
  "attendance.record",
  "catalog.item.manage",
  "catalog.item.search",
  "devices.pair",
  "identity.roles.manage",
  "identity.users.manage",
  "inventory.batch_safety.manage",
  "inventory.counts.approve",
  "inventory.counts.record",
  "inventory.reorder.confirm",
  "inventory.reorder.manage",
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
] as const;
export type ImplementedPermissionName =
  (typeof IMPLEMENTED_PERMISSION_NAMES)[number];
export const permissionNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u)
  .max(96);
export const stepUpActionSchema = z.enum([
  "purchase.return.post",
  "devices.pairing.start",
  "devices.revoke",
  "devices.seat.release.request",
  "identity.role.create",
  "identity.role.permissions.update",
  "identity.role.rename",
  "identity.user.password.reset",
  "identity.user.create",
  "identity.user.update",
  "inventory.batch_expiry.correct",
  "inventory.sensitive.export",
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
  "owner-permission-floor-required",
  "owner-role-required",
  "permission-denied",
  "rate-limit-exceeded",
  "role-name-reserved",
  "role-name-taken",
  "role-not-custom",
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

/**
 * Roles.
 *
 * Each user holds exactly one role and a user's permissions are exactly that
 * role's grants (docs/domain.md, identity). A role is either one of the eight
 * built-in roles, identified by its stable `key` and named by the renderer in
 * the user's language, or a custom role the pharmacy created, identified only
 * by its id and named verbatim by the pharmacy. The discriminant is `kind`,
 * never the name.
 *
 * `identityRoleReferenceSchema` is what a user carries; `identityRoleSchema`
 * adds the revision and the grants that the administration screens edit.
 */
export const customRoleNameSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value === value.trim());
const builtInRoleReferenceFields = {
  id: z.uuidv7(),
  kind: z.literal("built-in"),
  key: pharmacyRoleKeySchema,
} as const;
const customRoleReferenceFields = {
  id: z.uuidv7(),
  kind: z.literal("custom"),
  name: customRoleNameSchema,
} as const;
const roleAuthorityFields = {
  revision: decimalRevisionSchema,
  grants: z.array(permissionNameSchema),
} as const;
export const identityRoleReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject(builtInRoleReferenceFields),
  z.strictObject(customRoleReferenceFields),
]);
export const identityRoleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...builtInRoleReferenceFields, ...roleAuthorityFields }),
  z.strictObject({ ...customRoleReferenceFields, ...roleAuthorityFields }),
]);

export const identityUserSchema = z.strictObject({
  id: z.uuidv7(),
  displayName: displayNameSchema,
  username: usernameSchema,
  role: identityRoleReferenceSchema,
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
  // The permitted device count is licensing data set by the Super Admin,
  // never a hard-coded software limit (see product.md "Plans, entitlements,
  // and administration"). This upper bound is a transport-safety guard
  // against a malformed or forged value, not a product ceiling.
  permittedDeviceCount: z.number().int().min(1).max(1_000_000),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  graceEndsAt: z.iso.datetime(),
});
/**
 * `grace` is the window between the licence's signed `expiresAt` and its
 * signed `graceEndsAt`: paid capabilities continue and the licence stays
 * visible, but the pharmacy cannot pair a new terminal until it renews. The
 * length of the window is the issuer's, never a local constant, and the rule
 * itself is the working default pending the client's paid-expiry decision in
 * docs/open-decisions.md.
 */
export const entitlementContextSchema = z
  .strictObject({
    status: z.enum([
      "licensed",
      "grace",
      "free-core",
      "invalid-licence",
      "expired",
      "clock-rollback",
    ]),
    capabilities: z.array(capabilityNameSchema),
    licence: licenceSummarySchema.nullable(),
  })
  .superRefine((context, refinement) => {
    const requiresLicence =
      context.status === "licensed" || context.status === "grace";
    if (requiresLicence !== (context.licence !== null)) {
      refinement.addIssue({
        code: "custom",
        message: "Licence presence does not match entitlement status",
        path: ["licence"],
      });
    }
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
  roleId: identityResourceIdSchema,
});
export const identityUpdateUserRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  displayName: displayNameSchema.optional(),
  expectedRevision: decimalRevisionSchema,
  roleId: identityResourceIdSchema.optional(),
  status: z.enum(["active", "locked"]).optional(),
});
export const identityChangePasswordRequestSchema = z.strictObject({
  ...identityCommandFields,
  currentPassword: z.string().min(1).max(128),
  expectedRevision: decimalRevisionSchema,
  newPassword: passwordSchema,
});
export const identityResetUserPasswordRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  expectedRevision: decimalRevisionSchema,
  newPassword: passwordSchema,
});
/**
 * The eight built-in roles are always present; custom roles follow them. The
 * `permissions` list is the grantable vocabulary — only names backed by an
 * implemented operation.
 */
export const identityRolesSchema = z.strictObject({
  roles: z
    .array(identityRoleSchema)
    .min(PHARMACY_ROLE_KEYS.length)
    .superRefine((roles, refinement) => {
      for (const key of PHARMACY_ROLE_KEYS) {
        const count = roles.filter(
          (role) => role.kind === "built-in" && role.key === key,
        ).length;
        if (count !== 1) {
          refinement.addIssue({
            code: "custom",
            message: `Built-in role ${key} must appear exactly once`,
          });
        }
      }
    }),
  permissions: z.array(permissionNameSchema),
});
export const identityUpdateRolePermissionsRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  expectedRevision: decimalRevisionSchema,
  permissions: z.array(permissionNameSchema).max(128),
});
/** A custom role is created with its name and its initial grants in one command. */
export const identityCreateRoleRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  name: customRoleNameSchema,
  permissions: z.array(permissionNameSchema).max(128),
});
export const identityRenameRoleRequestSchema = z.strictObject({
  ...identityCommandFields,
  challengeId: z.uuidv7(),
  expectedRevision: decimalRevisionSchema,
  name: customRoleNameSchema,
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
/**
 * The users list carries the assignable roles as references, so a holder of
 * `identity.users.manage` can assign a role by id without holding
 * `identity.roles.manage`; grants stay on the roles route.
 */
export const identityUsersContract = {
  method: "GET",
  path: "/identity/users",
  responses: {
    200: z.strictObject({
      roles: z
        .array(identityRoleReferenceSchema)
        .min(PHARMACY_ROLE_KEYS.length),
      users: z.array(identityUserSchema),
    }),
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
export const identityChangePasswordContract = {
  method: "POST",
  path: "/identity/password-changes",
  request: { body: identityChangePasswordRequestSchema },
  responses: {
    200: identityUserSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityOrEntitlementDenialSchema,
    409: identityDenialSchema,
    429: identityDenialSchema,
  },
} as const;
export const identityUserPasswordResetPath = (userId: string): string =>
  `/identity/users/${userId}/password-reset`;
export const identityResetUserPasswordContract = {
  method: "POST",
  path: "/identity/users/:userId/password-reset",
  request: { body: identityResetUserPasswordRequestSchema },
  responses: {
    200: identityUserSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityOrEntitlementDenialSchema,
    404: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
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
export const identityCreateRoleContract = {
  method: "POST",
  path: "/identity/roles",
  request: { body: identityCreateRoleRequestSchema },
  responses: {
    201: identityRoleSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityOrEntitlementDenialSchema,
    404: identityDenialSchema,
    409: identityDenialSchema,
  },
} as const;
export const identityRolePath = (roleId: string): string =>
  `/identity/roles/${roleId}`;
/** Rename applies to custom roles only; a built-in role answers `role-not-custom`. */
export const identityRenameRoleContract = {
  method: "PATCH",
  path: "/identity/roles/:roleId",
  request: { body: identityRenameRoleRequestSchema },
  responses: {
    200: identityRoleSchema,
    400: identityDenialSchema,
    401: identityDenialSchema,
    403: identityOrEntitlementDenialSchema,
    404: identityDenialSchema,
    409: identityDenialSchema,
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
  "ca-key-store-failure",
  "ca-not-found",
  "device-not-found",
  "device-not-revoked",
  "pairing-attempts-exceeded",
  "pairing-entitlement-missing",
  "pairing-grace-period",
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

/**
 * Catalog: the Product master.
 *
 * A Product is defined in one of two modes, and Breev generates its English
 * display name from that mode's approved field order rather than accepting free
 * text. Three absences in this family are load-bearing and deliberate:
 *
 * - No request schema carries a display name. Free-text entry of the generated
 *   name is impossible by construction rather than refused by validation.
 * - No schema here carries a stock quantity, an on-hand balance, or an expiry
 *   date. Catalog owns descriptive and commercial data; stock is derived from
 *   Inventory's append-only movements and expiry belongs to a Batch, so there
 *   is no Product field for any route to write.
 * - No route deletes. A referenced Product is archived or merged, and both
 *   outcomes keep the row resolvable for every snapshot and foreign key that
 *   already points at it.
 *
 * The Arabic search name is a sibling field, stored and displayed on its own
 * line beneath the English name and never appended to it. Nothing in this
 * family treats the external or AI sharing controls as an authorization
 * decision: they are metadata, and a flag alone never exposes restricted data.
 */
export const PRODUCT_DEFINITION_MODES = ["general-item", "medication"] as const;
export const productDefinitionModeSchema = z.enum(PRODUCT_DEFINITION_MODES);

/**
 * The naming templates Breev has approved. A Product stores the version its
 * name was generated under, so a later revision adds a version here instead of
 * silently rewriting names that already exist.
 */
export const PRODUCT_NAME_TEMPLATE_VERSIONS = [1] as const;
export const productNameTemplateVersionSchema = z.literal(
  PRODUCT_NAME_TEMPLATE_VERSIONS,
);

export const PRODUCT_STATUSES = ["active", "archived", "merged"] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);

export const PRODUCT_FOOD_TIMINGS = [
  "after-food",
  "before-food",
  "regardless-of-food",
] as const;
export const productFoodTimingSchema = z.enum(PRODUCT_FOOD_TIMINGS);

export const PRODUCT_STATE_COLORS = [
  "blue",
  "green",
  "grey",
  "orange",
  "purple",
  "red",
  "yellow",
] as const;
export const productStateColorSchema = z.enum(PRODUCT_STATE_COLORS);

const PRODUCT_NAME_PART_MAX_LENGTH = 120;
const PRODUCT_NAME_PART_COUNT_MAX = 6;
const productNamePartSchema = z
  .string()
  .min(1)
  .max(PRODUCT_NAME_PART_MAX_LENGTH)
  .refine((value) => value === value.trim());
/**
 * An optional naming part is always present on the wire and null when the
 * pharmacist left it empty. Absent is not the same as unknown, and the
 * generator skips a null part cleanly.
 */
const optionalProductNamePartSchema = productNamePartSchema.nullable();
const optionalProductTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim())
    .nullable();

/** Medication Mode: Trade Name → Strength → Dosage Form → Manufacturer. */
export const medicationNameFieldsSchema = z.strictObject({
  tradeName: productNamePartSchema,
  strength: optionalProductNamePartSchema,
  dosageForm: optionalProductNamePartSchema,
  manufacturer: optionalProductNamePartSchema,
});
/**
 * General/Medical/Cosmetic Item Mode: Company → Sub-brand/Series → Type/Use →
 * Property/Degree → Target/Audience → Size/Volume.
 */
export const generalItemNameFieldsSchema = z.strictObject({
  company: productNamePartSchema,
  subBrand: optionalProductNamePartSchema,
  typeOfUse: optionalProductNamePartSchema,
  property: optionalProductNamePartSchema,
  targetAudience: optionalProductNamePartSchema,
  size: optionalProductNamePartSchema,
});

/**
 * The mode switch is one discriminated choice carrying only the chosen mode's
 * fields, so a definition can never hold two conflicting field sets at once and
 * a request can never name a field the active mode does not have.
 */
export const productDefinitionSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("medication"),
    fields: medicationNameFieldsSchema,
  }),
  z.strictObject({
    mode: z.literal("general-item"),
    fields: generalItemNameFieldsSchema,
  }),
]);

const productUseFrequencySchema = z.number().int().min(1).max(99).nullable();
/**
 * Item instructions are stored here for the sales and patient context to show
 * later. Clinical or dosage use of them ships disabled.
 */
export const productInstructionsSchema = z.strictObject({
  usesPerDay: productUseFrequencySchema,
  usesPerWeek: productUseFrequencySchema,
  usesPerMonth: productUseFrequencySchema,
  foodTiming: productFoodTimingSchema.nullable(),
});

/**
 * Per-item external and AI sharing controls. These record what the pharmacy
 * intends; they are never consulted as an authorization decision, and setting
 * one exposes nothing on its own.
 */
export const productSharingControlsSchema = z.strictObject({
  externallyVisible: z.boolean(),
  aiSharingAllowed: z.boolean(),
});

/**
 * State-colour data the Product master owns: the colour a user assigned by
 * hand, and the one automatic condition Catalog itself knows about. Every other
 * automatic condition — low stock, expiry, sale below cost, missing barcode —
 * is derived from Inventory, Batch, pricing, or the barcode list rather than
 * stored, and the surfaces that display any of them arrive later.
 */
export const productStateColoursSchema = z.strictObject({
  manual: productStateColorSchema.nullable(),
  coldStorageRequired: z.boolean(),
});

/**
 * Packaging: one Inventory Unit, the larger packages that convert to it, and
 * the optional Third Unit that converts to nothing.
 *
 * The inventory ledger records an integer count of the Inventory Unit, and
 * every larger package reaches it through an explicit positive integer ratio,
 * so no conversion can produce a fractional base-unit balance. Two absences
 * carry the rule rather than a validation message:
 *
 * - A package unit carries a ratio; the Third Unit carries only a name. There
 *   is no number on it for a stock-affecting conversion to reach for, because
 *   it exists for number-of-days and dosage follow-up alone.
 * - An interface default is one of exactly two shapes, the base unit or one of
 *   this product's packages. No third shape names the Third Unit, so a default
 *   cannot select it however the pharmacy spells it.
 */
export const PRODUCT_UNIT_INTERFACES = ["count", "purchase", "sale"] as const;
export const productUnitInterfaceSchema = z.enum(PRODUCT_UNIT_INTERFACES);

const productUnitNameSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => value === value.trim());

/**
 * How many Inventory Units one package holds, as a canonical decimal integer
 * string: no sign, no leading zero, no decimal point, no exponent, ASCII digits
 * only. The ratio never crosses the wire as a JSON number, because a number is
 * binary floating point and a ratio is authoritative quantity data.
 *
 * At least one, matching the requirement that package ratios are positive.
 * The upper bound is PostgreSQL's signed `bigint` limit, so every value the
 * contract accepts can be persisted without a transport-time overflow.
 */
const PACKAGE_UNIT_RATIO = /^[1-9][0-9]*$/u;
const PACKAGE_UNIT_RATIO_MAXIMUM = 9_223_372_036_854_775_807n;
export const packageUnitRatioSchema = z
  .string()
  .min(1)
  .max(19)
  .regex(PACKAGE_UNIT_RATIO)
  .refine((value) => {
    // Zod runs every check, so the range test re-applies the grammar rather
    // than trusting that the failing regex above already stopped the value.
    if (!PACKAGE_UNIT_RATIO.test(value)) return false;
    const ratio = BigInt(value);
    return ratio >= 1n && ratio <= PACKAGE_UNIT_RATIO_MAXIMUM;
  });

export const productPackageUnitSchema = z.strictObject({
  name: productUnitNameSchema,
  baseUnitsPerPackage: packageUnitRatioSchema,
});

/**
 * The Third Unit: a name for treatment days or dosage follow-up, and nothing
 * else. It is never an inventory-balance, purchasing, or sales unit.
 */
export const productThirdUnitSchema = z.strictObject({
  name: productUnitNameSchema,
});

/**
 * A unit a stock-affecting interface may work in. The base unit needs no name
 * here — the packaging already names it once — and a package is referenced by
 * its name rather than by a repeated ratio, so one ratio in the package list
 * stays the single definition every conversion reads.
 */
export const inventoryCapableUnitSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("inventory-unit") }),
  z.strictObject({
    kind: z.literal("package-unit"),
    packageUnitName: productUnitNameSchema,
  }),
]);

export const productPackagingSchema = z
  .strictObject({
    inventoryUnitName: productUnitNameSchema,
    packageUnits: z.array(productPackageUnitSchema),
    thirdUnit: productThirdUnitSchema.nullable(),
    /**
     * One default per interface — purchasing typically larger, selling
     * typically smaller. A transaction may change its unit where permitted;
     * this is only where the screen starts.
     */
    defaultUnits: z.strictObject({
      count: inventoryCapableUnitSchema,
      purchase: inventoryCapableUnitSchema,
      sale: inventoryCapableUnitSchema,
    }),
  })
  .superRefine((packaging, ctx) => {
    const seen = new Map<string, readonly (string | number)[]>([
      [packaging.inventoryUnitName, ["inventoryUnitName"]],
    ]);
    for (const [index, unit] of packaging.packageUnits.entries()) {
      const path = ["packageUnits", index, "name"] as const;
      if (seen.has(unit.name)) {
        ctx.addIssue({
          code: "custom",
          path: [...path],
          message: "A unit name identifies one unit of this product",
        });
      } else {
        seen.set(unit.name, path);
      }
    }
    if (packaging.thirdUnit !== null) {
      if (seen.has(packaging.thirdUnit.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["thirdUnit", "name"],
          message: "A unit name identifies one unit of this product",
        });
      }
    }

    const packageNames = new Set(
      packaging.packageUnits.map((unit) => unit.name),
    );
    for (const [interfaceName, unit] of Object.entries(
      packaging.defaultUnits,
    )) {
      if (
        unit.kind === "package-unit" &&
        !packageNames.has(unit.packageUnitName)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["defaultUnits", interfaceName, "packageUnitName"],
          message: "A default unit must be one of this product's package units",
        });
      }
    }
  });

/**
 * Pricing: the item's Pricing Method, its prices, and which fields that method
 * leaves a person free to type in.
 *
 * The method decides field locking. In **By Price** the percentage field is
 * unavailable and the retail price is editable, including on a purchase
 * invoice. In **By Percentage** the retail price is locked and the percentage
 * is editable, because the server calculates the price from the approved cost
 * and the stored percentage. The percentage is **margin on the selling price,
 * not markup on cost**: cost 80 with a 20% margin gives 100 before rounding.
 *
 * The two methods are a discriminated choice rather than one object with
 * nullable fields, so a locked or unavailable field is absent from the shape
 * that must not carry it instead of being refused by a rule that could later be
 * relaxed. `productPricingInputSchema` is what a request may set;
 * `productPricingSchema` is what is read back, and it adds the calculated
 * retail price that By Percentage does not accept.
 */
export const PRODUCT_PRICING_METHODS = ["by-percentage", "by-price"] as const;
export const productPricingMethodSchema = z.enum(PRODUCT_PRICING_METHODS);

/**
 * The method a new item takes when nobody chooses one: selling by price.
 */
export const DEFAULT_PRODUCT_PRICING_METHOD = "by-price" as const;

/**
 * A non-negative price in exact IQD fils (`1 IQD = 1,000 fils`), as a canonical
 * decimal integer string: no sign, no leading zero, no decimal point, no
 * exponent, ASCII digits only. Prices never cross this boundary as JSON
 * numbers, because every JSON number is binary floating point.
 */
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;
export const priceFilsSchema = z
  .string()
  .max(19)
  .regex(/^(?:0|[1-9][0-9]*)$/u)
  .refine((value) => {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return false;
    return BigInt(value) <= POSTGRES_BIGINT_MAXIMUM;
  });

/** Exact signed PostgreSQL bigint transported as canonical decimal text. */
export const signedBigintSchema = z
  .string()
  .max(20)
  .regex(/^(?:0|-?[1-9][0-9]*)$/u)
  .refine((value) => {
    if (!/^(?:0|-?[1-9][0-9]*)$/u.test(value)) return false;
    const parsed = BigInt(value);
    return (
      parsed >= -POSTGRES_BIGINT_MAXIMUM - 1n &&
      parsed <= POSTGRES_BIGINT_MAXIMUM
    );
  });

/**
 * Exact margin text with at most six decimal places, at least zero and strictly
 * below one hundred.
 *
 * One hundred percent margin on the selling price would require an infinite
 * price to recover any cost at all, and more than that is a loss dressed as a
 * gain, so both are impossible rather than merely unusual. The value stays text
 * end to end: it is exact decimal data, and reading it as a JS number would
 * quietly replace it with the nearest binary fraction.
 */
export const marginPercentageSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]?)(?:\.[0-9]{1,6})?$/u);

/**
 * How a calculated price is rounded after the margin is applied. Rounding is
 * off unless the pharmacy turns it on, and it acts on whole dinars: 250, 500,
 * or 1,000 IQD.
 */
export const PRICE_ROUNDING_SETTINGS = [
  "nearest-1000-iqd",
  "nearest-250-iqd",
  "nearest-500-iqd",
  "off",
] as const;
export const priceRoundingSettingSchema = z.enum(PRICE_ROUNDING_SETTINGS);

const byPricePricingFields = {
  method: z.literal("by-price"),
  retailPriceFils: priceFilsSchema,
  /**
   * The wholesale or special price lives in the item record and appears in the
   * item panel. It is not re-entered on each purchase invoice, and an item that
   * has none carries null.
   */
  wholesalePriceFils: priceFilsSchema.nullable(),
} as const;
const byPercentagePricingFields = {
  method: z.literal("by-percentage"),
  marginPercentage: marginPercentageSchema,
  /**
   * The rounding this item's calculated price was derived under, so the price
   * on the screen can be reproduced from the cost, the margin, and this field
   * alone. By Price calculates nothing, so it has no such field.
   */
  rounding: priceRoundingSettingSchema,
  wholesalePriceFils: priceFilsSchema.nullable(),
} as const;

/**
 * Pricing as a request may set it: no calculated retail price. A By
 * Percentage request additionally carries the approved cost the initial
 * retail price is calculated from. It is transient calculation input only --
 * the server never stores it, and a Product read-back never returns it.
 */
export const productPricingInputSchema = z.discriminatedUnion("method", [
  z.strictObject(byPricePricingFields),
  z.strictObject({ ...byPercentagePricingFields, costFils: priceFilsSchema }),
]);

/** Pricing as it is read back, including the calculated retail price. */
export const productPricingSchema = z.discriminatedUnion("method", [
  z.strictObject(byPricePricingFields),
  z.strictObject({
    ...byPercentagePricingFields,
    retailPriceFils: priceFilsSchema,
  }),
]);

/**
 * Field locking published as data, so the item screen, the purchase row, and
 * every later caller read one table instead of each repeating the rule.
 *
 * `unavailable` and `locked` differ on purpose: an unavailable field has no
 * value under this method and is not shown, while a locked field has a value
 * that is shown and cannot be typed over.
 */
export const PRODUCT_PRICING_FIELDS = [
  "marginPercentage",
  "retailPrice",
  "wholesalePrice",
] as const;
export const PRODUCT_PRICING_FIELD_STATES = [
  "editable",
  "locked",
  "unavailable",
] as const;
export const PRODUCT_PRICING_FIELD_EDITABILITY: Readonly<
  Record<
    (typeof PRODUCT_PRICING_METHODS)[number],
    Readonly<
      Record<
        (typeof PRODUCT_PRICING_FIELDS)[number],
        (typeof PRODUCT_PRICING_FIELD_STATES)[number]
      >
    >
  >
> = {
  "by-percentage": {
    marginPercentage: "editable",
    retailPrice: "locked",
    wholesalePrice: "editable",
  },
  "by-price": {
    marginPercentage: "unavailable",
    retailPrice: "editable",
    wholesalePrice: "editable",
  },
};

export const PRODUCT_BARCODE_KINDS = ["package", "product"] as const;
export const productBarcodeKindSchema = z.enum(PRODUCT_BARCODE_KINDS);
export const PRODUCT_BARCODE_SOURCES = ["breev-internal", "provided"] as const;
export const productBarcodeSourceSchema = z.enum(PRODUCT_BARCODE_SOURCES);
export const productBarcodeValueSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value === value.trim());

/**
 * A caller records whether a code identifies the Product or one of its
 * packages. Unit resolution is intentionally absent: the current requirement
 * records the kind but does not make a scan choose a unit.
 */
export const productBarcodeInputSchema = z.strictObject({
  kind: productBarcodeKindSchema,
  value: productBarcodeValueSchema,
});

/**
 * Read-back also identifies Breev-reserved internal codes. `provided` makes no
 * GS1/GTIN claim; it only means the pharmacy supplied the value.
 */
export const productBarcodeSchema = z.strictObject({
  ...productBarcodeInputSchema.shape,
  source: productBarcodeSourceSchema,
});

/**
 * Everything a pharmacist may set on a Product. Create and edit share it
 * exactly, so the two can never drift into accepting different fields, and the
 * absent display name is absent from both.
 */
const productAttributeFields = {
  arabicSearchName: optionalProductTextSchema(160),
  barcodes: z.array(productBarcodeInputSchema).max(32),
  category: optionalProductTextSchema(96),
  definition: productDefinitionSchema,
  instructions: productInstructionsSchema,
  packaging: productPackagingSchema,
  pricing: productPricingInputSchema,
  scientificName: optionalProductTextSchema(160),
  sharing: productSharingControlsSchema,
  stateColours: productStateColoursSchema,
  stockLevels: z
    .strictObject({
      minimumLevel: nonNegativeIntegerStringSchema.nullable(),
      maximumLevel: nonNegativeIntegerStringSchema.nullable(),
      reorderPoint: nonNegativeIntegerStringSchema.nullable(),
    })
    .superRefine((levels, ctx) => {
      if (
        levels.minimumLevel !== null &&
        levels.maximumLevel !== null &&
        BigInt(levels.maximumLevel) < BigInt(levels.minimumLevel)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["maximumLevel"],
          message:
            "Maximum level must be greater than or equal to minimum level",
        });
      }
    }),
} as const;

/**
 * The Product as it is read back. `displayName` and `nameTemplateVersion` are
 * server consequences of the fields: they appear here and in no request.
 */
export const productSchema = z.strictObject({
  ...productAttributeFields,
  barcodes: z.array(productBarcodeSchema).max(32),
  displayName: z
    .string()
    .min(1)
    .max(
      PRODUCT_NAME_PART_MAX_LENGTH * PRODUCT_NAME_PART_COUNT_MAX +
        PRODUCT_NAME_PART_COUNT_MAX,
    ),
  id: z.uuidv7(),
  mergedIntoProductId: z.uuidv7().nullable(),
  nameTemplateVersion: productNameTemplateVersionSchema,
  /**
   * Read-back pricing carries the retail price under both methods, including
   * the one By Percentage calculates and no request may set.
   */
  pricing: productPricingSchema,
  revision: decimalRevisionSchema,
  status: productStatusSchema,
});

export const productCreateRequestSchema = z.strictObject({
  ...productAttributeFields,
  idempotencyKey: z.uuid(),
});
/**
 * Editing replaces the whole editable record, including the mode. Regenerating
 * the display name is the server's consequence of the new fields, never a name
 * the client supplies.
 */
export const productEditRequestSchema = z.strictObject({
  ...productAttributeFields,
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const productArchiveRequestSchema = z.strictObject({
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
/**
 * Merge names the survivor future references redirect to. The merged-away
 * Product is the one in the path, and it stays readable so historical documents
 * still render.
 */
export const productMergeRequestSchema = z.strictObject({
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  survivorProductId: z.uuidv7(),
});

/**
 * A rejected Product body reports which field failed and why, so the screen can
 * put the message on the field the pharmacist is standing in and leave the
 * value and the focus where they are. `path` walks the request body — for
 * example `["definition", "fields", "tradeName"]` or `["barcodes", 0]`.
 */
export const CATALOG_FIELD_ERROR_CODES = [
  "invalid",
  "out-of-range",
  "required",
  "too-long",
  "unknown-field",
] as const;
export const catalogFieldErrorCodeSchema = z.enum(CATALOG_FIELD_ERROR_CODES);
export const catalogFieldErrorSchema = z.strictObject({
  code: catalogFieldErrorCodeSchema,
  path: z
    .array(z.union([z.string().min(1), z.number().int().min(0)]))
    .min(1)
    .max(8),
});

/**
 * Catalog's own refusals. A permission or entitlement refusal is not among
 * them: those stay identity facts and answer on 403 with the identity family,
 * exactly as every other module's routes do.
 */
export const CATALOG_DENIAL_CODES = [
  "barcode-already-present",
  "barcode-not-found",
  "body-invalid",
  "idempotency-conflict",
  "matching-suggestion-not-found",
  "merge-into-self",
  "merge-survivor-not-mergeable",
  "product-archived",
  "product-merged",
  "product-not-found",
  "version-conflict",
] as const;
export const catalogDenialCodeSchema = z.enum(CATALOG_DENIAL_CODES);
export const catalogDenialSchema = z.strictObject({
  code: catalogDenialCodeSchema,
  /** Empty unless the code is `body-invalid`. */
  fieldErrors: z.array(catalogFieldErrorSchema),
  requestId: z.uuidv7(),
  status: z.literal("denied"),
});

const catalogReadDenialResponses = {
  401: identityDenialSchema,
  403: identityOrEntitlementDenialSchema,
} as const;
const catalogCommandDenialResponses = {
  ...catalogReadDenialResponses,
  400: catalogDenialSchema,
  404: catalogDenialSchema,
  409: catalogDenialSchema,
} as const;

export const productListContract = {
  method: "GET",
  path: "/catalog/products",
  responses: {
    200: z.strictObject({ products: z.array(productSchema) }),
    ...catalogReadDenialResponses,
  },
} as const;
export const productReadContract = {
  method: "GET",
  path: "/catalog/products/:productId",
  responses: {
    200: productSchema,
    ...catalogReadDenialResponses,
    404: catalogDenialSchema,
  },
} as const;
export const productCreateContract = {
  method: "POST",
  path: "/catalog/products",
  request: { body: productCreateRequestSchema },
  responses: { 201: productSchema, ...catalogCommandDenialResponses },
} as const;
export const productEditContract = {
  method: "PUT",
  path: "/catalog/products/:productId",
  request: { body: productEditRequestSchema },
  responses: { 200: productSchema, ...catalogCommandDenialResponses },
} as const;
export const productArchiveContract = {
  method: "POST",
  path: "/catalog/products/:productId/archivals",
  request: { body: productArchiveRequestSchema },
  responses: { 201: productSchema, ...catalogCommandDenialResponses },
} as const;
export const productMergeContract = {
  method: "POST",
  path: "/catalog/products/:productId/merges",
  request: { body: productMergeRequestSchema },
  responses: { 201: productSchema, ...catalogCommandDenialResponses },
} as const;

const productSearchLimitSchema = z
  .string()
  .regex(/^(?:[1-9]|[1-9][0-9]|100)$/u);
export const productSearchRequestSchema = z.strictObject({
  limit: productSearchLimitSchema.optional(),
  query: z
    .string()
    .min(1)
    .max(160)
    .refine((value) => value === value.trim()),
});
export const PRODUCT_SEARCH_MATCH_FIELDS = [
  "arabic-name",
  "barcode",
  "english-name",
] as const;
export const productSearchMatchFieldSchema = z.enum(
  PRODUCT_SEARCH_MATCH_FIELDS,
);
export const productSearchResultSchema = z.strictObject({
  matchedBarcode: productBarcodeSchema.nullable(),
  matchedField: productSearchMatchFieldSchema,
  product: productSchema,
});
export const productSearchResponseSchema = z.strictObject({
  hasMore: z.boolean(),
  query: z.string().min(1).max(160),
  resultCount: z.number().int().min(0),
  results: z.array(productSearchResultSchema).max(100),
});
export const productSearchContract = {
  method: "GET",
  path: "/catalog/product-search",
  request: { query: productSearchRequestSchema },
  responses: {
    200: productSearchResponseSchema,
    ...catalogReadDenialResponses,
    400: catalogDenialSchema,
  },
} as const;

const productRevisionCommandFields = {
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
} as const;
export const productBarcodeAddRequestSchema = z.strictObject({
  ...productRevisionCommandFields,
  barcode: productBarcodeInputSchema,
});
export const productBarcodeSuggestRequestSchema = z.strictObject({
  ...productRevisionCommandFields,
  kind: productBarcodeKindSchema,
});
export const productBarcodeSuggestionResponseSchema = z.strictObject({
  barcode: productBarcodeSchema,
  product: productSchema,
});
export const productBarcodePrintRequestSchema = z.strictObject({
  barcode: productBarcodeValueSchema,
  idempotencyKey: z.uuid(),
  locale: z.enum(["ar", "en"]),
  quantity: z.number().int().min(1).max(100),
});
export const barcodePrintHandoffSchema = z.strictObject({
  barcode: productBarcodeSchema,
  displayName: z.string().min(1).max(726),
  jobId: z.uuidv7(),
  locale: z.enum(["ar", "en"]),
  quantity: z.number().int().min(1).max(100),
});
export const productBarcodeAddContract = {
  method: "POST",
  path: "/catalog/products/:productId/barcodes",
  request: { body: productBarcodeAddRequestSchema },
  responses: { 201: productSchema, ...catalogCommandDenialResponses },
} as const;
export const productBarcodeSuggestContract = {
  method: "POST",
  path: "/catalog/products/:productId/barcode-suggestions",
  request: { body: productBarcodeSuggestRequestSchema },
  responses: {
    201: productBarcodeSuggestionResponseSchema,
    ...catalogCommandDenialResponses,
  },
} as const;
export const productBarcodePrintContract = {
  method: "POST",
  path: "/catalog/products/:productId/barcode-print-jobs",
  request: { body: productBarcodePrintRequestSchema },
  responses: {
    201: barcodePrintHandoffSchema,
    ...catalogCommandDenialResponses,
  },
} as const;

const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const catalogMatchingSuggestionSchema = z.strictObject({
  firstOfferedBusinessDate: businessDateSchema,
  id: z.uuidv7(),
  product: productSchema,
  proposedBarcode: productBarcodeSchema,
});
export const catalogMatchingBatchSchema = z.strictObject({
  businessDate: businessDateSchema,
  suggestions: z.array(catalogMatchingSuggestionSchema).max(10),
});
export const catalogMatchingBatchOpenRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});
export const catalogMatchingApprovalRequestSchema = z.strictObject({
  ...productRevisionCommandFields,
});
export const catalogMatchingBatchOpenContract = {
  method: "POST",
  path: "/catalog/matching-batches/current/openings",
  request: { body: catalogMatchingBatchOpenRequestSchema },
  responses: {
    201: catalogMatchingBatchSchema,
    ...catalogCommandDenialResponses,
  },
} as const;
export const catalogMatchingApprovalContract = {
  method: "POST",
  path: "/catalog/matching-suggestions/:suggestionId/approvals",
  request: { body: catalogMatchingApprovalRequestSchema },
  responses: { 201: productSchema, ...catalogCommandDenialResponses },
} as const;

export const productPath = (productId: string): string =>
  `/catalog/products/${productId}`;
export const productArchivePath = (productId: string): string =>
  `/catalog/products/${productId}/archivals`;
export const productMergePath = (productId: string): string =>
  `/catalog/products/${productId}/merges`;
export const productBarcodeAddPath = (productId: string): string =>
  `/catalog/products/${productId}/barcodes`;
export const productBarcodeSuggestPath = (productId: string): string =>
  `/catalog/products/${productId}/barcode-suggestions`;
export const productBarcodePrintPath = (productId: string): string =>
  `/catalog/products/${productId}/barcode-print-jobs`;
export const catalogMatchingApprovalPath = (suggestionId: string): string =>
  `/catalog/matching-suggestions/${suggestionId}/approvals`;
export function productSearchPath(input: {
  readonly limit?: string;
  readonly query: string;
}): string {
  const query = `query=${encodeURIComponent(input.query)}`;
  const limit =
    input.limit === undefined
      ? ""
      : `&limit=${encodeURIComponent(input.limit)}`;
  return `${productSearchContract.path}?${query}${limit}`;
}

/**
 * Every Catalog route, so a test can walk the whole family and prove what is
 * not there: no delete, no cleanup, and no repair path around the back.
 */
export const CATALOG_CONTRACTS = [
  catalogMatchingApprovalContract,
  catalogMatchingBatchOpenContract,
  productBarcodeAddContract,
  productBarcodePrintContract,
  productBarcodeSuggestContract,
  productArchiveContract,
  productCreateContract,
  productEditContract,
  productListContract,
  productMergeContract,
  productReadContract,
  productSearchContract,
] as const;

export const INVENTORY_COLUMN_FIELDS = [
  "item",
  "balance",
  "value",
  "averageCost",
  "batches",
  "expiry",
  "levels",
  "reorderPoint",
  "consumptionRate",
  "risk",
] as const;
export const inventoryColumnFieldSchema = z.enum(INVENTORY_COLUMN_FIELDS);
export const INVENTORY_RISK_INDICATORS = [
  "out-of-stock",
  "below-minimum",
  "at-or-below-reorder-point",
  "above-maximum",
  "expiring-soon",
  "expired",
  "missing-barcode",
  "cold-storage",
] as const;
export const inventoryRiskIndicatorSchema = z.enum(INVENTORY_RISK_INDICATORS);
const signedIntegerStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)$/u);
const inventoryCountSchema = nonNegativeIntegerStringSchema;
const inventoryStockLevelsSchema = z.strictObject({
  minimumLevel: nonNegativeIntegerStringSchema.nullable(),
  maximumLevel: nonNegativeIntegerStringSchema.nullable(),
  reorderPoint: nonNegativeIntegerStringSchema.nullable(),
});
const inventoryStateColourSchema = z.strictObject({
  automatic: productStateColorSchema,
  effective: productStateColorSchema,
  manual: productStateColorSchema.nullable(),
});
export const inventoryItemSchema = z.strictObject({
  averageUnitCostFils: priceFilsSchema.nullable(),
  balance: signedIntegerStringSchema,
  batches: z.strictObject({
    count: inventoryCountSchema,
    earliestExpiry: z.iso.date().nullable(),
    expiredCount: inventoryCountSchema,
  }),
  consumptionRatePer30Days: inventoryCountSchema,
  displayName: z.string().min(1).max(726),
  productId: z.uuidv7(),
  reconciliation: z.enum(["consistent", "mismatch"]),
  riskIndicators: z.array(inventoryRiskIndicatorSchema),
  stateColour: inventoryStateColourSchema,
  status: productStatusSchema,
  stockLevels: inventoryStockLevelsSchema,
  valueFils: signedIntegerStringSchema.nullable(),
});
export const INVENTORY_DENIAL_CODES = [
  "body-invalid",
  "batch-not-found",
  "batch-status-transition-invalid",
  "count-session-not-found",
  "count-line-not-found",
  "count-session-completed",
  "count-entry-invalid",
  "count-balance-changed",
  "count-variance-zero",
  "count-variance-already-applied",
  "count-blocked-stock",
  "count-no-batch",
  "count-no-cost-basis",
  "count-valuation-mismatch",
  "expiry-correction-unchanged",
  "product-not-found",
  "idempotency-conflict",
  "job-runtime-unavailable",
  "regulatory-hard-block",
  "reorder-item-not-found",
  "reorder-item-status-invalid",
  "reorder-quantity-zero",
  "reorder-product-inactive",
  "version-conflict",
  "owner-role-required",
] as const;
export const inventoryDenialCodeSchema = z.enum(INVENTORY_DENIAL_CODES);
export const inventoryFieldErrorSchema = catalogFieldErrorSchema.extend({
  rule: z.string().min(1).max(128).optional(),
});
export const inventoryDenialSchema = z.strictObject({
  code: inventoryDenialCodeSchema,
  fieldErrors: z.array(inventoryFieldErrorSchema),
  requestId: z.uuidv7(),
  status: z.literal("denied"),
});
const inventoryReadDenialResponses = {
  401: identityDenialSchema,
  403: identityOrEntitlementDenialSchema,
} as const;
export const inventoryItemListContract = {
  method: "GET",
  path: "/inventory/items",
  responses: {
    200: z.strictObject({
      fields: z.strictObject({ valuation: z.enum(["granted", "denied"]) }),
      items: z.array(inventoryItemSchema),
    }),
    ...inventoryReadDenialResponses,
    400: inventoryDenialSchema,
    404: inventoryDenialSchema,
  },
} as const;

export const INVENTORY_MOVEMENT_KINDS = [
  "purchase-adjustment",
  "purchase-receipt",
  "purchase-return",
  "count-variance",
] as const;
const inventoryMovementBaseSchema = z.strictObject({
  batchId: z.uuidv7(),
  id: z.uuidv7(),
  occurredAt: z.iso.datetime(),
  quantity: signedIntegerStringSchema,
  reference: z.strictObject({
    documentId: z.uuidv7(),
    documentType: z.string().min(1).max(64),
    label: z.string().min(1).max(256),
    number: z
      .strictObject({
        series: z.enum(["P", "C"]),
        value: decimalRevisionSchema,
        year: z.number().int().min(1970).max(9999),
      })
      .nullable(),
    openable: z.boolean(),
  }),
  user: z.strictObject({
    displayName: z.string().min(1).max(96),
    id: z.uuidv7(),
  }),
  valueFils: signedIntegerStringSchema.nullable(),
});
export const inventoryMovementSchema = z.discriminatedUnion("kind", [
  inventoryMovementBaseSchema.extend({
    kind: z.literal("purchase-adjustment"),
  }),
  inventoryMovementBaseSchema.extend({ kind: z.literal("purchase-receipt") }),
  inventoryMovementBaseSchema.extend({ kind: z.literal("purchase-return") }),
  inventoryMovementBaseSchema.extend({ kind: z.literal("count-variance") }),
]);
export const inventoryMovementHistoryContract = {
  method: "GET",
  path: "/inventory/items/:productId/movements",
  responses: {
    200: z.strictObject({
      movements: z.array(inventoryMovementSchema),
      productDisplayName: z.string().min(1).max(726),
      productId: z.uuidv7(),
    }),
    ...inventoryReadDenialResponses,
    400: inventoryDenialSchema,
    404: inventoryDenialSchema,
  },
} as const;
export const inventoryMovementHistoryPath = (productId: string): string =>
  `/inventory/items/${productId}/movements`;

export const inventoryReviewPreferencesSchema = z
  .strictObject({
    columns: z
      .array(
        z.strictObject({
          field: inventoryColumnFieldSchema,
          visible: z.boolean(),
        }),
      )
      .length(INVENTORY_COLUMN_FIELDS.length),
    revision: decimalRevisionSchema,
  })
  .superRefine((preferences, ctx) => {
    const fields = preferences.columns.map((column) => column.field);
    if (
      new Set(fields).size !== INVENTORY_COLUMN_FIELDS.length ||
      INVENTORY_COLUMN_FIELDS.some((field) => !fields.includes(field))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Each inventory field must occur exactly once",
      });
    }
    if (
      !preferences.columns.some(
        ({ field, visible }) => field === "item" && visible,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "The Item column must remain visible",
      });
    }
  });
export const inventoryReviewPreferencesUpdateRequestSchema = z.strictObject({
  columns: inventoryReviewPreferencesSchema.shape.columns,
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const inventoryReviewPreferencesReadContract = {
  method: "GET",
  path: "/inventory/review-preferences",
  responses: {
    200: inventoryReviewPreferencesSchema,
    ...catalogReadDenialResponses,
  },
} as const;
export const inventoryReviewPreferencesUpdateContract = {
  method: "PUT",
  path: "/inventory/review-preferences",
  request: { body: inventoryReviewPreferencesUpdateRequestSchema },
  responses: {
    200: inventoryReviewPreferencesSchema,
    ...catalogCommandDenialResponses,
  },
} as const;

const inventoryExportMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/u)
  .nullable();
export const inventorySensitiveExportRequestSchema = z.strictObject({
  challengeId: z.uuidv7(),
  idempotencyKey: z.uuid(),
});
export const inventorySensitiveExportSchema = z.strictObject({
  counts: z.strictObject({
    batches: inventoryCountSchema,
    items: inventoryCountSchema,
    movements: inventoryCountSchema,
  }),
  exportedAt: z.iso.datetime(),
  exportedBy: z.strictObject({
    displayName: z.string().min(1).max(96),
    id: z.uuidv7(),
  }),
  items: z.array(
    z.strictObject({
      averageUnitCostFils: inventoryExportMoneySchema,
      balance: signedIntegerStringSchema,
      batches: z.array(
        z.strictObject({
          balance: signedIntegerStringSchema,
          batchId: z.uuidv7(),
          expiryDate: z.iso.date().nullable(),
          lotNumber: z.string().min(1).max(120).nullable(),
        }),
      ),
      displayName: z.string().min(1).max(726),
      productId: z.uuidv7(),
      status: productStatusSchema,
      stockLevels: inventoryStockLevelsSchema,
      suppliers: z.array(
        z.strictObject({
          lastCostAfterDiscountFils: inventoryExportMoneySchema,
          lastInvoiceDate: z.iso.date().nullable(),
          lastPostedPurchaseId: z.uuidv7().nullable(),
          lastPrimarySupplierCostFils: inventoryExportMoneySchema,
          receiptCount: inventoryCountSchema,
          supplierId: z.uuidv7(),
          supplierName: z.string().min(1).max(160),
        }),
      ),
      valueFils: inventoryExportMoneySchema,
    }),
  ),
  pharmacyId: z.uuidv7(),
  valuationMethod: z.literal("weighted-average-cost"),
});
const inventoryCommandDenialResponses = {
  ...inventoryReadDenialResponses,
  400: inventoryDenialSchema,
  404: inventoryDenialSchema,
  409: inventoryDenialSchema,
} as const;
export const inventorySensitiveExportContract = {
  method: "POST",
  path: "/inventory/sensitive-exports",
  request: { body: inventorySensitiveExportRequestSchema },
  responses: {
    201: inventorySensitiveExportSchema,
    ...inventoryCommandDenialResponses,
  },
} as const;
/**
 * Batch safety is deliberately a separate contract family from the product
 * review grid. Batches remain immutable receipt facts; these schemas expose
 * the append-only safety facts and the server's date-based eligibility.
 */
export const BATCH_ELIGIBILITY_STATUSES = [
  "eligible",
  "near-expiry",
  "expired",
  "recalled",
  "quarantined",
  "postponed-blocked",
] as const;
export const batchEligibilityStatusSchema = z.enum(BATCH_ELIGIBILITY_STATUSES);
export const BATCH_STATUS_EVENT_KINDS = [
  "expired",
  "recalled",
  "quarantined",
] as const;
export const batchStatusEventKindSchema = z.enum(BATCH_STATUS_EVENT_KINDS);

const batchSafetyUserSchema = z.strictObject({
  displayName: z.string().min(1).max(96),
  id: z.uuidv7(),
});
const positiveIntegerStringSchema = z.string().regex(/^[1-9]\d*$/u);
const batchStatusEventSourceSchema = z.enum(["user", "daily-evaluator"]);

export const inventoryBatchStatusEventSchema = z.strictObject({
  approvalChallengeId: z.uuidv7().nullable(),
  businessDate: z.iso.date(),
  evidence: z.string().min(1).max(1_000).nullable(),
  id: z.uuidv7(),
  kind: batchStatusEventKindSchema,
  occurredAt: z.iso.datetime(),
  reason: z.string().min(1).max(500).nullable(),
  source: batchStatusEventSourceSchema,
  user: batchSafetyUserSchema.nullable(),
});

export const inventoryBatchExpiryAmendmentSchema = z.strictObject({
  approvalChallengeId: z.uuidv7(),
  businessDate: z.iso.date(),
  correctedExpiryDate: z.iso.date(),
  evidence: z.string().min(1).max(1_000),
  id: z.uuidv7(),
  occurredAt: z.iso.datetime(),
  originalExpiryDate: z.iso.date().nullable(),
  reason: z.string().min(1).max(500),
  user: batchSafetyUserSchema,
});

export const inventoryBatchSchema = z.strictObject({
  balance: nonNegativeIntegerStringSchema,
  batchId: z.uuidv7(),
  blockedSinceBusinessDate: z.iso.date().nullable(),
  daysToExpiry: signedIntegerStringSchema.nullable(),
  effectiveExpiryDate: z.iso.date().nullable(),
  expiryAmendments: z.array(inventoryBatchExpiryAmendmentSchema),
  expiryCorrected: z.boolean(),
  lotNumber: z.string().min(1).max(120).nullable(),
  nearExpiryDays: positiveIntegerStringSchema,
  originalExpiryDate: z.iso.date().nullable(),
  productId: z.uuidv7(),
  receivedAt: z.iso.datetime(),
  status: batchEligibilityStatusSchema,
  statusEvents: z.array(inventoryBatchStatusEventSchema),
});

export const inventoryBatchListContract = {
  method: "GET",
  path: "/inventory/items/:productId/batches",
  responses: {
    200: z.strictObject({
      batches: z.array(inventoryBatchSchema),
      businessDate: z.iso.date(),
    }),
    ...inventoryReadDenialResponses,
    400: inventoryDenialSchema,
    404: inventoryDenialSchema,
  },
} as const;
export const inventoryBatchListPath = (productId: string): string =>
  `/inventory/items/${productId}/batches`;

export const inventoryAllocationPreviewRequestSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        batchId: z.uuidv7().optional(),
        productId: z.uuidv7(),
        quantity: positiveIntegerStringSchema,
      }),
    )
    .min(1)
    .max(50),
});
export const inventoryAllocationPreviewSchema = z.strictObject({
  allocations: z.array(
    z.strictObject({
      batchId: z.uuidv7(),
      effectiveExpiryDate: z.iso.date().nullable(),
      productId: z.uuidv7(),
      quantity: positiveIntegerStringSchema,
      status: z.enum(["eligible", "near-expiry"]),
    }),
  ),
  blocked: z.array(
    z.strictObject({
      balance: nonNegativeIntegerStringSchema,
      batchId: z.uuidv7(),
      productId: z.uuidv7(),
      status: z.enum([
        "expired",
        "recalled",
        "quarantined",
        "postponed-blocked",
      ]),
    }),
  ),
  businessDate: z.iso.date(),
  shortfalls: z.array(
    z.strictObject({
      allocatable: nonNegativeIntegerStringSchema,
      productId: z.uuidv7(),
      requested: positiveIntegerStringSchema,
    }),
  ),
});
export const inventoryAllocationPreviewContract = {
  method: "POST",
  path: "/inventory/allocation-previews",
  request: { body: inventoryAllocationPreviewRequestSchema },
  responses: {
    200: inventoryAllocationPreviewSchema,
    ...inventoryReadDenialResponses,
    400: inventoryDenialSchema,
    409: inventoryDenialSchema,
  },
} as const;

export const inventoryBatchStatusChangeRequestSchema = z.strictObject({
  evidence: z.string().trim().min(1).max(1_000),
  idempotencyKey: z.uuid(),
  kind: z.enum(["recall", "quarantine"]),
  reason: z.string().trim().min(1).max(500),
});
export const inventoryBatchStatusChangeContract = {
  method: "POST",
  path: "/inventory/batches/:batchId/status-changes",
  request: { body: inventoryBatchStatusChangeRequestSchema },
  responses: {
    201: inventoryBatchSchema,
    ...inventoryReadDenialResponses,
    400: inventoryDenialSchema,
    404: inventoryDenialSchema,
    409: inventoryDenialSchema,
  },
} as const;
export const inventoryBatchStatusChangePath = (batchId: string): string =>
  `/inventory/batches/${batchId}/status-changes`;

export const inventoryBatchExpiryCorrectionRequestSchema = z.strictObject({
  challengeId: z.uuidv7(),
  correctedExpiryDate: z.iso.date(),
  evidence: z.string().trim().min(1).max(1_000),
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});
export const inventoryBatchExpiryCorrectionContract = {
  method: "POST",
  path: "/inventory/batches/:batchId/expiry-corrections",
  request: { body: inventoryBatchExpiryCorrectionRequestSchema },
  responses: {
    201: inventoryBatchSchema,
    ...inventoryReadDenialResponses,
    400: inventoryDenialSchema,
    404: inventoryDenialSchema,
    409: inventoryDenialSchema,
  },
} as const;
export const inventoryBatchExpiryCorrectionPath = (batchId: string): string =>
  `/inventory/batches/${batchId}/expiry-corrections`;

const inventorySafetyThresholdSchema = z.strictObject({
  class: z.enum([
    "general-item",
    "general-item-cold-chain",
    "medication",
    "medication-cold-chain",
  ]),
  expiryRequired: z.boolean(),
  lotRequired: z.boolean(),
  nearExpiryDays: positiveIntegerStringSchema,
});
export const inventoryBatchSafetyStatusSchema = z.strictObject({
  businessTimeZone: z.string().min(1).max(64),
  jobRuntime: z.enum(["available", "unavailable"]),
  lastCompletedBusinessDate: z.iso.date().nullable(),
  missedBusinessDates: z.array(z.iso.date()),
  scheduled: z.boolean(),
  state: z.enum(["current", "behind", "never-run", "time-zone-invalid"]),
  thresholds: z.strictObject({
    classes: z.array(inventorySafetyThresholdSchema),
    pendingGate: z.literal("G-02"),
  }),
  todayBusinessDate: z.iso.date(),
});
export const inventoryBatchSafetyStatusContract = {
  method: "GET",
  path: "/inventory/batch-safety/status",
  responses: {
    200: inventoryBatchSafetyStatusSchema,
    ...inventoryReadDenialResponses,
  },
} as const;
export const inventoryBatchSafetyRunContract = {
  method: "POST",
  path: "/inventory/batch-safety/runs",
  request: { body: z.strictObject({}) },
  responses: {
    202: inventoryBatchSafetyStatusSchema,
    ...inventoryReadDenialResponses,
    503: inventoryDenialSchema,
  },
} as const;

const inventoryBatchReviewSchema = inventoryBatchSchema.omit({
  expiryAmendments: true,
  statusEvents: true,
});
export const inventoryBatchSafetyReviewContract = {
  method: "GET",
  path: "/inventory/batch-safety/review",
  request: {
    query: z.strictObject({
      month: z
        .string()
        .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u)
        .optional(),
    }),
  },
  responses: {
    200: z.strictObject({
      businessDate: z.iso.date(),
      fields: z.strictObject({ valuation: z.enum(["granted", "denied"]) }),
      month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
      rows: z.array(
        z.strictObject({
          batch: inventoryBatchReviewSchema,
          carryingAmountFils: signedIntegerStringSchema.nullable(),
          daysBlocked: nonNegativeIntegerStringSchema,
          detectedOnBusinessDate: z.iso.date(),
          productDisplayName: z.string().min(1).max(726),
        }),
      ),
      runs: z.strictObject({
        completedBusinessDates: z.array(z.iso.date()),
        missedBusinessDates: z.array(z.iso.date()),
      }),
    }),
    ...inventoryReadDenialResponses,
    400: inventoryDenialSchema,
  },
} as const;

export const COUNT_LINE_STATUSES = [
  "matched",
  "pending",
  "stale",
  "applied",
] as const;
export const COUNT_RULE_IDS = [
  "inventory.count.entry-empty",
  "inventory.count.entry-not-whole",
  "inventory.count.unit-unknown",
  "inventory.count.balance-changed",
  "inventory.count.reason-required",
  "inventory.count.evidence-required",
  "inventory.count.variance-zero",
  "inventory.count.already-applied",
  "inventory.count.blocked-stock",
  "inventory.count.no-batch",
  "inventory.count.no-cost-basis",
] as const;
export const countRuleIdSchema = z.enum(COUNT_RULE_IDS);

const countPersonSchema = z.strictObject({
  displayName: z.string().min(1).max(96),
  id: z.uuidv7(),
});
const countSessionNumberSchema = z.strictObject({
  series: z.literal("C"),
  value: decimalRevisionSchema,
  year: z.number().int().min(1970).max(9999),
});
const countJournalLineSchema = z.strictObject({
  accountCode: z.enum(["inventory", "inventory-count-variance"]),
  creditFils: priceFilsSchema,
  debitFils: priceFilsSchema,
  ordinal: z.number().int().positive(),
  supplierId: z.null(),
});
const countJournalSchema = z
  .strictObject({
    entryId: z.uuidv7(),
    lines: z.array(countJournalLineSchema).min(2),
    templateId: z.literal("inventory.count"),
    templateVersion: z.number().int().positive(),
    treatment: z.literal("count-variance-account-pending-g01"),
  })
  .superRefine((journal, ctx) => {
    const debits = journal.lines.reduce(
      (sum, line) => sum + BigInt(line.debitFils),
      0n,
    );
    const credits = journal.lines.reduce(
      (sum, line) => sum + BigInt(line.creditFils),
      0n,
    );
    for (const line of journal.lines) {
      if (line.debitFils !== "0" && line.creditFils !== "0") {
        ctx.addIssue({
          code: "custom",
          message: "A journal line is either a debit or a credit, never both",
          path: ["lines"],
        });
      }
    }
    if (debits !== credits) {
      ctx.addIssue({
        code: "custom",
        message: "Count variance journal debits must equal credits",
        path: ["lines"],
      });
    }
  });

export const countEntrySchema = z.strictObject({
  count: nonNegativeIntegerStringSchema,
  unit: inventoryCapableUnitSchema,
});
export const countEntriesSchema = z
  .array(countEntrySchema)
  .min(1)
  .max(8)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      const key =
        entry.unit.kind === "inventory-unit"
          ? "inventory-unit"
          : `package-unit:${entry.unit.packageUnitName}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Each inventory unit may occur only once",
          path: [index, "unit"],
        });
      }
      seen.add(key);
    }
  });

export const countLineApplicationSchema = z.strictObject({
  appliedAt: z.iso.datetime(),
  appliedBy: countPersonSchema,
  averageUnitCostScaled: signedIntegerStringSchema.nullable(),
  balanceAfter: signedIntegerStringSchema,
  balanceBefore: signedIntegerStringSchema,
  carryingAmountFils: signedIntegerStringSchema.nullable(),
  evidence: z.string().trim().min(1).max(1_000),
  id: z.uuidv7(),
  journal: countJournalSchema.nullable(),
  movementIds: z.array(z.uuidv7()).min(1),
  reason: z.string().trim().min(1).max(500),
  treatment: z.literal("count-variance-account-pending-g01"),
  valuationMethod: z.literal("weighted-average-cost"),
  variance: signedIntegerStringSchema,
});

export const countLineSchema = z.strictObject({
  application: countLineApplicationSchema.nullable(),
  balanceAtObservation: signedIntegerStringSchema,
  blockedQuantityAtObservation: nonNegativeIntegerStringSchema,
  countedQuantity: nonNegativeIntegerStringSchema,
  currentBalance: signedIntegerStringSchema,
  currentVariance: signedIntegerStringSchema,
  enteredLabel: z.string().min(1).max(1_000),
  entries: countEntriesSchema,
  id: z.uuidv7(),
  inventoryUnitName: productUnitNameSchema,
  itemDisplayName: z.string().min(1).max(726),
  observedAt: z.iso.datetime(),
  observedBy: countPersonSchema,
  ordinal: z.number().int().positive(),
  productId: z.uuidv7(),
  status: z.enum(COUNT_LINE_STATUSES),
  varianceAtObservation: signedIntegerStringSchema,
});

export const countSessionSummarySchema = z.strictObject({
  completedAt: z.iso.datetime().nullable(),
  completedBy: countPersonSchema.nullable(),
  id: z.uuidv7(),
  lineCount: nonNegativeIntegerStringSchema,
  number: countSessionNumberSchema.nullable(),
  pendingVarianceCount: nonNegativeIntegerStringSchema,
  startedAt: z.iso.datetime(),
  startedBy: countPersonSchema,
  status: z.enum(["active", "completed"]),
  version: decimalRevisionSchema,
});
export const countSessionSchema = countSessionSummarySchema.extend({
  lines: z.array(countLineSchema),
});

export const countSessionStartRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});
export const countSessionListQuerySchema = z.strictObject({
  status: z.enum(["active", "completed"]).optional(),
});
export const countLineRecordRequestSchema = z.strictObject({
  entries: countEntriesSchema,
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  productId: z.uuidv7(),
});
export const countVarianceApplyRequestSchema = z.strictObject({
  evidence: z.string().trim().min(1).max(1_000),
  expectedBalanceBefore: signedIntegerStringSchema,
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});
export const countSessionCompleteRequestSchema = z.strictObject({
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});

const inventoryCountCommandDenialResponses = {
  ...inventoryReadDenialResponses,
  400: inventoryDenialSchema,
  404: inventoryDenialSchema,
  409: inventoryDenialSchema,
} as const;
export const countSessionStartContract = {
  method: "POST",
  path: "/inventory/count-sessions",
  request: { body: countSessionStartRequestSchema },
  responses: {
    201: countSessionSchema,
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const countSessionListContract = {
  method: "GET",
  path: "/inventory/count-sessions",
  request: { query: countSessionListQuerySchema },
  responses: {
    200: z.strictObject({ sessions: z.array(countSessionSummarySchema) }),
    ...inventoryReadDenialResponses,
  },
} as const;
export const countSessionReadContract = {
  method: "GET",
  path: "/inventory/count-sessions/:sessionId",
  responses: {
    200: countSessionSchema,
    ...inventoryReadDenialResponses,
    404: inventoryDenialSchema,
  },
} as const;
export const countLineRecordContract = {
  method: "POST",
  path: "/inventory/count-sessions/:sessionId/lines",
  request: { body: countLineRecordRequestSchema },
  responses: {
    201: z.strictObject({
      line: countLineSchema,
      session: countSessionSummarySchema,
    }),
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const countVarianceApplyContract = {
  method: "POST",
  path: "/inventory/count-sessions/:sessionId/lines/:lineId/variance-applications",
  request: { body: countVarianceApplyRequestSchema },
  responses: {
    201: z.strictObject({
      line: countLineSchema,
      session: countSessionSummarySchema,
    }),
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const countSessionCompleteContract = {
  method: "POST",
  path: "/inventory/count-sessions/:sessionId/completions",
  request: { body: countSessionCompleteRequestSchema },
  responses: {
    200: countSessionSummarySchema,
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const countSessionPath = (sessionId: string): string =>
  `/inventory/count-sessions/${sessionId}`;
export const countSessionLinesPath = (sessionId: string): string =>
  `${countSessionPath(sessionId)}/lines`;
export const countVarianceApplicationPath = (
  sessionId: string,
  lineId: string,
): string =>
  `${countSessionLinesPath(sessionId)}/${lineId}/variance-applications`;
export const countSessionCompletionPath = (sessionId: string): string =>
  `${countSessionPath(sessionId)}/completions`;

export const REORDER_ITEM_STATUSES = ["basket", "ordered"] as const;
export const REORDER_PROPOSAL_BASES = [
  "maximum-minus-balance",
  "no-maximum-level",
  "balance-at-or-above-maximum",
] as const;
export const REORDER_WARNINGS = ["surplus"] as const;
export const REORDER_ADD_OUTCOMES = [
  "added",
  "updated",
  "already-ordered",
] as const;

/**
 * A stable reorder row id is the future seam for a supplier quote row to
 * reference. Supplier prices and supplier data are intentionally not modeled
 * in this contract.
 */
export const reorderItemSchema = z.strictObject({
  addedAt: z.iso.datetime(),
  addedBy: countPersonSchema,
  id: z.uuidv7(),
  inventory: inventoryItemSchema.pick({
    balance: true,
    batches: true,
    consumptionRatePer30Days: true,
    riskIndicators: true,
    stateColour: true,
    stockLevels: true,
  }),
  orderedAt: z.iso.datetime().nullable(),
  orderedBy: countPersonSchema.nullable(),
  product: z.strictObject({
    displayName: z.string().min(1).max(726),
    inventoryUnitName: productUnitNameSchema,
    mergedIntoDisplayName: z.string().min(1).max(726).nullable(),
    mergedIntoProductId: z.uuidv7().nullable(),
    packageUnits: z.array(productPackageUnitSchema),
    status: productStatusSchema,
  }),
  productId: z.uuidv7(),
  projection: z.strictObject({
    projectedLevel: signedIntegerStringSchema,
    warning: z.enum(REORDER_WARNINGS).nullable(),
  }),
  proposal: z.strictObject({
    balance: signedIntegerStringSchema,
    basis: z.enum(REORDER_PROPOSAL_BASES),
    maximumLevel: nonNegativeIntegerStringSchema.nullable(),
    proposedAt: z.iso.datetime(),
    quantity: nonNegativeIntegerStringSchema,
  }),
  quantity: nonNegativeIntegerStringSchema,
  quantityEditedAt: z.iso.datetime().nullable(),
  status: z.enum(REORDER_ITEM_STATUSES),
  version: decimalRevisionSchema,
});

export const reorderItemAddRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  productId: z.uuidv7(),
});
export const reorderItemUpdateRequestSchema = z.strictObject({
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  quantity: nonNegativeIntegerStringSchema,
});
export const reorderItemTransitionRequestSchema = z.strictObject({
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const reorderBasketQuerySchema = z.strictObject({
  status: z.enum(REORDER_ITEM_STATUSES).optional(),
});

export const reorderBasketReadContract = {
  method: "GET",
  path: "/inventory/reorder-basket",
  request: { query: reorderBasketQuerySchema },
  responses: {
    200: z.strictObject({ items: z.array(reorderItemSchema) }),
    ...inventoryReadDenialResponses,
  },
} as const;
export const reorderItemAddContract = {
  method: "POST",
  path: "/inventory/reorder-basket/items",
  request: { body: reorderItemAddRequestSchema },
  responses: {
    200: z.strictObject({
      item: reorderItemSchema,
      outcome: z.enum(REORDER_ADD_OUTCOMES),
    }),
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const reorderItemUpdateContract = {
  method: "PUT",
  path: "/inventory/reorder-basket/items/:itemId",
  request: { body: reorderItemUpdateRequestSchema },
  responses: {
    200: z.strictObject({ item: reorderItemSchema }),
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const reorderItemRemoveContract = {
  method: "POST",
  path: "/inventory/reorder-basket/items/:itemId/removals",
  request: { body: reorderItemTransitionRequestSchema },
  responses: {
    200: z.strictObject({
      itemId: z.uuidv7(),
      removedAt: z.iso.datetime(),
    }),
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const reorderItemConfirmContract = {
  method: "POST",
  path: "/inventory/reorder-basket/items/:itemId/confirmations",
  request: { body: reorderItemTransitionRequestSchema },
  responses: {
    200: z.strictObject({ item: reorderItemSchema }),
    ...inventoryCountCommandDenialResponses,
  },
} as const;
export const reorderItemReturnContract = {
  method: "POST",
  path: "/inventory/reorder-basket/items/:itemId/returns",
  request: { body: reorderItemTransitionRequestSchema },
  responses: {
    200: z.strictObject({ item: reorderItemSchema }),
    ...inventoryCountCommandDenialResponses,
  },
} as const;

export const reorderBasketPath = (): string => "/inventory/reorder-basket";
export const reorderItemsPath = (): string => `${reorderBasketPath()}/items`;
export const reorderItemPath = (itemId: string): string =>
  `${reorderItemsPath()}/${itemId}`;
export const reorderItemRemovalsPath = (itemId: string): string =>
  `${reorderItemPath(itemId)}/removals`;
export const reorderItemConfirmationsPath = (itemId: string): string =>
  `${reorderItemPath(itemId)}/confirmations`;
export const reorderItemReturnsPath = (itemId: string): string =>
  `${reorderItemPath(itemId)}/returns`;

export const INVENTORY_CONTRACTS = [
  inventoryAllocationPreviewContract,
  inventoryBatchExpiryCorrectionContract,
  inventoryBatchListContract,
  inventoryBatchSafetyReviewContract,
  inventoryBatchSafetyRunContract,
  inventoryBatchSafetyStatusContract,
  inventoryBatchStatusChangeContract,
  inventoryItemListContract,
  inventoryMovementHistoryContract,
  inventoryReviewPreferencesReadContract,
  inventoryReviewPreferencesUpdateContract,
  inventorySensitiveExportContract,
  countLineRecordContract,
  countSessionCompleteContract,
  countSessionListContract,
  countSessionReadContract,
  countSessionStartContract,
  countVarianceApplyContract,
  reorderBasketReadContract,
  reorderItemAddContract,
  reorderItemUpdateContract,
  reorderItemRemoveContract,
  reorderItemConfirmContract,
  reorderItemReturnContract,
] as const;

const supplierNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim());
const supplierTermsSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => value === value.trim())
  .nullable();
/** Exact percentage text with at most six decimal places; never a JS number. */
export const allowancePercentageSchema = z
  .string()
  .regex(/^(?:100(?:\.0{1,6})?|(?:0|[1-9]\d?)(?:\.\d{1,6})?)$/u);
const supplierFields = {
  allowanceEffectiveFrom: z.iso.date(),
  defaultAllowancePercentage: allowancePercentageSchema,
  name: supplierNameSchema,
  terms: supplierTermsSchema,
} as const;

export const supplierSchema = z.strictObject({
  ...supplierFields,
  id: z.uuidv7(),
  mergedIntoSupplierId: z.uuidv7().nullable(),
  revision: decimalRevisionSchema,
  status: z.enum(["active", "archived", "merged"]),
});
export const supplierCreateRequestSchema = z.strictObject({
  ...supplierFields,
  idempotencyKey: z.uuid(),
});
export const supplierEditRequestSchema = z.strictObject({
  ...supplierFields,
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const supplierArchiveRequestSchema = z.strictObject({
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const supplierMergeRequestSchema = z.strictObject({
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  survivorSupplierId: z.uuidv7(),
});

export const purchaseSettlementContextSchema = z.enum(["cash", "debt"]);
const purchaseDraftHeaderFields = {
  invoiceDate: z.iso.date(),
  settlementContext: purchaseSettlementContextSchema,
  supplierId: z.uuidv7(),
  supplierInvoiceNumber: z
    .string()
    .min(1)
    .max(120)
    .refine((value) => value === value.trim()),
} as const;
export const purchaseDraftSchema = z.strictObject({
  ...purchaseDraftHeaderFields,
  allowanceSnapshot: z.strictObject({
    basisFils: z.string().regex(/^0$|^[1-9]\d*$/u),
    percentage: allowancePercentageSchema,
  }),
  createdAt: z.iso.datetime(),
  id: z.uuidv7(),
  /**
   * `posted` is terminal in the same way `discarded` is: the draft keeps its
   * committed rows as the evidence of what was posted, and no later command
   * may edit, extend, or discard it.
   */
  status: z.enum(["active", "discarded", "posted"]),
  supplierNameSnapshot: supplierNameSchema,
  updatedAt: z.iso.datetime(),
  version: decimalRevisionSchema,
});

export const PURCHASE_ENTRY_COLUMN_FIELDS = [
  "item",
  "quantity",
  "cost",
  "selling-price",
  "expiry",
] as const;
export const purchaseEntryColumnFieldSchema = z.enum(
  PURCHASE_ENTRY_COLUMN_FIELDS,
);
export const purchaseEntryColumnSchema = z.strictObject({
  field: purchaseEntryColumnFieldSchema,
  visible: z.boolean(),
});
export const PURCHASE_DETAILS_PANEL_FIELDS = [
  "category",
  "packaging",
  "scientific-name",
  "wholesale-price",
] as const;
export const purchaseDetailsPanelFieldSchema = z.enum(
  PURCHASE_DETAILS_PANEL_FIELDS,
);
export const purchaseEntryPreferencesSchema = z
  .strictObject({
    afterCommit: z.enum(["new-row", "return-to-item"]),
    columns: z
      .array(purchaseEntryColumnSchema)
      .length(PURCHASE_ENTRY_COLUMN_FIELDS.length),
    detailsPanelFields: z.array(purchaseDetailsPanelFieldSchema),
    revision: decimalRevisionSchema,
  })
  .superRefine((preferences, ctx) => {
    const fields = preferences.columns.map((column) => column.field);
    if (
      new Set(fields).size !== PURCHASE_ENTRY_COLUMN_FIELDS.length ||
      PURCHASE_ENTRY_COLUMN_FIELDS.some((field) => !fields.includes(field))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Each purchase-entry field must occur exactly once",
      });
    }
    if (
      !preferences.columns.some(
        ({ field, visible }) => field === "item" && visible,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "The Item/Barcode column must remain visible",
      });
    }
    if (
      new Set(preferences.detailsPanelFields).size !==
      preferences.detailsPanelFields.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["detailsPanelFields"],
        message: "A details-panel field may occur only once",
      });
    }
  });
export const purchaseEntryPreferencesUpdateRequestSchema = z.strictObject({
  afterCommit: purchaseEntryPreferencesSchema.shape.afterCommit,
  columns: purchaseEntryPreferencesSchema.shape.columns,
  detailsPanelFields: purchaseEntryPreferencesSchema.shape.detailsPanelFields,
  expectedRevision: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});

const nullableTrimmedPurchaseText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim())
    .nullable();
export const purchaseRowPricingInputSchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("by-price"),
    retailPriceFils: priceFilsSchema,
  }),
  z.strictObject({
    marginPercentage: marginPercentageSchema,
    method: z.literal("by-percentage"),
  }),
]);
export const purchaseDraftRowCommitRequestSchema = z.strictObject({
  costFils: priceFilsSchema,
  enteredQuantity: packageUnitRatioSchema,
  expectedVersion: decimalRevisionSchema,
  expiryDate: z.iso.date().nullable(),
  idempotencyKey: z.uuid(),
  itemId: z.uuidv7(),
  lotNumber: nullableTrimmedPurchaseText(120),
  notes: nullableTrimmedPurchaseText(1_000),
  pricing: purchaseRowPricingInputSchema,
  unit: inventoryCapableUnitSchema,
});
export const purchaseDraftRowSchema = z.strictObject({
  baseUnitsPerEnteredUnit: packageUnitRatioSchema,
  costFils: priceFilsSchema,
  createdAt: z.iso.datetime(),
  enteredQuantity: packageUnitRatioSchema,
  expiryDate: z.iso.date().nullable(),
  id: z.uuidv7(),
  inventoryUnitName: productUnitNameSchema,
  inventoryUnitQuantity: packageUnitRatioSchema,
  itemDisplayName: z.string().min(1).max(726),
  itemId: z.uuidv7(),
  lotNumber: nullableTrimmedPurchaseText(120),
  marginPercentage: marginPercentageSchema.nullable(),
  notes: nullableTrimmedPurchaseText(1_000),
  ordinal: z.number().int().positive(),
  pricingMethod: productPricingMethodSchema,
  retailPriceFils: priceFilsSchema,
  unit: inventoryCapableUnitSchema,
});
export const purchaseDraftReviewSchema = z.strictObject({
  allowanceFils: priceFilsSchema,
  batches: z.array(
    z.strictObject({
      expiryDate: z.iso.date().nullable(),
      itemDisplayName: z.string().min(1).max(726),
      lotNumber: nullableTrimmedPurchaseText(120),
    }),
  ),
  grossFils: priceFilsSchema,
  netFils: priceFilsSchema,
  settlementEffect: z.discriminatedUnion("context", [
    z.strictObject({ context: z.literal("cash"), tenderFils: priceFilsSchema }),
    z.strictObject({
      context: z.literal("debt"),
      payableFils: priceFilsSchema,
    }),
  ]),
  warnings: z.array(z.enum(["missing-expiry", "missing-lot"])),
});
export const purchaseDraftDetailSchema = purchaseDraftSchema.extend({
  review: purchaseDraftReviewSchema,
  rows: z.array(purchaseDraftRowSchema),
});
export const purchaseDraftRowCommitResultSchema = z.strictObject({
  draft: purchaseDraftDetailSchema,
  row: purchaseDraftRowSchema,
});
export const purchaseDraftWarningSchema = z.strictObject({
  code: z.literal("duplicate-supplier-invoice-number"),
  existingDraftIds: z.array(z.uuidv7()).min(1),
  operationalRule: z.literal("warn-open-decision"),
});
export const purchaseDraftResultSchema = z.strictObject({
  draft: purchaseDraftSchema,
  warnings: z.array(purchaseDraftWarningSchema),
});
export const purchaseDraftCreateRequestSchema = z.strictObject({
  ...purchaseDraftHeaderFields,
  idempotencyKey: z.uuid(),
});
export const purchaseDraftUpdateRequestSchema = z.strictObject({
  ...purchaseDraftHeaderFields,
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const purchaseDraftDiscardRequestSchema = z.strictObject({
  confirmation: z.literal("discard-populated-purchase-draft"),
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});

/**
 * Posting a Purchase Draft.
 *
 * The request carries nothing the server could take from the draft itself: the
 * command names the draft it expects to post and the version it read, and the
 * server recalculates every fact from current authoritative state
 * (docs/domain.md §"Shared transaction model"). A body that could restate a
 * cost, a quantity, or a price would be a second, unauthoritative source for
 * facts the draft already owns.
 */
export const purchasePostRequestSchema = z.strictObject({
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});

/**
 * The `P` human number of a posted purchase, as its parts rather than as one
 * printed string. The per-pharmacy, per-year sequence and its series letter are
 * settled (docs/domain.md §"Shared transaction model"); the final printed
 * presentation is still accountant/legal-gated under G-01, so the wire carries
 * the facts and the renderer composes what it shows.
 */
export const postedDocumentNumberSchema = z.strictObject({
  series: z.literal("P"),
  value: decimalRevisionSchema,
  year: z.number().int().min(1970).max(9999),
});

/**
 * How the posted row captured its retail price, per the item's pricing method
 * (docs/domain.md §"Sales, prices, settlement, and corrections", first bullet).
 * `by-price-propagated` means the invoice's approved retail price also became
 * the item's current price; `by-percentage-calculated` means the server
 * recalculated the price from the approved cost and the stored percentage and
 * left the item record alone.
 */
export const PURCHASE_PRICE_CAPTURES = [
  "by-percentage-calculated",
  "by-price-propagated",
] as const;
export const purchasePriceCaptureSchema = z.enum(PURCHASE_PRICE_CAPTURES);

export const postedPurchaseRowSchema = z.strictObject({
  baseUnitsPerEnteredUnit: packageUnitRatioSchema,
  batchId: z.uuidv7(),
  /** The informational share of this line after the invoice's allowance. */
  costAfterDiscountFils: priceFilsSchema,
  enteredQuantity: packageUnitRatioSchema,
  expiryDate: z.iso.date().nullable(),
  id: z.uuidv7(),
  inventoryUnitName: productUnitNameSchema,
  inventoryUnitQuantity: packageUnitRatioSchema,
  itemDisplayName: z.string().min(1).max(726),
  itemId: z.uuidv7(),
  /**
   * The line's full nominal value before the allowance, frozen on the movement
   * as its Carrying Amount. This — never the Cost After Discount above — is
   * what the batch, the movement, and the WAC state are valued at.
   */
  linePrimarySupplierCostFils: priceFilsSchema,
  lotNumber: nullableTrimmedPurchaseText(120),
  marginPercentage: marginPercentageSchema.nullable(),
  movementId: z.uuidv7(),
  notes: nullableTrimmedPurchaseText(1_000),
  ordinal: z.number().int().positive(),
  priceCapture: purchasePriceCaptureSchema,
  pricingMethod: productPricingMethodSchema,
  /** Primary Supplier Cost of one entered unit. */
  primarySupplierCostFils: priceFilsSchema,
  retailPriceFils: priceFilsSchema,
  unit: inventoryCapableUnitSchema,
});

/**
 * The accounts a purchase posting template may touch. A finite closed set, not
 * a user-authored rules engine (docs/domain.md §"Exact quantities, money, and
 * accounting"). The codes are stable identifiers; the pharmacy-facing account
 * names and their chart classification stay a client decision in
 * docs/open-decisions.md.
 *
 * There is no allowance account here, and its absence is the rule rather than
 * an omission. The Primary Supplier Cost is the basis for the supplier's
 * primary accounting balance, so an invoice posts at its full nominal cost on
 * both sides; the allowance becomes a real posting only at settlement, as its
 * own transaction (docs/domain.md: an allowance at settlement "is a separate
 * transaction type, never a purchase return"). A closed set with nothing to
 * spend the allowance on is what makes booking it at invoice time unspellable.
 * The inventory count variance template shares this closed account vocabulary
 * and uses `inventory-count-variance` for its G-01 working default.
 */
export const PURCHASE_POSTING_ACCOUNT_CODES = [
  "cash",
  "inventory",
  "inventory-count-variance",
  "supplier-payable",
] as const;
export const purchasePostingAccountCodeSchema = z.enum(
  PURCHASE_POSTING_ACCOUNT_CODES,
);

export const postedPurchaseJournalLineSchema = z.strictObject({
  accountCode: purchasePostingAccountCodeSchema,
  creditFils: priceFilsSchema,
  debitFils: priceFilsSchema,
  ordinal: z.number().int().positive(),
  /** Set only on a line that moves one supplier's own balance. */
  supplierId: z.uuidv7().nullable(),
});

/**
 * The journal a versioned posting template produced. Balance is part of the
 * contract, not a downstream check: an unbalanced entry cannot be spelled here,
 * cannot be written by the database, and cannot be produced by UI or report
 * code at all.
 */
export const postedPurchaseJournalSchema = z
  .strictObject({
    entryId: z.uuidv7(),
    lines: z.array(postedPurchaseJournalLineSchema).min(2),
    templateId: z.literal("purchase.invoice"),
    templateVersion: z.number().int().positive(),
  })
  .superRefine((journal, ctx) => {
    let debits = 0n;
    let credits = 0n;
    for (const line of journal.lines) {
      debits += BigInt(line.debitFils);
      credits += BigInt(line.creditFils);
      if (line.debitFils !== "0" && line.creditFils !== "0") {
        ctx.addIssue({
          code: "custom",
          path: ["lines"],
          message: "A journal line is either a debit or a credit, never both",
        });
      }
    }
    if (debits !== credits) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Journal debits must equal journal credits",
      });
    }
  });

/**
 * The immutable Posted Document. Every value it reports is a stored fact of the
 * posting, never a re-read of current master data (docs/domain.md §"Shared
 * transaction model": historical views use stored snapshots).
 */
export const postedPurchaseSchema = z.strictObject({
  /**
   * The invoice's calculated allowance, from the snapshot percentage. Stored
   * and displayed, never posted: the allowance becomes a transaction only at
   * settlement, where the actual allowance and any Allowance Difference are
   * recorded against it.
   */
  allowanceFils: priceFilsSchema,
  allowanceSnapshot: z.strictObject({
    basisFils: priceFilsSchema,
    percentage: allowancePercentageSchema,
  }),
  /**
   * Informational total after the allowance. Never a valuation basis and never
   * a journal amount -- it appears on the invoice, the review, and the supplier
   * statement, and nowhere in the posting.
   */
  costAfterDiscountFils: priceFilsSchema,
  draftId: z.uuidv7(),
  id: z.uuidv7(),
  invoiceDate: z.iso.date(),
  journal: postedPurchaseJournalSchema,
  number: postedDocumentNumberSchema,
  postedAt: z.iso.datetime(),
  postedBy: z.uuidv7(),
  /**
   * The sole basis for valuation, average item cost, later COGS, and the
   * supplier's primary accounting balance (docs/domain.md §"Exact quantities,
   * money, and accounting").
   */
  primarySupplierCostFils: priceFilsSchema,
  rows: z.array(postedPurchaseRowSchema).min(1),
  settlementContext: purchaseSettlementContextSchema,
  /**
   * What the posting put on the supplier's balance or took from cash. Both
   * carry the Primary Supplier Cost, because that is the basis the supplier's
   * balance is kept on: a settlement then clears it with a payment plus the
   * actual allowance, and posts the gap from the calculated allowance as an
   * Allowance Difference.
   */
  settlementEffect: z.discriminatedUnion("context", [
    z.strictObject({ context: z.literal("cash"), tenderFils: priceFilsSchema }),
    z.strictObject({
      context: z.literal("debt"),
      payableFils: priceFilsSchema,
    }),
  ]),
  supplierId: z.uuidv7(),
  supplierInvoiceNumber: purchaseDraftHeaderFields.supplierInvoiceNumber,
  supplierNameSnapshot: supplierNameSchema,
});

/**
 * A duplicate supplier invoice number never blocks a post. The working default
 * recorded in docs/open-decisions.md is **warn**, and it is not an approved
 * decision: `operationalRule` says so on the wire so no caller can mistake the
 * current behaviour for a settled one.
 */
export const purchasePostingWarningSchema = z.strictObject({
  code: z.literal("duplicate-supplier-invoice-number"),
  existingPostingIds: z.array(z.uuidv7()).min(1),
  operationalRule: z.literal("warn-open-decision"),
});

export const purchasePostResultSchema = z.strictObject({
  posted: postedPurchaseSchema,
  warnings: z.array(purchasePostingWarningSchema),
});

export const purchasePostedListRequestSchema = z
  .strictObject({
    direction: z.enum(["ascending", "descending"]).optional(),
    from: z.iso.date().optional(),
    query: z
      .string()
      .max(160)
      .refine((value) => value === value.trim(), {
        message: "Search query must not have surrounding whitespace",
      })
      .optional(),
    sort: z
      .enum(["invoice-date", "number", "primary-cost", "supplier"])
      .optional(),
    to: z.iso.date().optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.from !== undefined &&
      input.to !== undefined &&
      input.from > input.to
    ) {
      ctx.addIssue({
        code: "custom",
        message: "From date must not be after to date",
        path: ["from"],
      });
    }
  });

export const purchasePostedCostVisibilitySchema = z.enum([
  "visible",
  "hidden-by-permission",
  "hidden-by-setting",
]);

const nullableReviewCostSchema = priceFilsSchema.nullable();
export const purchasePostedListItemSchema = z.strictObject({
  costAfterDiscountFils: nullableReviewCostSchema,
  id: z.uuidv7(),
  invoiceDate: z.iso.date(),
  itemCount: z.number().int().positive(),
  number: postedDocumentNumberSchema,
  postedAt: z.iso.datetime(),
  primarySupplierCostFils: nullableReviewCostSchema,
  settlementContext: purchaseSettlementContextSchema,
  supplierInvoiceNumber: purchaseDraftHeaderFields.supplierInvoiceNumber,
  supplierNameSnapshot: supplierNameSchema,
});

export const purchasePostedListResponseSchema = z
  .strictObject({
    costVisibility: purchasePostedCostVisibilitySchema,
    purchases: z.array(purchasePostedListItemSchema),
  })
  .superRefine((response, ctx) => {
    const costsAreVisible = response.costVisibility === "visible";
    response.purchases.forEach((purchase, index) => {
      for (const field of [
        "costAfterDiscountFils",
        "primarySupplierCostFils",
      ] as const) {
        if ((purchase[field] !== null) !== costsAreVisible) {
          ctx.addIssue({
            code: "custom",
            message: "Review costs must follow the server visibility decision",
            path: ["purchases", index, field],
          });
        }
      }
    });
  });

export const PURCHASE_ADJUSTMENT_REASONS = [
  "quantity error",
  "price error",
  "invoice-number error",
  "supplier error",
  "other",
] as const;
export const purchaseAdjustmentReasonSchema = z.enum(
  PURCHASE_ADJUSTMENT_REASONS,
);
const purchaseAdjustmentEvidenceSchema = nullableTrimmedPurchaseText(1_000);
export const purchaseAdjustmentNumberSchema = z.strictObject({
  original: postedDocumentNumberSchema,
  suffix: decimalRevisionSchema,
});
export const purchasePostedAdjustmentLinkSchema = z.strictObject({
  id: z.uuidv7(),
  number: purchaseAdjustmentNumberSchema,
  postedAt: z.iso.datetime(),
  postedBy: z.uuidv7(),
  primarySupplierCostDeltaFils: signedBigintSchema.nullable(),
  quantityDelta: signedBigintSchema,
  reason: purchaseAdjustmentReasonSchema,
});
export const purchaseActiveAdjustmentDraftSchema = z.strictObject({
  id: z.uuidv7(),
  updatedAt: z.iso.datetime(),
  version: decimalRevisionSchema,
});
export const purchasePostedReturnLinkSchema = z.strictObject({
  id: z.uuidv7(),
  inventoryCarryingAmountFils: nullableReviewCostSchema,
  number: z.strictObject({
    series: z.literal("PR"),
    value: decimalRevisionSchema,
    year: z.number().int().min(1970).max(9999),
  }),
  postedAt: z.iso.datetime(),
  postedBy: z.uuidv7(),
  reason: z.string().trim().min(1).max(500),
  supplierReductionFils: nullableReviewCostSchema,
});
export const purchaseActiveReturnDraftSchema = z.strictObject({
  id: z.uuidv7(),
  updatedAt: z.iso.datetime(),
  version: decimalRevisionSchema,
});

export const purchasePostedDetailRowSchema = z.strictObject({
  baseUnitsPerEnteredUnit: packageUnitRatioSchema,
  costAfterDiscountFils: nullableReviewCostSchema,
  enteredQuantity: packageUnitRatioSchema,
  expiryDate: z.iso.date().nullable(),
  id: z.uuidv7(),
  inventoryUnitName: productUnitNameSchema,
  inventoryUnitQuantity: packageUnitRatioSchema,
  itemDisplayName: z.string().min(1).max(726),
  itemId: z.uuidv7(),
  linePrimarySupplierCostFils: nullableReviewCostSchema,
  lotNumber: nullableTrimmedPurchaseText(120),
  ordinal: z.number().int().positive(),
  primarySupplierCostFils: nullableReviewCostSchema,
  retailPriceFils: priceFilsSchema,
  unit: inventoryCapableUnitSchema,
});

export const purchasePostedDetailSchema = z
  .strictObject({
    activeAdjustmentDrafts: z.array(purchaseActiveAdjustmentDraftSchema),
    activeReturnDrafts: z.array(purchaseActiveReturnDraftSchema),
    adjustments: z.array(purchasePostedAdjustmentLinkSchema),
    allowanceFils: nullableReviewCostSchema,
    allowancePercentageSnapshot: allowancePercentageSchema.nullable(),
    costAfterDiscountFils: nullableReviewCostSchema,
    costVisibility: purchasePostedCostVisibilitySchema,
    canAdjust: z.boolean(),
    canReturn: z.boolean(),
    id: z.uuidv7(),
    invoiceDate: z.iso.date(),
    navigation: z.strictObject({
      nextId: z.uuidv7().nullable(),
      position: z.number().int().positive(),
      previousId: z.uuidv7().nullable(),
      total: z.number().int().positive(),
    }),
    number: postedDocumentNumberSchema,
    postedAt: z.iso.datetime(),
    postedBy: z.uuidv7(),
    primarySupplierCostFils: nullableReviewCostSchema,
    returns: z.array(purchasePostedReturnLinkSchema),
    rows: z.array(purchasePostedDetailRowSchema).min(1),
    settlementContext: purchaseSettlementContextSchema,
    supplierId: z.uuidv7(),
    supplierInvoiceNumber: purchaseDraftHeaderFields.supplierInvoiceNumber,
    supplierNameSnapshot: supplierNameSchema,
  })
  .superRefine((purchase, ctx) => {
    const costsAreVisible = purchase.costVisibility === "visible";
    const headerCosts = [
      "allowanceFils",
      "allowancePercentageSnapshot",
      "costAfterDiscountFils",
      "primarySupplierCostFils",
    ] as const;
    for (const field of headerCosts) {
      if ((purchase[field] !== null) !== costsAreVisible) {
        ctx.addIssue({
          code: "custom",
          message: "Review costs must follow the server visibility decision",
          path: [field],
        });
      }
    }
    purchase.rows.forEach((row, index) => {
      for (const field of [
        "costAfterDiscountFils",
        "linePrimarySupplierCostFils",
        "primarySupplierCostFils",
      ] as const) {
        if ((row[field] !== null) !== costsAreVisible) {
          ctx.addIssue({
            code: "custom",
            message: "Review costs must follow the server visibility decision",
            path: ["rows", index, field],
          });
        }
      }
    });
  });

export const PURCHASE_ADJUSTMENT_FIELDS = [
  "entered-quantity",
  "primary-supplier-cost",
  "retail-price",
  "supplier",
  "supplier-invoice-number",
] as const;
export const purchaseAdjustmentFieldSchema = z.enum(PURCHASE_ADJUSTMENT_FIELDS);
export const purchaseAdjustmentFieldChangeSchema = z.strictObject({
  after: z.string().nullable(),
  before: z.string().nullable(),
  field: purchaseAdjustmentFieldSchema,
});
const purchaseAdjustmentSnapshotRowFields = {
  baseUnitsPerEnteredUnit: packageUnitRatioSchema,
  batchId: z.uuidv7().nullable(),
  costFils: priceFilsSchema,
  enteredQuantity: packageUnitRatioSchema,
  expiryDate: z.iso.date().nullable(),
  inventoryUnitName: productUnitNameSchema,
  inventoryUnitQuantity: packageUnitRatioSchema,
  itemDisplayName: z.string().min(1).max(726),
  itemId: z.uuidv7(),
  lineageId: z.uuidv7(),
  lotNumber: nullableTrimmedPurchaseText(120),
  marginPercentage: marginPercentageSchema.nullable(),
  notes: nullableTrimmedPurchaseText(1_000),
  ordinal: z.number().int().positive(),
  originalRowId: z.uuidv7().nullable(),
  pricingMethod: productPricingMethodSchema,
  retailPriceFils: priceFilsSchema,
  unit: inventoryCapableUnitSchema,
} as const;
export const purchaseAdjustmentSnapshotRowSchema = z.strictObject(
  purchaseAdjustmentSnapshotRowFields,
);
export const purchaseAdjustmentDraftRowSchema = z.strictObject({
  ...purchaseAdjustmentSnapshotRowFields,
  id: z.uuidv7(),
});
export const purchaseAdjustmentDraftRowInputSchema = z.strictObject({
  costFils: priceFilsSchema,
  enteredQuantity: packageUnitRatioSchema,
  expiryDate: z.iso.date().nullable(),
  itemId: z.uuidv7(),
  lineageId: z.uuidv7().nullable(),
  lotNumber: nullableTrimmedPurchaseText(120),
  notes: nullableTrimmedPurchaseText(1_000),
  originalRowId: z.uuidv7().nullable(),
  pricing: purchaseRowPricingInputSchema,
  unit: inventoryCapableUnitSchema,
});
export const purchaseAdjustmentDraftSchema = z.strictObject({
  allowancePercentageSnapshot: allowancePercentageSchema,
  createdAt: z.iso.datetime(),
  evidence: purchaseAdjustmentEvidenceSchema,
  id: z.uuidv7(),
  invoiceDate: z.iso.date(),
  originalNumber: postedDocumentNumberSchema,
  originalPurchaseId: z.uuidv7(),
  reason: purchaseAdjustmentReasonSchema,
  rows: z.array(purchaseAdjustmentDraftRowSchema).max(500),
  settlementContext: purchaseSettlementContextSchema,
  status: z.enum(["active", "discarded", "posted"]),
  supplierId: z.uuidv7(),
  supplierInvoiceNumber: purchaseDraftHeaderFields.supplierInvoiceNumber,
  supplierNameSnapshot: supplierNameSchema,
  updatedAt: z.iso.datetime(),
  version: decimalRevisionSchema,
});
export const purchaseAdjustmentDraftCreateRequestSchema = z.strictObject({
  evidence: purchaseAdjustmentEvidenceSchema,
  idempotencyKey: z.uuid(),
  reason: purchaseAdjustmentReasonSchema,
});
export const purchaseAdjustmentDraftUpdateRequestSchema = z.strictObject({
  evidence: purchaseAdjustmentEvidenceSchema,
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  reason: purchaseAdjustmentReasonSchema,
  rows: z.array(purchaseAdjustmentDraftRowInputSchema).max(500),
  supplierId: z.uuidv7(),
  supplierInvoiceNumber: purchaseDraftHeaderFields.supplierInvoiceNumber,
});
export const purchaseAdjustmentDraftDiscardRequestSchema = z.strictObject({
  confirmation: z.literal("discard-purchase-adjustment-draft"),
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const purchaseAdjustmentRowDeltaSchema = z.strictObject({
  after: purchaseAdjustmentSnapshotRowSchema.nullable(),
  before: purchaseAdjustmentSnapshotRowSchema.nullable(),
  changes: z.array(purchaseAdjustmentFieldChangeSchema),
  kind: z.enum(["added", "changed", "removed"]),
  lineageId: z.uuidv7(),
  primarySupplierCostDeltaFils: signedBigintSchema,
  quantityDelta: signedBigintSchema,
});
export const purchaseAdjustmentSummarySchema = z.strictObject({
  allowanceDeltaFils: signedBigintSchema,
  confirmationHash: z.string().regex(/^[0-9a-f]{64}$/u),
  costAfterDiscountDeltaFils: signedBigintSchema,
  draftId: z.uuidv7(),
  draftVersion: decimalRevisionSchema,
  headerChanges: z.array(purchaseAdjustmentFieldChangeSchema),
  primarySupplierCostDeltaFils: signedBigintSchema,
  quantityDelta: signedBigintSchema,
  rowDeltas: z.array(purchaseAdjustmentRowDeltaSchema),
  stockEffects: z.array(
    z.strictObject({
      batchId: z.uuidv7().nullable(),
      itemDisplayName: z.string().min(1).max(726),
      itemId: z.uuidv7(),
      primarySupplierCostDeltaFils: signedBigintSchema,
      quantityDelta: signedBigintSchema,
    }),
  ),
  supplierEffects: z.array(
    z.strictObject({
      deltaFils: signedBigintSchema,
      supplierId: z.uuidv7(),
      supplierNameSnapshot: supplierNameSchema,
    }),
  ),
});
export const purchaseAdjustmentPostRequestSchema = z.strictObject({
  confirmationHash: z.string().regex(/^[0-9a-f]{64}$/u),
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const purchaseAdjustmentJournalSchema = z
  .strictObject({
    entryId: z.uuidv7(),
    lines: z.array(postedPurchaseJournalLineSchema),
    templateId: z.literal("purchase.adjustment"),
    templateVersion: z.number().int().positive(),
  })
  .superRefine((journal, ctx) => {
    const debits = journal.lines.reduce(
      (sum, line) => sum + BigInt(line.debitFils),
      0n,
    );
    const credits = journal.lines.reduce(
      (sum, line) => sum + BigInt(line.creditFils),
      0n,
    );
    if (debits !== credits) {
      ctx.addIssue({
        code: "custom",
        message: "Adjustment journal debits must equal credits",
        path: ["lines"],
      });
    }
  });
export const postedPurchaseAdjustmentSchema = z.strictObject({
  allowanceDeltaFils: signedBigintSchema,
  costAfterDiscountDeltaFils: signedBigintSchema,
  draftId: z.uuidv7(),
  evidence: purchaseAdjustmentEvidenceSchema,
  headerChanges: z.array(purchaseAdjustmentFieldChangeSchema),
  id: z.uuidv7(),
  journal: purchaseAdjustmentJournalSchema,
  number: purchaseAdjustmentNumberSchema,
  originalPurchaseId: z.uuidv7(),
  postedAt: z.iso.datetime(),
  postedBy: z.uuidv7(),
  primarySupplierCostDeltaFils: signedBigintSchema,
  quantityDelta: signedBigintSchema,
  reason: purchaseAdjustmentReasonSchema,
  rowDeltas: z.array(
    purchaseAdjustmentRowDeltaSchema.extend({
      movementId: z.uuidv7().nullable(),
      valueEffectId: z.uuidv7().nullable(),
    }),
  ),
  supplierId: z.uuidv7(),
  supplierInvoiceNumber: purchaseDraftHeaderFields.supplierInvoiceNumber,
  supplierNameSnapshot: supplierNameSchema,
});
export const purchaseAdjustmentPostResultSchema = z.strictObject({
  posted: postedPurchaseAdjustmentSchema,
});

/** A Purchase Return has its own pharmacy/year PR series. */
export const purchaseReturnNumberSchema = z.strictObject({
  series: z.literal("PR"),
  value: decimalRevisionSchema,
  year: z.number().int().min(1970).max(9999),
});
export const purchaseReturnReasonSchema = z.string().trim().min(1).max(500);
export const purchaseReturnEvidenceSchema = z.string().trim().min(1).max(1_000);
export const purchaseReturnDraftRowSchema = z.strictObject({
  batchId: z.uuidv7(),
  id: z.uuidv7(),
  inventoryUnitName: productUnitNameSchema,
  itemDisplayName: z.string().min(1).max(726),
  itemId: z.uuidv7(),
  originalPurchaseRowId: z.uuidv7(),
  originalQuantity: packageUnitRatioSchema,
  previouslyReturnedQuantity: priceFilsSchema,
  remainingEligibleQuantity: priceFilsSchema,
  returnQuantity: priceFilsSchema,
});
export const purchaseReturnDraftSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  evidence: purchaseReturnEvidenceSchema,
  id: z.uuidv7(),
  originalInvoiceDate: z.iso.date(),
  originalNumber: postedDocumentNumberSchema,
  originalPurchaseId: z.uuidv7(),
  reason: purchaseReturnReasonSchema,
  rows: z.array(purchaseReturnDraftRowSchema).min(1).max(500),
  status: z.enum(["active", "discarded", "posted"]),
  supplierId: z.uuidv7(),
  supplierNameSnapshot: supplierNameSchema,
  updatedAt: z.iso.datetime(),
  version: decimalRevisionSchema,
});
export const purchaseReturnDraftCreateRequestSchema = z.strictObject({
  evidence: purchaseReturnEvidenceSchema,
  idempotencyKey: z.uuid(),
  reason: purchaseReturnReasonSchema,
});
export const purchaseReturnDraftUpdateRequestSchema = z.strictObject({
  evidence: purchaseReturnEvidenceSchema,
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  reason: purchaseReturnReasonSchema,
  rows: z
    .array(
      z.strictObject({
        originalPurchaseRowId: z.uuidv7(),
        returnQuantity: priceFilsSchema,
      }),
    )
    .min(1)
    .max(500),
});
export const purchaseReturnDraftDiscardRequestSchema = z.strictObject({
  confirmation: z.literal("discard-purchase-return-draft"),
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
});
export const purchaseReturnSummaryRowSchema = z.strictObject({
  batchId: z.uuidv7(),
  carryingAmountFils: priceFilsSchema,
  carryingAmountPerUnitScaled: priceFilsSchema,
  inventoryUnitName: productUnitNameSchema,
  itemDisplayName: z.string().min(1).max(726),
  itemId: z.uuidv7(),
  originalPurchaseRowId: z.uuidv7(),
  quantity: packageUnitRatioSchema,
  supplierReductionFils: priceFilsSchema,
  valuationMethod: z.literal("weighted-average-cost"),
});
export const purchaseReturnSummarySchema = z.strictObject({
  confirmationHash: z.string().regex(/^[0-9a-f]{64}$/u),
  draftId: z.uuidv7(),
  draftVersion: decimalRevisionSchema,
  inventoryCarryingAmountFils: priceFilsSchema,
  rows: z.array(purchaseReturnSummaryRowSchema).min(1),
  supplierReductionFils: priceFilsSchema,
});
export const purchaseReturnPostRequestSchema = z.strictObject({
  confirmationHash: z.string().regex(/^[0-9a-f]{64}$/u),
  expectedVersion: decimalRevisionSchema,
  idempotencyKey: z.uuid(),
  stepUpChallengeId: z.uuidv7(),
});
export const PURCHASE_RETURN_G01_WORKING_DEFAULT =
  "inventory-account-offset-pending-g01" as const;
export const COUNT_VARIANCE_G01_WORKING_DEFAULT =
  "count-variance-account-pending-g01" as const;
export const purchaseReturnJournalSchema = z
  .strictObject({
    entryId: z.uuidv7(),
    lines: z.array(postedPurchaseJournalLineSchema).min(2),
    templateId: z.literal("purchase.return"),
    templateVersion: z.number().int().positive(),
    treatment: z.literal(PURCHASE_RETURN_G01_WORKING_DEFAULT),
  })
  .superRefine((journal, ctx) => {
    const debits = journal.lines.reduce(
      (sum, line) => sum + BigInt(line.debitFils),
      0n,
    );
    const credits = journal.lines.reduce(
      (sum, line) => sum + BigInt(line.creditFils),
      0n,
    );
    if (debits !== credits) {
      ctx.addIssue({
        code: "custom",
        message: "Purchase Return journal debits must equal credits",
        path: ["lines"],
      });
    }
  });
export const postedPurchaseReturnRowSchema =
  purchaseReturnSummaryRowSchema.extend({
    id: z.uuidv7(),
    movementId: z.uuidv7(),
  });
export const postedPurchaseReturnSchema = z.strictObject({
  approvalChallengeId: z.uuidv7(),
  deviceId: z.string().min(1).max(200),
  draftId: z.uuidv7(),
  evidence: purchaseReturnEvidenceSchema,
  id: z.uuidv7(),
  inventoryCarryingAmountFils: priceFilsSchema,
  journal: purchaseReturnJournalSchema,
  number: purchaseReturnNumberSchema,
  originalInvoiceDate: z.iso.date(),
  originalNumber: postedDocumentNumberSchema,
  originalPurchaseId: z.uuidv7(),
  postedAt: z.iso.datetime(),
  postedBy: z.uuidv7(),
  reason: purchaseReturnReasonSchema,
  rows: z.array(postedPurchaseReturnRowSchema).min(1),
  supplierId: z.uuidv7(),
  supplierNameSnapshot: supplierNameSchema,
  supplierReductionFils: priceFilsSchema,
});
export const purchaseReturnPostResultSchema = z.strictObject({
  posted: postedPurchaseReturnSchema,
});

export const PURCHASING_FIELD_ERROR_CODES = [
  "invalid",
  "out-of-range",
  "required",
  "too-long",
  "unknown-field",
] as const;
/**
 * The domain rules a purchasing rejection can name, as stable identifiers.
 *
 * A rejection has to identify "the field/rule" (docs/workflows.md §"Purchase
 * and receive", step 6) precisely enough for the renderer to put focus back on
 * the offending cell and announce why. `path` locates the field; `rule` names
 * the rule that refused it, which is not always recoverable from the denial
 * code alone — one `body-invalid` post can fail for a missing expiry on row 3
 * and a missing lot on row 5.
 */
export const PURCHASING_RULE_IDS = [
  "purchase.adjustment.batch-insufficient",
  "purchase.adjustment.batch-invalid",
  "purchase.adjustment.empty",
  "purchase.adjustment.original-row-invalid",
  "purchase.adjustment.summary-stale",
  "purchase.adjustment.valuation-invalid",
  "purchase.return.empty",
  "purchase.return.ineligible-batch",
  "purchase.return.negative-stock",
  "purchase.return.over-return",
  "purchase.return.summary-stale",
  "purchase.post.draft-empty",
  "purchase.post.item-unavailable",
  "purchase.post.lot-required-at-receipt",
  "purchase.post.expiry-required-at-receipt",
  "purchase.post.packaging-unit-unavailable",
  "purchase.post.pricing-mode-changed",
  "purchase.post.money-overflow",
] as const;
export const purchasingRuleIdSchema = z.enum(PURCHASING_RULE_IDS);
export const purchasingFieldErrorSchema = z.strictObject({
  code: z.enum(PURCHASING_FIELD_ERROR_CODES),
  path: z
    .array(z.union([z.string().min(1), z.number().int().min(0)]))
    .min(1)
    .max(8),
  rule: purchasingRuleIdSchema.optional(),
});
export const PURCHASING_DENIAL_CODES = [
  "adjustment-batch-conflict",
  "adjustment-draft-discarded",
  "adjustment-draft-not-found",
  "adjustment-draft-posted",
  "adjustment-empty",
  "adjustment-original-not-found",
  "adjustment-summary-stale",
  "body-invalid",
  "draft-discarded",
  "draft-empty",
  "draft-not-found",
  "draft-posted",
  "expiry-required",
  "lot-required",
  "idempotency-conflict",
  "item-not-found",
  "item-unavailable",
  "money-overflow",
  "pricing-mode-conflict",
  "return-draft-discarded",
  "return-draft-not-found",
  "return-draft-posted",
  "return-empty",
  "return-ineligible-batch",
  "return-negative-stock",
  "return-original-not-found",
  "return-over-eligible",
  "return-summary-stale",
  "posted-purchase-not-found",
  "unit-invalid",
  "merge-into-self",
  "merge-survivor-not-mergeable",
  "allowance-rate-date-conflict",
  "supplier-no-rate-on-date",
  "supplier-archived",
  "supplier-merged",
  "supplier-not-found",
  "version-conflict",
] as const;
export const purchasingDenialSchema = z.strictObject({
  code: z.enum(PURCHASING_DENIAL_CODES),
  fieldErrors: z.array(purchasingFieldErrorSchema),
  requestId: z.uuidv7(),
  status: z.literal("denied"),
});
const purchasingReadDenialResponses = {
  401: identityDenialSchema,
  403: identityOrEntitlementDenialSchema,
} as const;
const purchasingCommandDenialResponses = {
  ...purchasingReadDenialResponses,
  400: purchasingDenialSchema,
  404: purchasingDenialSchema,
  409: purchasingDenialSchema,
} as const;

export const supplierListContract = {
  method: "GET",
  path: "/suppliers",
  responses: {
    200: z.strictObject({ suppliers: z.array(supplierSchema) }),
    ...purchasingReadDenialResponses,
  },
} as const;
export const supplierReadContract = {
  method: "GET",
  path: "/suppliers/:supplierId",
  responses: {
    200: supplierSchema,
    ...purchasingReadDenialResponses,
    404: purchasingDenialSchema,
  },
} as const;
export const supplierCreateContract = {
  method: "POST",
  path: "/suppliers",
  request: { body: supplierCreateRequestSchema },
  responses: { 201: supplierSchema, ...purchasingCommandDenialResponses },
} as const;
export const supplierEditContract = {
  method: "PUT",
  path: "/suppliers/:supplierId",
  request: { body: supplierEditRequestSchema },
  responses: { 200: supplierSchema, ...purchasingCommandDenialResponses },
} as const;
export const supplierArchiveContract = {
  method: "POST",
  path: "/suppliers/:supplierId/archivals",
  request: { body: supplierArchiveRequestSchema },
  responses: { 201: supplierSchema, ...purchasingCommandDenialResponses },
} as const;
export const supplierMergeContract = {
  method: "POST",
  path: "/suppliers/:supplierId/merges",
  request: { body: supplierMergeRequestSchema },
  responses: { 201: supplierSchema, ...purchasingCommandDenialResponses },
} as const;
export const purchaseDraftListContract = {
  method: "GET",
  path: "/purchases/drafts",
  responses: {
    200: z.strictObject({ drafts: z.array(purchaseDraftSchema) }),
    ...purchasingReadDenialResponses,
  },
} as const;
export const purchaseDraftReadContract = {
  method: "GET",
  path: "/purchases/drafts/:draftId",
  responses: {
    200: purchaseDraftDetailSchema,
    ...purchasingReadDenialResponses,
    404: purchasingDenialSchema,
  },
} as const;
export const purchaseEntryPreferencesReadContract = {
  method: "GET",
  path: "/purchases/entry-preferences",
  responses: {
    200: purchaseEntryPreferencesSchema,
    ...purchasingReadDenialResponses,
  },
} as const;
export const purchaseEntryPreferencesUpdateContract = {
  method: "PUT",
  path: "/purchases/entry-preferences",
  request: { body: purchaseEntryPreferencesUpdateRequestSchema },
  responses: {
    200: purchaseEntryPreferencesSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseDraftRowCommitContract = {
  method: "POST",
  path: "/purchases/drafts/:draftId/rows",
  request: { body: purchaseDraftRowCommitRequestSchema },
  responses: {
    201: purchaseDraftRowCommitResultSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseDraftCreateContract = {
  method: "POST",
  path: "/purchases/drafts",
  request: { body: purchaseDraftCreateRequestSchema },
  responses: {
    201: purchaseDraftResultSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseDraftUpdateContract = {
  method: "PUT",
  path: "/purchases/drafts/:draftId/header",
  request: { body: purchaseDraftUpdateRequestSchema },
  responses: {
    200: purchaseDraftResultSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseDraftDiscardContract = {
  method: "POST",
  path: "/purchases/drafts/:draftId/discards",
  request: { body: purchaseDraftDiscardRequestSchema },
  responses: {
    201: purchaseDraftSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
/**
 * Posting is a separate explicit action on its own sub-resource, never a state
 * field on the draft header (docs/workflows.md §"Purchase and receive", step 4:
 * "Posting requires a separate explicit action"). Creating a posting is a POST
 * that returns the created immutable document.
 */
export const purchasePostContract = {
  method: "POST",
  path: "/purchases/drafts/:draftId/postings",
  request: { body: purchasePostRequestSchema },
  responses: {
    201: purchasePostResultSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchasePostedListContract = {
  method: "GET",
  path: "/purchases/posted",
  request: { query: purchasePostedListRequestSchema },
  responses: {
    200: purchasePostedListResponseSchema,
    ...purchasingReadDenialResponses,
  },
} as const;
export const purchasePostedReadContract = {
  method: "GET",
  path: "/purchases/posted/:purchaseId",
  responses: {
    200: purchasePostedDetailSchema,
    ...purchasingReadDenialResponses,
    404: purchasingDenialSchema,
  },
} as const;
export const purchaseAdjustmentDraftCreateContract = {
  method: "POST",
  path: "/purchases/posted/:purchaseId/adjustment-drafts",
  request: { body: purchaseAdjustmentDraftCreateRequestSchema },
  responses: {
    201: purchaseAdjustmentDraftSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseAdjustmentDraftReadContract = {
  method: "GET",
  path: "/purchases/adjustment-drafts/:draftId",
  responses: {
    200: purchaseAdjustmentDraftSchema,
    ...purchasingReadDenialResponses,
    404: purchasingDenialSchema,
  },
} as const;
export const purchaseAdjustmentDraftUpdateContract = {
  method: "PUT",
  path: "/purchases/adjustment-drafts/:draftId",
  request: { body: purchaseAdjustmentDraftUpdateRequestSchema },
  responses: {
    200: purchaseAdjustmentDraftSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseAdjustmentDraftDiscardContract = {
  method: "POST",
  path: "/purchases/adjustment-drafts/:draftId/discards",
  request: { body: purchaseAdjustmentDraftDiscardRequestSchema },
  responses: {
    201: purchaseAdjustmentDraftSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseAdjustmentSummaryReadContract = {
  method: "GET",
  path: "/purchases/adjustment-drafts/:draftId/summary",
  responses: {
    200: purchaseAdjustmentSummarySchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseAdjustmentPostContract = {
  method: "POST",
  path: "/purchases/adjustment-drafts/:draftId/postings",
  request: { body: purchaseAdjustmentPostRequestSchema },
  responses: {
    201: purchaseAdjustmentPostResultSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchasePostedAdjustmentReadContract = {
  method: "GET",
  path: "/purchases/posted-adjustments/:adjustmentId",
  responses: {
    200: postedPurchaseAdjustmentSchema,
    ...purchasingReadDenialResponses,
    404: purchasingDenialSchema,
  },
} as const;
export const purchaseReturnDraftCreateContract = {
  method: "POST",
  path: "/purchases/posted/:purchaseId/return-drafts",
  request: { body: purchaseReturnDraftCreateRequestSchema },
  responses: {
    201: purchaseReturnDraftSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseReturnDraftReadContract = {
  method: "GET",
  path: "/purchases/return-drafts/:draftId",
  responses: {
    200: purchaseReturnDraftSchema,
    ...purchasingReadDenialResponses,
    404: purchasingDenialSchema,
  },
} as const;
export const purchaseReturnDraftUpdateContract = {
  method: "PUT",
  path: "/purchases/return-drafts/:draftId",
  request: { body: purchaseReturnDraftUpdateRequestSchema },
  responses: {
    200: purchaseReturnDraftSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseReturnDraftDiscardContract = {
  method: "POST",
  path: "/purchases/return-drafts/:draftId/discards",
  request: { body: purchaseReturnDraftDiscardRequestSchema },
  responses: {
    201: purchaseReturnDraftSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseReturnSummaryReadContract = {
  method: "GET",
  path: "/purchases/return-drafts/:draftId/summary",
  responses: {
    200: purchaseReturnSummarySchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchaseReturnPostContract = {
  method: "POST",
  path: "/purchases/return-drafts/:draftId/postings",
  request: { body: purchaseReturnPostRequestSchema },
  responses: {
    201: purchaseReturnPostResultSchema,
    ...purchasingCommandDenialResponses,
  },
} as const;
export const purchasePostedReturnReadContract = {
  method: "GET",
  path: "/purchases/posted-returns/:returnId",
  responses: {
    200: postedPurchaseReturnSchema,
    ...purchasingReadDenialResponses,
    404: purchasingDenialSchema,
  },
} as const;

export const supplierPath = (supplierId: string): string =>
  `/suppliers/${supplierId}`;
export const supplierArchivePath = (supplierId: string): string =>
  `/suppliers/${supplierId}/archivals`;
export const supplierMergePath = (supplierId: string): string =>
  `/suppliers/${supplierId}/merges`;
export const purchaseDraftPath = (draftId: string): string =>
  `/purchases/drafts/${draftId}`;
export const purchaseDraftHeaderPath = (draftId: string): string =>
  `/purchases/drafts/${draftId}/header`;
export const purchaseDraftDiscardPath = (draftId: string): string =>
  `/purchases/drafts/${draftId}/discards`;
export const purchaseDraftRowsPath = (draftId: string): string =>
  `/purchases/drafts/${draftId}/rows`;
export const purchaseDraftPostingsPath = (draftId: string): string =>
  `/purchases/drafts/${draftId}/postings`;
export const purchasePostedPath = (purchaseId: string): string =>
  `/purchases/posted/${purchaseId}`;
export const purchaseAdjustmentDraftsPath = (purchaseId: string): string =>
  `/purchases/posted/${purchaseId}/adjustment-drafts`;
export const purchaseAdjustmentDraftPath = (draftId: string): string =>
  `/purchases/adjustment-drafts/${draftId}`;
export const purchaseAdjustmentDraftDiscardPath = (draftId: string): string =>
  `/purchases/adjustment-drafts/${draftId}/discards`;
export const purchaseAdjustmentSummaryPath = (draftId: string): string =>
  `/purchases/adjustment-drafts/${draftId}/summary`;
export const purchaseAdjustmentPostingsPath = (draftId: string): string =>
  `/purchases/adjustment-drafts/${draftId}/postings`;
export const purchasePostedAdjustmentPath = (adjustmentId: string): string =>
  `/purchases/posted-adjustments/${adjustmentId}`;
export const purchaseReturnDraftsPath = (purchaseId: string): string =>
  `/purchases/posted/${purchaseId}/return-drafts`;
export const purchaseReturnDraftPath = (draftId: string): string =>
  `/purchases/return-drafts/${draftId}`;
export const purchaseReturnDraftDiscardPath = (draftId: string): string =>
  `/purchases/return-drafts/${draftId}/discards`;
export const purchaseReturnSummaryPath = (draftId: string): string =>
  `/purchases/return-drafts/${draftId}/summary`;
export const purchaseReturnPostingsPath = (draftId: string): string =>
  `/purchases/return-drafts/${draftId}/postings`;
export const purchasePostedReturnPath = (returnId: string): string =>
  `/purchases/posted-returns/${returnId}`;

export const PURCHASING_CONTRACTS = [
  supplierArchiveContract,
  supplierCreateContract,
  supplierEditContract,
  supplierListContract,
  supplierMergeContract,
  supplierReadContract,
  purchaseDraftCreateContract,
  purchaseDraftDiscardContract,
  purchaseDraftListContract,
  purchaseDraftReadContract,
  purchaseDraftRowCommitContract,
  purchaseDraftUpdateContract,
  purchaseEntryPreferencesReadContract,
  purchaseEntryPreferencesUpdateContract,
  purchasePostContract,
  purchasePostedListContract,
  purchasePostedReadContract,
  purchaseAdjustmentDraftCreateContract,
  purchaseAdjustmentDraftDiscardContract,
  purchaseAdjustmentDraftReadContract,
  purchaseAdjustmentDraftUpdateContract,
  purchaseAdjustmentPostContract,
  purchaseAdjustmentSummaryReadContract,
  purchasePostedAdjustmentReadContract,
  purchasePostedReturnReadContract,
  purchaseReturnDraftCreateContract,
  purchaseReturnDraftDiscardContract,
  purchaseReturnDraftReadContract,
  purchaseReturnDraftUpdateContract,
  purchaseReturnPostContract,
  purchaseReturnSummaryReadContract,
] as const;

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
export type IdentityChangePasswordRequest = z.infer<
  typeof identityChangePasswordRequestSchema
>;
export type IdentityResetUserPasswordRequest = z.infer<
  typeof identityResetUserPasswordRequestSchema
>;
export type IdentityRoleReference = z.infer<typeof identityRoleReferenceSchema>;
export type IdentityRole = z.infer<typeof identityRoleSchema>;
export type IdentityRoles = z.infer<typeof identityRolesSchema>;
export type IdentityUsers = z.infer<
  (typeof identityUsersContract.responses)[200]
>;
export type IdentityUpdateRolePermissionsRequest = z.infer<
  typeof identityUpdateRolePermissionsRequestSchema
>;
export type IdentityCreateRoleRequest = z.infer<
  typeof identityCreateRoleRequestSchema
>;
export type IdentityRenameRoleRequest = z.infer<
  typeof identityRenameRoleRequestSchema
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

export type ProductDefinitionMode = z.infer<typeof productDefinitionModeSchema>;
export type ProductNameTemplateVersion = z.infer<
  typeof productNameTemplateVersionSchema
>;
export type ProductStatus = z.infer<typeof productStatusSchema>;
export type ProductFoodTiming = z.infer<typeof productFoodTimingSchema>;
export type ProductStateColour = z.infer<typeof productStateColorSchema>;
export type MedicationNameFields = z.infer<typeof medicationNameFieldsSchema>;
export type GeneralItemNameFields = z.infer<typeof generalItemNameFieldsSchema>;
export type ProductDefinition = z.infer<typeof productDefinitionSchema>;
export type ProductInstructions = z.infer<typeof productInstructionsSchema>;
export type ProductSharingControls = z.infer<
  typeof productSharingControlsSchema
>;
export type ProductStateColours = z.infer<typeof productStateColoursSchema>;
export type InventoryColumnField = z.infer<typeof inventoryColumnFieldSchema>;
export type InventoryRiskIndicator = z.infer<
  typeof inventoryRiskIndicatorSchema
>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;
export type CountSession = z.infer<typeof countSessionSchema>;
export type ReorderItem = z.infer<typeof reorderItemSchema>;
export type CountSessionSummary = z.infer<typeof countSessionSummarySchema>;
export type CountLine = z.infer<typeof countLineSchema>;
export type CountEntry = z.infer<typeof countEntrySchema>;
export type CountLineRecordRequest = z.infer<
  typeof countLineRecordRequestSchema
>;
export type CountVarianceApplyRequest = z.infer<
  typeof countVarianceApplyRequestSchema
>;
export type CountSessionCompleteRequest = z.infer<
  typeof countSessionCompleteRequestSchema
>;
export type CountSessionStartRequest = z.infer<
  typeof countSessionStartRequestSchema
>;
export type CountSessionListQuery = z.infer<typeof countSessionListQuerySchema>;
export type CountLineApplication = z.infer<typeof countLineApplicationSchema>;
export type InventoryReviewPreferences = z.infer<
  typeof inventoryReviewPreferencesSchema
>;
export type InventoryReviewPreferencesUpdateRequest = z.infer<
  typeof inventoryReviewPreferencesUpdateRequestSchema
>;
export type InventorySensitiveExportRequest = z.infer<
  typeof inventorySensitiveExportRequestSchema
>;
export type InventorySensitiveExport = z.infer<
  typeof inventorySensitiveExportSchema
>;
export type BatchEligibilityStatus = z.infer<
  typeof batchEligibilityStatusSchema
>;
export type InventoryBatchStatusEvent = z.infer<
  typeof inventoryBatchStatusEventSchema
>;
export type InventoryBatchExpiryAmendment = z.infer<
  typeof inventoryBatchExpiryAmendmentSchema
>;
export type InventoryBatch = z.infer<typeof inventoryBatchSchema>;
export type InventoryAllocationPreviewRequest = z.infer<
  typeof inventoryAllocationPreviewRequestSchema
>;
export type InventoryAllocationPreview = z.infer<
  typeof inventoryAllocationPreviewSchema
>;
export type InventoryBatchStatusChangeRequest = z.infer<
  typeof inventoryBatchStatusChangeRequestSchema
>;
export type InventoryBatchExpiryCorrectionRequest = z.infer<
  typeof inventoryBatchExpiryCorrectionRequestSchema
>;
export type InventoryBatchSafetyStatus = z.infer<
  typeof inventoryBatchSafetyStatusSchema
>;
export type InventoryBatchSafetyReview = z.infer<
  (typeof inventoryBatchSafetyReviewContract.responses)[200]
>;
export type InventoryDenialCode = z.infer<typeof inventoryDenialCodeSchema>;
export type InventoryDenial = z.infer<typeof inventoryDenialSchema>;
export type ProductUnitInterface = z.infer<typeof productUnitInterfaceSchema>;
export type ProductPackageUnit = z.infer<typeof productPackageUnitSchema>;
export type ProductThirdUnit = z.infer<typeof productThirdUnitSchema>;
export type InventoryCapableUnit = z.infer<typeof inventoryCapableUnitSchema>;
export type ProductPackaging = z.infer<typeof productPackagingSchema>;
export type ProductPricingMethod = z.infer<typeof productPricingMethodSchema>;
export type PriceRoundingSetting = z.infer<typeof priceRoundingSettingSchema>;
export type MarginPercentage = z.infer<typeof marginPercentageSchema>;
export type ProductPricingInput = z.infer<typeof productPricingInputSchema>;
export type ProductPricing = z.infer<typeof productPricingSchema>;
export type ProductPricingField = (typeof PRODUCT_PRICING_FIELDS)[number];
export type ProductPricingFieldState =
  (typeof PRODUCT_PRICING_FIELD_STATES)[number];
export type ProductBarcodeKind = z.infer<typeof productBarcodeKindSchema>;
export type ProductBarcodeSource = z.infer<typeof productBarcodeSourceSchema>;
export type ProductBarcodeInput = z.infer<typeof productBarcodeInputSchema>;
export type ProductBarcode = z.infer<typeof productBarcodeSchema>;
export type Product = z.infer<typeof productSchema>;
export type ProductCreateRequest = z.infer<typeof productCreateRequestSchema>;
export type ProductEditRequest = z.infer<typeof productEditRequestSchema>;
export type ProductArchiveRequest = z.infer<typeof productArchiveRequestSchema>;
export type ProductMergeRequest = z.infer<typeof productMergeRequestSchema>;
export type ProductSearchRequest = z.infer<typeof productSearchRequestSchema>;
export type ProductSearchMatchField = z.infer<
  typeof productSearchMatchFieldSchema
>;
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;
export type ProductSearchResponse = z.infer<typeof productSearchResponseSchema>;
export type ProductBarcodeAddRequest = z.infer<
  typeof productBarcodeAddRequestSchema
>;
export type ProductBarcodeSuggestRequest = z.infer<
  typeof productBarcodeSuggestRequestSchema
>;
export type ProductBarcodeSuggestionResponse = z.infer<
  typeof productBarcodeSuggestionResponseSchema
>;
export type ProductBarcodePrintRequest = z.infer<
  typeof productBarcodePrintRequestSchema
>;
export type BarcodePrintHandoff = z.infer<typeof barcodePrintHandoffSchema>;
export type CatalogMatchingSuggestion = z.infer<
  typeof catalogMatchingSuggestionSchema
>;
export type CatalogMatchingBatch = z.infer<typeof catalogMatchingBatchSchema>;
export type CatalogMatchingBatchOpenRequest = z.infer<
  typeof catalogMatchingBatchOpenRequestSchema
>;
export type CatalogMatchingApprovalRequest = z.infer<
  typeof catalogMatchingApprovalRequestSchema
>;
export type CatalogFieldErrorCode = z.infer<typeof catalogFieldErrorCodeSchema>;
export type CatalogFieldError = z.infer<typeof catalogFieldErrorSchema>;
export type CatalogDenialCode = z.infer<typeof catalogDenialCodeSchema>;
export type CatalogDenial = z.infer<typeof catalogDenialSchema>;
export type AllowancePercentage = z.infer<typeof allowancePercentageSchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type SupplierCreateRequest = z.infer<typeof supplierCreateRequestSchema>;
export type SupplierEditRequest = z.infer<typeof supplierEditRequestSchema>;
export type SupplierArchiveRequest = z.infer<
  typeof supplierArchiveRequestSchema
>;
export type SupplierMergeRequest = z.infer<typeof supplierMergeRequestSchema>;
export type PurchaseSettlementContext = z.infer<
  typeof purchaseSettlementContextSchema
>;
export type PurchaseDraft = z.infer<typeof purchaseDraftSchema>;
export type PurchaseDraftDetail = z.infer<typeof purchaseDraftDetailSchema>;
export type PurchaseDraftRow = z.infer<typeof purchaseDraftRowSchema>;
export type PurchaseDraftRowCommitRequest = z.infer<
  typeof purchaseDraftRowCommitRequestSchema
>;
export type PurchaseDraftRowCommitResult = z.infer<
  typeof purchaseDraftRowCommitResultSchema
>;
export type PurchaseEntryColumnField = z.infer<
  typeof purchaseEntryColumnFieldSchema
>;
export type PurchaseEntryPreferences = z.infer<
  typeof purchaseEntryPreferencesSchema
>;
export type PurchaseEntryPreferencesUpdateRequest = z.infer<
  typeof purchaseEntryPreferencesUpdateRequestSchema
>;
export type PurchaseDraftWarning = z.infer<typeof purchaseDraftWarningSchema>;
export type PurchaseDraftResult = z.infer<typeof purchaseDraftResultSchema>;
export type PurchaseDraftCreateRequest = z.infer<
  typeof purchaseDraftCreateRequestSchema
>;
export type PurchaseDraftUpdateRequest = z.infer<
  typeof purchaseDraftUpdateRequestSchema
>;
export type PurchaseDraftDiscardRequest = z.infer<
  typeof purchaseDraftDiscardRequestSchema
>;
export type PurchasingFieldError = z.infer<typeof purchasingFieldErrorSchema>;
export type PurchasingRuleId = z.infer<typeof purchasingRuleIdSchema>;
export type PurchasingDenial = z.infer<typeof purchasingDenialSchema>;
export type PurchasingDenialCode = PurchasingDenial["code"];
export type PurchasePostRequest = z.infer<typeof purchasePostRequestSchema>;
export type PostedDocumentNumber = z.infer<typeof postedDocumentNumberSchema>;
export type PurchasePriceCapture = z.infer<typeof purchasePriceCaptureSchema>;
export type PurchasePostingAccountCode = z.infer<
  typeof purchasePostingAccountCodeSchema
>;
export type PostedPurchaseJournalLine = z.infer<
  typeof postedPurchaseJournalLineSchema
>;
export type PostedPurchaseJournal = z.infer<typeof postedPurchaseJournalSchema>;
export type PostedPurchaseRow = z.infer<typeof postedPurchaseRowSchema>;
export type PostedPurchase = z.infer<typeof postedPurchaseSchema>;
export type PurchasePostingWarning = z.infer<
  typeof purchasePostingWarningSchema
>;
export type PurchasePostResult = z.infer<typeof purchasePostResultSchema>;
export type PurchasePostedListRequest = z.infer<
  typeof purchasePostedListRequestSchema
>;
export type PurchasePostedCostVisibility = z.infer<
  typeof purchasePostedCostVisibilitySchema
>;
export type PurchasePostedListItem = z.infer<
  typeof purchasePostedListItemSchema
>;
export type PurchasePostedListResponse = z.infer<
  typeof purchasePostedListResponseSchema
>;
export type PurchasePostedDetailRow = z.infer<
  typeof purchasePostedDetailRowSchema
>;
export type PurchasePostedDetail = z.infer<typeof purchasePostedDetailSchema>;
export type PurchaseAdjustmentReason = z.infer<
  typeof purchaseAdjustmentReasonSchema
>;
export type PurchaseAdjustmentField = z.infer<
  typeof purchaseAdjustmentFieldSchema
>;
export type PurchaseAdjustmentFieldChange = z.infer<
  typeof purchaseAdjustmentFieldChangeSchema
>;
export type PurchaseAdjustmentSnapshotRow = z.infer<
  typeof purchaseAdjustmentSnapshotRowSchema
>;
export type PurchaseAdjustmentDraftRow = z.infer<
  typeof purchaseAdjustmentDraftRowSchema
>;
export type PurchaseAdjustmentDraftRowInput = z.infer<
  typeof purchaseAdjustmentDraftRowInputSchema
>;
export type PurchaseAdjustmentDraft = z.infer<
  typeof purchaseAdjustmentDraftSchema
>;
export type PurchaseAdjustmentDraftCreateRequest = z.infer<
  typeof purchaseAdjustmentDraftCreateRequestSchema
>;
export type PurchaseAdjustmentDraftUpdateRequest = z.infer<
  typeof purchaseAdjustmentDraftUpdateRequestSchema
>;
export type PurchaseAdjustmentDraftDiscardRequest = z.infer<
  typeof purchaseAdjustmentDraftDiscardRequestSchema
>;
export type PurchaseAdjustmentRowDelta = z.infer<
  typeof purchaseAdjustmentRowDeltaSchema
>;
export type PurchaseAdjustmentSummary = z.infer<
  typeof purchaseAdjustmentSummarySchema
>;
export type PurchaseAdjustmentPostRequest = z.infer<
  typeof purchaseAdjustmentPostRequestSchema
>;
export type PostedPurchaseAdjustment = z.infer<
  typeof postedPurchaseAdjustmentSchema
>;
export type PurchaseAdjustmentPostResult = z.infer<
  typeof purchaseAdjustmentPostResultSchema
>;
export type PurchaseReturnNumber = z.infer<typeof purchaseReturnNumberSchema>;
export type PurchaseReturnDraftRow = z.infer<
  typeof purchaseReturnDraftRowSchema
>;
export type PurchaseReturnDraft = z.infer<typeof purchaseReturnDraftSchema>;
export type PurchaseReturnDraftCreateRequest = z.infer<
  typeof purchaseReturnDraftCreateRequestSchema
>;
export type PurchaseReturnDraftUpdateRequest = z.infer<
  typeof purchaseReturnDraftUpdateRequestSchema
>;
export type PurchaseReturnDraftDiscardRequest = z.infer<
  typeof purchaseReturnDraftDiscardRequestSchema
>;
export type PurchaseReturnSummary = z.infer<typeof purchaseReturnSummarySchema>;
export type PurchaseReturnPostRequest = z.infer<
  typeof purchaseReturnPostRequestSchema
>;
export type PostedPurchaseReturn = z.infer<typeof postedPurchaseReturnSchema>;
export type PurchaseReturnPostResult = z.infer<
  typeof purchaseReturnPostResultSchema
>;

/**
 * The approved product naming templates, and the total function that applies
 * them.
 *
 * This is a pure policy, not a wire schema, but it lives beside the Product
 * field schemas above because it is a total function of exactly those fields.
 * Keeping it here is what makes the approved field order singular: the server
 * that stores a name, the screen that previews one as the pharmacist types,
 * and the tests that assert on either all import this one definition, so no
 * copy of the template can drift away from the others.
 *
 * Two rules are structural here rather than merely documented:
 *
 * - The Arabic search name is not a parameter of any function below. It is a
 *   sibling field on the Product, displayed on its own line beneath the English
 *   name, and no code path can concatenate it into the English display because
 *   no code path is ever given it.
 * - The template version is an explicit argument, never an ambient constant. A
 *   Product stores the version its name was generated under, so a later
 *   template revision cannot silently rewrite a name that already exists.
 */
export type ProductNameFieldsByMode = {
  readonly [TMode in ProductDefinitionMode]: Extract<
    ProductDefinition,
    { mode: TMode }
  >["fields"];
};

export const CURRENT_PRODUCT_NAME_TEMPLATE_VERSION = 1 as const;

type ProductNameTemplate = {
  readonly [
    TMode in ProductDefinitionMode
  ]: readonly (keyof ProductNameFieldsByMode[TMode])[];
};

/**
 * One approved template exists. A revision adds a version here instead of
 * editing this entry, because Products already carry version 1 and must keep
 * regenerating the exact string they were stored with.
 */
export const PRODUCT_NAME_TEMPLATES: Readonly<
  Record<ProductNameTemplateVersion, ProductNameTemplate>
> = {
  1: {
    "general-item": [
      "company",
      "subBrand",
      "typeOfUse",
      "property",
      "targetAudience",
      "size",
    ],
    medication: ["tradeName", "strength", "dosageForm", "manufacturer"],
  },
};

const DISPLAY_NAME_PART_SEPARATOR = " ";
const COLLAPSIBLE_WHITESPACE = /\s+/gu;

/**
 * Joins the parts a template names, in the template's order, skipping the ones
 * that are not there.
 *
 * "Skips cleanly" is achieved by construction rather than by cleanup: an absent
 * or blank part is never pushed, so the join can leave no doubled separator, no
 * leading separator, and no trailing separator whatever combination of optional
 * parts is missing. Each surviving part is trimmed and its internal runs of
 * whitespace collapsed, so a value typed with stray spacing cannot smuggle a
 * doubled separator into the middle of a name.
 *
 * The joiner reads only the keys the template lists. A field no template names
 * — the Arabic search name above all — cannot reach the English display even
 * when it rides along on the record the caller passes in.
 */
export function composeDisplayName(
  fieldOrder: readonly string[],
  fields: Readonly<Record<string, string | null | undefined>>,
): string {
  const parts: string[] = [];
  for (const field of fieldOrder) {
    const value = fields[field];
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim().replace(COLLAPSIBLE_WHITESPACE, " ");
    if (normalized.length > 0) {
      parts.push(normalized);
    }
  }
  return parts.join(DISPLAY_NAME_PART_SEPARATOR);
}

/**
 * The Product display name for one mode's fields under one approved template
 * version.
 *
 * Deterministic and total: the same inputs always produce the same string, and
 * no combination of absent optional parts throws. The result is not an
 * identity — two legitimately distinct Products may generate the same string,
 * and uniqueness belongs to the internal ID, SKU, barcode, and registration
 * number instead.
 */
export function generateDisplayName<TMode extends ProductDefinitionMode>(
  mode: TMode,
  fields: ProductNameFieldsByMode[TMode],
  templateVersion: ProductNameTemplateVersion,
): string {
  return composeDisplayName(
    PRODUCT_NAME_TEMPLATES[templateVersion][mode],
    fields,
  );
}

export function isProductNameTemplateVersion(
  value: number,
): value is ProductNameTemplateVersion {
  return (PRODUCT_NAME_TEMPLATE_VERSIONS as readonly number[]).includes(value);
}

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
