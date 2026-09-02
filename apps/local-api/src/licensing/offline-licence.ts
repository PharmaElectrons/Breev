import {
  PAID_CAPABILITY_NAMES,
  type PaidCapabilityName,
} from "@breev/contracts/local-rest";
import { verify } from "node:crypto";

export const PAID_CAPABILITIES = PAID_CAPABILITY_NAMES;

export type PaidCapability = PaidCapabilityName;

export interface OfflineLicenceClaims {
  readonly formatVersion: 1;
  readonly keyId: string;
  readonly licenceId: string;
  readonly pharmacyId: string;
  readonly mainDeviceId: string;
  readonly plan: string;
  readonly features: readonly PaidCapability[];
  readonly founderOverrideGrants: readonly PaidCapability[];
  readonly permittedDeviceCount: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly graceEndsAt: string;
}

type InvalidReason =
  | "binding-mismatch"
  | "expired"
  | "malformed"
  | "not-yet-valid"
  | "signature-invalid"
  | "unknown-key"
  | "unsupported-algorithm"
  | "unsupported-format";

/**
 * `grace` is the signed window from `expiresAt` (inclusive) to `graceEndsAt`
 * (exclusive). The claims are still trusted and paid capabilities continue;
 * what changes is decided by the caller — today, new terminal pairing is
 * refused. The window's length is whatever the issuer signed. This is the
 * one place that reads the clock against the licence, so no other module
 * decides expiry.
 */
export type OfflineLicenceVerification =
  | { readonly status: "valid"; readonly claims: OfflineLicenceClaims }
  | { readonly status: "grace"; readonly claims: OfflineLicenceClaims }
  | { readonly status: "invalid"; readonly reason: InvalidReason };

interface LicenceEnvelope {
  readonly algorithm: string;
  readonly keyId: string;
  readonly payload: string;
  readonly signature: string;
}

export function verifyOfflineLicence(input: {
  readonly encodedLicence: string;
  readonly expectedMainDeviceId: string;
  readonly expectedPharmacyId: string;
  readonly now: Date;
  readonly publicKeys: Readonly<Record<string, string>>;
}): OfflineLicenceVerification {
  const envelope = parseEnvelope(input.encodedLicence);
  if (envelope === undefined) return invalid("malformed");
  if (envelope.algorithm !== "Ed25519") {
    return invalid("unsupported-algorithm");
  }
  const publicKey = input.publicKeys[envelope.keyId];
  if (publicKey === undefined) return invalid("unknown-key");
  const payload = decodeBase64Url(envelope.payload);
  const signature = decodeBase64Url(envelope.signature);
  if (payload === undefined || signature === undefined) {
    return invalid("malformed");
  }
  try {
    if (!verify(null, payload, publicKey, signature)) {
      return invalid("signature-invalid");
    }
  } catch {
    return invalid("signature-invalid");
  }
  const claims = parseClaims(payload);
  if (claims === "unsupported-format") return invalid(claims);
  if (claims === undefined || claims.keyId !== envelope.keyId) {
    return invalid("malformed");
  }
  if (
    claims.pharmacyId !== input.expectedPharmacyId ||
    claims.mainDeviceId !== input.expectedMainDeviceId
  ) {
    return invalid("binding-mismatch");
  }
  const now = input.now.getTime();
  if (!Number.isFinite(now)) return invalid("malformed");
  if (now < Date.parse(claims.issuedAt)) return invalid("not-yet-valid");
  if (now >= Date.parse(claims.graceEndsAt)) return invalid("expired");
  if (now >= Date.parse(claims.expiresAt)) return { status: "grace", claims };
  return { status: "valid", claims };
}

function invalid(reason: InvalidReason): OfflineLicenceVerification {
  return { status: "invalid", reason };
}

function parseEnvelope(value: string): LicenceEnvelope | undefined {
  if (Buffer.byteLength(value, "utf8") > 64 * 1024) return undefined;
  const parsed = parseJson(value);
  if (
    !isExactRecord(parsed, ["algorithm", "keyId", "payload", "signature"]) ||
    typeof parsed.algorithm !== "string" ||
    !isKeyId(parsed.keyId) ||
    typeof parsed.payload !== "string" ||
    typeof parsed.signature !== "string"
  ) {
    return undefined;
  }
  return {
    algorithm: parsed.algorithm,
    keyId: parsed.keyId,
    payload: parsed.payload,
    signature: parsed.signature,
  };
}

function parseClaims(
  payload: Buffer,
): OfflineLicenceClaims | "unsupported-format" | undefined {
  const parsed = parseJson(payload.toString("utf8"));
  if (
    !isExactRecord(parsed, [
      "expiresAt",
      "features",
      "formatVersion",
      "founderOverrideGrants",
      "graceEndsAt",
      "issuedAt",
      "keyId",
      "licenceId",
      "mainDeviceId",
      "permittedDeviceCount",
      "pharmacyId",
      "plan",
    ]) ||
    typeof parsed.formatVersion !== "number" ||
    !Number.isInteger(parsed.formatVersion)
  ) {
    return undefined;
  }
  if (parsed.formatVersion !== 1) return "unsupported-format";
  if (
    !isKeyId(parsed.keyId) ||
    !isUuidV7(parsed.licenceId) ||
    !isUuidV7(parsed.pharmacyId) ||
    !isUuidV7(parsed.mainDeviceId) ||
    typeof parsed.plan !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/u.test(parsed.plan) ||
    !isCapabilitySet(parsed.features) ||
    !isCapabilitySet(parsed.founderOverrideGrants) ||
    typeof parsed.permittedDeviceCount !== "number" ||
    !Number.isInteger(parsed.permittedDeviceCount) ||
    parsed.permittedDeviceCount < 1 ||
    // Licensing data, never a hard-coded software limit; this upper bound
    // is a transport-safety guard, not a product ceiling (mirrors
    // packages/contracts/src/local-rest/index.ts's licenceSummarySchema).
    parsed.permittedDeviceCount > 1_000_000 ||
    !isIsoInstant(parsed.issuedAt) ||
    !isIsoInstant(parsed.expiresAt) ||
    !isIsoInstant(parsed.graceEndsAt) ||
    Date.parse(parsed.issuedAt) >= Date.parse(parsed.expiresAt) ||
    Date.parse(parsed.expiresAt) > Date.parse(parsed.graceEndsAt)
  ) {
    return undefined;
  }
  return {
    formatVersion: 1,
    keyId: parsed.keyId,
    licenceId: parsed.licenceId,
    pharmacyId: parsed.pharmacyId,
    mainDeviceId: parsed.mainDeviceId,
    plan: parsed.plan,
    features: parsed.features,
    founderOverrideGrants: parsed.founderOverrideGrants,
    permittedDeviceCount: parsed.permittedDeviceCount,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
    graceEndsAt: parsed.graceEndsAt,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key, index) => keys[index] === key)
  );
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : undefined;
}

function isCapabilitySet(value: unknown): value is PaidCapability[] {
  return (
    Array.isArray(value) &&
    value.length <= PAID_CAPABILITIES.length &&
    value.every(
      (entry): entry is PaidCapability =>
        typeof entry === "string" &&
        (PAID_CAPABILITIES as readonly string[]).includes(entry),
    ) &&
    new Set(value).size === value.length
  );
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function isKeyId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)
  );
}

function isUuidV7(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
