import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  deviceInventoryContract,
  deviceInventorySchema,
  deviceRevocationContract,
  deviceRevocationPath,
  deviceRevocationSchema,
  devicesDenialSchema,
  identityDenialSchema,
  licensingDenialSchema,
  pairingSessionCancelContract,
  pairingSessionCancelPath,
  pairingSessionCancelledSchema,
  pairingSessionConfirmContract,
  pairingSessionConfirmPath,
  pairingSessionConfirmedSchema,
  pairingSessionCurrentContract,
  pairingSessionStartContract,
  pairingSessionStartedSchema,
  pairingSessionViewSchema,
  seatReleaseApprovalContract,
  seatReleaseApprovalPath,
  seatReleaseApprovalSchema,
  seatReleaseRequestContract,
  seatReleaseRequestSchema,
  type DeviceInventory,
  type DeviceRevocation,
  type DeviceRevocationRequest,
  type DevicesDenial,
  type PairingSessionCancelRequest,
  type PairingSessionCancelled,
  type PairingSessionConfirmRequest,
  type PairingSessionConfirmed,
  type PairingSessionStarted,
  type PairingSessionStartRequest,
  type PairingSessionView,
  type SeatReleaseApproval,
  type SeatReleaseApprovalRequest,
  type SeatReleaseRequest,
  type SeatReleaseRequestCreate,
} from "@breev/contracts/local-rest";

import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";

interface PayloadParser<T> {
  parse(payload: unknown): T;
}

export class DevicesApiDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: DevicesDenial,
  ) {
    super(denial.code);
    this.name = "DevicesApiDenied";
  }
}

export async function requestDeviceInventory(
  baseUrl: string,
): Promise<DeviceInventory> {
  return await requestJson(
    baseUrl,
    deviceInventoryContract.path,
    deviceInventoryContract.method,
    200,
    deviceInventorySchema,
  );
}

export async function requestCurrentPairingSession(
  baseUrl: string,
): Promise<PairingSessionView> {
  return await requestJson(
    baseUrl,
    pairingSessionCurrentContract.path,
    pairingSessionCurrentContract.method,
    200,
    pairingSessionViewSchema,
  );
}

export async function startPairingSession(
  baseUrl: string,
  body: PairingSessionStartRequest,
): Promise<PairingSessionStarted> {
  return await requestJson(
    baseUrl,
    pairingSessionStartContract.path,
    pairingSessionStartContract.method,
    201,
    pairingSessionStartedSchema,
    body,
  );
}

export async function confirmPairingSession(
  baseUrl: string,
  sessionId: string,
  body: PairingSessionConfirmRequest,
): Promise<PairingSessionConfirmed> {
  return await requestJson(
    baseUrl,
    pairingSessionConfirmPath(sessionId),
    pairingSessionConfirmContract.method,
    201,
    pairingSessionConfirmedSchema,
    body,
  );
}

export async function cancelPairingSession(
  baseUrl: string,
  sessionId: string,
  body: PairingSessionCancelRequest,
): Promise<PairingSessionCancelled> {
  return await requestJson(
    baseUrl,
    pairingSessionCancelPath(sessionId),
    pairingSessionCancelContract.method,
    201,
    pairingSessionCancelledSchema,
    body,
  );
}

export async function revokeDevice(
  baseUrl: string,
  deviceId: string,
  body: DeviceRevocationRequest,
): Promise<DeviceRevocation> {
  return await requestJson(
    baseUrl,
    deviceRevocationPath(deviceId),
    deviceRevocationContract.method,
    201,
    deviceRevocationSchema,
    body,
  );
}

export async function requestSeatRelease(
  baseUrl: string,
  body: SeatReleaseRequestCreate,
): Promise<SeatReleaseRequest> {
  return await requestJson(
    baseUrl,
    seatReleaseRequestContract.path,
    seatReleaseRequestContract.method,
    201,
    seatReleaseRequestSchema,
    body,
  );
}

export async function approveSeatRelease(
  baseUrl: string,
  requestId: string,
  body: SeatReleaseApprovalRequest,
): Promise<SeatReleaseApproval> {
  return await requestJson(
    baseUrl,
    seatReleaseApprovalPath(requestId),
    seatReleaseApprovalContract.method,
    201,
    seatReleaseApprovalSchema,
    body,
  );
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
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

/**
 * Every devices route can answer with a devices, identity, or licensing
 * denial. An unrecognised payload stays an untranslated transport error rather
 * than a success: unknown is denied.
 */
async function denialFromResponse(response: Response): Promise<Error> {
  const payload: unknown = await response.json();
  const devices = devicesDenialSchema.safeParse(payload);
  if (devices.success) {
    return new DevicesApiDenied(response.status, devices.data);
  }
  const identity = identityDenialSchema.safeParse(payload);
  if (identity.success) {
    return new IdentityApiDenied(response.status, identity.data);
  }
  const licensing = licensingDenialSchema.safeParse(payload);
  return licensing.success
    ? new LicensingApiDenied(response.status, licensing.data)
    : new Error(`Local API returned ${response.status}`);
}
