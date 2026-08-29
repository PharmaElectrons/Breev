import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { writePostingAudit } from "./audit-writer.js";
import { canonicalRequestHash, type JsonValue } from "./canonical-hash.js";
import { runWholeCommandWithRetry } from "./command-retry.js";
import {
  beginPostingIdempotency,
  PostingIdempotencyConflict,
  recordPostingResult,
} from "./idempotency.js";
import {
  allocateDocumentNumber,
  type DocumentNumberAllocation,
  markNumberIssued,
  NUMBER_ALLOCATION_AUDIT_ACTION,
  PostingNumberIssueRejected,
} from "./number-sequences.js";
import {
  appendOutboxEntry,
  POSTING_EVENT_TYPES,
  PostingEnvelopeVersionError,
  recordPostCommitOutcome,
} from "./outbox.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const PHARMACY_ID = "019b1000-0000-7000-8000-000000000001";
const OWNER_ROLE_ID = "019b1000-0000-7000-8000-000000000002";
const ACTOR_ID = "019b1000-0000-7000-8000-000000000003";
const SECOND_ACTOR_ID = "019b1000-0000-7000-8000-000000000004";
const DEVICE_ID = "019b1000-0000-7000-8000-000000000005";
const SESSION_ID = "019b1000-0000-7000-8000-000000000006";
const COMMAND = "pharmacy.settings.update";
const OTHER_COMMAND = "purchase.invoice.post";
const DOCUMENT_YEAR = 2026;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Every posting table whose rows are facts: written once, never rewritten. */
const APPEND_ONLY_TABLES = [
  {
    mutation:
      "update posting_command_results set response_status = response_status",
    table: "posting_command_results",
  },
  {
    mutation: "update posting_audit_records set outcome = outcome",
    table: "posting_audit_records",
  },
  {
    mutation: "update posting_outbox_entries set payload = payload",
    table: "posting_outbox_entries",
  },
  {
    mutation: "update posting_post_commit_outcomes set outcome = outcome",
    table: "posting_post_commit_outcomes",
  },
] as const;

const PENDING = Symbol("pending");

