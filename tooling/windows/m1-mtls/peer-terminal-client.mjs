/**
 * Zero-dependency Additional POS Terminal protocol client for the Alpine peer.
 *
 * The bootstrap follows the shipped desktop client rather than inventing a test
 * shortcut: the first TLS 1.3 socket sends no application data, extracts the
 * presented chain, and validates that chain against the QR's CA fingerprint and
 * installation identity. Only then does HTTPS begin, with the extracted CA as
 * the sole trust anchor, `rejectUnauthorized: true`, and the same extra server
 * profile checks as `createPairingServerIdentityChecker`.
 *
 * Sources mirrored byte-for-byte or field-for-field:
 * - transcript layout: `apps/local-api/src/devices/pairing-domain.ts:65-85`
 * - CSR layout: `apps/desktop/src/main/pairing-transcript.ts:128-159`
 * - join/poll/fetch bodies: `apps/desktop/src/main/pairing-client.ts:399-493`
 * - server identity checker: `apps/desktop/src/main/pairing-trust.ts:96-125`
 * - TLS 1.3 LAN boundary: `apps/local-api/src/pharmacy-ca/lan-mtls-server.ts:65-83`
 * - exact Host boundary: `apps/local-api/src/main-device/main-device-security.service.ts:603-610`
 */

import {
  createHash,
  createPrivateKey,
  sign,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import { Agent, request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

import {
  pemDecode,
  pemEncode,
  readChildren,
  readKeyUsageFlags,
  readObjectIdentifier,
  readTlv,
  TAG,
} from "./der.mjs";
import {
  buildCertificateRequest,
  createTerminalKeys,
  fingerprintOf,
} from "./terminal-identity.mjs";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CA_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const JOIN_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/iu;
const INVITATION_PATTERN = /^breev-pair:\/\/1\/([A-Za-z0-9_-]{1,2048})$/u;
const INVITATION_FIELDS = ["f", "h", "i", "k", "p", "s", "v"];

const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_EXTENDED_KEY_USAGE = "2.5.29.37";
const OID_SUBJECT_ALTERNATIVE_NAME = "2.5.29.17";
const OID_SERVER_AUTHENTICATION = "1.3.6.1.5.5.7.3.1";
const INSTALLATION_URI_PREFIX = "urn:breev:installation:";
const DEVICE_URI_PREFIX = "urn:breev:device:";
const DEVICE_TYPE_TERMINAL_URI = "urn:breev:device-type:terminal";

const PAIRING_JOIN_DOMAIN = "breev-pairing-join-v1";
const PAIRING_FETCH_DOMAIN = "breev-pairing-fetch-v1";
const PAIRING_FINGERPRINT_DOMAIN = "breev-pairing-fingerprint-v1";
const MAXIMUM_CHAIN_LENGTH = 8;
const RESPONSE_LIMIT_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 8_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_DEADLINE_MS = 6 * 60_000;

export const PAIRING_PATHS = Object.freeze({
  caCertificate: "/pairing/ca-certificate",
  certificates: "/pairing/certificates",
  joins: "/pairing/joins",
});

export class PeerProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PeerProtocolError";
    this.code = code;
  }
}

/** Strict inverse of the v1 QR payload parsed by the desktop client. */
export function parsePairingInvitation(value) {
  const match = INVITATION_PATTERN.exec(String(value).trim());
  if (match?.[1] === undefined) {
    throw new PeerProtocolError(
      "invitation-invalid",
      "The pairing invitation is not a Breev v1 URI",
    );
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch {
    throw new PeerProtocolError(
      "invitation-invalid",
      "The pairing invitation payload is unreadable",
    );
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded) ||
    Object.getPrototypeOf(decoded) !== Object.prototype
  ) {
    throw new PeerProtocolError(
      "invitation-invalid",
      "The pairing invitation payload is not an object",
    );
  }
  const fields = Object.keys(decoded).sort();
  if (
    fields.length !== INVITATION_FIELDS.length ||
    fields.some((field, index) => field !== INVITATION_FIELDS[index])
  ) {
    throw new PeerProtocolError(
      "invitation-invalid",
      "The pairing invitation carries unexpected fields",
    );
  }
  const { f, h, i, k, p, s, v } = decoded;
  if (
    v !== 1 ||
    typeof f !== "string" ||
    !CA_FINGERPRINT_PATTERN.test(f) ||
    typeof h !== "string" ||
    (isIP(h) === 0 && !HOSTNAME_PATTERN.test(h)) ||
    typeof i !== "string" ||
    !UUID_V7_PATTERN.test(i) ||
    typeof k !== "string" ||
    !JOIN_SECRET_PATTERN.test(k) ||
    Buffer.from(k, "base64url").length !== 32 ||
    typeof p !== "number" ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 65_535 ||
    typeof s !== "string" ||
    !UUID_V7_PATTERN.test(s)
  ) {
    throw new PeerProtocolError(
      "invitation-invalid",
      "The pairing invitation contains an invalid value",
    );
  }
  return {
    caFingerprint: f,
    host: h,
    installationId: i,
    joinSecret: k,
    port: p,
    sessionId: s,
  };
}

