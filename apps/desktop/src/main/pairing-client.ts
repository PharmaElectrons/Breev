import type { TerminalPairingFailureReason } from "@breev/contracts/desktop-preload";
import { generateKeyPair } from "node:crypto";
import {
  Agent,
  request as httpsRequest,
  type Agent as HttpsAgent,
} from "node:https";
import { connect as tlsConnect } from "node:tls";
import { promisify } from "node:util";

import type {
  PairingEndpoint,
  PairingInvitation,
} from "./pairing-invitation.js";
import {
  buildFetchTranscript,
  buildJoinTranscript,
  buildTerminalCertificateRequest,
  deriveFingerprintDigits,
  isUuidV7,
  signTranscript,
  subjectPublicKeyInfoDer,
} from "./pairing-transcript.js";
import {
  collectPeerChain,
  createPairingServerIdentityChecker,
  verifyIssuedDeviceCertificate,
  verifyPairingServerChain,
} from "./pairing-trust.js";
import type { TerminalDeviceBinding } from "./terminal-binding.js";

export const PAIRING_CERTIFICATES_PATH = "/pairing/certificates" as const;
export const PAIRING_JOINS_PATH = "/pairing/joins" as const;

const HANDSHAKE_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_LIMIT_BYTES = 16 * 1024;
/**
 * The pairing channel gives state polling its own per-minute allowance, and
 * this interval stays comfortably inside it while still noticing a
 * confirmation within a few seconds.
 */
export const SESSION_POLL_INTERVAL_MS = 3_000;
/**
 * A 429 says the channel is busy, never that the session is over: the Main
 * installation keeps it open for its full five minutes. Waiting out a whole
 * rate-limit window and continuing is the only reading that does not throw
 * away a live ceremony.
 */
export const SESSION_POLL_RATE_LIMITED_BACKOFF_MS = 15_000;
export const SESSION_POLL_DEADLINE_MS = 6 * 60_000;
const RATE_LIMITED_STATUS = 429;

const generateKeyPairAsync = promisify(generateKeyPair);

export class PairingFailure extends Error {
  readonly reason: TerminalPairingFailureReason;

  constructor(reason: TerminalPairingFailureReason, message: string) {
    super(message);
    this.name = "PairingFailure";
    this.reason = reason;
  }
}

export type PairingCeremonyStage =
  | "awaiting-confirmation"
  | "fetching-certificate"
  | "generating-key"
  | "joining"
  | "validating-endpoint";

export interface PairingCeremonyProgress {
  readonly deviceName?: string;
  readonly fingerprintDigits?: string;
  readonly stage: PairingCeremonyStage;
}

export interface PairingCeremonyResult {
  readonly binding: Omit<TerminalDeviceBinding, "keyProtection">;
  readonly privateKeyPem: string;
}

/**
 * The whole terminal side of the ceremony. Every step either advances on
 * verified facts or throws a PairingFailure naming a state the renderer can
 * show and the operator can retry.
 */
