import type {
  DevicesDenial,
  DevicesDenialCode,
} from "@breev/contracts/local-rest";
import type { QueryResult } from "pg";

/**
 * The audit trail of the pairing ceremony, seat allocation, and revocation.
 *
 * `details` is deliberately narrow. A pairing audit fact must describe what
 * happened without ever making it reproducible: no join secret, no private or
 * public key material, no certificate, no QR payload. Where evidence of "which
 * key" or "which invitation" is genuinely useful, only a SHA-256 digest is
 * written, and the database refuses the dangerous keys outright.
 */
export interface DevicesAuditInput {
  readonly action: string;
  readonly actorUserId?: string;
  readonly details?: Readonly<Record<string, boolean | number | string>>;
  readonly deviceId?: string;
  readonly identitySessionId?: string;
  /**
   * The installation this fact belongs to, or `null` when there genuinely is
   * none — the two outcomes that can occur before a pharmacy CA exists at
   * all, `ca-not-found` and `ca-key-store-failure`. The field stays required
   * so every other audit write still names a real installation at the type
   * level; only these two paths are entitled to pass `null` instead of a
   * fabricated placeholder.
   */
  readonly installationId: string | null;
  readonly mainDeviceId?: string;
  readonly outcome: string;
  readonly pairingSessionId?: string;
  readonly pharmacyId?: string;
  readonly seatReleaseRequestId?: string;
}

interface Queryable {
  query<R extends object>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

export class DevicesDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: DevicesDenial,
  ) {
    super(denial.code);
    this.name = "DevicesDenied";
  }
}

export function devicesDenial(
  statusCode: number,
  code: DevicesDenialCode,
  requestId: string,
): DevicesDenied {
  return new DevicesDenied(statusCode, { code, requestId, status: "denied" });
}

/**
 * Appends one device fact inside the caller's transaction and returns its id,
 * which doubles as the request id a denial reports. It takes the caller's
 * client on purpose: an audit fact that could commit on its own would be able
 * to describe a ceremony that was rolled back.
 */
export async function writeDevicesAudit(
  queryable: Queryable,
  input: DevicesAuditInput,
): Promise<string> {
  const result = await queryable.query<{ id: string }>(
    `insert into devices_audit_records (
       pharmacy_id, installation_id, actor_user_id, identity_session_id,
       main_device_id, terminal_device_id, pairing_session_id,
       seat_release_request_id, action, outcome, details
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     returning id`,
    [
      input.pharmacyId ?? null,
      input.installationId,
      input.actorUserId ?? null,
      input.identitySessionId ?? null,
      input.mainDeviceId ?? null,
      input.deviceId ?? null,
      input.pairingSessionId ?? null,
      input.seatReleaseRequestId ?? null,
      input.action,
      input.outcome,
      input.details === undefined ? null : JSON.stringify(input.details),
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("The device audit record was not created");
  }
  return id;
}
