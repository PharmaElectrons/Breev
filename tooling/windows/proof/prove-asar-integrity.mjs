import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

if (process.platform !== "win32") {
  throw new Error("The ASAR integrity proof must run on Windows");
}

const executablePath = path.resolve(readArgument("--executable"));
const outputPath = path.resolve(readArgument("--output"));
const candidate = readArgument("--candidate");
const version = readArgument("--version");
const runId = readArgument("--run-id");
const sourceCommit = readArgument("--source-commit");
const snapshotId = readArgument("--snapshot-id");
if (!new Set(["electron-builder", "electron-forge"]).has(candidate)) {
  throw new Error("--candidate must be electron-builder or electron-forge");
}
const applicationRoot = path.dirname(executablePath);
const originalAsarPath = path.join(applicationRoot, "resources", "app.asar");
const result = {
  schemaVersion: 1,
  runId,
  sourceCommit,
  snapshotId,
  candidate,
  version,
  machine: hostname(),
  machineId: runPowerShell(
    "(Get-CimInstance Win32_ComputerSystemProduct).UUID",
  ),
  executable: executablePath,
  executableSha256: await sha256(executablePath),
  asarSha256: await sha256(originalAsarPath),
  originalStartedReady: false,
  copiedStartedReady: false,
  tamperedStartedReady: false,
  tamperedAsarOffsets: [],
  passed: false,
  startedAtUtc: new Date().toISOString(),
};
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "breev-issue-34-asar-"),
);

try {
  const original = await launchAndCheck(executablePath);
  result.originalStartedReady = original.ready;

  const copiedApplicationRoot = path.join(temporaryRoot, "application");
  await cp(applicationRoot, copiedApplicationRoot, { recursive: true });
  const copiedExecutablePath = path.join(
    copiedApplicationRoot,
    path.basename(executablePath),
  );
  const asarPath = path.join(copiedApplicationRoot, "resources", "app.asar");
  const copied = await launchAndCheck(copiedExecutablePath);
  result.copiedStartedReady = copied.ready;
  if (!result.copiedStartedReady) {
    throw new Error(
      "The unmodified relocated application did not become ready",
    );
  }
  const asar = await readFile(asarPath);
  const marker = Buffer.from("breev://app", "utf8");
  let offset = asar.indexOf(marker);
  while (offset !== -1) {
    asar[offset] ^= 0x01;
    result.tamperedAsarOffsets.push(offset);
    offset = asar.indexOf(marker, offset + marker.length);
  }
  if (result.tamperedAsarOffsets.length === 0) {
    throw new Error("Could not locate loaded application code inside app.asar");
  }
  await writeFile(asarPath, asar);
  result.tamperedAsarSha256 = await sha256(asarPath);

  const tampered = await launchAndCheck(copiedExecutablePath);
  result.tamperedStartedReady = tampered.ready;
  result.passed =
    result.originalStartedReady &&
    result.copiedStartedReady &&
    !result.tamperedStartedReady;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  result.completedAtUtc = new Date().toISOString();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (!result.passed) {
  process.exitCode = 1;
}

async function launchAndCheck(executable) {
  const port = await reservePort();
  const profilePath = path.join(
    temporaryRoot,
    `profile-${path.basename(executable)}-${port}`,
  );
  const application = spawn(
    executable,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`],
    { stdio: "ignore" },
  );
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && application.exitCode === null) {
      try {
        const browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${port}`,
        );
        try {
          const page = browser.contexts()[0]?.pages()[0];
          if (page !== undefined) {
            await page.locator('[data-state="ready"]').waitFor({
              state: "visible",
              timeout: 5_000,
            });
            return { ready: true };
          }
        } finally {
          await browser.close();
        }
      } catch {
        await delay(200);
      }
    }
    return { ready: false };
  } finally {
    if (application.exitCode === null) {
      spawnSync("taskkill.exe", ["/PID", String(application.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    }
  }
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function runPowerShell(command) {
  const completed = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8" },
  );
  if (completed.status !== 0)
    throw new Error("Could not read the Windows machine identity");
  return completed.stdout.trim();
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
