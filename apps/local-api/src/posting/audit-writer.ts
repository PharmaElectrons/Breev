import type { PoolClient } from "pg";

import type { JsonObject } from "./canonical-hash.js";

/**
 * The privacy-safe operational evidence a posting fact may carry: the
 * pharmacy, the actor, the device, the session, the correlation (the command
 * idempotency key), the action, the time, the reason, the before and after
 * values, and the outcome. Nothing else belongs in an audit record.
 */
/**
 * Which device a posting fact came from: the Main binding or a terminal
 * certificate, never both.
 */
export interface AuditDeviceReference {
  readonly deviceId: string | undefined;
  readonly terminalDeviceId: string | undefined;
}

export interface PostingAuditInput {
  readonly action: string;
  readonly actorUserId: string;
  readonly afterState?: JsonObject;
  readonly beforeState?: JsonObject;
  readonly correlationId?: string;
  readonly device: AuditDeviceReference;
  readonly identitySessionId?: string;
  readonly outcome: string;
  readonly pharmacyId: string;
  readonly reason?: string;
  readonly targetId?: string;
}

/**
 * Appends one posting audit fact inside the caller's transaction and returns
 * its identifier, which doubles as the request id a denial reports.
 *
 * This takes a `PoolClient` rather than a pool on purpose: an audit fact that
 * could commit independently of the change it describes would be able to
 * outlive a rolled-back command and describe something that never happened.
 */
export async function writePostingAudit(
  client: PoolClient,
  input: PostingAuditInput,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into posting_audit_records (
       pharmacy_id, actor_user_id, identity_session_id, device_id,
       terminal_device_id, correlation_id, action, outcome, target_id, reason,
       before_state, after_state
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
     returning id`,
    [
      input.pharmacyId,
      input.actorUserId,
      input.identitySessionId ?? null,
      input.device.deviceId ?? null,
      input.device.terminalDeviceId ?? null,
      input.correlationId ?? null,
      input.action,
      input.outcome,
      input.targetId ?? null,
      input.reason ?? null,
      input.beforeState === undefined
        ? null
        : JSON.stringify(input.beforeState),
      input.afterState === undefined ? null : JSON.stringify(input.afterState),
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("The posting audit record was not created");
  }
  return id;
}
