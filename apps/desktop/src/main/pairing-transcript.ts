import {
  CertificationRequest,
  CertificationRequestInfo,
} from "@peculiar/asn1-csr";
import { AsnParser, AsnSerializer } from "@peculiar/asn1-schema";
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  Name,
  RelativeDistinguishedName,
  SubjectPublicKeyInfo,
} from "@peculiar/asn1-x509";
import { createHash, sign, type KeyObject } from "node:crypto";

const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";

/**
 * The Main installation and a joining terminal derive the same bytes from the
 * same facts. Each transcript carries its own domain prefix so a signature
 * produced for one step can never be replayed into another.
 */
export const PAIRING_JOIN_DOMAIN = "breev-pairing-join-v1" as const;
export const PAIRING_FETCH_DOMAIN = "breev-pairing-fetch-v1" as const;
export const PAIRING_FINGERPRINT_DOMAIN =
  "breev-pairing-fingerprint-v1" as const;

/** The certificate signing request names the device role, never its identity. */
export const TERMINAL_CSR_COMMON_NAME = "breev-terminal" as const;

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const CA_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const FINGERPRINT_DIGIT_COUNT = 12;
const FINGERPRINT_MODULUS = 10n ** BigInt(FINGERPRINT_DIGIT_COUNT);

export interface PairingBinding {
  readonly caFingerprint: string;
  readonly installationId: string;
  readonly sessionId: string;
  readonly subjectPublicKeyInfoDer: Buffer;
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

export function isCaFingerprint(value: string): boolean {
  return CA_FINGERPRINT_PATTERN.test(value);
}

export function uuidToBytes(value: string): Buffer {
  if (!isUuidV7(value)) {
    throw new Error("A pairing identifier must be an RFC 9562 UUIDv7");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

export function caFingerprintToBytes(value: string): Buffer {
  if (!isCaFingerprint(value)) {
    throw new Error(
      "A pairing certificate authority fingerprint must be 32 lowercase hexadecimal bytes",
    );
  }
  return Buffer.from(value, "hex");
}

export function buildJoinTranscript(binding: PairingBinding): Buffer {
  return concatenateTranscript(PAIRING_JOIN_DOMAIN, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    caFingerprintToBytes(binding.caFingerprint),
    binding.subjectPublicKeyInfoDer,
  ]);
}

export function buildFetchTranscript(
  binding: Omit<PairingBinding, "caFingerprint">,
): Buffer {
  return concatenateTranscript(PAIRING_FETCH_DOMAIN, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    binding.subjectPublicKeyInfoDer,
  ]);
}

export function buildFingerprintTranscript(binding: PairingBinding): Buffer {
  return concatenateTranscript(PAIRING_FINGERPRINT_DOMAIN, [
    uuidToBytes(binding.sessionId),
    uuidToBytes(binding.installationId),
    caFingerprintToBytes(binding.caFingerprint),
    binding.subjectPublicKeyInfoDer,
  ]);
}

/**
 * Both screens show the same twelve digits so the user can compare them before
 * confirming the physical terminal.
 */
export function deriveFingerprintDigits(binding: PairingBinding): string {
  const digest = createHash("sha256")
    .update(buildFingerprintTranscript(binding))
    .digest();
  const value = digest.readBigUInt64BE(0) % FINGERPRINT_MODULUS;
  return value.toString(10).padStart(FINGERPRINT_DIGIT_COUNT, "0");
}

/**
 * RSASSA-PKCS1-v1_5 over SHA-256 of the transcript bytes. The Main
 * installation verifies with the same construction against the public key the
 * certificate signing request carries, which proves possession of the private
 * key that never leaves this device.
 */
export function signTranscript(
  transcript: Buffer,
  privateKey: KeyObject,
): string {
  return sign("sha256", transcript, privateKey).toString("base64");
}

export function subjectPublicKeyInfoDer(publicKey: KeyObject): Buffer {
  return publicKey.export({ format: "der", type: "spki" });
}

/**
 * A minimal PKCS#10 request: the subject only states the device role because
 * the Main installation assigns every identity name itself and ignores any
 * subject or subject alternative name a caller proposes.
 */
export function buildTerminalCertificateRequest(keys: {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}): string {
  const info = new CertificationRequestInfo({
    version: 0,
    subject: certificateRequestName(),
    subjectPKInfo: AsnParser.parse(
      subjectPublicKeyInfoDer(keys.publicKey),
      SubjectPublicKeyInfo,
    ),
  });
  const infoDer = Buffer.from(AsnSerializer.serialize(info));
  const request = new CertificationRequest({
    certificationRequestInfo: info,
    signatureAlgorithm: new AlgorithmIdentifier({
      algorithm: OID_SHA256_WITH_RSA,
      parameters: null,
    }),
    signature: toArrayBuffer(sign("sha256", infoDer, keys.privateKey)),
  });

  return pemEncode(
    "CERTIFICATE REQUEST",
    Buffer.from(AsnSerializer.serialize(request)),
  );
}

export function pemEncode(label: string, der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function pemDecode(label: string, pem: string): Buffer {
  const pattern = new RegExp(
    `-----BEGIN ${label}-----([A-Za-z0-9+/=\\s]+)-----END ${label}-----`,
    "u",
  );
  const match = pattern.exec(pem);
  if (match?.[1] === undefined) {
    throw new Error(`The ${label.toLowerCase()} is not valid PEM`);
  }
  return Buffer.from(match[1].replaceAll(/\s/gu, ""), "base64");
}

function concatenateTranscript(
  domain: string,
  parts: readonly Buffer[],
): Buffer {
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.of(0x00),
    ...parts,
  ]);
}

function certificateRequestName(): Name {
  return new Name([
    new RelativeDistinguishedName([
      new AttributeTypeAndValue({
        type: OID_ORGANIZATION,
        value: new AttributeValue({ utf8String: "Breev" }),
      }),
    ]),
    new RelativeDistinguishedName([
      new AttributeTypeAndValue({
        type: OID_COMMON_NAME,
        value: new AttributeValue({ utf8String: TERMINAL_CSR_COMMON_NAME }),
      }),
    ]),
  ]);
}

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}
