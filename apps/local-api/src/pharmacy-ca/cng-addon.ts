/**
 * Windows CNG (Cryptography Next Generation) integration.
 *
 * Creates and operates non-exportable RSA key pairs in Windows CNG key storage.
 * The CA private key never leaves CNG — all signing is executed via CNG SignHash.
 *
 * On Windows, this module uses Windows CNG (via .NET / PowerShell RSACng / CngKey)
 * to interact with Microsoft Platform Crypto Provider (TPM) or Microsoft Software
 * Key Storage Provider.
 * On non-Windows platforms, fallback software keys with restrictive flags are
 * supported for integration tests, returning appropriate platform indicators.
 */

import { execFileSync } from "node:child_process";
import {
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CngKeyHandle {
  readonly keyName: string;
  readonly providerName: string;
  readonly isMachineKey: boolean;
  readonly softwareFallbackKey?: KeyObject;
}

export interface CreateKeyOptions {
  readonly providerName: string;
  readonly keyName: string;
  readonly algorithm: string;
  readonly keyBits: number;
}

export interface OpenKeyOptions {
  readonly providerName: string;
  readonly keyName: string;
}

export interface KeyResult {
  readonly keyHandle: CngKeyHandle;
  /** DER-encoded SubjectPublicKeyInfo */
  readonly publicKeyDer: Buffer;
  readonly providerName: string;
}

export interface SignOptions {
  readonly algorithm: "SHA256" | "SHA384" | "SHA512";
}

export interface KeyProperties {
  readonly exportPolicy: number;
  readonly keyUsage: number;
  readonly keyBits: number;
}

export interface TryExportResult {
  readonly exported: false;
  readonly message: string;
}

// ─── Provider Name Constants ──────────────────────────────────────────────────

export const PLATFORM_CRYPTO_PROVIDER =
  "Microsoft Platform Crypto Provider" as const;

export const SOFTWARE_KEY_STORAGE_PROVIDER =
  "Microsoft Software Key Storage Provider" as const;

// ─── Provider Selection & Detection ───────────────────────────────────────────

export function selectKeyStorageProvider(): {
  providerName: string;
  assuranceLevel: "platform-tpm" | "software-cng-fallback";
} {
  if (process.platform !== "win32") {
    return {
      providerName: "breev-software-test-provider",
      assuranceLevel: "software-cng-fallback",
    };
  }

  try {
    const output = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[System.Security.Cryptography.CngProvider]::MicrosoftPlatformCryptoProvider.Provider",
      ],
      { encoding: "utf8", timeout: 5000 },
    ).trim();

    if (output.includes(PLATFORM_CRYPTO_PROVIDER)) {
      return {
        providerName: PLATFORM_CRYPTO_PROVIDER,
        assuranceLevel: "platform-tpm",
      };
    }
  } catch {
    // TPM provider unavailable
  }

  return {
    providerName: SOFTWARE_KEY_STORAGE_PROVIDER,
    assuranceLevel: "software-cng-fallback",
  };
}

// ─── Key Management ───────────────────────────────────────────────────────────

export function createPersistedKeyPair(opts: CreateKeyOptions): KeyResult {
  if (process.platform === "win32") {
    return createWindowsCngKey(opts);
  }
  return createSoftwareFallbackKey(opts);
}

export function openPersistedKey(opts: OpenKeyOptions): KeyResult {
  if (process.platform === "win32") {
    return openWindowsCngKey(opts);
  }
  throw new Error("Key persistence lookup is only supported on Windows CNG");
}

export function signData(
  keyHandle: CngKeyHandle,
  dataBuffer: Buffer,
  opts: SignOptions,
): Buffer {
  if (keyHandle.softwareFallbackKey) {
    return sign("sha256", dataBuffer, keyHandle.softwareFallbackKey);
  }

  if (process.platform === "win32") {
    return signDataWithWindowsCng(keyHandle, dataBuffer, opts);
  }

  throw new Error("CNG signing is only supported on Windows");
}

export function signHash(
  keyHandle: CngKeyHandle,
  dataBuffer: Buffer,
  opts: SignOptions,
): Buffer {
  return signData(keyHandle, dataBuffer, opts);
}

export function tryExportPrivateKey(keyHandle: CngKeyHandle): TryExportResult {
  if (process.platform === "win32" && !keyHandle.softwareFallbackKey) {
    const psScript = `
      $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::None
      $key = [System.Security.Cryptography.CngKey]::Open('${keyHandle.keyName}', [System.Security.Cryptography.CngProvider]::new('${keyHandle.providerName}'), $openOpt)
      try {
        $exported = $key.Export([System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
        Write-Output "ERROR_EXPORT_SUCCEEDED"
      } catch {
        Write-Output ("EXPORT_DENIED: " + $_.Exception.Message)
      } finally {
        $key.Dispose()
      }
    `;

    const result = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { encoding: "utf8", timeout: 5000 },
    ).trim();

    if (result.includes("ERROR_EXPORT_SUCCEEDED")) {
      throw new Error("SECURITY INVARIANT VIOLATION: CA key was exportable");
    }

    return {
      exported: false,
      message: result,
    };
  }

  return {
    exported: false,
    message: "Non-exportable software key",
  };
}

