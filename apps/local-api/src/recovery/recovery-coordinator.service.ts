import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

import { LocalDatabaseService } from "../local-database.service.js";
import { syncFile, writeFileDurably } from "./durable-file.js";
import {
  BACKUP_MANIFEST_FILE_NAME,
  createBackupManifest,
  verifyBackupManifest,
  type ManifestVerificationResult,
} from "./manifest-verifier.js";
import {
  decryptRecoveryPayload,
  DEFAULT_RECOVERY_KEY_IDENTIFIER,
  encryptRecoveryPayload,
  type RecoveryKeyProvider,
} from "./recovery-crypto.js";
import { RECOVERY_KEY_PROVIDER } from "./recovery-key-provider.js";
import {
  type RecoveryEncryptionMetadata,
  type RecoveryPointRecord,
} from "./recovery-schema.js";
import {
  assertStrictRestoreIsolation,
  type LiveClusterIdentity,
} from "./restore-isolation.js";
import { RESTORE_QUARANTINE_MARKER_FILE_NAME } from "./restore-quarantine.service.js";

export interface CreateRecoveryPointOptions {
  readonly backupType?: "hourly_recovery_point" | "daily_snapshot" | undefined;
  readonly keyIdentifier?: string | undefined;
  readonly outputDirectory: string;
  /**
   * Identity of the recovery point being produced. A durable job passes a
   * stable value so a retried or duplicated run resumes the same recovery
   * point instead of creating a second one.
   */
  readonly recoveryPointId?: string | undefined;
}

export interface RestoreRecoveryPointOptions {
  readonly encryptedPayloadPath: string;
  readonly isolatedPort: number;
  readonly isolatedTargetDir: string;
  readonly live: LiveClusterIdentity;
}

export interface RestoreResult {
  readonly isolatedDataDir: string;
  readonly manifestVerification: ManifestVerificationResult;
  readonly quarantineActive: boolean;
  readonly recoveryPointId: string;
  readonly restoredFilesCount: number;
}

interface RecoveryArchive {
  readonly files: Record<string, string>;
}

/** File names inside a recovery point that verification does not account for. */
const UNMANIFESTED_RESTORE_FILES = [RESTORE_QUARANTINE_MARKER_FILE_NAME];

const PEM_PRIVATE_KEY_MARKERS = [
  "BEGIN PRIVATE KEY",
  "BEGIN RSA PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "BEGIN DSA PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN ENCRYPTED PRIVATE KEY",
];

