import { terminalPairingStateResponseSchema } from "@breev/contracts/desktop-preload";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createFixtureAuthority,
  createFixtureDeviceCertificate,
} from "./pairing-certificates.fixture.js";
import {
  TerminalKeyProtectionUnavailable,
  writeTerminalDeviceBinding,
  type TerminalKeyProtector,
} from "./terminal-binding.js";
import type { TerminalDiscovery } from "./terminal-discovery.js";
import {
  startTerminalRuntime,
  type TerminalRuntime,
} from "./terminal-runtime.js";

const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const deviceId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0e";
const candidate = {
  host: "192.168.1.5",
  installationId,
  name: "breev-0192f0a0",
  port: 31_311,
};

/** A well-formed invitation, so a refusal can only come from this machine. */
const invitationUri = `breev-pair://1/${Buffer.from(
  JSON.stringify({
    f: "11".repeat(32),
    h: "192.168.1.5",
    i: installationId,
    k: Buffer.alloc(32, 7).toString("base64url"),
    p: 31_311,
    s: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
    v: 1,
  }),
  "utf8",
).toString("base64url")}`;

/** A safeStorage stand-in; the runtime only cares that protection exists. */
const protector = {
  decryptString: (value: Buffer) => value.toString("utf8"),
  encryptString: (value: string) => Buffer.from(value, "utf8"),
  isEncryptionAvailable: () => true,
};

const unprotectedMachine = { ...protector, isEncryptionAvailable: () => false };

const discovery: TerminalDiscovery = {
  candidates: () => [candidate],
  stop: () => undefined,
};

const started: TerminalRuntime[] = [];
const directories: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "breev-runtime-"));
  directories.push(directory);
  return directory;
}

async function runtime(
  stateDirectory: string,
  keyProtector: TerminalKeyProtector = protector,
): Promise<TerminalRuntime> {
  const instance = await startTerminalRuntime({
    allowedOrigin: "breev://app",
    deviceName: "Counter 2",
    protector: keyProtector,
    startDiscovery: () => discovery,
    stateDirectory,
  });
  started.push(instance);
  return instance;
}

function writeFixtureBinding(directory: string): void {
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
  writeTerminalDeviceBinding({
    binding: {
      caCertificatePem: authority.pem,
      caFingerprint: authority.fingerprint,
      certificatePem: device.pem,
      deviceId,
      endpointHost: "192.168.1.5",
      endpointPort: 31_311,
      installationId,
    },
    directory,
    privateKeyPem: keys.privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
    protector,
  });
}

afterEach(async () => {
  await Promise.all(started.splice(0).map(async (item) => item.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("terminal runtime", () => {
  it("opens a loopback bridge and waits for an invitation when unpaired", async () => {
    const instance = await runtime(scratchDirectory());

    expect(instance.bridgeOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(instance.deviceId).toBeUndefined();
    expect(instance.installationId).toBeUndefined();
    expect(terminalPairingStateResponseSchema.parse(instance.state())).toEqual({
      candidates: [candidate],
      stage: "awaiting-invitation",
    });
  });

  it("never creates a datastore of its own", async () => {
    const directory = scratchDirectory();
    await runtime(directory);

    expect(readdirSync(directory)).toEqual([]);
  });

  it("reports a malformed invitation as its own retryable state", async () => {
    const instance = await runtime(scratchDirectory());
    const state = instance.submitInvitation("breev-pair://1/not-an-invitation");

    expect(terminalPairingStateResponseSchema.parse(state)).toEqual({
      candidates: [candidate],
      endpoint: null,
      reason: "invitation-invalid",
      stage: "failed",
    });
  });

  it("refuses a manual endpoint without an invitation to anchor it", async () => {
    const instance = await runtime(scratchDirectory());
    const state = instance.submitManualEndpoint({
      host: "192.168.1.9",
      invitation: "not-an-invitation",
      port: 31_311,
    });

    expect(terminalPairingStateResponseSchema.parse(state)).toMatchObject({
      reason: "invitation-invalid",
      stage: "failed",
    });
  });

  it("returns to a named cancelled state on request", async () => {
    const instance = await runtime(scratchDirectory());
    expect(
      terminalPairingStateResponseSchema.parse(instance.cancelPairing()),
    ).toEqual({
      candidates: [candidate],
      endpoint: null,
      reason: "cancelled",
      stage: "failed",
    });
  });

  it("refuses to start a ceremony it could never store the key for", async () => {
    const instance = await runtime(scratchDirectory(), unprotectedMachine);
    const state = instance.submitInvitation(invitationUri);

    expect(terminalPairingStateResponseSchema.parse(state)).toEqual({
      candidates: [candidate],
      endpoint: null,
      reason: "key-protection-unavailable",
      stage: "failed",
    });
  });

  it("refuses to boot a paired terminal whose key store has gone", async () => {
    const directory = scratchDirectory();
    writeFixtureBinding(directory);

    await expect(runtime(directory, unprotectedMachine)).rejects.toThrow(
      TerminalKeyProtectionUnavailable,
    );
  });

  it("starts paired and stops listening to the network once bound", async () => {
    const directory = scratchDirectory();
    writeFixtureBinding(directory);

    const instance = await runtime(directory);
    const state = terminalPairingStateResponseSchema.parse(instance.state());

    expect(state).toEqual({
      candidates: [],
      deviceId,
      endpoint: { host: "192.168.1.5", port: 31_311 },
      installationId,
      stage: "paired",
    });
    expect(instance.deviceId).toBe(deviceId);
    expect(instance.installationId).toBe(installationId);
    expect(instance.submitInvitation("breev-pair://1/x")).toEqual(state);
    expect(instance.cancelPairing()).toEqual(state);
  });
});
