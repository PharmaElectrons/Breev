import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { CrashPoint } from "./crash-worker-child.js";

export interface SpawnWorkerOptions {
  readonly databaseUrl: string;
  readonly targetQueue: string;
  readonly crashPoint?: CrashPoint;
  readonly targetIdempotencyKey?: string;
  readonly workerId?: string;
}

export interface CrashWorkerEvent {
  readonly type: string;
  readonly jobId?: string;
  readonly idempotencyKey?: string;
  readonly workerId?: string;
  readonly point?: string;
  readonly [key: string]: unknown;
}

export interface CrashWorkerHandle {
  readonly child: ChildProcess;
  readonly workerId: string;
  readonly pid: number;
  readonly events: CrashWorkerEvent[];
  waitForEvent(
    predicate: (event: CrashWorkerEvent) => boolean,
    timeoutMs?: number,
  ): Promise<CrashWorkerEvent>;
  waitForExit(
    timeoutMs?: number,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stop(graceful?: boolean): Promise<void>;
  kill(signal?: NodeJS.Signals): void;
}

export class CrashTestHarness {
  private readonly activeWorkers = new Set<CrashWorkerHandle>();
  private readonly childScriptPath: string;

  public constructor() {
    this.childScriptPath = path.resolve(
      import.meta.dirname,
      "./crash-worker-child.ts",
    );
  }

  public async spawnWorker(
    options: SpawnWorkerOptions,
    readyTimeoutMs = 15_000,
  ): Promise<CrashWorkerHandle> {
    const workerId =
      options.workerId ??
      `worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const events: CrashWorkerEvent[] = [];
    let exitResult: {
      code: number | null;
      signal: NodeJS.Signals | null;
    } | null = null;
    const exitListeners: Array<
      (res: { code: number | null; signal: NodeJS.Signals | null }) => void
    > = [];
    const eventListeners: Array<(event: CrashWorkerEvent) => void> = [];

    const child = fork(this.childScriptPath, [], {
      execArgv: ["--experimental-strip-types"],
      env: {
        ...process.env,
        DATABASE_URL: options.databaseUrl,
        TARGET_QUEUE: options.targetQueue,
        CRASH_POINT: options.crashPoint ?? "none",
        TARGET_IDEMPOTENCY_KEY: options.targetIdempotencyKey ?? "",
        WORKER_ID: workerId,
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    child.stdout?.on("data", (data) =>
      process.stdout.write(`[Worker ${workerId}] ${data}`),
    );
    child.stderr?.on("data", (data) =>
      process.stderr.write(`[Worker ${workerId} err] ${data}`),
    );

    const pid = child.pid ?? 0;

    child.on("message", (rawMsg: unknown) => {
      if (typeof rawMsg === "object" && rawMsg !== null) {
        const event = rawMsg as CrashWorkerEvent;
        events.push(event);
        for (const listener of [...eventListeners]) {
          listener(event);
        }
      }
    });

    child.on("exit", (code, signal) => {
      exitResult = { code, signal };
      for (const listener of [...exitListeners]) {
        listener(exitResult);
      }
    });

    const handle: CrashWorkerHandle = {
      child,
      events,
      pid,
      workerId,
      waitForEvent: async (predicate, timeoutMs = 15_000) => {
        const existing = events.find(predicate);
        if (existing) {
          return existing;
        }

        return new Promise<CrashWorkerEvent>((resolve, reject) => {
          const timeout = setTimeout(() => {
            const index = eventListeners.indexOf(onEvent);
            if (index >= 0) eventListeners.splice(index, 1);
            reject(
              new Error(`Timed out waiting for event after ${timeoutMs}ms`),
            );
          }, timeoutMs);

          function onEvent(event: CrashWorkerEvent) {
            if (predicate(event)) {
              clearTimeout(timeout);
              const index = eventListeners.indexOf(onEvent);
              if (index >= 0) eventListeners.splice(index, 1);
              resolve(event);
            }
          }

          eventListeners.push(onEvent);
        });
      },
      waitForExit: async (timeoutMs = 15_000) => {
        if (exitResult !== null) {
          return exitResult;
        }

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            const index = exitListeners.indexOf(onExit);
            if (index >= 0) exitListeners.splice(index, 1);
            reject(
              new Error(
                `Timed out waiting for worker ${workerId} to exit after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);

          function onExit(res: {
            code: number | null;
            signal: NodeJS.Signals | null;
          }) {
            clearTimeout(timeout);
            const index = exitListeners.indexOf(onExit);
            if (index >= 0) exitListeners.splice(index, 1);
            resolve(res);
          }

          exitListeners.push(onExit);
        });
      },
      stop: async (graceful = true) => {
        if (exitResult !== null) {
          return;
        }
        if (graceful && child.connected) {
          child.send({ action: "shutdown" });
          try {
            await handle.waitForExit(5_000);
            return;
          } catch {
            // Force kill if graceful shutdown timed out
          }
        }
        handle.kill("SIGKILL");
        await handle.waitForExit(3_000).catch(() => undefined);
      },
      kill: (signal = "SIGKILL") => {
        if (exitResult === null) {
          child.kill(signal);
        }
      },
    };

    this.activeWorkers.add(handle);

    // Wait for "ready" event from worker
    try {
      await handle.waitForEvent((e) => e.type === "ready", readyTimeoutMs);
    } catch (error) {
      handle.kill("SIGKILL");
      this.activeWorkers.delete(handle);
      throw new Error(
        `Worker ${workerId} failed to report ready: ${String(error)}`,
      );
    }

    return handle;
  }

  public async stopAll(): Promise<void> {
    const stopping = Array.from(this.activeWorkers).map(async (worker) => {
      try {
        await worker.stop(true);
      } catch {
        worker.kill("SIGKILL");
      }
    });
    await Promise.all(stopping);
    this.activeWorkers.clear();
  }
}
