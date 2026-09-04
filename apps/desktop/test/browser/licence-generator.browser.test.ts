import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

const GENERATOR_PATH = path.resolve(
  import.meta.dirname,
  "../../../../tooling/licensing/generator.html",
);
const VERIFIER_URL = pathToFileURL(
  path.resolve(
    import.meta.dirname,
    "../../../local-api/src/licensing/offline-licence.ts",
  ),
).href;
const KEY_ID = "breev-dev-ed25519-2026-02";
const PHARMACY_ID = "019b0000-0000-7000-8000-000000000101";
const MAIN_DEVICE_ID = "019b0000-0000-7000-8000-000000000102";

const matchingKeys = generateKeyPairSync("ed25519");
const wrongKeys = generateKeyPairSync("ed25519");
const matchingPublicKey = matchingKeys.publicKey
  .export({ format: "pem", type: "spki" })
  .toString();
const matchingPublicSpki = matchingKeys.publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64");
const matchingPrivateKey = Buffer.from(
  matchingKeys.privateKey.export({ format: "pem", type: "pkcs8" }),
);
const wrongPrivateKey = Buffer.from(
  wrongKeys.privateKey.export({ format: "pem", type: "pkcs8" }),
);

let server: Server;
let generatorUrl: string;

test.beforeAll(async () => {
  const source = readFileSync(GENERATOR_PATH, "utf8").replace(
    /(<meta\s+name="breev-dev-licence-public-key-spki"\s+content=")[^"]+("\s*\/?>)/u,
    `$1${matchingPublicSpki}$2`,
  );
  server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    });
    response.end(source);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  generatorUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("guards the signing key and emits a licence accepted by Breev", async ({
  page,
}) => {
  await page.goto(generatorUrl);
  const mintButton = page.getByRole("button", {
    name: /Mint licence/u,
  });
  const output = page.locator("#licenseOutput");

  await expect(mintButton).toBeDisabled();
  await page.locator("#privateKeyFile").setInputFiles({
    buffer: wrongPrivateKey,
    mimeType: "application/x-pem-file",
    name: "wrong.pem",
  });
  await expect(page.locator("#keyStatus")).toContainText(
    "Selected key does not match",
  );
  await expect(page.locator("#keyStatus")).toContainText("المفتاح المختار");
  await expect(mintButton).toBeDisabled();
  await expect(output).toHaveValue("");

  await page.locator("#privateKeyFile").setInputFiles({
    buffer: matchingPrivateKey,
    mimeType: "application/x-pem-file",
    name: "matching.pem",
  });
  await expect(page.locator("#keyStatus")).toContainText("Key matches");
  await expect(mintButton).toBeEnabled();

  await page.locator("#pharmacyId").fill("not-a-uuid");
  await page.locator("#mainDeviceId").fill(MAIN_DEVICE_ID);
  await mintButton.click();
  await expect(page.locator("#formError")).toContainText(
    "Pharmacy ID must be a valid UUIDv7",
  );
  await expect(page.locator("#formError")).toContainText("معرّف الصيدلية");
  await expect(output).toHaveValue("");

  await page.locator("#pharmacyId").fill(PHARMACY_ID);
  await page.locator("#permittedDeviceCount").fill("0");
  await mintButton.click();
  await expect(page.locator("#formError")).toContainText(
    "Device count must be an integer",
  );
  await expect(page.locator("#formError")).toContainText("عدد الأجهزة");
  await expect(output).toHaveValue("");

  await page.locator("#permittedDeviceCount").fill("10");
  await page.locator("#issuedDate").fill("2099-01-01");
  await page.locator("#expiresDate").fill("2026-01-01");
  await mintButton.click();
  await expect(page.locator("#formError")).toContainText(
    "Expiry date must be after issue date",
  );
  await expect(page.locator("#formError")).toContainText("تاريخ الانتهاء");
  await expect(output).toHaveValue("");

  await page.locator("#issuedDate").fill("2026-01-01");
  await page.locator("#expiresDate").fill("2099-01-01");
  await mintButton.click();
  await expect(output).not.toHaveValue("");
  const encodedLicence = await output.inputValue();

  const verification = verifyWithRealVerifier({
    encodedLicence,
    expectedMainDeviceId: MAIN_DEVICE_ID,
    expectedPharmacyId: PHARMACY_ID,
    now: new Date(),
    publicKeys: { [KEY_ID]: matchingPublicKey },
  });
  expect(verification.status).toBe("valid");

  const tamperedEnvelope = JSON.parse(encodedLicence) as Record<string, string>;
  const encodedPayload = tamperedEnvelope.payload;
  if (encodedPayload === undefined) throw new Error("Licence has no payload");
  const claims = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  claims.plan = "starter";
  tamperedEnvelope.payload = Buffer.from(JSON.stringify(claims)).toString(
    "base64url",
  );
  expect(
    verifyWithRealVerifier({
      encodedLicence: JSON.stringify(tamperedEnvelope),
      expectedMainDeviceId: MAIN_DEVICE_ID,
      expectedPharmacyId: PHARMACY_ID,
      now: new Date(),
      publicKeys: { [KEY_ID]: matchingPublicKey },
    }),
  ).toEqual({ status: "invalid", reason: "signature-invalid" });

  expect(
    verifyWithRealVerifier({
      encodedLicence,
      expectedMainDeviceId: "019b0000-0000-7000-8000-000000000999",
      expectedPharmacyId: PHARMACY_ID,
      now: new Date(),
      publicKeys: { [KEY_ID]: matchingPublicKey },
    }),
  ).toEqual({ status: "invalid", reason: "binding-mismatch" });
});

function verifyWithRealVerifier(input: {
  readonly encodedLicence: string;
  readonly expectedMainDeviceId: string;
  readonly expectedPharmacyId: string;
  readonly now: Date;
  readonly publicKeys: Readonly<Record<string, string>>;
}): { readonly status: string; readonly reason?: string } {
  const verifierProgram = `
    import { readFileSync } from "node:fs";
    import { verifyOfflineLicence } from ${JSON.stringify(VERIFIER_URL)};
    const input = JSON.parse(readFileSync(0, "utf8"));
    input.now = new Date(input.now);
    process.stdout.write(JSON.stringify(verifyOfflineLicence(input)));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", verifierProgram],
    {
      encoding: "utf8",
      input: JSON.stringify(input),
    },
  );
  if (result.status !== 0) {
    throw new Error(`Real verifier process failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as {
    readonly status: string;
    readonly reason?: string;
  };
}
