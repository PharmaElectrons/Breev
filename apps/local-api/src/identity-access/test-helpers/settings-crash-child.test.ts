import { Pool, type PoolClient } from "pg";
import { PgBoss, type Job } from "pg-boss";

import type * as PostingOutbox from "../../posting/outbox.js";

/**
 * The post-commit worker that dies on purpose.
 *
 * This file is forked as a real operating-system process by
 * `settings-crash.integration.test.ts` and killed with `SIGKILL` at one of the
 * four points `docs/quality.md` requires an outbox job to survive. A separate
 * process is the only honest way to prove it: an in-process failure still runs
 * `finally` blocks, flushes buffers, and lets the job runtime tidy up, so it
 * proves nothing about a machine that loses power halfway through a claim.
 *
 * The worker is deliberately incapable of re-executing the settings command. It
 * knows one envelope identifier, reads that envelope, checks it belongs to the
 * pharmacy its payload names, and writes one post-commit outcome row through
 * the production writer. There is no path from here into `pharmacy_settings`.
 *
 * The file name ends in `.test.ts` but in neither `.unit.test.ts` nor
 * `.integration.test.ts`: the first keeps it out of `dist` (the build config
 * excludes `src/**\/*.test.ts`), the second keeps Vitest from collecting a
 * worker process as if it were a suite.
 */

/** Where the fork kills itself, named after `docs/quality.md`'s four points. */
export type SettingsCrashPoint =
  | "after-claim"
  | "after-external-success"
  | "before-outcome-recording"
  | "none";

export type SettingsCrashEventType =
  "claimed" | "completed" | "crashing" | "ready";

/**
 * What the fork tells its parent. Every field is present and nullable rather
 * than optional, so an event survives the trip through the IPC channel as the
 * same shape it left as.
 */
export interface SettingsCrashWorkerEvent {
  readonly jobId: string | null;
  readonly outboxEntryId: string | null;
  /** The pharmacy the envelope was verified against before the kill. */
  readonly pharmacyId: string | null;
  readonly point: SettingsCrashPoint | null;
  readonly type: SettingsCrashEventType;
  readonly workerId: string;
}

interface SettingsPostCommitJobPayload {
  readonly outboxEntryId: string;
  readonly pharmacyId: string;
}

