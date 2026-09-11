import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { seedOwnerRoleWithFloor } from "../../test/owner-floor-fixture.js";
import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { INVENTORY_BATCH_SAFETY_QUEUE } from "./inventory-safety.service.js";
import { InventorySafetyController } from "./inventory-safety.controller.js";
import { InventorySafetyCrashHarness } from "./test-helpers/inventory-safety-crash-harness.test.js";
import type {
  InventorySafetyCrashPoint,
  InventorySafetyJobPayload,
} from "./test-helpers/inventory-safety-crash-child.test.js";
import { addDays, businessDateOf } from "./business-date.js";
import {
  appendBatchExpiryAmendment,
  appendBatchStatusEvent,
  readBatchFacts,
  resolveReceiptClassRuleSet,
} from "./inventory-persistence.js";
import { allocateFefo } from "./inventory-persistence.js";
import {
  evaluateBatchEligibility,
  HARD_BLOCK_STATUSES,
} from "./inventory-eligibility.js";
import { catchUp, evaluateBusinessDate } from "./inventory-safety-evaluator.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

describe.sequential("inventory batch safety PostgreSQL seam", () => {
  let administrator: Pool;
  let application: Pool;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId: string;
  let ownerId: string;
  let roleId: string;
  let deviceId: string;
  let sessionId: string;
  let challengeId: string;
  let productId: string;
  let earlyBatchId: string;
  let eligibleBatchId: string;
  let longBatchId: string;
  let expiredBatchId: string;
  let undatedBatchId: string;
  let today: string;

  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    application = new Pool({ connectionString: databaseRoles.applicationUrl });
    await runMigrationsThroughApplication();

    pharmacyId = uuidV7();
    ownerId = uuidV7();
    roleId = uuidV7();
    deviceId = uuidV7();
    challengeId = uuidV7();
    productId = uuidV7();
    earlyBatchId = uuidV7();
    eligibleBatchId = uuidV7();
    longBatchId = uuidV7();
    expiredBatchId = uuidV7();
    undatedBatchId = uuidV7();
    today = businessDateOf(new Date(), "Asia/Baghdad");

    await application.query(
      "insert into pharmacies (id, name, business_time_zone) values ($1, 'Safety Fixture Pharmacy', 'Asia/Baghdad')",
      [pharmacyId],
    );
    await seedOwnerRoleWithFloor(application, {
      actorId: ownerId,
      displayName: "Safety Fixture Owner",
      pharmacyId,
      roleId,
      username: `safety-${pharmacyId.slice(-8)}`,
    });
    await seedProductAndBatches();
    await seedStepUpChallenge();
    const client = await application.connect();
    try {
      await resolveReceiptClassRuleSet(client, pharmacyId);
    } finally {
      client.release();
    }
  }, 180_000);

  afterAll(async () => {
    await application?.end().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("enforces FEFO, hard blocks, daily detection, append-only facts, and correction", async () => {
    const client = await application.connect();
    try {
      const firstPreview = await allocateFefo(
        client,
        {
          businessDate: today,
          lines: [{ productId, quantity: 15n }],
          nearExpiryDays: () => 90,
          pharmacyId,
        },
        false,
      );
      expect(firstPreview).toHaveProperty("allocations");
      if (!("allocations" in firstPreview)) throw new Error("FEFO failed");
      expect(firstPreview.allocations).toEqual([
        {
          batchId: earlyBatchId,
          effectiveExpiryDate: addDays(today, 10),
          productId,
          quantity: 10n,
          status: "near-expiry",
        },
        {
          batchId: eligibleBatchId,
          effectiveExpiryDate: addDays(today, 200),
          productId,
          quantity: 5n,
          status: "eligible",
        },
      ]);
      expect(firstPreview.blocked).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            batchId: expiredBatchId,
            status: "expired",
          }),
        ]),
      );

      const namedExpired = await allocateFefo(
        client,
        {
          businessDate: today,
          lines: [{ batchId: expiredBatchId, productId, quantity: 1n }],
          nearExpiryDays: () => 90,
          pharmacyId,
        },
        false,
      );
      expect(namedExpired).toMatchObject({
        batchId: expiredBatchId,
        kind: "regulatory-hard-block",
        status: "expired",
      });

      await appendBatchStatusEvent(client, {
        actorId: ownerId,
        batchId: earlyBatchId,
        businessDate: today,
        deviceId,
        evidence: "Supplier recall notice",
        kind: "recalled",
        pharmacyId,
        productId,
        reason: "Recall test",
        source: "user",
      });
      const afterRecall = await allocateFefo(
        client,
        {
          businessDate: today,
          lines: [{ productId, quantity: 15n }],
          nearExpiryDays: () => 90,
          pharmacyId,
        },
        false,
      );
      expect(afterRecall).toHaveProperty("blocked");
      if (!("allocations" in afterRecall)) throw new Error("FEFO failed");
      expect(
        afterRecall.allocations.some((row) => row.batchId === earlyBatchId),
      ).toBe(false);
      expect(afterRecall.blocked).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            batchId: earlyBatchId,
            status: "recalled",
          }),
        ]),
      );

      const movementHashBefore = await authoritativeHash();
      await appendBatchStatusEvent(client, {
        actorId: ownerId,
        batchId: eligibleBatchId,
        businessDate: today,
        deviceId,
        evidence: "Quarantine test evidence",
        kind: "quarantined",
        pharmacyId,
        productId,
        reason: "Quarantine test",
        source: "user",
      });
      expect(await authoritativeHash()).toBe(movementHashBefore);

      await client.query("begin");
      await evaluateBusinessDate(client, {
        businessDate: today,
        pharmacyId,
        trigger: "manual",
      });
      await client.query("commit");
      await catchUp(application, {
        pharmacyId,
        throughBusinessDate: addDays(today, 7),
        trigger: "catch-up",
      });
      const safetyHash = await tableHash("inventory_batch_safety_runs");
      const eventHash = await tableHash("inventory_batch_status_events");
      await catchUp(application, {
        pharmacyId,
        throughBusinessDate: addDays(today, 7),
        trigger: "catch-up",
      });
      expect(await tableHash("inventory_batch_safety_runs")).toBe(safetyHash);
      expect(await tableHash("inventory_batch_status_events")).toBe(eventHash);

      const tomorrow = addDays(today, 1);
      const expiringToday = await readBatchFacts(
        client,
        pharmacyId,
        { batchIds: [longBatchId] },
        { lock: false },
      );
      expect(expiringToday[0]?.effectiveExpiryDate).toBe(addDays(today, 400));
      await client.query("begin");
      await evaluateBusinessDate(client, {
        businessDate: tomorrow,
        pharmacyId,
        trigger: "manual",
      });
      await client.query("commit");

      await appendBatchExpiryAmendment(client, {
        approvalChallengeId: challengeId,
        batchId: expiredBatchId,
        businessDate: today,
        correctedExpiryDate: addDays(today, 30),
        createdBy: ownerId,
        deviceId,
        evidence: "Supplier correction evidence",
        pharmacyId,
        productId,
        originalExpiryDate: addDays(today, -1),
        reason: "Correct the recorded expiry",
      });
      const corrected = await readBatchFacts(
        client,
        pharmacyId,
        { batchIds: [expiredBatchId] },
        { lock: false },
      );
      expect(corrected[0]?.originalExpiryDate).toBe(addDays(today, -1));
      expect(corrected[0]?.effectiveExpiryDate).toBe(addDays(today, 30));
      expect(
        evaluateBatchEligibility({
          businessDate: today,
          effectiveExpiryDate: corrected[0]?.effectiveExpiryDate ?? null,
          latestStatusKind: corrected[0]?.latestStatusKind ?? null,
          nearExpiryDays: 90,
        }),
      ).toBe("near-expiry");
      const correctedPreview = await allocateFefo(
        client,
        {
          businessDate: today,
          lines: [{ batchId: expiredBatchId, productId, quantity: 1n }],
          nearExpiryDays: () => 90,
          pharmacyId,
        },
        false,
      );
      expect(correctedPreview).toHaveProperty("allocations");
      if (!("allocations" in correctedPreview)) {
        throw new Error("Corrected batch was not allocatable");
      }
      expect(correctedPreview.allocations).toEqual([
        expect.objectContaining({
          batchId: expiredBatchId,
          quantity: 1n,
          status: "near-expiry",
        }),
      ]);
      await catchUp(application, {
        pharmacyId,
        throughBusinessDate: addDays(today, 31),
        trigger: "catch-up",
      });
      const redetected = await application.query<{
        business_date: string;
        kind: string;
      }>(
        `select kind, business_date::text
         from inventory_batch_status_events
         where pharmacy_id = $1 and batch_id = $2 and kind = 'expired'
         order by sequence`,
        [pharmacyId, expiredBatchId],
      );
      expect(redetected.rows).toHaveLength(2);
      expect(redetected.rows.at(-1)?.business_date).toBe(addDays(today, 31));
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }

    const statusEvents = await application.query<{
      kind: string;
      business_date: string;
    }>(
      `select kind, business_date::text from inventory_batch_status_events
       where pharmacy_id = $1 order by business_date, sequence`,
      [pharmacyId],
    );
    expect(statusEvents.rows.some((row) => row.kind === "recalled")).toBe(true);
    expect(statusEvents.rows.some((row) => row.kind === "quarantined")).toBe(
      true,
    );
    expect(statusEvents.rows.some((row) => row.kind === "expired")).toBe(true);
    expect(
      statusEvents.rows.every((row) => row.business_date.length === 10),
    ).toBe(true);
  }, 120_000);

  it("rejects direct mutation and preserves the business-date boundary", async () => {
    const boundaryFacts = await seedAppendOnlyBoundaryFacts();
    const appendOnlyRows = [
      {
        parameters: [
          pharmacyId,
          boundaryFacts.statusBatchId,
          boundaryFacts.statusSequence,
        ],
        table: "inventory_batch_status_events",
        where: "pharmacy_id = $1 and batch_id = $2 and sequence = $3",
      },
      {
        parameters: [
          pharmacyId,
          boundaryFacts.amendmentBatchId,
          boundaryFacts.amendmentSequence,
        ],
        table: "inventory_batch_expiry_amendments",
        where: "pharmacy_id = $1 and batch_id = $2 and sequence = $3",
      },
      {
        parameters: [pharmacyId, boundaryFacts.runDate],
        table: "inventory_batch_safety_runs",
        where: "pharmacy_id = $1 and business_date = $2",
      },
    ];
    for (const row of appendOnlyRows) {
      await expect(
        administrator.query(
          `update ${row.table} set business_date = business_date where ${row.where}`,
          row.parameters,
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        administrator.query(
          `delete from ${row.table} where ${row.where}`,
          row.parameters,
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        application.query(
          `update ${row.table} set business_date = business_date where ${row.where}`,
          row.parameters,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        application.query(
          `delete from ${row.table} where ${row.where}`,
          row.parameters,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        application.query(`truncate ${row.table}`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        application.query(`alter table ${row.table} disable trigger all`),
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect(
      evaluateBatchEligibility({
        businessDate: "2026-09-12",
        effectiveExpiryDate: "2026-09-11",
        latestStatusKind: null,
        nearExpiryDays: 90,
      }),
    ).toBe("expired");
    expect(
      evaluateBatchEligibility({
        businessDate: "2026-09-11",
        effectiveExpiryDate: "2026-09-11",
        latestStatusKind: null,
        nearExpiryDays: 90,
      }),
    ).toBe("near-expiry");
    expect(HARD_BLOCK_STATUSES).toContain("postponed-blocked");
    expect(
      await readFile(new URL("./inventory-review.ts", import.meta.url), "utf8"),
    ).not.toMatch(/\bcurrent_date\b/iu);
    expect(
      await readFile(
        new URL("./inventory-persistence.ts", import.meta.url),
        "utf8",
      ),
    ).not.toMatch(/\bcurrent_date\b/iu);
  });

  it("recovers the real queue across claim, date-commit, final-commit, and duplicate-delivery crashes", async () => {
    const harness = new InventorySafetyCrashHarness();
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalMigrationUrl = process.env.DATABASE_MIGRATION_URL;
    const points: readonly {
      readonly afterIndex?: number;
      readonly point: InventorySafetyCrashPoint;
    }[] = [
      { point: "none" },
      { point: "after-claim" },
      { afterIndex: 3, point: "after-date" },
      { point: "after-final" },
    ];
    try {
      for (const [scenarioIndex, scenario] of points.entries()) {
        const lastRun = await application.query<{
          business_date: string | null;
        }>(
          `select max(business_date)::text as business_date
           from inventory_batch_safety_runs where pharmacy_id = $1`,
          [pharmacyId],
        );
        let baseDate = lastRun.rows[0]?.business_date ?? null;
        if (baseDate === null) {
          baseDate = addDays(today, -7);
          await application.query(
            `insert into inventory_batch_safety_runs (
               pharmacy_id, business_date, trigger, evaluated_batch_count,
               newly_expired_count, near_expiry_count
             ) values ($1, $2, 'startup', 0, 0, 0)`,
            [pharmacyId, baseDate],
          );
        }
        const firstDate = addDays(baseDate, 1);
        const throughBusinessDate = addDays(baseDate, 7);
        const fixture = await seedRuntimeFixture(
          scenarioIndex,
          addDays(firstDate, -1),
        );
        process.env.DATABASE_URL = databaseRoles.applicationUrl;
        delete process.env.DATABASE_MIGRATION_URL;
        const localDatabase = new LocalDatabaseService();
        await localDatabase.onModuleInit();
        const durableJobs = new DurableJobsService(localDatabase);
        await durableJobs.onModuleInit();
        const workerId = `inventory-safety-recovery-${String(scenarioIndex)}`;
        try {
          await durableJobs.ensureQueue(INVENTORY_BATCH_SAFETY_QUEUE, {
            expireInSeconds: 2,
            retryDelay: 1,
            retryLimit: 3,
          });
          const payload: InventorySafetyJobPayload = {
            pharmacyId: fixture.pharmacyId,
            throughBusinessDate,
            trigger: "catch-up",
          };
          const jobId = await durableJobs.send(
            INVENTORY_BATCH_SAFETY_QUEUE,
            payload,
            {
              expireInSeconds: 2,
              retryDelay: 1,
              retryLimit: 3,
            },
          );
          expect(jobId).toBeTruthy();
          if (jobId === null) throw new Error("Safety job was not enqueued");

          if (scenario.point === "none") {
            await durableJobs.work<InventorySafetyJobPayload>(
              INVENTORY_BATCH_SAFETY_QUEUE,
              async (job) => {
                await catchUp(application, {
                  jobId: job.id,
                  ...job.data,
                });
              },
            );
          } else {
            const child = await harness.spawnWorker({
              ...(scenario.afterIndex === undefined
                ? {}
                : { afterIndex: scenario.afterIndex }),
              crashPoint: scenario.point,
              databaseUrl: databaseRoles.applicationUrl,
              workerId,
            });
            const crashing = await child.waitForEvent(
              (event) => event.type === "crashing",
            );
            expect(crashing.point).toBe(scenario.point);
            expect((await child.waitForExit()).signal).toBe("SIGKILL");
            await delay(3_000);
            await durableJobs.supervise(INVENTORY_BATCH_SAFETY_QUEUE);
            await durableJobs.work<InventorySafetyJobPayload>(
              INVENTORY_BATCH_SAFETY_QUEUE,
              async (job) => {
                await catchUp(application, {
                  jobId: job.id,
                  ...job.data,
                });
              },
            );
          }

          await waitForSafetyRuns(
            fixture.pharmacyId,
            firstDate,
            throughBusinessDate,
          );
          const expectedDates = Array.from({ length: 7 }, (_, index) =>
            addDays(firstDate, index),
          );
          const runs = await application.query<{ business_date: string }>(
            `select business_date::text from inventory_batch_safety_runs
             where pharmacy_id = $1 and business_date between $2 and $3
             order by business_date`,
            [fixture.pharmacyId, firstDate, throughBusinessDate],
          );
          expect(runs.rows.map((row) => row.business_date)).toEqual(
            expectedDates,
          );
          const events = await application.query<{
            business_date: string;
            kind: string;
          }>(
            `select business_date::text, kind
             from inventory_batch_status_events
             where pharmacy_id = $1 and batch_id = $2
             order by sequence`,
            [fixture.pharmacyId, fixture.batchId],
          );
          expect(events.rows).toEqual([
            { business_date: firstDate, kind: "expired" },
          ]);
          await waitForJobCompleted(jobId);
          const beforeDuplicate = await safetyRuntimeHash(fixture.pharmacyId);
          await administrator.query(
            `update pgboss.job
             set state = 'retry', start_after = now(), completed_on = null,
                 output = null
             where id = $1`,
            [jobId],
          );
          await waitForJobCompleted(jobId);
          expect(await safetyRuntimeHash(fixture.pharmacyId)).toBe(
            beforeDuplicate,
          );
        } finally {
          await durableJobs.onApplicationShutdown().catch(() => undefined);
          await localDatabase.onApplicationShutdown().catch(() => undefined);
        }
      }
    } finally {
      await harness.stopAll();
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalMigrationUrl === undefined)
        delete process.env.DATABASE_MIGRATION_URL;
      else process.env.DATABASE_MIGRATION_URL = originalMigrationUrl;
    }
  }, 180_000);

  it("reports an unavailable runtime and audits Step-Up correction denials", async () => {
    const fixture = await seedRuntimeFixture(20);
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalMigrationUrl = process.env.DATABASE_MIGRATION_URL;
    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    delete process.env.DATABASE_MIGRATION_URL;
    const localDatabase = new LocalDatabaseService();
    await localDatabase.onModuleInit();
    const durableJobs = new DurableJobsService(localDatabase);
    await durableJobs.onModuleInit();
    try {
      const context = runtimeContext(fixture, [
        "inventory.batch_safety.manage",
        "inventory.review",
      ]);
      const identity = {
        requirePermission: async () => context,
        readPharmacyBusinessTimeZone: async () => "Asia/Baghdad",
      } as unknown as import("../identity-access/identity-access.service.js").IdentityAccessService;
      const safety = new (
        await import("./inventory-safety.service.js")
      ).InventorySafetyService(localDatabase, identity, durableJobs);
      const controller = new InventorySafetyController(safety);
      await durableJobs.stop();
      const status = await controller.readStatus({} as never);
      expect(status.jobRuntime).toBe("unavailable");
      expect(status.state).toBe("behind");
      const outage = await controller
        .triggerRun({}, {} as never)
        .catch((error: unknown) => error);
      expect(outage).toMatchObject({
        response: { code: "job-runtime-unavailable" },
        status: 503,
      });
      const outageAudit = await application.query<{ outcome: string }>(
        `select outcome from posting_audit_records
         where pharmacy_id = $1 and action = 'inventory.batch_safety.run'
         order by occurred_at desc limit 1`,
        [fixture.pharmacyId],
      );
      expect(outageAudit.rows[0]?.outcome).toBe("job-runtime-unavailable");

      const identityService = new IdentityAccessService(
        localDatabase,
        undefined as never,
        undefined as never,
        durableJobs,
      );
      const internals = identityService as unknown as {
        currentContext: () => Promise<ReturnType<typeof runtimeContext>>;
      };
      internals.currentContext = async () => context;
      const reusedChallenge = uuidV7();
      const staleChallenge = uuidV7();
      const missingPermissionChallenge = uuidV7();
      await seedRuntimeChallenge(fixture, reusedChallenge, 1, true);
      await seedRuntimeChallenge(fixture, staleChallenge, 1, false);
      const client = await application.connect();
      try {
        await appendBatchStatusEvent(client, {
          actorId: fixture.ownerId,
          batchId: fixture.batchId,
          businessDate: today,
          deviceId: fixture.deviceId,
          evidence: "Step-Up stale test",
          kind: "quarantined",
          pharmacyId: fixture.pharmacyId,
          productId: fixture.productId,
          reason: "Step-Up stale test",
          source: "user",
        });
      } finally {
        client.release();
      }
      await seedRuntimeChallenge(fixture, missingPermissionChallenge, 2, false);

      for (const [challengeId, expectedCode] of [
        [reusedChallenge, "step-up-reused"],
        [staleChallenge, "step-up-stale"],
      ] as const) {
        const deniedClient = await application.connect();
        try {
          await expect(
            identityService.consumeBatchSafetyStepUp(
              deniedClient,
              context,
              challengeId,
              {
                action: "inventory.batch_expiry.correct",
                batchId: fixture.batchId,
              },
            ),
          ).rejects.toMatchObject({ denial: { code: expectedCode } });
        } finally {
          deniedClient.release();
        }
      }
      internals.currentContext = async () =>
        runtimeContext(fixture, ["inventory.review"]);
      const missingClient = await application.connect();
      try {
        await expect(
          identityService.consumeBatchSafetyStepUp(
            missingClient,
            context,
            missingPermissionChallenge,
            {
              action: "inventory.batch_expiry.correct",
              batchId: fixture.batchId,
            },
          ),
        ).rejects.toMatchObject({
          denial: { code: "step-up-missing-permission" },
          statusCode: 403,
        });
      } finally {
        missingClient.release();
      }
      const denialAudits = await application.query<{ outcome: string }>(
        `select outcome from identity_audit_records
         where pharmacy_id = $1 and action = 'inventory.batch_expiry.correct'
         order by occurred_at desc limit 3`,
        [fixture.pharmacyId],
      );
      expect(denialAudits.rows.map((row) => row.outcome)).toEqual(
        expect.arrayContaining([
          "step-up-reused",
          "step-up-stale",
          "step-up-missing-permission",
        ]),
      );
    } finally {
      await localDatabase.onApplicationShutdown().catch(() => undefined);
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalMigrationUrl === undefined)
        delete process.env.DATABASE_MIGRATION_URL;
      else process.env.DATABASE_MIGRATION_URL = originalMigrationUrl;
    }
  }, 120_000);

  async function runMigrationsThroughApplication(): Promise<void> {
    const { runMigrations } = await import("../database-migrations.js");
    await runMigrations(application, databaseRoles.migrationUrl);
  }

  async function seedRuntimeFixture(
    index: number,
    expiryDate = addDays(today, -7),
  ): Promise<{
    readonly batchId: string;
    readonly deviceId: string;
    readonly ownerId: string;
    readonly pharmacyId: string;
    readonly productId: string;
    readonly roleId: string;
    readonly sessionId: string;
  }> {
    const runtimeProductId = uuidV7();
    const runtimeUnitId = uuidV7();
    const runtimeBatchId = uuidV7();
    // The product/unit foreign keys are deferrable and circular, so both
    // inserts must commit together.
    const productClient = await administrator.connect();
    try {
      await productClient.query("begin");
      await productClient.query(
        `insert into catalog_products (
           id, pharmacy_id, definition_mode, medication_trade_name,
           display_name, name_template_version, externally_visible,
           ai_sharing_allowed, cold_storage_required,
           count_default_unit_id, purchase_default_unit_id, sale_default_unit_id,
           pricing_method, retail_price_fils, created_by, updated_by
         ) values ($1, $2, 'medication', 'Crash Item', 'Crash Item', 1,
                   false, false, false, $3, $3, $3, 'by-price', 0, $4, $4)`,
        [runtimeProductId, pharmacyId, runtimeUnitId, ownerId],
      );
      await productClient.query(
        `insert into catalog_product_units (
           id, pharmacy_id, product_id, kind, name, ordinal
         ) values ($1, $2, $3, 'inventory', 'Unit', 0)`,
        [runtimeUnitId, pharmacyId, runtimeProductId],
      );
      await productClient.query("commit");
    } catch (error) {
      await productClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      productClient.release();
    }
    await administrator.query(
      `insert into inventory_batches (
         id, pharmacy_id, product_id, lot_number, expiry_date, quantity, created_by
       ) values ($1, $2, $3, $4, $5, 10, $6)`,
      [
        runtimeBatchId,
        pharmacyId,
        runtimeProductId,
        `CRASH-${String(index)}`,
        expiryDate,
        ownerId,
      ],
    );
    await administrator.query(
      `insert into inventory_movements (
         pharmacy_id, product_id, batch_id, reason, quantity,
         carrying_amount_fils, source_document_type, source_document_id,
         source_row_ordinal, created_by
       ) values ($1, $2, $3, 'purchase-receipt', 10, 1000,
                 'purchase-invoice', $4, 1, $5)`,
      [pharmacyId, runtimeProductId, runtimeBatchId, uuidV7(), ownerId],
    );
    return {
      batchId: runtimeBatchId,
      deviceId,
      ownerId,
      pharmacyId,
      productId: runtimeProductId,
      roleId,
      sessionId,
    };
  }

  function runtimeContext(
    fixture: Awaited<ReturnType<typeof seedRuntimeFixture>>,
    permissions: readonly string[],
  ): IdentityExecutionContext {
    return {
      actorId: fixture.ownerId,
      authRevision: 1n,
      deviceId: fixture.deviceId,
      deviceSessionHash: Buffer.alloc(32, 4),
      entitlement: {} as never,
      licensingDeviceId: fixture.deviceId,
      permissions: permissions as IdentityExecutionContext["permissions"],
      pharmacyId: fixture.pharmacyId,
      pharmacyIdentityRevision: 1n,
      roleId: fixture.roleId,
      roleKey: "owner" as const,
      roleRevision: 1n,
      sessionId: fixture.sessionId,
      terminalCertFingerprint: undefined,
      terminalDeviceId: undefined,
    } as IdentityExecutionContext;
  }

  async function seedRuntimeChallenge(
    fixture: Awaited<ReturnType<typeof seedRuntimeFixture>>,
    challengeId: string,
    subjectRevision: number,
    consumed: boolean,
  ): Promise<void> {
    await administrator.query(
      `insert into step_up_challenges (
         id, pharmacy_id, actor_user_id, identity_session_id, device_id,
         device_session_hash, action_name, required_permission, subject_id,
         subject_revision, pharmacy_identity_revision, actor_auth_revision,
         role_revision, expires_at, status, resolved_at, consumed_at
       ) values ($1, $2, $3, $4, $5, $6,
                 'inventory.batch_expiry.correct', 'inventory.batch_safety.manage',
                 $7, $8, 1, 1, 1, now() + interval '1 hour', 'approved', now(), $9)`,
      [
        challengeId,
        fixture.pharmacyId,
        fixture.ownerId,
        fixture.sessionId,
        fixture.deviceId,
        Buffer.alloc(32, 4),
        fixture.batchId,
        subjectRevision,
        consumed ? new Date() : null,
      ],
    );
  }

  async function waitForSafetyRuns(
    runtimePharmacyId: string,
    firstDate: string,
    throughBusinessDate: string,
  ): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const result = await application.query<{ count: string }>(
        `select count(*)::text as count from inventory_batch_safety_runs
         where pharmacy_id = $1 and business_date between $2 and $3`,
        [runtimePharmacyId, firstDate, throughBusinessDate],
      );
      if (Number(result.rows[0]?.count ?? "0") === 7) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `Safety runtime did not complete the dates from ${firstDate} through ${throughBusinessDate}`,
        );
      }
      await delay(200);
    }
  }

  async function waitForJobCompleted(jobId: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const result = await administrator.query<{ state: string }>(
        "select state::text from pgboss.job where id = $1",
        [jobId],
      );
      if (result.rows[0]?.state === "completed") return;
      if (Date.now() >= deadline) {
        throw new Error(`Safety job ${jobId} did not complete twice`);
      }
      await delay(200);
    }
  }

  async function safetyRuntimeHash(runtimePharmacyId: string): Promise<string> {
    const result = await administrator.query<{ hash: string }>(
      `select md5(string_agg(payload, '' order by table_name, payload)) as hash
       from (
         select 'runs' as table_name,
                coalesce(string_agg(pharmacy_id::text || ':' || business_date::text || ':' || evaluated_batch_count::text || ':' || newly_expired_count::text, ',' order by business_date), '') as payload
         from inventory_batch_safety_runs where pharmacy_id = $1
         union all
         select 'events',
                coalesce(string_agg(batch_id::text || ':' || kind || ':' || business_date::text, ',' order by sequence), '')
         from inventory_batch_status_events where pharmacy_id = $1
       ) facts`,
      [runtimePharmacyId],
    );
    return result.rows[0]?.hash ?? "";
  }

  async function seedProductAndBatches(): Promise<void> {
    const medicationUnit = uuidV7();
    const medication = productId;
    const generalProductId = uuidV7();
    const generalUnit = uuidV7();
    const client = await administrator.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into catalog_products (
           id, pharmacy_id, definition_mode, medication_trade_name,
           display_name, name_template_version, externally_visible,
           ai_sharing_allowed, cold_storage_required,
           count_default_unit_id, purchase_default_unit_id, sale_default_unit_id,
           pricing_method, retail_price_fils, created_by, updated_by
         ) values ($1, $2, 'medication', 'Safety Item', 'Safety Item', 1,
                   false, false, false, $3, $3, $3, 'by-price', 0, $4, $4)`,
        [medication, pharmacyId, medicationUnit, ownerId],
      );
      await client.query(
        `insert into catalog_products (
           id, pharmacy_id, definition_mode, general_company,
           display_name, name_template_version, externally_visible,
           ai_sharing_allowed, cold_storage_required,
           count_default_unit_id, purchase_default_unit_id, sale_default_unit_id,
           pricing_method, retail_price_fils, created_by, updated_by
         ) values ($1, $2, 'general-item', 'Safety Company', 'Safety General', 1,
                   false, false, false, $3, $3, $3, 'by-price', 0, $4, $4)`,
        [generalProductId, pharmacyId, generalUnit, ownerId],
      );
      for (const [unitId, product] of [
        [medicationUnit, medication],
        [generalUnit, generalProductId],
      ] as const) {
        await client.query(
          `insert into catalog_product_units (
             id, pharmacy_id, product_id, kind, name, ordinal
           ) values ($1, $2, $3, 'inventory', 'Unit', 0)`,
          [unitId, pharmacyId, product],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const batches = [
      [earlyBatchId, addDays(today, 10), 10],
      [eligibleBatchId, addDays(today, 200), 10],
      [longBatchId, addDays(today, 400), 10],
      [expiredBatchId, addDays(today, -1), 10],
      [undatedBatchId, null, 10],
    ] as const;
    for (const [batchId, expiryDate, quantity] of batches) {
      const batchProduct =
        batchId === undatedBatchId ? generalProductId : productId;
      await administrator.query(
        `insert into inventory_batches (
           id, pharmacy_id, product_id, lot_number, expiry_date, quantity, created_by
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          batchId,
          pharmacyId,
          batchProduct,
          `LOT-${batchId.slice(-4)}`,
          expiryDate,
          quantity,
          ownerId,
        ],
      );
      await administrator.query(
        `insert into inventory_movements (
           pharmacy_id, product_id, batch_id, reason, quantity,
           carrying_amount_fils, source_document_type, source_document_id,
           source_row_ordinal, created_by
         ) values ($1, $2, $3, 'purchase-receipt', $4, $5,
                   'purchase-invoice', $6, 1, $7)`,
        [
          pharmacyId,
          batchProduct,
          batchId,
          quantity,
          quantity * 100,
          uuidV7(),
          ownerId,
        ],
      );
    }
  }

  async function seedStepUpChallenge(): Promise<void> {
    sessionId = uuidV7();
    await administrator.query(
      "insert into main_devices (id, credential_hash) values ($1, $2)",
      [deviceId, Buffer.alloc(32, 3)],
    );
    await administrator.query(
      "insert into main_device_sessions (token_hash, device_id) values ($1, $2)",
      [Buffer.alloc(32, 4), deviceId],
    );
    await administrator.query(
      `insert into identity_sessions (
         id, pharmacy_id, user_id, device_id, device_session_hash, expires_at
       ) values ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
      [sessionId, pharmacyId, ownerId, deviceId, Buffer.alloc(32, 4)],
    );
    await administrator.query(
      `insert into step_up_challenges (
         id, pharmacy_id, actor_user_id, identity_session_id, device_id,
         device_session_hash, action_name, required_permission, subject_id,
         subject_revision, pharmacy_identity_revision, actor_auth_revision,
         role_revision, expires_at, status, resolved_at
       ) values ($1, $2, $3, $4, $5, $6,
                 'inventory.batch_expiry.correct', 'inventory.batch_safety.manage',
                 $7, 1, 1, 1, 1, now() + interval '1 hour', 'approved', now())`,
      [
        challengeId,
        pharmacyId,
        ownerId,
        sessionId,
        deviceId,
        Buffer.alloc(32, 4),
        expiredBatchId,
      ],
    );
  }

  async function seedAppendOnlyBoundaryFacts(): Promise<{
    readonly amendmentBatchId: string;
    readonly amendmentSequence: number;
    readonly runDate: string;
    readonly statusBatchId: string;
    readonly statusSequence: number;
  }> {
    const boundaryChallengeId = uuidV7();
    await administrator.query(
      `insert into step_up_challenges (
         id, pharmacy_id, actor_user_id, identity_session_id, device_id,
         device_session_hash, action_name, required_permission, subject_id,
         subject_revision, pharmacy_identity_revision, actor_auth_revision,
         role_revision, expires_at, status, resolved_at
       ) values ($1, $2, $3, $4, $5, $6,
                 'inventory.batch_expiry.correct', 'inventory.batch_safety.manage',
                 $7, 1, 1, 1, 1, now() + interval '1 hour', 'approved', now())`,
      [
        boundaryChallengeId,
        pharmacyId,
        ownerId,
        sessionId,
        deviceId,
        Buffer.alloc(32, 4),
        longBatchId,
      ],
    );
    const client = await application.connect();
    try {
      await appendBatchStatusEvent(client, {
        actorId: ownerId,
        batchId: longBatchId,
        businessDate: today,
        deviceId,
        evidence: "Append-only boundary evidence",
        kind: "quarantined",
        pharmacyId,
        productId,
        reason: "Append-only boundary test",
        source: "user",
      });
      await appendBatchExpiryAmendment(client, {
        approvalChallengeId: boundaryChallengeId,
        batchId: longBatchId,
        businessDate: today,
        correctedExpiryDate: addDays(today, 401),
        createdBy: ownerId,
        deviceId,
        evidence: "Append-only correction evidence",
        pharmacyId,
        originalExpiryDate: addDays(today, 400),
        productId,
        reason: "Append-only boundary correction",
      });
    } finally {
      client.release();
    }
    const runDate = addDays(today, -100);
    await application.query(
      `insert into inventory_batch_safety_runs (
         pharmacy_id, business_date, trigger, evaluated_batch_count,
         newly_expired_count, near_expiry_count
       ) values ($1, $2, 'manual', 1, 0, 0)`,
      [pharmacyId, runDate],
    );
    return {
      amendmentBatchId: longBatchId,
      amendmentSequence: 1,
      runDate,
      statusBatchId: longBatchId,
      statusSequence: 1,
    };
  }

  async function authoritativeHash(): Promise<string> {
    const result = await application.query<{ hash: string }>(
      `select md5(string_agg(payload, '' order by table_name, payload)) as hash
       from (
         select 'movement' as table_name,
                coalesce(string_agg(id::text || ':' || quantity::text || ':' || carrying_amount_fils::text, ',' order by id), '') as payload
         from inventory_movements where pharmacy_id = $1
         union all
         select 'value', coalesce(string_agg(id::text || ':' || quantity_delta::text || ':' || carrying_amount_delta_fils::text, ',' order by id), '')
         from inventory_value_effects where pharmacy_id = $1
         union all
         select 'valuation', coalesce(string_agg(product_id::text || ':' || total_quantity::text || ':' || total_value_scaled::text, ',' order by product_id), '')
         from inventory_valuation_state where pharmacy_id = $1
       ) facts`,
      [pharmacyId],
    );
    return result.rows[0]?.hash ?? "";
  }

  async function tableHash(table: string): Promise<string> {
    const allowed = new Set([
      "inventory_batch_safety_runs",
      "inventory_batch_status_events",
    ]);
    if (!allowed.has(table)) throw new Error("Unexpected test table");
    const result = await application.query<{ hash: string }>(
      `select md5(coalesce(string_agg(row_to_json(row)::text, '' order by row_to_json(row)::text), '')) as hash
       from (select * from ${table} where pharmacy_id = $1) row`,
      [pharmacyId],
    );
    return result.rows[0]?.hash ?? "";
  }
});

function uuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
