import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  type OfflineLicenceClaims,
  verifyOfflineLicence,
} from "./offline-licence.js";

const PHARMACY_ID = "019b0000-0000-7000-8000-000000000101";
const MAIN_DEVICE_ID = "019b0000-0000-7000-8000-000000000102";
const LICENCE_ID = "019b0000-0000-7000-8000-000000000103";

describe("verifyOfflineLicence", () => {
  it("accepts a valid Ed25519 licence bound to the pharmacy and Main device", () => {
    const keys = generateKeyPairSync("ed25519");
    const encodedLicence = encodeLicence(defaultClaims(), keys.privateKey);

    expect(
      verifyOfflineLicence({
        encodedLicence,
        expectedPharmacyId: PHARMACY_ID,
        expectedMainDeviceId: MAIN_DEVICE_ID,
        now: new Date("2027-01-01T00:00:00.000Z"),
        publicKeys: {
          test: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
      }),
    ).toEqual({ status: "valid", claims: defaultClaims() });
  });

  it("verifies the exact payload bytes before trusting founder overrides", () => {
    const keys = generateKeyPairSync("ed25519");
    const original = JSON.parse(
      encodeLicence(defaultClaims(), keys.privateKey),
    ) as Record<string, string>;
    const tamperedClaims = {
      ...defaultClaims(),
      founderOverrideGrants: ["purchase-invoice-ocr"],
    };
    original.payload = Buffer.from(JSON.stringify(tamperedClaims)).toString(
      "base64url",
    );

    expect(
      verify(
        original,
        keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toEqual({
      status: "invalid",
      reason: "signature-invalid",
    });
  });

  it("rejects a forged signature made with another Ed25519 key", () => {
    const trusted = generateKeyPairSync("ed25519");
    const attacker = generateKeyPairSync("ed25519");
    expect(
      verify(
        encodeLicence(defaultClaims(), attacker.privateKey),
        trusted.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toEqual({ status: "invalid", reason: "signature-invalid" });
  });

  it("rejects algorithms outside the versioned Ed25519 envelope", () => {
    const keys = generateKeyPairSync("ed25519");
    const envelope = JSON.parse(
      encodeLicence(defaultClaims(), keys.privateKey),
    ) as Record<string, string>;
    envelope.algorithm = "HMAC-SHA256";
    expect(
      verify(
        envelope,
        keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toEqual({ status: "invalid", reason: "unsupported-algorithm" });
  });

  it.each([
    ["pharmacy", { pharmacyId: "019b0000-0000-7000-8000-000000000999" }],
    ["device", { mainDeviceId: "019b0000-0000-7000-8000-000000000999" }],
  ])("rejects a licence bound to another %s", (_label, change) => {
    const keys = generateKeyPairSync("ed25519");
    const encodedLicence = encodeLicence(
      { ...defaultClaims(), ...change },
      keys.privateKey,
    );
    expect(
      verify(
        encodedLicence,
        keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toEqual({
      status: "invalid",
      reason: "binding-mismatch",
    });
  });

  it("rejects an unknown key before interpreting claims", () => {
    const keys = generateKeyPairSync("ed25519");
    expect(
      verifyOfflineLicence({
        encodedLicence: encodeLicence(defaultClaims(), keys.privateKey),
        expectedPharmacyId: PHARMACY_ID,
        expectedMainDeviceId: MAIN_DEVICE_ID,
        now: new Date("2027-01-01T00:00:00.000Z"),
        publicKeys: {},
      }),
    ).toEqual({ status: "invalid", reason: "unknown-key" });
  });

  it("rejects unknown format versions", () => {
    const keys = generateKeyPairSync("ed25519");
    const encodedLicence = encodeLicence(
      { ...defaultClaims(), formatVersion: 2 } as never,
      keys.privateKey,
    );
    expect(
      verify(
        encodedLicence,
        keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toEqual({
      status: "invalid",
      reason: "unsupported-format",
    });
  });

  it.each([
    ["an invalid plan", { plan: "Professional" }],
    ["an unknown feature", { features: ["future-feature"] }],
    [
      "duplicate founder grants",
      {
        founderOverrideGrants: ["purchase-invoice-ocr", "purchase-invoice-ocr"],
      },
    ],
    ["a zero device allowance", { permittedDeviceCount: 0 }],
    [
      "a device allowance above the transport-safety bound",
      { permittedDeviceCount: 1_000_001 },
    ],
    ["an expiry before issue", { expiresAt: "2025-12-31T23:59:59.999Z" }],
    ["grace before expiry", { graceEndsAt: "2027-12-31T23:59:59.999Z" }],
    ["a non-canonical issue instant", { issuedAt: "2026-01-01T00:00:00Z" }],
  ] as const)("rejects signed claims with %s", (_label, change) => {
    const keys = generateKeyPairSync("ed25519");
    expect(
      verify(
        encodeLicence(
          { ...defaultClaims(), ...change } as OfflineLicenceClaims,
          keys.privateKey,
        ),
        keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toEqual({ status: "invalid", reason: "malformed" });
  });

  it("binds the signed key identifier to the verification envelope", () => {
    const keys = generateKeyPairSync("ed25519");
    const envelope = JSON.parse(
      encodeLicence(defaultClaims(), keys.privateKey),
    ) as Record<string, string>;
    envelope.keyId = "rotated";
    expect(
      verifyOfflineLicence({
        encodedLicence: JSON.stringify(envelope),
        expectedPharmacyId: PHARMACY_ID,
        expectedMainDeviceId: MAIN_DEVICE_ID,
        now: new Date("2027-01-01T00:00:00.000Z"),
        publicKeys: {
          rotated: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
      }),
    ).toEqual({ status: "invalid", reason: "malformed" });
  });

  it("rejects a licence before its signed issue instant", () => {
    const keys = generateKeyPairSync("ed25519");
    expect(
      verifyOfflineLicence({
        encodedLicence: encodeLicence(defaultClaims(), keys.privateKey),
        expectedPharmacyId: PHARMACY_ID,
        expectedMainDeviceId: MAIN_DEVICE_ID,
        now: new Date("2025-12-31T23:59:59.999Z"),
        publicKeys: {
          test: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
      }),
    ).toEqual({ status: "invalid", reason: "not-yet-valid" });
  });

  it("accepts a device allowance far above the retired 10,000 commercial ceiling", () => {
    const keys = generateKeyPairSync("ed25519");
    const claims = { ...defaultClaims(), permittedDeviceCount: 50_000 };
    const encodedLicence = encodeLicence(claims, keys.privateKey);

    expect(
      verifyOfflineLicence({
        encodedLicence,
        expectedPharmacyId: PHARMACY_ID,
        expectedMainDeviceId: MAIN_DEVICE_ID,
        now: new Date("2027-01-01T00:00:00.000Z"),
        publicKeys: {
          test: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
      }),
    ).toEqual({ status: "valid", claims });
  });

  it("treats the exact expiry instant as expired and does not apply grace", () => {
    const keys = generateKeyPairSync("ed25519");
    const encodedLicence = encodeLicence(defaultClaims(), keys.privateKey);
    expect(
      verifyOfflineLicence({
        encodedLicence,
        expectedPharmacyId: PHARMACY_ID,
        expectedMainDeviceId: MAIN_DEVICE_ID,
        now: new Date(defaultClaims().expiresAt),
        publicKeys: {
          test: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        },
      }),
    ).toEqual({ status: "invalid", reason: "expired" });
  });
});

function defaultClaims(): OfflineLicenceClaims {
  return {
    formatVersion: 1,
    keyId: "test",
    licenceId: LICENCE_ID,
    pharmacyId: PHARMACY_ID,
    mainDeviceId: MAIN_DEVICE_ID,
    plan: "professional",
    features: ["one-way-cloud-sync"],
    founderOverrideGrants: [],
    permittedDeviceCount: 3,
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2028-01-01T00:00:00.000Z",
    graceEndsAt: "2028-01-08T00:00:00.000Z",
  };
}

function encodeLicence(
  claims: OfflineLicenceClaims,
  privateKey: Parameters<typeof sign>[2],
): string {
  const payload = Buffer.from(JSON.stringify(claims));
  return JSON.stringify({
    algorithm: "Ed25519",
    keyId: claims.keyId,
    payload: payload.toString("base64url"),
    signature: sign(null, payload, privateKey).toString("base64url"),
  });
}

function verify(
  encodedLicence: string | Record<string, string>,
  publicKey: string,
) {
  return verifyOfflineLicence({
    encodedLicence:
      typeof encodedLicence === "string"
        ? encodedLicence
        : JSON.stringify(encodedLicence),
    expectedPharmacyId: PHARMACY_ID,
    expectedMainDeviceId: MAIN_DEVICE_ID,
    now: new Date("2027-01-01T00:00:00.000Z"),
    publicKeys: { test: publicKey },
  });
}