/**
 * `T_join = label || 00 || UUID(session) || UUID(installation) || CA hash || SPKI`.
 * This is the byte construction at `pairing-domain.ts:65-71`, not UUID text.
 */
export function buildJoinTranscript(binding) {
  return concatenateTranscript(PAIRING_JOIN_DOMAIN, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    fingerprintToBytes(binding.caFingerprint),
    Buffer.from(binding.spkiDer),
  ]);
}

/** `T_fetch` deliberately omits the CA hash (`pairing-domain.ts:78-85`). */
export function buildFetchTranscript(binding) {
  return concatenateTranscript(PAIRING_FETCH_DOMAIN, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    Buffer.from(binding.spkiDer),
  ]);
}

export function deriveFingerprintDigits(binding) {
  const transcript = concatenateTranscript(PAIRING_FINGERPRINT_DOMAIN, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    fingerprintToBytes(binding.caFingerprint),
    Buffer.from(binding.spkiDer),
  ]);
  const digest = createHash("sha256").update(transcript).digest();
  return (digest.readBigUInt64BE(0) % 1_000_000_000_000n)
    .toString(10)
    .padStart(12, "0");
}

/**
 * Runs the full terminal half of #134 and returns only public identity material
 * plus the private key that remains in this process for the immediate proof.
 */
export async function pairTerminal(options) {
  const invitation =
    typeof options.invitation === "string"
      ? parsePairingInvitation(options.invitation)
      : options.invitation;
  assertConfiguredEndpoint(invitation);

  const caCertificatePem = await readPinnedAuthority(invitation);
  const agent = createPairingAgent(caCertificatePem, invitation);
  try {
    const advertised = await requestPairingJson({
      agent,
      invitation,
      method: "GET",
      path: PAIRING_PATHS.caCertificate,
    });
    const advertisedCa = asRecord(advertised.payload)?.caCertificatePem;
    const advertisedInstallation = asRecord(advertised.payload)?.installationId;
    if (
      advertised.statusCode !== 200 ||
      typeof advertisedCa !== "string" ||
      advertisedInstallation !== invitation.installationId ||
      !sameDerCertificate(advertisedCa, caCertificatePem) ||
      fingerprintOf(advertisedCa) !== invitation.caFingerprint
    ) {
      throw new PeerProtocolError(
        "ca-certificate-invalid",
        "The pairing CA endpoint did not return the pinned authority",
      );
    }

    const keys = createTerminalKeys();
    const binding = {
      caFingerprint: invitation.caFingerprint,
      installationId: invitation.installationId,
      sessionId: invitation.sessionId,
      spkiDer: keys.spkiDer,
    };
    const joined = await requestPairingJson({
      agent,
      body: {
        // Exact join body from `pairing-client.ts:408-420`.
        csrPem: buildCertificateRequest(keys),
        deviceName: options.deviceName,
        joinSecret: invitation.joinSecret,
        sessionId: invitation.sessionId,
        transcriptSignature: signTranscript(
          buildJoinTranscript(binding),
          keys.privateKeyPem,
        ),
      },
      invitation,
      method: "POST",
      path: PAIRING_PATHS.joins,
    });
    if (
      joined.statusCode !== 200 ||
      asRecord(joined.payload)?.status !== "bound"
    ) {
      throw pairingDenial("join-refused", joined);
    }

    await awaitConfirmation({
      agent,
      deadlineMs: options.pollDeadlineMs ?? DEFAULT_POLL_DEADLINE_MS,
      invitation,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });

    const fetched = await requestPairingJson({
      agent,
      body: {
        // Exact fetch body from `pairing-client.ts:472-481`.
        sessionId: invitation.sessionId,
        signature: signTranscript(
          buildFetchTranscript(binding),
          keys.privateKeyPem,
        ),
      },
      invitation,
      method: "POST",
      path: PAIRING_PATHS.certificates,
    });
    if (fetched.statusCode !== 200) {
      throw pairingDenial("certificate-fetch-refused", fetched);
    }
    const issued = readIssuedCertificate(fetched.payload, invitation);
    const verified = verifyIssuedDeviceCertificate({
      caCertificatePem: issued.caCertificatePem,
      certificatePem: issued.certificatePem,
      invitation,
      spkiDer: keys.spkiDer,
    });
    if (verified.deviceId !== issued.deviceId) {
      throw new PeerProtocolError(
        "certificate-invalid",
        "The issued response and certificate name different devices",
      );
    }
    return {
      caCertificatePem,
      certificatePem: issued.certificatePem,
      deviceId: issued.deviceId,
      fingerprintDigits: deriveFingerprintDigits(binding),
      installationId: invitation.installationId,
      invitation,
      privateKeyPem: keys.privateKeyPem,
    };
  } finally {
    agent.destroy();
  }
}

