import { hostname, networkInterfaces } from "node:os";
import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const host = readArgument("--host");
const port = Number.parseInt(readArgument("--port"), 10);
const outputPath = path.resolve(readArgument("--output"));
const sourceAddress = readArgument("--source-address");
const runId = readArgument("--run-id");
const sourceCommit = readArgument("--source-commit");
const snapshotId = readArgument("--snapshot-id");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("--port must be a valid TCP port");
}

const startedAtUtc = new Date().toISOString();
const sourceInterfaces = Object.entries(networkInterfaces()).flatMap(
  ([name, addresses]) =>
    (addresses ?? [])
      .filter(
        (address) =>
          address.family === "IPv4" && address.address === sourceAddress,
      )
      .map((address) => ({
        name,
        address: address.address,
        netmask: address.netmask,
        internal: address.internal,
      })),
);
const result = await connect(host, port, sourceAddress);
const evidence = {
  schemaVersion: 1,
  runId,
  sourceCommit,
  snapshotId,
  probeMachine: hostname(),
  probeMachineId: createHash("sha256")
    .update((await readFile("/etc/machine-id", "utf8")).trim())
    .digest("hex"),
  expectedSourceAddress: sourceAddress,
  sourceAddress: sourceAddress,
  sourceAddressAssigned: sourceInterfaces.length > 0,
  sourceInterfaces,
  target: { host, port },
  startedAtUtc,
  completedAtUtc: new Date().toISOString(),
  ...result,
};
evidence.passed = evidence.sourceAddressAssigned && result.connectionRefused;

await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(evidence)}\n`);
if (!evidence.passed) {
  process.exitCode = 1;
}

function connect(targetHost, targetPort, expectedSourceAddress) {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(5_000);
    socket.once("connect", () =>
      finish({
        passed: false,
        connectionRefused: false,
        outcome: "connected",
        connectedSourceAddress: socket.localAddress,
      }),
    );
    socket.once("timeout", () =>
      finish({
        passed: false,
        connectionRefused: false,
        outcome: "timed-out",
        connectedSourceAddress: socket.localAddress,
      }),
    );
    socket.once("error", (error) =>
      finish({
        connectionRefused: error.code === "ECONNREFUSED",
        outcome: error.code === "ECONNREFUSED" ? "refused" : "error",
        errorCode: error.code,
        requestedSourceAddress: expectedSourceAddress,
      }),
    );
    socket.connect({
      host: targetHost,
      port: targetPort,
      localAddress: expectedSourceAddress,
    });
  });
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
