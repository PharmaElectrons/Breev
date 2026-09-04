import {
  createPrivateKey,
  createPublicKey,
  createHash,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { OFFLINE_LICENCE_PUBLIC_KEYS } from "../../apps/local-api/src/licensing/licence-keys.ts";
import { verifyOfflineLicence } from "../../apps/local-api/src/licensing/offline-licence.ts";

const KEY_ID = "breev-dev-ed25519-2026-02";
const PHARMACY_ID = "019b0000-0000-7000-8000-000000000101";
const MAIN_DEVICE_ID = "019b0000-0000-7000-8000-000000000102";
const LICENCE_ID = "019b0000-0000-7000-8000-000000000103";

const argumentsAfterSeparator =
  process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2);

if (
  argumentsAfterSeparator.length !== 1 ||
  argumentsAfterSeparator[0]?.trim() === ""
) {
  process.stderr.write(
    "Usage: node tooling/licensing/check-signing-key.mjs <private-key.pem>\n",
  );
  process.exitCode = 2;
} else {
  await checkSigningKey(path.resolve(argumentsAfterSeparator[0]));
}

async function checkSigningKey(privateKeyPath) {
  try {
    const trustedPublicKey = OFFLINE_LICENCE_PUBLIC_KEYS[KEY_ID];
    if (trustedPublicKey === undefined) {
      throw new Error("The development verification key is not registered");
    }

    const privateKey = createPrivateKey(await readFile(privateKeyPath));
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("The selected private key is not Ed25519");
    }
    const selectedPublicDer = createPublicKey(privateKey).export({
      format: "der",
      type: "spki",
    });
    const trustedPublicDer = createPublicKey(trustedPublicKey).export({
      format: "der",
      type: "spki",
    });
    const fingerprint = createHash("sha256")
      .update(selectedPublicDer)
      .digest("hex");

    if (!selectedPublicDer.equals(trustedPublicDer)) {
      process.stdout.write(`status=invalid fingerprint=${fingerprint}\n`);
      process.exitCode = 1;
      return;
    }

    const claims = {
      formatVersion: 1,
      keyId: KEY_ID,
      licenceId: LICENCE_ID,
      pharmacyId: PHARMACY_ID,
      mainDeviceId: MAIN_DEVICE_ID,
      plan: "professional",
      features: ["one-way-cloud-sync"],
      founderOverrideGrants: ["purchase-invoice-ocr"],
      permittedDeviceCount: 3,
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      graceEndsAt: "2099-01-08T00:00:00.000Z",
    };
    const payload = Buffer.from(JSON.stringify(claims));
    const encodedLicence = JSON.stringify({
      algorithm: "Ed25519",
      keyId: KEY_ID,
      payload: payload.toString("base64url"),
      signature: sign(null, payload, privateKey).toString("base64url"),
    });
    const verification = verifyOfflineLicence({
      encodedLicence,
      expectedMainDeviceId: MAIN_DEVICE_ID,
      expectedPharmacyId: PHARMACY_ID,
      now: new Date(),
      publicKeys: OFFLINE_LICENCE_PUBLIC_KEYS,
    });
    if (verification.status !== "valid") {
      throw new Error(`The real verifier returned ${verification.status}`);
    }

    process.stdout.write(`status=valid fingerprint=${fingerprint}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(`status=error message=${message}\n`);
    process.exitCode = 1;
  }
}
