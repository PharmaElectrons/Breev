import { Pool } from "pg";
import { PgBoss, type Job } from "pg-boss";

export type CrashPoint =
  | "none"
  | "after-claim"
  | "after-external-success"
  | "before-outcome-recording";

interface JobPayload {
  readonly idempotencyKey: string;
  readonly [key: string]: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    process.stderr.write(`${name} is required for crash worker child\n`);
    throw new Error(`${name} is required for crash worker child`);
  }
  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");
const targetQueue = requireEnv("TARGET_QUEUE");

const crashPoint = (process.env.CRASH_POINT ?? "none") as CrashPoint;
const targetIdempotencyKey = process.env.TARGET_IDEMPOTENCY_KEY;
const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 2_000,
  idleTimeoutMillis: 2_000,
  max: 5,
});
pool.on("error", () => undefined);

const boss = new PgBoss({
  connectionString: databaseUrl,
  createSchema: false,
  migrate: false,
  monitorIntervalSeconds: 1,
  persistQueueStats: false,
  persistWarnings: false,
  schedule: false,
  schema: "pgboss",
  supervise: true,
  superviseIntervalSeconds: 1,
});
boss.on("error", () => undefined);

process.on("message", async (msg: unknown) => {
  if (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { action?: string }).action === "shutdown"
  ) {
    try {
      await boss.stop({ graceful: true, timeout: 5_000 });
    } catch {}
    try {
      await pool.end();
    } catch {}
    process.exit(0);
  }
});

async function run(): Promise<void> {
  await boss.start();

  if (process.send) {
    process.send({
      type: "ready",
      workerId,
      pid: process.pid,
      queue: targetQueue,
      crashPoint,
    });
  }

  await boss.work<JobPayload>(
    targetQueue,
    { pollingIntervalSeconds: 1 },
    async (jobs: Array<Job<JobPayload>>) => {
      for (const job of jobs) {
        const payload = job.data;
        const isTarget =
          !targetIdempotencyKey ||
          payload?.idempotencyKey === targetIdempotencyKey;

        if (process.send) {
          process.send({
            type: "claimed",
            jobId: job.id,
            idempotencyKey: payload?.idempotencyKey,
            workerId,
          });
        }

        // CRASH POINT 2: After Claim (before external effect)
        if (isTarget && crashPoint === "after-claim") {
          if (process.send) {
            process.send({
              type: "crashing",
              point: "after-claim",
              jobId: job.id,
              idempotencyKey: payload?.idempotencyKey,
              workerId,
            });
          }
          // Immediate hard kill with SIGKILL to simulate abrupt crash
          process.kill(process.pid, "SIGKILL");
          return;
        }

        // Check external side effect ledger
        const existingEffect = await pool.query<{ id: number }>(
          "SELECT id FROM _test_external_effects WHERE idempotency_key = $1",
          [payload.idempotencyKey],
        );

        if (existingEffect.rows.length === 0) {
          await pool.query(
            "INSERT INTO _test_external_effects (idempotency_key, effect_payload) VALUES ($1, $2)",
            [payload.idempotencyKey, JSON.stringify(payload)],
          );
          if (process.send) {
            process.send({
              type: "external_effect_executed",
              jobId: job.id,
              idempotencyKey: payload.idempotencyKey,
              workerId,
            });
          }
        } else {
          if (process.send) {
            process.send({
              type: "external_effect_reconciled",
              jobId: job.id,
              idempotencyKey: payload.idempotencyKey,
              workerId,
            });
          }
        }

        // CRASH POINT 3: After External Success (before outcome recording)
        if (isTarget && crashPoint === "after-external-success") {
          if (process.send) {
            process.send({
              type: "crashing",
              point: "after-external-success",
              jobId: job.id,
              idempotencyKey: payload?.idempotencyKey,
              workerId,
            });
          }
          // Hard kill with SIGKILL
          process.kill(process.pid, "SIGKILL");
          return;
        }

        // CRASH POINT 4: Before Outcome Recording
        if (isTarget && crashPoint === "before-outcome-recording") {
          if (process.send) {
            process.send({
              type: "crashing",
              point: "before-outcome-recording",
              jobId: job.id,
              idempotencyKey: payload?.idempotencyKey,
              workerId,
            });
          }
          // Hard kill with SIGKILL
          process.kill(process.pid, "SIGKILL");
          return;
        }

        // Separate Outcome Transaction
        const outcomeClient = await pool.connect();
        try {
          await outcomeClient.query("BEGIN");
          await outcomeClient.query(
            `INSERT INTO _test_job_outcomes (job_id, idempotency_key, queue_name, result)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (idempotency_key) DO UPDATE SET result = EXCLUDED.result`,
            [
              job.id,
              payload.idempotencyKey,
              job.name,
              "PROCESSED_SUCCESSFULLY",
            ],
          );
          await outcomeClient.query("COMMIT");
        } catch (error) {
          await outcomeClient.query("ROLLBACK");
          throw error;
        } finally {
          outcomeClient.release();
        }

        if (process.send) {
          process.send({
            type: "completed",
            jobId: job.id,
            idempotencyKey: payload?.idempotencyKey,
            workerId,
          });
        }
      }
    },
  );
}

run().catch((error) => {
  process.stderr.write(
    `Crash worker child encountered fatal error: ${String(error)}\n`,
  );
  process.exit(1);
});
