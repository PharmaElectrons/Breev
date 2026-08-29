import type { Pool, PoolClient, QueryResult } from "pg";

import {
  writePostingAudit,
  type AuditDeviceReference,
} from "./audit-writer.js";

/** The audit action recorded when phase one hands out a document number. */
export const NUMBER_ALLOCATION_AUDIT_ACTION = "posting.number.allocate";

const CORRELATION_UNIQUE_CONSTRAINT =
  "posting_number_allocations_correlation_unique";
const UNIQUE_VIOLATION = "23505";

export interface DocumentNumberScope {
  readonly documentType: string;
  readonly pharmacyId: string;
  readonly year: number;
}

export interface AllocateDocumentNumberInput extends DocumentNumberScope {
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly device: AuditDeviceReference;
  readonly identitySessionId?: string;
}

export interface DocumentNumberAllocation {
  readonly allocationId: string;
  /** True when the number came from an earlier attempt of the same command. */
  readonly reused: boolean;
  readonly value: bigint;
}

export interface MarkNumberIssuedInput extends DocumentNumberScope {
  readonly allocationId: string;
  readonly correlationId: string;
  readonly documentId: string;
}

export class PostingNumberIssueRejected extends Error {
  public readonly allocationId: string;

  public constructor(allocationId: string) {
    super(
      "The posting number allocation is not an unissued allocation of this correlation",
    );
    this.name = "PostingNumberIssueRejected";
    this.allocationId = allocationId;
  }
}

interface Queryable {
  query<R extends object>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

interface AllocationRow {
  readonly id: string;
  readonly value: string;
}

/**
 * Phase one of document numbering: hand out the next number for a pharmacy,
 * document type, and year, and commit that fact on its own.
 *
 * This is the one deliberate exception to the "writers take the caller's
 * transaction" rule. The number must survive the business transaction that
 * requested it, because a counter that rewinds when a command fails would
 * eventually hand the same number to two different documents. The cost is an
 * occasional gap, and a gap is exactly what an auditor can be shown: the
 * allocation row stays committed with status `allocated`, carrying the actor,
 * device, and correlation that caused it, and it is never reused or
 * backfilled.
 *
 * A retry of the same command reuses its number. The correlation lookup
 * handles the ordinary case; when two attempts race past that lookup, the
 * `(pharmacy, type, year, correlation)` unique constraint is the backstop and
 * the loser re-reads the winner's committed row instead of allocating again.
 */
export async function allocateDocumentNumber(
  pool: Pool,
  input: AllocateDocumentNumberInput,
): Promise<DocumentNumberAllocation> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await findAllocationByCorrelation(client, input);
    if (existing !== undefined) {
      await client.query("commit");
      return reuse(existing);
    }

    // One statement both creates the counter and takes its row lock. On
    // conflict PostgreSQL waits for any concurrent writer of the same counter,
    // re-reads the committed row, and increments it, so the value returned
    // here can never be handed to a second caller. `next_value` is the value
    // the counter will hand out next, hence the returned `next_value - 1`.
    const sequence = await client.query<{ allocated_value: string }>(
      `insert into posting_number_sequences (
         pharmacy_id, document_type, year, next_value
       ) values ($1, $2, $3, 2)
       on conflict (pharmacy_id, document_type, year) do update
         set next_value = posting_number_sequences.next_value + 1
       returning next_value - 1 as allocated_value`,
      [input.pharmacyId, input.documentType, input.year],
    );
    const allocatedValue = sequence.rows[0]?.allocated_value;
    if (allocatedValue === undefined) {
      throw new Error("The posting number sequence did not yield a value");
    }

    const inserted = await client.query<{ id: string }>(
      `insert into posting_number_allocations (
         pharmacy_id, document_type, year, value, correlation_id
       ) values ($1, $2, $3, $4, $5)
       returning id`,
      [
        input.pharmacyId,
        input.documentType,
        input.year,
        allocatedValue,
        input.correlationId,
      ],
    );
    const allocationId = inserted.rows[0]?.id;
    if (allocationId === undefined) {
      throw new Error("The posting number allocation was not created");
    }

    await writePostingAudit(client, {
      action: NUMBER_ALLOCATION_AUDIT_ACTION,
      actorUserId: input.actorUserId,
      afterState: {
        documentType: input.documentType,
        value: allocatedValue,
        year: input.year,
      },
      correlationId: input.correlationId,
      device: input.device,
      ...(input.identitySessionId === undefined
        ? {}
        : { identitySessionId: input.identitySessionId }),
      outcome: "allocated",
      pharmacyId: input.pharmacyId,
      targetId: allocationId,
    });
    await client.query("commit");
    return { allocationId, reused: false, value: BigInt(allocatedValue) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (!isCorrelationConflict(error)) {
      throw error;
    }
    // The concurrent attempt that won the correlation committed its number
    // while this one was still holding the counter. Its rollback returned the
    // counter, so no number was consumed here; read the winner's row on this
    // same connection rather than reaching for another one, which under a
    // saturated pool would be waiting for a connection this call still holds.
    const winner = await findAllocationByCorrelation(client, input).catch(
      () => undefined,
    );
    if (winner === undefined) {
      throw error;
    }
    return reuse(winner);
  } finally {
    client.release();
  }
}

/**
 * Phase two: bind an allocated number to the document that carries it, inside
 * the caller's business transaction. The whole tuple is verified, so a command
 * can never issue a number that belongs to another correlation, and the
 * database trigger refuses every transition other than allocated to issued.
 */
export async function markNumberIssued(
  client: PoolClient,
  input: MarkNumberIssuedInput,
): Promise<bigint> {
  const result = await client.query<{ value: string }>(
    `update posting_number_allocations
     set status = 'issued',
         issued_at = statement_timestamp(),
         document_id = $6
     where id = $1
       and pharmacy_id = $2
       and document_type = $3
       and year = $4
       and correlation_id = $5
       and status = 'allocated'
     returning value`,
    [
      input.allocationId,
      input.pharmacyId,
      input.documentType,
      input.year,
      input.correlationId,
      input.documentId,
    ],
  );
  const value = result.rows[0]?.value;
  if (value === undefined) {
    throw new PostingNumberIssueRejected(input.allocationId);
  }
  return BigInt(value);
}

async function findAllocationByCorrelation(
  queryable: Queryable,
  input: AllocateDocumentNumberInput,
): Promise<AllocationRow | undefined> {
  const result = await queryable.query<AllocationRow>(
    `select id, value::text as value
     from posting_number_allocations
     where pharmacy_id = $1
       and document_type = $2
       and year = $3
       and correlation_id = $4`,
    [input.pharmacyId, input.documentType, input.year, input.correlationId],
  );
  return result.rows[0];
}

function reuse(row: AllocationRow): DocumentNumberAllocation {
  return { allocationId: row.id, reused: true, value: BigInt(row.value) };
}

function isCorrelationConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === UNIQUE_VIOLATION &&
    candidate.constraint === CORRELATION_UNIQUE_CONSTRAINT
  );
}