@Injectable()
export class RecoveryCoordinatorService {
  private readonly logger = new Logger(RecoveryCoordinatorService.name);

  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(RECOVERY_KEY_PROVIDER)
    private readonly readRecoveryKey: RecoveryKeyProvider,
  ) {}

  /**
   * Produces one encrypted, verified recovery point.
   *
   * The recovery point only reaches `verified` after the encrypted file that
   * was actually written to disk has been read back, decrypted, and verified
   * against its manifest, and after those bytes are durable. A process killed
   * at any earlier point leaves the recovery point in `in_progress`, which the
   * next start reports as a failed run.
   */
  public async createRecoveryPoint(
    options: CreateRecoveryPointOptions,
  ): Promise<RecoveryPointRecord> {
    const pool = this.localDatabase.requirePool();
    const {
      backupType = "hourly_recovery_point",
      keyIdentifier = DEFAULT_RECOVERY_KEY_IDENTIFIER,
      outputDirectory,
    } = options;

    const resolvedOutputDir = path.resolve(outputDirectory);
    mkdirSync(resolvedOutputDir, { recursive: true });

    const claim = await this.claimRecoveryPoint(
      pool,
      options.recoveryPointId,
      backupType,
    );
    if (claim.alreadyVerified !== undefined) {
      return claim.alreadyVerified;
    }
    const recoveryPointId = claim.recoveryPointId;
    const stagingDir = path.join(
      resolvedOutputDir,
      `staging_${recoveryPointId}`,
    );

    let client: PoolClient | undefined;
    try {
      rmSync(stagingDir, { force: true, recursive: true });
      mkdirSync(stagingDir, { recursive: true });
      client = await pool.connect();

      const key = this.readRecoveryKey(keyIdentifier);
      const cluster = await readClusterState(client);
      const walStartLsn = cluster.currentLsn;

      await this.exportDatabaseBackupData(client, stagingDir, {
        systemIdentifier: cluster.systemIdentifier,
        timeline: cluster.timeline,
        walStartLsn,
      });

      const walEndLsn = (await readClusterState(client)).currentLsn;

      const stagedManifest = verifyBackupManifest(stagingDir);
      if (!stagedManifest.isValid) {
        throw new Error(
          `MANIFEST_VERIFICATION_FAILED: ${stagedManifest.violations.join("; ")}`,
        );
      }

      const archiveBuffer = this.packDirectoryToBuffer(stagingDir);
      assertNoPlaintextKeyMaterial(archiveBuffer);

      const encrypted = encryptRecoveryPayload(
        archiveBuffer,
        keyIdentifier,
        key,
      );
      const recoveryFilePath = path.join(
        resolvedOutputDir,
        `recovery_${recoveryPointId}.breev`,
      );
      writeFileDurably(
        recoveryFilePath,
        JSON.stringify({
          ciphertextHex: encrypted.ciphertext.toString("hex"),
          metadata: encrypted.metadata,
          recoveryId: recoveryPointId,
        }),
        recoveryPointId,
      );

      const storedManifest = this.verifyStoredRecoveryPoint(
        recoveryFilePath,
        stagedManifest.manifestChecksum,
        keyIdentifier,
      );

      const updated = await pool.query<RawRecoveryPointRow>(
        `update recovery_points
         set completed_at = now(),
             status = 'verified',
             encrypted_size_bytes = $1,
             manifest_checksum = $2,
             manifest_verified_at = now(),
             wal_start_lsn = $3,
             wal_end_lsn = $4,
             encryption_metadata = $5
         where id = $6 and status = 'in_progress'
         returning *`,
        [
          statSync(recoveryFilePath).size,
          storedManifest.manifestChecksum,
          walStartLsn,
          walEndLsn,
          JSON.stringify(encrypted.metadata),
          recoveryPointId,
        ],
      );

      const rawRecord = updated.rows[0];
      if (rawRecord === undefined) {
        throw new Error(
          `Recovery point ${recoveryPointId} left the in-progress state before verification completed`,
        );
      }

      rmSync(stagingDir, { force: true, recursive: true });
      this.logger.log(
        `Verified recovery point ${recoveryPointId} (${String(rawRecord.encrypted_size_bytes)} bytes)`,
      );
      return mapRecoveryPointRow(rawRecord);
    } catch (error) {
      await this.recordFailure(pool, recoveryPointId, error);
      rmSync(stagingDir, { force: true, recursive: true });
      throw error;
    } finally {
      client?.release();
    }
  }

  /**
   * Restores a verified recovery point into an isolated directory that is
   * structurally separated from the live pharmacy cluster, and marks the
   * restored dataset as quarantined before any restored byte lands.
   *
   * The quarantine marker belongs to the restored dataset. The live pharmacy
   * dataset is never touched: restoring a recovery point must not take the
   * running pharmacy out of normal use.
   */
  public async restoreToIsolatedInstance(
    options: RestoreRecoveryPointOptions,
  ): Promise<RestoreResult> {
    const { encryptedPayloadPath, isolatedPort, isolatedTargetDir, live } =
      options;

    assertStrictRestoreIsolation({
      live,
      targetDataDir: isolatedTargetDir,
      targetPort: isolatedPort,
    });

    const resolvedPayload = path.resolve(encryptedPayloadPath);
    if (!existsSync(resolvedPayload)) {
      throw new Error(`Recovery point file not found at "${resolvedPayload}"`);
    }

    const payload = readEncryptedPayloadFile(resolvedPayload);
    const recorded = await this.requireVerifiedRecoveryPoint(
      payload.recoveryId,
    );

    const key = this.readRecoveryKey(payload.metadata.keyIdentifier);
    const archiveBuffer = decryptRecoveryPayload({
      ciphertext: payload.ciphertext,
      key,
      metadata: payload.metadata,
    });

    const resolvedTarget = path.resolve(isolatedTargetDir);
    mkdirSync(resolvedTarget, { recursive: true });

    // The quarantine marker is written and flushed before any restored data so
    // that a crash during the restore can never leave restored data behind
    // without its quarantine state.
    writeFileDurably(
      path.join(resolvedTarget, RESTORE_QUARANTINE_MARKER_FILE_NAME),
      JSON.stringify({
        quarantined: true,
        quarantinedAt: new Date().toISOString(),
        recoveryId: payload.recoveryId,
      }),
      payload.recoveryId,
    );

    const restoredFilesCount = this.unpackBufferToDirectory(
      archiveBuffer,
      resolvedTarget,
    );

    const manifestVerification = verifyBackupManifest(resolvedTarget, {
      ignoredPaths: UNMANIFESTED_RESTORE_FILES,
    });
    if (!manifestVerification.isValid) {
      throw new Error(
        `RESTORE_VERIFICATION_FAILED: ${manifestVerification.violations.join("; ")}`,
      );
    }
    if (manifestVerification.manifestChecksum !== recorded.manifestChecksum) {
      throw new Error(
        `RESTORE_VERIFICATION_FAILED: Restored manifest checksum ${manifestVerification.manifestChecksum} does not match the recorded checksum for recovery point ${payload.recoveryId}`,
      );
    }

    return {
      isolatedDataDir: resolvedTarget,
      manifestVerification,
      quarantineActive: true,
      recoveryPointId: payload.recoveryId,
      restoredFilesCount,
    };
  }

  /**
   * Inserts the in-progress record for a recovery point. A durable job that
   * runs twice with the same identity finds the existing record: an already
   * verified recovery point is returned unchanged, and a terminal failure is
   * never silently retried under the same identity.
   */
  private async claimRecoveryPoint(
    pool: Pool,
    requestedId: string | undefined,
    backupType: "hourly_recovery_point" | "daily_snapshot",
  ): Promise<{
    alreadyVerified?: RecoveryPointRecord;
    recoveryPointId: string;
  }> {
    const inserted = await pool.query<RawRecoveryPointRow>(
      `insert into recovery_points (id, started_at, status, backup_type, quarantine_required)
       values (coalesce($1::uuid, uuidv7()), now(), 'in_progress', $2, true)
       on conflict (id) do nothing
       returning *`,
      [requestedId ?? null, backupType],
    );
    const claimed = inserted.rows[0];
    if (claimed !== undefined) {
      return { recoveryPointId: claimed.id };
    }

    const existing = await pool.query<RawRecoveryPointRow>(
      "select * from recovery_points where id = $1",
      [requestedId],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error(
        `Recovery point ${String(requestedId)} could not be claimed or read`,
      );
    }
    if (row.status === "verified") {
      this.logger.log(
        `Recovery point ${row.id} is already verified; skipping the duplicate run`,
      );
      return {
        alreadyVerified: mapRecoveryPointRow(row),
        recoveryPointId: row.id,
      };
    }
    throw new Error(
      `Recovery point ${row.id} already exists with status "${row.status}"`,
    );
  }

  private async requireVerifiedRecoveryPoint(
    recoveryPointId: string,
  ): Promise<{ manifestChecksum: string }> {
    const pool = this.localDatabase.requirePool();
    const result = await pool.query<{
      manifest_checksum: string | null;
      status: RawRecoveryPointRow["status"];
    }>("select status, manifest_checksum from recovery_points where id = $1", [
      recoveryPointId,
    ]);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(
        `RESTORE_VERIFICATION_FAILED: Recovery point ${recoveryPointId} has no recorded outcome`,
      );
    }
    if (row.status !== "verified" || row.manifest_checksum === null) {
      throw new Error(
        `RESTORE_VERIFICATION_FAILED: Recovery point ${recoveryPointId} is recorded as "${row.status}" and can never be restored as verified`,
      );
    }
    return { manifestChecksum: row.manifest_checksum };
  }

  private async recordFailure(
    pool: Pool,
    recoveryPointId: string,
    error: unknown,
  ): Promise<void> {
    const failureReason =
      error instanceof Error ? error.message : String(error);
    const status = failureReason.includes("MANIFEST_VERIFICATION_FAILED")
      ? "corrupted"
      : "failed";
    try {
      await pool.query(
        `update recovery_points
         set completed_at = now(), status = $1, failure_reason = $2
         where id = $3 and status = 'in_progress'`,
        [status, failureReason, recoveryPointId],
      );
    } catch (recordingError) {
      this.logger.error(
        `Could not record the failed outcome of recovery point ${recoveryPointId}`,
        recordingError,
      );
    }
  }

  /**
   * Reads the encrypted recovery point back from disk, decrypts it, and
   * verifies its manifest. Verification of the file that was actually stored
   * is the only evidence that permits the transition to `verified`.
   */
  private verifyStoredRecoveryPoint(
    recoveryFilePath: string,
    expectedManifestChecksum: string,
    keyIdentifier: string,
  ): ManifestVerificationResult {
    const payload = readEncryptedPayloadFile(recoveryFilePath);
    const key = this.readRecoveryKey(keyIdentifier);
    const archiveBuffer = decryptRecoveryPayload({
      ciphertext: payload.ciphertext,
      key,
      metadata: payload.metadata,
    });

    const verifyDir = `${recoveryFilePath}.verify`;
    try {
      rmSync(verifyDir, { force: true, recursive: true });
      mkdirSync(verifyDir, { recursive: true });
      this.unpackBufferToDirectory(archiveBuffer, verifyDir);
      const result = verifyBackupManifest(verifyDir);
      if (!result.isValid) {
        throw new Error(
          `MANIFEST_VERIFICATION_FAILED: The stored recovery point failed verification: ${result.violations.join("; ")}`,
        );
      }
      if (result.manifestChecksum !== expectedManifestChecksum) {
        throw new Error(
          "MANIFEST_VERIFICATION_FAILED: The stored recovery point does not carry the manifest that was verified",
        );
      }
      return result;
    } finally {
      rmSync(verifyDir, { force: true, recursive: true });
    }
  }

  /**
   * Copies the application tables into the staging directory and records them
   * in the backup manifest. A table that cannot be read fails the whole
   * recovery point: a backup that silently omits pharmacy data must never be
   * recorded as verified.
   */
  private async exportDatabaseBackupData(
    client: PoolClient,
    stagingDir: string,
    cluster: {
      systemIdentifier: string;
      timeline: number;
      walStartLsn: string;
    },
  ): Promise<void> {
    const tables = await client.query<{ table_name: string }>(
      `select c.relname as table_name
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname`,
    );

    const files: Array<{ data: Buffer; relativePath: string }> = [];
    for (const { table_name: tableName } of tables.rows) {
      if (!/^[a-z_][a-z0-9_]*$/u.test(tableName)) {
        throw new Error(
          `Refusing to back up a table with an unsupported name: "${tableName}"`,
        );
      }
      const rows = await client.query(`select * from "${tableName}"`);
      const data = Buffer.from(JSON.stringify(rows.rows, null, 2), "utf8");
      const relativePath = `tables/${tableName}.json`;
      const fullPath = path.join(stagingDir, relativePath);
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, data);
      syncFile(fullPath);
      files.push({ data, relativePath });
    }

    if (files.length === 0) {
      throw new Error("The backup found no application tables to record");
    }

    const { manifestJson } = createBackupManifest({
      files,
      systemIdentifier: cluster.systemIdentifier,
      timeline: cluster.timeline,
      walEndLsn: cluster.walStartLsn,
      walStartLsn: cluster.walStartLsn,
    });
    const manifestPath = path.join(stagingDir, BACKUP_MANIFEST_FILE_NAME);
    writeFileSync(manifestPath, manifestJson, "utf8");
    syncFile(manifestPath);
  }

  private packDirectoryToBuffer(dir: string): Buffer {
    const files: Record<string, string> = {};
    const walk = (currentDir: string): void => {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const relative = path.relative(dir, full).split(path.sep).join("/");
          files[relative] = readFileSync(full, "base64");
        }
      }
    };
    walk(dir);
    return Buffer.from(JSON.stringify({ files } satisfies RecoveryArchive));
  }

  private unpackBufferToDirectory(buffer: Buffer, targetDir: string): number {
    const archive = JSON.parse(buffer.toString("utf8")) as RecoveryArchive;
    const resolvedTarget = path.resolve(targetDir);
    let count = 0;

    for (const [relativePath, base64Data] of Object.entries(archive.files)) {
      const fullPath = path.resolve(resolvedTarget, relativePath);
      const relativeToTarget = path.relative(resolvedTarget, fullPath);
      if (
        relativeToTarget.startsWith("..") ||
        path.isAbsolute(relativeToTarget)
      ) {
        throw new Error(
          `RESTORE_VERIFICATION_FAILED: The recovery point contains a path outside the restore directory: "${relativePath}"`,
        );
      }
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, Buffer.from(base64Data, "base64"));
      count += 1;
    }
    return count;
  }
}

