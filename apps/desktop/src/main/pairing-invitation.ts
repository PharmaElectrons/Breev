import { isIP } from "node:net";

import { isCaFingerprint, isUuidV7 } from "./pairing-transcript.js";

export const PAIRING_INVITATION_SCHEME = "breev-pair" as const;

const INVITATION_PATTERN = /^breev-pair:\/\/1\/([A-Za-z0-9_-]{1,2048})$/u;
const JOIN_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/iu;
const INVITATION_FIELDS = ["f", "h", "i", "k", "p", "s", "v"] as const;

export interface PairingEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface PairingInvitation {
  readonly caFingerprint: string;
  readonly endpoint: PairingEndpoint;
  readonly installationId: string;
  readonly joinSecret: string;
  readonly sessionId: string;
}

/**
 * The invitation is the only trust anchor a terminal ever receives. Parsing
 * fails closed: an unknown field, a widened type, or a value outside its exact
 * shape rejects the whole invitation rather than pairing on a partial reading.
 */
export function parsePairingInvitation(value: string): PairingInvitation {
  const match = INVITATION_PATTERN.exec(value.trim());
  if (match?.[1] === undefined) {
    throw new Error("The Breev pairing invitation is not a version 1 URI");
  }

  const payload = decodePayload(match[1]);
  const keys = Object.keys(payload).sort();
  if (
    keys.length !== INVITATION_FIELDS.length ||
    keys.some((key, index) => key !== INVITATION_FIELDS[index])
  ) {
    throw new Error("The Breev pairing invitation carries unexpected fields");
  }

  const version = payload.v;
  const installationId = payload.i;
  const host = payload.h;
  const port = payload.p;
  const caFingerprint = payload.f;
  const sessionId = payload.s;
  const joinSecret = payload.k;

  if (version !== 1) {
    throw new Error("The Breev pairing invitation version is not supported");
  }
  if (typeof installationId !== "string" || !isUuidV7(installationId)) {
    throw new Error("The Breev pairing invitation installation is invalid");
  }
  if (typeof sessionId !== "string" || !isUuidV7(sessionId)) {
    throw new Error("The Breev pairing invitation session is invalid");
  }
  if (typeof caFingerprint !== "string" || !isCaFingerprint(caFingerprint)) {
    throw new Error(
      "The Breev pairing invitation certificate authority pin is invalid",
    );
  }
  if (typeof joinSecret !== "string" || !isJoinSecret(joinSecret)) {
    throw new Error("The Breev pairing invitation join secret is invalid");
  }

  return {
    caFingerprint,
    endpoint: parseEndpoint(host, port),
    installationId,
    joinSecret,
    sessionId,
  };
}

/**
 * Discovery and manual entry move the terminal to another address. They never
 * touch the session, the join secret, or the pin, so a wrong address can only
 * fail the identity check rather than weaken it.
 */
export function withPairingEndpoint(
  invitation: PairingInvitation,
  endpoint: { readonly host: unknown; readonly port: unknown },
): PairingInvitation {
  return {
    ...invitation,
    endpoint: parseEndpoint(endpoint.host, endpoint.port),
  };
}

export function isPairingHost(value: string): boolean {
  return isIP(value) !== 0 || HOSTNAME_PATTERN.test(value);
}

function parseEndpoint(host: unknown, port: unknown): PairingEndpoint {
  if (typeof host !== "string" || !isPairingHost(host)) {
    throw new Error("The Breev pairing endpoint host is invalid");
  }
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error("The Breev pairing endpoint port is invalid");
  }
  return { host, port };
}

function isJoinSecret(value: string): boolean {
  return (
    JOIN_SECRET_PATTERN.test(value) &&
    Buffer.from(value, "base64url").length === 32
  );
}

function decodePayload(encoded: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("The Breev pairing invitation payload is not readable");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw new Error("The Breev pairing invitation payload is not an object");
  }
  return parsed as Record<string, unknown>;
}
