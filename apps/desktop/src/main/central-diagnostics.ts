import { randomBytes } from "node:crypto";

import {
  containsDiagnosticCanary,
  redactDiagnosticValue,
} from "./diagnostic-redaction.js";

const MAXIMUM_ENVELOPE_BYTES = 200 * 1024;

export interface CentralDiagnosticConfiguration {
  readonly dsn: string;
  readonly endpoint: string;
}

export interface CentralDiagnosticInput {
  readonly appVersion: string;
  readonly bundle: unknown;
  readonly incidentCode?: string;
}

export function readCentralDiagnosticConfiguration(
  environment: NodeJS.ProcessEnv,
): CentralDiagnosticConfiguration | undefined {
  if (environment.BREEV_DIAGNOSTIC_REPORTING !== "manual") return undefined;
  return parseSentryDsn(environment.BREEV_SENTRY_DSN);
}

export async function submitCentralDiagnostic(
  configuration: CentralDiagnosticConfiguration,
  input: CentralDiagnosticInput,
  fetcher: typeof fetch = fetch,
): Promise<
  | { readonly status: "failed" }
  | { readonly reportId: string; readonly status: "submitted" }
> {
  const eventId = randomBytes(16).toString("hex");
  const event = redactDiagnosticValue({
    event_id: eventId,
    fingerprint: ["breev-desktop", input.incidentCode ?? "operator-report"],
    level: "error",
    message: `Breev desktop diagnostic ${input.incidentCode ?? "operator-report"}`,
    platform: "node",
    release: `breev-desktop@${input.appVersion}`,
    timestamp: Date.now() / 1_000,
    extra: { diagnostics: compactBundle(input.bundle) },
  });
  const envelope = [
    JSON.stringify({
      dsn: configuration.dsn,
      event_id: eventId,
      sent_at: new Date().toISOString(),
      sdk: { name: "breev.desktop.manual", version: "1" },
    }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  if (
    Buffer.byteLength(envelope) > MAXIMUM_ENVELOPE_BYTES ||
    containsDiagnosticCanary(envelope)
  ) {
    return { status: "failed" };
  }
  try {
    const response = await fetcher(configuration.endpoint, {
      body: envelope,
      headers: { "Content-Type": "application/x-sentry-envelope" },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok
      ? { reportId: eventId, status: "submitted" }
      : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

function compactBundle(bundle: unknown): unknown {
  const redacted = redactDiagnosticValue(bundle);
  if (
    redacted === null ||
    typeof redacted !== "object" ||
    Array.isArray(redacted)
  ) {
    return {};
  }
  const source = redacted as Record<string, unknown>;
  const logs = Array.isArray(source.logs) ? source.logs.slice(-50) : [];
  return {
    application: source.application,
    connectivity: source.connectivity,
    incident: source.incident,
    installer: source.installer,
    recentEvents: logs,
    schemaVersion: source.schemaVersion,
    service: source.service,
    system: source.system,
    terminal: source.terminal,
  };
}

function parseSentryDsn(
  value: string | undefined,
): CentralDiagnosticConfiguration | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  try {
    const dsn = new URL(value.trim());
    const pathParts = dsn.pathname.split("/").filter(Boolean);
    const projectId = pathParts.pop();
    if (
      dsn.protocol !== "https:" ||
      !/^[A-Za-z0-9]+$/u.test(dsn.username) ||
      dsn.password !== "" ||
      projectId === undefined ||
      !/^\d+$/u.test(projectId) ||
      dsn.search !== "" ||
      dsn.hash !== ""
    ) {
      return undefined;
    }
    const basePath = pathParts.length === 0 ? "" : `/${pathParts.join("/")}`;
    const publicDsn = `${dsn.protocol}//${dsn.username}@${dsn.host}${basePath}/${projectId}`;
    return {
      dsn: publicDsn,
      endpoint: `${dsn.protocol}//${dsn.host}${basePath}/api/${projectId}/envelope/`,
    };
  } catch {
    return undefined;
  }
}
