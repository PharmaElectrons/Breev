/**
 * Loopback-only operator calls used to drive the Main half of the ceremony.
 * The script reads the installed binding in the guest and never prints it.
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function runOperatorAction(options) {
  const provisioning = JSON.parse(
    await readFile(path.resolve(options.mainDeviceFile), "utf8"),
  );
  assertProvisioning(provisioning);
  const seed = JSON.parse(
    await readFile(path.resolve(options.seedResult), "utf8"),
  );
  if (seed.synthetic !== true || typeof seed.challengeId !== "string") {
    throw new Error("The synthetic seed result is invalid");
  }
  const context = {
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 31_310,
    provisioning,
  };
  switch (options.action) {
    case "cancel-current":
      return await cancelCurrent(context);
    case "confirm":
      return await confirm(context, options.sessionId);
    case "start":
      return await start(context, seed.challengeId, options.invitationOutput);
    case "state":
      return await currentState(context);
    default:
      throw new Error(`Unsupported operator action: ${options.action}`);
  }
}

async function start(context, challengeId, invitationOutput) {
  if (invitationOutput === undefined) {
    throw new Error("The start action requires --invitation-output");
  }
  const response = await sendLoopback(context, {
    body: {
      idempotencyKey: randomUUID(),
      stepUpChallengeId: challengeId,
    },
    method: "POST",
    path: "/devices/pairing-sessions",
  });
  if (
    response.statusCode !== 201 ||
    typeof response.body?.qrUri !== "string" ||
    typeof response.body?.sessionId !== "string"
  ) {
    throw denial("The Main refused to start pairing", response);
  }
  await writeFile(
    path.resolve(invitationOutput),
    `${JSON.stringify(
      {
        caFingerprint: response.body.caFingerprint,
        qrUri: response.body.qrUri,
        sessionId: response.body.sessionId,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return {
    action: "start",
    sessionId: response.body.sessionId,
    status: "open",
  };
}

async function currentState(context) {
  const response = await sendLoopback(context, {
    method: "GET",
    path: "/devices/pairing-sessions/current",
  });
  if (response.statusCode !== 200 || typeof response.body?.state !== "string") {
    throw denial("The Main refused to read pairing state", response);
  }
  return {
    action: "state",
    ...(typeof response.body.sessionId === "string"
      ? { sessionId: response.body.sessionId }
      : {}),
    state: response.body.state,
  };
}

async function confirm(context, sessionId) {
  assertSessionId(sessionId);
  const response = await sendLoopback(context, {
    body: { idempotencyKey: randomUUID() },
    method: "POST",
    path: `/devices/pairing-sessions/${sessionId}/confirmation`,
  });
  if (
    response.statusCode !== 201 ||
    typeof response.body?.deviceId !== "string"
  ) {
    throw denial("The Main refused pairing confirmation", response);
  }
  return {
    action: "confirm",
    deviceId: response.body.deviceId,
    sessionId,
    state: "confirmed",
  };
}

async function cancelCurrent(context) {
  const state = await currentState(context);
  if (state.state !== "open" && state.state !== "awaiting-confirmation") {
    return { action: "cancel-current", cancelled: false, state: state.state };
  }
  const response = await sendLoopback(context, {
    body: { idempotencyKey: randomUUID(), reason: "user-cancelled" },
    method: "POST",
    path: `/devices/pairing-sessions/${state.sessionId}/cancellation`,
  });
  if (response.statusCode !== 201 || response.body?.status !== "cancelled") {
    throw denial("The Main refused pairing cancellation", response);
  }
  return {
    action: "cancel-current",
    cancelled: true,
    sessionId: state.sessionId,
    state: "cancelled",
  };
}

function sendLoopback(context, options) {
  const payload =
    options.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(options.body), "utf8");
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: {
          accept: "application/json",
          authorization: `Breev-Device ${context.provisioning.deviceSecret}`,
          host: `${context.host}:${context.port}`,
          origin: "breev://app",
          "x-breev-csrf": "1",
          "x-breev-device-id": context.provisioning.deviceId,
          "x-breev-device-session": context.provisioning.sessionToken,
          ...(payload === undefined
            ? {}
            : {
                "content-length": String(payload.length),
                "content-type": "application/json",
              }),
        },
        hostname: context.host,
        method: options.method,
        path: options.path,
        port: context.port,
        timeout: 10_000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let body;
          try {
            body = raw.length === 0 ? undefined : JSON.parse(raw);
          } catch {
            body = { raw };
          }
          resolve({ body, statusCode: response.statusCode ?? 0 });
        });
      },
    );
    request.once("timeout", () =>
      request.destroy(new Error("Loopback timeout")),
    );
    request.once("error", reject);
    request.end(payload);
  });
}

function denial(message, response) {
  return new Error(
    `${message} (${String(response.body?.code ?? response.statusCode)})`,
  );
}

function assertProvisioning(provisioning) {
  if (
    typeof provisioning?.deviceId !== "string" ||
    typeof provisioning.deviceSecret !== "string" ||
    typeof provisioning.sessionToken !== "string"
  ) {
    throw new Error("The Main device provisioning file is invalid");
  }
}

function assertSessionId(sessionId) {
  if (
    typeof sessionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      sessionId,
    )
  ) {
    throw new Error("--session-id must be a UUIDv7");
  }
}

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function main(argv) {
  const action = readArgument(argv, "--action");
  const mainDeviceFile = readArgument(argv, "--main-device-file");
  const seedResult = readArgument(argv, "--seed-result");
  const rawPort = readArgument(argv, "--port") ?? "31310";
  const port = Number(rawPort);
  if (
    action === undefined ||
    mainDeviceFile === undefined ||
    seedResult === undefined ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      "--action, --main-device-file, --seed-result, and a valid --port are required",
    );
  }
  const result = await runOperatorAction({
    action,
    host: readArgument(argv, "--host") ?? "127.0.0.1",
    invitationOutput: readArgument(argv, "--invitation-output"),
    mainDeviceFile,
    port,
    seedResult,
    sessionId: readArgument(argv, "--session-id"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2));
}