const CRASH_POINTS: readonly SettingsCrashPoint[] = [
  "after-claim",
  "after-external-success",
  "before-outcome-recording",
  "none",
];

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required by the settings crash worker`);
  }
  return value;
}

function readCrashPoint(value: string | undefined): SettingsCrashPoint {
  const point = CRASH_POINTS.find((candidate) => candidate === value);
  if (point === undefined) {
    throw new Error(`${String(value)} is not a settings crash point`);
  }
  return point;
}

/**
 * Hands one event to the parent and waits until the channel has taken it. The
 * wait is what makes the kill provable: the parent is holding the "crashing"
 * event that names the point before the signal lands, so a scenario title can
 * be checked against where the process actually died instead of against a
 * timer.
 */
async function report(event: SettingsCrashWorkerEvent): Promise<void> {
  const send = process.send?.bind(process);
  if (send === undefined) {
    return;
  }
  await new Promise<void>((resolve) => {
    send(event, () => {
      resolve();
    });
  });
}

/**
 * Loses the process the way a power cut does. `SIGKILL` cannot be caught, so no
 * handler, no `finally`, and no job-runtime shutdown runs after this line.
 */
function crash(): void {
  process.kill(process.pid, "SIGKILL");
}

/**
 * The read the production acknowledgement performs before it records anything:
 * the envelope has to exist and has to belong to the pharmacy the job payload
 * names. Reproducing it here is what lets the fork die between the check and
 * the write.
 */
async function verifyEnvelope(
  client: PoolClient,
  payload: SettingsPostCommitJobPayload,
): Promise<string> {
  const entry = await client.query<{ pharmacy_id: string }>(
    "select pharmacy_id from posting_outbox_entries where id = $1",
    [payload.outboxEntryId],
  );
  const row = entry.rows[0];
  if (row === undefined) {
    throw new Error(
      `The posting outbox entry ${payload.outboxEntryId} does not exist`,
    );
  }
  if (row.pharmacy_id !== payload.pharmacyId) {
    throw new Error(
      `The posting outbox entry ${payload.outboxEntryId} belongs to another pharmacy`,
    );
  }
  return row.pharmacy_id;
}

async function run(): Promise<void> {
  const databaseUrl = requireEnvironment("BREEV_CRASH_DATABASE_URL");
  const queueName = requireEnvironment("BREEV_CRASH_QUEUE");
  const outcome = requireEnvironment("BREEV_CRASH_OUTCOME");
  const targetOutboxEntryId = requireEnvironment("BREEV_CRASH_TARGET_ENTRY");
  const workerId = requireEnvironment("BREEV_CRASH_WORKER_ID");
  const crashPoint = readCrashPoint(process.env.BREEV_CRASH_POINT);

  // The one piece of production code this fork must not reimplement is the
  // writer whose `on conflict do nothing` is the convergence the battery
  // proves. Node's type stripping refuses the decorated Nest service that calls
  // it, so the framework-free module is loaded through its TypeScript path
  // instead of being imported by specifier.
  const outbox = (await import(
    new URL("../../posting/outbox.ts", import.meta.url).href
  )) as typeof PostingOutbox;

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 2_000,
    max: 4,
  });
  pool.on("error", () => undefined);

  // Supervision is off: this process claims and dies, and nothing else. The
  // recovery that follows is performed by the real service, so a maintenance
  // pass from here would blur which process did what.
  const boss = new PgBoss({
    connectionString: databaseUrl,
    createSchema: false,
    migrate: false,
    persistQueueStats: false,
    persistWarnings: false,
    schedule: false,
    schema: "pgboss",
    supervise: false,
  });
  boss.on("error", () => undefined);

  process.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { action?: unknown }).action === "shutdown"
    ) {
      void shutdown(boss, pool);
    }
  });

  await boss.start();
  await report({
    jobId: null,
    outboxEntryId: null,
    pharmacyId: null,
    point: crashPoint,
    type: "ready",
    workerId,
  });

  await boss.work<SettingsPostCommitJobPayload>(
    queueName,
    { pollingIntervalSeconds: 1 },
    async (jobs: Array<Job<SettingsPostCommitJobPayload>>) => {
      for (const job of jobs) {
        const payload = job.data;
        const target = payload.outboxEntryId === targetOutboxEntryId;
        await report({
          jobId: job.id,
          outboxEntryId: payload.outboxEntryId,
          pharmacyId: null,
          point: null,
          type: "claimed",
          workerId,
        });

        // Crash point 2: the claim is durable, nothing else has happened.
        if (target && crashPoint === "after-claim") {
          await report({
            jobId: job.id,
            outboxEntryId: payload.outboxEntryId,
            pharmacyId: null,
            point: "after-claim",
            type: "crashing",
            workerId,
          });
          crash();
          return;
        }

        const client = await pool.connect();
        try {
          const pharmacyId = await verifyEnvelope(client, payload);

          // Crash point 4: the envelope has been read and checked, and the one
          // durable effect is the very next statement.
          if (target && crashPoint === "before-outcome-recording") {
            await report({
              jobId: job.id,
              outboxEntryId: payload.outboxEntryId,
              pharmacyId,
              point: "before-outcome-recording",
              type: "crashing",
              workerId,
            });
            crash();
            return;
          }

          await outbox.recordPostCommitOutcome(client, {
            outboxEntryId: payload.outboxEntryId,
            outcome,
          });

          // Crash point 3: the effect committed and the handler never returns,
          // so the job runtime never learns the work succeeded.
          if (target && crashPoint === "after-external-success") {
            await report({
              jobId: job.id,
              outboxEntryId: payload.outboxEntryId,
              pharmacyId,
              point: "after-external-success",
              type: "crashing",
              workerId,
            });
            crash();
            return;
          }
        } finally {
          client.release();
        }

        await report({
          jobId: job.id,
          outboxEntryId: payload.outboxEntryId,
          pharmacyId: payload.pharmacyId,
          point: null,
          type: "completed",
          workerId,
        });
      }
    },
  );
}

async function shutdown(boss: PgBoss, pool: Pool): Promise<void> {
  try {
    await boss.stop({ graceful: true, timeout: 5_000 });
  } catch {
    // A worker that will not stop cleanly is still leaving.
  }
  try {
    await pool.end();
  } catch {
    // Same: the process is about to exit either way.
  }
  process.exit(0);
}

run().catch((error: unknown) => {
  process.stderr.write(`settings crash worker failed: ${String(error)}\n`);
  process.exit(1);
});
