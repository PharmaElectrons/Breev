import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";

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
const uiAutomationPath = path.join(
  import.meta.dirname,
  "DesktopUiAutomation.ps1",
);
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "breev-issue-34-standard-user-"),
);
const profilePath = path.join(temporaryRoot, "profile");
const liveDesktopProcessIds = new Set();
const stateText = Object.freeze({
  "main-unavailable": "Main unavailable",
  ready: "Ready",
});
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
  userSid: runPowerShell(
    "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  ),
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
  const expectedHandshake = {
    apiVersion: initialHealth.body.apiVersion,
    schemaVersion: initialHealth.body.schemaVersion,
  };

  const firstRun = await launchAndInspect(executablePath, screenshotPath);
  result.checks.desktopReady = firstRun.ready;
  await closeDesktopWindows(firstRun.pid);
  result.checks.desktopExitsWhenLastWindowCloses = await waitForProcessExit(
    firstRun.pid,
  );
  if (result.checks.desktopExitsWhenLastWindowCloses) {
    liveDesktopProcessIds.delete(firstRun.pid);
  }

  const postCloseHealth = await fetchHealth();
  result.checks.apiHealthyAfterEveryWindowCloses = isHealthy(
    postCloseHealth,
    expectedHandshake,
  );
  if (!result.checks.apiHealthyAfterEveryWindowCloses) {
    throw new Error("Closing Electron also stopped or damaged the local API");
  }

  const secondRun = await launchAndInspect(executablePath);
  await writeJson(restartReadyPath, {
    schemaVersion: 1,
    runId,
    desktopProcessId: secondRun.pid,
    desktopExecutablePath: executablePath,
    desktopUserSid: result.userSid,
    readyAtUtc: new Date().toISOString(),
  });
  const stoppedResult = await waitForJson(restartStoppedPath, 90_000);
  if (stoppedResult.runId !== runId || stoppedResult.apiUnavailable !== true) {
    throw new Error(
      "The API restart controller did not prove the stopped phase",
    );
  }
  const duringRestart = await inspectDesktop(secondRun.pid, "main-unavailable");
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
  const afterRestart = await inspectDesktop(secondRun.pid, "ready");
  result.checks.desktopReadyAfterApiRestart = afterRestart.ready;
  const killedProcessIds = await forceKillTree(secondRun.pid);
  result.checks.completeElectronTreeForceKilled = killedProcessIds.length > 1;

  const postKillHealth = await fetchHealth();
  result.checks.apiHealthyAfterElectronTreeKill = isHealthy(
    postKillHealth,
    expectedHandshake,
  );
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
  const cleanupErrors = [];
  for (const processId of liveDesktopProcessIds) {
    if (!processExists(processId)) continue;
    await forceKillTree(processId).catch((error) => {
      cleanupErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    });
  }
  await rm(temporaryRoot, { recursive: true, force: true }).catch((error) => {
    cleanupErrors.push(
      `Temporary desktop profile cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  result.observations.cleanupErrors = cleanupErrors;
  if (cleanupErrors.length > 0) {
    result.passed = false;
    const cleanupMessage = cleanupErrors.join("; ");
    result.error = result.error
      ? `${result.error}; ${cleanupMessage}`
      : cleanupMessage;
  }
  result.completedAtUtc = new Date().toISOString();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (!result.passed) {
  process.exitCode = 1;
}

async function launchAndInspect(executable, screenshot) {
  const desktop = spawn(
    executable,
    ["--force-renderer-accessibility", `--user-data-dir=${profilePath}`],
    { detached: false, stdio: "ignore" },
  );
  if (desktop.pid === undefined) {
    throw new Error("Electron did not report a process ID");
  }
  liveDesktopProcessIds.add(desktop.pid);
  try {
    const observation = runUiAutomation(
      "WaitForText",
      desktop.pid,
      stateText.ready,
      screenshot,
    );
    return { pid: desktop.pid, ready: observation.matched === true };
  } catch (error) {
    await forceKillTree(desktop.pid).catch(() => undefined);
    throw error;
  }
}

async function inspectDesktop(processId, expectedState) {
  const observation = runUiAutomation(
    "WaitForText",
    processId,
    stateText[expectedState],
  );
  return {
    ready: expectedState === "ready" && observation.matched === true,
    state: observation.matched === true ? expectedState : "not-observed",
  };
}

async function closeDesktopWindows(processId) {
  const observation = runUiAutomation("CloseWindows", processId);
  if (
    observation.windowCount < 1 ||
    observation.closed !== observation.windowCount
  ) {
    throw new Error("Windows UI Automation did not close every desktop window");
  }
}

function runUiAutomation(action, processId, expectedText, screenshot) {
  const argumentsList = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    uiAutomationPath,
    "-Action",
    action,
    "-ProcessId",
    String(processId),
  ];
  if (expectedText !== undefined) {
    argumentsList.push("-ExpectedText", expectedText);
  }
  if (screenshot !== undefined) {
    argumentsList.push("-ScreenshotPath", screenshot);
  }
  const completed = spawnSync("powershell.exe", argumentsList, {
    encoding: "utf8",
  });
  if (completed.status !== 0) {
    throw new Error(
      completed.stderr.trim() ||
        "Windows UI Automation could not observe the Breev desktop",
    );
  }
  return JSON.parse(completed.stdout);
}

async function fetchHealth() {
  const response = await fetch("http://127.0.0.1:31310/health", {
    signal: AbortSignal.timeout(5_000),
  });
  return { statusCode: response.status, body: await response.json() };
}

function isHealthy(response, expectedHandshake) {
  return (
    response.statusCode === 200 &&
    response.body.status === "healthy" &&
    response.body.database === "available" &&
    typeof response.body.apiVersion === "string" &&
    typeof response.body.schemaVersion === "string" &&
    (expectedHandshake === undefined ||
      (response.body.apiVersion === expectedHandshake.apiVersion &&
        response.body.schemaVersion === expectedHandshake.schemaVersion))
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
      liveDesktopProcessIds.delete(pid);
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
