import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { RecoveryEncryptionMetadata } from "./recovery-schema.js";

const AES_256_GCM_ALGORITHM = "aes-256-gcm";
const GCM_IV_LENGTH_BYTES = 12;
const GCM_AUTH_TAG_LENGTH_BYTES = 16;
const RECOVERY_KEY_LENGTH_BYTES = 32; // 256 bits
const WINDOWS_KEY_STORE_TIMEOUT_MS = 10_000;
const KEY_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

export const DEFAULT_RECOVERY_KEY_IDENTIFIER = "breev-recovery-kek";

/**
 * Where the key encryption key came from. Recorded with every recovery point so
 * a restore can prove the assurance level of the key that protected it.
 */
export type RecoveryKeyProtectionLevel =
  RecoveryEncryptionMetadata["keyProtectionLevel"];

export interface RecoveryKeyMaterial {
  readonly kek: Buffer;
  readonly protectionLevel: RecoveryKeyProtectionLevel;
}

/**
 * Resolves the machine key encryption key for an identifier. The production
 * implementation is {@link readMachineRecoveryKey}; tests construct the
 * coordinator with their own provider so no software key path can be reached
 * from configuration or environment.
 */
export type RecoveryKeyProvider = (
  keyIdentifier: string,
) => RecoveryKeyMaterial;

export interface EncryptedPayload {
  readonly ciphertext: Buffer;
  readonly metadata: RecoveryEncryptionMetadata;
}

export interface DecryptOptions {
  readonly ciphertext: Buffer;
  readonly key: RecoveryKeyMaterial;
  readonly metadata: RecoveryEncryptionMetadata;
}

export function assertValidRecoveryKeyIdentifier(keyIdentifier: string): void {
  if (!KEY_IDENTIFIER_PATTERN.test(keyIdentifier)) {
    throw new Error(
      `RECOVERY_KEY_UNAVAILABLE: Key identifier "${keyIdentifier}" is not a supported recovery key name`,
    );
  }
}

/**
 * Reads the machine-scoped recovery key encryption key from Windows DPAPI.
 *
 * The key is protected with `DataProtectionScope::LocalMachine` and per-key
 * additional entropy, stored under ProgramData with an ACL restricted to the
 * Breev service identity, and never leaves the machine. There is no software
 * fallback: a machine that cannot produce this key must refuse to write or read
 * a recovery point rather than protect it with a weaker key.
 */
