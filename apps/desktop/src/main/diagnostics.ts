import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
} from "node:fs";
import { appendFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const DESKTOP_LOG_MAXIMUM_BYTES = 5 * 1024 * 1024;
export const DESKTOP_LOG_FILE_COUNT = 20;
export const DESKTOP_FATAL_LOG_MAXIMUM_BYTES = 256 * 1024;

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
  | { readonly code: string; readonly event: "main-unhandled-rejection" }
  | { readonly code: string; readonly event: "startup-failed" }
  | {
      readonly code: string;
      readonly event: "main-fatal";
      readonly origin: "uncaughtException" | "unhandledRejection";
    };

interface DesktopLoggerOptions {
  readonly fileCount?: number;
  readonly maximumBytes?: number;
  readonly now?: () => Date;
}

export class DesktopDiagnostics {
  private readonly activePath: string;
  private readonly fatalPath: string;
  private readonly fileCount: number;
  private readonly maximumBytes: number;
  private readonly now: () => Date;
  private fatalDescriptor: number | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly directory: string,
    options: DesktopLoggerOptions = {},
  ) {
    this.activePath = path.join(directory, "desktop.ndjson");
    this.fatalPath = path.join(directory, "desktop-fatal.ndjson");
    this.fileCount = options.fileCount ?? DESKTOP_LOG_FILE_COUNT;
    this.maximumBytes = options.maximumBytes ?? DESKTOP_LOG_MAXIMUM_BYTES;
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
    const line = this.serialize(event);
    this.pending = this.pending
      .then(async () => {
        await this.rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(this.activePath, line, {
          encoding: "utf8",
          flag: "a",
        });
      })
      .catch(() => undefined);
  }

  fatal(
    code: string,
    origin: "uncaughtException" | "unhandledRejection",
  ): void {
    if (this.fatalDescriptor === undefined) return;
    try {
      appendFileSync(
        this.fatalDescriptor,
        this.serialize({ code, event: "main-fatal", origin }),
        "utf8",
      );
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
  const source =
    value instanceof Error
      ? `${value.name}\n${value.stack ?? ""}`
      : Object.prototype.toString.call(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return "MAIN-" + (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function processGoneReason(value: string): ProcessGoneReason {
  return PROCESS_GONE_REASONS.has(value)
    ? (value as ProcessGoneReason)
    : "unknown";
}

export function processType(value: string): ProcessType {
  return PROCESS_TYPES.has(value) ? (value as ProcessType) : "Unknown";
}
