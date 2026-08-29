import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { fingerprintOfCertificate } from "./pairing-trust.js";
import { isCaFingerprint, isUuidV7 } from "./pairing-transcript.js";
import { isPairingHost } from "./pairing-invitation.js";

export const TERMINAL_BINDING_FILE = "terminal-device.json" as const;
export const TERMINAL_KEY_FILE = "terminal-device.key" as const;

/**
 * Encryption at rest through the operating system key store is the only
 * protection this terminal accepts for its private key. There is deliberately
 * no unprotected member: a binding file written by an older build that recorded
 * one is rejected on read rather than trusted.
 *
 * The key is still generated in this process and is therefore extractable by
 * this process. A fully non-exportable key held by a platform key handle
 * (Windows CNG/TPM), with certificate-request and TLS signing performed through
 * that handle, is the deferred hardening path recorded as open item G-05.
 */
export const TERMINAL_KEY_PROTECTIONS = ["safe-storage"] as const;

export type TerminalKeyProtection = (typeof TERMINAL_KEY_PROTECTIONS)[number];

/**
 * Raised instead of writing or reading an unprotected key. It is its own type
 * so the pairing ceremony can tell the operator that this machine cannot hold a
 * terminal key at all, which no retry will change.
 */
export class TerminalKeyProtectionUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalKeyProtectionUnavailable";
  }
}

export interface TerminalDeviceBinding {
  readonly caCertificatePem: string;
  readonly caFingerprint: string;
  readonly certificatePem: string;
  readonly deviceId: string;
  readonly endpointHost: string;
  readonly endpointPort: number;
  readonly installationId: string;
  readonly keyProtection: TerminalKeyProtection;
}

/**
 * Electron's safeStorage, narrowed to what this module needs so the pure
 * persistence rules stay testable without an Electron process.
 */
export interface TerminalKeyProtector {
  readonly decryptString: (value: Buffer) => string;
  readonly encryptString: (value: string) => Buffer;
  readonly isEncryptionAvailable: () => boolean;
}

/**
 * A missing binding means this terminal has never paired, which the renderer
 * shows as the pairing screen. A present but damaged binding is an
 * installation defect and fails loudly, exactly like the Main device binding.
 */
export function readTerminalDeviceBinding(
  directory: string,
): TerminalDeviceBinding | undefined {
  const file = path.join(directory, TERMINAL_BINDING_FILE);
  if (!existsSync(file)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(
      `The terminal device binding file is unreadable: ${file}. ` +
        "Repair the Breev installation or pair this terminal again.",
    );
  }
  const binding = asBinding(parsed);
  if (binding === undefined) {
    throw new Error("The terminal device binding configuration is invalid");
  }
  // The stored authority is this terminal's only trust anchor. Recomputing its
  // fingerprint on every boot turns a tampered trust store into a loud failure
  // instead of a silent downgrade.
  if (
    fingerprintOfCertificate(binding.caCertificatePem) !== binding.caFingerprint
  ) {
    throw new Error(
      "The stored terminal certificate authority does not match its recorded fingerprint",
    );
  }
  return binding;
}

/**
 * The stored key is always key-store ciphertext, so the binding's recorded
 * protection is a validated fact rather than a branch: reading is refused
 * outright when the key store is gone.
 */
export function readTerminalPrivateKey(
  directory: string,
  protector: TerminalKeyProtector,
): string {
  if (!protector.isEncryptionAvailable()) {
    throw new TerminalKeyProtectionUnavailable(
      "The terminal private key is protected by this machine's key store, which is unavailable",
    );
  }
  return protector.decryptString(
    readFileSync(path.join(directory, TERMINAL_KEY_FILE)),
  );
}

export interface TerminalBindingWrite {
  readonly binding: Omit<TerminalDeviceBinding, "keyProtection">;
  readonly directory: string;
  readonly privateKeyPem: string;
  readonly protector: TerminalKeyProtector;
}

/**
 * The key lands first and the binding file commits the pairing, so an
 * interrupted write leaves the terminal unpaired rather than half-paired. The
 * private key never leaves this directory and is never written unprotected: a
 * machine whose key store is unavailable fails the pairing instead, because an
 * unencrypted key file is copyable by every process running as this user.
 */
export function writeTerminalDeviceBinding(
  write: TerminalBindingWrite,
): TerminalDeviceBinding {
  if (!write.protector.isEncryptionAvailable()) {
    throw new TerminalKeyProtectionUnavailable(
      "This machine's key store is unavailable, so the terminal private key cannot be protected at rest",
    );
  }

  mkdirSync(write.directory, { mode: 0o700, recursive: true });
  chmodSync(write.directory, 0o700);

  writeFileAtomically(
    path.join(write.directory, TERMINAL_KEY_FILE),
    write.protector.encryptString(write.privateKeyPem),
  );

  const binding: TerminalDeviceBinding = {
    ...write.binding,
    keyProtection: "safe-storage",
  };
  if (asBinding(binding) === undefined) {
    throw new Error("The terminal device binding configuration is invalid");
  }
  writeFileAtomically(
    path.join(write.directory, TERMINAL_BINDING_FILE),
    Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, "utf8"),
  );
  return binding;
}

function writeFileAtomically(file: string, contents: Buffer): void {
  const temporary = `${file}.partial`;
  try {
    writeFileSync(temporary, contents, { flush: true, mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function asBinding(value: unknown): TerminalDeviceBinding | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const caCertificatePem = asString(record.caCertificatePem);
  const caFingerprint = asString(record.caFingerprint);
  const certificatePem = asString(record.certificatePem);
  const deviceId = asString(record.deviceId);
  const endpointHost = asString(record.endpointHost);
  const endpointPort = record.endpointPort;
  const installationId = asString(record.installationId);
  const keyProtection = asString(record.keyProtection);

  if (
    caCertificatePem === undefined ||
    !caCertificatePem.includes("-----BEGIN CERTIFICATE-----") ||
    certificatePem === undefined ||
    !certificatePem.includes("-----BEGIN CERTIFICATE-----") ||
    caFingerprint === undefined ||
    !isCaFingerprint(caFingerprint) ||
    deviceId === undefined ||
    !isUuidV7(deviceId) ||
    installationId === undefined ||
    !isUuidV7(installationId) ||
    endpointHost === undefined ||
    !isPairingHost(endpointHost) ||
    typeof endpointPort !== "number" ||
    !Number.isInteger(endpointPort) ||
    endpointPort < 1 ||
    endpointPort > 65_535 ||
    keyProtection === undefined ||
    !isKeyProtection(keyProtection)
  ) {
    return undefined;
  }

  return {
    caCertificatePem,
    caFingerprint,
    certificatePem,
    deviceId,
    endpointHost,
    endpointPort,
    installationId,
    keyProtection,
  };
}

function isKeyProtection(value: string): value is TerminalKeyProtection {
  return (TERMINAL_KEY_PROTECTIONS as readonly string[]).includes(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