/**
 * Sends the proof request through the production-shaped TLS options. The Host
 * value is deliberately explicit and is exactly `${BREEV_LAN_API_HOST}:${BREEV_LAN_API_PORT}`.
 */
export async function sendMtlsGet(options) {
  const invitation = options.invitation;
  assertConfiguredEndpoint(invitation);
  const agent = createPairingAgent(options.caCertificatePem, invitation, {
    ...(options.certificatePem === undefined
      ? {}
      : { certificatePem: options.certificatePem }),
    ...(options.privateKeyPem === undefined
      ? {}
      : { privateKeyPem: options.privateKeyPem }),
  });
  try {
    return await requestJson({
      agent,
      headers: {
        origin: "breev://app",
        "x-breev-csrf": "1",
      },
      invitation,
      method: "GET",
      path: options.path,
    });
  } finally {
    agent.destroy();
  }
}

/**
 * The only unauthenticated socket. As in `pairing-client.ts:195-267`, it sends
 * no request bytes; trust comes from the QR pin plus strict Breev CA/server
 * profiles, after which all HTTPS traffic uses `rejectUnauthorized: true`.
 */
export function readPinnedAuthority(invitation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = tlsConnect({
      host: invitation.host,
      minVersion: "TLSv1.3",
      port: invitation.port,
      rejectUnauthorized: false,
      servername: undefined,
      timeout: HANDSHAKE_TIMEOUT_MS,
    });
    const settle = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error === undefined && value !== undefined) {
        resolve(value);
      } else {
        reject(error ?? new Error("The pairing bootstrap failed"));
      }
    };
    socket.once("secureConnect", () => {
      try {
        const verified = verifyPairingServerChain({
          caFingerprint: invitation.caFingerprint,
          chain: collectPeerChain(socket.getPeerCertificate(true)),
          installationId: invitation.installationId,
        });
        settle(undefined, verified.caCertificatePem);
      } catch (error) {
        settle(asError(error));
      }
    });
    socket.once("timeout", () =>
      settle(
        new PeerProtocolError(
          "endpoint-timeout",
          "The Main LAN listener did not complete TLS in time",
        ),
      ),
    );
    socket.once("error", (error) => settle(error));
  });
}

export function createPairingAgent(
  caCertificatePem,
  invitation,
  identity = {},
) {
  return new Agent({
    ca: [caCertificatePem],
    checkServerIdentity: createPairingServerIdentityChecker({
      caFingerprint: invitation.caFingerprint,
      installationId: invitation.installationId,
    }),
    keepAlive: false,
    maxVersion: "TLSv1.3",
    minVersion: "TLSv1.3",
    rejectUnauthorized: true,
    ...(identity.certificatePem === undefined
      ? {}
      : { cert: identity.certificatePem }),
    ...(identity.privateKeyPem === undefined
      ? {}
      : { key: identity.privateKeyPem }),
  });
}

