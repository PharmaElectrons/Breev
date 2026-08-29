import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { validateProofResults } from "./aggregate-mtls-results.mjs";
import { runOperatorAction } from "./main-pairing-operator.mjs";
import {
  prepareSyntheticIssuer,
  seedPairingPrerequisites,
} from "./seed-pairing-prereqs.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const LOCAL_API_ROOT = path.join(REPOSITORY_ROOT, "apps/local-api");
const LOCAL_API_MAIN = path.join(LOCAL_API_ROOT, "dist/main.js");
const LICENCE_OVERRIDE = path.join(
  import.meta.dirname,
  "licence-key-override.mjs",
);
const DRIVER = path.join(import.meta.dirname, "peer-mtls-driver.mjs");
const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const MAIN_DEVICE_ID = "019d0000-0000-7000-8000-000000000111";

const localApiRequire = createRequire(
  path.join(LOCAL_API_ROOT, "package.json"),
);
const { PostgreSqlContainer } = localApiRequire("@testcontainers/postgresql");

test(
  "the standalone peer pairs and proves accepted, foreign, and missing mTLS identities",
  { timeout: 300_000 },
  async (context) => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "breev-peer-mtls-"),
    );
    const outputDirectory = path.join(temporaryRoot, "out");
    const issuerDirectory = path.join(temporaryRoot, "issuer");
    const provisioningPath = path.join(temporaryRoot, "main-device.json");
    const invitationPath = path.join(temporaryRoot, "invitation.json");
    const backupDirectory = path.join(temporaryRoot, "backups");
    const deviceSecret = randomBytes(32).toString("base64url");
    const sessionToken = randomBytes(32).toString("base64url");
    await writeFile(
      provisioningPath,
      `${JSON.stringify({
        deviceId: MAIN_DEVICE_ID,
        deviceSecret,
        sessionToken,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    let apiProcess;
    let postgres;
    context.after(async () => {
      await stopChild(apiProcess);
      await postgres?.stop().catch(() => undefined);
      await rm(temporaryRoot, { force: true, recursive: true });
    });

    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    const databaseRoles = await createSeparatedDatabaseRoles(postgres);
    const loopbackPort = await reservePort();
    const lanPort = await reservePort();
    const issuer = await prepareSyntheticIssuer(issuerDirectory);

    apiProcess = spawn(
      process.execPath,
      ["--import", LICENCE_OVERRIDE, LOCAL_API_MAIN],
      {
        cwd: LOCAL_API_ROOT,
        env: {
          ...process.env,
          API_HOST: "127.0.0.1",
          API_PORT: String(loopbackPort),
          BREEV_BACKUP_DIRECTORY: backupDirectory,
          BREEV_LAN_API_HOST: "127.0.0.1",
          BREEV_LAN_API_PORT: String(lanPort),
          BREEV_M1_MTLS_LICENCE_PUBLIC_KEYS_FILE: issuer.publicKeysPath,
          BREEV_MAIN_DEVICE_FILE: provisioningPath,
          DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
          DATABASE_URL: databaseRoles.applicationUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const apiOutput = captureChild(apiProcess);
    await waitForHealthyApi(loopbackPort, apiProcess, apiOutput);
    await waitForPort(lanPort, apiProcess, apiOutput);

    const seeded = await seedPairingPrerequisites({
      databaseUrl: databaseRoles.migrationUrl,
      issuerDirectory,
      mainDeviceFile: provisioningPath,
      outputDirectory: temporaryRoot,
      pgPackageRoot: LOCAL_API_ROOT,
    });
    const operatorOptions = {
      host: "127.0.0.1",
      mainDeviceFile: provisioningPath,
      port: loopbackPort,
      seedResult: seeded.resultPath,
    };
    await runOperatorAction({
      ...operatorOptions,
      action: "cancel-current",
    });
    const started = await runOperatorAction({
      ...operatorOptions,
      action: "start",
      invitationOutput: invitationPath,
    });

    const accepted = spawnDriver([
      "--case",
      "accepted",
      "--host",
      "127.0.0.1",
      "--port",
      String(lanPort),
      "--invitation-file",
      invitationPath,
      "--output-dir",
      outputDirectory,
      "--poll-interval-ms",
      "50",
      "--poll-deadline-ms",
      "60000",
    ]);
    await waitForAwaitingConfirmation(
      operatorOptions,
      accepted.child,
      accepted.output,
    );
    await runOperatorAction({
      ...operatorOptions,
      action: "confirm",
      sessionId: started.sessionId,
    });
    await accepted.completed;

    await runDriver([
      "--case",
      "foreign",
      "--host",
      "127.0.0.1",
      "--port",
      String(lanPort),
      "--invitation-file",
      invitationPath,
      "--output-dir",
      outputDirectory,
    ]);
    await runDriver([
      "--case",
      "missing",
      "--host",
      "127.0.0.1",
      "--port",
      String(lanPort),
      "--invitation-file",
      invitationPath,
      "--output-dir",
      outputDirectory,
    ]);

    const results = await Promise.all(
      ["accepted", "foreign", "missing"].map(async (caseName) =>
        JSON.parse(
          await readFile(
            path.join(outputDirectory, `${caseName}.json`),
            "utf8",
          ),
        ),
      ),
    );
    const cases = validateProofResults(results);
    assert.equal(cases.accepted.details.accepted, true);
    assert.equal(cases.accepted.details.statusCode, 200);
    assert.equal(cases.accepted.details.tlsProtocol, "TLSv1.3");
    assert.equal(cases.accepted.details.peerCertificateAccepted, true);
    assert.equal(cases.foreign.details.accepted, false);
    assert.equal(cases.foreign.details.refusalAsserted, true);
    assert.ok(
      ["cert-chain-invalid", "mtls-cert-missing", "mtls-cert-invalid"].includes(
        cases.foreign.details.denialCode,
      ),
    );
    assert.equal(cases.missing.details.accepted, false);
    assert.equal(cases.missing.details.refusalAsserted, true);
    assert.equal(cases.missing.details.denialCode, "mtls-cert-missing");
  },
);

async function createSeparatedDatabaseRoles(postgres) {
  const applicationPassword = randomBytes(24).toString("hex");
  const migrationPassword = randomBytes(24).toString("hex");
  const databaseName = postgres.getDatabase();
  if (!/^[a-z_][a-z0-9_]*$/u.test(databaseName)) {
    throw new Error("The testcontainer database name is unsafe");
  }
  const created = await postgres.exec([
    "psql",
    "--username",
    postgres.getUsername(),
    "--dbname",
    databaseName,
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    `revoke create on schema public from public;
     create role breev_schema_owner login password '${migrationPassword}';
     create role breev_app login password '${applicationPassword}';
     grant create on database "${databaseName}" to breev_schema_owner;
     grant usage, create on schema public to breev_schema_owner;
     grant usage on schema public to breev_app;`,
  ]);
  if (created.exitCode !== 0) {
    throw new Error(
      `Could not create separated database roles: ${created.stderr}`,
    );
  }
  return {
    applicationUrl: connectionUrl(postgres, "breev_app", applicationPassword),
    migrationUrl: connectionUrl(
      postgres,
      "breev_schema_owner",
      migrationPassword,
    ),
  };
}

function connectionUrl(postgres, username, password) {
  const url = new URL(postgres.getConnectionUri());
  url.username = username;
  url.password = password;
  return url.toString();
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) =>
        error === undefined ? resolve(port) : reject(error),
      );
    });
  });
}

async function waitForHealthyApi(port, child, output) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    assertChildRunning(child, output);
    try {
      const health = await httpGet(port, "/health");
      if (health.statusCode === 200 && health.body?.status === "healthy") {
        return;
      }
    } catch {
      // The built API is still migrating or opening its loopback socket.
    }
    await delay(100);
  }
  throw new Error(
    `The built local API did not become healthy: ${output.text()}`,
  );
}

async function waitForPort(port, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    assertChildRunning(child, output);
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`The LAN TLS socket did not open: ${output.text()}`);
}

function httpGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        headers: { host: `127.0.0.1:${port}` },
        hostname: "127.0.0.1",
        method: "GET",
        path: requestPath,
        port,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            body: raw.length === 0 ? undefined : JSON.parse(raw),
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function waitForAwaitingConfirmation(operatorOptions, child, output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    assertChildRunning(child, output);
    const state = await runOperatorAction({
      ...operatorOptions,
      action: "state",
    });
    if (state.state === "awaiting-confirmation") {
      return;
    }
    await delay(50);
  }
  throw new Error(
    `The peer never joined the pairing session: ${output.text()}`,
  );
}

function spawnDriver(argumentsList) {
  const child = spawn(process.execPath, [DRIVER, ...argumentsList], {
    cwd: REPOSITORY_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureChild(child);
  return {
    child,
    output,
    completed: waitForSuccessfulChild(child, output, 90_000),
  };
}

async function runDriver(argumentsList) {
  const spawned = spawnDriver(argumentsList);
  await spawned.completed;
}

function captureChild(child) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return {
    text: () => `stdout=${stdout.trim()} stderr=${stderr.trim()}`,
  };
}

function assertChildRunning(child, output) {
  if (child.exitCode !== null) {
    throw new Error(
      `A required child exited early (${child.exitCode}): ${output.text()}`,
    );
  }
}

function waitForSuccessfulChild(child, output, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`A peer case timed out: ${output.text()}`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `A peer case failed (code=${code}, signal=${signal}): ${output.text()}`,
          ),
        );
      }
    });
  });
}

async function stopChild(child) {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
