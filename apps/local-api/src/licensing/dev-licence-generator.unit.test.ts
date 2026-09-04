import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PAID_CAPABILITY_NAMES } from "@breev/contracts/local-rest";
import { describe, expect, it } from "vitest";

import { OFFLINE_LICENCE_PUBLIC_KEYS } from "./licence-keys.js";

const GENERATOR_PATH = path.resolve(
  import.meta.dirname,
  "../../../../tooling/licensing/generator.html",
);
const EXPECTED_DEV_KEY_ID = "breev-dev-ed25519-2026-02";

describe("development licence generator configuration", () => {
  it("uses the one trusted development issuer without embedding its private key", () => {
    const html = readFileSync(GENERATOR_PATH, "utf8");
    const keyId = metaContent(html, "breev-dev-licence-key-id");
    const expectedPublicKey = Buffer.from(
      metaContent(html, "breev-dev-licence-public-key-spki"),
      "base64",
    );
    const registeredPublicKey = OFFLINE_LICENCE_PUBLIC_KEYS[keyId];

    expect(keyId).toBe(EXPECTED_DEV_KEY_ID);
    expect(
      OFFLINE_LICENCE_PUBLIC_KEYS["breev-dev-ed25519-2026-01"],
    ).toBeUndefined();
    expect(registeredPublicKey).toBeDefined();
    if (registeredPublicKey === undefined) {
      throw new Error(`Missing registered public key for ${keyId}`);
    }
    expect(
      createPublicKey(registeredPublicKey).export({
        format: "der",
        type: "spki",
      }),
    ).toEqual(expectedPublicKey);
    expect(html).not.toMatch(
      /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]+-----END (?:EC |RSA )?PRIVATE KEY-----/u,
    );
    expect(html).toMatch(/<input\b[^>]*\bid="keyId"[^>]*\breadonly[^>]*>/u);
    expect(html).toMatch(
      /<input\b[^>]*\bid="privateKeyFile"[^>]*\btype="file"[^>]*>/u,
    );
    expect(html).not.toContain('id="privateKeyPem"');

    const features = [
      ...html.matchAll(
        /<input\b[^>]*\bname="feature"[^>]*\bvalue="([^"]+)"[^>]*>/gu,
      ),
    ]
      .map((match) => match[1])
      .sort();
    expect(features).toEqual([...PAID_CAPABILITY_NAMES].sort());
  });
});

function metaContent(html: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = html.match(
    new RegExp(
      `<meta\\s+name="${escapedName}"\\s+content="([^"]+)"\\s*\\/?\\s*>`,
      "u",
    ),
  );
  if (match?.[1] === undefined) {
    throw new Error(`Missing ${name} metadata in ${GENERATOR_PATH}`);
  }
  return match[1];
}
