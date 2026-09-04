import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  diagnosticFileName,
  parseWindowsServiceState,
  readInstallerLifecycle,
  readRecentDiagnosticLogs,
  writeDiagnosticBundle,
} from "./diagnostic-bundle.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((value) => rm(value, { recursive: true, force: true })),
  );
});

describe("diagnostic bundle", () => {
  it("collects only allowlisted structured log fields", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "breev-bundle-"));
    directories.push(directory);
    await writeFile(
      path.join(directory, "desktop.ndjson"),
      [
        JSON.stringify({
          event: "renderer-incident",
          code: "VIEW-0123ABCD",
          source: "workspace",
          patient: "patient-name-canary",
        }),
        JSON.stringify({ event: "invented", message: "secret-canary" }),
      ].join("\n"),
    );
    const logs = await readRecentDiagnosticLogs(directory);
    const serialized = JSON.stringify(logs);
    expect(serialized).toContain("VIEW-0123ABCD");
    expect(serialized).not.toContain("patient-name-canary");
    expect(serialized).not.toContain("secret-canary");
  });

  it("redacts again at the write boundary", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "breev-bundle-"));
    directories.push(directory);
    const destination = path.join(directory, "diagnostics.json");
    await writeDiagnosticBundle(destination, {
      status: "healthy",
      patientName: "patient-name-canary",
      token: "token-canary",
    });
    const content = await readFile(destination, "utf8");
    expect(content).toContain("healthy");
    expect(content).not.toContain("patient-name-canary");
    expect(content).not.toContain("token-canary");
  });

  it("uses a portable timestamped file name and parses service states", () => {
    expect(diagnosticFileName(new Date("2026-09-04T01:02:03.456Z"))).toBe(
      "breev-diagnostics-2026-09-04T01-02-03-456Z.json",
    );
    expect(parseWindowsServiceState("STATE : 4 RUNNING")).toBe("running");
    expect(parseWindowsServiceState("STATE : 1 STOPPED")).toBe("stopped");
    expect(parseWindowsServiceState("untrusted output")).toBe("unknown");
  });

  it("omits raw installer errors while preserving its failure stage", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "breev-programdata-"));
    directories.push(directory);
    const stateDirectory = path.join(directory, "Breev", "state");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      path.join(stateDirectory, "lifecycle.json"),
      JSON.stringify({
        action: "Install",
        completedAtUtc: "2026-09-04T01:02:03.0000000Z",
        error: "patient-name-canary token-canary",
        failurePoint: "AfterApiService",
        schemaVersion: 2,
        status: "failed-data-preserved",
      }),
    );
    const serialized = JSON.stringify(await readInstallerLifecycle(directory));
    expect(serialized).toContain("AfterApiService");
    expect(serialized).toContain("failed-data-preserved");
    expect(serialized).not.toContain("patient-name-canary");
    expect(serialized).not.toContain("token-canary");
  });
});
