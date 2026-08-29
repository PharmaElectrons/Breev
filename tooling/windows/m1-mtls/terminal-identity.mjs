/**
 * The two identities the milestone-1 mTLS proof needs, and nothing else.
 *
 * The first is the honest one: an RSA-2048 keypair and the PKCS#10 request the
 * Additional POS Terminal sends during pairing. Breev's own reader
 * (`apps/local-api/src/devices/pairing-csr.ts`) accepts exactly one shape —
 * version 0, `sha256WithRSAEncryption`, an RSA-2048 subject key, a valid
 * self-signature — and ignores every identity field inside it, so this builder
 * produces that shape and claims nothing.
 *
 * The second is the impostor: a self-signed certification authority and a leaf
 * it issues, generated on the peer so the refusal case presents a certificate
 * that is genuinely well formed and genuinely not Breev's. A malformed blob
 * would prove much less — a listener can refuse garbage without ever checking
 * an issuer.
 *
 * The private keys stay in the process that generated them. The harness never
 * writes a key it did not create, and never carries one between machines.
 */

import {
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto";

import {
  derAlgorithmIdentifier,
  derBitString,
  derBoolean,
  derContext,
  derInteger,
  derName,
  derObjectIdentifier,
  derOctetString,
  derSequence,
  derUtcTime,
  toPem,
} from "./der.mjs";

const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_EXTENDED_KEY_USAGE = "2.5.29.37";
const OID_CLIENT_AUTHENTICATION = "1.3.6.1.5.5.7.3.2";

const MODULUS_LENGTH = 2048;
const FOREIGN_VALIDITY_DAYS = 30;

/**
 * A terminal keypair. The SPKI bytes are kept because every pairing transcript
 * binds them, and the same bytes go into the certification request.
 */
export function createTerminalKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: MODULUS_LENGTH,
  });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
    spkiDer: publicKey.export({ format: "der", type: "spki" }),
  };
}

/**
 * The PKCS#10 request, with an empty attribute set. Breev chooses every
 * certified identity field itself, so the subject here is a label for a human
 * reading a packet capture and carries no authority at all.
 *
 * Mirrored from `apps/desktop/src/main/pairing-transcript.ts:128-159` and
 * checked by `apps/local-api/src/devices/pairing-csr.ts:46-108`: version 0,
 * O=Breev then CN=breev-terminal, RSA-2048 SPKI, empty attributes, and a
 * sha256WithRSAEncryption self-signature.
 */
export function buildCertificateRequest(keys, options = {}) {
  const info = derSequence(
    derInteger(0),
    derName([
      { oid: OID_ORGANIZATION, value: options.organization ?? "Breev" },
      { oid: OID_COMMON_NAME, value: options.commonName ?? "breev-terminal" },
    ]),
    keys.spkiDer,
    // [0] IMPLICIT SET OF Attribute, empty: the request asks for nothing.
    derContext(0, Buffer.alloc(0)),
  );
  const request = derSequence(
    info,
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    derBitString(sign("sha256", info, keys.privateKeyPem)),
  );
  return toPem("CERTIFICATE REQUEST", request);
}

/**
 * A complete foreign authority: a self-signed CA and a client leaf beneath it.
 *
 * The leaf is a certificate any TLS stack will present and any verifier will
 * parse. It fails at Breev's boundary for the one reason the proof is about —
 * the pharmacy CA did not issue it — rather than because it was unreadable.
 * This is the zero-dependency equivalent of the foreign-chain construction in
 * `apps/local-api/src/pharmacy-ca/pharmacy-ca.integration.test.ts:381-419`.
 */
export function createForeignAuthority(options = {}) {
  const now = options.now ?? new Date();
  const authorityKeys = createTerminalKeys();
  const leafKeys = createTerminalKeys();
  const authorityName = [
    { oid: OID_ORGANIZATION, value: "Foreign Authority" },
    {
      oid: OID_COMMON_NAME,
      value: options.authorityCommonName ?? "foreign-pharmacy-ca",
    },
  ];

  const authorityDer = signCertificate({
    extensions: [
      // A real CA: basic constraints say so, and key usage permits signing
      // certificates, so the leaf below chains to it correctly.
      extension(OID_BASIC_CONSTRAINTS, true, derSequence(derBoolean(true))),
      extension(OID_KEY_USAGE, true, derBitString(Buffer.of(0x06), 1)),
    ],
    issuerName: authorityName,
    issuerPrivateKeyPem: authorityKeys.privateKeyPem,
    now,
    subjectName: authorityName,
    subjectSpkiDer: authorityKeys.spkiDer,
    validityDays: options.validityDays ?? FOREIGN_VALIDITY_DAYS,
  });

  const leafDer = signCertificate({
    extensions: [
      extension(OID_BASIC_CONSTRAINTS, true, derSequence()),
      extension(OID_KEY_USAGE, true, derBitString(Buffer.of(0xa0), 5)),
      extension(
        OID_EXTENDED_KEY_USAGE,
        false,
        derSequence(derObjectIdentifier(OID_CLIENT_AUTHENTICATION)),
      ),
    ],
    issuerName: authorityName,
    issuerPrivateKeyPem: authorityKeys.privateKeyPem,
    now,
    subjectName: [
      { oid: OID_ORGANIZATION, value: "Foreign Authority" },
      {
        oid: OID_COMMON_NAME,
        value: options.leafCommonName ?? "foreign-terminal",
      },
    ],
    subjectSpkiDer: leafKeys.spkiDer,
    validityDays: options.validityDays ?? FOREIGN_VALIDITY_DAYS,
  });

  const certificatePem = toPem("CERTIFICATE", leafDer);
  return {
    authorityCertPem: toPem("CERTIFICATE", authorityDer),
    certificatePem,
    fingerprint256: fingerprintOf(certificatePem),
    privateKeyPem: leafKeys.privateKeyPem,
  };
}

/** The lowercase SHA-256 digest of a certificate, the way Breev records one. */
export function fingerprintOf(certificatePem) {
  return new X509Certificate(certificatePem).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
}

function signCertificate(params) {
  const notBefore = new Date(params.now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(
    params.now.getTime() + params.validityDays * 24 * 60 * 60 * 1000,
  );
  // A positive 16-byte serial: the high bit is cleared so the DER integer never
  // needs a padding byte and never reads as negative.
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = derSequence(
    // [0] EXPLICIT version, 2 meaning X.509 v3.
    derContext(0, derInteger(2)),
    derInteger(serial),
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    derName(params.issuerName),
    derSequence(derUtcTime(notBefore), derUtcTime(notAfter)),
    derName(params.subjectName),
    params.subjectSpkiDer,
    // [3] EXPLICIT Extensions.
    derContext(3, derSequence(...params.extensions)),
  );
  return derSequence(
    tbs,
    derAlgorithmIdentifier(OID_SHA256_WITH_RSA),
    derBitString(sign("sha256", tbs, params.issuerPrivateKeyPem)),
  );
}

function extension(oid, critical, value) {
  return derSequence(
    derObjectIdentifier(oid),
    ...(critical ? [derBoolean(true)] : []),
    derOctetString(value),
  );
}
