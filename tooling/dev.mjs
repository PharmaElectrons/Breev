import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const roleArg =
  process.argv
    .find((arg) => arg.startsWith("--role="))
    ?.split("=")[1]
    ?.trim() ??
  (process.argv.includes("terminal") || process.argv.includes("--terminal")
    ? "terminal"
    : undefined) ??
  (process.argv.includes("main") || process.argv.includes("--main")
    ? "main"
    : undefined) ??
  process.env.BREEV_DEVICE_ROLE?.trim() ??
  "main";

const role = roleArg === "terminal" ? "terminal" : "main";

console.log(`[breev] Starting in ${role.toUpperCase()} device mode...`);

// 1. Validate environment for the chosen role
const checkScript = path.join(root, "tooling/check-local-env.mjs");
const checkProc = spawn(process.execPath, [checkScript, `--role=${role}`], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, BREEV_DEVICE_ROLE: role },
});

checkProc.on("exit", async (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  // 2. Load role-specific env files for process inheritance
  const rootEnvFile = existsSync(path.join(root, ".env.main"))
    ? path.join(root, ".env.main")
    : path.join(root, ".env");

  const desktopEnvFile =
    role === "terminal"
      ? existsSync(path.join(root, "apps/desktop/.env.terminal"))
        ? path.join(root, "apps/desktop/.env.terminal")
        : path.join(root, "apps/desktop/.env")
      : existsSync(path.join(root, "apps/desktop/.env.main"))
        ? path.join(root, "apps/desktop/.env.main")
        : path.join(root, "apps/desktop/.env");

  const rootEnv = existsSync(rootEnvFile)
    ? parseEnv(readFileSync(rootEnvFile, "utf8"))
    : {};
  const desktopEnv = existsSync(desktopEnvFile)
    ? parseEnv(readFileSync(desktopEnvFile, "utf8"))
    : {};

  const mergedEnv = {
    ...process.env,
    ...rootEnv,
    ...desktopEnv,
    BREEV_DEVICE_ROLE: role,
  };

  if (role === "terminal") {
    delete mergedEnv.BREEV_MAIN_DEVICE_SECRET;
    delete mergedEnv.BREEV_MAIN_DEVICE_SESSION;
  }

  // 3. Start local API and Desktop UI with Turbo.
  // If the local API service is already running on the configured port,
  // skip launching a second instance and start the Desktop UI directly.
  const apiHost = mergedEnv.API_HOST || "127.0.0.1";
  const apiPort = mergedEnv.API_PORT || "31310";
  let isApiRunning = false;
  if (role === "main") {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const response = await fetch(`http://${apiHost}:${apiPort}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          const body = await response.json();
          if (body.status === "healthy" || body.status === "degraded") {
            isApiRunning = true;
            console.log(
              `[breev] Local API is already running on ${apiHost}:${apiPort} (${body.status}). Starting Desktop UI...`,
            );
            break;
          }
        }
      } catch {
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }
  }

  const turboFilters = [];
  if (role === "main" && !isApiRunning) {
    turboFilters.push("--filter=@breev/local-api");
  }
  turboFilters.push("--filter=@breev/desktop");

  // Windows resolves pnpm to a .cmd shim, and Node refuses to spawn one
  // without a shell, so the launcher needs one there.
  const isWindows = process.platform === "win32";
  const npmCmd = isWindows ? "pnpm.cmd" : "pnpm";
  const turboProc = spawn(
    npmCmd,
    ["exec", "turbo", "run", "start", ...turboFilters],
    {
      cwd: root,
      stdio: "inherit",
      env: mergedEnv,
      shell: isWindows,
    },
  );

  const forwardSignals = ["SIGINT", "SIGTERM", "SIGBREAK"];
  for (const signal of forwardSignals) {
    process.on(signal, () => {
      turboProc.kill(signal);
    });
  }

  turboProc.on("exit", (turboCode) => {
    process.exit(turboCode ?? 0);
  });
});
