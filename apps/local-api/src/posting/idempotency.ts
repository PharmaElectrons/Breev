import type { PoolClient } from "pg";

/**
 * Advisory-lock namespace registry. Every advisory lock Breev takes is seeded
 * from one of these constants so that two unrelated subsystems can never
 * collide by hashing similar text:
 *
 * - 165308855 schema migration lock (local-database.service.ts)
 * - 165308856 Main device security state (main-device-security.service.ts)
 * - 165308857 pharmacy CA installation (pharmacy-ca.service.ts)
 * - 165308858 identity device-session arbitration (identity-access.service.ts)
 * - 165308859 identity per-pharmacy write lock (identity-access.service.ts)
 * - 165308860 identity bootstrap (identity-access.service.ts)
 * - 165308861 licensing per-pharmacy installation lock (licensing.service.ts)
 * - 165308862 posting command idempotency (this file)
 *
 * A 64-bit `hashtextextended` collision between two lock texts would cost
 * extra serialization between two unrelated commands and can never produce a
 * wrong arbitration, because the lock only orders the callers: the stored row
 * is the authority.
 */
export const POSTING_IDEMPOTENCY_LOCK_NAMESPACE = 165_308_862;

export interface PostingCommandKey {
  readonly commandName: string;
  readonly idempotencyKey: string;
  readonly pharmacyId: string;
}

export interface PostingCommandReplay {
  readonly responseBody: unknown;
  readonly responseStatus: number;
}

export interface BeginPostingIdempotencyInput extends PostingCommandKey {
  readonly requestHash: Buffer;
}

export interface RecordPostingResultInput extends BeginPostingIdempotencyInput {
  readonly actorUserId: string;
  readonly identitySessionId?: string;
  readonly mainDeviceId: string;
  readonly responseBody: unknown;
  readonly responseStatus: number;
}

/**
 * Raised when an idempotency key is reused with a different request. The
 * denial itself is never recorded as a command result: the primary-key slot
 * already holds the original outcome, and overwriting it would destroy the
 * evidence of what was actually posted.
 */
export class PostingIdempotencyConflict extends Error {
  public readonly commandName: string;
  public readonly idempotencyKey: string;

  public constructor(key: PostingCommandKey) {
    super("idempotency-conflict");
    this.name = "PostingIdempotencyConflict";
    this.commandName = key.commandName;
    this.idempotencyKey = key.idempotencyKey;
  }
}

interface CommandResultRow {
  readonly request_hash: Buffer;
  readonly response_body: unknown;
  readonly response_status: number;
}

/**
 * Arbitrates one posting command attempt inside the caller's transaction.
 *
 * The transaction-scoped advisory lock is taken first, so concurrent attempts
 * that share a pharmacy, command, and key are ordered rather than racing: the
 * loser blocks until the winner commits and then reads the committed result.
 * The lock is released by the commit or rollback that ends the transaction,
 * which is why this takes a `PoolClient` and never a pool.
 *
 * Returns the stored status and body to replay, or `undefined` when the
 * command has not run and the caller must execute it. A key reused with a
 * different request raises {@link PostingIdempotencyConflict} and leaves the
 * transaction usable, so the caller can record its denial fact and commit that
 * evidence before the denial reaches the client.
 */
export async function beginPostingIdempotency(
  client: PoolClient,
  input: BeginPostingIdempotencyInput,
): Promise<PostingCommandReplay | undefined> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, $2::bigint))",
    [
      `${input.pharmacyId}:${input.commandName}:${input.idempotencyKey}`,
      POSTING_IDEMPOTENCY_LOCK_NAMESPACE,
    ],
  );
  const result = await client.query<CommandResultRow>(
    `select request_hash, response_status, response_body
     from posting_command_results
     where pharmacy_id = $1 and command_name = $2 and idempotency_key = $3`,
    [input.pharmacyId, input.commandName, input.idempotencyKey],
  );
  const stored = result.rows[0];
  if (stored === undefined) {
    return undefined;
  }
  if (!stored.request_hash.equals(input.requestHash)) {
    throw new PostingIdempotencyConflict(input);
  }
  return {
    responseBody: stored.response_body,
    responseStatus: stored.response_status,
  };
}

/**
 * Records the terminal outcome of a posting command inside the same
 * transaction that performed it, so the recorded result and the change it
 * describes commit or roll back together. Terminal business rejections such
 * as a version conflict are recorded with their own status and replayed
 * verbatim; only the idempotency conflict above is never recorded.
 */
export async function recordPostingResult(
  client: PoolClient,
  input: RecordPostingResultInput,
): Promise<void> {
  await client.query(
    `insert into posting_command_results (
       pharmacy_id, command_name, idempotency_key, actor_user_id,
       identity_session_id, main_device_id, request_hash,
       response_status, response_body
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      input.pharmacyId,
      input.commandName,
      input.idempotencyKey,
      input.actorUserId,
      input.identitySessionId ?? null,
      input.mainDeviceId,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.responseBody),
    ],
  );
}
