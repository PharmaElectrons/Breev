import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DurableJobsService } from "../src/durable-jobs/durable-jobs.service.js";
import { LocalDatabaseService } from "../src/local-database.service.js";
import { RecoveryCoordinatorService } from "../src/recovery/recovery-coordinator.service.js";
import {
  decryptRecoveryPayload,
  type RecoveryKeyMaterial,
  type RecoveryKeyProvider,
} from "../src/recovery/recovery-crypto.js";
import {
  RECOVERY_BACKUP_JOB_NAME,
  RecoveryJobService,
} from "../src/recovery/recovery-job.service.js";
import { RestoreQuarantineService } from "../src/recovery/restore-quarantine.service.js";
import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "./database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const PHARMACY_NAME = "Al-Amal Pharmacy Baghdad";
const CA_PRIVATE_KEY_PEM =
  "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----\n";

/**
 * The recovery key encryption key lives in Windows machine key storage, which
 * has no Linux equivalent. The seam that a test may replace is exactly the key
 * provider; every other step runs the production code path.
 */
const testKey: RecoveryKeyMaterial = {
  kek: randomBytes(32),
  protectionLevel: "software-test",
};
const testKeyProvider: RecoveryKeyProvider = () => testKey;

describe.sequential("Local recovery persistence seam", () => {
  let postgres: StartedPostgreSqlContainer;
  let databaseRoles: SeparatedDatabaseRoles;
  let localDatabase: LocalDatabaseService;
  let durableJobs: DurableJobsService;
  let quarantineService: RestoreQuarantineService;
  let coordinator: RecoveryCoordinatorService;
  let jobService: RecoveryJobService;
  let testTempDir: string;
  let backupOutputDir: string;

  beforeAll(async () => {
    testTempDir = mkdtempSync(path.join(tmpdir(), "breev-recovery-test-"));
    backupOutputDir = path.join(testTempDir, "backups");
    mkdirSync(backupOutputDir, { recursive: true });

    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);

    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
    process.env.BREEV_BACKUP_DIRECTORY = backupOutputDir;

    localDatabase = new LocalDatabaseService();
    await localDatabase.onModuleInit();

    durableJobs = new DurableJobsService(localDatabase);
    await durableJobs.onModuleInit();

    quarantineService = new RestoreQuarantineService(localDatabase);
    coordinator = new RecoveryCoordinatorService(
      localDatabase,
      testKeyProvider,
    );
    jobService = new RecoveryJobService(
      localDatabase,
      durableJobs,
      coordinator,
    );

    const pool = localDatabase.requirePool();
    await pool.query(
      `insert into pharmacies (id, name)
       values ('01919420-7462-723a-8b1e-7f61c312781a', $1)
       on conflict (singleton) do nothing`,
      [PHARMACY_NAME],
    );
    await pool.query(
      `insert into main_devices (id, credential_hash)
       values ('01919420-7462-723a-8b1e-7f61c312781b',
               decode('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'))
       on conflict (id) do nothing`,
    );
    await pool.query(
      `insert into pharmacy_ca (singleton, installation_id, ca_fingerprint, ca_certificate, provider_name, assurance_level)
       values (true, '01919420-7462-723a-8b1e-7f61c312781c', 'ca-fingerprint',
               '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n',
               'Microsoft Platform Crypto Provider', 'platform-tpm')
       on conflict (singleton) do nothing`,
    );
    // A terminal device record now depends on a licence installation, and
    // licence installations are immutable facts that reference the Main device.
    // Seeding one here would make the "restored dataset lost its Main device
    // records" simulation below impossible, so the device-identity hook is
    // exercised against an empty device table; the revocation-survives-restore
    // behaviour itself is proven in the devices persistence seam.
  }, 180_000);

  afterAll(async () => {
    await durableJobs?.onApplicationShutdown().catch(() => undefined);
    await localDatabase?.onApplicationShutdown().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    if (testTempDir !== undefined && existsSync(testTempDir)) {
      rmSync(testTempDir, { force: true, recursive: true });
    }
    delete process.env.BREEV_BACKUP_DIRECTORY;
  });

  it("registers the recovery queue on startup even though init hooks run concurrently", async () => {
    const pool = localDatabase.requirePool();
    const jobRuntime = new DurableJobsService(localDatabase);
    const startingService = new RecoveryJobService(
      localDatabase,
      jobRuntime,
      coordinator,
    );

    try {
      // The job runtime has not been started yet, exactly as when Nest runs
      // both initialization hooks at the same time.
      expect(jobRuntime.isAvailable()).toBe(false);
      await startingService.onModuleInit();

      const queues = await pool.query<{ name: string }>(
        "select name from pgboss.queue where name = $1",
        [RECOVERY_BACKUP_JOB_NAME],
      );
      expect(queues.rows).toHaveLength(1);
    } finally {
      await jobRuntime.onApplicationShutdown();
      await pool.query("delete from pgboss.job where name = $1", [
        RECOVERY_BACKUP_JOB_NAME,
      ]);
    }
  });

  it("observes a missed backup run and enqueues exactly one catch-up", async () => {
    const pool = localDatabase.requirePool();
    expect(
      (
        await pool.query<{ count: string }>(
          "select count(*)::text as count from recovery_points where status = 'verified'",
        )
      ).rows[0]?.count,
    ).toBe("0");

    const first = await jobService.checkAndScheduleMissedRun();
    expect(first.missedRunDetected).toBe(true);
    expect(first.lastBackupAt).toBeNull();

    // A restart loop must not queue a second catch-up run.
    await jobService.checkAndScheduleMissedRun();
    const queued = await pool.query<{ count: string }>(
      `select count(*)::text as count from pgboss.job
       where name = $1 and state in ('created', 'retry', 'active')`,
      [RECOVERY_BACKUP_JOB_NAME],
    );
    expect(queued.rows[0]?.count).toBe("1");
  });

  it("records a verified recovery point only after the stored file verifies", async () => {
    const record = await coordinator.createRecoveryPoint({
      backupType: "hourly_recovery_point",
      outputDirectory: backupOutputDir,
    });

    expect(record.status).toBe("verified");
    expect(record.completedAt).not.toBeNull();
    expect(record.manifestChecksum).toBeTruthy();
    expect(record.manifestVerifiedAt).not.toBeNull();
    expect(record.walStartLsn).toBeTruthy();
    expect(record.walEndLsn).toBeTruthy();
    expect(record.encryptedSizeBytes).toBeGreaterThan(0);
    expect(record.quarantineRequired).toBe(true);
    expect(record.encryptionMetadata?.algorithm).toBe("aes-256-gcm");

    expect(
      existsSync(path.join(backupOutputDir, `recovery_${record.id}.breev`)),
    ).toBe(true);
    // The staging directory and every temporary write are gone once the
    // recovery point is verified.
    expect(
      readdirSync(backupOutputDir).filter(
        (entry) => entry.startsWith("staging_") || entry.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("captures every application table and no partial backup reaches verified", async () => {
    const pool = localDatabase.requirePool();
    const tables = await pool.query<{ table_name: string }>(
      `select c.relname as table_name
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname`,
    );

    const archive = decryptLatestRecoveryPoint();
    const backedUpTables = Object.keys(archive.files)
      .filter((file) => file.startsWith("tables/"))
      .map((file) => file.slice("tables/".length, -".json".length))
      .sort();

    expect(backedUpTables).toEqual(
      tables.rows.map((row) => row.table_name).sort(),
    );
    expect(
      readTableRows(archive, "pharmacies").some(
        (row) => row["name"] === PHARMACY_NAME,
      ),
    ).toBe(true);
  });

  it("excludes the pharmacy CA private key and refuses a recovery point that would carry one", async () => {
    const archive = decryptLatestRecoveryPoint();
    const decoded = Object.values(archive.files)
      .map((base64) => Buffer.from(base64, "base64").toString("utf8"))
      .join("\n");

    expect(decoded).toContain(PHARMACY_NAME);
    expect(decoded).not.toContain("BEGIN PRIVATE KEY");
    expect(decoded).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(decoded).not.toContain("BEGIN EC PRIVATE KEY");

    // The exclusion is enforced, not merely observed: planting private key
    // material in a backed-up table fails the run instead of encrypting it.
    const pool = localDatabase.requirePool();
    await withSchemaOwner(async (owner) => {
      await owner.query(
        "update pharmacy_ca set ca_certificate = $1 where singleton = true",
        [CA_PRIVATE_KEY_PEM],
      );
      try {
        await expect(
          coordinator.createRecoveryPoint({ outputDirectory: backupOutputDir }),
        ).rejects.toThrow("SECURITY_VIOLATION");

        const failed = await pool.query<{
          failure_reason: string;
          status: string;
        }>(
          `select status, failure_reason from recovery_points
           order by started_at desc limit 1`,
        );
        expect(failed.rows[0]?.status).toBe("failed");
        expect(failed.rows[0]?.failure_reason).toContain("SECURITY_VIOLATION");
      } finally {
        await owner.query(
          "update pharmacy_ca set ca_certificate = $1 where singleton = true",
          ["-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"],
        );
      }
    });
  });

  it("keeps terminal recovery point outcomes immutable", async () => {
    const pool = localDatabase.requirePool();
    const verified = await pool.query<{ id: string }>(
      "select id from recovery_points where status = 'verified' limit 1",
    );
    const id = verified.rows[0]?.id;
    expect(id).toBeTruthy();

    await expect(
      pool.query(
        "update recovery_points set failure_reason = 'tampered' where id = $1",
        [id],
      ),
    ).rejects.toThrow("terminal recovery point outcomes are immutable");

    // The schema owner is subject to the same trigger, so no maintenance path
    // can quietly delete a recorded outcome. A non-terminal row still deletes,
    // which proves the trigger returns the deleted row rather than silently
    // cancelling every delete.
    await withSchemaOwner(async (owner) => {
      await expect(
        owner.query("delete from recovery_points where id = $1", [id]),
      ).rejects.toThrow("terminal recovery point outcomes are immutable");

      const inProgress = await owner.query<{ id: string }>(
        `insert into recovery_points (id, status, backup_type)
         values (uuidv7(), 'in_progress', 'hourly_recovery_point')
         returning id`,
      );
      const deleted = await owner.query(
        "delete from recovery_points where id = $1",
        [inProgress.rows[0]?.id],
      );
      expect(deleted.rowCount).toBe(1);
    });
  });

  it("refuses to restore a recovery point that is not recorded as verified", async () => {
    const pool = localDatabase.requirePool();
    const verified = await pool.query<{ id: string }>(
      "select id from recovery_points where status = 'verified' limit 1",
    );
    const sourceId = verified.rows[0]?.id ?? "";
    const sourcePath = path.join(backupOutputDir, `recovery_${sourceId}.breev`);

    const corruptedId = (
      await pool.query<{ id: string }>(
        `insert into recovery_points (id, status, backup_type, completed_at, failure_reason)
         values (uuidv7(), 'corrupted', 'hourly_recovery_point', now(), 'deliberately corrupted')
         returning id`,
      )
    ).rows[0]!.id;

    const corruptedPath = path.join(
      backupOutputDir,
      `recovery_${corruptedId}.breev`,
    );
    const payload = JSON.parse(readFileSync(sourcePath, "utf8")) as {
      recoveryId: string;
    };
    writeFileSync(
      corruptedPath,
      JSON.stringify({ ...payload, recoveryId: corruptedId }),
    );

    await expect(
      coordinator.restoreToIsolatedInstance({
        encryptedPayloadPath: corruptedPath,
        isolatedPort: postgres.getPort() + 1,
        isolatedTargetDir: path.join(testTempDir, "corrupted_restore"),
        live: {
          dataDirectory: path.join(testTempDir, "live"),
          port: postgres.getPort(),
        },
      }),
    ).rejects.toThrow("can never be restored as verified");
  });

  it("restores a verified recovery point into an isolated directory under quarantine", async () => {
    const pool = localDatabase.requirePool();
    const verified = await pool.query<{ id: string }>(
      "select id from recovery_points where status = 'verified' limit 1",
    );
    const id = verified.rows[0]!.id;
    const isolatedRestoreDir = path.join(testTempDir, "isolated_instance_data");

    const result = await coordinator.restoreToIsolatedInstance({
      encryptedPayloadPath: path.join(backupOutputDir, `recovery_${id}.breev`),
      isolatedPort: postgres.getPort() + 1,
      isolatedTargetDir: isolatedRestoreDir,
      live: {
        dataDirectory: path.join(testTempDir, "live"),
        port: postgres.getPort(),
      },
    });

    expect(result.quarantineActive).toBe(true);
    expect(result.manifestVerification.isValid).toBe(true);
    expect(result.restoredFilesCount).toBeGreaterThan(0);

    const marker = JSON.parse(
      readFileSync(
        path.join(isolatedRestoreDir, "RESTORE_QUARANTINE.flag"),
        "utf8",
      ),
    ) as { quarantined: boolean; recoveryId: string };
    expect(marker.quarantined).toBe(true);
    expect(marker.recoveryId).toBe(id);

    // Restoring a recovery point must never take the running pharmacy out of
    // normal use: the quarantine belongs to the restored dataset.
    expect(
      (await quarantineService.getQuarantineState(pool)).isQuarantined,
    ).toBe(false);
  });

  it("persists the quarantine state of a dataset across a service restart", async () => {
    const pool = localDatabase.requirePool();
    await quarantineService.enterQuarantine(
      pool,
      "Restored from recovery point",
    );

    const restarted = new RestoreQuarantineService(localDatabase);
    const state = await restarted.getQuarantineState(pool);
    expect(state.isQuarantined).toBe(true);
    expect(state.quarantineReason).toBe("Restored from recovery point");
  });

  it("refuses a restore that targets the live pharmacy cluster", async () => {
    const pool = localDatabase.requirePool();
    const id = (
      await pool.query<{ id: string }>(
        "select id from recovery_points where status = 'verified' limit 1",
      )
    ).rows[0]!.id;

    await expect(
      coordinator.restoreToIsolatedInstance({
        encryptedPayloadPath: path.join(
          backupOutputDir,
          `recovery_${id}.breev`,
        ),
        isolatedPort: postgres.getPort() + 1,
        isolatedTargetDir: path.join(testTempDir, "live", "data"),
        live: {
          dataDirectory: path.join(testTempDir, "live"),
          port: postgres.getPort(),
        },
      }),
    ).rejects.toThrow("RESTORE_SAFETY_VIOLATION");
  });

  it("clears the quarantine only after the verification hooks pass", async () => {
    const pool = localDatabase.requirePool();
    expect(
      (await quarantineService.getQuarantineState(pool)).isQuarantined,
    ).toBe(true);

    // A restored dataset that lost its Main device records stays quarantined.
    await withSchemaOwner(async (owner) => {
      const devices = await owner.query<{
        credential_hash: Buffer;
        id: string;
      }>("select id, credential_hash from main_devices");
      await owner.query("delete from main_device_sessions");
      await owner.query("delete from main_devices");

      const blocked = await quarantineService.verifyAndClearQuarantine(
        pool,
        "test_operator",
      );
      expect(blocked.overallPassed).toBe(false);
      expect(
        (await quarantineService.getQuarantineState(pool)).isQuarantined,
      ).toBe(true);

      for (const device of devices.rows) {
        await owner.query(
          "insert into main_devices (id, credential_hash) values ($1, $2)",
          [device.id, device.credential_hash],
        );
      }
    });

    const report = await quarantineService.verifyAndClearQuarantine(
      pool,
      "test_operator",
    );
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toHaveLength(3);

    const state = await quarantineService.getQuarantineState(pool);
    expect(state.isQuarantined).toBe(false);
    expect(state.clearedBy).toBe("test_operator");
    expect(state.clearedAt).not.toBeNull();
  });

  it("records a run interrupted by a killed process as failed, never verified", async () => {
    const pool = localDatabase.requirePool();
    const interrupted = (
      await pool.query<{ id: string }>(
        `insert into recovery_points (id, status, backup_type)
         values (uuidv7(), 'in_progress', 'hourly_recovery_point')
         returning id`,
      )
    ).rows[0]!.id;

    expect(await jobService.failInterruptedRuns()).toBeGreaterThanOrEqual(1);
    const recorded = await pool.query<{
      failure_reason: string;
      status: string;
    }>("select status, failure_reason from recovery_points where id = $1", [
      interrupted,
    ]);
    expect(recorded.rows[0]?.status).toBe("failed");
    expect(recorded.rows[0]?.failure_reason).toContain(
      "stopped before this recovery point was verified",
    );

    // A recent verified recovery point means no catch-up run is needed.
    expect(
      (await jobService.checkAndScheduleMissedRun()).missedRunDetected,
    ).toBe(false);
  });

  it("returns the existing recovery point when a duplicate job run repeats an identity", async () => {
    const pool = localDatabase.requirePool();
    const original = await coordinator.createRecoveryPoint({
      outputDirectory: backupOutputDir,
    });

    const duplicate = await coordinator.createRecoveryPoint({
      outputDirectory: backupOutputDir,
      recoveryPointId: original.id,
    });

    expect(duplicate.id).toBe(original.id);
    expect(duplicate.completedAt?.toISOString()).toBe(
      original.completedAt?.toISOString(),
    );
    const count = await pool.query<{ count: string }>(
      "select count(*)::text as count from recovery_points where id = $1",
      [original.id],
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  /**
   * The application role is deliberately unable to rewrite CA rows or delete
   * device records, so state the application must never reach is arranged
   * through the schema owner instead of by weakening a grant.
   */
  async function withSchemaOwner<T>(
    run: (owner: Pool) => Promise<T>,
  ): Promise<T> {
    const owner = new Pool({ connectionString: databaseRoles.migrationUrl });
    try {
      return await run(owner);
    } finally {
      await owner.end();
    }
  }

  function decryptLatestRecoveryPoint(): { files: Record<string, string> } {
    const latest = readdirSync(backupOutputDir)
      .filter((entry) => entry.endsWith(".breev"))
      .sort()
      .at(-1);
    const raw = JSON.parse(
      readFileSync(path.join(backupOutputDir, latest ?? ""), "utf8"),
    ) as { ciphertextHex: string; metadata: never };

    return JSON.parse(
      decryptRecoveryPayload({
        ciphertext: Buffer.from(raw.ciphertextHex, "hex"),
        key: testKey,
        metadata: raw.metadata,
      }).toString("utf8"),
    ) as { files: Record<string, string> };
  }

  function readTableRows(
    archive: { files: Record<string, string> },
    table: string,
  ): Array<Record<string, unknown>> {
    const encoded = archive.files[`tables/${table}.json`];
    expect(encoded).toBeTruthy();
    return JSON.parse(
      Buffer.from(encoded ?? "", "base64").toString("utf8"),
    ) as Array<Record<string, unknown>>;
  }
});
