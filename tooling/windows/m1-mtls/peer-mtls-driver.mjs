/** Runs one—and exactly one—milestone-1 peer mTLS proof case. */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  pairTerminal,
  parsePairingInvitation,
  readPinnedAuthority,
  sendMtlsGet,
} from "./peer-terminal-client.mjs";
import { createForeignAuthority } from "./terminal-identity.mjs";

export const CASE_CONTRACTS = Object.freeze({
  accepted: Object.freeze({
    assertion: "2xx-tls13-pinned-peer",
    expectation: "accepted",
    identity: "paired-pharmacy-ca-terminal",
    runner: "runAcceptedCase",
  }),
  foreign: Object.freeze({
    assertion: "tls-handshake-or-401-403-mtls-refusal",
    expectation: "refused",
    identity: "foreign-ca-terminal",
    runner: "runForeignCase",
  }),
  missing: Object.freeze({
    assertion: "tls-handshake-or-mtls-cert-missing",
    expectation: "refused",
    identity: "no-client-certificate",
    runner: "runMissingCase",
  }),
});

export const PROOF_CASES = Object.freeze(Object.keys(CASE_CONTRACTS));

const CASE_RUNNERS = Object.freeze({
  accepted: runAcceptedCase,
  foreign: runForeignCase,
  missing: runMissingCase,
});

export async function runProofCase(options) {
  const contract = CASE_CONTRACTS[options.caseName];
  const runner = CASE_RUNNERS[options.caseName];
  if (contract === undefined || runner === undefined) {
    throw new Error(`Unsupported mTLS proof case: ${options.caseName}`);
  }
  const invitationUri = await readInvitationUri(options.invitationFile);
  const invitation = parsePairingInvitation(invitationUri);
  const configuredHost = options.host ?? invitation.host;
  const configuredPort = options.port ?? invitation.port;
  if (
    configuredHost !== invitation.host ||
    configuredPort !== invitation.port
  ) {
    throw new Error("The driver endpoint must exactly match the pairing QR");
  }
  process.env.BREEV_LAN_API_HOST = configuredHost;
  process.env.BREEV_LAN_API_PORT = String(configuredPort);

  const startedUtc = new Date().toISOString();
  const common = {
    assertion: contract.assertion,
    case: options.caseName,
    expectation: contract.expectation,
    identity: contract.identity,
    runId: options.runId ?? null,
    schemaVersion: 1,
    sourceCommit: options.sourceCommit ?? null,
    startedUtc,
  };
  try {
    const details = await runner({
      deviceName: options.deviceName ?? "Breev Alpine Peer",
      invitation,
      invitationUri,
      path: options.path ?? "/identity/state",
      pollDeadlineMs: options.pollDeadlineMs,
      pollIntervalMs: options.pollIntervalMs,
    });
    return {
      ...common,
      details,
      finishedUtc: new Date().toISOString(),
      outcome: contract.expectation,
      passed: true,
    };
  } catch (error) {
    return {
      ...common,
      details: { error: safeError(error) },
      finishedUtc: new Date().toISOString(),
      outcome: "failed",
      passed: false,
    };
  }
}

