import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { RecoveryCoordinatorService } from "./recovery-coordinator.service.js";

export const RECOVERY_BACKUP_JOB_NAME = "breev:recovery:create-recovery-point";
export const HOURLY_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface RecoveryJobPayload {
  readonly backupType?: "hourly_recovery_point" | "daily_snapshot";
  readonly outputDirectory: string;
  readonly walArchiveDirectory: string;
}

@Injectable()
export class RecoveryJobService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RecoveryJobService.name);
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(DurableJobsService)
    private readonly durableJobs: DurableJobsService,
    @Inject(RecoveryCoordinatorService)
    private readonly coordinator: RecoveryCoordinatorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!this.durableJobs.isAvailable()) {
      return;
    }

    // Register queue and worker for recovery backups
    await this.durableJobs.ensureQueue(RECOVERY_BACKUP_JOB_NAME, {
      expireInSeconds: 300, // 5 min
      retryBackoff: true,
      retryDelay: 10,
      retryLimit: 3,
    });

    await this.durableJobs.work<RecoveryJobPayload>(
      RECOVERY_BACKUP_JOB_NAME,
      async (job) => {
        this.logger.log(`Processing recovery backup job: ${job.id}`);
        await this.coordinator.createRecoveryPoint({
          backupType: job.data.backupType ?? "hourly_recovery_point",
          outputDirectory: job.data.outputDirectory,
          walArchiveDirectory: job.data.walArchiveDirectory,
        });
      },
    );

    // Startup check: Detect missed scheduled runs and catch up
    await this.checkAndScheduleMissedRun();
  }

  /**
   * Checks the timestamp of the last completed verified backup.
   * If older than 1 hour (or none exists), triggers an immediate catch-up backup job.
   */
  public async checkAndScheduleMissedRun(
    defaultOutputDir = "C:/ProgramData/Breev/Backups",
    defaultWalDir = "C:/ProgramData/Breev/WalArchive",
  ): Promise<{ missedRunDetected: boolean; lastBackupAt: Date | null }> {
    const pool = this.localDatabase.requirePool();
    const result = await pool.query<{
      completed_at: Date | null;
      id: string;
    }>(
      `select id, completed_at
       from recovery_points
       where status = 'verified'
       order by completed_at desc
       limit 1`,
    );

    const lastBackup = result.rows[0];
    const now = new Date();
    let missedRunDetected = false;

    if (!lastBackup || !lastBackup.completed_at) {
      missedRunDetected = true;
      this.logger.warn(
        "Missed backup run detected: No verified recovery point exists. Scheduling catch-up run.",
      );
    } else {
      const elapsedMs =
        now.getTime() - new Date(lastBackup.completed_at).getTime();
      if (elapsedMs > HOURLY_BACKUP_INTERVAL_MS) {
        missedRunDetected = true;
        this.logger.warn(
          `Missed backup run detected: Last verified backup was ${Math.round(elapsedMs / 60000)} minutes ago. Scheduling catch-up run.`,
        );
      }
    }

    if (missedRunDetected) {
      await this.durableJobs.send<RecoveryJobPayload>(
        RECOVERY_BACKUP_JOB_NAME,
        {
          backupType: "hourly_recovery_point",
          outputDirectory: defaultOutputDir,
          walArchiveDirectory: defaultWalDir,
        },
        {
          singletonKey: "hourly_recovery_catchup",
          singletonSeconds: 300,
        },
      );
    }

    return {
      lastBackupAt: lastBackup?.completed_at
        ? new Date(lastBackup.completed_at)
        : null,
      missedRunDetected,
    };
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
