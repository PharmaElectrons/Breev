import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopDiagnostics,
  incidentCode,
  processGoneReason,
  processType,
  resolveDesktopLogDirectory,
} from "./diagnostics.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "breev-diagnostics-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("desktop diagnostics", () => {
  it("writes only the closed event fields and never an exception message", async () => {
    const directory = await temporaryDirectory();
    const logger = new DesktopDiagnostics(directory, {
      now: () => new Date("2026-09-04T01:02:03.000Z"),
    });
    logger.log({
      code: incidentCode(new Error("patient-name-canary")),
      event: "startup-failed",
    });
    await logger.flush();
    logger.close();

    const content = readFileSync(
      path.join(directory, "desktop.ndjson"),
      "utf8",
    );
    expect(content).toContain('"event":"startup-failed"');
    expect(content).toContain('"schemaVersion":1');
    expect(content).not.toContain("patient-name-canary");
  });

  it("rotates bounded files without losing the active log", async () => {
    const directory = await temporaryDirectory();
    const logger = new DesktopDiagnostics(directory, {
      fileCount: 3,
      maximumBytes: 100,
    });
    for (let index = 0; index < 8; index += 1) {
      logger.log({ event: "renderer-unresponsive" });
    }
    await logger.flush();
    logger.close();

    const files = await readdir(directory);
    expect(files).toContain("desktop.ndjson");
    expect(
      files.filter((file) => /^desktop\.\d+\.ndjson$/u.test(file)).length,
    ).toBeLessThanOrEqual(2);
  });

  it("writes a synchronous fatal breadcrumb without raw error material", async () => {
    const directory = await temporaryDirectory();
    const logger = new DesktopDiagnostics(directory);
    logger.fatal(
      incidentCode(new Error("national-id-canary")),
      "uncaughtException",
    );
    logger.close();

    const content = readFileSync(
      path.join(directory, "desktop-fatal.ndjson"),
      "utf8",
    );
    expect(content).toContain('"origin":"uncaughtException"');
    expect(content).not.toContain("national-id-canary");
  });

  it("uses LocalAppData on Windows and closed process classifications", () => {
    expect(
      resolveDesktopLogDirectory(
        { LOCALAPPDATA: "C:\\Users\\Cashier\\AppData\\Local" },
        "win32",
        "C:\\fallback",
      ),
    ).toBe(path.resolve("C:\\Users\\Cashier\\AppData\\Local", "Breev", "logs"));
    expect(processGoneReason("crashed")).toBe("crashed");
    expect(processGoneReason("patient-canary")).toBe("unknown");
    expect(processType("GPU")).toBe("GPU");
    expect(processType("patient-canary")).toBe("Unknown");
  });
});
