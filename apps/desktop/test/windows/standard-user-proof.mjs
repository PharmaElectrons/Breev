import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { hostname, userInfo } from "node:os";
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

if (process.platform !== "win32") {
  throw new Error("The standard-user proof must run on Windows");
}

const executablePath = path.resolve(readArgument("--executable"));
const outputPath = path.resolve(readArgument("--output"));
const screenshotPath = path.resolve(readArgument("--screenshot"));
const restartReadyPath = path.resolve(readArgument("--restart-ready"));
const restartCompletePath = path.resolve(readArgument("--restart-complete"));
const runId = readArgument("--run-id");
const sourceCommit = readArgument("--source-commit");
const snapshotId = readArgument("--snapshot-id");
const protectedDataRoot = path.resolve(readArgument("--protected-data-root"));
const restartStoppedPath = `${restartCompletePath}.stopped`;
const restartUnavailablePath = `${restartReadyPath}.unavailable`;
await Promise.all(
  [
    restartReadyPath,
    restartCompletePath,
    restartStoppedPath,
    restartUnavailablePath,
  ].map((markerPath) =>
    unlink(markerPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    }),
  ),
);
const result = {
  schemaVersion: 1,
  runId,
  sourceCommit,
  snapshotId,
  machine: hostname(),
  machineId: runPowerShell(
    "(Get-CimInstance Win32_ComputerSystemProduct).UUID",
  ),
  desktopExecutableSha256: await sha256(executablePath),
  user: userInfo().username,
  startedAtUtc: new Date().toISOString(),
  checks: {},
  observations: {},
  passed: false,
};

