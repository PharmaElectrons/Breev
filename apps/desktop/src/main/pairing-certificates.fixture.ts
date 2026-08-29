import { AsnSerializer, AsnParser, OctetString } from "@peculiar/asn1-schema";
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  BasicConstraints,
  Certificate,
  ExtendedKeyUsage,
  Extension,
  Extensions,
  GeneralName,
  KeyUsage,
  KeyUsageFlags,
  Name,
  RelativeDistinguishedName,
  SubjectAlternativeName,
  SubjectPublicKeyInfo,
  TBSCertificate,
  Validity,
  Version,
  id_ce_basicConstraints,
  id_ce_extKeyUsage,
  id_ce_keyUsage,
  id_ce_subjectAltName,
  id_kp_clientAuth,
  id_kp_serverAuth,
} from "@peculiar/asn1-x509";
import {
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from "node:crypto";

import { pemEncode } from "./pairing-transcript.js";

/**
 * Test-only certificates that follow the same Breev profiles the pharmacy
 * certificate authority issues, so the trust checks are exercised against
 * realistic material rather than a relaxed fake.
 */

/**
 * A serial that DER-encodes as a positive INTEGER without padding, matching
 * the rule the pharmacy CA applies: high bit clear, first byte nonzero. A raw
 * random first byte intermittently breaks certificate round-tripping.
 */
function fixtureSerial(): Buffer {
  let serial: Buffer;
  do {
    serial = randomBytes(8);
    serial[0] = (serial[0] ?? 0) & 0x7f;
  } while (serial[0] === 0);
  return serial;
}

const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";

export interface FixtureCertificate {
  readonly der: Buffer;
  readonly fingerprint: string;
  readonly pem: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

export function createFixtureAuthority(params: {
  readonly installationId: string;
  readonly notAfter?: Date;
  readonly notBefore?: Date;
}): FixtureCertificate {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const subject = fixtureName("breev-pharmacy-ca");
  const tbs = new TBSCertificate({
    extensions: new Extensions([
      fixtureExtension(
        id_ce_basicConstraints,
        new BasicConstraints({ cA: true, pathLenConstraint: 0 }),
        true,
      ),
      fixtureExtension(
        id_ce_keyUsage,
        new KeyUsage(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign),
        true,
      ),
      fixtureExtension(
        id_ce_subjectAltName,
        new SubjectAlternativeName([
          new GeneralName({
            uniformResourceIdentifier: `urn:breev:installation:${params.installationId}`,
          }),
        ]),
      ),
    ]),
    issuer: subject,
    serialNumber: toArrayBuffer(fixtureSerial()),
    signature: fixtureSignatureAlgorithm(),
    subject,
    subjectPublicKeyInfo: parseSpki(keys.publicKey),
    validity: fixtureValidity(params.notBefore, params.notAfter),
    version: Version.v3,
  });
  return finish(tbs, keys.privateKey, keys);
}

export function createFixtureServerCertificate(params: {
  readonly authority: FixtureCertificate;
  readonly installationId: string;
  readonly notAfter?: Date;
  readonly notBefore?: Date;
}): FixtureCertificate {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const tbs = new TBSCertificate({
    extensions: new Extensions([
      fixtureExtension(
        id_ce_basicConstraints,
        new BasicConstraints({ cA: false }),
        true,
      ),
      fixtureExtension(
        id_ce_keyUsage,
        new KeyUsage(
          KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
        ),
        true,
      ),
      fixtureExtension(
        id_ce_extKeyUsage,
        new ExtendedKeyUsage([id_kp_serverAuth]),
        true,
      ),
      fixtureExtension(
        id_ce_subjectAltName,
        new SubjectAlternativeName([
          new GeneralName({ iPAddress: "127.0.0.1" }),
          new GeneralName({
            uniformResourceIdentifier: `urn:breev:installation:${params.installationId}`,
          }),
        ]),
      ),
    ]),
    issuer: issuerOf(params.authority),
    serialNumber: toArrayBuffer(fixtureSerial()),
    signature: fixtureSignatureAlgorithm(),
    subject: fixtureName(`breev-server-${params.installationId}`),
    subjectPublicKeyInfo: parseSpki(keys.publicKey),
    validity: fixtureValidity(params.notBefore, params.notAfter),
    version: Version.v3,
  });
  return finish(tbs, params.authority.privateKey, keys);
}

export function createFixtureDeviceCertificate(params: {
  readonly authority: FixtureCertificate;
  readonly deviceId: string;
  readonly devicePublicKey: KeyObject;
  readonly installationId: string;
  readonly licenceId: string;
  readonly notAfter?: Date;
  readonly notBefore?: Date;
  readonly pharmacyId: string;
}): Omit<FixtureCertificate, "privateKey" | "publicKey"> {
  const tbs = new TBSCertificate({
    extensions: new Extensions([
      fixtureExtension(
        id_ce_basicConstraints,
        new BasicConstraints({ cA: false }),
        true,
      ),
      fixtureExtension(
        id_ce_keyUsage,
        new KeyUsage(KeyUsageFlags.digitalSignature),
        true,
      ),
      fixtureExtension(
        id_ce_extKeyUsage,
        new ExtendedKeyUsage([id_kp_clientAuth]),
        true,
      ),
      fixtureExtension(
        id_ce_subjectAltName,
        new SubjectAlternativeName(
          [
            `urn:breev:installation:${params.installationId}`,
            `urn:breev:device:${params.deviceId}`,
            `urn:breev:pharmacy:${params.pharmacyId}`,
            "urn:breev:device-type:terminal",
            `urn:breev:licence:${params.licenceId}`,
          ].map((uri) => new GeneralName({ uniformResourceIdentifier: uri })),
        ),
      ),
    ]),
    issuer: issuerOf(params.authority),
    serialNumber: toArrayBuffer(fixtureSerial()),
    signature: fixtureSignatureAlgorithm(),
    subject: fixtureName(`breev-device-${params.deviceId}`),
    subjectPublicKeyInfo: AsnParser.parse(
      params.devicePublicKey.export({ format: "der", type: "spki" }),
      SubjectPublicKeyInfo,
    ),
    validity: fixtureValidity(params.notBefore, params.notAfter),
    version: Version.v3,
  });
  const der = signTbs(tbs, params.authority.privateKey);
  const pem = pemEncode("CERTIFICATE", der);
  return { der, fingerprint: fingerprintOf(pem), pem };
}

function finish(
  tbs: TBSCertificate,
  signingKey: KeyObject,
  keys: { privateKey: KeyObject; publicKey: KeyObject },
): FixtureCertificate {
  const der = signTbs(tbs, signingKey);
  const pem = pemEncode("CERTIFICATE", der);
  return {
    der,
    fingerprint: fingerprintOf(pem),
    pem,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
  };
}

function signTbs(tbs: TBSCertificate, signingKey: KeyObject): Buffer {
  const tbsDer = Buffer.from(AsnSerializer.serialize(tbs));
  return Buffer.from(
    AsnSerializer.serialize(
      new Certificate({
        signatureAlgorithm: fixtureSignatureAlgorithm(),
        signatureValue: toArrayBuffer(sign("sha256", tbsDer, signingKey)),
        tbsCertificate: tbs,
      }),
    ),
  );
}

function issuerOf(authority: FixtureCertificate): Name {
  return AsnParser.parse(authority.der, Certificate).tbsCertificate.subject;
}

function fingerprintOf(pem: string): string {
  return new X509Certificate(pem).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
}

function fixtureValidity(notBefore?: Date, notAfter?: Date): Validity {
  return new Validity({
    notAfter: notAfter ?? new Date(Date.now() + 365 * 86_400_000),
    notBefore: notBefore ?? new Date(Date.now() - 60_000),
  });
}

function fixtureSignatureAlgorithm(): AlgorithmIdentifier {
  return new AlgorithmIdentifier({
    algorithm: OID_SHA256_WITH_RSA,
    parameters: null,
  });
}

function fixtureExtension(
  oid: string,
  value: unknown,
  critical = false,
): Extension {
  return new Extension({
    critical,
    extnID: oid,
    extnValue: new OctetString(AsnSerializer.serialize(value)),
  });
}

function fixtureName(commonName: string): Name {
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
        value: new AttributeValue({ utf8String: commonName }),
      }),
    ]),
  ]);
}

function parseSpki(publicKey: KeyObject): SubjectPublicKeyInfo {
  return AsnParser.parse(
    publicKey.export({ format: "der", type: "spki" }),
    SubjectPublicKeyInfo,
  );
}

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}
