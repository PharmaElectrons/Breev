import type { PoolClient } from "pg";

import type { JsonObject } from "./canonical-hash.js";

/**
 * Every domain event Breev records. The names are dot-namespaced and are part
 * of the envelope contract, so a value here is never renamed: a new meaning
 * gets a new event type.
 */
export const POSTING_EVENT_TYPES = {
  pharmacySettingsChanged: "pharmacy.settings.changed",
} as const;

export type PostingEventType =
  (typeof POSTING_EVENT_TYPES)[keyof typeof POSTING_EVENT_TYPES];

/**
 * The envelope version registry.
 *
 * Envelope v1 is `{id, pharmacyId, eventType, envelopeVersion, occurredAt,
 * correlationId, payload}`. Columns may only be added; any change to the shape
 * or meaning of a payload increments that event type's version, and both the
 * new and the retired versions stay listed here for as long as rows carrying
 * them exist. Readers must reject a version they do not know rather than guess
 * at its shape, which is what {@link assertSupportedEnvelope} is for.
 */
export const POSTING_ENVELOPE_VERSIONS: {
  readonly [Type in PostingEventType]: readonly number[];
} = {
  "pharmacy.settings.changed": [1],
};

/** The version a writer produces today for each event type. */
export const CURRENT_ENVELOPE_VERSIONS: {
  readonly [Type in PostingEventType]: number;
} = {
  "pharmacy.settings.changed": 1,
};

export class PostingEnvelopeVersionError extends Error {
  public readonly envelopeVersion: number;
  public readonly eventType: string;

  public constructor(eventType: string, envelopeVersion: number) {
    super(
      `Envelope version ${String(envelopeVersion)} of ${eventType} is not a known posting envelope`,
    );
    this.name = "PostingEnvelopeVersionError";
    this.envelopeVersion = envelopeVersion;
    this.eventType = eventType;
  }
}

export interface AppendOutboxEntryInput {
  readonly correlationId: string;
  readonly envelopeVersion: number;
  readonly eventType: PostingEventType;
  /** Domain occurrence time; defaults to the posting transaction's clock. */
  readonly occurredAt?: Date;
  /** Privacy-safe JSON only; authoritative money is a decimal integer string. */
  readonly payload: JsonObject;
  readonly pharmacyId: string;
}

export interface PostingOutboxEntry {
  readonly id: string;
  readonly occurredAt: Date;
}

export function isKnownPostingEventType(
  value: string,
): value is PostingEventType {
  return Object.hasOwn(POSTING_ENVELOPE_VERSIONS, value);
}

/** Pure rule: does this reader understand the envelope it is looking at? */
export function isSupportedEnvelope(
  eventType: string,
  envelopeVersion: number,
): boolean {
  if (!isKnownPostingEventType(eventType)) {
    return false;
  }
  return POSTING_ENVELOPE_VERSIONS[eventType].includes(envelopeVersion);
}

/** Rejects an unknown event type or envelope version instead of guessing. */
export function assertSupportedEnvelope(
  eventType: string,
  envelopeVersion: number,
): void {
  if (!isSupportedEnvelope(eventType, envelopeVersion)) {
    throw new PostingEnvelopeVersionError(eventType, envelopeVersion);
  }
}

/**
 * Appends one envelope to the outbox inside the caller's transaction, so the
 * event exists if and only if the command that produced it committed. The row
 * is never mutated afterwards; delivery state belongs to separate tables.
 *
 * The identifier is a UUIDv7 produced by the database function this schema
 * uses everywhere else, which keeps the identity generator single-sourced and
 * satisfies the table's UUIDv7 check.
 */
export async function appendOutboxEntry(
  client: PoolClient,
  input: AppendOutboxEntryInput,
): Promise<PostingOutboxEntry> {
  assertSupportedEnvelope(input.eventType, input.envelopeVersion);
  const result = await client.query<{ id: string; occurred_at: Date }>(
    `insert into posting_outbox_entries (
       pharmacy_id, event_type, envelope_version, occurred_at,
       correlation_id, payload
     ) values (
       $1, $2, $3, coalesce($4::timestamptz, statement_timestamp()), $5, $6::jsonb
     )
     returning id, occurred_at`,
    [
      input.pharmacyId,
      input.eventType,
      input.envelopeVersion,
      input.occurredAt ?? null,
      input.correlationId,
      JSON.stringify(input.payload),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("The posting outbox entry was not created");
  }
  return { id: row.id, occurredAt: row.occurred_at };
}

/**
 * Records the one durable outcome of the post-commit work for an envelope.
 * Duplicate delivery, claim recovery, and racing writers all converge on the
 * row that was written first.
 */
export async function recordPostCommitOutcome(
  client: PoolClient,
  input: { readonly outboxEntryId: string; readonly outcome: string },
): Promise<void> {
  await client.query(
    `insert into posting_post_commit_outcomes (outbox_entry_id, outcome)
     values ($1, $2)
     on conflict (outbox_entry_id) do nothing`,
    [input.outboxEntryId, input.outcome],
  );
}