describe.sequential("posting infrastructure PostgreSQL seam", () => {
  let application: Pool;
  let database: LocalDatabaseService;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer;
  let schemaOwner: Pool;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
    process.env.BREEV_MAIN_DEVICE_ID = DEVICE_ID;
    process.env.BREEV_MAIN_DEVICE_SECRET =
      randomBytes(32).toString("base64url");
    process.env.BREEV_MAIN_DEVICE_SESSION =
      randomBytes(32).toString("base64url");
    database = new LocalDatabaseService();
    await database.ensureReady();

    // The allocator and the arbitration lock are only interesting under real
    // parallelism, so the suite runs on a pool wide enough to hold every
    // concurrent client a test starts.
    application = new Pool({
      connectionString: databaseRoles.applicationUrl,
      max: 24,
    });
    application.on("error", () => undefined);
    schemaOwner = new Pool({ connectionString: databaseRoles.migrationUrl });

    await seedPharmacy();
  }, 120_000);

  afterAll(async () => {
    await application?.end().catch(() => undefined);
    await schemaOwner?.end().catch(() => undefined);
    await database?.onApplicationShutdown().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  describe("idempotency arbitration", () => {
    it("lets exactly one of two identical concurrent commands execute", async () => {
      const idempotencyKey = randomUUID();
      const body = requestBody(idempotencyKey, true);
      const responseBody = { attendanceEnabled: true, revision: "2" };
      let executions = 0;

      const attempts = await Promise.all([
        attemptCommand({
          body,
          idempotencyKey,
          onExecute: async () => {
            executions += 1;
            await delay(150);
          },
          responseBody,
        }),
        attemptCommand({
          body,
          idempotencyKey,
          onExecute: async () => {
            executions += 1;
            await delay(150);
          },
          responseBody,
        }),
      ]);

      expect(executions).toBe(1);
      expect(attempts.filter((attempt) => attempt.executed)).toHaveLength(1);
      for (const attempt of attempts) {
        expect(attempt.responseStatus).toBe(200);
        expect(attempt.responseBody).toEqual(responseBody);
      }
      expect(await commandResultCount(idempotencyKey)).toBe(1);
    });

    it("refuses a reused key that carries a different request", async () => {
      const idempotencyKey = randomUUID();
      const original = await attemptCommand({
        body: requestBody(idempotencyKey, true),
        idempotencyKey,
        responseBody: { attendanceEnabled: true, revision: "3" },
      });
      expect(original.executed).toBe(true);

      await expect(
        attemptCommand({
          body: requestBody(idempotencyKey, false),
          idempotencyKey,
          responseBody: { attendanceEnabled: false, revision: "4" },
        }),
      ).rejects.toBeInstanceOf(PostingIdempotencyConflict);

      const stored = await application.query<{ response_body: unknown }>(
        `select response_body from posting_command_results
         where pharmacy_id = $1 and command_name = $2 and idempotency_key = $3`,
        [PHARMACY_ID, COMMAND, idempotencyKey],
      );
      expect(stored.rows).toEqual([
        { response_body: { attendanceEnabled: true, revision: "3" } },
      ]);
    });

    it("replays a stored terminal rejection with its own status", async () => {
      const idempotencyKey = randomUUID();
      const body = requestBody(idempotencyKey, true);
      const denial = { code: "version-conflict", status: "denied" };
      const first = await attemptCommand({
        body,
        idempotencyKey,
        responseBody: denial,
        responseStatus: 409,
      });
      const replay = await attemptCommand({
        body,
        idempotencyKey,
        responseBody: { never: "executed" },
        responseStatus: 200,
      });

      expect(first.executed).toBe(true);
      expect(replay.executed).toBe(false);
      expect(replay.responseStatus).toBe(409);
      expect(replay.responseBody).toEqual(denial);
    });

    it("replays for a second actor because the scope is the pharmacy and command", async () => {
      const idempotencyKey = randomUUID();
      const body = requestBody(idempotencyKey, true);
      const responseBody = { attendanceEnabled: true, revision: "5" };
      const first = await attemptCommand({
        body,
        idempotencyKey,
        responseBody,
      });
      const second = await attemptCommand({
        actorUserId: SECOND_ACTOR_ID,
        body,
        idempotencyKey,
        responseBody: { attendanceEnabled: true, revision: "99" },
      });

      expect(first.executed).toBe(true);
      expect(second.executed).toBe(false);
      expect(second.responseBody).toEqual(responseBody);
      const recorded = await application.query<{ actor_user_id: string }>(
        `select actor_user_id from posting_command_results
         where pharmacy_id = $1 and command_name = $2 and idempotency_key = $3`,
        [PHARMACY_ID, COMMAND, idempotencyKey],
      );
      expect(recorded.rows).toEqual([{ actor_user_id: ACTOR_ID }]);
    });

    it("keeps one key independent across command kinds", async () => {
      const usedKey = randomUUID();
      await attemptCommand({
        body: requestBody(usedKey, true),
        idempotencyKey: usedKey,
        responseBody: { attendanceEnabled: true, revision: "6" },
      });

      await inTransaction(async (client) => {
        await expect(
          beginPostingIdempotency(client, {
            commandName: OTHER_COMMAND,
            idempotencyKey: usedKey,
            pharmacyId: PHARMACY_ID,
            requestHash: canonicalRequestHash(
              OTHER_COMMAND,
              requestBody(usedKey, true),
            ),
          }),
        ).resolves.toBeUndefined();
      });

      // The arbitration lock is scoped to the command as well, so a different
      // command kind does not even queue behind an in-flight settings post.
      const freeKey = randomUUID();
      const settingsHash = canonicalRequestHash(
        COMMAND,
        requestBody(freeKey, true),
      );
      const holder = await application.connect();
      const otherKind = await application.connect();
      const sameKind = await application.connect();
      try {
        await holder.query("begin");
        await beginPostingIdempotency(holder, {
          commandName: COMMAND,
          idempotencyKey: freeKey,
          pharmacyId: PHARMACY_ID,
          requestHash: settingsHash,
        });

        await otherKind.query("begin");
        await expect(
          raceTimeout(
            beginPostingIdempotency(otherKind, {
              commandName: OTHER_COMMAND,
              idempotencyKey: freeKey,
              pharmacyId: PHARMACY_ID,
              requestHash: canonicalRequestHash(
                OTHER_COMMAND,
                requestBody(freeKey, true),
              ),
            }),
            5_000,
          ),
        ).resolves.toBeUndefined();

        await sameKind.query("begin");
        const blocked = beginPostingIdempotency(sameKind, {
          commandName: COMMAND,
          idempotencyKey: freeKey,
          pharmacyId: PHARMACY_ID,
          requestHash: settingsHash,
        });
        expect(await raceTimeout(blocked, 500)).toBe(PENDING);
        await holder.query("commit");
        await expect(blocked).resolves.toBeUndefined();
      } finally {
        for (const client of [holder, otherKind, sameKind]) {
          await client.query("rollback").catch(() => undefined);
          client.release();
        }
      }

      await expect(
        application.query(
          `insert into posting_command_results (
             pharmacy_id, command_name, idempotency_key, actor_user_id,
             main_device_id, request_hash, response_status, response_body
           ) values ($1, $2, $3, $4, $5, $6, 200, '{}'::jsonb)`,
          [
            PHARMACY_ID,
            OTHER_COMMAND,
            randomUUID(),
            ACTOR_ID,
            DEVICE_ID,
            randomBytes(32),
          ],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "posting_command_results_name",
      });
    });
  });

  describe("document number allocator", () => {
    it("never hands the same number to two concurrent allocations", async () => {
      const documentType = "concurrent-doc";
      const allocations = await Promise.all(
        Array.from({ length: 12 }, () =>
          allocate({ correlationId: randomUUID(), documentType }),
        ),
      );

      const values = allocations
        .map((allocation) => allocation.value)
        .sort((left, right) => Number(left - right));
      expect(values).toEqual(
        Array.from({ length: 12 }, (_unused, index) => BigInt(index + 1)),
      );
      expect(allocations.every((allocation) => !allocation.reused)).toBe(true);
      expect(await sequenceNextValue(documentType)).toBe(13n);
      expect(await allocationAuditCount(documentType)).toBe(12);
    });

    it("returns the same number to a retry that carries the same correlation", async () => {
      const documentType = "retry-doc";
      const correlationId = randomUUID();
      const first = await allocate({ correlationId, documentType });
      const second = await allocate({ correlationId, documentType });

      expect(first.reused).toBe(false);
      expect(second.reused).toBe(true);
      expect(second.value).toBe(first.value);
      expect(second.allocationId).toBe(first.allocationId);
      expect(await allocationCount(documentType)).toBe(1);
      expect(await allocationAuditCount(documentType)).toBe(1);
      expect(await sequenceNextValue(documentType)).toBe(first.value + 1n);
    });

    it("converges when two attempts of one command race for its number", async () => {
      const documentType = "race-doc";
      const correlationId = randomUUID();
      const attempts = await Promise.all([
        allocate({ correlationId, documentType }),
        allocate({ correlationId, documentType }),
      ]);

      const [first, second] = attempts;
      expect(first?.value).toBe(second?.value);
      expect(first?.allocationId).toBe(second?.allocationId);
      expect(attempts.filter((attempt) => attempt.reused)).toHaveLength(1);
      expect(await allocationCount(documentType)).toBe(1);
      expect(await allocationAuditCount(documentType)).toBe(1);
      // The attempt that lost the correlation returned its number, so the
      // counter advanced exactly once.
      expect(await sequenceNextValue(documentType)).toBe(2n);
    });

    it("leaves a rolled-back command an audited gap that is never reused", async () => {
      const documentType = "gap-doc";
      const correlationId = randomUUID();
      const gap = await allocate({ correlationId, documentType });

      const client = await application.connect();
      try {
        await client.query("begin");
        await writePostingAudit(client, {
          action: "pharmacy.settings.update",
          actorUserId: ACTOR_ID,
          correlationId,
          device: { deviceId: DEVICE_ID, terminalDeviceId: undefined },
          outcome: "attempted",
          pharmacyId: PHARMACY_ID,
        });
        await client.query("rollback");
      } finally {
        client.release();
      }

      const stranded = await allocationRow(gap.allocationId);
      expect(stranded).toMatchObject({
        correlation_id: correlationId,
        document_id: null,
        issued_at: null,
        status: "allocated",
      });
      const audit = await application.query<{
        actor_user_id: string;
        device_id: string;
        outcome: string;
        target_id: string;
      }>(
        `select actor_user_id, device_id, outcome, target_id
         from posting_audit_records
         where action = $1 and correlation_id = $2`,
        [NUMBER_ALLOCATION_AUDIT_ACTION, correlationId],
      );
      expect(audit.rows).toEqual([
        {
          actor_user_id: ACTOR_ID,
          device_id: DEVICE_ID,
          outcome: "allocated",
          target_id: gap.allocationId,
        },
      ]);

      const later = await Promise.all([
        allocate({ correlationId: randomUUID(), documentType }),
        allocate({ correlationId: randomUUID(), documentType }),
        allocate({ correlationId: randomUUID(), documentType }),
      ]);
      expect(later.map((allocation) => allocation.value)).not.toContain(
        gap.value,
      );
      expect(later.every((allocation) => allocation.value > gap.value)).toBe(
        true,
      );
      expect(await allocationRow(gap.allocationId)).toMatchObject({
        status: "allocated",
      });
    });

    it("issues a number only to the correlation that allocated it", async () => {
      const documentType = "issue-doc";
      const correlationId = randomUUID();
      const allocation = await allocate({ correlationId, documentType });
      const documentId = randomUUID();

      await inTransaction(async (client) => {
        await expect(
          markNumberIssued(client, {
            allocationId: allocation.allocationId,
            correlationId: randomUUID(),
            documentId,
            documentType,
            pharmacyId: PHARMACY_ID,
            year: DOCUMENT_YEAR,
          }),
        ).rejects.toBeInstanceOf(PostingNumberIssueRejected);
      });
      expect(await allocationRow(allocation.allocationId)).toMatchObject({
        status: "allocated",
      });

      await inTransaction(async (client) => {
        await expect(
          markNumberIssued(client, {
            allocationId: allocation.allocationId,
            correlationId,
            documentId,
            documentType,
            pharmacyId: PHARMACY_ID,
            year: DOCUMENT_YEAR,
          }),
        ).resolves.toBe(allocation.value);
      });
      const issued = await allocationRow(allocation.allocationId);
      expect(issued).toMatchObject({
        document_id: documentId,
        status: "issued",
      });
      expect(issued?.issued_at).toBeInstanceOf(Date);

      await inTransaction(async (client) => {
        await expect(
          markNumberIssued(client, {
            allocationId: allocation.allocationId,
            correlationId,
            documentId: randomUUID(),
            documentType,
            pharmacyId: PHARMACY_ID,
            year: DOCUMENT_YEAR,
          }),
        ).rejects.toBeInstanceOf(PostingNumberIssueRejected);
      });
    });

    it("refuses to delete an allocation or rewind an issued one", async () => {
      const documentType = "trigger-doc";
      const allocated = await allocate({
        correlationId: randomUUID(),
        documentType,
      });
      const issuedCorrelation = randomUUID();
      const issued = await allocate({
        correlationId: issuedCorrelation,
        documentType,
      });
      await inTransaction(async (client) => {
        await markNumberIssued(client, {
          allocationId: issued.allocationId,
          correlationId: issuedCorrelation,
          documentId: randomUUID(),
          documentType,
          pharmacyId: PHARMACY_ID,
          year: DOCUMENT_YEAR,
        });
      });

      await expect(
        application.query(
          "delete from posting_number_allocations where id = $1",
          [allocated.allocationId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        application.query(
          `update posting_number_allocations
           set status = 'allocated', issued_at = null, document_id = null
           where id = $1`,
          [issued.allocationId],
        ),
      ).rejects.toThrow("only advance from allocated to issued");
      await expect(
        application.query(
          `update posting_number_allocations
           set status = 'issued', issued_at = statement_timestamp(),
               document_id = $2, value = value + 1000
           where id = $1`,
          [allocated.allocationId, randomUUID()],
        ),
      ).rejects.toThrow("identity is immutable");

      // The schema owner is subject to the same trigger, so no maintenance
      // path can quietly reissue or erase a handed-out number.
      await expect(
        schemaOwner.query(
          "delete from posting_number_allocations where id = $1",
          [allocated.allocationId],
        ),
      ).rejects.toThrow("posting number allocations are never deleted");
      await expect(
        schemaOwner.query(
          "update posting_number_allocations set value = value + 1 where id = $1",
          [allocated.allocationId],
        ),
      ).rejects.toThrow("only advance from allocated to issued");

      expect(await allocationRow(allocated.allocationId)).toMatchObject({
        status: "allocated",
        value: allocated.value.toString(),
      });
    });
  });

  describe("outbox envelopes", () => {
    it("records an envelope only when the posting transaction commits", async () => {
      const rolledBack = randomUUID();
      const client = await application.connect();
      try {
        await client.query("begin");
        await appendOutboxEntry(client, {
          correlationId: rolledBack,
          envelopeVersion: 1,
          eventType: POSTING_EVENT_TYPES.pharmacySettingsChanged,
          payload: { attendanceEnabled: true, revision: "2" },
          pharmacyId: PHARMACY_ID,
        });
        await client.query("rollback");
      } finally {
        client.release();
      }
      expect(await outboxCount(rolledBack)).toBe(0);

      const correlationId = randomUUID();
      const occurredAt = new Date("2026-03-01T09:15:00.000Z");
      const entry = await inTransaction((committed) =>
        appendOutboxEntry(committed, {
          correlationId,
          envelopeVersion: 1,
          eventType: POSTING_EVENT_TYPES.pharmacySettingsChanged,
          occurredAt,
          payload: { attendanceEnabled: true, revision: "2" },
          pharmacyId: PHARMACY_ID,
        }),
      );

      expect(entry.id).toMatch(UUID_V7);
      expect(entry.occurredAt.toISOString()).toBe(occurredAt.toISOString());
      const stored = await application.query<{
        correlation_id: string;
        envelope_version: number;
        event_type: string;
        payload: unknown;
        pharmacy_id: string;
      }>(
        `select correlation_id, envelope_version, event_type, payload, pharmacy_id
         from posting_outbox_entries where id = $1`,
        [entry.id],
      );
      expect(stored.rows).toEqual([
        {
          correlation_id: correlationId,
          envelope_version: 1,
          event_type: "pharmacy.settings.changed",
          payload: { attendanceEnabled: true, revision: "2" },
          pharmacy_id: PHARMACY_ID,
        },
      ]);

      await inTransaction(async (writer) => {
        await expect(
          appendOutboxEntry(writer, {
            correlationId,
            envelopeVersion: 2,
            eventType: POSTING_EVENT_TYPES.pharmacySettingsChanged,
            payload: {},
            pharmacyId: PHARMACY_ID,
          }),
        ).rejects.toBeInstanceOf(PostingEnvelopeVersionError);
      });
      await expect(
        application.query(
          `insert into posting_outbox_entries (
             pharmacy_id, event_type, envelope_version, occurred_at,
             correlation_id, payload
           ) values ($1, 'purchase.posted', 1, statement_timestamp(), $2, '{}'::jsonb)`,
          [PHARMACY_ID, correlationId],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "posting_outbox_entries_event_type",
      });

      await inTransaction((writer) =>
        recordPostCommitOutcome(writer, {
          outboxEntryId: entry.id,
          outcome: "recorded",
        }),
      );
      await inTransaction((writer) =>
        recordPostCommitOutcome(writer, {
          outboxEntryId: entry.id,
          outcome: "recorded-again",
        }),
      );
      const outcomes = await application.query<{ outcome: string }>(
        "select outcome from posting_post_commit_outcomes where outbox_entry_id = $1",
        [entry.id],
      );
      expect(outcomes.rows).toEqual([{ outcome: "recorded" }]);
    });
  });

  describe("append-only posting facts", () => {
    it.each(APPEND_ONLY_TABLES)(
      "refuses to rewrite or erase $table",
      async ({ mutation, table }) => {
        expect(await rowCount(table)).toBeGreaterThan(0);

        // The application role is not granted update or delete here, so it is
        // refused before the trigger is consulted.
        await expect(application.query(mutation)).rejects.toMatchObject({
          code: "42501",
        });
        await expect(
          application.query(`delete from ${table}`),
        ).rejects.toMatchObject({ code: "42501" });

        // Production grants the application role full DML through the
        // bootstrap default privileges, so the trigger — not the grant — has
        // to be what stops it. Reproduce those privileges and prove it.
        await withProductionWritePrivileges(table, async () => {
          await expect(application.query(mutation)).rejects.toThrow(
            "posting facts are immutable",
          );
          await expect(
            application.query(`delete from ${table}`),
          ).rejects.toThrow("posting facts are immutable");
        });

        // The schema owner owns the table and is still subject to the trigger.
        await expect(schemaOwner.query(mutation)).rejects.toMatchObject({
          code: "55000",
          message: "posting facts are immutable",
        });
        await expect(
          schemaOwner.query(`delete from ${table}`),
        ).rejects.toMatchObject({
          code: "55000",
          message: "posting facts are immutable",
        });
      },
    );

    it("refuses to rewind, retarget, or erase a number sequence", async () => {
      await application.query(
        `insert into posting_number_sequences (pharmacy_id, document_type, year, next_value)
         values ($1, 'sequence-guard-doc', $2, 7)`,
        [PHARMACY_ID, DOCUMENT_YEAR],
      );
      const where = `where pharmacy_id = '${PHARMACY_ID}' and document_type = 'sequence-guard-doc'`;

      // The application role legitimately holds update on sequences (the
      // allocator increments them), so a rewind is stopped by the trigger
      // itself — there is no grant to hide behind.
      await expect(
        application.query(
          `update posting_number_sequences set next_value = 6 ${where}`,
        ),
      ).rejects.toMatchObject({
        code: "55000",
        message: "a posting number sequence only advances",
      });
      await expect(
        application.query(
          `update posting_number_sequences set next_value = 7 ${where}`,
        ),
      ).rejects.toMatchObject({
        code: "55000",
        message: "a posting number sequence only advances",
      });
      await expect(
        application.query(
          `update posting_number_sequences set year = year + 1 ${where}`,
        ),
      ).rejects.toMatchObject({
        code: "55000",
        message: "a posting number sequence identity is immutable",
      });

      // Deleting the counter would let the next insert restart at 1 and
      // reuse every number ever issued. The app role has no delete grant
      // here, production grants one through the bootstrap default
      // privileges, and the schema owner owns the table — the trigger has
      // to stop all three.
      await expect(
        application.query(`delete from posting_number_sequences ${where}`),
      ).rejects.toMatchObject({ code: "42501" });
      // Only delete is granted and revoked here: the migration's update grant
      // must survive this test, because the allocator legitimately uses it.
      await schemaOwner.query(
        "grant delete on table posting_number_sequences to breev_app",
      );
      try {
        await expect(
          application.query(`delete from posting_number_sequences ${where}`),
        ).rejects.toMatchObject({
          code: "55000",
          message: "posting number sequences are never deleted",
        });
      } finally {
        await schemaOwner.query(
          "revoke delete on table posting_number_sequences from breev_app",
        );
      }
      await expect(
        schemaOwner.query(`delete from posting_number_sequences ${where}`),
      ).rejects.toMatchObject({
        code: "55000",
        message: "posting number sequences are never deleted",
      });

      // A forward move remains allowed: the allocator's increment must pass.
      await application.query(
        `update posting_number_sequences set next_value = 8 ${where}`,
      );
      const advanced = await application.query<{ next_value: string }>(
        `select next_value::text from posting_number_sequences ${where}`,
      );
      expect(advanced.rows[0]?.next_value).toBe("8");
    });
  });

  describe("whole-command retry after a real deadlock", () => {
    it("reruns the deadlocked command and reuses the number it allocated", async () => {
      const documentType = "deadlock-doc";
      await application.query(
        `insert into posting_number_sequences (pharmacy_id, document_type, year)
         values ($1, 'deadlock-lock-a', $2), ($1, 'deadlock-lock-b', $2)`,
        [PHARMACY_ID, DOCUMENT_YEAR],
      );

      const arrive = createBarrier(2);
      const attemptsByCorrelation = new Map<
        string,
        DocumentNumberAllocation[]
      >();
      const abortCodes: string[] = [];

      const runCommand = async (
        correlationId: string,
        firstLock: string,
        secondLock: string,
      ): Promise<DocumentNumberAllocation> =>
        runWholeCommandWithRetry(async () => {
          const allocation = await allocate({ correlationId, documentType });
          const seen = attemptsByCorrelation.get(correlationId) ?? [];
          seen.push(allocation);
          attemptsByCorrelation.set(correlationId, seen);

          const client = await application.connect();
          try {
            await client.query("begin");
            await lockSequenceRow(client, firstLock);
            await arrive();
            await lockSequenceRow(client, secondLock);
            await client.query("commit");
            return allocation;
          } catch (error) {
            await client.query("rollback").catch(() => undefined);
            const code: unknown = (error as { code?: unknown }).code;
            if (typeof code === "string") {
              abortCodes.push(code);
            }
            throw error;
          } finally {
            client.release();
          }
        });

      const left = randomUUID();
      const right = randomUUID();
      const results = await Promise.all([
        runCommand(left, "deadlock-lock-a", "deadlock-lock-b"),
        runCommand(right, "deadlock-lock-b", "deadlock-lock-a"),
      ]);

      expect(abortCodes).toContain("40P01");
      const leftAttempts = attemptsByCorrelation.get(left) ?? [];
      const rightAttempts = attemptsByCorrelation.get(right) ?? [];
      expect(leftAttempts.length + rightAttempts.length).toBe(3);

      const retried = leftAttempts.length === 2 ? leftAttempts : rightAttempts;
      expect(retried).toHaveLength(2);
      expect(retried[0]?.reused).toBe(false);
      expect(retried[1]?.reused).toBe(true);
      expect(retried[1]?.value).toBe(retried[0]?.value);
      expect(retried[1]?.allocationId).toBe(retried[0]?.allocationId);

      expect(results[0]?.value).not.toBe(results[1]?.value);
      expect(await allocationCount(documentType)).toBe(2);
      expect(await sequenceNextValue(documentType)).toBe(3n);
    }, 60_000);
  });

  async function seedPharmacy(): Promise<void> {
    await application.query(
      "insert into pharmacies (id, name) values ($1, 'Breev Posting Test Pharmacy')",
      [PHARMACY_ID],
    );
    await application.query(
      "insert into pharmacy_roles (id, pharmacy_id, role_key) values ($1, $2, 'owner')",
      [OWNER_ROLE_ID, PHARMACY_ID],
    );
    for (const [id, username] of [
      [ACTOR_ID, "posting.actor"],
      [SECOND_ACTOR_ID, "posting.second"],
    ] as const) {
      await application.query(
        `insert into identity_users (
           id, pharmacy_id, username, username_key, display_name, role_id,
           password_hash, password_algorithm, password_version,
           password_memory_kib, password_iterations, password_parallelism
         ) values ($1, $2, $3, $3, 'Posting Actor', $4, $5,
                   'argon2id', 19, 19456, 2, 1)`,
        [id, PHARMACY_ID, username, OWNER_ROLE_ID, Buffer.alloc(64)],
      );
    }
    const session = await application.query<{ token_hash: Buffer }>(
      "select token_hash from main_device_sessions where device_id = $1",
      [DEVICE_ID],
    );
    const tokenHash = session.rows[0]?.token_hash;
    if (tokenHash === undefined) {
      throw new Error("The provisioned Main device session is missing");
    }
    await application.query(
      `insert into identity_sessions (
         id, pharmacy_id, user_id, device_id, device_session_hash, expires_at
       ) values ($1, $2, $3, $4, $5, now() + interval '1 day')`,
      [SESSION_ID, PHARMACY_ID, ACTOR_ID, DEVICE_ID, tokenHash],
    );
  }

  interface CommandAttempt {
    readonly executed: boolean;
    readonly responseBody: unknown;
    readonly responseStatus: number;
  }

  /**
   * The shape every posting command shares: arbitrate, execute once, record
   * the terminal outcome, and commit all of it together.
   */
  async function attemptCommand(input: {
    readonly actorUserId?: string;
    readonly body: JsonValue;
    readonly idempotencyKey: string;
    readonly onExecute?: () => Promise<void>;
    readonly responseBody: unknown;
    readonly responseStatus?: number;
  }): Promise<CommandAttempt> {
    const requestHash = canonicalRequestHash(COMMAND, input.body);
    const client = await application.connect();
    try {
      await client.query("begin");
      const replay = await beginPostingIdempotency(client, {
        commandName: COMMAND,
        idempotencyKey: input.idempotencyKey,
        pharmacyId: PHARMACY_ID,
        requestHash,
      });
      if (replay !== undefined) {
        await client.query("commit");
        return { executed: false, ...replay };
      }
      await input.onExecute?.();
      const responseStatus = input.responseStatus ?? 200;
      await recordPostingResult(client, {
        actorUserId: input.actorUserId ?? ACTOR_ID,
        commandName: COMMAND,
        idempotencyKey: input.idempotencyKey,
        identitySessionId: SESSION_ID,
        device: { deviceId: DEVICE_ID, terminalDeviceId: undefined },
        pharmacyId: PHARMACY_ID,
        requestHash,
        responseBody: input.responseBody,
        responseStatus,
      });
      await client.query("commit");
      return {
        executed: true,
        responseBody: input.responseBody,
        responseStatus,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function inTransaction<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await application.connect();
    try {
      await client.query("begin");
      const result = await run(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function allocate(input: {
    readonly correlationId: string;
    readonly documentType: string;
  }): Promise<DocumentNumberAllocation> {
    return await allocateDocumentNumber(application, {
      actorUserId: ACTOR_ID,
      correlationId: input.correlationId,
      device: { deviceId: DEVICE_ID, terminalDeviceId: undefined },
      documentType: input.documentType,
      identitySessionId: SESSION_ID,
      pharmacyId: PHARMACY_ID,
      year: DOCUMENT_YEAR,
    });
  }

  async function lockSequenceRow(
    client: PoolClient,
    documentType: string,
  ): Promise<void> {
    // FOR UPDATE takes the row lock the way a posting command would, without
    // writing: the sequence-guard trigger rejects a no-op update.
    await client.query(
      `select next_value from posting_number_sequences
       where pharmacy_id = $1 and document_type = $2 and year = $3
       for update`,
      [PHARMACY_ID, documentType, DOCUMENT_YEAR],
    );
  }

  async function withProductionWritePrivileges(
    table: string,
    run: () => Promise<void>,
  ): Promise<void> {
    if (!/^posting_[a-z_]+$/u.test(table)) {
      throw new Error(`Refusing to grant on an unexpected table: ${table}`);
    }
    await schemaOwner.query(
      `grant update, delete on table ${table} to breev_app`,
    );
    try {
      await run();
    } finally {
      await schemaOwner.query(
        `revoke update, delete on table ${table} from breev_app`,
      );
    }
  }

  async function rowCount(table: string): Promise<number> {
    if (!/^posting_[a-z_]+$/u.test(table)) {
      throw new Error(`Refusing to count an unexpected table: ${table}`);
    }
    const result = await application.query<{ count: string }>(
      `select count(*)::text as count from ${table}`,
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async function commandResultCount(idempotencyKey: string): Promise<number> {
    const result = await application.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
       where pharmacy_id = $1 and idempotency_key = $2`,
      [PHARMACY_ID, idempotencyKey],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async function outboxCount(correlationId: string): Promise<number> {
    const result = await application.query<{ count: string }>(
      `select count(*)::text as count from posting_outbox_entries
       where correlation_id = $1`,
      [correlationId],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async function allocationCount(documentType: string): Promise<number> {
    const result = await application.query<{ count: string }>(
      `select count(*)::text as count from posting_number_allocations
       where pharmacy_id = $1 and document_type = $2 and year = $3`,
      [PHARMACY_ID, documentType, DOCUMENT_YEAR],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async function allocationAuditCount(documentType: string): Promise<number> {
    const result = await application.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where action = $1 and after_state ->> 'documentType' = $2`,
      [NUMBER_ALLOCATION_AUDIT_ACTION, documentType],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async function allocationRow(id: string): Promise<
    | {
        readonly correlation_id: string;
        readonly document_id: string | null;
        readonly issued_at: Date | null;
        readonly status: string;
        readonly value: string;
      }
    | undefined
  > {
    const result = await application.query<{
      correlation_id: string;
      document_id: string | null;
      issued_at: Date | null;
      status: string;
      value: string;
    }>(
      `select correlation_id, document_id, issued_at, status, value::text as value
       from posting_number_allocations where id = $1`,
      [id],
    );
    return result.rows[0];
  }

  async function sequenceNextValue(documentType: string): Promise<bigint> {
    const result = await application.query<{ next_value: string }>(
      `select next_value::text as next_value from posting_number_sequences
       where pharmacy_id = $1 and document_type = $2 and year = $3`,
      [PHARMACY_ID, documentType, DOCUMENT_YEAR],
    );
    const value = result.rows[0]?.next_value;
    if (value === undefined) {
      throw new Error(`No posting number sequence exists for ${documentType}`);
    }
    return BigInt(value);
  }
});

function requestBody(
  idempotencyKey: string,
  attendanceEnabled: boolean,
): JsonValue {
  return { attendanceEnabled, expectedRevision: "1", idempotencyKey };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Resolves to the promise's value, or to PENDING if it has not settled. */
async function raceTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T | typeof PENDING> {
  void promise.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => {
      resolve(PENDING);
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Releases every caller once the given number of them has arrived. */
function createBarrier(participants: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= participants) {
      release();
    }
    await gate;
  };
}
