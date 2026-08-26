import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import {
  fromDrizzle,
  PgBoss,
  type DrizzleSqlTagLike,
  type DrizzleTransactionLike,
  type Job,
} from "pg-boss";

import { LocalDatabaseService } from "../local-database.service.js";
import type {
  DeadLetterJob,
  DurableJob,
  DurableJobRecord,
  DurableJobSendOptions,
  DurableJobWorkOptions,
} from "./durable-jobs.types.js";

export const DEFAULT_RETRY_LIMIT = 3;
export const DEFAULT_RETRY_DELAY_SECONDS = 1;
export const DEFAULT_EXPIRE_SECONDS = 60;

export interface QueueConfigOptions {
  readonly deadLetter?: string;
  readonly expireInSeconds?: number;
  readonly retryBackoff?: boolean;
  readonly retryDelay?: number;
  readonly retryLimit?: number;
}

@Injectable()
export class DurableJobsService
  implements OnModuleInit, OnApplicationShutdown
{
  private boss: PgBoss | undefined;
  private readonly knownQueues = new Set<string>();

  public constructor(private readonly localDatabase: LocalDatabaseService) {}

  public async onModuleInit(): Promise<void> {
    const applicationUrl = this.localDatabase.getApplicationUrl();
    if (applicationUrl === undefined) {
      return;
    }

    try {
      this.boss = new PgBoss({
        allowSchemaCaseVariant: true,
        connectionString: applicationUrl,
        createSchema: false,
        migrate: false,
        persistQueueStats: false,
        persistWarnings: false,
        schedule: false,
        schema: "pgboss",
        supervise: true,
      });

      this.boss.on("error", () => undefined);
      await this.boss.start();
    } catch {
      this.boss = undefined;
    }
  }

  public isAvailable(): boolean {
    return this.boss !== undefined;
  }

  public requireBoss(): PgBoss {
    if (this.boss === undefined) {
      throw new Error("The Breev durable job service is unavailable");
    }
    return this.boss;
  }

  public async ensureQueue(
    name: string,
    options?: QueueConfigOptions,
  ): Promise<void> {
    if (this.knownQueues.has(name)) {
      return;
    }

    const boss = this.requireBoss();
    const queueOptions: {
      deadLetter?: string;
      expireInSeconds: number;
      retryBackoff: boolean;
      retryDelay: number;
      retryLimit: number;
    } = {
      expireInSeconds: options?.expireInSeconds ?? DEFAULT_EXPIRE_SECONDS,
      retryBackoff: options?.retryBackoff ?? true,
      retryDelay: options?.retryDelay ?? DEFAULT_RETRY_DELAY_SECONDS,
      retryLimit: options?.retryLimit ?? DEFAULT_RETRY_LIMIT,
    };

    if (options?.deadLetter !== undefined) {
      queueOptions.deadLetter = options.deadLetter;
    }

    try {
      await boss.createQueue(name, queueOptions);
    } catch {
      // Queue creation might already exist in database
    }
    this.knownQueues.add(name);
  }

  public async send<T extends object>(
    name: string,
    data?: T,
    options?: DurableJobSendOptions,
  ): Promise<string | null> {
    await this.ensureQueue(name, options);
    const boss = this.requireBoss();
    return await boss.send(name, (data ?? null) as object | null, {
      expireInSeconds: DEFAULT_EXPIRE_SECONDS,
      retryBackoff: true,
      retryDelay: DEFAULT_RETRY_DELAY_SECONDS,
      retryLimit: DEFAULT_RETRY_LIMIT,
      ...options,
    });
  }

  public async sendInTransaction<T extends object>(
    txOrClient: DrizzleTransactionLike | PoolClient,
    name: string,
    data?: T,
    options?: DurableJobSendOptions,
  ): Promise<string | null> {
    await this.ensureQueue(name, options);
    const boss = this.requireBoss();
    const mergedOptions = {
      expireInSeconds: DEFAULT_EXPIRE_SECONDS,
      retryBackoff: true,
      retryDelay: DEFAULT_RETRY_DELAY_SECONDS,
      retryLimit: DEFAULT_RETRY_LIMIT,
      ...options,
    };

    if ("execute" in txOrClient && typeof txOrClient.execute === "function") {
      const db = fromDrizzle(
        txOrClient,
        sql as unknown as DrizzleSqlTagLike,
      );
      return await boss.send(name, (data ?? null) as object | null, {
        ...mergedOptions,
        db,
      });
    }

    if ("query" in txOrClient && typeof txOrClient.query === "function") {
      const client = txOrClient;
      const db = {
        executeSql: async (text: string, values?: unknown[]) => {
          const result = await client.query(text, values);
          return { rows: result.rows };
        },
      };
      return await boss.send(name, (data ?? null) as object | null, {
        ...mergedOptions,
        db,
      });
    }

    throw new Error(
      "Invalid transaction context provided to sendInTransaction",
    );
  }

  public async work<T extends object>(
    name: string,
    handler: (job: DurableJob<T>) => Promise<void>,
    options?: DurableJobWorkOptions,
  ): Promise<string> {
    await this.ensureQueue(name);
    const boss = this.requireBoss();
    return await boss.work(
      name,
      options ?? {},
      async (jobs: Array<Job<T>>) => {
        for (const job of jobs) {
          await handler({
            data: job.data,
            id: job.id,
            name: job.name,
          });
        }
      },
    );
  }

  public async getJob<T = unknown>(
    name: string,
    id: string,
  ): Promise<DurableJobRecord<T> | null> {
    const boss = this.requireBoss();
    const jobs = await boss.findJobs<T>(name, { id });
    return jobs[0] ?? null;
  }

  public async getDeadLetterJobs<T = unknown>(
    name?: string,
  ): Promise<DeadLetterJob<T>[]> {
    const pool = this.localDatabase.requirePool();
    const queryText = name
      ? `select id, name, data, state, retry_count, output, completed_on, created_on
         from pgboss.job
         where name = $1 and state = 'failed'
         order by coalesce(completed_on, created_on) desc`
      : `select id, name, data, state, retry_count, output, completed_on, created_on
         from pgboss.job
         where state = 'failed'
         order by coalesce(completed_on, created_on) desc`;
    const parameters = name ? [name] : [];
    const result = await pool.query<{
      completed_on: Date | null;
      created_on: Date;
      data: T;
      id: string;
      name: string;
      output: unknown;
      retry_count: number;
      state: string;
    }>(queryText, parameters);

    return result.rows.map((row) => ({
      data: row.data,
      failedOn: row.completed_on ?? row.created_on,
      id: row.id,
      name: row.name,
      output: row.output,
      retryCount: row.retry_count,
      state: row.state,
    }));
  }

  public async stop(options?: {
    graceful?: boolean;
    timeout?: number;
  }): Promise<void> {
    if (this.boss !== undefined) {
      await this.boss.stop(options);
      this.boss = undefined;
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.stop({ graceful: false });
  }
}
