import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import {
  desktopDeviceRoleSchema,
  terminalPairingStageSchema,
  type DesktopDeviceRole,
  type TerminalPairingStage,
} from "@breev/contracts/desktop-preload";

import { containsDiagnosticCanary } from "./diagnostic-redaction.js";

const executeFile = promisify(execFile);
const MAXIMUM_LOG_FILES = 5;
const MAXIMUM_LOG_BYTES_PER_FILE = 512 * 1024;
const SAFE_LOG_EVENTS = new Set([
  "app-ready",
  "child-process-gone",
  "main-fatal",
  "main-unhandled-rejection",
  "preload-failed",
  "renderer-incident",
  "renderer-process-gone",
  "renderer-unresponsive",
  "startup-failed",
]);
const SAFE_LOG_KEYS = new Set([
  "code",
  "event",
  "origin",
  "processType",
  "reason",
  "recordedAt",
  "role",
  "schemaVersion",
  "source",
]);
const MAXIMUM_BUNDLE_BYTES = 4 * 1024 * 1024;

const diagnosticLogRecordSchema = z.strictObject({
  code: z.string().max(32).optional(),
  event: z.enum([
    "app-ready",
    "child-process-gone",
    "main-fatal",
    "main-unhandled-rejection",
    "preload-failed",
    "renderer-incident",
    "renderer-process-gone",
    "renderer-unresponsive",
    "startup-failed",
  ]),
  origin: z
    .enum(["preloadError", "uncaughtException", "unhandledRejection"])
    .optional(),
  processType: z.string().max(32).optional(),
  reason: z.string().max(32).optional(),
  recordedAt: z.string().max(40).optional(),
  role: desktopDeviceRoleSchema.optional(),
  schemaVersion: z.number().int().min(1).max(10).optional(),
  source: z.string().max(32).optional(),
});

export const diagnosticBundleSchema = z.strictObject({
  application: z.strictObject({
    electronVersion: z.string().max(64),
    nodeVersion: z.string().max(64),
    product: z.literal("Breev"),
    version: z.string().max(64),
  }),
  bundleId: z.string().regex(/^DIAG-\d{8}-[0-9A-F]{8}$/u),
  connectivity: z.strictObject({
    localApi: z.strictObject({
      state: z.enum([
        "degraded",
        "healthy",
        "reachable",
        "repair-required",
        "unreachable",
      ]),
      statusCode: z.number().int().min(100).max(599).optional(),
    }),
  }),
  createdAt: z.string().max(40),
  incident: z
    .strictObject({
      code: z.string().regex(/^(?:APP|ASYNC|BOOT|MAIN|VIEW)-[0-9A-F]{8}$/u),
    })
    .optional(),
  installer: z.strictObject({
    action: z
      .enum(["Install", "Repair", "Uninstall", "DestructiveUninstall"])
      .optional(),
    completedAtUtc: z.string().max(32).optional(),
    failurePoint: z
      .enum([
        "None",
        "AfterDataPrepared",
        "AfterPostgreSqlService",
        "AfterApiService",
        "AfterFirewallConfigured",
        "BeforeReadiness",
        "",
      ])
      .optional(),
    schemaVersion: z.number().finite().optional(),
    state: z.enum(["invalid", "not-applicable", "recorded", "unavailable"]),
    status: z
      .enum([
        "healthy",
        "failed-data-preserved",
        "data-preserved",
        "data-destroyed",
      ])
      .optional(),
  }),
  logs: z.array(diagnosticLogRecordSchema).max(2_000),
  schemaVersion: z.literal(1),
  service: z.strictObject({
    state: z.enum([
      "not-applicable",
      "running",
      "stopped",
      "transitioning",
      "unknown",
    ]),
  }),
  system: z.strictObject({
    architecture: z.string().max(32),
    platform: z.string().max(32),
    release: z.string().max(128),
  }),
  terminal: z.strictObject({
    pairingStage: z.union([
      terminalPairingStageSchema,
      z.literal("not-applicable"),
    ]),
    role: desktopDeviceRoleSchema,
  }),
});

export type DiagnosticBundle = z.infer<typeof diagnosticBundleSchema>;

export interface DiagnosticBundleInput {
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly incidentCode?: string;
  readonly localApiOrigin: string;
  readonly logDirectory: string;
  readonly nodeVersion: string;
  readonly pairingStage: TerminalPairingStage | "not-applicable";
  readonly programDataDirectory?: string;
  readonly role: DesktopDeviceRole;
}

export async function createDiagnosticBundle(
  input: DiagnosticBundleInput,
): Promise<DiagnosticBundle> {
  const [localApi, service, logs, installer] = await Promise.all([
    inspectLocalApi(input.localApiOrigin),
    inspectWindowsService(input.role),
    readRecentDiagnosticLogs(input.logDirectory),
    readInstallerLifecycle(input.programDataDirectory),
  ]);
  const createdAt = new Date().toISOString();
  const bundle = {
    application: {
      electronVersion: input.electronVersion,
      nodeVersion: input.nodeVersion,
      product: "Breev",
      version: input.appVersion,
    },
    bundleId: `DIAG-${createdAt.slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`,
    connectivity: { localApi },
    createdAt,
    ...(input.incidentCode === undefined
      ? {}
      : { incident: { code: input.incidentCode } }),
    installer,
    logs,
    schemaVersion: 1,
    service,
    system: { architecture: arch(), platform: platform(), release: release() },
    terminal: { pairingStage: input.pairingStage, role: input.role },
  };
  const safeBundle = diagnosticBundleSchema.parse(bundle);
  const serialized = JSON.stringify(safeBundle);
  if (containsDiagnosticCanary(serialized)) {
    throw new Error("Diagnostic bundle redaction failed closed");
  }
  return safeBundle;
}