/**
 * Rejects a recovery point whose content carries private key material. The
 * archive stores each file base64 encoded, so the check must run over the
 * decoded bytes; scanning the encoded archive would never match anything.
 */
function assertNoPlaintextKeyMaterial(archiveBuffer: Buffer): void {
  const archive = JSON.parse(archiveBuffer.toString("utf8")) as RecoveryArchive;
  for (const [relativePath, base64Data] of Object.entries(archive.files)) {
    const decoded = Buffer.from(base64Data, "base64").toString("latin1");
    for (const marker of PEM_PRIVATE_KEY_MARKERS) {
      if (decoded.includes(marker)) {
        throw new Error(
          `SECURITY_VIOLATION: Private key material found in recovery point content at "${relativePath}"`,
        );
      }
    }
  }
}

function readEncryptedPayloadFile(filePath: string): {
  ciphertext: Buffer;
  metadata: RecoveryEncryptionMetadata;
  recoveryId: string;
} {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    ciphertextHex?: unknown;
    metadata?: unknown;
    recoveryId?: unknown;
  };
  if (
    typeof raw.ciphertextHex !== "string" ||
    typeof raw.recoveryId !== "string" ||
    typeof raw.metadata !== "object" ||
    raw.metadata === null
  ) {
    throw new Error(
      `RESTORE_VERIFICATION_FAILED: "${filePath}" is not a Breev recovery point`,
    );
  }
  return {
    ciphertext: Buffer.from(raw.ciphertextHex, "hex"),
    metadata: raw.metadata as RecoveryEncryptionMetadata,
    recoveryId: raw.recoveryId,
  };
}

