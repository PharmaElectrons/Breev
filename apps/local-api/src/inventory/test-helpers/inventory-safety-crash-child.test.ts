import { Pool } from "pg";
import { PgBoss, type Job } from "pg-boss";

export type InventorySafetyCrashPoint =
  "after-claim" | "after-date" | "after-final" | "none";

export interface InventorySafetyJobPayload {
  readonly pharmacyId: string;
  readonly throughBusinessDate: string;
  readonly trigger: "catch-up" | "manual" | "scheduled" | "startup";
}

export interface InventorySafetyCrashWorkerEvent {
  readonly businessDate: string | null;
  readonly index: number | null;
  readonly point: InventorySafetyCrashPoint | null;
  readonly type: "claimed" | "committed" | "completed" | "crashing" | "ready";
  readonly workerId: string;
}

const QUEUE_NAME = "inventory.batch-safety.evaluate";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required by the inventory safety crash worker`);
  }
  return value;
}

function report(event: InventorySafetyCrashWorkerEvent): Promise<void> {
  const send = process.send?.bind(process);
  if (send === undefined) return Promise.resolve();
  return new Promise((resolve) => send(event, () => resolve()));
}

function crash(): never {
  process.kill(process.pid, "SIGKILL");
  throw new Error("unreachable");
}

async function run(): Promise<void> {
  const databaseUrl = required("BREEV_SAFETY_DATABASE_URL");
  const workerId = required("BREEV_SAFETY_WORKER_ID");
  const point = (process.env.BREEV_SAFETY_CRASH_POINT ??
    "none") as InventorySafetyCrashPoint;
  const afterIndex = Number(process.env.BREEV_SAFETY_AFTER_INDEX ?? "0");
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 2_000,
    max: 4,
  });
  pool.on("error", () => undefined);

  // Supervision is off: this process claims and dies, and nothing else. The
  // recovery that follows is performed by the real DurableJobsService in the
  // test, so a maintenance pass from here would blur which process did what.
  // The Nest services are not imported because Node's type stripping cannot
  // load the decorated classes; pg-boss itself is the runtime under test.
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
      void boss
        .stop({ graceful: true, timeout: 5_000 })
        .catch(() => undefined)
        .then(() => pool.end());
    }
  });

  await boss.start();

  await report({
    businessDate: null,
    index: null,
    point,
    type: "ready",
    workerId,
  });
  // The evaluator's own imports use `.js` specifiers that Node's type
  // stripping cannot resolve against TypeScript sources, so the child loads
  // the compiled module. `test:integration` depends on `build` (turbo.json),
  // exactly as the suites that boot `dist/main.js` already rely on.
  const evaluator = (await import(
    new URL(
      "../../../dist/inventory/inventory-safety-evaluator.js",
      import.meta.url,
    ).href
  )) as typeof import("../inventory-safety-evaluator.js");
  await boss.work<InventorySafetyJobPayload>(
    QUEUE_NAME,
    { pollingIntervalSeconds: 1 },
    async (jobs: Array<Job<InventorySafetyJobPayload>>) => {
      for (const job of jobs) await handle(job);
    },
  );

  async function handle(job: Job<InventorySafetyJobPayload>): Promise<void> {
    await report({
      businessDate: null,
      index: null,
      point: null,
      type: "claimed",
      workerId,
    });
    if (point === "after-claim") {
      await report({
        businessDate: null,
        index: null,
        point,
        type: "crashing",
        workerId,
      });
      crash();
    }
    await evaluator.catchUp(pool, {
      jobId: job.id,
      ...job.data,
      onDateCommitted: async (businessDate, index, total) => {
        await report({
          businessDate,
          index,
          point: null,
          type: "committed",
          workerId,
        });
        if (
          (point === "after-date" && index === afterIndex) ||
          (point === "after-final" && index === total)
        ) {
          await report({
            businessDate,
            index,
            point,
            type: "crashing",
            workerId,
          });
          crash();
        }
      },
    });
    await report({
      businessDate: null,
      index: null,
      point: null,
      type: "completed",
      workerId,
    });
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