try {
  const isAdministrator = runPowerShell(
    "$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
  );
  const isAdministratorsGroupMember = runPowerShell(
    "$i=[Security.Principal.WindowsIdentity]::GetCurrent();$i.Groups.Value -contains 'S-1-5-32-544'",
  );
  result.checks.standardUser =
    isAdministrator === "False" && isAdministratorsGroupMember === "False";
  if (!result.checks.standardUser) {
    throw new Error(
      "The proof account is an administrator or has an administrator token",
    );
  }
  const runtimeSecretRead = await readDenial(
    path.join(protectedDataRoot, "config", "database-url"),
  );
  result.checks.standardUserCannotReadRuntimeSecret = runtimeSecretRead.denied;
  result.observations.runtimeSecretReadErrorCode = runtimeSecretRead.errorCode;
  const postgresqlDataRead = await readDenial(
    path.join(protectedDataRoot, "postgresql", "PG_VERSION"),
  );
  result.checks.standardUserCannotReadPostgresqlData =
    postgresqlDataRead.denied;
  result.observations.postgresqlDataReadErrorCode =
    postgresqlDataRead.errorCode;
  const deniedWritePath = path.join(
    protectedDataRoot,
    `issue-34-standard-user-${runId}.txt`,
  );
  const protectedWrite = await writeDenial(deniedWritePath);
  result.checks.standardUserCannotWriteProtectedData = protectedWrite.denied;
  result.observations.protectedWriteErrorCode = protectedWrite.errorCode;

  const gatewayCount = Number.parseInt(
    runPowerShell(
      "([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object {$_.GetIPProperties().GatewayAddresses} | Measure-Object).Count",
    ),
    10,
  );
  const externalRequestFailed = await fetch("https://www.microsoft.com/", {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  }).then(
    () => false,
    () => true,
  );
  result.checks.internetDisconnected = externalRequestFailed;
  result.observations.guestDefaultGatewayCount = gatewayCount;
  if (!result.checks.internetDisconnected) {
    throw new Error("The offline proof reached an external HTTPS endpoint");
  }

  const initialHealth = await fetchHealth();
  result.checks.initialApiHealth = isHealthy(initialHealth);
  if (!result.checks.initialApiHealth) {
    throw new Error("The local API was not healthy before the desktop started");
  }

  const firstRun = await launchAndInspect(executablePath, screenshotPath);
  result.checks.desktopReady = firstRun.ready;
  result.checks.packagedProtocol = firstRun.url.startsWith("breev://app/");
  await closeDesktopWindow(firstRun.port);
  result.checks.desktopExitsWhenLastWindowCloses = await waitForProcessExit(
    firstRun.pid,
  );

  const postCloseHealth = await fetchHealth();
  result.checks.apiHealthyAfterEveryWindowCloses = isHealthy(postCloseHealth);
  if (!result.checks.apiHealthyAfterEveryWindowCloses) {
    throw new Error("Closing Electron also stopped or damaged the local API");
  }

  const secondRun = await launchAndInspect(executablePath);
  await writeJson(restartReadyPath, {
    schemaVersion: 1,
    runId,
    desktopProcessId: secondRun.pid,
    desktopExecutablePath: executablePath,
    desktopUser: result.user,
    readyAtUtc: new Date().toISOString(),
  });
  const stoppedResult = await waitForJson(restartStoppedPath, 90_000);
  if (stoppedResult.runId !== runId || stoppedResult.apiUnavailable !== true) {
    throw new Error(
      "The API restart controller did not prove the stopped phase",
    );
  }
  const duringRestart = await inspectDesktop(
    secondRun.port,
    "main-unavailable",
  );
  result.checks.desktopObservedApiOutage =
    duringRestart.state === "main-unavailable";
  await writeJson(restartUnavailablePath, {
    schemaVersion: 1,
    runId,
    desktopProcessId: secondRun.pid,
    observedAtUtc: new Date().toISOString(),
  });
  const restartResult = await waitForJson(restartCompletePath, 90_000);
  result.checks.apiRestartControllerPassed =
    restartResult.passed === true && restartResult.runId === runId;
  const afterRestart = await inspectDesktop(secondRun.port, "ready");
  result.checks.desktopReadyAfterApiRestart = afterRestart.ready;
  const killedProcessIds = await forceKillTree(secondRun.pid);
  result.checks.completeElectronTreeForceKilled = killedProcessIds.length > 1;

  const postKillHealth = await fetchHealth();
  result.checks.apiHealthyAfterElectronTreeKill = isHealthy(postKillHealth);
  if (!result.checks.apiHealthyAfterElectronTreeKill) {
    throw new Error("Killing Electron also stopped or damaged the local API");
  }

  const thirdRun = await launchAndInspect(executablePath);
  result.checks.desktopRestartsReady = thirdRun.ready;
  await forceKillTree(thirdRun.pid);

  result.passed = Object.values(result.checks).every(Boolean);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  result.completedAtUtc = new Date().toISOString();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (!result.passed) {
  process.exitCode = 1;
}

async function launchAndInspect(executable, screenshot) {
  const port = await reservePort();
  const desktop = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${outputPath}.profile`,
    ],
    { detached: false, stdio: "ignore" },
  );
  try {
    const browser = await connectToDesktop(port);
    try {
      const page = await waitForWindow(browser);
      await waitForShellState(page, "ready");
      const ready = true;
      if (screenshot !== undefined) {
        await mkdir(path.dirname(screenshot), { recursive: true });
        await page.screenshot({ animations: "disabled", path: screenshot });
      }
      return { pid: desktop.pid, port, ready, url: page.url() };
    } finally {
      await browser.close();
    }
  } catch (error) {
    await forceKillTree(desktop.pid).catch(() => undefined);
    throw error;
  }
}

async function inspectDesktop(port, expectedState) {
  const browser = await connectToDesktop(port);
  try {
    const page = await waitForWindow(browser);
    await waitForShellState(page, expectedState);
    return {
      ready: expectedState === "ready",
      state: expectedState,
      url: page.url(),
    };
  } finally {
    await browser.close();
  }
}

async function waitForShellState(page, expectedState) {
  await page.locator(`[data-state="${expectedState}"]`).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function closeDesktopWindow(port) {
  const browser = await connectToDesktop(port);
  try {
    const page = await waitForWindow(browser);
    await page.close();
  } finally {
    await browser.close();
  }
}

async function connectToDesktop(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await delay(200);
    }
  }
  throw new Error("The packaged desktop debugging endpoint did not start");
}

async function waitForWindow(browser) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page !== undefined) return page;
    await delay(100);
  }
  throw new Error("The packaged desktop did not create a window");
}

async function fetchHealth() {
  const response = await fetch("http://127.0.0.1:31310/health", {
    signal: AbortSignal.timeout(5_000),
  });
  return { statusCode: response.status, body: await response.json() };
}

function isHealthy(response) {
  return (
    response.statusCode === 200 &&
    response.body.status === "healthy" &&
    response.body.database === "available"
  );
}

async function forceKillTree(pid) {
  if (pid === undefined)
    throw new Error("Electron did not report a process ID");
  const processIds = listProcessTree(pid);
  const killed = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
  });
  if (killed.status !== 0 && !killed.stdout.includes("not found")) {
    throw new Error("Could not force-kill the complete Electron process tree");
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (processIds.every((processId) => !processExists(processId))) {
      return processIds;
    }
    await delay(100);
  }
  throw new Error("At least one Electron descendant survived taskkill /T /F");
}

function listProcessTree(rootProcessId) {
  const script = [
    `$all=@(Get-CimInstance Win32_Process);$found=[Collections.Generic.List[int]]::new();$pending=[Collections.Generic.Queue[int]]::new();$pending.Enqueue(${rootProcessId});`,
    "while($pending.Count -gt 0){$id=$pending.Dequeue();if(-not $found.Contains($id)){$found.Add($id);$all|Where-Object ParentProcessId -eq $id|ForEach-Object{$pending.Enqueue([int]$_.ProcessId)}}};",
    "$found -join ','",
  ].join("");
  const output = runPowerShell(script);
  return output
    .split(",")
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10));
}

function processExists(processId) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `if(Get-Process -Id ${processId} -ErrorAction SilentlyContinue){exit 0}else{exit 1}`,
    ],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

async function waitForProcessExit(processId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!processExists(processId)) return true;
    await delay(100);
  }
  return false;
}

async function readDenial(filePath) {
  try {
    await readFile(filePath);
    return { denied: false, errorCode: null };
  } catch (error) {
    return {
      denied: error?.code === "EACCES" || error?.code === "EPERM",
      errorCode: error?.code ?? "UNKNOWN",
    };
  }
}

async function writeDenial(filePath) {
  try {
    await writeFile(filePath, "must not be written", "utf8");
    await unlink(filePath).catch(() => undefined);
    return { denied: false, errorCode: null };
  } catch (error) {
    return {
      denied: error?.code === "EACCES" || error?.code === "EPERM",
      errorCode: error?.code ?? "UNKNOWN",
    };
  }
}

async function waitForJson(filePath, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(
        (await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""),
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await delay(200);
    }
  }
  throw new Error("The API restart controller did not complete");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runPowerShell(command) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error("A standard-user environment check failed");
  }
  return result.stdout.trim();
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

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
