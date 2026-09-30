import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

// CI owns this disposable cluster. Never discover or connect to an installed
// service, and never place its generated administrator credential in evidence.
if (process.platform !== "win32")
  throw new Error("Windows report checks require Windows");
if (!process.env.npm_execpath)
  throw new Error("Run through pnpm test:reports:windows");
const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "artifacts/windows/ci");
const cluster = await mkdtemp(path.join(os.tmpdir(), "breev-report-ci-"));
const bin = path.join(root, "artifacts/windows/payload/postgresql/bin");
const data = path.join(cluster, "data");
const evidence = {
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  platform: `${process.platform}/${process.arch}`,
  node: process.version,
  certificationEvidence: false,
  physicalNarratorEvidence: false,
  runUrl: process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  checks: [],
};
await mkdir(output, { recursive: true });
let started = false;
async function run(executable, args, logName, env = process.env) {
  const log = await open(path.join(output, logName), "w");
  try {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      stdio: ["ignore", log.fd, log.fd],
    });
    const [code] = await once(child, "exit");
    if (code !== 0)
      throw new Error(`${logName}: exit ${code}; inspect the recorded log`);
  } finally {
    await log.close();
  }
}
try {
  const password = randomBytes(24).toString("hex");
  const passwordFile = path.join(cluster, "password");
  await writeFile(passwordFile, password, { mode: 0o600 });
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await run(
    path.join(bin, "initdb.exe"),
    [
      "-D",
      data,
      "--username=fixture_admin",
      `--pwfile=${passwordFile}`,
      "--encoding=UTF8",
      "--locale=C",
      "--auth=scram-sha-256",
      "--data-checksums",
    ],
    "report-initdb.log",
  );
  await run(
    path.join(bin, "pg_ctl.exe"),
    [
      "-D",
      data,
      "-l",
      path.join(cluster, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${port}`,
      "-w",
      "start",
    ],
    "report-postgres-start.log",
  );
  started = true;
  const env = {
    ...process.env,
    BREEV_TEST_POSTGRES_ADMIN_URL: `postgresql://fixture_admin:${password}@127.0.0.1:${port}/postgres`,
  };
  const commands = [
    [
      "--filter",
      "@breev/local-api",
      "exec",
      "vitest",
      "run",
      "src/reporting/inventory-review.integration.test.ts",
      "src/reporting/inventory-authorization.integration.test.ts",
      "src/reporting/inventory-terminal-authorization.integration.test.ts",
      "src/inventory/inventory-count.integration.test.ts",
    ],
    ["--filter", "@breev/desktop", "exec", "playwright", "install", "chromium"],
    [
      "--filter",
      "@breev/desktop",
      "exec",
      "playwright",
      "test",
      "test/browser/inventory.browser.test.ts",
      "--config",
      "playwright.browser.config.ts",
      "--trace",
      "retain-on-failure",
    ],
    ["package:desktop"],
    [
      "--filter",
      "@breev/desktop",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.config.ts",
      "--trace",
      "retain-on-failure",
    ],
  ];
  for (const [index, args] of commands.entries()) {
    const check = {
      command: `pnpm ${args.join(" ")}`,
      startedAt: new Date().toISOString(),
      status: "running",
      seconds: 0,
    };
    evidence.checks.push(check);
    console.log(check.command);
    const start = performance.now();
    try {
      await run(
        process.execPath,
        [process.env.npm_execpath, ...args],
        `report-check-${index + 1}.log`,
        env,
      );
      check.status = "passed";
    } catch (error) {
      check.status = "failed";
      throw error;
    } finally {
      check.seconds = (performance.now() - start) / 1000;
    }
  }
} finally {
  try {
    if (started)
      await run(
        path.join(bin, "pg_ctl.exe"),
        ["-D", data, "-m", "fast", "-w", "stop"],
        "report-postgres-stop.log",
      );
  } finally {
    await writeFile(
      path.join(output, "report-checks.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    await rm(cluster, { recursive: true, force: true });
  }
}
