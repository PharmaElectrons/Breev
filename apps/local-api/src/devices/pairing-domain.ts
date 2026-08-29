import {
  PAIRING_BINDING_PREFIX,
  PAIRING_FINGERPRINT_DIGITS,
  PAIRING_INVITATION_PREFIX,
  type DevicesDenialCode,
  type PairingSessionStateName,
} from "@breev/contracts/local-rest";
import { createHash } from "node:crypto";

/**
 * The pairing ceremony, expressed without a database, a socket, or a clock of
 * its own.
 *
 * Everything in this file is a total function of its inputs: the binary
 * transcripts both sides sign, the twelve digits both screens compare, the
 * state machine that decides whether a join, confirmation, cancellation, or
 * certificate fetch may proceed, and the seat policy that reads the permitted
 * device count out of licence data. The service layer supplies the row, the
 * clock, and the transaction; the decisions live here so every failure case
 * can be proven without PostgreSQL.
 */

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const FINGERPRINT_MODULUS = 10n ** BigInt(PAIRING_FINGERPRINT_DIGITS);

/**
 * Domain separators. Every transcript is prefixed with its own label and a
 * zero byte so a signature produced for one step can never be replayed into
 * another, even though all three cover the same session.
 */
export const PAIRING_TRANSCRIPT_LABELS = {
  fetch: "breev-pairing-fetch-v1",
  fingerprint: "breev-pairing-fingerprint-v1",
  join: "breev-pairing-join-v1",
} as const;

export interface PairingIdentityBinding {
  readonly caFingerprint: string;
  readonly installationId: string;
  readonly sessionId: string;
  readonly spkiDer: Buffer;
}

export function uuidToBytes(value: string): Buffer {
  if (!UUID_V7_PATTERN.test(value)) {
    throw new Error("A pairing transcript identifier must be a UUIDv7");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

export function fingerprintToBytes(value: string): Buffer {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new Error("A pairing transcript fingerprint must be SHA-256 hex");
  }
  return Buffer.from(value, "hex");
}

/**
 * `T_join`: what the terminal signs with the key it just generated, proving it
 * holds the private half of the key inside the CSR and that it is talking to
 * this session, this installation, and this CA.
 */
export function buildJoinTranscript(binding: PairingIdentityBinding): Buffer {
  return concatTranscript(PAIRING_TRANSCRIPT_LABELS.join, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    fingerprintToBytes(binding.caFingerprint),
    binding.spkiDer,
  ]);
}

/**
 * `T_fetch`: what the terminal signs to collect the issued certificate. It
 * omits the CA fingerprint so it can never be confused with a join.
 */
export function buildFetchTranscript(
  binding: Omit<PairingIdentityBinding, "caFingerprint">,
): Buffer {
  return concatTranscript(PAIRING_TRANSCRIPT_LABELS.fetch, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    binding.spkiDer,
  ]);
}

/** `T_phrase`: the material both screens reduce to twelve digits. */
export function buildFingerprintTranscript(
  binding: PairingIdentityBinding,
): Buffer {
  return concatTranscript(PAIRING_TRANSCRIPT_LABELS.fingerprint, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    fingerprintToBytes(binding.caFingerprint),
    binding.spkiDer,
  ]);
}

/**
 * Twelve decimal digits derived from the first eight bytes of the transcript
 * digest. Digits, not words: the same characters render identically in Arabic
 * and English, so the two operators are always comparing the same thing.
 */
export function deriveFingerprintDigits(transcript: Buffer): string {
  const digest = createHash("sha256").update(transcript).digest();
  const leading = digest.subarray(0, 8).toString("hex");
  return (BigInt(`0x${leading}`) % FINGERPRINT_MODULUS)
    .toString(10)
    .padStart(PAIRING_FINGERPRINT_DIGITS, "0");
}

export interface PairingInvitationPayload {
  readonly caFingerprint: string;
  readonly host: string;
  readonly installationId: string;
  readonly joinSecret: string;
  readonly port: number;
  readonly sessionId: string;
}

export interface PairingBindingPayload {
  readonly caFingerprint: string;
  readonly host: string;
  readonly installationId: string;
  readonly port: number;
  readonly sessionId: string;
  readonly spkiSha256: string;
}

/**
 * QR v1 — the invitation. It carries the one-use join secret, so it is the one
 * artifact that must never be persisted, logged, or audited.
 */
export function encodePairingInvitation(
  payload: PairingInvitationPayload,
): string {
  return `${PAIRING_INVITATION_PREFIX}${encodeCanonical([
    ["v", 1],
    ["i", payload.installationId],
    ["h", payload.host],
    ["p", payload.port],
    ["f", payload.caFingerprint],
    ["s", payload.sessionId],
    ["k", payload.joinSecret],
  ])}`;
}

/**
 * QR v2 — the binding artifact the Main screen shows once the terminal has
 * proposed a key. It is the invitation minus the secret, plus the digest of
 * the proposed public key, so it binds session, installation, CA, and terminal
 * identity together with nothing reusable inside it.
 */
