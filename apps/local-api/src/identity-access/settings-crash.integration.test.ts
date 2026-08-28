import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import {
  SETTINGS_POST_COMMIT_OUTCOME,
  SETTINGS_POST_COMMIT_QUEUE,
} from "./settings-post-commit.service.js";
import type { SettingsCrashPoint } from "./test-helpers/settings-crash-child.test.js";
import {
  SettingsCrashHarness,
  type SettingsCrashWorkerOptions,
} from "./test-helpers/settings-crash-harness.test.js";

/**
 * The four-point crash battery `docs/quality.md` requires, run over the real
 * settings posting pipeline: every command below is posted through the packaged
 * `dist/main.js` over HTTP, with the device binding, the permission check, and
 * the one posting transaction that writes the settings change, its audit fact,
 * its envelope, its idempotency result, and its post-commit job.
 *
 * Who claims the job is decided by the test, not by a timer. A schema-owner
 * rule on the job table holds every settings post-commit job at a start time an
 * hour away and gives it a two-second lease. Holding the start time is what
 * removes the race: the running API cannot claim a job it cannot see, so each
 * scenario can kill the API first and only then release its job to the process
 * that is supposed to claim it. Nothing the command wrote is touched — the
 * payload, the queue, the atomic binding to the transaction, and the recorded
 * facts are exactly what production writes. The lease is shortened for the same
 * reason `apps/local-api/src/durable-jobs/durable-jobs.integration.test.ts`
 * sends its crash-battery jobs with a two-second lease: a sixty-second lease
 * cannot be observed expiring inside a test run.
 *
 * Recovery is never simulated. In every scenario the process that finishes the
 * work is the real `SettingsPostCommitService` inside a restarted API.
 */

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "settings.crash.owner";
const OWNER_PASSWORD = "settings crash battery owner password stays here";
const HOLD_RULE = "breev_settings_crash_hold";
const LEASE_SECONDS = 2;
const LEASE_EXPIRY_WAIT_MS = 3_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: Record<string, unknown> | undefined;
  readonly status: number;
}

interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface SettingsView {
  readonly attendanceEnabled: boolean;
  readonly revision: string;
}

/**
 * Everything the settings command committed, timestamps included. Comparing two
 * of these is how each scenario proves the post-commit job never replayed the
 * business command: a second execution would move the settings revision, add an
 * audit fact, add an envelope, or rewrite the recorded result.
 */
interface CommandFacts {
  readonly attendanceEnabled: boolean;
  readonly audits: readonly {
    id: string;
    occurredAt: string;
    outcome: string;
  }[];
  readonly outbox: readonly {
    id: string;
    occurredAt: string;
    recordedAt: string;
  }[];
  readonly results: readonly { recordedAt: string; responseStatus: number }[];
  readonly revision: string;
  readonly updatedAt: string;
}

interface PostedCommand {
  readonly jobId: string;
  readonly key: string;
  readonly outboxEntryId: string;
}

interface JobRow {
  readonly completedOn: string | null;
  readonly retryCount: number;
  readonly ready: boolean;
  readonly startedOn: string | null;
  readonly state: string;
}

interface OutcomeRow {
  readonly outcome: string;
  readonly recordedAt: string;
}