/** Zero-dependency mirror of `createPairingServerIdentityChecker`. */
export function createPairingServerIdentityChecker(params) {
  return (_hostname, peer) => {
    try {
      const chain = collectPeerChain(peer);
      const leaf = parseX509(chain[0]);
      const authority = parseX509(chain.at(-1));
      if (
        chain.length > 1 &&
        certificateFingerprint(authority) !== params.caFingerprint
      ) {
        return new PeerProtocolError(
          "server-identity-invalid",
          "The server chain no longer ends at the QR-pinned authority",
        );
      }
      assertValidityWindow(leaf, new Date());
      assertServerProfile(leaf, params.installationId);
      return undefined;
    } catch (error) {
      return asError(error);
    }
  };
}

export function verifyPairingServerChain(params) {
  if (params.chain.length < 2 || params.chain.length > MAXIMUM_CHAIN_LENGTH) {
    throw new PeerProtocolError(
      "server-identity-invalid",
      "The Main did not present a leaf and one bounded authority chain",
    );
  }
  const certificates = params.chain.map(parseX509);
  const leaf = certificates[0];
  const authority = certificates.at(-1);
  if (
    certificateFingerprint(authority) !== params.caFingerprint ||
    !authority.ca ||
    !authority.verify(authority.publicKey) ||
    authority.subject !== authority.issuer
  ) {
    throw new PeerProtocolError(
      "server-identity-invalid",
      "The presented authority does not match the invitation pin",
    );
  }
  assertValidityWindow(authority, new Date());
  assertAuthorityProfile(authority, params.installationId);
  if (!leaf.checkIssued(authority) || !leaf.verify(authority.publicKey)) {
    throw new PeerProtocolError(
      "server-identity-invalid",
      "The Main leaf was not issued by the pinned authority",
    );
  }
  assertValidityWindow(leaf, new Date());
  assertServerProfile(leaf, params.installationId);
  return {
    caCertificatePem: pemEncode("CERTIFICATE", Buffer.from(authority.raw)),
  };
}

function verifyIssuedDeviceCertificate(params) {
  const authority = parseX509(params.caCertificatePem);
  const certificate = parseX509(params.certificatePem);
  if (
    certificateFingerprint(authority) !== params.invitation.caFingerprint ||
    !authority.ca ||
    !authority.verify(authority.publicKey)
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "The issued certificate authority is not the QR-pinned authority",
    );
  }
  assertValidityWindow(authority, new Date());
  assertAuthorityProfile(authority, params.invitation.installationId);
  if (
    !certificate.checkIssued(authority) ||
    !certificate.verify(authority.publicKey)
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "The terminal certificate was not issued by the pinned authority",
    );
  }
  assertValidityWindow(certificate, new Date());
  const presentedSpki = certificate.publicKey.export({
    format: "der",
    type: "spki",
  });
  if (
    presentedSpki.length !== params.spkiDer.length ||
    !timingSafeEqual(presentedSpki, params.spkiDer)
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "The terminal certificate does not carry the generated key",
    );
  }
  const names = subjectAlternativeNames(certificate);
  const installationId = singleUriSuffix(names, INSTALLATION_URI_PREFIX);
  const deviceId = singleUriSuffix(names, DEVICE_URI_PREFIX);
  if (
    installationId !== params.invitation.installationId ||
    !UUID_V7_PATTERN.test(deviceId) ||
    !names.includes(DEVICE_TYPE_TERMINAL_URI)
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "The terminal certificate carries the wrong Breev identity",
    );
  }
  return { deviceId, installationId };
}

async function awaitConfirmation(options) {
  const deadline = Date.now() + options.deadlineMs;
  const path = `/pairing/sessions/${options.invitation.sessionId}/state`;
  while (Date.now() < deadline) {
    const state = await requestPairingJson({
      agent: options.agent,
      invitation: options.invitation,
      method: "GET",
      path,
    });
    const value = asRecord(state.payload)?.state;
    if (state.statusCode === 200 && value === "confirmed") {
      return;
    }
    if (
      state.statusCode !== 429 &&
      !(
        state.statusCode === 200 &&
        (value === "open" || value === "awaiting-confirmation")
      )
    ) {
      throw pairingDenial("confirmation-refused", state);
    }
    await delay(options.pollIntervalMs);
  }
  throw new PeerProtocolError(
    "confirmation-timeout",
    "The Main operator did not confirm pairing before the deadline",
  );
}

function requestPairingJson(options) {
  return requestJson(options);
}

