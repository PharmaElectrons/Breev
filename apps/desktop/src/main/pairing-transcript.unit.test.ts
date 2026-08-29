import { CertificationRequest } from "@peculiar/asn1-csr";
import { AsnParser, AsnSerializer } from "@peculiar/asn1-schema";
import type { Name } from "@peculiar/asn1-x509";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  TERMINAL_CSR_COMMON_NAME,
  buildFetchTranscript,
  buildFingerprintTranscript,
  buildJoinTranscript,
  buildTerminalCertificateRequest,
  caFingerprintToBytes,
  deriveFingerprintDigits,
  pemDecode,
  pemEncode,
  signTranscript,
  subjectPublicKeyInfoDer,
  uuidToBytes,
} from "./pairing-transcript.js";

const OID_COMMON_NAME = "2.5.4.3";

/**
 * The Main installation, not this terminal, is what reads a certificate signing
 * request, so the reader lives here: it is the independent check that the
 * request this module builds really carries the generated key under a valid
 * self-signature.
 */
function readCertificateRequest(pem: string): {
  readonly commonName: string | undefined;
  readonly selfSignatureValid: boolean;
  readonly subjectPublicKeyInfoDer: Buffer;
} {
  const request = AsnParser.parse(
    pemDecode("CERTIFICATE REQUEST", pem),
    CertificationRequest,
    {
      berOptions: { maxContentLength: 16 * 1024, maxDepth: 32, maxNodes: 512 },
    },
  );
  const info = Buffer.from(
    AsnSerializer.serialize(request.certificationRequestInfo),
  );
  const publicKeyDer = Buffer.from(
    AsnSerializer.serialize(request.certificationRequestInfo.subjectPKInfo),
  );

  return {
    commonName: commonNameOf(request.certificationRequestInfo.subject),
    selfSignatureValid: verify(
      "sha256",
      info,
      createPublicKey({ format: "der", key: publicKeyDer, type: "spki" }),
      Buffer.from(request.signature),
    ),
    subjectPublicKeyInfoDer: publicKeyDer,
  };
}

function commonNameOf(name: Name): string | undefined {
  for (const relative of name) {
    for (const attribute of relative) {
      if (attribute.type === OID_COMMON_NAME) {
        return attribute.value.toString();
      }
    }
  }
  return undefined;
}

