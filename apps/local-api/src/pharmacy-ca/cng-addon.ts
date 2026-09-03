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

import { execFile } from "node:child_process";
import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";

const WINDOWS_CNG_TIMEOUT_MS = 60_000;
const WINDOWS_CNG_PROVIDER_PROBE_TIMEOUT_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CngKeyHandle {
  readonly keyName: string;
  readonly providerName: string;
  readonly isMachineKey: boolean;
  readonly serviceAccountSid?: string;
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

export interface TryExportResult {
  readonly exported: false;
  readonly message: string;
}

export interface PersistedKeyAcl {
  readonly aceCount: number;
  readonly aceType: string;
  readonly allowedSid: string;
  readonly protected: boolean;
}

// ─── Provider Name Constants ──────────────────────────────────────────────────

export const PLATFORM_CRYPTO_PROVIDER =
  "Microsoft Platform Crypto Provider" as const;

export const SOFTWARE_KEY_STORAGE_PROVIDER =
  "Microsoft Software Key Storage Provider" as const;

// ─── Provider Selection & Detection ───────────────────────────────────────────

export async function selectKeyStorageProvider(): Promise<{
  providerName: string;
  assuranceLevel: "platform-tpm" | "software-cng-fallback";
}> {
  if (process.platform !== "win32") {
    return {
      providerName: "breev-software-test-provider",
      assuranceLevel: "software-cng-fallback",
    };
  }

  try {
    const probeName = `breev-cng-probe-${randomUUID()}`;
    const output = await runPowerShell(
      buildProviderProbeScript(probeName),
      WINDOWS_CNG_PROVIDER_PROBE_TIMEOUT_MS,
    );

    if (output === "AVAILABLE") {
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

export async function createPersistedKeyPair(
  opts: CreateKeyOptions,
): Promise<KeyResult> {
  assertValidKeyOptions(opts);
  if (process.platform === "win32") {
    return await createWindowsCngKey(opts);
  }
  return createSoftwareFallbackKey(opts);
}

export async function openPersistedKey(
  opts: OpenKeyOptions,
): Promise<KeyResult> {
  assertValidKeyIdentity(opts);
  if (process.platform === "win32") {
    return await openWindowsCngKey(opts);
  }
  const found = softwareKeyStore.get(opts.keyName);
  if (found) {
    return found;
  }
  throw new Error(
    `Key ${opts.keyName} not found in fallback key store for provider ${opts.providerName}`,
  );
}

export async function signData(
  keyHandle: CngKeyHandle,
  dataBuffer: Buffer,
  opts: SignOptions,
): Promise<Buffer> {
  if (keyHandle.softwareFallbackKey) {
    return sign(
      opts.algorithm.toLowerCase(),
      dataBuffer,
      keyHandle.softwareFallbackKey,
    );
  }

  if (process.platform === "win32") {
    return await signDataWithWindowsCng(keyHandle, dataBuffer, opts);
  }

  throw new Error("CNG signing is only supported on Windows");
}

export async function tryExportPrivateKey(
  keyHandle: CngKeyHandle,
): Promise<TryExportResult> {
  assertValidKeyIdentity(keyHandle);
  if (process.platform === "win32" && !keyHandle.softwareFallbackKey) {
    const psScript = `
      $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey -bor [System.Security.Cryptography.CngKeyOpenOptions]::Silent
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

    const result = await runPowerShell(psScript, WINDOWS_CNG_TIMEOUT_MS);

    if (result.includes("ERROR_EXPORT_SUCCEEDED")) {
      throw new Error("SECURITY INVARIANT VIOLATION: CA key was exportable");
    }

    return {
      exported: false,
      message: result,
    };
  }

  throw new Error(
    "Private-key non-exportability can only be proved against Windows CNG",
  );
}

export async function readPersistedKeyAcl(
  keyHandle: CngKeyHandle,
): Promise<PersistedKeyAcl> {
  assertValidKeyIdentity(keyHandle);
  if (process.platform !== "win32" || keyHandle.softwareFallbackKey) {
    throw new Error("CNG key ACLs can only be inspected on Windows");
  }
  const psScript = `
    $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey -bor [System.Security.Cryptography.CngKeyOpenOptions]::Silent
    $key = [System.Security.Cryptography.CngKey]::Open('${keyHandle.keyName}', [System.Security.Cryptography.CngProvider]::new('${keyHandle.providerName}'), $openOpt)
    try {
      $property = $key.GetProperty('Security Descr', [System.Security.Cryptography.CngPropertyOptions]4)
      $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($property.GetValue(), 0)
      $ace = $descriptor.DiscretionaryAcl[0]
      [pscustomobject]@{
        aceCount = $descriptor.DiscretionaryAcl.Count
        aceType = $ace.AceType.ToString()
        allowedSid = $ace.SecurityIdentifier.Value
        protected = (($descriptor.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0)
      } | ConvertTo-Json -Compress
    } finally {
      $key.Dispose()
    }
  `;
  const output = await runPowerShell(psScript, WINDOWS_CNG_TIMEOUT_MS);
  const acl = JSON.parse(output) as Partial<PersistedKeyAcl>;
  if (
    !Number.isInteger(acl.aceCount) ||
    typeof acl.aceType !== "string" ||
    typeof acl.allowedSid !== "string" ||
    typeof acl.protected !== "boolean"
  ) {
    throw new Error("Windows returned an invalid CNG key ACL description");
  }
  return acl as PersistedKeyAcl;
}

export async function deletePersistedKey(opts: OpenKeyOptions): Promise<void> {
  assertValidKeyIdentity(opts);
  if (process.platform === "win32") {
    const psScript = `
      try {
        $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey -bor [System.Security.Cryptography.CngKeyOpenOptions]::Silent
        $key = [System.Security.Cryptography.CngKey]::Open('${opts.keyName}', [System.Security.Cryptography.CngProvider]::new('${opts.providerName}'), $openOpt)
        $key.Delete()
      } catch {}
    `;
    try {
      await runPowerShell(psScript, WINDOWS_CNG_TIMEOUT_MS);
    } catch {
      // Best-effort cleanup
    }
  } else {
    softwareKeyStore.delete(opts.keyName);
  }
}

// ─── Windows CNG Implementation via PowerShell / .NET ─────────────────────────

async function createWindowsCngKey(opts: CreateKeyOptions): Promise<KeyResult> {
  const keyBits = opts.keyBits || 2048;
  const psScript = `
    $ErrorActionPreference = 'Stop'
    $params = New-Object System.Security.Cryptography.CngKeyCreationParameters
    $params.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
    $params.KeyCreationOptions = [System.Security.Cryptography.CngKeyCreationOptions]::MachineKey
    $params.Provider = [System.Security.Cryptography.CngProvider]::new('${opts.providerName}')
    $prop = New-Object System.Security.Cryptography.CngProperty('Length', [BitConverter]::GetBytes([int]${keyBits}), [System.Security.Cryptography.CngPropertyOptions]::None)
    $params.Parameters.Add($prop)
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor("D:P(A;;GA;;;" + $sid + ")")
    $descriptorBytes = New-Object byte[] $descriptor.BinaryLength
    $descriptor.GetBinaryForm($descriptorBytes, 0)
    $securityProperty = New-Object System.Security.Cryptography.CngProperty('Security Descr', $descriptorBytes, [System.Security.Cryptography.CngPropertyOptions]4)
    $params.Parameters.Add($securityProperty)
    $key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, '${opts.keyName}', $params)
    $rsa = New-Object System.Security.Cryptography.RSACng($key)
    $p = $rsa.ExportParameters($false)
    $mod = [Convert]::ToBase64String($p.Modulus)
    $exp = [Convert]::ToBase64String($p.Exponent)
    $rsa.Dispose()
    $key.Dispose()
    Write-Output "$mod\`n$exp\`n$sid"
  `;

  const output = await runPowerShell(psScript, WINDOWS_CNG_TIMEOUT_MS);

  const lines = output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const modBase64 = lines[0] ?? "";
  const expBase64 = lines[1] ?? "";
  const serviceAccountSid = lines[2] ?? "";

  if (!modBase64 || !expBase64 || !serviceAccountSid) {
    throw new Error(
      `Failed to obtain CNG key parameters for ${opts.keyName} on provider ${opts.providerName}`,
    );
  }

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
      isMachineKey: true,
      serviceAccountSid,
    },
    publicKeyDer,
    providerName: opts.providerName,
  };
}

async function openWindowsCngKey(opts: OpenKeyOptions): Promise<KeyResult> {
  const psScript = `
    $ErrorActionPreference = 'Stop'
    $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey -bor [System.Security.Cryptography.CngKeyOpenOptions]::Silent
    $key = [System.Security.Cryptography.CngKey]::Open('${opts.keyName}', [System.Security.Cryptography.CngProvider]::new('${opts.providerName}'), $openOpt)
    $rsa = New-Object System.Security.Cryptography.RSACng($key)
    $p = $rsa.ExportParameters($false)
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mod = [Convert]::ToBase64String($p.Modulus)
    $exp = [Convert]::ToBase64String($p.Exponent)
    $rsa.Dispose()
    $key.Dispose()
    Write-Output "$mod\`n$exp\`n$sid"
  `;

  const output = await runPowerShell(psScript, WINDOWS_CNG_TIMEOUT_MS);

  const lines = output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const modBase64 = lines[0] ?? "";
  const expBase64 = lines[1] ?? "";
  const serviceAccountSid = lines[2] ?? "";

  if (!modBase64 || !expBase64 || !serviceAccountSid) {
    throw new Error(
      `Failed to open CNG key parameters for ${opts.keyName} on provider ${opts.providerName}`,
    );
  }

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
      isMachineKey: true,
      serviceAccountSid,
    },
    publicKeyDer,
    providerName: opts.providerName,
  };
}

async function signDataWithWindowsCng(
  keyHandle: CngKeyHandle,
  dataBuffer: Buffer,
  opts: SignOptions,
): Promise<Buffer> {
  const dataBase64 = dataBuffer.toString("base64");
  const hashAlg = opts.algorithm;

  const psScript = `
    $ErrorActionPreference = 'Stop'
    $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey -bor [System.Security.Cryptography.CngKeyOpenOptions]::Silent
    $key = [System.Security.Cryptography.CngKey]::Open('${keyHandle.keyName}', [System.Security.Cryptography.CngProvider]::new('${keyHandle.providerName}'), $openOpt)
    $rsa = New-Object System.Security.Cryptography.RSACng($key)
    $dataBytes = [Convert]::FromBase64String('${dataBase64}')
    $sig = $rsa.SignData($dataBytes, [System.Security.Cryptography.HashAlgorithmName]::${hashAlg}, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $rsa.Dispose()
    $key.Dispose()
    Write-Output ([Convert]::ToBase64String($sig))
  `;

  const sigBase64 = await runPowerShell(psScript, WINDOWS_CNG_TIMEOUT_MS);

  if (!sigBase64) {
    throw new Error(
      `Failed to obtain CNG signature for ${keyHandle.keyName} on provider ${keyHandle.providerName}`,
    );
  }

  return Buffer.from(sigBase64, "base64");
}

const softwareKeyStore = new Map<string, KeyResult>();

function runPowerShell(script: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function assertValidKeyIdentity(opts: OpenKeyOptions): void {
  if (!/^[A-Za-z0-9-]{1,200}$/.test(opts.keyName)) {
    throw new Error("CNG key name contains unsupported characters");
  }
  if (
    opts.providerName !== PLATFORM_CRYPTO_PROVIDER &&
    opts.providerName !== SOFTWARE_KEY_STORAGE_PROVIDER &&
    opts.providerName !== "breev-software-test-provider"
  ) {
    throw new Error("Unsupported CNG provider");
  }
}

function assertValidKeyOptions(opts: CreateKeyOptions): void {
  assertValidKeyIdentity(opts);
  if (opts.algorithm !== "RSA") {
    throw new Error("Only RSA CNG keys are supported");
  }
  if (!Number.isInteger(opts.keyBits) || opts.keyBits < 2048) {
    throw new Error("CNG RSA keys must be at least 2048 bits");
  }
}

function buildProviderProbeScript(keyName: string): string {
  return `
    $ErrorActionPreference = 'Stop'
    $key = $null
    try {
      $params = New-Object System.Security.Cryptography.CngKeyCreationParameters
      $params.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
      $params.KeyCreationOptions = [System.Security.Cryptography.CngKeyCreationOptions]::MachineKey
      $params.Provider = [System.Security.Cryptography.CngProvider]::new('${PLATFORM_CRYPTO_PROVIDER}')
      $key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, '${keyName}', $params)
      $key.Dispose()
      $key = $null
      $openOpt = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey -bor [System.Security.Cryptography.CngKeyOpenOptions]::Silent
      $key = [System.Security.Cryptography.CngKey]::Open('${keyName}', [System.Security.Cryptography.CngProvider]::new('${PLATFORM_CRYPTO_PROVIDER}'), $openOpt)
      Write-Output 'AVAILABLE'
    } finally {
      if ($null -ne $key) {
        $key.Delete()
        $key.Dispose()
      }
    }
  `;
}

function createSoftwareFallbackKey(opts: CreateKeyOptions): KeyResult {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: opts.keyBits || 2048,
  });

  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });

  const result: KeyResult = {
    keyHandle: {
      keyName: opts.keyName,
      providerName: opts.providerName,
      isMachineKey: false,
      softwareFallbackKey: privateKey,
    },
    publicKeyDer,
    providerName: opts.providerName,
  };

  softwareKeyStore.set(opts.keyName, result);
  return result;
}
