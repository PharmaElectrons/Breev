import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import { LocalDatabaseService } from "../local-database.service.js";
import { RecoveryCoordinatorService } from "./recovery-coordinator.service.js";
import { RestoreQuarantineService } from "./restore-quarantine.service.js";

@Controller("api/v1")
export class RecoveryController {
  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(RecoveryCoordinatorService)
    private readonly coordinator: RecoveryCoordinatorService,
    @Inject(RestoreQuarantineService)
    private readonly quarantineService: RestoreQuarantineService,
  ) {}

  @Get("recovery/status")
  public async getRecoveryStatus() {
    const pool = this.localDatabase.requirePool();
    const latestRes = await pool.query(
      `select id, started_at, completed_at, status, backup_type,
              encrypted_size_bytes, manifest_verified_at, wal_start_lsn, wal_end_lsn
       from recovery_points
       order by started_at desc
       limit 1`,
    );

    const quarantine = await this.quarantineService.getQuarantineState(pool);

    return {
      latestRecoveryPoint: latestRes.rows[0] ?? null,
      quarantine,
    };
  }

  @Post("recovery/points")
  @HttpCode(HttpStatus.ACCEPTED)
  public async triggerRecoveryPoint(
    @Body()
    body: {
      backupType?: "hourly_recovery_point" | "daily_snapshot";
      outputDirectory?: string;
      walArchiveDirectory?: string;
    },
  ) {
    const outputDirectory =
      body.outputDirectory ?? "C:/ProgramData/Breev/Backups";
    const walArchiveDirectory =
      body.walArchiveDirectory ?? "C:/ProgramData/Breev/WalArchive";

    const record = await this.coordinator.createRecoveryPoint({
      backupType: body.backupType,
      outputDirectory,
      walArchiveDirectory,
    });

    return {
      backupType: record.backupType,
      completedAt: record.completedAt?.toISOString() ?? null,
      encryptedSizeBytes: record.encryptedSizeBytes,
      id: record.id,
      startedAt: record.startedAt.toISOString(),
      status: record.status,
    };
  }

  @Post("quarantine/verify")
  @HttpCode(HttpStatus.OK)
  public async verifyAndClearQuarantine(@Body() body: { clearedBy?: string }) {
    const pool = this.localDatabase.requirePool();
    const report = await this.quarantineService.verifyAndClearQuarantine(
      pool,
      body.clearedBy ?? "operator_recovery_verification",
    );

    return {
      cleared: report.overallPassed,
      report,
    };
  }
}
