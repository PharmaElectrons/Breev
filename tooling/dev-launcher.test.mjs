import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const turboCli = path.join(root, "node_modules/turbo/bin/turbo");

const launcherEnvironment = {
  API_HOST: "launcher-api-host",
  API_PORT: "31310",
  BREEV_DEVICE_ROLE: "main",
  BREEV_LOCAL_API_URL: "http://127.0.0.1:31310",
  BREEV_MAIN_DEVICE_ID: "launcher-device-id",
  BREEV_MAIN_DEVICE_SECRET: "launcher-device-secret",
  BREEV_MAIN_DEVICE_SESSION: "launcher-device-session",
  BREEV_TERMINAL_STATE_DIR: "launcher-terminal-state",
  DATABASE_MIGRATION_URL: "launcher-migration-url",
  DATABASE_URL: "launcher-database-url",
};

test("Turbo passes launcher-owned runtime configuration to start tasks", () => {
  const result = spawnSync(
    process.execPath,
    [
      turboCli,
      "run",
      "start",
      "--filter=@breev/desktop",
      "--filter=@breev/local-api",
      "--dry=json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...launcherEnvironment },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const startTasks = report.tasks.filter((task) => task.task === "start");
  assert.equal(startTasks.length, 2);

  for (const task of startTasks) {
    const passedThrough = new Set(
      (task.environmentVariables.passthrough ?? []).map(
        (entry) => entry.split("=", 1)[0],
      ),
    );
    for (const variable of Object.keys(launcherEnvironment)) {
      assert.ok(
        passedThrough.has(variable),
        `${task.taskId} did not receive ${variable}`,
      );
    }
  }

  for (const value of [
    launcherEnvironment.BREEV_MAIN_DEVICE_SECRET,
    launcherEnvironment.BREEV_MAIN_DEVICE_SESSION,
    launcherEnvironment.DATABASE_MIGRATION_URL,
    launcherEnvironment.DATABASE_URL,
  ]) {
    assert.ok(!result.stdout.includes(value));
  }
});
