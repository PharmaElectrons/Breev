import { generateKeyPairSync, sign } from "node:crypto";

/**
 * A test licence issuer for the browser seam.
 *
 * The permitted device count is licence data, so proving that the Main pairing
 * screen honours it — and that a different licence changes the limit with no
 * code change — needs licences that really are signed and really do differ.
 * Breev publishes verification keys only, so the suite mints its own issuer and
 * hands the spawned server its public key through
 * test/licence-key-override.mjs. The licence pipeline under test is untouched.
 */
const keys = generateKeyPairSync("ed25519");

export const TEST_ISSUER_KEY_ID = "breev-browser-devices-ed25519";

export const TEST_ISSUER_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  [TEST_ISSUER_KEY_ID]: keys.publicKey.export({
    format: "pem",
    type: "spki",
  }) as string,
};

export interface MintedLicenceInput {
  readonly features?: readonly string[];
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
    graceEndsAt: "2099-01-08T00:00:00.000Z",
    licenceId: input.licenceId,
    features: input.features ?? ["additional-device-pos"],
    founderOverrideGrants: [],
    issuedAt: "2020-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8");
  return JSON.stringify({
    algorithm: "Ed25519",
    keyId: TEST_ISSUER_KEY_ID,
    payload: payload.toString("base64url"),
    signature: sign(null, payload, keys.privateKey).toString("base64url"),
  });
}
