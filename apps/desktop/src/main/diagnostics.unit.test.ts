import { readFileSync, statSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesktopDiagnostics,
  DESKTOP_FATAL_LOG_MAXIMUM_BYTES,
  createRendererRecoveryPolicy,
  incidentCode,
  processGoneReason,
  processType,
  resolveDesktopLogDirectory,
  safeFingerprintMaterial,
  terminateOnUnhandledRejection,
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

  it("derives stable incident codes only from safe error and frame labels", () => {
    const first = new Error("patient-name-canary");
    first.stack =
      "Error: patient-name-canary\n at Checkout (C:\\Patients\\Alice.ts:1:2)";
    const second = new Error("other-person");
    second.stack =
      "Error: other-person\n at Checkout (D:\\Private\\Bob.ts:9:4)";
    expect(safeFingerprintMaterial(first)).toBe("Error\nCheckout");
    expect(incidentCode(first)).toBe(incidentCode(second));
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

  it("bounds the asynchronous queue during a 1,000-event burst", async () => {
    const directory = await temporaryDirectory();
    const logger = new DesktopDiagnostics(directory, {
      maximumPendingWrites: 64,
    });
    for (let index = 0; index < 1_000; index += 1) {
      logger.log({ event: "renderer-unresponsive" });
    }
    await logger.flush();
    logger.close();
    const lines = readFileSync(path.join(directory, "desktop.ndjson"), "utf8")
      .trim()
      .split(/\r?\n/gu);
    expect(lines).toHaveLength(64);
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

  it("continuously caps the fatal breadcrumb sink", async () => {
    const directory = await temporaryDirectory();
    const logger = new DesktopDiagnostics(directory);
    for (let index = 0; index < 4_000; index += 1) {
      logger.fatal("MAIN-0123ABCD", "unhandledRejection");
    }
    logger.close();
    expect(
      statSync(path.join(directory, "desktop-fatal.ndjson")).size,
    ).toBeLessThanOrEqual(DESKTOP_FATAL_LOG_MAXIMUM_BYTES);
  });

  it("reloads one renderer crash and terminates a repeated crash loop", () => {
    let now = 1_000;
    const recover = createRendererRecoveryPolicy(() => now);
    expect(recover("clean-exit")).toBe("ignore");
    expect(recover("crashed")).toBe("reload");
    expect(recover("oom")).toBe("terminate");
    now += 60_000;
    expect(recover("crashed")).toBe("reload");
  });

  it("records unhandled rejections synchronously before terminating", () => {
    const fatal = vi.fn();
    const terminate = vi.fn();
    terminateOnUnhandledRejection(
      { fatal },
      new Error("secret-canary"),
      terminate,
    );
    expect(fatal).toHaveBeenCalledWith(
      expect.stringMatching(/^MAIN-/u),
      "unhandledRejection",
    );
    expect(terminate).toHaveBeenCalledWith(1);
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
