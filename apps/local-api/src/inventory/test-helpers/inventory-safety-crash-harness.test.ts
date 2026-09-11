import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";

import type {
  InventorySafetyCrashPoint,
  InventorySafetyCrashWorkerEvent,
} from "./inventory-safety-crash-child.test.js";

const READY_TIMEOUT_MS = 30_000;
const EVENT_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 30_000;

export interface InventorySafetyCrashWorkerOptions {
  readonly crashPoint: InventorySafetyCrashPoint;
  readonly databaseUrl: string;
  readonly afterIndex?: number;
  readonly workerId: string;
}

export interface InventorySafetyCrashWorkerHandle {
  readonly events: readonly InventorySafetyCrashWorkerEvent[];
  readonly workerId: string;
  kill(): void;
  output(): string;
  stop(): Promise<void>;
  waitForEvent(
    predicate: (event: InventorySafetyCrashWorkerEvent) => boolean,
    timeoutMs?: number,
  ): Promise<InventorySafetyCrashWorkerEvent>;
  waitForExit(timeoutMs?: number): Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
}

export class InventorySafetyCrashHarness {
  private readonly childScript = path.resolve(
    import.meta.dirname,
    "./inventory-safety-crash-child.test.ts",
  );
  private readonly workers = new Set<InventorySafetyCrashWorkerHandle>();

  public async spawnWorker(
    options: InventorySafetyCrashWorkerOptions,
  ): Promise<InventorySafetyCrashWorkerHandle> {
    const child: ChildProcess = fork(this.childScript, [], {
      env: {
        ...process.env,
        BREEV_SAFETY_AFTER_INDEX: String(options.afterIndex ?? 0),
        BREEV_SAFETY_CRASH_POINT: options.crashPoint,
        BREEV_SAFETY_DATABASE_URL: options.databaseUrl,
        BREEV_SAFETY_WORKER_ID: options.workerId,
      },
      execArgv: ["--experimental-strip-types", "--no-warnings"],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const events: InventorySafetyCrashWorkerEvent[] = [];
    const eventListeners = new Set<
      (event: InventorySafetyCrashWorkerEvent) => void
    >();
    const exitListeners = new Set<
      (exit: { code: number | null; signal: NodeJS.Signals | null }) => void
    >();
    let output = "";
    let exit:
      { code: number | null; signal: NodeJS.Signals | null } | undefined;
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const event = message as InventorySafetyCrashWorkerEvent;
      events.push(event);
      for (const listener of [...eventListeners]) listener(event);
    });
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      for (const listener of [...exitListeners]) listener(exit);
    });
    const handle: InventorySafetyCrashWorkerHandle = {
      events,
      kill: () => {
        if (exit === undefined) child.kill("SIGKILL");
      },
      output: () => output,
      stop: async () => {
        if (exit !== undefined) return;
        if (child.connected) {
          child.send({ action: "shutdown" });
          try {
            await handle.waitForExit(5_000);
            return;
          } catch {
            // The process is forcefully reaped below.
          }
        }
        handle.kill();
        await handle.waitForExit(5_000).catch(() => undefined);
      },
      waitForEvent: async (predicate, timeoutMs = EVENT_TIMEOUT_MS) => {
        const seen = events.find(predicate);
        if (seen !== undefined) return seen;
        return await new Promise<InventorySafetyCrashWorkerEvent>(
          (resolve, reject) => {
            const listener = (event: InventorySafetyCrashWorkerEvent): void => {
              if (!predicate(event)) return;
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
        if (exit !== undefined) return exit;
        return await new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>((resolve, reject) => {
          const listener = (value: {
            code: number | null;
            signal: NodeJS.Signals | null;
          }): void => {
            clearTimeout(timer);
            exitListeners.delete(listener);
            resolve(value);
          };
          const timer = setTimeout(() => {
            exitListeners.delete(listener);
            reject(
              new Error(`Worker ${options.workerId} did not exit\n${output}`),
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
        await worker.stop().catch(() => worker.kill());
      }),
    );
    this.workers.clear();
  }
}