export async function readInstallerLifecycle(
  programDataDirectory: string | undefined,
): Promise<unknown> {
  if (programDataDirectory === undefined) {
    return { state: "not-applicable" };
  }
  try {
    const content = await readFile(
      path.resolve(programDataDirectory, "Breev", "state", "lifecycle.json"),
      "utf8",
    );
    if (Buffer.byteLength(content) > 64 * 1024) return { state: "invalid" };
    const parsed: unknown = JSON.parse(content);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { state: "invalid" };
    }
    const source = parsed as Record<string, unknown>;
    const result: Record<string, unknown> = { state: "recorded" };
    if (
      ["Install", "Repair", "Uninstall", "DestructiveUninstall"].includes(
        String(source.action),
      )
    ) {
      result.action = source.action;
    }
    if (
      [
        "healthy",
        "failed-data-preserved",
        "data-preserved",
        "data-destroyed",
      ].includes(String(source.status))
    ) {
      result.status = source.status;
    }
    if (
      [
        "None",
        "AfterDataPrepared",
        "AfterPostgreSqlService",
        "AfterApiService",
        "AfterFirewallConfigured",
        "BeforeReadiness",
        "",
      ].includes(String(source.failurePoint))
    ) {
      result.failurePoint = source.failurePoint;
    }
    if (typeof source.schemaVersion === "number")
      result.schemaVersion = source.schemaVersion;
    if (
      typeof source.completedAtUtc === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(source.completedAtUtc)
    ) {
      result.completedAtUtc = source.completedAtUtc.slice(0, 32);
    }
    return result;
  } catch {
    return { state: "unavailable" };
  }
}

export async function writeDiagnosticBundle(
  filePath: string,
  bundle: unknown,
): Promise<void> {
  assertDiagnosticDestination(filePath);
  const safeBundle = diagnosticBundleSchema.parse(bundle);
  const serialized = JSON.stringify(safeBundle, null, 2) + "\n";
  if (containsDiagnosticCanary(serialized)) {
    throw new Error("Diagnostic bundle redaction failed closed");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_BUNDLE_BYTES) {
    throw new Error("Diagnostic bundle exceeds the safe export limit");
  }

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function assertDiagnosticDestination(filePath: string): void {
  const normalized = path.normalize(filePath);
  if (
    !path.isAbsolute(normalized) ||
    !normalized.toLowerCase().endsWith(".json") ||
    normalized.includes("\0") ||
    /^(?:\\\\\.\\|\\\\\?\\GLOBALROOT\\)/iu.test(normalized)
  ) {
    throw new Error("Diagnostic export destination is invalid");
  }
}

export function diagnosticFileName(now = new Date()): string {
  return `breev-diagnostics-${now.toISOString().replace(/[:.]/gu, "-")}.json`;
}

export async function readRecentDiagnosticLogs(
  directory: string,
): Promise<unknown[]> {
  const names = [
    "desktop.ndjson",
    "desktop-fatal.ndjson",
    ...Array.from(
      { length: MAXIMUM_LOG_FILES - 2 },
      (_, index) => `desktop.${index + 1}.ndjson`,
    ),
  ];
  const result: unknown[] = [];
  for (const name of names) {
    try {
      const content = await readFile(path.join(directory, name), "utf8");
      const tail = content.slice(-MAXIMUM_LOG_BYTES_PER_FILE);
      for (const line of tail.split(/\r?\n/gu)) {
        const record = safeLogRecord(line);
        if (record !== undefined) result.push(record);
      }
    } catch {
      // Missing, locked, or malformed log files do not block offline export.
    }
  }
  return result.slice(-2_000);
}

function safeLogRecord(line: string): Record<string, unknown> | undefined {
  if (line.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return undefined;
    const source = parsed as Record<string, unknown>;
    if (typeof source.event !== "string" || !SAFE_LOG_EVENTS.has(source.event))
      return undefined;
    const result: Record<string, unknown> = {};
    for (const key of SAFE_LOG_KEYS) {
      const value = source[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

async function inspectLocalApi(
  origin: string,
): Promise<{ readonly state: string; readonly statusCode?: number }> {
  try {
    const response = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    let state = response.ok ? "healthy" : "degraded";
    try {
      const body = (await response.json()) as { status?: unknown };
      if (
        ["healthy", "degraded", "repair-required"].includes(String(body.status))
      ) {
        state = String(body.status);
      }
    } catch {
      state = response.ok ? "reachable" : "degraded";
    }
    return { state, statusCode: response.status };
  } catch {
    return { state: "unreachable" };
  }
}

async function inspectWindowsService(
  role: DesktopDeviceRole,
): Promise<{ readonly state: string }> {
  if (process.platform !== "win32" || role !== "main")
    return { state: "not-applicable" };
  try {
    const { stdout } = await executeFile("sc.exe", ["query", "BreevLocalApi"], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    return { state: parseWindowsServiceState(stdout) };
  } catch {
    return { state: "unknown" };
  }
}

export function parseWindowsServiceState(output: string): string {
  const state = /STATE\s*:\s*\d+\s+([A-Z_]+)/iu
    .exec(output)?.[1]
    ?.toUpperCase();
  return state === "RUNNING"
    ? "running"
    : state === "STOPPED"
      ? "stopped"
      : state === undefined
        ? "unknown"
        : "transitioning";
}