describe.sequential("pharmacy settings post-commit crash battery", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOutput = "";
  let apiOrigin: string;
  let apiPort: number;
  let bootstrapped = false;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let durableJobs: DurableJobsService;
  let harness: SettingsCrashHarness;
  let jobTable: string;
  let localDatabase: LocalDatabaseService;
  let originalEnvironment: NodeJS.ProcessEnv;
  let pharmacyId: string;
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    originalEnvironment = { ...process.env };
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });

    // The first start migrates the database and registers the post-commit
    // queue, which has to exist before the hold rule can be attached to it.
    await startApi();

    const pharmacy = await administrator.query<{ id: string }>(
      "select id from pharmacies",
    );
    pharmacyId = pharmacy.rows[0]?.id ?? "";
    expect(pharmacyId).toMatch(UUID_PATTERN);

    jobTable = await resolveJobTable();
    await holdSettingsJobs();

    // The suite's own job runtime exists to supervise expired leases. It
    // registers no worker, so it never competes for a claim.
    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    delete process.env.DATABASE_MIGRATION_URL;
    localDatabase = new LocalDatabaseService();
    await localDatabase.onModuleInit();
    durableJobs = new DurableJobsService(localDatabase);
    await durableJobs.onModuleInit();

    harness = new SettingsCrashHarness();
  }, 180_000);

  afterEach(async () => {
    // No worker from a finished scenario may survive to claim the next one.
    await harness?.stopAll().catch(() => undefined);
  });

  afterAll(async () => {
    await harness?.stopAll().catch(() => undefined);
    await stopApi();
    await releaseSettingsJobs().catch(() => undefined);
    await durableJobs?.onApplicationShutdown().catch(() => undefined);
    await localDatabase?.onApplicationShutdown().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    process.env = originalEnvironment;
  });

  it("survives a crash before claim with one settings change, one audit fact, one outbox row, and one outcome", async () => {
    const posted = await postSettingsChange();
    const facts = await commandFacts(posted.key);
    expectOnePostedCommand(facts);

    // The process that owns the post-commit worker dies while the job it just
    // committed is still waiting to be claimed.
    const exit = await killApi();
    expect(exit.signal).toBe("SIGKILL");

    const untouched = await jobRow(posted.jobId);
    expect(untouched.startedOn).toBeNull();
    expect(untouched.state).toBe("created");
    expect(await outcomeRows(posted.outboxEntryId)).toEqual([]);

    await releaseJob(posted.jobId);
    await startApi();

    expect(await waitForOutcomes(posted.outboxEntryId)).toEqual([
      { outcome: SETTINGS_POST_COMMIT_OUTCOME, recordedAt: expect.any(String) },
    ]);
    await waitForJobState(posted.jobId, "completed");
    // Nothing was ever retried: the job waited, and the first delivery after
    // the restart was the only one.
    expect((await jobRow(posted.jobId)).retryCount).toBe(0);
    expect(await commandFacts(posted.key)).toEqual(facts);
  }, 180_000);

  it("survives a crash after claim with one settings change, one audit fact, one outbox row, and one outcome", async () => {
    const posted = await postSettingsChange();
    const facts = await commandFacts(posted.key);
    expectOnePostedCommand(facts);
    expect((await killApi()).signal).toBe("SIGKILL");
    await releaseJob(posted.jobId);

    const worker = await harness.spawnWorker(
      workerOptions(posted, "after-claim"),
    );
    const crashing = await worker.waitForEvent(
      (event) => event.type === "crashing",
    );
    expect(crashing.point).toBe("after-claim");
    expect(crashing.jobId).toBe(posted.jobId);
    // The fork died at the handler door, before it had even read the envelope,
    // which is what separates this point from the one before outcome recording.
    expect(crashing.pharmacyId).toBeNull();
    expect((await worker.waitForExit()).signal).toBe("SIGKILL");

    // The claim is durable and nothing else happened.
    const abandoned = await jobRow(posted.jobId);
    expect(abandoned.startedOn).not.toBeNull();
    expect(await outcomeRows(posted.outboxEntryId)).toEqual([]);

    await recoverAbandonedJob(posted.jobId);

    expect(await waitForOutcomes(posted.outboxEntryId)).toEqual([
      { outcome: SETTINGS_POST_COMMIT_OUTCOME, recordedAt: expect.any(String) },
    ]);
    await expectRedelivered(posted.jobId);
    expect(await commandFacts(posted.key)).toEqual(facts);
  }, 180_000);

  it("survives a crash after external success with one settings change, one audit fact, one outbox row, and one outcome", async () => {
    const posted = await postSettingsChange();
    const facts = await commandFacts(posted.key);
    expectOnePostedCommand(facts);
    expect((await killApi()).signal).toBe("SIGKILL");
    await releaseJob(posted.jobId);

    const worker = await harness.spawnWorker(
      workerOptions(posted, "after-external-success"),
    );
    const crashing = await worker.waitForEvent(
      (event) => event.type === "crashing",
    );
    expect(crashing.point).toBe("after-external-success");
    expect(crashing.pharmacyId).toBe(pharmacyId);
    expect((await worker.waitForExit()).signal).toBe("SIGKILL");

    // The outcome committed; the job runtime never learned the work succeeded.
    const recorded = await outcomeRows(posted.outboxEntryId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.outcome).toBe(SETTINGS_POST_COMMIT_OUTCOME);
    const stillClaimed = await jobRow(posted.jobId);
    expect(stillClaimed.completedOn).toBeNull();

    await recoverAbandonedJob(posted.jobId);
    await expectRedelivered(posted.jobId);

    // The redelivery converged on the row that was already there: same row,
    // same clock, nothing added.
    expect(await outcomeRows(posted.outboxEntryId)).toEqual(recorded);
    expect(await commandFacts(posted.key)).toEqual(facts);
  }, 180_000);

  it("survives a crash before Breev records the outcome with one settings change, one audit fact, one outbox row, and one outcome", async () => {
    const posted = await postSettingsChange();
    const facts = await commandFacts(posted.key);
    expectOnePostedCommand(facts);
    expect((await killApi()).signal).toBe("SIGKILL");
    await releaseJob(posted.jobId);

    const worker = await harness.spawnWorker(
      workerOptions(posted, "before-outcome-recording"),
    );
    const crashing = await worker.waitForEvent(
      (event) => event.type === "crashing",
    );
    expect(crashing.point).toBe("before-outcome-recording");
    // The envelope had been read and checked, so the kill landed between the
    // verification and the one durable effect rather than at the handler door.
    expect(crashing.pharmacyId).toBe(pharmacyId);
    expect((await worker.waitForExit()).signal).toBe("SIGKILL");

    const abandoned = await jobRow(posted.jobId);
    expect(abandoned.startedOn).not.toBeNull();
    expect(abandoned.completedOn).toBeNull();
    expect(await outcomeRows(posted.outboxEntryId)).toEqual([]);

    await recoverAbandonedJob(posted.jobId);

    expect(await waitForOutcomes(posted.outboxEntryId)).toEqual([
      { outcome: SETTINGS_POST_COMMIT_OUTCOME, recordedAt: expect.any(String) },
    ]);
    await expectRedelivered(posted.jobId);
    expect(await commandFacts(posted.key)).toEqual(facts);
  }, 180_000);

  it("records nothing new when the same job is delivered a second time", async () => {
    const posted = await postSettingsChange();
    const facts = await commandFacts(posted.key);
    expectOnePostedCommand(facts);
    expect((await killApi()).signal).toBe("SIGKILL");
    await releaseJob(posted.jobId);

    const worker = await harness.spawnWorker(workerOptions(posted, "none"));
    await worker.waitForEvent((event) => event.type === "completed");
    await waitForJobState(posted.jobId, "completed");
    await worker.stop();

    const recorded = await outcomeRows(posted.outboxEntryId);
    expect(recorded).toHaveLength(1);
    const firstDelivery = await jobRow(posted.jobId);

    // A lease that expires after the work already succeeded puts the very same
    // job back on the queue. That shape is forced here so the production worker
    // — not a fork — is the one that receives the duplicate.
    await redeliverJob(posted.jobId);
    await startApi();
    await waitForJobState(posted.jobId, "completed");

    expect(await outcomeRows(posted.outboxEntryId)).toEqual(recorded);
    expect(await commandFacts(posted.key)).toEqual(facts);

    // The second delivery really happened — same row, later completion, one
    // more attempt on the counter — and it left nothing behind.
    const secondDelivery = await jobRow(posted.jobId);
    expect(secondDelivery.completedOn).not.toBe(firstDelivery.completedOn);
    expect(secondDelivery.retryCount).toBeGreaterThan(firstDelivery.retryCount);
  }, 180_000);

  it("gives the settings command no business document number, through every crash and recovery above", async () => {
    // Human numbers belong to Posted Documents. The tracer command is the one
    // posting command in this milestone, and after every settings change, kill,
    // and recovery above, the allocator must never have been reached: no
    // sequence, no allocation, and no allocation audit fact.
    const sequences = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_number_sequences
       where pharmacy_id = $1`,
      [pharmacyId],
    );
    const allocations = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_number_allocations
       where pharmacy_id = $1`,
      [pharmacyId],
    );
    const allocationAudits = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where pharmacy_id = $1 and action = 'posting.number.allocate'`,
      [pharmacyId],
    );
    expect(sequences.rows[0]?.count).toBe("0");
    expect(allocations.rows[0]?.count).toBe("0");
    expect(allocationAudits.rows[0]?.count).toBe("0");
  }, 60_000);

  function workerOptions(
    posted: PostedCommand,
    crashPoint: SettingsCrashPoint,
  ): SettingsCrashWorkerOptions {
    return {
      crashPoint,
      databaseUrl: databaseRoles.applicationUrl,
      outcome: SETTINGS_POST_COMMIT_OUTCOME,
      queueName: SETTINGS_POST_COMMIT_QUEUE,
      targetOutboxEntryId: posted.outboxEntryId,
      workerId: `settings-crash-${crashPoint}`,
    };
  }

  /**
   * Lets the abandoned lease expire, supervises the queue, and brings the real
   * post-commit service back to finish the job.
   */
  async function recoverAbandonedJob(jobId: string): Promise<void> {
    await delay(LEASE_EXPIRY_WAIT_MS);
    await durableJobs.supervise(SETTINGS_POST_COMMIT_QUEUE);

    const returned = await jobRow(jobId);
    expect(["created", "retry"]).toContain(returned.state);

    await waitUntilClaimable(jobId);
    await startApi();
  }

  /**
   * The abandoned job was handed to a second worker rather than quietly written
   * off: the same row completed, and its retry count records the delivery the
   * killed process never finished.
   */
  async function expectRedelivered(jobId: string): Promise<void> {
    await waitForJobState(jobId, "completed");
    expect((await jobRow(jobId)).retryCount).toBeGreaterThan(0);
  }

  function expectOnePostedCommand(facts: CommandFacts): void {
    expect(facts.audits).toHaveLength(1);
    expect(facts.audits[0]?.outcome).toBe("succeeded");
    expect(facts.outbox).toHaveLength(1);
    expect(facts.results).toHaveLength(1);
    expect(facts.results[0]?.responseStatus).toBe(200);
  }

  async function postSettingsChange(): Promise<PostedCommand> {
    await startApi();
    const before = await currentSettings();
    const key = createUuidV7();
    const posted = await request("PATCH", "/pharmacy/settings", {
      attendanceEnabled: !before.attendanceEnabled,
      expectedRevision: before.revision,
      idempotencyKey: key,
    });
    expect(posted.status, failureContext(posted)).toBe(200);
    // The command really posted: the response is the next revision, which is
    // the value every later comparison in the scenario is anchored to.
    expect(posted.body).toEqual({
      attendanceEnabled: !before.attendanceEnabled,
      revision: (BigInt(before.revision) + 1n).toString(),
    });

    const outbox = await administrator.query<{ id: string }>(
      "select id from posting_outbox_entries where correlation_id = $1",
      [key],
    );
    const outboxEntryId = outbox.rows[0]?.id ?? "";
    expect(outboxEntryId).toMatch(UUID_PATTERN);

    const jobs = await administrator.query<{ id: string }>(
      `select id from pgboss.job
       where name = $1 and data->>'outboxEntryId' = $2`,
      [SETTINGS_POST_COMMIT_QUEUE, outboxEntryId],
    );
    expect(jobs.rows).toHaveLength(1);
    const jobId = jobs.rows[0]?.id ?? "";
    expect(jobId.length).toBeGreaterThan(0);

    return { jobId, key, outboxEntryId };
  }

  async function currentSettings(): Promise<SettingsView> {
    const settings = await administrator.query<{
      attendance_enabled: boolean;
      revision: string;
    }>(
      `select attendance_enabled, revision::text
       from pharmacy_settings where pharmacy_id = $1`,
      [pharmacyId],
    );
    const row = settings.rows[0];
    if (row === undefined) {
      throw new Error("The pharmacy settings row is missing");
    }
    return {
      attendanceEnabled: row.attendance_enabled,
      revision: row.revision,
    };
  }

  async function commandFacts(key: string): Promise<CommandFacts> {
    const settings = await administrator.query<{
      attendance_enabled: boolean;
      revision: string;
      updated_at: Date;
    }>(
      `select attendance_enabled, revision::text, updated_at
       from pharmacy_settings where pharmacy_id = $1`,
      [pharmacyId],
    );
    const row = settings.rows[0];
    if (row === undefined) {
      throw new Error("The pharmacy settings row is missing");
    }

    const audits = await administrator.query<{
      id: string;
      occurred_at: Date;
      outcome: string;
    }>(
      `select id, occurred_at, outcome from posting_audit_records
       where correlation_id = $1 order by occurred_at, id`,
      [key],
    );
    const outbox = await administrator.query<{
      id: string;
      occurred_at: Date;
      recorded_at: Date;
    }>(
      `select id, occurred_at, recorded_at from posting_outbox_entries
       where correlation_id = $1 order by id`,
      [key],
    );
    const results = await administrator.query<{
      recorded_at: Date;
      response_status: number;
    }>(
      `select recorded_at, response_status from posting_command_results
       where idempotency_key = $1`,
      [key],
    );

    return {
      attendanceEnabled: row.attendance_enabled,
      audits: audits.rows.map((audit) => ({
        id: audit.id,
        occurredAt: audit.occurred_at.toISOString(),
        outcome: audit.outcome,
      })),
      outbox: outbox.rows.map((entry) => ({
        id: entry.id,
        occurredAt: entry.occurred_at.toISOString(),
        recordedAt: entry.recorded_at.toISOString(),
      })),
      results: results.rows.map((result) => ({
        recordedAt: result.recorded_at.toISOString(),
        responseStatus: result.response_status,
      })),
      revision: row.revision,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async function outcomeRows(outboxEntryId: string): Promise<OutcomeRow[]> {
    const outcomes = await administrator.query<{
      outcome: string;
      recorded_at: Date;
    }>(
      `select outcome, recorded_at from posting_post_commit_outcomes
       where outbox_entry_id = $1 order by recorded_at`,
      [outboxEntryId],
    );
    return outcomes.rows.map((outcome) => ({
      outcome: outcome.outcome,
      recordedAt: outcome.recorded_at.toISOString(),
    }));
  }

  async function waitForOutcomes(outboxEntryId: string): Promise<OutcomeRow[]> {
    const deadline = Date.now() + 90_000;
    let outcomes = await outcomeRows(outboxEntryId);
    while (outcomes.length === 0 && Date.now() < deadline) {
      await delay(200);
      outcomes = await outcomeRows(outboxEntryId);
    }
    expect(
      outcomes.length,
      `no post-commit outcome for ${outboxEntryId}\n${apiOutput}`,
    ).toBeGreaterThan(0);
    return outcomes;
  }

  async function jobRow(jobId: string): Promise<JobRow> {
    const jobs = await administrator.query<{
      completed_on: Date | null;
      ready: boolean;
      retry_count: number;
      started_on: Date | null;
      state: string;
    }>(
      `select completed_on, start_after <= now() as ready, retry_count,
              started_on, state::text as state
       from pgboss.job where id = $1 and name = $2`,
      [jobId, SETTINGS_POST_COMMIT_QUEUE],
    );
    const row = jobs.rows[0];
    if (row === undefined) {
      throw new Error(`The post-commit job ${jobId} is gone`);
    }
    return {
      completedOn: row.completed_on?.toISOString() ?? null,
      ready: row.ready,
      retryCount: row.retry_count,
      startedOn: row.started_on?.toISOString() ?? null,
      state: row.state,
    };
  }

  async function waitForJobState(jobId: string, state: string): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if ((await jobRow(jobId)).state === state) {
        return;
      }
      await delay(200);
    }
    throw new Error(
      `The post-commit job ${jobId} never reached ${state}\n${apiOutput}`,
    );
  }

  async function waitUntilClaimable(jobId: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const job = await jobRow(jobId);
      if (job.ready && ["created", "retry"].includes(job.state)) {
        return;
      }
      await delay(100);
    }
    throw new Error(`The post-commit job ${jobId} never became claimable`);
  }

  /**
   * Attaches the rule that decides when a settings post-commit job may be
   * claimed. It runs inside the posting transaction itself, so a job is already
   * held the moment it commits and no worker can win a race the test has not
   * started yet.
   */
  async function holdSettingsJobs(): Promise<void> {
    // The queue name reaches the rule body as text, so its shape is checked
    // before it is written into a function definition.
    expect(SETTINGS_POST_COMMIT_QUEUE).toMatch(/^[a-z][a-z0-9.-]*$/u);
    await administrator.query(
      `create function ${HOLD_RULE}() returns trigger language plpgsql as $hold$
       begin
         if new.name = '${SETTINGS_POST_COMMIT_QUEUE}'
            and new.started_on is null then
           new.start_after := now() + interval '1 hour';
           new.expire_seconds := ${String(LEASE_SECONDS)};
         end if;
         return new;
       end;
       $hold$`,
    );
    await administrator.query(
      `create trigger ${HOLD_RULE} before insert on pgboss.${jobTable}
       for each row execute function ${HOLD_RULE}()`,
    );
  }

  async function releaseSettingsJobs(): Promise<void> {
    await administrator.query(
      `drop trigger if exists ${HOLD_RULE} on pgboss.${jobTable}`,
    );
    await administrator.query(`drop function if exists ${HOLD_RULE}()`);
  }

  /** Lets one held job be claimed, once the process that must not claim it is gone. */
  async function releaseJob(jobId: string): Promise<void> {
    expect(api, "the API must be stopped before a job is released").toBe(
      undefined,
    );
    const released = await administrator.query(
      `update pgboss.${jobTable} set start_after = now()
       where id = $1 and name = $2`,
      [jobId, SETTINGS_POST_COMMIT_QUEUE],
    );
    expect(released.rowCount).toBe(1);
    await waitUntilClaimable(jobId);
  }

  /**
   * Returns a job that already completed to the state a lease expiry leaves
   * behind when the worker died after its effect committed: same row, same
   * identity, waiting to be delivered again.
   */
  async function redeliverJob(jobId: string): Promise<void> {
    expect(api, "the API must be stopped before a job is redelivered").toBe(
      undefined,
    );
    const redelivered = await administrator.query(
      `update pgboss.${jobTable}
       set state = 'retry', start_after = now(), completed_on = null,
           output = null
       where id = $1 and name = $2`,
      [jobId, SETTINGS_POST_COMMIT_QUEUE],
    );
    expect(redelivered.rowCount).toBe(1);
    await waitUntilClaimable(jobId);
  }

  async function resolveJobTable(): Promise<string> {
    const queue = await administrator.query<{ table_name: string }>(
      "select table_name from pgboss.queue where name = $1",
      [SETTINGS_POST_COMMIT_QUEUE],
    );
    const table = queue.rows[0]?.table_name ?? "";
    if (!/^[a-z_][a-z0-9_]*$/u.test(table)) {
      throw new Error(
        `pg-boss did not report a usable job table for ${SETTINGS_POST_COMMIT_QUEUE}`,
      );
    }
    return table;
  }

  function apiEnvironment(): Record<string, string> {
    return {
      API_HOST: "127.0.0.1",
      API_PORT: String(apiPort),
      BREEV_MAIN_DEVICE_ID: credentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
      DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
      DATABASE_URL: databaseRoles.applicationUrl,
    };
  }

  async function startApi(): Promise<void> {
    if (api !== undefined) {
      return;
    }
    apiOutput = "";
    const child = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../dist/main.js")],
      { env: { ...process.env, ...apiEnvironment() } },
    );
    child.stdout.on("data", collectOutput);
    child.stderr.on("data", collectOutput);
    api = child;
    await waitForHealth();

    if (!bootstrapped) {
      const bootstrap = await request("POST", "/identity/bootstrap", {
        owner: {
          displayName: "Settings Crash Owner",
          password: OWNER_PASSWORD,
          username: OWNER_USERNAME,
        },
        pharmacyName: "Breev Settings Crash Pharmacy",
      });
      expect(bootstrap.status, failureContext(bootstrap)).toBe(201);
      bootstrapped = true;
    }

    const loggedIn = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(loggedIn.status, failureContext(loggedIn)).toBe(200);
  }

  async function killApi(): Promise<ProcessExit> {
    const child = api;
    if (child === undefined) {
      throw new Error("The local API is not running");
    }
    const exit = new Promise<ProcessExit>((resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });
    child.kill("SIGKILL");
    api = undefined;
    return await exit;
  }

  async function stopApi(): Promise<void> {
    const child = api;
    if (child === undefined) {
      return;
    }
    api = undefined;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000).unref();
    });
  }

  function collectOutput(chunk: Buffer): void {
    apiOutput += chunk.toString();
  }

  async function waitForHealth(): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${apiOrigin}/health`)).status === 200) {
          return;
        }
      } catch {
        // The API is still starting.
      }
      await delay(100);
    }
    throw new Error(`Local API did not start at ${apiOrigin}\n${apiOutput}`);
  }

  function failureContext(response: ApiResponse): string {
    return `${apiOutput}\n${JSON.stringify(response)}`;
  }

  async function request(
    method: "GET" | "PATCH" | "POST",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: requestHeaders(credentials, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body:
        text.length === 0
          ? undefined
          : (JSON.parse(text) as Record<string, unknown>),
      status: response.status,
    };
  }
});

function requestHeaders(
  credentials: MainDeviceCredentials,
  json: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Breev-Device ${credentials.deviceSecret}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
    Origin: "breev://app",
  };
}

function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: createUuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