/** Verified with the primitive itself, not with a sibling of the signer. */
function verifiesTranscript(
  transcript: Buffer,
  signature: string,
  publicKey: KeyObject,
): boolean {
  try {
    return verify(
      "sha256",
      transcript,
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

const sessionId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";
const caFingerprint =
  "1122334455667788990011223344556677889900112233445566778899001122";
// A fixed SubjectPublicKeyInfo stand-in keeps the vectors reproducible on both
// sides of the ceremony without shipping a key.
const spki = Buffer.from("30820122300d06092a864886f70d0101010500", "hex");

const binding = {
  caFingerprint,
  installationId,
  sessionId,
  subjectPublicKeyInfoDer: spki,
};

describe("pairing transcripts", () => {
  it("builds each transcript from its own domain and the same bound facts", () => {
    const join = buildJoinTranscript(binding);
    const fetch = buildFetchTranscript(binding);
    const phrase = buildFingerprintTranscript(binding);

    expect(join.subarray(0, 21).toString("utf8")).toBe("breev-pairing-join-v1");
    expect(join[21]).toBe(0);
    expect(fetch.subarray(0, 22).toString("utf8")).toBe(
      "breev-pairing-fetch-v1",
    );
    expect(fetch[22]).toBe(0);
    expect(phrase.subarray(0, 28).toString("utf8")).toBe(
      "breev-pairing-fingerprint-v1",
    );
    expect(phrase[28]).toBe(0);

    expect(join).toEqual(
      Buffer.concat([
        Buffer.from("breev-pairing-join-v1", "utf8"),
        Buffer.of(0),
        uuidToBytes(sessionId),
        uuidToBytes(installationId),
        caFingerprintToBytes(caFingerprint),
        spki,
      ]),
    );
    expect(fetch).toEqual(
      Buffer.concat([
        Buffer.from("breev-pairing-fetch-v1", "utf8"),
        Buffer.of(0),
        uuidToBytes(sessionId),
        uuidToBytes(installationId),
        spki,
      ]),
    );
    expect(phrase.length).toBe(29 + 16 + 16 + 32 + spki.length);
  });

  it("pins the published vector hashes so both sides can be compared", () => {
    expect(
      createHash("sha256").update(buildJoinTranscript(binding)).digest("hex"),
    ).toBe("82deaea3fc62781a1946454e6f06ba996e46aa1dc46af44ad9979eb42d60d2a2");
    expect(
      createHash("sha256").update(buildFetchTranscript(binding)).digest("hex"),
    ).toBe("b9674994473797899604db60dc4c2c9698095bcad1e58955fd9e0b72cf21eb21");
  });

  it("derives twelve comparison digits from the fingerprint transcript", () => {
    const digest = createHash("sha256")
      .update(buildFingerprintTranscript(binding))
      .digest();
    const expected = (digest.readBigUInt64BE(0) % 10n ** 12n)
      .toString(10)
      .padStart(12, "0");

    const digits = deriveFingerprintDigits(binding);
    expect(digits).toBe(expected);
    expect(digits).toMatch(/^\d{12}$/u);
    // The same fixed tuple is pinned on the Main installation's side, so the
    // two implementations are compared against one published number rather
    // than against each other.
    expect(digits).toBe("903205141592");
  });

  it("changes the digits when any bound fact changes", () => {
    const digits = deriveFingerprintDigits(binding);
    expect(
      deriveFingerprintDigits({
        ...binding,
        sessionId: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0d",
      }),
    ).not.toBe(digits);
    expect(
      deriveFingerprintDigits({
        ...binding,
        caFingerprint: caFingerprint.replace(/^11/u, "22"),
      }),
    ).not.toBe(digits);
    expect(
      deriveFingerprintDigits({
        ...binding,
        subjectPublicKeyInfoDer: Buffer.concat([spki, Buffer.of(1)]),
      }),
    ).not.toBe(digits);
  });

  it.each([
    "",
    "not-a-uuid",
    "0192f0a0-1c2d-4e3f-8a4b-5c6d7e8f9a0b",
    "0192f0a0-1c2d-7e3f-0a4b-5c6d7e8f9a0b",
  ])("refuses an identifier that is not a UUIDv7: %s", (value) => {
    expect(() => uuidToBytes(value)).toThrow();
  });

  it.each(["", "11".repeat(31), "ZZ".repeat(32), "AB".repeat(32)])(
    "refuses a certificate authority pin that is not 32 lowercase hex bytes",
    (value) => {
      expect(() => caFingerprintToBytes(value)).toThrow();
    },
  );

  it("signs and verifies a transcript with the generated key", () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const transcript = buildJoinTranscript({
      ...binding,
      subjectPublicKeyInfoDer: subjectPublicKeyInfoDer(keys.publicKey),
    });
    const signature = signTranscript(transcript, keys.privateKey);

    expect(verifiesTranscript(transcript, signature, keys.publicKey)).toBe(
      true,
    );
    expect(
      verifiesTranscript(
        buildFetchTranscript(binding),
        signature,
        keys.publicKey,
      ),
    ).toBe(false);
    expect(
      verifiesTranscript(transcript, "not-base64-signature", keys.publicKey),
    ).toBe(false);
  });
});

describe("terminal certificate signing request", () => {
  it("carries the generated public key under a self-signature", () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const csrPem = buildTerminalCertificateRequest(keys);
    const parsed = readCertificateRequest(csrPem);

    expect(csrPem.startsWith("-----BEGIN CERTIFICATE REQUEST-----")).toBe(true);
    expect(parsed.selfSignatureValid).toBe(true);
    expect(parsed.commonName).toBe(TERMINAL_CSR_COMMON_NAME);
    expect(parsed.subjectPublicKeyInfoDer).toEqual(
      subjectPublicKeyInfoDer(keys.publicKey),
    );
    expect(
      createPublicKey({
        format: "der",
        key: parsed.subjectPublicKeyInfoDer,
        type: "spki",
      }).asymmetricKeyType,
    ).toBe("rsa");
  });

  it("rejects a request whose signature was made by another key", () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = buildTerminalCertificateRequest({
      privateKey: other.privateKey,
      publicKey: keys.publicKey,
    });

    expect(readCertificateRequest(forged).selfSignatureValid).toBe(false);
  });

  it("round-trips PEM without changing the bytes", () => {
    const der = Buffer.from("abcdef0123456789", "hex");
    expect(
      pemDecode("CERTIFICATE REQUEST", pemEncode("CERTIFICATE REQUEST", der)),
    ).toEqual(der);
    expect(() => pemDecode("CERTIFICATE", "not pem at all")).toThrow();
  });
});
