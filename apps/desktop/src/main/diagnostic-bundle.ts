import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  DesktopDeviceRole,
  TerminalPairingStage,
} from "@breev/contracts/desktop-preload";

import {
  containsDiagnosticCanary,
  redactDiagnosticValue,
} from "./diagnostic-redaction.js";

const executeFile = promisify(execFile);
const MAXIMUM_LOG_FILES = 5;
const MAXIMUM_LOG_BYTES_PER_FILE = 512 * 1024;
const SAFE_LOG_EVENTS = new Set([
  "app-ready",
  "child-process-gone",
  "main-fatal",
  "main-unhandled-rejection",
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

export interface DiagnosticBundleInput {
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly incidentCode?: string;
  readonly localApiOrigin: string;
  readonly logDirectory: string;
  readonly nodeVersion: string;
  readonly pairingStage: TerminalPairingStage | "not-applicable";
  readonly role: DesktopDeviceRole;
}

export async function createDiagnosticBundle(
  input: DiagnosticBundleInput,
): Promise<unknown> {
  const [localApi, service, logs] = await Promise.all([
    inspectLocalApi(input.localApiOrigin),
    inspectWindowsService(input.role),
    readRecentDiagnosticLogs(input.logDirectory),
  ]);
  const createdAt = new Date().toISOString();
  const bundle = redactDiagnosticValue({
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
    logs,
    schemaVersion: 1,
    service,
    system: { architecture: arch(), platform: platform(), release: release() },
    terminal: { pairingStage: input.pairingStage, role: input.role },
  });
  const serialized = JSON.stringify(bundle);
  if (containsDiagnosticCanary(serialized)) {
    throw new Error("Diagnostic bundle redaction failed closed");
  }
  return bundle;
}

export async function writeDiagnosticBundle(
  filePath: string,
  bundle: unknown,
): Promise<void> {
  const safeBundle = redactDiagnosticValue(bundle);
  const serialized = JSON.stringify(safeBundle, null, 2) + "\n";
  if (containsDiagnosticCanary(serialized)) {
    throw new Error("Diagnostic bundle redaction failed closed");
  }
  await writeFile(filePath, serialized, {
    encoding: "utf8",
    flag: "w",
    mode: 0o600,
  });
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
    return redactDiagnosticValue(result) as Record<string, unknown>;
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