export async function runPairingCeremony(params: {
  readonly deviceName: string;
  readonly invitation: PairingInvitation;
  readonly onProgress: (progress: PairingCeremonyProgress) => void;
  readonly signal: AbortSignal;
}): Promise<PairingCeremonyResult> {
  const { invitation, signal } = params;
  throwIfCancelled(signal);

  params.onProgress({ stage: "validating-endpoint" });
  const caCertificatePem = await readPinnedAuthority(invitation, signal);
  const agent = createPairingAgent(caCertificatePem, invitation);

  try {
    throwIfCancelled(signal);
    params.onProgress({ stage: "generating-key" });
    const keys = await generateKeyPairAsync("rsa", { modulusLength: 2048 });
    const spkiDer = subjectPublicKeyInfoDer(keys.publicKey);
    const binding = {
      caFingerprint: invitation.caFingerprint,
      installationId: invitation.installationId,
      sessionId: invitation.sessionId,
      subjectPublicKeyInfoDer: spkiDer,
    };
    const fingerprintDigits = deriveFingerprintDigits(binding);

    throwIfCancelled(signal);
    params.onProgress({ stage: "joining" });
    await postJoin({
      agent,
      csrPem: buildTerminalCertificateRequest(keys),
      deviceName: params.deviceName,
      endpoint: invitation.endpoint,
      invitation,
      signal,
      transcriptSignature: signTranscript(
        buildJoinTranscript(binding),
        keys.privateKey,
      ),
    });

    params.onProgress({
      deviceName: params.deviceName,
      fingerprintDigits,
      stage: "awaiting-confirmation",
    });
    await awaitConfirmation({ agent, invitation, signal });

    params.onProgress({ fingerprintDigits, stage: "fetching-certificate" });
    const issued = await postCertificateFetch({
      agent,
      endpoint: invitation.endpoint,
      invitation,
      signal,
      signature: signTranscript(
        buildFetchTranscript({
          installationId: invitation.installationId,
          sessionId: invitation.sessionId,
          subjectPublicKeyInfoDer: spkiDer,
        }),
        keys.privateKey,
      ),
    });

    let verified;
    try {
      verified = verifyIssuedDeviceCertificate({
        caCertificatePem: issued.caCertificatePem,
        caFingerprint: invitation.caFingerprint,
        certificatePem: issued.certificatePem,
        expectedInstallationId: invitation.installationId,
        subjectPublicKeyInfoDer: spkiDer,
      });
    } catch (error) {
      throw new PairingFailure(
        "certificate-invalid",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (verified.deviceId !== issued.deviceId) {
      throw new PairingFailure(
        "certificate-invalid",
        "The issued certificate names a different device",
      );
    }

    return {
      binding: {
        caCertificatePem: issued.caCertificatePem,
        caFingerprint: invitation.caFingerprint,
        certificatePem: issued.certificatePem,
        deviceId: verified.deviceId,
        endpointHost: invitation.endpoint.host,
        endpointPort: invitation.endpoint.port,
        installationId: verified.installationId,
      },
      privateKeyPem: keys.privateKey.export({
        format: "pem",
        type: "pkcs8",
      }) as string,
    };
  } finally {
    agent.destroy();
  }
}

/**
 * The first connection is the only unauthenticated one. It exchanges no
 * application data: the terminal reads the presented chain, checks it against
 * the invitation pin, and drops the socket before writing anything.
 */
export async function readPinnedAuthority(
  invitation: PairingInvitation,
  signal: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal);
  return new Promise<string>((resolve, reject) => {
    const socket = tlsConnect({
      host: invitation.endpoint.host,
      minVersion: "TLSv1.2",
      port: invitation.endpoint.port,
      rejectUnauthorized: false,
      servername: undefined,
      timeout: HANDSHAKE_TIMEOUT_MS,
    });
    const abort = (): void => {
      socket.destroy();
      reject(new PairingFailure("cancelled", "Pairing was cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    const settle = (error: Error | undefined, value?: string): void => {
      signal.removeEventListener("abort", abort);
      socket.destroy();
      if (error === undefined && value !== undefined) {
        resolve(value);
      } else {
        reject(error ?? new PairingFailure("unexpected", "Pairing failed"));
      }
    };

    socket.once("secureConnect", () => {
      try {
        const peer = socket.getPeerCertificate(true);
        if (!Buffer.isBuffer(peer.raw)) {
          throw new PairingFailure(
            "server-identity-rejected",
            "The Main installation presented no certificate",
          );
        }
        const authority = verifyPairingServerChain({
          caFingerprint: invitation.caFingerprint,
          chain: collectPeerChain(peer),
          installationId: invitation.installationId,
        });
        settle(undefined, authority.caCertificatePem);
      } catch (error) {
        settle(
          error instanceof PairingFailure
            ? error
            : new PairingFailure(
                "server-identity-rejected",
                error instanceof Error ? error.message : String(error),
              ),
        );
      }
    });
    socket.once("timeout", () =>
      settle(
        new PairingFailure(
          "endpoint-unreachable",
          "The Main installation did not answer in time",
        ),
      ),
    );
    socket.once("error", (error) =>
      settle(new PairingFailure("endpoint-unreachable", error.message)),
    );
  });
}

export function createPairingAgent(
  caCertificatePem: string,
  invitation: PairingInvitation,
): HttpsAgent {
  return new Agent({
    ca: caCertificatePem,
    checkServerIdentity: createPairingServerIdentityChecker({
      caFingerprint: invitation.caFingerprint,
      installationId: invitation.installationId,
    }),
    keepAlive: false,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
  });
}

/**
 * The Main installation never says whether a denied join used an unknown
 * session or a wrong secret. Each distinct code it does publish becomes its
 * own retryable renderer state.
 */
export function mapPairingDenial(code: unknown): TerminalPairingFailureReason {
  switch (code) {
    case "pairing-attempts-exceeded":
      return "attempts-exceeded";
    case "pairing-entitlement-missing":
      return "entitlement-missing";
    case "pairing-seat-unavailable":
      return "seat-unavailable";
    case "pairing-session-expired":
      return "session-expired";
    default:
      return "session-denied";
  }
}

export type PairingSessionOutcome =
  | { readonly kind: "confirmed" }
  | { readonly kind: "failed"; readonly reason: TerminalPairingFailureReason }
  | { readonly kind: "waiting" };

export function mapPairingSessionState(state: unknown): PairingSessionOutcome {
  switch (state) {
    case "awaiting-confirmation":
    case "open":
      return { kind: "waiting" };
    case "cancelled":
      return { kind: "failed", reason: "session-cancelled" };
    case "confirmed":
      return { kind: "confirmed" };
    case "expired":
      return { kind: "failed", reason: "session-expired" };
    case "failed":
      return { kind: "failed", reason: "attempts-exceeded" };
    default:
      return { kind: "failed", reason: "session-denied" };
  }
}

export type PairingPollDecision =
  | { readonly kind: "confirmed" }
  | { readonly kind: "failed"; readonly reason: TerminalPairingFailureReason }
  | { readonly kind: "retry"; readonly waitMs: number };

/**
 * What one confirmation poll means, with no clock and no socket in sight so the
 * retry and back-off rules can be read and tested on their own. `remainingMs`
 * is what is left of the ceremony deadline, and it governs every outcome: a
 * poll that would sleep past it ends the ceremony instead.
 */
export function decidePairingPoll(poll: {
  readonly payload: unknown;
  readonly remainingMs: number;
  readonly status: number;
}): PairingPollDecision {
  const record = asRecord(poll.payload);
  if (poll.status === RATE_LIMITED_STATUS) {
    return waitOrExpire(poll.remainingMs, SESSION_POLL_RATE_LIMITED_BACKOFF_MS);
  }
  if (poll.status !== 200) {
    return { kind: "failed", reason: mapPairingDenial(record?.code) };
  }
  const outcome = mapPairingSessionState(record?.state);
  if (outcome.kind !== "waiting") {
    return outcome;
  }
  return waitOrExpire(poll.remainingMs, SESSION_POLL_INTERVAL_MS);
}

function waitOrExpire(
  remainingMs: number,
  requestedMs: number,
): PairingPollDecision {
  return remainingMs <= 0
    ? { kind: "failed", reason: "session-expired" }
    : { kind: "retry", waitMs: Math.min(requestedMs, remainingMs) };
}

export interface IssuedTerminalCertificate {
  readonly caCertificatePem: string;
  readonly certificatePem: string;
  readonly deviceId: string;
  readonly installationId: string;
}

export function parseIssuedCertificate(
  payload: unknown,
  expectedInstallationId: string,
): IssuedTerminalCertificate {
  const record = asRecord(payload);
  const caCertificatePem = record?.caCertificatePem;
  const certificatePem = record?.certificatePem;
  const deviceId = record?.deviceId;
  const installationId = record?.installationId;
  if (
    typeof caCertificatePem !== "string" ||
    typeof certificatePem !== "string" ||
    typeof deviceId !== "string" ||
    typeof installationId !== "string" ||
    !isUuidV7(deviceId) ||
    installationId !== expectedInstallationId
  ) {
    throw new PairingFailure(
      "certificate-invalid",
      "The issued certificate response is malformed",
    );
  }
  return { caCertificatePem, certificatePem, deviceId, installationId };
}

async function postJoin(params: {
  readonly agent: HttpsAgent;
  readonly csrPem: string;
  readonly deviceName: string;
  readonly endpoint: PairingEndpoint;
  readonly invitation: PairingInvitation;
  readonly signal: AbortSignal;
  readonly transcriptSignature: string;
}): Promise<void> {
  const response = await requestPairingJson({
    agent: params.agent,
    body: {
      csrPem: params.csrPem,
      deviceName: params.deviceName,
      joinSecret: params.invitation.joinSecret,
      sessionId: params.invitation.sessionId,
      transcriptSignature: params.transcriptSignature,
    },
    endpoint: params.endpoint,
    method: "POST",
    path: PAIRING_JOINS_PATH,
    signal: params.signal,
  });

  const record = asRecord(response.payload);
  if (response.status !== 200 || record?.status !== "bound") {
    throw new PairingFailure(
      mapPairingDenial(record?.code),
      "The Main installation denied the pairing join",
    );
  }
}

async function awaitConfirmation(params: {
  readonly agent: HttpsAgent;
  readonly invitation: PairingInvitation;
  readonly signal: AbortSignal;
}): Promise<void> {
  const deadline = Date.now() + SESSION_POLL_DEADLINE_MS;
  for (;;) {
    throwIfCancelled(params.signal);
    const response = await requestPairingJson({
      agent: params.agent,
      endpoint: params.invitation.endpoint,
      method: "GET",
      path: `/pairing/sessions/${params.invitation.sessionId}/state`,
      signal: params.signal,
    });
    const decision = decidePairingPoll({
      payload: response.payload,
      remainingMs: deadline - Date.now(),
      status: response.status,
    });
    if (decision.kind === "confirmed") {
      return;
    }
    if (decision.kind === "failed") {
      throw new PairingFailure(
        decision.reason,
        "The pairing session did not reach confirmation",
      );
    }
    await delay(decision.waitMs, params.signal);
  }
}

async function postCertificateFetch(params: {
  readonly agent: HttpsAgent;
  readonly endpoint: PairingEndpoint;
  readonly invitation: PairingInvitation;
  readonly signal: AbortSignal;
  readonly signature: string;
}): Promise<IssuedTerminalCertificate> {
  const response = await requestPairingJson({
    agent: params.agent,
    body: {
      sessionId: params.invitation.sessionId,
      signature: params.signature,
    },
    endpoint: params.endpoint,
    method: "POST",
    path: PAIRING_CERTIFICATES_PATH,
    signal: params.signal,
  });
  const record = asRecord(response.payload);
  if (response.status !== 200) {
    throw new PairingFailure(
      mapPairingDenial(record?.code),
      "The Main installation denied the certificate fetch",
    );
  }
  return parseIssuedCertificate(
    response.payload,
    params.invitation.installationId,
  );
}

interface PairingJsonResponse {
  readonly payload: unknown;
  readonly status: number;
}

function requestPairingJson(params: {
  readonly agent: HttpsAgent;
  readonly body?: unknown;
  readonly endpoint: PairingEndpoint;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly signal: AbortSignal;
}): Promise<PairingJsonResponse> {
  const body =
    params.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(params.body), "utf8");

  return new Promise<PairingJsonResponse>((resolve, reject) => {
    const request = httpsRequest(
      {
        agent: params.agent,
        headers: {
          accept: "application/json",
          ...(body === undefined
            ? {}
            : {
                "content-length": String(body.byteLength),
                "content-type": "application/json",
              }),
        },
        host: params.endpoint.host,
        method: params.method,
        path: params.path,
        port: params.endpoint.port,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > RESPONSE_LIMIT_BYTES) {
            request.destroy();
            settle(
              new PairingFailure(
                "unexpected",
                "The Main installation returned an oversized response",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let payload: unknown;
          try {
            payload = text.length === 0 ? undefined : JSON.parse(text);
          } catch {
            settle(
              new PairingFailure(
                "unexpected",
                "The Main installation returned an unreadable response",
              ),
            );
            return;
          }
          settle(undefined, { payload, status: response.statusCode ?? 0 });
        });
      },
    );

    const abort = (): void => {
      request.destroy();
      settle(new PairingFailure("cancelled", "Pairing was cancelled"));
    };
    let settled = false;
    const settle = (
      error: Error | undefined,
      value?: PairingJsonResponse,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      params.signal.removeEventListener("abort", abort);
      if (error === undefined && value !== undefined) {
        resolve(value);
      } else {
        reject(error ?? new PairingFailure("unexpected", "Pairing failed"));
      }
    };

    params.signal.addEventListener("abort", abort, { once: true });
    request.on("timeout", () => {
      request.destroy();
      settle(
        new PairingFailure(
          "endpoint-unreachable",
          "The Main installation did not answer in time",
        ),
      );
    });
    request.on("error", (error) => settle(toPairingFailure(error)));
    request.end(body);
  });
}

function toPairingFailure(error: Error): PairingFailure {
  const code = (error as NodeJS.ErrnoException).code;
  if (
    code !== undefined &&
    [
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    ].includes(code)
  ) {
    return new PairingFailure("server-identity-rejected", error.message);
  }
  return new PairingFailure("endpoint-unreachable", error.message);
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    function abort(): void {
      clearTimeout(timer);
      reject(new PairingFailure("cancelled", "Pairing was cancelled"));
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new PairingFailure("cancelled", "Pairing was cancelled");
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