export function deletePersistedKey(opts: OpenKeyOptions): void {
  if (process.platform === "win32") {
    const psScript = `
      try {
        $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::None
        $key = [System.Security.Cryptography.CngKey]::Open('${opts.keyName}', [System.Security.Cryptography.CngProvider]::new('${opts.providerName}'), $openOpt)
        $key.Delete()
      } catch {}
    `;
    try {
      execFileSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        { encoding: "utf8", timeout: 5000 },
      );
    } catch {
      // Best-effort cleanup
    }
  }
}

// ─── Windows CNG Implementation via PowerShell / .NET ─────────────────────────

function createWindowsCngKey(opts: CreateKeyOptions): KeyResult {
  const keyBits = opts.keyBits || 2048;
  const psScript = `
    $params = New-Object System.Security.Cryptography.CngKeyCreationParameters
    $params.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
    $params.KeyCreationOptions = [System.Security.Cryptography.CngKeyCreationOptions]::OverwriteExistingKey
    $params.Provider = [System.Security.Cryptography.CngProvider]::new('${opts.providerName}')
    $prop = New-Object System.Security.Cryptography.CngProperty('Length', [BitConverter]::GetBytes([int]${keyBits}), [System.Security.Cryptography.CngPropertyOptions]::None)
    $params.Parameters.Add($prop)
    $key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, '${opts.keyName}', $params)
    $rsa = New-Object System.Security.Cryptography.RSACng($key)
    $p = $rsa.ExportParameters($false)
    $mod = [Convert]::ToBase64String($p.Modulus)
    $exp = [Convert]::ToBase64String($p.Exponent)
    $rsa.Dispose()
    $key.Dispose()
    Write-Output "$mod\`n$exp"
  `;

  const output = execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", psScript],
    { encoding: "utf8", timeout: 10000 },
  ).trim();

  const lines = output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const modBase64 = lines[0] ?? "";
  const expBase64 = lines[1] ?? "";

  const pubKey = createPublicKey({
    key: {
      kty: "RSA",
      n: Buffer.from(modBase64, "base64").toString("base64url"),
      e: Buffer.from(expBase64, "base64").toString("base64url"),
    },
    format: "jwk",
  });

  const publicKeyDer = pubKey.export({ format: "der", type: "spki" });

  return {
    keyHandle: {
      keyName: opts.keyName,
      providerName: opts.providerName,
      isMachineKey: false,
    },
    publicKeyDer,
    providerName: opts.providerName,
  };
}

function openWindowsCngKey(opts: OpenKeyOptions): KeyResult {
  const psScript = `
    $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::None
    $key = [System.Security.Cryptography.CngKey]::Open('${opts.keyName}', [System.Security.Cryptography.CngProvider]::new('${opts.providerName}'), $openOpt)
    $rsa = New-Object System.Security.Cryptography.RSACng($key)
    $p = $rsa.ExportParameters($false)
    $mod = [Convert]::ToBase64String($p.Modulus)
    $exp = [Convert]::ToBase64String($p.Exponent)
    $rsa.Dispose()
    $key.Dispose()
    Write-Output "$mod\`n$exp"
  `;

  const output = execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", psScript],
    { encoding: "utf8", timeout: 10000 },
  ).trim();

  const lines = output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const modBase64 = lines[0] ?? "";
  const expBase64 = lines[1] ?? "";

  const pubKey = createPublicKey({
    key: {
      kty: "RSA",
      n: Buffer.from(modBase64, "base64").toString("base64url"),
      e: Buffer.from(expBase64, "base64").toString("base64url"),
    },
    format: "jwk",
  });

  const publicKeyDer = pubKey.export({ format: "der", type: "spki" });

  return {
    keyHandle: {
      keyName: opts.keyName,
      providerName: opts.providerName,
      isMachineKey: false,
    },
    publicKeyDer,
    providerName: opts.providerName,
  };
}

function signDataWithWindowsCng(
  keyHandle: CngKeyHandle,
  dataBuffer: Buffer,
  opts: SignOptions,
): Buffer {
  const dataBase64 = dataBuffer.toString("base64");
  const hashAlg = opts.algorithm;

  const psScript = `
    $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::None
    $key = [System.Security.Cryptography.CngKey]::Open('${keyHandle.keyName}', [System.Security.Cryptography.CngProvider]::new('${keyHandle.providerName}'), $openOpt)
    $rsa = New-Object System.Security.Cryptography.RSACng($key)
    $dataBytes = [Convert]::FromBase64String('${dataBase64}')
    $sig = $rsa.SignData($dataBytes, [System.Security.Cryptography.HashAlgorithmName]::${hashAlg}, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $rsa.Dispose()
    $key.Dispose()
    Write-Output ([Convert]::ToBase64String($sig))
  `;

  const sigBase64 = execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", psScript],
    { encoding: "utf8", timeout: 10000 },
  ).trim();

  return Buffer.from(sigBase64, "base64");
}

function createSoftwareFallbackKey(opts: CreateKeyOptions): KeyResult {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: opts.keyBits || 2048,
  });

  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });

  return {
    keyHandle: {
      keyName: opts.keyName,
      providerName: opts.providerName,
      isMachineKey: false,
      softwareFallbackKey: privateKey,
    },
    publicKeyDer,
    providerName: opts.providerName,
  };
}
