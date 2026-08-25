/**
 * Pure TypeScript X.509 ASN.1 DER certificate generator and validator.
 *
 * Implements RFC 5280 X.509 v3 certificate construction with standard and
 * custom extensions, and delegates signing to a signing callback (CNG signHash
 * for the CA, or Node.js RSA crypto for leaf keys).
 *
 * Validation uses Node.js built-in crypto.X509Certificate for RFC-compliant
 * parsing, validity checking, and cryptographic signature verification.
 */

import { generateKeyPairSync, X509Certificate } from "node:crypto";
import type { CngKeyHandle } from "./cng-addon.js";
import { signHash } from "./cng-addon.js";

// ─── OID Constants ────────────────────────────────────────────────────────────

export const OID_BREEV_SERVER = "1.3.6.1.4.1.0.7265.1.1" as const;
export const OID_BREEV_DEVICE = "1.3.6.1.4.1.0.7265.1.2" as const;
export const OID_INSTALLATION_ID = "1.3.6.1.4.1.0.7265.2.1" as const;
export const OID_DEVICE_ID = "1.3.6.1.4.1.0.7265.2.2" as const;

export const OID_TLS_SERVER_AUTH = "1.3.6.1.5.5.7.3.1" as const;
export const OID_TLS_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2" as const;

const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_EXT_KEY_USAGE = "2.5.29.37";
const OID_SAN = "2.5.29.17";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CertRole = "server" | "device";

export interface IssuedCertificate {
  readonly certPem: string;
  readonly fingerprint: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly serialHex: string;
}

export interface IssuedLeafCertificate extends IssuedCertificate {
  readonly privateKeyPem: string;
}

export interface CertValidationSuccess {
  readonly valid: true;
  readonly role: CertRole;
  readonly deviceId: string | undefined;
  readonly fingerprint: string;
}

export interface CertValidationFailure {
  readonly valid: false;
  readonly denialCode:
    | "cert-chain-invalid"
    | "cert-expired"
    | "cert-installation-mismatch"
    | "cert-not-yet-valid"
    | "cert-role-mismatch"
    | "mtls-cert-invalid";
}

export type CertValidationResult =
  CertValidationSuccess | CertValidationFailure;

// ─── ASN.1 DER Encoding Helpers ───────────────────────────────────────────────

function derLength(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([tag]),
    derLength(content.length),
    content,
  ]);
}

function derSequence(items: Buffer[]): Buffer {
  return derTag(0x30, Buffer.concat(items));
}

function derSet(items: Buffer[]): Buffer {
  return derTag(0x31, Buffer.concat(items));
}

function derInteger(num: bigint | number): Buffer {
  let hex =
    typeof num === "bigint" ? num.toString(16) : BigInt(num).toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  let buf = Buffer.from(hex, "hex");
  if (buf[0]! & 0x80) {
    buf = Buffer.concat([Buffer.from([0x00]), buf]);
  }
  return derTag(0x02, buf);
}

function derBitString(data: Buffer): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([0x00]), data]));
}

function derOctetString(data: Buffer): Buffer {
  return derTag(0x04, data);
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

function derOid(oidStr: string): Buffer {
  const parts = oidStr.split(".").map(Number);
  const first = parts[0]! * 40 + parts[1]!;
  const bytes: number[] = [first];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i]!;
    if (val < 128) {
      bytes.push(val);
    } else {
      const sub: number[] = [];
      sub.push(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        sub.unshift((val & 0x7f) | 0x80);
        val >>= 7;
      }
      bytes.push(...sub);
    }
  }
  return derTag(0x06, Buffer.from(bytes));
}

function derUtf8String(str: string): Buffer {
  return derTag(0x0c, Buffer.from(str, "utf8"));
}

function derUtcTime(d: Date): Buffer {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yr = pad(d.getUTCFullYear() % 100);
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const hr = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const se = pad(d.getUTCSeconds());
  return derTag(0x17, Buffer.from(`${yr}${mo}${da}${hr}${mi}${se}Z`, "ascii"));
}

function derAlgorithmIdentifier(oid: string): Buffer {
  return derSequence([derOid(oid), derNull()]);
}