async function readClusterState(client: PoolClient): Promise<{
  currentLsn: string;
  systemIdentifier: string;
  timeline: number;
}> {
  const result = await client.query<{
    current_lsn: string;
    system_identifier: string;
    timeline: number;
  }>(
    `select pg_current_wal_lsn()::text as current_lsn,
            (select system_identifier::text from pg_control_system()) as system_identifier,
            (select timeline_id from pg_control_checkpoint()) as timeline`,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("PostgreSQL did not report its write-ahead log state");
  }
  return {
    currentLsn: row.current_lsn,
    systemIdentifier: row.system_identifier,
    timeline: Number(row.timeline),
  };
}

interface RawRecoveryPointRow {
  readonly archive_format: string;
  readonly backup_type: "hourly_recovery_point" | "daily_snapshot";
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly encrypted_size_bytes: string | number | null;
  readonly encryption_metadata: unknown;
  readonly failure_reason: string | null;
  readonly id: string;
  readonly manifest_checksum: string | null;
  readonly manifest_verified_at: Date | null;
  readonly quarantine_required: boolean;
  readonly started_at: Date;
  readonly status: "in_progress" | "verified" | "failed" | "corrupted";
  readonly wal_end_lsn: string | null;
  readonly wal_start_lsn: string | null;
}

function mapRecoveryPointRow(row: RawRecoveryPointRow): RecoveryPointRecord {
  return {
    archiveFormat: row.archive_format,
    backupType: row.backup_type,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    encryptedSizeBytes:
      row.encrypted_size_bytes != null
        ? Number(row.encrypted_size_bytes)
        : null,
    encryptionMetadata:
      row.encryption_metadata as RecoveryPointRecord["encryptionMetadata"],
    failureReason: row.failure_reason,
    id: row.id,
    manifestChecksum: row.manifest_checksum,
    manifestVerifiedAt: row.manifest_verified_at,
    quarantineRequired: row.quarantine_required,
    startedAt: row.started_at,
    status: row.status,
    walEndLsn: row.wal_end_lsn,
    walStartLsn: row.wal_start_lsn,
  };
}