function requestJson(options) {
  const body =
    options.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(options.body), "utf8");
  const hostHeader = configuredAuthority();
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpsRequest(
      {
        agent: options.agent,
        headers: {
          accept: "application/json",
          host: hostHeader,
          ...(body === undefined
            ? {}
            : {
                "content-length": String(body.length),
                "content-type": "application/json",
              }),
          ...options.headers,
        },
        hostname: options.invitation.host,
        method: options.method,
        path: options.path,
        port: options.invitation.port,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          const bytes = Buffer.from(chunk);
          received += bytes.length;
          if (received > RESPONSE_LIMIT_BYTES) {
            request.destroy(
              new PeerProtocolError(
                "response-too-large",
                "The Main response exceeded the proof client's limit",
              ),
            );
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload;
          try {
            payload = raw.length === 0 ? undefined : JSON.parse(raw);
          } catch {
            payload = { raw };
          }
          const socket = response.socket;
          settle(undefined, {
            payload,
            peerCertificateAccepted: socket.authorized === true,
            statusCode: response.statusCode ?? 0,
            tlsProtocol: socket.getProtocol?.() ?? null,
          });
        });
      },
    );
    const settle = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error === undefined && value !== undefined) {
        resolve(value);
      } else {
        reject(error ?? new Error("The HTTPS request failed"));
      }
    };
    request.once("timeout", () =>
      request.destroy(
        new PeerProtocolError(
          "request-timeout",
          "The Main did not answer the HTTPS request in time",
        ),
      ),
    );
    request.once("error", (error) => settle(error));
    request.end(body);
  });
}

function readIssuedCertificate(payload, invitation) {
  const record = asRecord(payload);
  if (
    typeof record?.caCertificatePem !== "string" ||
    typeof record.certificatePem !== "string" ||
    typeof record.deviceId !== "string" ||
    !UUID_V7_PATTERN.test(record.deviceId) ||
    record.installationId !== invitation.installationId
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "The certificate response is malformed",
    );
  }
  if (fingerprintOf(record.caCertificatePem) !== invitation.caFingerprint) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "The certificate response names another authority",
    );
  }
  return {
    caCertificatePem: record.caCertificatePem,
    certificatePem: record.certificatePem,
    deviceId: record.deviceId,
  };
}

function pairingDenial(code, response) {
  const denialCode = asRecord(response.payload)?.code;
  return new PeerProtocolError(
    code,
    `The Main refused pairing (${String(denialCode ?? response.statusCode)})`,
  );
}

function concatenateTranscript(domain, parts) {
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.of(0x00),
    ...parts,
  ]);
}

function uuidToBytes(value) {
  if (!UUID_V7_PATTERN.test(value)) {
    throw new PeerProtocolError(
      "transcript-invalid",
      "A transcript UUID is invalid",
    );
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function fingerprintToBytes(value) {
  if (!CA_FINGERPRINT_PATTERN.test(value)) {
    throw new PeerProtocolError(
      "transcript-invalid",
      "A transcript CA fingerprint is invalid",
    );
  }
  return Buffer.from(value, "hex");
}

function signTranscript(transcript, privateKeyPem) {
  return sign("sha256", transcript, createPrivateKey(privateKeyPem)).toString(
    "base64",
  );
}

function assertConfiguredEndpoint(invitation) {
  const host = process.env.BREEV_LAN_API_HOST;
  const rawPort = process.env.BREEV_LAN_API_PORT;
  const port = Number(rawPort);
  if (
    host === undefined ||
    rawPort === undefined ||
    !Number.isInteger(port) ||
    host !== invitation.host ||
    port !== invitation.port
  ) {
    throw new PeerProtocolError(
      "endpoint-mismatch",
      "The invitation and BREEV_LAN_API_HOST/BREEV_LAN_API_PORT must match exactly",
    );
  }
}

function configuredAuthority() {
  const host = process.env.BREEV_LAN_API_HOST;
  const port = process.env.BREEV_LAN_API_PORT;
  if (host === undefined || port === undefined) {
    throw new PeerProtocolError(
      "endpoint-missing",
      "BREEV_LAN_API_HOST and BREEV_LAN_API_PORT are required",
    );
  }
  return `${host}:${port}`;
}

function collectPeerChain(peer) {
  const chain = [];
  const seen = new Set();
  let current = peer;
  while (
    current !== undefined &&
    current !== null &&
    Buffer.isBuffer(current.raw) &&
    chain.length < MAXIMUM_CHAIN_LENGTH
  ) {
    const key = current.raw.toString("base64");
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    chain.push(Buffer.from(current.raw));
    current = current.issuerCertificate;
  }
  if (chain.length === 0) {
    throw new PeerProtocolError(
      "server-identity-invalid",
      "The Main presented no readable certificate",
    );
  }
  return chain;
}

function parseX509(input) {
  try {
    return new X509Certificate(input);
  } catch {
    throw new PeerProtocolError(
      "certificate-invalid",
      "A presented certificate is unreadable",
    );
  }
}

function certificateFingerprint(certificate) {
  return certificate.fingerprint256.replaceAll(":", "").toLowerCase();
}

function assertValidityWindow(certificate, now) {
  if (
    now < new Date(certificate.validFrom) ||
    now > new Date(certificate.validTo)
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "A presented certificate is outside its validity window",
    );
  }
}

function assertAuthorityProfile(certificate, installationId) {
  const extensions = certificateExtensions(certificate);
  assertExtensionSet(extensions, [
    OID_BASIC_CONSTRAINTS,
    OID_KEY_USAGE,
    OID_SUBJECT_ALTERNATIVE_NAME,
  ]);
  const constraints = parseBasicConstraints(
    requireExtension(extensions, OID_BASIC_CONSTRAINTS, true),
  );
  const usage = parseKeyUsage(
    requireExtension(extensions, OID_KEY_USAGE, true),
  );
  const names = parseSubjectAlternativeNames(
    requireExtension(extensions, OID_SUBJECT_ALTERNATIVE_NAME, false),
  );
  if (
    constraints.ca !== true ||
    constraints.pathLength !== 0 ||
    usage !== ((1 << 5) | (1 << 6)) ||
    names.length !== 1 ||
    names[0] !== `${INSTALLATION_URI_PREFIX}${installationId}`
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "The authority does not match the Breev CA profile",
    );
  }
}

