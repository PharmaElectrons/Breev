import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";

import type {
  SettingsCrashPoint,
  SettingsCrashWorkerEvent,
} from "./settings-crash-child.test.js";

/**
 * Forks, watches, and reaps the post-commit workers that die on purpose.
 *
 * The harness owns every child it starts, so a scenario that fails an assertion
 * mid-flight cannot leave a live worker behind to claim the next scenario's
 * job. `stopAll` is called between tests for exactly that reason.
 */

const READY_TIMEOUT_MS = 30_000;
const EVENT_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 30_000;

export interface SettingsCrashWorkerOptions {
  readonly crashPoint: SettingsCrashPoint;
  readonly databaseUrl: string;
  readonly outcome: string;
  readonly queueName: string;
  readonly targetOutboxEntryId: string;
  readonly workerId: string;
}

export interface SettingsCrashWorkerExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface SettingsCrashWorkerHandle {
  readonly events: readonly SettingsCrashWorkerEvent[];
  readonly workerId: string;
  kill(): void;
  output(): string;
  stop(): Promise<void>;
  waitForEvent(
    predicate: (event: SettingsCrashWorkerEvent) => boolean,
    timeoutMs?: number,
  ): Promise<SettingsCrashWorkerEvent>;
  waitForExit(timeoutMs?: number): Promise<SettingsCrashWorkerExit>;
}

export class SettingsCrashHarness {
  private readonly childScript = path.resolve(
    import.meta.dirname,
    "./settings-crash-child.test.ts",
  );
  private readonly workers = new Set<SettingsCrashWorkerHandle>();

  public async spawnWorker(
    options: SettingsCrashWorkerOptions,
  ): Promise<SettingsCrashWorkerHandle> {
    const events: SettingsCrashWorkerEvent[] = [];
    const eventListeners = new Set<(event: SettingsCrashWorkerEvent) => void>();
    const exitListeners = new Set<(exit: SettingsCrashWorkerExit) => void>();
    let output = "";
    let exit: SettingsCrashWorkerExit | undefined;

    const child: ChildProcess = fork(this.childScript, [], {
      env: {
        ...process.env,
        BREEV_CRASH_DATABASE_URL: options.databaseUrl,
        BREEV_CRASH_OUTCOME: options.outcome,
        BREEV_CRASH_POINT: options.crashPoint,
        BREEV_CRASH_QUEUE: options.queueName,
        BREEV_CRASH_TARGET_ENTRY: options.targetOutboxEntryId,
        BREEV_CRASH_WORKER_ID: options.workerId,
      },
      execArgv: ["--experimental-strip-types", "--no-warnings"],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    child.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null) {
        return;
      }
      const event = message as SettingsCrashWorkerEvent;
      events.push(event);
      for (const listener of [...eventListeners]) {
        listener(event);
      }
    });

    child.on("exit", (code, signal) => {
      exit = { code, signal };
      for (const listener of [...exitListeners]) {
        listener(exit);
      }
    });

    const handle: SettingsCrashWorkerHandle = {
      events,
      kill: () => {
        if (exit === undefined) {
          child.kill("SIGKILL");
        }
      },
      output: () => output,
      stop: async () => {
        if (exit !== undefined) {
          return;
        }
        if (child.connected) {
          child.send({ action: "shutdown" });
          try {
            await handle.waitForExit(5_000);
            return;
          } catch {
            // A worker that ignores the request is killed below.
          }
        }
        handle.kill();
        await handle.waitForExit(5_000).catch(() => undefined);
      },
      waitForEvent: async (predicate, timeoutMs = EVENT_TIMEOUT_MS) => {
        const seen = events.find(predicate);
        if (seen !== undefined) {
          return seen;
        }
        return await new Promise<SettingsCrashWorkerEvent>(
          (resolve, reject) => {
            const listener = (event: SettingsCrashWorkerEvent): void => {
              if (!predicate(event)) {
                return;
              }
              clearTimeout(timer);
              eventListeners.delete(listener);
              resolve(event);
            };
            const timer = setTimeout(() => {
              eventListeners.delete(listener);
              reject(
                new Error(
                  `Worker ${options.workerId} sent no matching event within ${String(timeoutMs)}ms\n${output}`,
                ),
              );
            }, timeoutMs);
            eventListeners.add(listener);
          },
        );
      },
      waitForExit: async (timeoutMs = EXIT_TIMEOUT_MS) => {
        if (exit !== undefined) {
          return exit;
        }
        return await new Promise<SettingsCrashWorkerExit>((resolve, reject) => {
          const listener = (result: SettingsCrashWorkerExit): void => {
            clearTimeout(timer);
            exitListeners.delete(listener);
            resolve(result);
          };
          const timer = setTimeout(() => {
            exitListeners.delete(listener);
            reject(
              new Error(
                `Worker ${options.workerId} did not exit within ${String(timeoutMs)}ms\n${output}`,
              ),
            );
          }, timeoutMs);
          exitListeners.add(listener);
        });
      },
      workerId: options.workerId,
    };

    this.workers.add(handle);
    try {
      await handle.waitForEvent(
        (event) => event.type === "ready",
        READY_TIMEOUT_MS,
      );
    } catch (error) {
      handle.kill();
      throw error;
    }
    return handle;
  }

  public async stopAll(): Promise<void> {
    await Promise.all(
      [...this.workers].map(async (worker) => {
        try {
          await worker.stop();
        } catch {
          worker.kill();
        }
      }),
    );
    this.workers.clear();
  }
}