export async function writeProofCase(options) {
  const result = await runProofCase(options);
  const outputDirectory = path.resolve(
    options.outputDirectory ?? path.join(import.meta.dirname, "out"),
  );
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${options.caseName}.json`);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { outputPath, result };
}

async function runAcceptedCase(options) {
  const paired = await pairTerminal({
    deviceName: options.deviceName,
    invitation: options.invitation,
    ...(options.pollDeadlineMs === undefined
      ? {}
      : { pollDeadlineMs: options.pollDeadlineMs }),
    ...(options.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: options.pollIntervalMs }),
  });
  const response = await sendMtlsGet({
    caCertificatePem: paired.caCertificatePem,
    certificatePem: paired.certificatePem,
    invitation: paired.invitation,
    path: options.path,
    privateKeyPem: paired.privateKeyPem,
  });
  if (
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    response.tlsProtocol !== "TLSv1.3" ||
    response.peerCertificateAccepted !== true
  ) {
    throw new Error(
      "The paired terminal did not receive a 2xx response over an accepted TLS 1.3 peer",
    );
  }
  return {
    accepted: true,
    deviceId: paired.deviceId,
    hostHeader: configuredAuthority(),
    installationId: paired.installationId,
    path: options.path,
    peerCertificateAccepted: response.peerCertificateAccepted,
    refusalAsserted: false,
    statusCode: response.statusCode,
    tlsProtocol: response.tlsProtocol,
  };
}

async function runForeignCase(options) {
  const caCertificatePem = await readPinnedAuthority(options.invitation);
  const foreign = createForeignAuthority();
  return await assertRefused(
    "foreign",
    async () =>
      await sendMtlsGet({
        caCertificatePem,
        certificatePem: `${foreign.certificatePem}\n${foreign.authorityCertPem}`,
        invitation: options.invitation,
        path: options.path,
        privateKeyPem: foreign.privateKeyPem,
      }),
    options.path,
  );
}

async function runMissingCase(options) {
  const caCertificatePem = await readPinnedAuthority(options.invitation);
  return await assertRefused(
    "missing",
    async () =>
      await sendMtlsGet({
        caCertificatePem,
        invitation: options.invitation,
        path: options.path,
      }),
    options.path,
  );
}

async function assertRefused(caseName, request, requestPath) {
  try {
    const response = await request();
    const denialCode = asRecord(response.payload)?.code;
    const allowedCodes =
      caseName === "missing"
        ? new Set(["mtls-cert-missing"])
        : new Set([
            "cert-chain-invalid",
            "mtls-cert-missing",
            "mtls-cert-invalid",
          ]);
    if (
      (response.statusCode !== 401 && response.statusCode !== 403) ||
      !allowedCodes.has(denialCode)
    ) {
      throw new Error(
        `The ${caseName} identity reached the API without an mTLS refusal ` +
          `(status=${response.statusCode}, code=${String(denialCode)})`,
      );
    }
    return {
      accepted: false,
      denialCode,
      hostHeader: configuredAuthority(),
      path: requestPath,
      peerCertificateAccepted: response.peerCertificateAccepted,
      refusalAsserted: true,
      refusalKind: "mtls-middleware",
      statusCode: response.statusCode,
      tlsProtocol: response.tlsProtocol,
    };
  } catch (error) {
    if (!isTlsHandshakeRefusal(error)) {
      throw error;
    }
    return {
      accepted: false,
      denialCode: null,
      hostHeader: configuredAuthority(),
      path: requestPath,
      peerCertificateAccepted: false,
      refusalAsserted: true,
      refusalKind: "tls-handshake",
      statusCode: null,
      tlsErrorCode: error.code ?? error.name,
      tlsProtocol: null,
    };
  }
}

function isTlsHandshakeRefusal(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = String(error.code ?? "");
  const message = error.message.toLowerCase();
  return (
    code.startsWith("ERR_SSL_") ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    (message.includes("tls") &&
      (message.includes("certificate") || message.includes("alert")))
  );
}

async function readInvitationUri(invitationFile) {
  const parsed = JSON.parse(
    await readFile(path.resolve(invitationFile), "utf8"),
  );
  const invitationUri =
    typeof parsed === "string"
      ? parsed
      : typeof parsed?.qrUri === "string"
        ? parsed.qrUri
        : undefined;
  if (invitationUri === undefined) {
    throw new Error("The invitation file must contain a qrUri string");
  }
  return invitationUri;
}

function configuredAuthority() {
  return `${process.env.BREEV_LAN_API_HOST}:${process.env.BREEV_LAN_API_PORT}`;
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function safeError(error) {
  const value = error instanceof Error ? error : new Error(String(error));
  return {
    code: typeof value.code === "string" ? value.code : null,
    message: value.message
      .replaceAll(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/gu, "<pem>")
      .replaceAll(/[A-Za-z0-9_-]{43}/gu, "<secret>"),
    name: value.name,
  };
}

function readArgument(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, name) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

async function main(argv) {
  if (argv.includes("--describe-cases")) {
    process.stdout.write(`${JSON.stringify(CASE_CONTRACTS)}\n`);
    return;
  }
  const caseName = readArgument(argv, "--case");
  const invitationFile = readArgument(argv, "--invitation-file");
  if (caseName === undefined || invitationFile === undefined) {
    throw new Error("--case and --invitation-file are required");
  }
  const host = readArgument(argv, "--host");
  const port = parsePositiveInteger(readArgument(argv, "--port"), "--port");
  const runId = readArgument(argv, "--run-id");
  const sourceCommit = readArgument(argv, "--source-commit");
  if (
    runId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      runId,
    )
  ) {
    throw new Error("--run-id must be a UUID");
  }
  if (sourceCommit !== undefined && !/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error("--source-commit must be a 40-character lowercase SHA");
  }
  const { outputPath, result } = await writeProofCase({
    caseName,
    deviceName: readArgument(argv, "--device-name", "Breev Alpine Peer"),
    ...(host === undefined ? {} : { host }),
    invitationFile,
    outputDirectory: readArgument(
      argv,
      "--output-dir",
      path.join(import.meta.dirname, "out"),
    ),
    path: readArgument(argv, "--request-path", "/identity/state"),
    ...(port === undefined ? {} : { port }),
    pollDeadlineMs: parsePositiveInteger(
      readArgument(argv, "--poll-deadline-ms"),
      "--poll-deadline-ms",
    ),
    pollIntervalMs: parsePositiveInteger(
      readArgument(argv, "--poll-interval-ms"),
      "--poll-interval-ms",
    ),
    runId,
    sourceCommit,
  });
  process.stdout.write(`${outputPath}\n`);
  if (!result.passed) {
    process.stderr.write(`${JSON.stringify(result.details.error)}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2));
}