export function readMachineRecoveryKey(
  keyIdentifier: string,
): RecoveryKeyMaterial {
  assertValidRecoveryKeyIdentifier(keyIdentifier);
  if (process.platform !== "win32") {
    throw new Error(
      "RECOVERY_KEY_UNAVAILABLE: Machine recovery key custody requires Windows DPAPI",
    );
  }

  let output: string;
  try {
    output = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", MACHINE_KEY_SCRIPT],
      {
        encoding: "utf8",
        env: { ...process.env, BREEV_RECOVERY_KEY_ID: keyIdentifier },
        timeout: WINDOWS_KEY_STORE_TIMEOUT_MS,
      },
    ).trim();
  } catch (error) {
    throw new Error(
      `RECOVERY_KEY_UNAVAILABLE: Windows machine key storage did not release "${keyIdentifier}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const kek = Buffer.from(output, "base64");
  if (kek.length !== RECOVERY_KEY_LENGTH_BYTES) {
    throw new Error(
      `RECOVERY_KEY_UNAVAILABLE: Windows machine key storage returned an unusable key for "${keyIdentifier}"`,
    );
  }

  return { kek, protectionLevel: "machine-dpapi" };
}

/**
 * Encrypts a recovery payload with AES-256-GCM envelope encryption:
 * a fresh single-use 256-bit data encryption key protects the payload and the
 * machine key encryption key wraps that data encryption key. The wrap is bound
 * to the key identifier as additional authenticated data, so a wrapped key
 * cannot be replayed under a different identifier.
 */
export function encryptRecoveryPayload(
  plaintext: Buffer,
  keyIdentifier: string,
  key: RecoveryKeyMaterial,
): EncryptedPayload {
  assertValidRecoveryKeyIdentifier(keyIdentifier);
  assertUsableKek(key.kek);

  const dek = randomBytes(RECOVERY_KEY_LENGTH_BYTES);
  const iv = randomBytes(GCM_IV_LENGTH_BYTES);
  const cipher = createCipheriv(AES_256_GCM_ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const wrapIv = randomBytes(GCM_IV_LENGTH_BYTES);
  const wrapCipher = createCipheriv(AES_256_GCM_ALGORITHM, key.kek, wrapIv);
  wrapCipher.setAAD(keyWrapAad(keyIdentifier));
  const wrappedDek = Buffer.concat([
    wrapCipher.update(dek),
    wrapCipher.final(),
  ]);
  const wrappedKeyBlob = Buffer.concat([
    wrapIv,
    wrapCipher.getAuthTag(),
    wrappedDek,
  ]);
  dek.fill(0);

  return {
    ciphertext,
    metadata: {
      algorithm: "aes-256-gcm",
      authTagHex: authTag.toString("hex"),
      ivHex: iv.toString("hex"),
      keyIdentifier,
      keyProtectionLevel: key.protectionLevel,
      wrappedKeyHex: wrappedKeyBlob.toString("hex"),
    },
  };
}

/**
 * Decrypts a recovery payload. Every failure is explicit and closed: an
 * unusable key raises `RECOVERY_KEY_UNAVAILABLE` and any authentication failure
 * raises `RECOVERY_AUTHENTICATION_FAILED`.
 */
export function decryptRecoveryPayload(options: DecryptOptions): Buffer {
  const { ciphertext, key, metadata } = options;

  if (metadata.algorithm !== "aes-256-gcm") {
    throw new Error(
      `RECOVERY_AUTHENTICATION_FAILED: Unsupported recovery encryption algorithm "${metadata.algorithm}"`,
    );
  }
  assertValidRecoveryKeyIdentifier(metadata.keyIdentifier);
  assertUsableKek(key.kek);

  const wrappedKeyBlob = Buffer.from(metadata.wrappedKeyHex, "hex");
  if (
    wrappedKeyBlob.length !==
    GCM_IV_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES + RECOVERY_KEY_LENGTH_BYTES
  ) {
    throw new Error(
      "RECOVERY_AUTHENTICATION_FAILED: Wrapped recovery key envelope has an invalid length",
    );
  }

  const wrapIv = wrappedKeyBlob.subarray(0, GCM_IV_LENGTH_BYTES);
  const wrapAuthTag = wrappedKeyBlob.subarray(
    GCM_IV_LENGTH_BYTES,
    GCM_IV_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES,
  );
  const wrappedDek = wrappedKeyBlob.subarray(
    GCM_IV_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES,
  );

  let dek: Buffer;
  try {
    const unwrap = createDecipheriv(AES_256_GCM_ALGORITHM, key.kek, wrapIv);
    unwrap.setAAD(keyWrapAad(metadata.keyIdentifier));
    unwrap.setAuthTag(wrapAuthTag);
    dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);
  } catch {
    throw new Error(
      "RECOVERY_AUTHENTICATION_FAILED: The data encryption key failed authentication (wrong machine key or tampered envelope)",
    );
  }

  try {
    const decipher = createDecipheriv(
      AES_256_GCM_ALGORITHM,
      dek,
      Buffer.from(metadata.ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(metadata.authTagHex, "hex"));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(
      "RECOVERY_AUTHENTICATION_FAILED: Payload authentication failed (corrupted or tampered recovery point)",
    );
  } finally {
    dek.fill(0);
  }
}

function assertUsableKek(kek: Buffer): void {
  if (kek.length !== RECOVERY_KEY_LENGTH_BYTES) {
    throw new Error(
      "RECOVERY_KEY_UNAVAILABLE: The recovery key encryption key is not a 256-bit key",
    );
  }
}

function keyWrapAad(keyIdentifier: string): Buffer {
  return Buffer.from(`breev-recovery-kek:${keyIdentifier}`, "utf8");
}

const MACHINE_KEY_SCRIPT = `
  $ErrorActionPreference = 'Stop'
  Add-Type -AssemblyName System.Security
  $keyId = $env:BREEV_RECOVERY_KEY_ID
  if ($keyId -notmatch '^[a-z0-9][a-z0-9-]{0,62}$') { throw 'Unsupported recovery key name' }
  $commonData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::CommonApplicationData)
  $target = Join-Path $commonData 'Breev\\Recovery'
  if (-not (Test-Path -LiteralPath $target)) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
  }
  $entropy = [System.Text.Encoding]::UTF8.GetBytes('breev-recovery-kek:' + $keyId)
  $keyFile = Join-Path $target ($keyId + '.dat')
  if (-not (Test-Path -LiteralPath $keyFile)) {
    New-Item -ItemType File -Path $keyFile -Force | Out-Null
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $keyFile
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRule($rule) | Out-Null }
    $acl.SetOwner($sid)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
    # SYSTEM and Administrators keep access so the installer's protected ACL
    # reset can still process this file during repair. They already control
    # every other secret under ProgramData; the grant keeps non-admin local
    # users away from the sealed key, which is the real boundary here.
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), 'FullControl', 'Allow')))
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'), 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $keyFile -AclObject $acl
    $rawKey = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rawKey)
    $sealed = [System.Security.Cryptography.ProtectedData]::Protect($rawKey, $entropy, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    [System.IO.File]::WriteAllBytes($keyFile, $sealed)
  }
  $stored = [System.IO.File]::ReadAllBytes($keyFile)
  $unsealed = [System.Security.Cryptography.ProtectedData]::Unprotect($stored, $entropy, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  [System.Convert]::ToBase64String($unsealed)
`;