export function encodePairingBinding(payload: PairingBindingPayload): string {
  return `${PAIRING_BINDING_PREFIX}${encodeCanonical([
    ["v", 2],
    ["i", payload.installationId],
    ["h", payload.host],
    ["p", payload.port],
    ["f", payload.caFingerprint],
    ["s", payload.sessionId],
    ["t", payload.spkiSha256],
  ])}`;
}

/**
 * Reads an invitation back. The Additional POS Terminal decodes the QR with its
 * own implementation, so this exists on the server side as the exact inverse of
 * {@link encodePairingInvitation}: it is what proves the encoding round-trips
 * and what lets the ceremony be driven end to end against a real listener.
 */
export function decodePairingInvitation(
  uri: string,
): PairingInvitationPayload | undefined {
  if (!uri.startsWith(PAIRING_INVITATION_PREFIX)) {
    return undefined;
  }
  const decoded = decodeCanonical(uri.slice(PAIRING_INVITATION_PREFIX.length));
  if (
    decoded === undefined ||
    decoded.v !== 1 ||
    !isNonEmptyString(decoded.i) ||
    !isNonEmptyString(decoded.h) ||
    typeof decoded.p !== "number" ||
    !Number.isInteger(decoded.p) ||
    decoded.p < 1 ||
    decoded.p > 65_535 ||
    !isNonEmptyString(decoded.f) ||
    !isNonEmptyString(decoded.s) ||
    !isNonEmptyString(decoded.k)
  ) {
    return undefined;
  }
  return {
    caFingerprint: decoded.f,
    host: decoded.h,
    installationId: decoded.i,
    joinSecret: decoded.k,
    port: decoded.p,
    sessionId: decoded.s,
  };
}

export interface PairingSessionSnapshot {
  readonly boundAt: Date | undefined;
  readonly consumedAt: Date | undefined;
  readonly expiresAt: Date;
  readonly joinAttemptCount: number;
  readonly maxJoinAttempts: number;
  readonly state: PairingSessionStateName;
}

export type PairingDenialCode = Extract<
  DevicesDenialCode,
  | "pairing-attempts-exceeded"
  | "pairing-session-conflict"
  | "pairing-session-expired"
  | "pairing-session-missing"
  | "pairing-session-replayed"
  | "pairing-signature-invalid"
>;

/**
 * What the server does about one join attempt.
 *
 * `auditCode` is always the true reason. `responseCode` is what the terminal is
 * told, and it deliberately reports a wrong secret exactly the way it reports
 * an unknown session: a caller holding the QR photograph must not be able to
 * confirm a guess from the response body.
 */
export type PairingJoinDecision =
  | { readonly kind: "bind" }
  | {
      readonly kind: "deny";
      readonly auditCode: PairingDenialCode;
      readonly nextState: PairingSessionStateName | undefined;
      readonly recordAttempt: boolean;
      readonly responseCode: PairingDenialCode;
    };

export function evaluateJoinAttempt(input: {
  readonly now: Date;
  readonly secretMatches: boolean;
  readonly snapshot: PairingSessionSnapshot;
}): PairingJoinDecision {
  const { now, secretMatches, snapshot } = input;
  if (
    snapshot.state === "confirmed" ||
    snapshot.state === "awaiting-confirmation"
  ) {
    // The bound key is never replaced, right or wrong secret: the first
    // terminal to prove possession owns this session.
    return deny("pairing-session-replayed", "pairing-session-replayed");
  }
  if (snapshot.state === "failed") {
    // The session died because its attempt budget ran out, and saying so is
    // what lets the terminal explain itself to the operator standing at it.
    return deny("pairing-attempts-exceeded", "pairing-attempts-exceeded");
  }
  if (snapshot.state === "cancelled") {
    return deny("pairing-session-conflict", "pairing-session-conflict");
  }
  if (snapshot.state === "expired" || hasExpired(snapshot, now)) {
    return {
      kind: "deny",
      auditCode: "pairing-session-expired",
      nextState: snapshot.state === "open" ? "expired" : undefined,
      recordAttempt: false,
      responseCode: "pairing-session-expired",
    };
  }
  if (snapshot.joinAttemptCount >= snapshot.maxJoinAttempts) {
    return {
      kind: "deny",
      auditCode: "pairing-attempts-exceeded",
      nextState: "failed",
      recordAttempt: false,
      responseCode: "pairing-attempts-exceeded",
    };
  }
  if (!secretMatches) {
    const attempts = snapshot.joinAttemptCount + 1;
    const exhausted = attempts >= snapshot.maxJoinAttempts;
    // Until the budget runs out, a wrong secret is reported exactly the way an
    // unknown session is, so a caller holding a photographed QR cannot confirm
    // a guess. The final attempt does say the budget is exhausted, because the
    // operator standing at the terminal needs to be told why it stopped — and
    // by then the session is dead, so the disclosure buys an attacker nothing.
    return {
      kind: "deny",
      auditCode: exhausted
        ? "pairing-attempts-exceeded"
        : "pairing-session-missing",
      nextState: exhausted ? "failed" : undefined,
      recordAttempt: true,
      responseCode: exhausted
        ? "pairing-attempts-exceeded"
        : "pairing-session-missing",
    };
  }
  return { kind: "bind" };
}