function assertServerProfile(certificate, installationId) {
  const extensions = certificateExtensions(certificate);
  assertExtensionSet(extensions, [
    OID_BASIC_CONSTRAINTS,
    OID_KEY_USAGE,
    OID_EXTENDED_KEY_USAGE,
    OID_SUBJECT_ALTERNATIVE_NAME,
  ]);
  const constraints = parseBasicConstraints(
    requireExtension(extensions, OID_BASIC_CONSTRAINTS, true),
  );
  const usage = parseKeyUsage(
    requireExtension(extensions, OID_KEY_USAGE, true),
  );
  const extendedUsage = parseExtendedKeyUsage(
    requireExtension(extensions, OID_EXTENDED_KEY_USAGE, true),
  );
  const names = parseSubjectAlternativeNames(
    requireExtension(extensions, OID_SUBJECT_ALTERNATIVE_NAME, false),
  );
  if (
    constraints.ca ||
    usage !== ((1 << 0) | (1 << 2)) ||
    extendedUsage.length !== 1 ||
    extendedUsage[0] !== OID_SERVER_AUTHENTICATION ||
    singleUriSuffix(names, INSTALLATION_URI_PREFIX) !== installationId
  ) {
    throw new PeerProtocolError(
      "server-identity-invalid",
      "The Main certificate does not carry the Breev server role",
    );
  }
}

function subjectAlternativeNames(certificate) {
  const extensions = certificateExtensions(certificate);
  return parseSubjectAlternativeNames(
    requireExtension(extensions, OID_SUBJECT_ALTERNATIVE_NAME, false),
  );
}

function certificateExtensions(certificate) {
  const outer = readOnlyTlv(Buffer.from(certificate.raw), TAG.sequence);
  const certificateParts = readChildren(outer.content);
  if (
    certificateParts.length !== 3 ||
    certificateParts[0]?.tag !== TAG.sequence
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "A certificate does not have the X.509 outer shape",
    );
  }
  const tbsParts = readChildren(certificateParts[0].content);
  const extensionContainers = tbsParts.filter((part) => part.tag === 0xa3);
  if (extensionContainers.length !== 1) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "A certificate does not have exactly one extension container",
    );
  }
  const sequence = readOnlyTlv(extensionContainers[0].content, TAG.sequence);
  const extensions = new Map();
  for (const encoded of readChildren(sequence.content)) {
    if (encoded.tag !== TAG.sequence) {
      throw new PeerProtocolError(
        "certificate-invalid",
        "A certificate extension is malformed",
      );
    }
    const parts = readChildren(encoded.content);
    if (
      parts[0]?.tag !== TAG.objectIdentifier ||
      parts.at(-1)?.tag !== TAG.octetString ||
      parts.length < 2 ||
      parts.length > 3
    ) {
      throw new PeerProtocolError(
        "certificate-invalid",
        "A certificate extension is malformed",
      );
    }
    const oid = readObjectIdentifier(parts[0].content);
    if (extensions.has(oid)) {
      throw new PeerProtocolError(
        "certificate-invalid",
        `Certificate extension ${oid} is duplicated`,
      );
    }
    const critical =
      parts.length === 3
        ? parts[1]?.tag === TAG.boolean &&
          parts[1].content.length === 1 &&
          parts[1].content[0] !== 0
        : false;
    if (parts.length === 3 && parts[1]?.tag !== TAG.boolean) {
      throw new PeerProtocolError(
        "certificate-invalid",
        `Certificate extension ${oid} has an invalid critical flag`,
      );
    }
    extensions.set(oid, {
      critical,
      value: Buffer.from(parts.at(-1).content),
    });
  }
  return extensions;
}

