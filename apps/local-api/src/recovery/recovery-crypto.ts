import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

import type { RecoveryEncryptionMetadata } from "./recovery-schema.js";

const AES_256_GCM_ALGORITHM = "aes-256-gcm";
const GCM_IV_LENGTH_BYTES = 12;
const GCM_AUTH_TAG_LENGTH_BYTES = 16;
const DEK_LENGTH_BYTES = 32; // 256 bits

export interface EncryptedPayload {
  readonly ciphertext: Buffer;
  readonly metadata: RecoveryEncryptionMetadata;
}

export interface DecryptOptions {
  readonly ciphertext: Buffer;
  readonly metadata: RecoveryEncryptionMetadata;
  readonly customKekProvider?:
    ((keyIdentifier: string) => Buffer | null) | undefined;
}

// In-memory test KEK store for cross-platform / unit test environments
const softwareKekStore = new Map<string, Buffer>();

/**
 * Generates a fresh 256-bit Machine Key Encryption Key (KEK)
 * or obtains the machine-scoped key via Windows DPAPI / CNG.
 */
export function getOrCreateMachineKek(
  keyIdentifier = "default-breev-recovery-kek",
): {
  kek: Buffer;
  protectionLevel: "platform-tpm" | "software-cng" | "software-test";
} {
  if (
    process.platform === "win32" &&
    !process.env.BREEV_FORCE_SOFTWARE_KEY_STORAGE
  ) {
    try {
      const dpapiKek = getWindowsDpapiProtectedKek(keyIdentifier);
      return {
        kek: dpapiKek,
        protectionLevel: "software-cng",
      };
    } catch {
      // fallback to software store
    }
  }

  let stored = softwareKekStore.get(keyIdentifier);
  if (!stored) {
    stored = randomBytes(DEK_LENGTH_BYTES);
    softwareKekStore.set(keyIdentifier, stored);
  }

  return {
    kek: stored,
    protectionLevel: "software-test",
  };
}

/**
 * Windows DPAPI protection for machine recovery key.
 */
function getWindowsDpapiProtectedKek(keyIdentifier: string): Buffer {
  const psScript = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Security
    $breevDir = $null
    try {
      $commonData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::CommonApplicationData)
      $target = Join-Path $commonData "Breev\\Recovery"
      if (-not (Test-Path $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
      }
      $breevDir = $target
    } catch {
      $localData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
      $target = Join-Path $localData "Breev\\Recovery"
      if (-not (Test-Path $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
      }
      $breevDir = $target
    }

    $keyFile = Join-Path $breevDir "${keyIdentifier}.dat"
    if (Test-Path $keyFile) {
      $protected = [System.IO.File]::ReadAllBytes($keyFile)
      $unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.Convert]::ToBase64String($unprotected)
    } else {
      $rawKey = New-Object byte[] 32
      $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      $rng.GetBytes($rawKey)
      $protected = [System.Security.Cryptography.ProtectedData]::Protect($rawKey, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.IO.File]::WriteAllBytes($keyFile, $protected)
      [System.Convert]::ToBase64String($rawKey)
    }
  `;

  const output = execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", psScript],
    { encoding: "utf8", timeout: 10_000 },
  ).trim();

  if (!output) {
    throw new Error("Failed to retrieve DPAPI-protected recovery key");
  }

  return Buffer.from(output, "base64");
}

/**
 * Encrypts arbitrary buffer (e.g. tar/manifest/backup payload) using AES-256-GCM envelope encryption:
 * 1. Generates single-use random 256-bit DEK.
 * 2. Encrypts payload with DEK using AES-256-GCM.
 * 3. Wraps (encrypts) DEK with machine KEK.
 * 4. Returns ciphertext + metadata.
 */
export function encryptRecoveryPayload(
  plaintext: Buffer,
  keyIdentifier = "default-breev-recovery-kek",
): EncryptedPayload {
  const dek = randomBytes(DEK_LENGTH_BYTES);
  const iv = randomBytes(GCM_IV_LENGTH_BYTES);

  const cipher = createCipheriv(AES_256_GCM_ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const { kek, protectionLevel } = getOrCreateMachineKek(keyIdentifier);

  // Wrap DEK with KEK using AES-256-GCM
  const wrapIv = randomBytes(GCM_IV_LENGTH_BYTES);
  const wrapCipher = createCipheriv(AES_256_GCM_ALGORITHM, kek, wrapIv);
  const wrappedDek = Buffer.concat([
    wrapCipher.update(dek),
    wrapCipher.final(),
  ]);
  const wrapAuthTag = wrapCipher.getAuthTag();

  // Combine wrapped DEK with wrap IV and wrap AuthTag
  const wrappedKeyBlob = Buffer.concat([wrapIv, wrapAuthTag, wrappedDek]);

  return {
    ciphertext,
    metadata: {
      algorithm: "aes-256-gcm",
      authTagHex: authTag.toString("hex"),
      ivHex: iv.toString("hex"),
      keyIdentifier,
      keyProtectionLevel: protectionLevel,
      wrappedKeyHex: wrappedKeyBlob.toString("hex"),
    },
  };
}

/**
 * Decrypts recovery payload.
 * Throws explicit error if key is unavailable, corrupted, or authentication fails.
 */
export function decryptRecoveryPayload(options: DecryptOptions): Buffer {
  const { ciphertext, metadata, customKekProvider } = options;

  if (metadata.algorithm !== "aes-256-gcm") {
    throw new Error(
      `Unsupported recovery encryption algorithm: "${metadata.algorithm}"`,
    );
  }

  let kek: Buffer | null = null;
  if (customKekProvider !== undefined) {
    kek = customKekProvider(metadata.keyIdentifier);
  } else {
    try {
      kek = getOrCreateMachineKek(metadata.keyIdentifier).kek;
    } catch {
      kek = null;
    }
  }

  if (!kek || kek.length !== DEK_LENGTH_BYTES) {
    throw new Error(
      `RECOVERY_KEY_UNAVAILABLE: Key with identifier "${metadata.keyIdentifier}" could not be retrieved from key storage`,
    );
  }

  // Unwrap DEK
  const wrappedKeyBlob = Buffer.from(metadata.wrappedKeyHex, "hex");
  if (
    wrappedKeyBlob.length <
    GCM_IV_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES + DEK_LENGTH_BYTES
  ) {
    throw new Error(
      "RECOVERY_CORRUPTED_ENVELOPE: Wrapped key envelope is truncated",
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
    const unwrapDecipher = createDecipheriv(AES_256_GCM_ALGORITHM, kek, wrapIv);
    unwrapDecipher.setAuthTag(wrapAuthTag);
    dek = Buffer.concat([
      unwrapDecipher.update(wrappedDek),
      unwrapDecipher.final(),
    ]);
  } catch {
    throw new Error(
      "RECOVERY_KEY_UNAVAILABLE: Decryption of Data Encryption Key failed (wrong key or corrupted envelope)",
    );
  }

  // Decrypt main payload
  const iv = Buffer.from(metadata.ivHex, "hex");
  const authTag = Buffer.from(metadata.authTagHex, "hex");

  try {
    const decipher = createDecipheriv(AES_256_GCM_ALGORITHM, dek, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(
      "RECOVERY_AUTHENTICATION_FAILED: Payload decryption or auth tag verification failed (corrupted or tampered recovery point)",
    );
  }
}
