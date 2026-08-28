import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { RecoveryCoordinatorService } from "./recovery-coordinator.service.js";

/**
 * pg-boss queue names accept only word characters, hyphens, periods, and
 * forward slashes.
 */
export const RECOVERY_BACKUP_JOB_NAME = "recovery.create-recovery-point";

/**
 * How stale the newest verified recovery point may be before a start reports a
 * missed run. Automating the recurring cadence itself belongs to the retention
 * work, not to this foundation.
 */
export const RECOVERY_POINT_MAX_AGE_MS = 60 * 60 * 1000;

const RECOVERY_JOB_EXPIRE_SECONDS = 900;

export interface RecoveryJobPayload {
  readonly backupType: "hourly_recovery_point" | "daily_snapshot";
  /**
   * Identity of the recovery point this job produces. It travels with the job
   * so a retry or a duplicate delivery resumes the same recovery point instead
   * of creating a second one.
   */
  readonly recoveryPointId: string;
}

@Injectable()
export class RecoveryJobService implements OnModuleInit {
  private readonly logger = new Logger(RecoveryJobService.name);
  private readonly backupDirectory = process.env.BREEV_BACKUP_DIRECTORY?.trim();

  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(DurableJobsService)
    private readonly durableJobs: DurableJobsService,
    @Inject(RecoveryCoordinatorService)
    private readonly coordinator: RecoveryCoordinatorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (
      this.backupDirectory === undefined ||
      this.backupDirectory.length === 0
    ) {
      this.logger.warn(
        "BREEV_BACKUP_DIRECTORY is not configured, so no recovery points will be produced",
      );
      return;
    }

    // Nest runs module initialization hooks concurrently, so the job runtime
    // must be awaited rather than probed: probing it here would silently skip
    // the recovery queue on every start.
    await this.durableJobs.ensureStarted();
    if (!this.durableJobs.isAvailable()) {
      return;
    }

    await this.durableJobs.ensureQueue(RECOVERY_BACKUP_JOB_NAME, {
      expireInSeconds: RECOVERY_JOB_EXPIRE_SECONDS,
      retryBackoff: true,
      retryDelay: 10,
      retryLimit: 3,
    });

    await this.durableJobs.work<RecoveryJobPayload>(
      RECOVERY_BACKUP_JOB_NAME,
      async (job) => {
        await this.coordinator.createRecoveryPoint({
          backupType: job.data.backupType,
          outputDirectory: this.requireBackupDirectory(),
          recoveryPointId: job.data.recoveryPointId,
        });
      },
    );

    await this.failInterruptedRuns();
    await this.checkAndScheduleMissedRun();
  }

  /**
   * Records recovery points that a killed process left in progress as failed
   * runs. The database can only reach this state through a crash, because
   * every other path completes the record before returning.
   */
  public async failInterruptedRuns(): Promise<number> {
    const pool = this.localDatabase.requirePool();
    const result = await pool.query(
      `update recovery_points
       set status = 'failed',
           completed_at = now(),
           failure_reason = 'The service stopped before this recovery point was verified'
       where status = 'in_progress'`,
    );

    const interrupted = result.rowCount ?? 0;
    if (interrupted > 0) {
      this.logger.warn(
        `Recorded ${String(interrupted)} interrupted recovery point run(s) as failed`,
      );
    }
    return interrupted;
  }

  /**
   * Reports whether the newest verified recovery point is too old and enqueues
   * exactly one catch-up run when it is. The singleton key makes a restart
   * loop or a duplicate start converge on one queued run.
   */
  public async checkAndScheduleMissedRun(): Promise<{
    lastBackupAt: Date | null;
    missedRunDetected: boolean;
  }> {
    const pool = this.localDatabase.requirePool();
    const result = await pool.query<{ completed_at: Date | null }>(
      `select completed_at
       from recovery_points
       where status = 'verified'
       order by completed_at desc
       limit 1`,
    );

    const lastBackupAt = result.rows[0]?.completed_at ?? null;
    const missedRunDetected =
      lastBackupAt === null ||
      Date.now() - lastBackupAt.getTime() > RECOVERY_POINT_MAX_AGE_MS;

    if (!missedRunDetected) {
      return { lastBackupAt, missedRunDetected };
    }

    this.logger.warn(
      lastBackupAt === null
        ? "Missed backup run: no verified recovery point exists. Scheduling a catch-up run."
        : `Missed backup run: the newest verified recovery point is ${String(Math.round((Date.now() - lastBackupAt.getTime()) / 60_000))} minutes old. Scheduling a catch-up run.`,
    );

    const identity = await pool.query<{ id: string }>(
      "select uuidv7()::text as id",
    );
    const recoveryPointId = identity.rows[0]?.id;
    if (recoveryPointId === undefined) {
      throw new Error("PostgreSQL did not issue a recovery point identifier");
    }

    await this.durableJobs.send<RecoveryJobPayload>(
      RECOVERY_BACKUP_JOB_NAME,
      { backupType: "hourly_recovery_point", recoveryPointId },
      {
        expireInSeconds: RECOVERY_JOB_EXPIRE_SECONDS,
        singletonKey: "recovery_point_catchup",
        singletonSeconds: RECOVERY_JOB_EXPIRE_SECONDS,
      },
    );

    return { lastBackupAt, missedRunDetected };
  }

  private requireBackupDirectory(): string {
    if (
      this.backupDirectory === undefined ||
      this.backupDirectory.length === 0
    ) {
      throw new Error(
        "BREEV_BACKUP_DIRECTORY must name the directory that holds encrypted recovery points",
      );
    }
    return this.backupDirectory;
  }
}
