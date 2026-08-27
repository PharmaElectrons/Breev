import {
  bigint,
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const recoveryPointStatusEnum = pgEnum("recovery_point_status", [
  "in_progress",
  "verified",
  "failed",
  "corrupted",
]);

export const recoveryBackupTypeEnum = pgEnum("recovery_backup_type", [
  "hourly_recovery_point",
  "daily_snapshot",
]);

export interface RecoveryEncryptionMetadata {
  readonly algorithm: "aes-256-gcm";
  readonly authTagHex: string;
  readonly ivHex: string;
  readonly keyIdentifier: string;
  readonly keyProtectionLevel:
    "platform-tpm" | "software-cng" | "software-test";
  readonly wrappedKeyHex: string;
}

export interface SystemQuarantineVerificationReport {
  readonly checks: Array<{
    readonly details?: string | undefined;
    readonly name: string;
    readonly passed: boolean;
  }>;
  readonly completedAt: string;
  readonly overallPassed: boolean;
}

export const recoveryPoints = pgTable("recovery_points", {
  id: uuid("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: recoveryPointStatusEnum("status").default("in_progress").notNull(),
  backupType: recoveryBackupTypeEnum("backup_type")
    .default("hourly_recovery_point")
    .notNull(),
  encryptedSizeBytes: bigint("encrypted_size_bytes", { mode: "number" }),
  manifestChecksum: text("manifest_checksum"),
  manifestVerifiedAt: timestamp("manifest_verified_at", { withTimezone: true }),
  walStartLsn: text("wal_start_lsn"),
  walEndLsn: text("wal_end_lsn"),
  archiveFormat: text("archive_format")
    .default("breev_encrypted_archive")
    .notNull(),
  encryptionMetadata: jsonb(
    "encryption_metadata",
  ).$type<RecoveryEncryptionMetadata>(),
  quarantineRequired: boolean("quarantine_required").default(true).notNull(),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const systemQuarantineState = pgTable("system_quarantine_state", {
  singleton: boolean("singleton").primaryKey().default(true),
  isQuarantined: boolean("is_quarantined").default(false).notNull(),
  quarantineReason: text("quarantine_reason"),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  clearedBy: text("cleared_by"),
  verificationReport: jsonb(
    "verification_report",
  ).$type<SystemQuarantineVerificationReport>(),
});

export type RecoveryPointRecord = typeof recoveryPoints.$inferSelect;
export type InsertRecoveryPointRecord = typeof recoveryPoints.$inferInsert;

export type SystemQuarantineRecord = typeof systemQuarantineState.$inferSelect;
export type InsertSystemQuarantineRecord =
  typeof systemQuarantineState.$inferInsert;