function derRdn(typeOid: string, value: string): Buffer {
  return derSet([derSequence([derOid(typeOid), derUtf8String(value)])]);
}

function pemEncodeCert(der: Buffer): string {
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

// ─── CA Certificate Construction ──────────────────────────────────────────────

export function buildCACertificate(params: {
  readonly keyHandle: CngKeyHandle;
  readonly publicKeyDer: Buffer;
  readonly installationId: string;
  readonly validityDays: number;
}): IssuedCertificate {
  const { keyHandle, publicKeyDer, installationId, validityDays } = params;

  const notBefore = new Date(Date.now() - 60000);
  const notAfter = new Date(notBefore.getTime() + validityDays * 86400000);

  const issuer = derSequence([
    derRdn(OID_ORGANIZATION, "Breev"),
    derRdn(OID_COMMON_NAME, "breev-pharmacy-ca"),
  ]);
  const subject = issuer;
  const validity = derSequence([derUtcTime(notBefore), derUtcTime(notAfter)]);

  // Extensions
  const extBasicConstraints = derSequence([
    derOid(OID_BASIC_CONSTRAINTS),
    Buffer.from([0x01, 0x01, 0xff]), // critical TRUE
    derOctetString(
      derSequence([Buffer.from([0x01, 0x01, 0xff]), derInteger(0)]),
    ),
  ]);

  const extKeyUsage = derSequence([
    derOid(OID_KEY_USAGE),
    Buffer.from([0x01, 0x01, 0xff]), // critical TRUE
    derOctetString(derTag(0x03, Buffer.from([0x01, 0x06]))), // keyCertSign + cRLSign
  ]);

  const extInstallationId = derSequence([
    derOid(OID_INSTALLATION_ID),
    derOctetString(derUtf8String(installationId)),
  ]);

  const extensions = derTag(
    0xa3,
    derSequence([extBasicConstraints, extKeyUsage, extInstallationId]),
  );

  const serialNum = 1;
  const tbs = derSequence([
    derTag(0xa0, derInteger(2)), // v3
    derInteger(serialNum),
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    issuer,
    validity,
    subject,
    publicKeyDer,
    extensions,
  ]);

  // Sign TBS with CNG key
  const sig = signHash(keyHandle, tbs, { algorithm: "SHA256" });

  const certDer = derSequence([
    tbs,
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    derBitString(sig),
  ]);

  const certPem = pemEncodeCert(certDer);
  const certObj = new X509Certificate(certPem);

  return {
    certPem,
    fingerprint: certObj.fingerprint256.replace(/:/g, "").toLowerCase(),
    notBefore,
    notAfter,
    serialHex: "01",
  };
}

// ─── Server Certificate Construction ──────────────────────────────────────────

export function buildServerCertificate(params: {
  readonly caKeyHandle: CngKeyHandle;
  readonly caCertPem: string;
  readonly installationId: string;
  readonly sanIPs: readonly string[];
  readonly validityDays: number;
}): IssuedLeafCertificate {
  const { caKeyHandle, installationId, sanIPs, validityDays } = params;

  const notBefore = new Date(Date.now() - 60000);
  const notAfter = new Date(notBefore.getTime() + validityDays * 86400000);

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const serverSpki = publicKey.export({ format: "der", type: "spki" });
  const serverPrivatePem = privateKey.export({
    format: "pem",
    type: "pkcs8",
  }) as string;

  const issuer = derSequence([
    derRdn(OID_ORGANIZATION, "Breev"),
    derRdn(OID_COMMON_NAME, "breev-pharmacy-ca"),
  ]);

  const subject = derSequence([
    derRdn(OID_ORGANIZATION, "Breev"),
    derRdn(OID_COMMON_NAME, `breev-server-${installationId}`),
  ]);

  const validity = derSequence([derUtcTime(notBefore), derUtcTime(notAfter)]);

  // Build SAN extension (IP addresses)
  const sanEntries: Buffer[] = [];
  for (const ip of sanIPs) {
    if (ip === "127.0.0.1") {
      sanEntries.push(derTag(0x87, Buffer.from([127, 0, 0, 1])));
    } else {
      const parts = ip.split(".").map(Number);
      if (parts.length === 4) {
        sanEntries.push(derTag(0x87, Buffer.from(parts)));
      }
    }
  }

  const extBasicConstraints = derSequence([
    derOid(OID_BASIC_CONSTRAINTS),
    derOctetString(derSequence([Buffer.from([0x01, 0x01, 0x00])])), // CA=FALSE
  ]);

  const extKeyUsage = derSequence([
    derOid(OID_KEY_USAGE),
    derOctetString(derTag(0x03, Buffer.from([0x01, 0xa0]))), // digitalSignature, keyEncipherment
  ]);

  const extEku = derSequence([
    derOid(OID_EXT_KEY_USAGE),
    derOctetString(
      derSequence([derOid(OID_TLS_SERVER_AUTH), derOid(OID_BREEV_SERVER)]),
    ),
  ]);

  const extSan = derSequence([
    derOid(OID_SAN),
    derOctetString(derSequence(sanEntries)),
  ]);

  const extInstallationId = derSequence([
    derOid(OID_INSTALLATION_ID),
    derOctetString(derUtf8String(installationId)),
  ]);

  const extensions = derTag(
    0xa3,
    derSequence([
      extBasicConstraints,
      extKeyUsage,
      extEku,
      extSan,
      extInstallationId,
    ]),
  );

  const serialNum = 2;
  const tbs = derSequence([
    derTag(0xa0, derInteger(2)),
    derInteger(serialNum),
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    issuer,
    validity,
    subject,
    serverSpki,
    extensions,
  ]);

  const sig = signHash(caKeyHandle, tbs, { algorithm: "SHA256" });

  const certDer = derSequence([
    tbs,
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    derBitString(sig),
  ]);

  const certPem = pemEncodeCert(certDer);
  const certObj = new X509Certificate(certPem);

  return {
    certPem,
    fingerprint: certObj.fingerprint256.replace(/:/g, "").toLowerCase(),
    notBefore,
    notAfter,
    serialHex: "02",
    privateKeyPem: serverPrivatePem,
  };
}

// ─── Device Certificate Construction ──────────────────────────────────────────

export function buildDeviceCertificate(params: {
  readonly caKeyHandle: CngKeyHandle;
  readonly caCertPem: string;
  readonly deviceId: string;
  readonly installationId: string;
  readonly devicePublicKeyDer: Buffer;
  readonly validityDays: number;
}): IssuedCertificate {
  const {
    caKeyHandle,
    deviceId,
    installationId,
    devicePublicKeyDer,
    validityDays,
  } = params;

  const notBefore = new Date(Date.now() - 60000);
  const notAfter = new Date(notBefore.getTime() + validityDays * 86400000);

  const issuer = derSequence([
    derRdn(OID_ORGANIZATION, "Breev"),
    derRdn(OID_COMMON_NAME, "breev-pharmacy-ca"),
  ]);

  const subject = derSequence([
    derRdn(OID_ORGANIZATION, "Breev"),
    derRdn(OID_COMMON_NAME, `breev-device-${deviceId}`),
  ]);

  const validity = derSequence([derUtcTime(notBefore), derUtcTime(notAfter)]);

  const extBasicConstraints = derSequence([
    derOid(OID_BASIC_CONSTRAINTS),
    derOctetString(derSequence([Buffer.from([0x01, 0x01, 0x00])])),
  ]);

  const extKeyUsage = derSequence([
    derOid(OID_KEY_USAGE),
    derOctetString(derTag(0x03, Buffer.from([0x01, 0x80]))), // digitalSignature
  ]);

  const extEku = derSequence([
    derOid(OID_EXT_KEY_USAGE),
    derOctetString(
      derSequence([derOid(OID_TLS_CLIENT_AUTH), derOid(OID_BREEV_DEVICE)]),
    ),
  ]);

  const extInstallationId = derSequence([
    derOid(OID_INSTALLATION_ID),
    derOctetString(derUtf8String(installationId)),
  ]);

  const extDeviceId = derSequence([
    derOid(OID_DEVICE_ID),
    derOctetString(derUtf8String(deviceId)),
  ]);

  const extensions = derTag(
    0xa3,
    derSequence([
      extBasicConstraints,
      extKeyUsage,
      extEku,
      extInstallationId,
      extDeviceId,
    ]),
  );

  const serialNum = 3;
  const tbs = derSequence([
    derTag(0xa0, derInteger(2)),
    derInteger(serialNum),
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    issuer,
    validity,
    subject,
    devicePublicKeyDer,
    extensions,
  ]);

  const sig = signHash(caKeyHandle, tbs, { algorithm: "SHA256" });

  const certDer = derSequence([
    tbs,
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    derBitString(sig),
  ]);

  const certPem = pemEncodeCert(certDer);
  const certObj = new X509Certificate(certPem);

  return {
    certPem,
    fingerprint: certObj.fingerprint256.replace(/:/g, "").toLowerCase(),
    notBefore,
    notAfter,
    serialHex: "03",
  };
}

// ─── Certificate Validation Pipeline ──────────────────────────────────────────

export function validateCertificate(params: {
  readonly certDer: Buffer;
  readonly caCertPem: string;
  readonly expectedRole: CertRole;
  readonly installationId: string;
  readonly now?: Date | undefined;
}): CertValidationResult {
  const { certDer, caCertPem, expectedRole, installationId } = params;
  const now = params.now ?? new Date();

  let cert: X509Certificate;
  let caCert: X509Certificate;
  try {
    cert = new X509Certificate(certDer);
    caCert = new X509Certificate(caCertPem);
  } catch {
    return { valid: false, denialCode: "mtls-cert-invalid" };
  }

  // 1. Validity window
  if (now < new Date(cert.validFrom)) {
    return { valid: false, denialCode: "cert-not-yet-valid" };
  }
  if (now > new Date(cert.validTo)) {
    return { valid: false, denialCode: "cert-expired" };
  }

  // 2. Cryptographic signature check against CA public key
  if (!cert.verify(caCert.publicKey)) {
    return { valid: false, denialCode: "cert-chain-invalid" };
  }

  // 3. Role verification (search raw DER for role OIDs)
  const role = extractRoleFromDer(certDer);
  if (role !== expectedRole) {
    return { valid: false, denialCode: "cert-role-mismatch" };
  }

  // 4. Installation identity verification
  const certInstallationId = extractOidString(certDer, OID_INSTALLATION_ID);
  if (certInstallationId !== installationId) {
    return { valid: false, denialCode: "cert-installation-mismatch" };
  }

  // 5. Device ID
  const deviceId =
    expectedRole === "device"
      ? (extractOidString(certDer, OID_DEVICE_ID) ?? undefined)
      : undefined;

  return {
    valid: true,
    role,
    deviceId,
    fingerprint: cert.fingerprint256.replace(/:/g, "").toLowerCase(),
  };
}

// ─── DER Extraction Helpers ───────────────────────────────────────────────────

function extractRoleFromDer(certDer: Buffer): CertRole | null {
  const serverOidDer = derOid(OID_BREEV_SERVER);
  const deviceOidDer = derOid(OID_BREEV_DEVICE);

  if (certDer.includes(serverOidDer)) return "server";
  if (certDer.includes(deviceOidDer)) return "device";
  return null;
}

function extractOidString(certDer: Buffer, oidStr: string): string | null {
  const targetOidDer = derOid(oidStr);
  const idx = certDer.indexOf(targetOidDer);
  if (idx === -1) return null;

  // Search ahead for the UTF8String tag (0x0C)
  const searchSlice = certDer.slice(
    idx + targetOidDer.length,
    idx + targetOidDer.length + 64,
  );
  const tagIdx = searchSlice.indexOf(0x0c);
  if (tagIdx === -1) return null;

  const len = searchSlice[tagIdx + 1];
  if (len === undefined || tagIdx + 2 + len > searchSlice.length) return null;

  return searchSlice.slice(tagIdx + 2, tagIdx + 2 + len).toString("utf8");
}
