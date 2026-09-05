import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  statSync,
} from "node:fs";
import { appendFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const DESKTOP_LOG_MAXIMUM_BYTES = 5 * 1024 * 1024;
export const DESKTOP_LOG_FILE_COUNT = 20;
export const DESKTOP_FATAL_LOG_MAXIMUM_BYTES = 256 * 1024;
export const DESKTOP_LOG_MAXIMUM_PENDING_WRITES = 256;

const PROCESS_GONE_REASONS = new Set([
  "abnormal-exit",
  "clean-exit",
  "crashed",
  "integrity-failure",
  "killed",
  "launch-failed",
  "memory-eviction",
  "oom",
]);

const PROCESS_TYPES = new Set([
  "GPU",
  "Pepper Plugin",
  "Pepper Plugin Broker",
  "Sandbox helper",
  "Unknown",
  "Utility",
  "Zygote",
]);

type ProcessGoneReason =
  | "abnormal-exit"
  | "clean-exit"
  | "crashed"
  | "integrity-failure"
  | "killed"
  | "launch-failed"
  | "memory-eviction"
  | "oom"
  | "unknown";
type ProcessType =
  | "GPU"
  | "Pepper Plugin"
  | "Pepper Plugin Broker"
  | "Sandbox helper"
  | "Unknown"
  | "Utility"
  | "Zygote";
type RendererIncidentSource =
  | "application"
  | "bootstrap"
  | "global-error"
  | "unhandled-rejection"
  | "workspace";

export type DiagnosticEvent =
  | { readonly event: "app-ready"; readonly role: "main" | "terminal" }
  | {
      readonly code: string;
      readonly event: "renderer-incident";
      readonly source: RendererIncidentSource;
    }
  | {
      readonly event: "renderer-process-gone";
      readonly reason: ProcessGoneReason;
    }
  | {
      readonly event: "child-process-gone";
      readonly reason: ProcessGoneReason;
      readonly processType: ProcessType;
    }
  | { readonly event: "renderer-unresponsive" }
  | { readonly code: string; readonly event: "preload-failed" }
  | { readonly code: string; readonly event: "main-unhandled-rejection" }
  | { readonly code: string; readonly event: "startup-failed" }
  | {
      readonly code: string;
      readonly event: "main-fatal";
      readonly origin:
        "preloadError" | "uncaughtException" | "unhandledRejection";
    };

interface DesktopLoggerOptions {
  readonly fileCount?: number;
  readonly maximumBytes?: number;
  readonly maximumPendingWrites?: number;
  readonly now?: () => Date;
}

export class DesktopDiagnostics {
  private readonly activePath: string;
  private readonly fatalPath: string;
  private readonly fileCount: number;
  private readonly maximumBytes: number;
  private readonly maximumPendingWrites: number;
  private readonly now: () => Date;
  private fatalDescriptor: number | undefined;
  private pending: Promise<void> = Promise.resolve();
  private pendingWrites = 0;

  constructor(
    private readonly directory: string,
    options: DesktopLoggerOptions = {},
  ) {
    this.activePath = path.join(directory, "desktop.ndjson");
    this.fatalPath = path.join(directory, "desktop-fatal.ndjson");
    this.fileCount = options.fileCount ?? DESKTOP_LOG_FILE_COUNT;
    this.maximumBytes = options.maximumBytes ?? DESKTOP_LOG_MAXIMUM_BYTES;
    this.maximumPendingWrites =
      options.maximumPendingWrites ?? DESKTOP_LOG_MAXIMUM_PENDING_WRITES;
    this.now = options.now ?? (() => new Date());
    try {
      mkdirSync(directory, { recursive: true });
      const fatalFlag =
        existsSync(this.fatalPath) &&
        statSync(this.fatalPath).size >= DESKTOP_FATAL_LOG_MAXIMUM_BYTES
          ? "w"
          : "a";
      this.fatalDescriptor = openSync(this.fatalPath, fatalFlag);
    } catch {
      this.fatalDescriptor = undefined;
    }
  }

  log(event: DiagnosticEvent): void {
    if (this.pendingWrites >= this.maximumPendingWrites) return;
    const line = this.serialize(event);
    this.pendingWrites += 1;
    this.pending = this.pending
      .then(async () => {
        await this.rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(this.activePath, line, {
          encoding: "utf8",
          flag: "a",
        });
      })
      .catch(() => undefined)
      .finally(() => {
        this.pendingWrites -= 1;
      });
  }

  fatal(
    code: string,
    origin: "preloadError" | "uncaughtException" | "unhandledRejection",
  ): void {
    if (this.fatalDescriptor === undefined) return;
    try {
      const line = this.serialize({ code, event: "main-fatal", origin });
      if (
        fstatSync(this.fatalDescriptor).size + Buffer.byteLength(line, "utf8") >
        DESKTOP_FATAL_LOG_MAXIMUM_BYTES
      ) {
        ftruncateSync(this.fatalDescriptor, 0);
      }
      appendFileSync(this.fatalDescriptor, line, "utf8");
    } catch {
      // A fatal breadcrumb is best-effort and must never obscure termination.
    }
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  close(): void {
    if (this.fatalDescriptor === undefined) return;
    try {
      closeSync(this.fatalDescriptor);
    } catch {
      // Shutdown must remain best-effort.
    }
    this.fatalDescriptor = undefined;
  }

  private serialize(event: DiagnosticEvent): string {
    return (
      JSON.stringify({
        ...event,
        recordedAt: this.now().toISOString(),
        schemaVersion: 1,
      }) + "\n"
    );
  }

  private async rotateIfNeeded(additionalBytes: number): Promise<void> {
    let bytes = 0;
    try {
      bytes = (await stat(this.activePath)).size;
    } catch {
      return;
    }
    if (bytes + additionalBytes <= this.maximumBytes) return;

    await rm(this.rotatedPath(this.fileCount - 1), { force: true });
    for (let index = this.fileCount - 2; index >= 1; index -= 1) {
      const source = this.rotatedPath(index);
      if (existsSync(source)) await rename(source, this.rotatedPath(index + 1));
    }
    await rename(this.activePath, this.rotatedPath(1));
  }

  private rotatedPath(index: number): string {
    return path.join(this.directory, `desktop.${index}.ndjson`);
  }
}

export function resolveDesktopLogDirectory(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  userDataDirectory: string,
): string {
  const localAppData = environment.LOCALAPPDATA;
  if (
    platform === "win32" &&
    localAppData !== undefined &&
    localAppData.trim() !== ""
  ) {
    return path.resolve(localAppData, "Breev", "logs");
  }
  return path.resolve(userDataDirectory, "logs");
}

export function incidentCode(value: unknown): string {
  const source = safeFingerprintMaterial(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return "MAIN-" + (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function safeFingerprintMaterial(value: unknown): string {
  if (!(value instanceof Error)) return Object.prototype.toString.call(value);
  const safeName = /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(value.name)
    ? value.name
    : "Error";
  const frames = (value.stack ?? "")
    .split(/\r?\n/gu)
    .slice(1, 17)
    .flatMap((line) => {
      const match =
        /^\s*at\s+(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$.[\]<> ]{0,80})\s+\(/u.exec(
          line,
        );
      return match?.[1] === undefined ? [] : [match[1].replace(/\s+/gu, " ")];
    });
  return [safeName, ...frames].join("\n");
}

export function createRendererRecoveryPolicy(
  now: () => number = Date.now,
): (reason: string) => "ignore" | "reload" | "terminate" {
  let lastRecoveryAt: number | undefined;
  return (reason) => {
    if (reason === "clean-exit") return "ignore";
    const currentTime = now();
    if (
      lastRecoveryAt === undefined ||
      currentTime - lastRecoveryAt >= 60_000
    ) {
      lastRecoveryAt = currentTime;
      return "reload";
    }
    return "terminate";
  };
}

export function terminateOnUnhandledRejection(
  diagnostics: Pick<DesktopDiagnostics, "fatal">,
  reason: unknown,
  terminate: (exitCode: number) => void,
): void {
  diagnostics.fatal(incidentCode(reason), "unhandledRejection");
  terminate(1);
}

export function processGoneReason(value: string): ProcessGoneReason {
  return PROCESS_GONE_REASONS.has(value)
    ? (value as ProcessGoneReason)
    : "unknown";
}

export function processType(value: string): ProcessType {
  return PROCESS_TYPES.has(value) ? (value as ProcessType) : "Unknown";
}
