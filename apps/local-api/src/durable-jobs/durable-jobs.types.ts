import type { JobWithMetadata, SendOptions, WorkOptions } from "pg-boss";

export interface DurableJob<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
}

export interface DeadLetterJob<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  readonly failedOn: Date | null;
  readonly state: string;
  readonly retryCount: number;
  readonly output: unknown;
}

export interface DurableJobSendOptions extends SendOptions {
  readonly retryLimit?: number;
  readonly retryDelay?: number;
  readonly retryBackoff?: boolean;
  readonly expireInSeconds?: number;
  readonly deadLetter?: string;
}

export interface DurableJobWorkOptions extends WorkOptions {
  readonly localConcurrency?: number;
  readonly pollingIntervalSeconds?: number;
}

export type DurableJobRecord<T = unknown> = JobWithMetadata<T>;
