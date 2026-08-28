import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { recordPostCommitOutcome } from "../posting/outbox.js";

/**
 * pg-boss queue names accept only word characters, hyphens, periods, and
 * forward slashes.
 */
export const SETTINGS_POST_COMMIT_QUEUE = "posting.settings-post-commit";

/** The one outcome this worker can record. */
export const SETTINGS_POST_COMMIT_OUTCOME = "acknowledged";

const SETTINGS_POST_COMMIT_EXPIRE_SECONDS = 60;
const SETTINGS_POST_COMMIT_RETRY_DELAY_SECONDS = 1;
const SETTINGS_POST_COMMIT_RETRY_LIMIT = 5;

/**
 * The job payload carries the identity of the envelope the posting transaction
 * produced, never the change itself. A retry, a duplicate delivery, or a claim
 * recovered after a crash therefore resumes the same envelope instead of
 * recreating anything.
 */
export interface SettingsPostCommitPayload {
  readonly outboxEntryId: string;
  readonly pharmacyId: string;
}

/**
 * Acknowledges the settings envelopes that committed.
 *
 * This worker is deliberately incapable of re-executing the command it follows:
 * it reads the outbox entry, verifies the entry belongs to the pharmacy its
 * payload names, and writes one post-commit outcome row. It never touches
 * `pharmacy_settings`, never calls the settings command, and never mutates the
 * envelope. A payload that does not match a committed envelope records nothing
 * and fails the job, so the mismatch surfaces as a dead letter rather than as a
 * silent acknowledgement of something that never happened.
 */
@Injectable()
export class SettingsPostCommitService implements OnModuleInit {
  private readonly logger = new Logger(SettingsPostCommitService.name);

  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(DurableJobsService)
    private readonly durableJobs: DurableJobsService,
  ) {}

  public async onModuleInit(): Promise<void> {
    // Nest runs module initialization hooks concurrently, so the job runtime
    // must be awaited rather than probed: probing it here would silently skip
    // this queue on every start.
    await this.durableJobs.ensureStarted();
    if (!this.durableJobs.isAvailable()) {
      this.logger.warn(
        "The durable job runtime is unavailable, so committed pharmacy settings events will not be acknowledged",
      );
      return;
    }

    // The queue is registered at startup so the first posting of the day never
    // depends on lazy queue creation inside a business transaction.
    await this.durableJobs.ensureQueue(SETTINGS_POST_COMMIT_QUEUE, {
      expireInSeconds: SETTINGS_POST_COMMIT_EXPIRE_SECONDS,
      retryBackoff: true,
      retryDelay: SETTINGS_POST_COMMIT_RETRY_DELAY_SECONDS,
      retryLimit: SETTINGS_POST_COMMIT_RETRY_LIMIT,
    });

    await this.durableJobs.work<SettingsPostCommitPayload>(
      SETTINGS_POST_COMMIT_QUEUE,
      async (job) => {
        await this.acknowledge(job.data);
      },
    );
  }

  /**
   * Records the single durable outcome for one committed envelope. The insert
   * ignores a conflict, so duplicate delivery, a recovered claim, and two
   * racing workers all converge on the row that was written first.
   */
  public async acknowledge(payload: unknown): Promise<void> {
    const { outboxEntryId, pharmacyId } = requirePayload(payload);
    const client = await this.localDatabase.requirePool().connect();
    try {
      const entry = await client.query<{ pharmacy_id: string }>(
        "select pharmacy_id from posting_outbox_entries where id = $1",
        [outboxEntryId],
      );
      const row = entry.rows[0];
      if (row === undefined) {
        throw new Error(
          `The posting outbox entry ${outboxEntryId} does not exist`,
        );
      }
      if (row.pharmacy_id !== pharmacyId) {
        throw new Error(
          `The posting outbox entry ${outboxEntryId} belongs to another pharmacy`,
        );
      }
      await recordPostCommitOutcome(client, {
        outboxEntryId,
        outcome: SETTINGS_POST_COMMIT_OUTCOME,
      });
    } finally {
      client.release();
    }
  }
}

/**
 * A job payload arrives as stored JSON, so it is checked rather than trusted.
 * A payload that is not two identifiers cannot name an envelope, and failing
 * here keeps the malformed job out of the outcome table.
 */
function requirePayload(payload: unknown): SettingsPostCommitPayload {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("The settings post-commit job carries no payload");
  }
  const { outboxEntryId, pharmacyId } = payload as {
    outboxEntryId?: unknown;
    pharmacyId?: unknown;
  };
  if (typeof outboxEntryId !== "string" || typeof pharmacyId !== "string") {
    throw new Error(
      "A settings post-commit job must name an outbox entry and its pharmacy",
    );
  }
  return { outboxEntryId, pharmacyId };
}
