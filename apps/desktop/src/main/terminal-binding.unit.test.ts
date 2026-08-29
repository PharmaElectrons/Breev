import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  createFixtureAuthority,
  createFixtureDeviceCertificate,
} from "./pairing-certificates.fixture.js";
import {
  TERMINAL_BINDING_FILE,
  TERMINAL_KEY_FILE,
  TERMINAL_KEY_PROTECTIONS,
  TerminalKeyProtectionUnavailable,
  readTerminalDeviceBinding,
  readTerminalPrivateKey,
  writeTerminalDeviceBinding,
  type TerminalKeyProtector,
} from "./terminal-binding.js";

const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const deviceId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0e";
const authority = createFixtureAuthority({ installationId });
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const device = createFixtureDeviceCertificate({
  authority,
  deviceId,
  devicePublicKey: keys.publicKey,
  installationId,
  licenceId: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a10",
  pharmacyId: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0f",
});
const privateKeyPem = keys.privateKey.export({
  format: "pem",
  type: "pkcs8",
}) as string;

const binding = {
  caCertificatePem: authority.pem,
  caFingerprint: authority.fingerprint,
  certificatePem: device.pem,
  deviceId,
  endpointHost: "192.168.1.5",
  endpointPort: 31_311,
  installationId,
};

const directories: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "breev-terminal-"));
  directories.push(directory);
  return directory;
}

/** A safeStorage stand-in so the persistence rules run without Electron. */
function protector(available: boolean): TerminalKeyProtector {
  return {
    decryptString: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("v1:")) {
        throw new Error("not a protected key");
      }
      return Buffer.from(text.slice(3), "base64").toString("utf8");
    },
    encryptString: (value) =>
      Buffer.from(
        `v1:${Buffer.from(value, "utf8").toString("base64")}`,
        "utf8",
      ),
    isEncryptionAvailable: () => available,
  };
}

afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("terminal device binding", () => {
  it("reports an unpaired terminal instead of failing", () => {
    expect(readTerminalDeviceBinding(scratchDirectory())).toBeUndefined();
  });

  it("round-trips a binding and its key store protected key", () => {
    const directory = scratchDirectory();
    const stored = writeTerminalDeviceBinding({
      binding,
      directory,
      privateKeyPem,
      protector: protector(true),
    });

    expect(stored.keyProtection).toBe("safe-storage");
    expect(readTerminalDeviceBinding(directory)).toEqual(stored);
    expect(readTerminalPrivateKey(directory, protector(true))).toBe(
      privateKeyPem,
    );
    expect(
      readFileSync(path.join(directory, TERMINAL_KEY_FILE), "utf8"),
    ).not.toContain("BEGIN PRIVATE KEY");
  });

  it("offers no protection other than the machine key store", () => {
    expect([...TERMINAL_KEY_PROTECTIONS]).toEqual(["safe-storage"]);
  });

  it("refuses to pair at all when no key store can protect the key", () => {
    const directory = scratchDirectory();

    expect(() =>
      writeTerminalDeviceBinding({
        binding,
        directory,
        privateKeyPem,
        protector: protector(false),
      }),
    ).toThrow(TerminalKeyProtectionUnavailable);

    // Failing closed means nothing is left behind: no key, no binding, and so
    // no half-paired terminal to recover from.
    for (const file of [TERMINAL_BINDING_FILE, TERMINAL_KEY_FILE]) {
      expect(existsSync(path.join(directory, file))).toBe(false);
    }
    expect(readTerminalDeviceBinding(directory)).toBeUndefined();
  });

  it("never writes the private key in a form the file system can reveal", () => {
    const directory = scratchDirectory();
    writeTerminalDeviceBinding({
      binding,
      directory,
      privateKeyPem,
      protector: protector(true),
    });

    const stored = readFileSync(path.join(directory, TERMINAL_KEY_FILE));
    expect(stored.includes(Buffer.from(privateKeyPem, "utf8"))).toBe(false);
    expect(stored.toString("utf8")).not.toContain("PRIVATE KEY");
  });

  it("refuses to decrypt a protected key when the key store disappears", () => {
    const directory = scratchDirectory();
    writeTerminalDeviceBinding({
      binding,
      directory,
      privateKeyPem,
      protector: protector(true),
    });

    expect(() => readTerminalPrivateKey(directory, protector(false))).toThrow(
      TerminalKeyProtectionUnavailable,
    );
  });

  it("keeps the binding and the key readable only by their owner", () => {
    const directory = scratchDirectory();
    writeTerminalDeviceBinding({
      binding,
      directory,
      privateKeyPem,
      protector: protector(true),
    });

    for (const file of [TERMINAL_BINDING_FILE, TERMINAL_KEY_FILE]) {
      expect(statSync(path.join(directory, file)).mode & 0o077).toBe(0);
    }
    expect(statSync(directory).mode & 0o077).toBe(0);
  });

  it("fails loudly when the stored authority no longer matches its pin", () => {
    const directory = scratchDirectory();
    const stored = writeTerminalDeviceBinding({
      binding,
      directory,
      privateKeyPem,
      protector: protector(true),
    });
    const impostor = createFixtureAuthority({ installationId });
    writeFileSync(
      path.join(directory, TERMINAL_BINDING_FILE),
      JSON.stringify({ ...stored, caCertificatePem: impostor.pem }),
    );

    expect(() => readTerminalDeviceBinding(directory)).toThrow(/fingerprint/iu);
  });

  it.each([
    ["unreadable JSON", "{"],
    ["an array", "[]"],
    [
      "a missing certificate",
      JSON.stringify({ ...binding, certificatePem: undefined }),
    ],
    [
      "a version 4 device",
      JSON.stringify({
        ...binding,
        deviceId: "0192f0a0-1c2d-4e3f-8a4b-5c6d7e8f9a0e",
        keyProtection: "safe-storage",
      }),
    ],
    [
      "an unknown protection",
      JSON.stringify({ ...binding, keyProtection: "none" }),
    ],
    [
      "the withdrawn plaintext protection an older build could write",
      JSON.stringify({ ...binding, keyProtection: "plaintext" }),
    ],
    [
      "a port outside the range",
      JSON.stringify({
        ...binding,
        endpointPort: 0,
        keyProtection: "safe-storage",
      }),
    ],
    [
      "a host with a path",
      JSON.stringify({
        ...binding,
        endpointHost: "192.168.1.5/x",
        keyProtection: "safe-storage",
      }),
    ],
  ])("refuses a binding file carrying %s", (_label, contents) => {
    const directory = scratchDirectory();
    writeFileSync(path.join(directory, TERMINAL_BINDING_FILE), contents);
    expect(() => readTerminalDeviceBinding(directory)).toThrow();
  });

  it("leaves no partial file behind after a successful write", () => {
    const directory = scratchDirectory();
    writeTerminalDeviceBinding({
      binding,
      directory,
      privateKeyPem,
      protector: protector(true),
    });

    expect(() =>
      statSync(path.join(directory, `${TERMINAL_BINDING_FILE}.partial`)),
    ).toThrow();
  });
});