export type PairingTransitionDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly code: PairingDenialCode };

export function evaluateConfirmation(input: {
  readonly now: Date;
  readonly snapshot: PairingSessionSnapshot;
}): PairingTransitionDecision {
  const { now, snapshot } = input;
  if (snapshot.state === "confirmed" || snapshot.consumedAt !== undefined) {
    return { kind: "deny", code: "pairing-session-replayed" };
  }
  if (snapshot.state === "expired" || hasExpired(snapshot, now)) {
    return { kind: "deny", code: "pairing-session-expired" };
  }
  if (snapshot.state !== "awaiting-confirmation") {
    return { kind: "deny", code: "pairing-session-conflict" };
  }
  return { kind: "allow" };
}

export function evaluateCancellation(input: {
  readonly now: Date;
  readonly snapshot: PairingSessionSnapshot;
}): PairingTransitionDecision {
  const { now, snapshot } = input;
  if (snapshot.state === "confirmed") {
    return { kind: "deny", code: "pairing-session-replayed" };
  }
  if (snapshot.state === "cancelled" || snapshot.state === "failed") {
    return { kind: "deny", code: "pairing-session-conflict" };
  }
  if (snapshot.state === "expired" || hasExpired(snapshot, now)) {
    return { kind: "deny", code: "pairing-session-expired" };
  }
  return { kind: "allow" };
}

/**
 * The certificate is delivered only after a human confirmed the digits, and
 * only to whoever can sign the fetch transcript with the bound key. Delivery is
 * idempotent because a terminal that lost the response must be able to ask
 * again; expiry no longer applies once the certificate exists.
 */
export function evaluateCertificateDelivery(input: {
  readonly now: Date;
  readonly snapshot: PairingSessionSnapshot;
}): PairingTransitionDecision {
  const { now, snapshot } = input;
  if (snapshot.state === "confirmed") {
    return { kind: "allow" };
  }
  if (snapshot.state === "cancelled" || snapshot.state === "failed") {
    return { kind: "deny", code: "pairing-session-conflict" };
  }
  if (snapshot.state === "expired" || hasExpired(snapshot, now)) {
    return { kind: "deny", code: "pairing-session-expired" };
  }
  return { kind: "deny", code: "pairing-session-conflict" };
}

export interface SeatUsage {
  readonly permitted: number;
  readonly used: number;
}

/**
 * The Main Pharmacy Computer always occupies one seat; every terminal whose
 * seat has not been released occupies another, revoked or not. Releasing a seat
 * is a deliberate two-user act, so revocation alone never frees one.
 */
export function describeSeatUsage(input: {
  readonly allocatedTerminalSeats: number;
  readonly permittedDeviceCount: number;
}): SeatUsage {
  return {
    permitted: input.permittedDeviceCount,
    used: 1 + input.allocatedTerminalSeats,
  };
}

export type SeatAllocationDecision =
  | { readonly kind: "allocate"; readonly usage: SeatUsage }
  | {
      readonly kind: "deny";
      readonly code: Extract<DevicesDenialCode, "pairing-seat-unavailable">;
      readonly usage: SeatUsage;
    };

export function evaluateSeatAllocation(input: {
  readonly allocatedTerminalSeats: number;
  readonly permittedDeviceCount: number;
}): SeatAllocationDecision {
  const current = describeSeatUsage(input);
  const usage: SeatUsage = {
    permitted: current.permitted,
    used: current.used + 1,
  };
  if (usage.used > usage.permitted) {
    return { kind: "deny", code: "pairing-seat-unavailable", usage: current };
  }
  return { kind: "allocate", usage };
}

function deny(
  auditCode: PairingDenialCode,
  responseCode: PairingDenialCode,
): PairingJoinDecision {
  return {
    kind: "deny",
    auditCode,
    nextState: undefined,
    recordAttempt: false,
    responseCode,
  };
}

function hasExpired(snapshot: PairingSessionSnapshot, now: Date): boolean {
  return now.getTime() >= snapshot.expiresAt.getTime();
}

function concatTranscript(label: string, parts: readonly Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(label, "utf8"), Buffer.of(0x00), ...parts]);
}

function encodeCanonical(
  entries: readonly (readonly [string, number | string])[],
): string {
  const body = entries
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join(",");
  return Buffer.from(`{${body}}`, "utf8").toString("base64url");
}

function decodeCanonical(encoded: string): Record<string, unknown> | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length > 2_048) {
    return undefined;
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