function assertExtensionSet(extensions, expected) {
  if (
    extensions.size !== expected.length ||
    expected.some((oid) => !extensions.has(oid))
  ) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "A certificate does not have the exact Breev extension set",
    );
  }
}

function requireExtension(extensions, oid, critical) {
  const extension = extensions.get(oid);
  if (extension === undefined || extension.critical !== critical) {
    throw new PeerProtocolError(
      "certificate-invalid",
      `Certificate extension ${oid} is missing or has the wrong criticality`,
    );
  }
  return extension.value;
}

function parseBasicConstraints(encoded) {
  const sequence = readOnlyTlv(encoded, TAG.sequence);
  const parts = readChildren(sequence.content);
  let ca = false;
  let pathLength;
  if (parts[0]?.tag === TAG.boolean) {
    if (parts[0].content.length !== 1) {
      throw new PeerProtocolError(
        "certificate-invalid",
        "Basic constraints has an invalid CA flag",
      );
    }
    ca = parts[0].content[0] !== 0;
    parts.shift();
  }
  if (parts[0]?.tag === TAG.integer) {
    pathLength = readNonNegativeInteger(parts[0].content);
    parts.shift();
  }
  if (parts.length !== 0) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "Basic constraints carries unexpected values",
    );
  }
  return { ca, pathLength };
}

function parseKeyUsage(encoded) {
  return readKeyUsageFlags(readOnlyTlv(encoded, TAG.bitString).content);
}

function parseExtendedKeyUsage(encoded) {
  return readChildren(readOnlyTlv(encoded, TAG.sequence).content).map(
    (part) => {
      if (part.tag !== TAG.objectIdentifier) {
        throw new PeerProtocolError(
          "certificate-invalid",
          "Extended key usage carries a non-OID value",
        );
      }
      return readObjectIdentifier(part.content);
    },
  );
}

function parseSubjectAlternativeNames(encoded) {
  return readChildren(readOnlyTlv(encoded, TAG.sequence).content)
    .filter((part) => part.tag === 0x86)
    .map((part) => part.content.toString("utf8"));
}

function singleUriSuffix(names, prefix) {
  const matching = names.filter((name) => name.startsWith(prefix));
  if (matching.length !== 1) {
    throw new PeerProtocolError(
      "certificate-invalid",
      `A certificate does not carry exactly one ${prefix} name`,
    );
  }
  return matching[0].slice(prefix.length);
}

function readOnlyTlv(buffer, expectedTag) {
  const item = readTlv(buffer);
  if (item.tag !== expectedTag || item.end !== buffer.length) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "A DER value has an unexpected tag or trailing bytes",
    );
  }
  return item;
}

function readNonNegativeInteger(content) {
  if (content.length === 0 || (content[0] & 0x80) !== 0) {
    throw new PeerProtocolError(
      "certificate-invalid",
      "A certificate integer is negative or empty",
    );
  }
  let value = 0;
  for (const byte of content) {
    value = value * 256 + byte;
    if (!Number.isSafeInteger(value)) {
      throw new PeerProtocolError(
        "certificate-invalid",
        "A certificate integer is too large",
      );
    }
  }
  return value;
}

function sameDerCertificate(left, right) {
  try {
    const leftDer = pemDecode(left);
    const rightDer = pemDecode(right);
    return (
      leftDer.length === rightDer.length && timingSafeEqual(leftDer, rightDer)
    );
  } catch {
    return false;
  }
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
