import {
  attendanceEventContract,
  attendanceEventSchema,
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityBootstrapContract,
  identityCreateUserContract,
  identityDenialSchema,
  identityLoginContract,
  identityLogoutContract,
  identityRolePermissionsPath,
  identityRoleSchema,
  identityRolesContract,
  identityRolesSchema,
  identityStateContract,
  identityStateSchema,
  identityStepUpApprovePath,
  identityStepUpChallengeSchema,
  identityStepUpCreateContract,
  identityUpdateRolePermissionsContract,
  identityUpdateUserContract,
  identityUserPath,
  identityUserSchema,
  identityUsersContract,
  pharmacySettingsContract,
  pharmacySettingsSchema,
  type AttendanceEvent,
  type AttendanceEventRequest,
  type IdentityAuthenticatedState,
  type IdentityBootstrapRequest,
  type IdentityCreateUserRequest,
  type IdentityDenial,
  type IdentityLoginRequest,
  type IdentityRole,
  type IdentityRoles,
  type IdentityState,
  type IdentityStepUpApproveRequest,
  type IdentityStepUpChallenge,
  type IdentityStepUpCreateRequest,
  type IdentityUpdateRolePermissionsRequest,
  type IdentityUpdateUserRequest,
  type IdentityUser,
  type PharmacySettings,
  type PharmacySettingsUpdateRequest,
} from "@breev/contracts/local-rest";

interface PayloadParser<T> {
  parse(payload: unknown): T;
}

export class IdentityApiDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: IdentityDenial,
  ) {
    super(denial.code);
    this.name = "IdentityApiDenied";
  }
}

export async function requestIdentityState(
  baseUrl: string,
): Promise<IdentityState> {
  return await requestJson(
    baseUrl,
    identityStateContract.path,
    identityStateContract.method,
    200,
    identityStateSchema,
  );
}

export async function bootstrapIdentity(
  baseUrl: string,
  body: IdentityBootstrapRequest,
): Promise<IdentityAuthenticatedState> {
  return (await requestJson(
    baseUrl,
    identityBootstrapContract.path,
    identityBootstrapContract.method,
    201,
    identityStateSchema,
    body,
  )) as IdentityAuthenticatedState;
}

export async function loginIdentity(
  baseUrl: string,
  body: IdentityLoginRequest,
): Promise<IdentityAuthenticatedState> {
  return (await requestJson(
    baseUrl,
    identityLoginContract.path,
    identityLoginContract.method,
    200,
    identityStateSchema,
    body,
  )) as IdentityAuthenticatedState;
}

export async function logoutIdentity(baseUrl: string): Promise<void> {
  const response = await fetch(
    new URL(identityLogoutContract.path, baseUrl),
    mutationInit(identityLogoutContract.method, {}),
  );
  if (response.status === 204) {
    return;
  }
  throw await denialFromResponse(response);
}

export async function requestIdentityRoles(
  baseUrl: string,
): Promise<IdentityRoles> {
  return await requestJson(
    baseUrl,
    identityRolesContract.path,
    identityRolesContract.method,
    200,
    identityRolesSchema,
  );
}

export async function requestIdentityUsers(
  baseUrl: string,
): Promise<{ users: IdentityUser[] }> {
  return await requestJson(
    baseUrl,
    identityUsersContract.path,
    identityUsersContract.method,
    200,
    identityUsersContract.responses[200],
  );
}

export async function createIdentityUser(
  baseUrl: string,
  body: IdentityCreateUserRequest,
): Promise<IdentityUser> {
  return await requestJson(
    baseUrl,
    identityCreateUserContract.path,
    identityCreateUserContract.method,
    201,
    identityUserSchema,
    body,
  );
}

export async function updateIdentityUser(
  baseUrl: string,
  userId: string,
  body: IdentityUpdateUserRequest,
): Promise<IdentityUser> {
  return await requestJson(
    baseUrl,
    identityUserPath(userId),
    identityUpdateUserContract.method,
    200,
    identityUserSchema,
    body,
  );
}

export async function createStepUpChallenge(
  baseUrl: string,
  body: IdentityStepUpCreateRequest,
): Promise<IdentityStepUpChallenge> {
  return await requestJson(
    baseUrl,
    identityStepUpCreateContract.path,
    identityStepUpCreateContract.method,
    201,
    identityStepUpChallengeSchema,
    body,
  );
}

export async function approveStepUpChallenge(
  baseUrl: string,
  challengeId: string,
  body: IdentityStepUpApproveRequest,
): Promise<IdentityStepUpChallenge> {
  return await requestJson(
    baseUrl,
    identityStepUpApprovePath(challengeId),
    "POST",
    200,
    identityStepUpChallengeSchema,
    body,
  );
}

export async function updateIdentityRolePermissions(
  baseUrl: string,
  roleId: string,
  body: IdentityUpdateRolePermissionsRequest,
): Promise<IdentityRole> {
  return await requestJson(
    baseUrl,
    identityRolePermissionsPath(roleId),
    identityUpdateRolePermissionsContract.method,
    200,
    identityRoleSchema,
    body,
  );
}

export async function updatePharmacySettings(
  baseUrl: string,
  body: PharmacySettingsUpdateRequest,
): Promise<PharmacySettings> {
  return await requestJson(
    baseUrl,
    pharmacySettingsContract.path,
    pharmacySettingsContract.method,
    200,
    pharmacySettingsSchema,
    body,
  );
}

export async function createAttendanceEvent(
  baseUrl: string,
  body: AttendanceEventRequest,
): Promise<AttendanceEvent> {
  return await requestJson(
    baseUrl,
    attendanceEventContract.path,
    attendanceEventContract.method,
    201,
    attendanceEventSchema,
    body,
  );
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  method: string,
  successStatus: number,
  parser: PayloadParser<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    ...(body === undefined
      ? {
          cache: "no-store" as const,
          credentials: "omit" as const,
          headers: { Accept: "application/json" },
          method,
        }
      : mutationInit(method, body)),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== successStatus) {
    throw await denialFromResponse(response);
  }
  return parser.parse(await response.json());
}

function mutationInit(method: string, body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    },
    method,
  };
}

async function denialFromResponse(response: Response): Promise<Error> {
  const parsed = identityDenialSchema.safeParse(await response.json());
  return parsed.success
    ? new IdentityApiDenied(response.status, parsed.data)
    : new Error(`Identity API returned ${response.status}`);
}
