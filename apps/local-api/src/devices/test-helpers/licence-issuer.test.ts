import { generateKeyPairSync, sign } from "node:crypto";

/**
 * A test licence issuer.
 *
 * Breev ships verification keys only, and no signing key for the published test
 * issuer exists in this repository — by design. Seat allocation has to be
 * proven against real signed licences that differ only in their permitted
 * device count, so the device seam mints its own issuer at run time and points
 * the licence key registry at it for the duration of the suite. The licence
 * pipeline under test is untouched: the same parser, the same signature check,
 * the same entitlement derivation.
 */
const keys = generateKeyPairSync("ed25519");

export const TEST_ISSUER_KEY_ID = "breev-devices-test-ed25519";
export const TEST_ISSUER_PUBLIC_KEY_PEM = keys.publicKey.export({
  format: "pem",
  type: "spki",
}) as string;

export interface MintedLicenceInput {
  readonly expiresAt?: string;
  readonly features?: readonly string[];
  readonly graceEndsAt?: string;
  readonly issuedAt?: string;
  readonly licenceId: string;
  readonly mainDeviceId: string;
  readonly permittedDeviceCount: number;
  readonly pharmacyId: string;
}

export function mintLicence(input: MintedLicenceInput): string {
  const claims = {
    formatVersion: 1,
    keyId: TEST_ISSUER_KEY_ID,
    pharmacyId: input.pharmacyId,
    mainDeviceId: input.mainDeviceId,
    plan: "professional",
    permittedDeviceCount: input.permittedDeviceCount,
    graceEndsAt: input.graceEndsAt ?? "2099-01-08T00:00:00.000Z",
    licenceId: input.licenceId,
    features: input.features ?? ["additional-device-pos"],
    founderOverrideGrants: [],
    issuedAt: input.issuedAt ?? "2020-01-01T00:00:00.000Z",
    expiresAt: input.expiresAt ?? "2099-01-01T00:00:00.000Z",
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8");
  return JSON.stringify({
    algorithm: "Ed25519",
    keyId: TEST_ISSUER_KEY_ID,
    payload: payload.toString("base64url"),
    signature: sign(null, payload, keys.privateKey).toString("base64url"),
  });
}
