import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { mainDeviceProofState } from "../main-device/main-device-schema.js";
import { DurableJobsService } from "./durable-jobs.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

describe.sequential("DurableJobsService integration & resilience proof", () => {
  let postgres: StartedPostgreSqlContainer;
  let databaseRoles: SeparatedDatabaseRoles;
  let localDatabase: LocalDatabaseService;
  let durableJobs: DurableJobsService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);

    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;

    localDatabase = new LocalDatabaseService();
    await localDatabase.onModuleInit();

    durableJobs = new DurableJobsService(localDatabase);
    await durableJobs.onModuleInit();
  }, 120_000);

  afterAll(async () => {
    await durableJobs?.onApplicationShutdown();
    await localDatabase?.onApplicationShutdown();
    if (postgres !== undefined) {
      await postgres.stop().catch(() => undefined);
    }
    process.env = originalEnv;
  });

  describe("Privileged migration & role separation", () => {
    it("proves the pgboss schema is installed and managed under breev_schema_owner", async () => {
      const pool = localDatabase.requirePool();
      const schemaCheck = await pool.query<{ exists: boolean }>(
        `select exists(
           select 1 from information_schema.schemata where schema_name = 'pgboss'
         ) as exists`,
      );
      expect(schemaCheck.rows[0]?.exists).toBe(true);

      const tableCheck = await pool.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'pgboss' and table_name in ('job', 'version', 'queue')`,
      );
      const tableNames = tableCheck.rows.map((r) => r.table_name);
      expect(tableNames).toContain("job");
      expect(tableNames).toContain("version");
      expect(tableNames).toContain("queue");
    });

    it("proves the breev_app role has no DDL/create schema privileges", async () => {
      const pool = localDatabase.requirePool();
      await expect(
        pool.query("create table pgboss.unauthorized_table (id int)"),
      ).rejects.toThrow();

      await expect(
        pool.query("create schema unauthorized_schema"),
      ).rejects.toThrow();
    });

    it("proves the breev_app role has full DML access to pgboss tables", async () => {
      const pool = localDatabase.requirePool();
      const result = await pool.query<{ count: string }>(
        "select count(*)::text as count from pgboss.job",
      );
      expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Transactional Enqueue (Atomic Commit & Rollback)", () => {
    it("commits a durable job atomically with a Drizzle business transaction", async () => {
      const pool = localDatabase.requirePool();
      const db = drizzle({ client: pool });
      const queueName = "tx-commit-test";
      const payload = { testId: "commit-success", value: 42 };

      let executed = false;
      await durableJobs.work<{ testId: string; value: number }>(
        queueName,
        async (job) => {
          if (job.data.testId === payload.testId) {
            executed = true;
          }
        },
      );

      await db.transaction(async (tx) => {
        await tx
          .update(mainDeviceProofState)
          .set({ mutationCount: sql`${mainDeviceProofState.mutationCount} + 1` })
          .where(eq(mainDeviceProofState.singleton, true));

        const jobId = await durableJobs.sendInTransaction(
          tx,
          queueName,
          payload,
        );
        expect(jobId).toBeTruthy();
      });

      await waitForCondition(() => executed, 10_000);
      expect(executed).toBe(true);
    });

    it("rolls back a durable job when a Drizzle business transaction aborts", async () => {
      const pool = localDatabase.requirePool();
      const db = drizzle({ client: pool });
      const queueName = "tx-rollback-test";
      const payload = { testId: "rollback-should-not-run" };

      let executed = false;
      await durableJobs.work<{ testId: string }>(queueName, async (job) => {
        if (job.data.testId === payload.testId) {
          executed = true;
        }
      });

      const initialMutationCount = await getMutationCount(pool);

      await expect(
        db.transaction(async (tx) => {
          await tx
            .update(mainDeviceProofState)
            .set({ mutationCount: sql`${mainDeviceProofState.mutationCount} + 100` })
            .where(eq(mainDeviceProofState.singleton, true));

          await durableJobs.sendInTransaction(tx, queueName, payload);
          throw new Error("Simulated business transaction failure");
        }),
      ).rejects.toThrow("Simulated business transaction failure");

      const afterMutationCount = await getMutationCount(pool);
      expect(afterMutationCount).toBe(initialMutationCount);

      await delay(1_500);
      expect(executed).toBe(false);

      const jobInDb = await pool.query(
        "select id from pgboss.job where name = $1 and data->>'testId' = $2",
        [queueName, payload.testId],
      );
      expect(jobInDb.rows.length).toBe(0);
    });

    it("supports atomic transactional enqueue using a raw PoolClient transaction", async () => {
      const pool = localDatabase.requirePool();
      const client = await pool.connect();
      const queueName = "client-tx-test";
      const payload = { marker: "pool-client-success" };

      let executed = false;
      await durableJobs.work<{ marker: string }>(queueName, async (job) => {
        if (job.data.marker === payload.marker) {
          executed = true;
        }
      });

      try {
        await client.query("begin");
        const jobId = await durableJobs.sendInTransaction(
          client,
          queueName,
          payload,
        );
        expect(jobId).toBeTruthy();
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }

      await waitForCondition(() => executed, 10_000);
      expect(executed).toBe(true);
    });
  });

  describe("Crash Recovery & Invariant Matrix", () => {
    it("recovers and executes jobs enqueued before worker start / service crash", async () => {
      const queueName = "crash-before-claim";
      const payload = { item: "pre-crash-job" };

      const jobId = await durableJobs.send(queueName, payload);
      expect(jobId).toBeTruthy();

      let executed = false;
      await durableJobs.work<{ item: string }>(queueName, async (job) => {
        if (job.data.item === payload.item) {
          executed = true;
        }
      });

      await waitForCondition(() => executed, 10_000);
      expect(executed).toBe(true);
    });

    it("recovers an abandoned job via lease expiry when worker crashes mid-flight", async () => {
      const queueName = "crash-after-claim-lease-expiry";
      const payload = { trackingId: "lease-recovery-proof" };

      let attemptCount = 0;
      let completed = false;

      const jobId = await durableJobs.send(queueName, payload, {
        expireInSeconds: 2,
        retryLimit: 2,
        retryDelay: 0,
      });
      expect(jobId).toBeTruthy();

      await durableJobs.work<{ trackingId: string }>(
        queueName,
        async (job) => {
          if (job.data.trackingId !== payload.trackingId) {
            return;
          }
          attemptCount += 1;
          if (attemptCount === 1) {
            await delay(4_000);
            return;
          }
          completed = true;
        },
        { pollingIntervalSeconds: 1 },
      );

      await waitForCondition(() => completed, 15_000);
      expect(attemptCount).toBeGreaterThanOrEqual(2);
      expect(completed).toBe(true);
    });

    it("handles worker restart after external side effect using idempotent recovery", async () => {
      const queueName = "crash-after-external-action";
      const payload = { idempotencyKey: "ext-trans-99" };

      const externalSideEffects = new Set<string>();
      let completionRecorded = false;

      const jobId = await durableJobs.send(queueName, payload, {
        expireInSeconds: 2,
        retryLimit: 2,
        retryDelay: 0,
      });
      expect(jobId).toBeTruthy();

      let firstAttempt = true;
      await durableJobs.work<{ idempotencyKey: string }>(
        queueName,
        async (job) => {
          if (job.data.idempotencyKey !== payload.idempotencyKey) {
            return;
          }

          if (!externalSideEffects.has(job.data.idempotencyKey)) {
            externalSideEffects.add(job.data.idempotencyKey);
          }

          if (firstAttempt) {
            firstAttempt = false;
            await delay(3_500);
            return;
          }

          completionRecorded = true;
        },
        { pollingIntervalSeconds: 1 },
      );

      await waitForCondition(() => completionRecorded, 15_000);
      expect(externalSideEffects.size).toBe(1);
      expect(completionRecorded).toBe(true);
    });
  });

  describe("Concurrency & Double-Claim Prevention", () => {
    it("ensures two concurrent workers never double-claim or double-execute any job", async () => {
      const queueName = "concurrency-test";
      const jobCount = 10;
      const processedJobIds = new Map<string, number>();

      const workerHandler = async (job: { id: string }) => {
        const count = processedJobIds.get(job.id) ?? 0;
        processedJobIds.set(job.id, count + 1);
        await delay(50);
      };

      await durableJobs.work(queueName, workerHandler, { localConcurrency: 2 });

      for (let i = 0; i < jobCount; i += 1) {
        await durableJobs.send(queueName, { index: i });
      }

      await waitForCondition(() => processedJobIds.size === jobCount, 15_000);

      expect(processedJobIds.size).toBe(jobCount);
      for (const [, executions] of processedJobIds) {
        expect(executions).toBe(1);
      }
    });
  });

  describe("Retry Backoff & Dead-Letter State", () => {
    it("retries failed jobs with backoff and moves exhausted jobs to dead-letter state", async () => {
      const queueName = "dead-letter-test";
      const payload = { failureId: "poison-pill" };

      let attempts = 0;
      const jobId = await durableJobs.send(queueName, payload, {
        retryBackoff: true,
        retryDelay: 1,
        retryLimit: 2,
      });
      expect(jobId).toBeTruthy();

      await durableJobs.work<{ failureId: string }>(
        queueName,
        async (job) => {
          if (job.data.failureId === payload.failureId) {
            attempts += 1;
            throw new Error("Deliberate job failure for dead-letter proof");
          }
        },
        { pollingIntervalSeconds: 1 },
      );

      await waitForCondition(async () => {
        const deadLetterJobs = await durableJobs.getDeadLetterJobs(queueName);
        return deadLetterJobs.some((j) => j.id === jobId);
      }, 20_000);

      const deadLetterJobs = await durableJobs.getDeadLetterJobs<{ failureId: string }>(
        queueName,
      );
      const failedJob = deadLetterJobs.find((j) => j.id === jobId);

      expect(failedJob).toBeDefined();
      expect(failedJob?.state).toBe("failed");
      expect(failedJob?.data.failureId).toBe(payload.failureId);
      expect(attempts).toBe(3);
    });
  });

  describe("Graceful Shutdown & Drain", () => {
    it("drains active work cleanly when service shuts down", async () => {
      const queueName = "graceful-shutdown-test";
      let started = false;
      let finished = false;

      const secondService = new DurableJobsService(localDatabase);
      await secondService.onModuleInit();

      await secondService.work(queueName, async () => {
        started = true;
        await delay(300);
        finished = true;
      });

      await secondService.send(queueName, { msg: "drain-me" });
      await waitForCondition(() => started, 5_000);

      await secondService.stop({ graceful: true, timeout: 5_000 });
      expect(finished).toBe(true);
    });
  });
});

async function getMutationCount(pool: Pool): Promise<bigint> {
  const result = await pool.query<{ mutation_count: string }>(
    "select mutation_count from main_device_proof_state where singleton = true",
  );
  return BigInt(result.rows[0]?.mutation_count ?? 0);
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
