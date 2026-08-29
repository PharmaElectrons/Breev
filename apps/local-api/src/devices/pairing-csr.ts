import { AsnParser, AsnSerializer } from "@peculiar/asn1-schema";
import { CertificationRequest } from "@peculiar/asn1-csr";
import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * The terminal's certificate request, checked before Breev will certify
 * anything.
 *
 * Two independent signatures have to hold: the CSR's own self-signature, which
 * proves the request was assembled by the holder of the private key, and the
 * transcript signature, which proves that same holder is answering this
 * pairing session on this installation against this CA. Everything the CSR
 * *claims* — subject, requested extensions, attributes — is ignored. Breev
 * chooses every certified identity field itself, so a caller cannot ask to be
 * named something it is not.
 */

const OID_RSA_ENCRYPTION = "1.2.840.113549.1.1.1";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const REQUIRED_MODULUS_LENGTH = 2048;
const MAX_CSR_BYTES = 8 * 1024;

export interface AcceptedCertificationRequest {
  readonly publicKey: KeyObject;
  readonly spkiDer: Buffer;
  readonly spkiSha256: string;
}

export class CertificationRequestRejected extends Error {
  public constructor(public readonly reason: string) {
    super(`The certification request was rejected: ${reason}`);
    this.name = "CertificationRequestRejected";
  }
}

/**
 * Parses a PEM PKCS#10 request and returns the only thing Breev keeps from it:
 * the proposed public key. Any structural surprise is a rejection, never a
 * best-effort recovery.
 */
export function readCertificationRequest(
  csrPem: string,
): AcceptedCertificationRequest {
  const der = decodePem(csrPem);
  let request: CertificationRequest;
  try {
    request = AsnParser.parse(der, CertificationRequest, {
      berOptions: {
        maxContentLength: MAX_CSR_BYTES,
        maxDepth: 32,
        maxNodes: 512,
      },
    });
  } catch {
    throw new CertificationRequestRejected("malformed");
  }

  if (request.certificationRequestInfo.version !== 0) {
    throw new CertificationRequestRejected("unsupported-version");
  }
  if (request.signatureAlgorithm.algorithm !== OID_SHA256_WITH_RSA) {
    throw new CertificationRequestRejected("unsupported-signature-algorithm");
  }
  const spkiAlgorithm =
    request.certificationRequestInfo.subjectPKInfo.algorithm.algorithm;
  if (spkiAlgorithm !== OID_RSA_ENCRYPTION) {
    throw new CertificationRequestRejected("unsupported-key-algorithm");
  }

  const spkiDer = Buffer.from(
    AsnSerializer.serialize(request.certificationRequestInfo.subjectPKInfo),
  );
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({
      format: "der",
      key: spkiDer,
      type: "spki",
    });
  } catch {
    throw new CertificationRequestRejected("unreadable-public-key");
  }
  if (
    publicKey.asymmetricKeyDetails?.modulusLength !== REQUIRED_MODULUS_LENGTH
  ) {
    throw new CertificationRequestRejected("unsupported-key-size");
  }

  const signedBytes =
    request.certificationRequestInfoRaw === undefined
      ? Buffer.from(AsnSerializer.serialize(request.certificationRequestInfo))
      : Buffer.from(request.certificationRequestInfoRaw);
  if (
    !verifySignature(signedBytes, publicKey, Buffer.from(request.signature))
  ) {
    throw new CertificationRequestRejected("self-signature-invalid");
  }

  return {
    publicKey,
    spkiDer,
    spkiSha256: createHash("sha256").update(spkiDer).digest("hex"),
  };
}

/**
 * Verifies a transcript signature against a public key Breev already holds —
 * during a join it is the key inside the CSR, and during a certificate fetch it
 * is the key the session bound earlier.
 */
export function verifyTranscriptSignature(input: {
  readonly publicKey: KeyObject;
  readonly signature: Buffer;
  readonly transcript: Buffer;
}): boolean {
  return verifySignature(input.transcript, input.publicKey, input.signature);
}

export function readSubjectPublicKey(spkiDer: Buffer): KeyObject {
  return createPublicKey({ format: "der", key: spkiDer, type: "spki" });
}

function verifySignature(
  data: Buffer,
  publicKey: KeyObject,
  signature: Buffer,
): boolean {
  if (signature.length === 0 || signature.length > 1_024) {
    return false;
  }
  try {
    return verify("sha256", data, publicKey, signature);
  } catch {
    return false;
  }
}

function decodePem(csrPem: string): Buffer {
  if (Buffer.byteLength(csrPem, "utf8") > MAX_CSR_BYTES) {
    throw new CertificationRequestRejected("too-large");
  }
  const match =
    /^-----BEGIN CERTIFICATE REQUEST-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE REQUEST-----\s*$/u.exec(
      csrPem.trim(),
    );
  if (match?.[1] === undefined) {
    throw new CertificationRequestRejected("malformed");
  }
  const body = match[1].replace(/\s/gu, "");
  const der = Buffer.from(body, "base64");
  if (der.length === 0 || der.toString("base64") !== body) {
    throw new CertificationRequestRejected("malformed");
  }
  return der;
}
