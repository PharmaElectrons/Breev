import { AsnSerializer } from "@peculiar/asn1-schema";
import {
  CertificationRequest,
  CertificationRequestInfo,
  Attributes,
} from "@peculiar/asn1-csr";
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  Name,
  RelativeDistinguishedName,
  SubjectPublicKeyInfo,
} from "@peculiar/asn1-x509";
import { AsnParser } from "@peculiar/asn1-schema";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildJoinTranscript, fingerprintToBytes } from "./pairing-domain.js";
import {
  CertificationRequestRejected,
  readCertificationRequest,
  readSubjectPublicKey,
  verifyTranscriptSignature,
} from "./pairing-csr.js";

const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";

const SESSION_ID = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const INSTALLATION_ID = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const CA_FINGERPRINT =
  "1122334455667788990011223344556677889900112233445566778899001122";

interface TestKeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

function spkiOf(publicKey: KeyObject): Buffer {
  return publicKey.export({ format: "der", type: "spki" }) as Buffer;
}

/**
 * Builds the same PKCS#10 shape the terminal sends: subject
 * `CN=breev-terminal, O=Breev`, no requested extensions, self-signed with
 * SHA-256 and RSA.
 */
function buildCertificateRequest(
  keys: TestKeyPair,
  signingKey: KeyObject = keys.privateKey,
): string {
  const info = new CertificationRequestInfo({
    version: 0,
    subject: new Name([
      new RelativeDistinguishedName([
        new AttributeTypeAndValue({
          type: OID_ORGANIZATION,
          value: new AttributeValue({ utf8String: "Breev" }),
        }),
      ]),
      new RelativeDistinguishedName([
        new AttributeTypeAndValue({
          type: OID_COMMON_NAME,
          value: new AttributeValue({ utf8String: "breev-terminal" }),
        }),
      ]),
    ]),
    subjectPKInfo: AsnParser.parse(
      spkiOf(keys.publicKey),
      SubjectPublicKeyInfo,
    ),
    attributes: new Attributes([]),
  });
  const infoDer = Buffer.from(AsnSerializer.serialize(info));
  const request = new CertificationRequest({
    certificationRequestInfo: info,
    signature: toArrayBuffer(sign("sha256", infoDer, signingKey)),
    signatureAlgorithm: new AlgorithmIdentifier({
      algorithm: OID_SHA256_WITH_RSA,
      parameters: null,
    }),
  });
  const der = Buffer.from(AsnSerializer.serialize(request));
  const lines = der.toString("base64").match(/.{1,64}/gu) ?? [];
  return `-----BEGIN CERTIFICATE REQUEST-----\n${lines.join("\n")}\n-----END CERTIFICATE REQUEST-----\n`;
}

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

describe("terminal certification requests", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("accepts a self-signed request and keeps only its public key", () => {
    const accepted = readCertificationRequest(buildCertificateRequest(keys));
    expect(accepted.spkiDer).toEqual(spkiOf(keys.publicKey));
    expect(accepted.spkiSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(accepted.publicKey.asymmetricKeyType).toBe("rsa");
  });

  it("refuses a request signed by a key it does not carry", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      readCertificationRequest(buildCertificateRequest(keys, other.privateKey)),
    ).toThrow(CertificationRequestRejected);
  });

  it("refuses a key that is not RSA-2048", () => {
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
    expect(() =>
      readCertificationRequest(buildCertificateRequest(weak)),
    ).toThrow(/unsupported-key-size/u);
  });

  it.each([
    ["not a certificate request at all", "malformed"],
    [
      "-----BEGIN CERTIFICATE REQUEST-----\nAA==\n-----END CERTIFICATE REQUEST-----\n",
      "malformed",
    ],
    [
      "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n",
      "malformed",
    ],
  ])("refuses a request that does not parse: %s", (csrPem) => {
    expect(() => readCertificationRequest(csrPem)).toThrow(
      CertificationRequestRejected,
    );
  });

  it("refuses a request larger than the pairing body budget", () => {
    expect(() =>
      readCertificationRequest(
        `-----BEGIN CERTIFICATE REQUEST-----\n${"A".repeat(9_000)}\n-----END CERTIFICATE REQUEST-----\n`,
      ),
    ).toThrow(/too-large/u);
  });

  it("verifies proof of possession only for the exact transcript", () => {
    const transcript = buildJoinTranscript({
      caFingerprint: CA_FINGERPRINT,
      installationId: INSTALLATION_ID,
      sessionId: SESSION_ID,
      spkiDer: spkiOf(keys.publicKey),
    });
    // Standard base64 on the wire, matching the terminal client.
    const signature = sign("sha256", transcript, keys.privateKey).toString(
      "base64",
    );
    expect(
      verifyTranscriptSignature({
        publicKey: readSubjectPublicKey(spkiOf(keys.publicKey)),
        signature: Buffer.from(signature, "base64"),
        transcript,
      }),
    ).toBe(true);
    expect(
      verifyTranscriptSignature({
        publicKey: readSubjectPublicKey(spkiOf(keys.publicKey)),
        signature: Buffer.from(signature, "base64"),
        transcript: Buffer.concat([transcript, Buffer.of(1)]),
      }),
    ).toBe(false);
    expect(
      verifyTranscriptSignature({
        publicKey: readSubjectPublicKey(spkiOf(keys.publicKey)),
        signature: Buffer.alloc(0),
        transcript,
      }),
    ).toBe(false);
    expect(
      verifyTranscriptSignature({
        publicKey: readSubjectPublicKey(
          spkiOf(generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey),
        ),
        signature: Buffer.from(signature, "base64"),
        transcript,
      }),
    ).toBe(false);
  });

  it("binds proof of possession to the certificate authority the QR pinned", () => {
    const spki = spkiOf(keys.publicKey);
    const transcript = buildJoinTranscript({
      caFingerprint: CA_FINGERPRINT,
      installationId: INSTALLATION_ID,
      sessionId: SESSION_ID,
      spkiDer: spki,
    });
    const foreign = buildJoinTranscript({
      caFingerprint: fingerprintToBytes(CA_FINGERPRINT)
        .toString("hex")
        .replace(/^11/u, "22"),
      installationId: INSTALLATION_ID,
      sessionId: SESSION_ID,
      spkiDer: spki,
    });
    const signature = sign("sha256", foreign, keys.privateKey);
    expect(
      verifyTranscriptSignature({
        publicKey: readSubjectPublicKey(spki),
        signature,
        transcript,
      }),
    ).toBe(false);
  });
});
