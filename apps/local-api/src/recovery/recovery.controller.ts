import {
  localRecoveryStatusContract,
  type LocalRecoveryStatusSuccess,
} from "@breev/contracts/local-rest";
import { Controller, Get, Inject } from "@nestjs/common";

import { LocalDatabaseService } from "../local-database.service.js";
import { RestoreQuarantineService } from "./restore-quarantine.service.js";

/**
 * Read-only recovery observability. Backup runs are started by the durable job
 * and quarantine clears only when the verification hooks pass, so this
 * transport exposes no operation that could write a file, start a backup, or
 * release a quarantined dataset.
 */
@Controller()
export class RecoveryController {
  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(RestoreQuarantineService)
    private readonly quarantineService: RestoreQuarantineService,
  ) {}

  @Get(localRecoveryStatusContract.path)
  public async getRecoveryStatus(): Promise<LocalRecoveryStatusSuccess> {
    const pool = this.localDatabase.requirePool();
    const latest = await pool.query<{
      backup_type: "hourly_recovery_point" | "daily_snapshot";
      completed_at: Date | null;
      encrypted_size_bytes: string | number | null;
      id: string;
      manifest_verified_at: Date | null;
      started_at: Date;
      status: "in_progress" | "verified" | "failed" | "corrupted";
      wal_end_lsn: string | null;
      wal_start_lsn: string | null;
    }>(
      `select id, started_at, completed_at, status, backup_type,
              encrypted_size_bytes, manifest_verified_at, wal_start_lsn, wal_end_lsn
       from recovery_points
       order by started_at desc
       limit 1`,
    );

    const quarantine = await this.quarantineService.getQuarantineState(pool);
    const row = latest.rows[0];

    return {
      latestRecoveryPoint:
        row === undefined
          ? null
          : {
              backupType: row.backup_type,
              completedAt: row.completed_at?.toISOString() ?? null,
              encryptedSizeBytes:
                row.encrypted_size_bytes == null
                  ? null
                  : Number(row.encrypted_size_bytes),
              id: row.id,
              manifestVerifiedAt:
                row.manifest_verified_at?.toISOString() ?? null,
              startedAt: row.started_at.toISOString(),
              status: row.status,
              walEndLsn: row.wal_end_lsn,
              walStartLsn: row.wal_start_lsn,
            },
      quarantine: {
        clearedAt: quarantine.clearedAt?.toISOString() ?? null,
        isQuarantined: quarantine.isQuarantined,
        quarantineReason: quarantine.quarantineReason,
        quarantinedAt: quarantine.quarantinedAt?.toISOString() ?? null,
      },
    };
  }
}
