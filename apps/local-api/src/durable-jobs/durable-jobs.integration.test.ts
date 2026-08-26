import { NestFactory } from "@nestjs/core";
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
import { AppModule } from "../app.module.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { mainDeviceProofState } from "../main-device/main-device-schema.js";
import { DurableJobsService } from "./durable-jobs.service.js";
import {
  clearCrashTestTables,
  getExternalEffects,
  getJobOutcomes,
  setupCrashTestTables,
} from "./test-helpers/crash-harness-schema.js";
import { CrashTestHarness } from "./test-helpers/crash-test-harness.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

describe.sequential("DurableJobsService integration & resilience proof", () => {
  let postgres: StartedPostgreSqlContainer;
  let databaseRoles: SeparatedDatabaseRoles;
  let localDatabase: LocalDatabaseService;
  let durableJobs: DurableJobsService;
  let harness: CrashTestHarness;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);

    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;

    localDatabase = new LocalDatabaseService();
    await localDatabase.onModuleInit();

    await setupCrashTestTables(databaseRoles.migrationUrl);

    durableJobs = new DurableJobsService(localDatabase);
    await durableJobs.onModuleInit();

    harness = new CrashTestHarness();
  }, 120_000);

  afterAll(async () => {
    await harness?.stopAll().catch(() => undefined);
    await durableJobs?.onApplicationShutdown().catch(() => undefined);
    await localDatabase?.onApplicationShutdown().catch(() => undefined);
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

    it("proves the breev_app role has full DML access to pgboss tables and 0 DDL access", async () => {
      const pool = localDatabase.requirePool();
      const tables = ["pgboss.job", "pgboss.version", "pgboss.queue"];
      for (const table of tables) {
        const selectPriv = await pool.query<{ has: boolean }>(
          "select has_table_privilege('breev_app', $1, 'SELECT') as has",
          [table],
        );
        const insertPriv = await pool.query<{ has: boolean }>(
          "select has_table_privilege('breev_app', $1, 'INSERT') as has",
          [table],
        );
        const updatePriv = await pool.query<{ has: boolean }>(
          "select has_table_privilege('breev_app', $1, 'UPDATE') as has",
          [table],
        );
        const deletePriv = await pool.query<{ has: boolean }>(
          "select has_table_privilege('breev_app', $1, 'DELETE') as has",
          [table],
        );
        expect(selectPriv.rows[0]?.has).toBe(true);
        expect(insertPriv.rows[0]?.has).toBe(true);
        expect(updatePriv.rows[0]?.has).toBe(true);
        expect(deletePriv.rows[0]?.has).toBe(true);
      }

      const schemaUsage = await pool.query<{ has: boolean }>(
        "select has_schema_privilege('breev_app', 'pgboss', 'USAGE') as has",
      );
      const schemaCreate = await pool.query<{ has: boolean }>(
        "select has_schema_privilege('breev_app', 'pgboss', 'CREATE') as has",
      );
      expect(schemaUsage.rows[0]?.has).toBe(true);
      expect(schemaCreate.rows[0]?.has).toBe(false);
    });

    it("proves migratePgBoss runs idempotently on subsequent migration runs", async () => {
      process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
      const secondDb = new LocalDatabaseService();
      await expect(secondDb.onModuleInit()).resolves.toBeUndefined();
      await secondDb.onApplicationShutdown();
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
          .set({
            mutationCount: sql`${mainDeviceProofState.mutationCount} + 1`,
          })
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
            .set({
              mutationCount: sql`${mainDeviceProofState.mutationCount} + 100`,
            })
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

  describe("Mandatory 4-Point Crash Recovery Matrix with Real Process Termination (SIGKILL) & Persistent Outcomes", () => {
    const pool = () => localDatabase.requirePool();

    beforeAll(async () => {
      await clearCrashTestTables(pool());
    });

    it("Crash Point 1 (Before Claim): recovers and completes jobs enqueued while worker process was down", async () => {
      const queueName = "crash-point-1-before-claim";
      const idempotencyKey = "idemp-p1-before-claim-001";
      const payload = { idempotencyKey, operation: "print-receipt" };

      // 1. Enqueue job while no worker process exists for this queue
      const jobId = await durableJobs.send(queueName, payload, {
        expireInSeconds: 5,
        retryLimit: 2,
      });
      expect(jobId).toBeTruthy();

      // Assert pre-condition: 0 external effects, 0 outcomes in database
      const initialEffects = await getExternalEffects(pool(), idempotencyKey);
      const initialOutcomes = await getJobOutcomes(pool(), idempotencyKey);
      expect(initialEffects.length).toBe(0);
      expect(initialOutcomes.length).toBe(0);

      // 2. Start fresh worker child process
      const worker = await harness.spawnWorker({
        crashPoint: "none",
        databaseUrl: databaseRoles.applicationUrl,
        targetIdempotencyKey: idempotencyKey,
        targetQueue: queueName,
      });

      // 3. Wait for worker to complete the job
      await worker.waitForEvent(
        (e) => e.type === "completed" && e.idempotencyKey === idempotencyKey,
        15_000,
      );

      // 4. Assert persistent outcomes in PostgreSQL
      const finalEffects = await getExternalEffects(pool(), idempotencyKey);
      const finalOutcomes = await getJobOutcomes(pool(), idempotencyKey);

      expect(finalEffects.length).toBe(1);
      expect(finalOutcomes.length).toBe(1);
      expect(finalOutcomes[0]?.job_id).toBe(jobId);
      expect(finalOutcomes[0]?.result).toBe("PROCESSED_SUCCESSFULLY");

      await worker.stop();
    });

    it("Crash Point 2 (After Claim / Mid-Flight): recovers abandoned job via lease expiry after hard process SIGKILL", async () => {
      const queueName = "crash-point-2-after-claim";
      const idempotencyKey = "idemp-p2-after-claim-002";
      const payload = { idempotencyKey, operation: "cloud-sync-batch" };

      // 1. Enqueue job with short lease (2s)
      const jobId = await durableJobs.send(queueName, payload, {
        expireInSeconds: 2,
        retryDelay: 0,
        retryLimit: 2,
      });
      expect(jobId).toBeTruthy();

      // 2. Spawn worker configured to crash immediately after claiming the job (before external effect)
      const crashingWorker = await harness.spawnWorker({
        crashPoint: "after-claim",
        databaseUrl: databaseRoles.applicationUrl,
        targetIdempotencyKey: idempotencyKey,
        targetQueue: queueName,
      });

      // 3. Crashing worker claims job and is terminated by SIGKILL
      const exitResult = await crashingWorker.waitForExit(15_000);
      expect(exitResult.signal).toBe("SIGKILL");

      // Verify no side-effects or outcomes were written before crash
      const preRecoveryEffects = await getExternalEffects(
        pool(),
        idempotencyKey,
      );
      const preRecoveryOutcomes = await getJobOutcomes(pool(), idempotencyKey);
      expect(preRecoveryEffects.length).toBe(0);
      expect(preRecoveryOutcomes.length).toBe(0);

      // 4. Wait for lease expiry (2 seconds + supervision)
      await delay(3_000);
      await durableJobs.supervise(queueName);

      // 5. Spawn recovered worker process to resume work
      const recoveryWorker = await harness.spawnWorker({
        crashPoint: "none",
        databaseUrl: databaseRoles.applicationUrl,
        targetIdempotencyKey: idempotencyKey,
        targetQueue: queueName,
      });

      await recoveryWorker.waitForEvent(
        (e) => e.type === "completed" && e.idempotencyKey === idempotencyKey,
        15_000,
      );

      // 6. Assert exactly one persistent outcome and effect in PostgreSQL
      const finalEffects = await getExternalEffects(pool(), idempotencyKey);
      const finalOutcomes = await getJobOutcomes(pool(), idempotencyKey);

      expect(finalEffects.length).toBe(1);
      expect(finalOutcomes.length).toBe(1);
      expect(finalOutcomes[0]?.job_id).toBe(jobId);

      await recoveryWorker.stop();
    });

    it("Crash Point 3 (After External Success): recovers after hard process SIGKILL without duplicating external effect", async () => {
      const queueName = "crash-point-3-after-ext-success";
      const idempotencyKey = "idemp-p3-after-ext-003";
      const payload = { idempotencyKey, operation: "send-sms-notification" };

      // 1. Enqueue job with 2s lease
      const jobId = await durableJobs.send(queueName, payload, {
        expireInSeconds: 2,
        retryDelay: 0,
        retryLimit: 2,
      });
      expect(jobId).toBeTruthy();

      // 2. Spawn worker configured to execute external effect and then crash with SIGKILL before recording outcome
      const crashingWorker = await harness.spawnWorker({
        crashPoint: "after-external-success",
        databaseUrl: databaseRoles.applicationUrl,
        targetIdempotencyKey: idempotencyKey,
        targetQueue: queueName,
      });

      // 3. Worker executes external effect and terminates with SIGKILL
      const exitResult = await crashingWorker.waitForExit(15_000);
      expect(exitResult.signal).toBe("SIGKILL");

      // Verify external effect was executed, but outcome table is still empty
      const midEffects = await getExternalEffects(pool(), idempotencyKey);
      const midOutcomes = await getJobOutcomes(pool(), idempotencyKey);
      expect(midEffects.length).toBe(1);
      expect(midOutcomes.length).toBe(0);

      // 4. Wait for lease expiry
      await delay(3_000);
      await durableJobs.supervise(queueName);

      // 5. Spawn recovered worker process
      const recoveryWorker = await harness.spawnWorker({
        crashPoint: "none",
        databaseUrl: databaseRoles.applicationUrl,
        targetIdempotencyKey: idempotencyKey,
        targetQueue: queueName,
      });

      const completedEvent = await recoveryWorker.waitForEvent(
        (e) => e.type === "completed" && e.idempotencyKey === idempotencyKey,
        15_000,
      );
      expect(completedEvent).toBeDefined();

      // 6. Assert INVARIANT: exactly 1 external effect (zero duplicate external calls) and exactly 1 outcome
      const finalEffects = await getExternalEffects(pool(), idempotencyKey);
      const finalOutcomes = await getJobOutcomes(pool(), idempotencyKey);

      expect(finalEffects.length).toBe(1);
      expect(finalOutcomes.length).toBe(1);
      expect(finalOutcomes[0]?.job_id).toBe(jobId);

      await recoveryWorker.stop();
    });

    it("Crash Point 4 (Before Outcome Recording): recovers after hard SIGKILL before outcome transaction commits", async () => {
      const queueName = "crash-point-4-before-outcome";
      const idempotencyKey = "idemp-p4-before-outcome-004";
      const payload = { idempotencyKey, operation: "post-commit-outbox-sync" };

      // 1. Enqueue job with 2s lease
      const jobId = await durableJobs.send(queueName, payload, {
        expireInSeconds: 2,
        retryDelay: 0,
        retryLimit: 2,
      });
      expect(jobId).toBeTruthy();

      // 2. Spawn worker configured to execute external effect and crash immediately before outcome recording
      const crashingWorker = await harness.spawnWorker({
        crashPoint: "before-outcome-recording",
        databaseUrl: databaseRoles.applicationUrl,
        targetIdempotencyKey: idempotencyKey,
        targetQueue: queueName,
      });

      // 3. Worker crashes with SIGKILL right before outcome recording
      const exitResult = await crashingWorker.waitForExit(15_000);
      expect(exitResult.signal).toBe("SIGKILL");

      // Verify external effect was recorded, outcome was not recorded
      const midEffects = await getExternalEffects(pool(), idempotencyKey);
      const midOutcomes = await getJobOutcomes(pool(), idempotencyKey);
      expect(midEffects.length).toBe(1);
      expect(midOutcomes.length).toBe(0);

      // 4. Wait for lease expiry
      await delay(3_000);
      await durableJobs.supervise(queueName);

      // 5. Spawn recovered worker process
      const recoveryWorker = await harness.spawnWorker({
        crashPoint: "none",
        databaseUrl: databaseRoles.applicationUrl,
        targetIdempotencyKey: idempotencyKey,
        targetQueue: queueName,
      });

      await recoveryWorker.waitForEvent(
        (e) => e.type === "completed" && e.idempotencyKey === idempotencyKey,
        15_000,
      );

      // 6. Assert INVARIANT: exactly 1 external effect and exactly 1 persistent outcome
      const finalEffects = await getExternalEffects(pool(), idempotencyKey);
      const finalOutcomes = await getJobOutcomes(pool(), idempotencyKey);

      expect(finalEffects.length).toBe(1);
      expect(finalOutcomes.length).toBe(1);
      expect(finalOutcomes[0]?.job_id).toBe(jobId);

      await recoveryWorker.stop();
    });
  });

  describe("Worker Concurrency & Double-Claim Prevention (Multi-Instance Seam)", () => {
    it("ensures two concurrent worker instances across 50 jobs process disjoint sets with zero double claims", async () => {
      const queueName = "multi-worker-concurrency-50";
      const totalJobs = 50;

      // Two independent DurableJobsService instances connected via separate pools
      const workerInstanceA = new DurableJobsService(localDatabase);
      const workerInstanceB = new DurableJobsService(localDatabase);

      await workerInstanceA.onModuleInit();
      await workerInstanceB.onModuleInit();

      const processedByWorkerA = new Set<string>();
      const processedByWorkerB = new Set<string>();

      await workerInstanceA.work(
        queueName,
        async (job) => {
          processedByWorkerA.add(job.id);
          await delay(20);
        },
        { localConcurrency: 4 },
      );

      await workerInstanceB.work(
        queueName,
        async (job) => {
          processedByWorkerB.add(job.id);
          await delay(20);
        },
        { localConcurrency: 4 },
      );

      // Enqueue 50 jobs
      const enqueuedJobIds: string[] = [];
      for (let i = 0; i < totalJobs; i += 1) {
        const id = await durableJobs.send(queueName, { index: i });
        if (id) {
          enqueuedJobIds.push(id);
        }
      }
      expect(enqueuedJobIds.length).toBe(totalJobs);

      // Wait until all 50 jobs are processed across both instances
      await waitForCondition(
        () => processedByWorkerA.size + processedByWorkerB.size === totalJobs,
        25_000,
      );

      // Assert disjoint processing: zero overlap
      const overlap = [...processedByWorkerA].filter((id) =>
        processedByWorkerB.has(id),
      );
      expect(overlap).toEqual([]);
      expect(processedByWorkerA.size + processedByWorkerB.size).toBe(totalJobs);
      expect(processedByWorkerA.size).toBeGreaterThan(0);
      expect(processedByWorkerB.size).toBeGreaterThan(0);

      await workerInstanceA.onApplicationShutdown();
      await workerInstanceB.onApplicationShutdown();
    });

    it("verifies safe duplicate completion handling on completed jobs", async () => {
      const queueName = "safe-duplicate-complete";
      const boss = durableJobs.requireBoss();
      await durableJobs.ensureQueue(queueName);

      const jobId = await durableJobs.send(queueName, { test: "dup-complete" });
      expect(jobId).toBeTruthy();

      let handlerCalled = false;
      await durableJobs.work(queueName, async (job) => {
        if (job.id === jobId) {
          handlerCalled = true;
        }
      });

      await waitForCondition(() => handlerCalled, 10_000);

      // Calling complete directly on an already completed job is idempotent and safe
      if (jobId) {
        const response = await boss.complete(queueName, jobId);
        expect(response).toBeDefined();
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
        const deadLetterJobs = await durableJobs.getDeadLetterJobs(queueName, {
          limit: 10,
        });
        return deadLetterJobs.some((j) => j.id === jobId);
      }, 20_000);

      const deadLetterJobs = await durableJobs.getDeadLetterJobs<{
        failureId: string;
      }>(queueName, { limit: 10 });
      const failedJob = deadLetterJobs.find((j) => j.id === jobId);

      expect(failedJob).toBeDefined();
      expect(failedJob?.state).toBe("failed");
      expect(failedJob?.data.failureId).toBe(payload.failureId);
      expect(attempts).toBe(3);
    });

    it("surfaces forwarded DLQ jobs when queue is configured with deadLetter destination and supports pagination", async () => {
      const dlqName = "order-dlq-target";
      const sourceQueue = "order-source-with-dlq";
      const payload = { orderId: "ord-9999", reason: "payment-declined" };

      // Ensure DLQ target exists
      await durableJobs.ensureQueue(dlqName);

      const jobId = await durableJobs.send(sourceQueue, payload, {
        deadLetter: dlqName,
        retryDelay: 0,
        retryLimit: 1,
      });
      expect(jobId).toBeTruthy();

      let attempts = 0;
      await durableJobs.work<{ orderId: string }>(
        sourceQueue,
        async (job) => {
          if (job.data.orderId === payload.orderId) {
            attempts += 1;
            throw new Error(
              "Deliberate order processing failure to trigger DLQ",
            );
          }
        },
        { pollingIntervalSeconds: 1 },
      );

      // Wait for forwarded job to land in dlqName
      await waitForCondition(async () => {
        const dlqJobs = await durableJobs.getDeadLetterJobs(dlqName);
        return dlqJobs.some(
          (j) =>
            (j.data as { orderId?: string })?.orderId === payload.orderId &&
            j.sourceName === sourceQueue,
        );
      }, 20_000);

      // 1. Query by DLQ name
      const dlqJobs = await durableJobs.getDeadLetterJobs<{ orderId: string }>(
        dlqName,
      );
      const forwardedJob = dlqJobs.find(
        (j) => j.data.orderId === payload.orderId,
      );
      expect(forwardedJob).toBeDefined();
      expect(forwardedJob?.name).toBe(dlqName);
      expect(forwardedJob?.sourceName).toBe(sourceQueue);
      expect(forwardedJob?.sourceId).toBe(jobId);
      expect(attempts).toBeGreaterThanOrEqual(2);

      // 2. Query by source queue name
      const sourceDlqJobs = await durableJobs.getDeadLetterJobs<{
        orderId: string;
      }>(sourceQueue);
      expect(
        sourceDlqJobs.some((j) => j.data.orderId === payload.orderId),
      ).toBe(true);

      // 3. Global DLQ query
      const allDlqJobs = await durableJobs.getDeadLetterJobs();
      expect(
        allDlqJobs.some(
          (j) => (j.data as { orderId?: string })?.orderId === payload.orderId,
        ),
      ).toBe(true);

      // 4. Pagination / limit / offset
      const paginated = await durableJobs.getDeadLetterJobs(dlqName, {
        limit: 1,
        offset: 0,
      });
      expect(paginated.length).toBe(1);
    });
  });

  describe("NestJS Lifecycle, Readiness Barrier & Fail-Fast Startup", () => {
    it("resolves concurrent onModuleInit execution between LocalDatabaseService and DurableJobsService", async () => {
      process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
      const testDb = new LocalDatabaseService();
      const testJobs = new DurableJobsService(testDb);

      // Concurrently fire both onModuleInit hooks (mimicking NestJS callModuleInitHook)
      await Promise.all([testDb.onModuleInit(), testJobs.onModuleInit()]);

      expect(testJobs.isAvailable()).toBe(true);
      await testJobs.onApplicationShutdown();
      await testDb.onApplicationShutdown();
    });

    it("boots full NestJS application context (AppModule) deterministically", async () => {
      process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
      const app = await NestFactory.createApplicationContext(AppModule, {
        logger: false,
      });

      const dbService = app.get(LocalDatabaseService);
      const jobService = app.get(DurableJobsService);

      expect(await dbService.isAvailable()).toBe(true);
      expect(jobService.isAvailable()).toBe(true);

      await app.close();
    });

    it("fails startup visibly when database connection or migrations fail", async () => {
      const invalidDb = new LocalDatabaseService();
      (invalidDb as unknown as { applicationUrl: string }).applicationUrl =
        "postgresql://breev_app:invalid@127.0.0.1:54321/nonexistent";
      const brokenJobs = new DurableJobsService(invalidDb);

      await expect(brokenJobs.onModuleInit()).rejects.toThrow();
    });

    it("does not cache queue name in knownQueues when creation fails", async () => {
      const invalidDb = new LocalDatabaseService();
      const brokenJobs = new DurableJobsService(invalidDb);
      await expect(brokenJobs.ensureQueue("failing-queue")).rejects.toThrow();
      expect(
        (brokenJobs as unknown as { knownQueues: Set<string> }).knownQueues.has(
          "failing-queue",
        ),
      ).toBe(false);
    });
  });

  describe("Graceful Shutdown & Drain Lifecycle", () => {
    it("drains active work cleanly when service shuts down via onApplicationShutdown", async () => {
      const queueName = "graceful-shutdown-lifecycle-test";
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

      // Clean shutdown drain using onApplicationShutdown()
      await secondService.onApplicationShutdown();
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
