import { AsnParser, AsnSerializer, OctetString } from "@peculiar/asn1-schema";
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
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import { isIP } from "node:net";

import type { CngKeyHandle } from "./cng-addon.js";
import { signData } from "./cng-addon.js";

const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const INSTALLATION_URI_PREFIX = "urn:breev:installation:";
const DEVICE_URI_PREFIX = "urn:breev:device:";
const LICENCE_URI_PREFIX = "urn:breev:licence:";
const PHARMACY_URI_PREFIX = "urn:breev:pharmacy:";
/**
 * The only device type Breev certifies today. It is a full URI rather than a
 * bare word so a future type can never be confused with a device identifier.
 */
const TERMINAL_DEVICE_TYPE_URI = "urn:breev:device-type:terminal";
const DEVICE_SUBJECT_NAME_COUNT = 5;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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

export function buildCACertificate(params: {
  readonly keyHandle: CngKeyHandle;
  readonly publicKeyDer: Buffer;
  readonly installationId: string;
  readonly validityDays: number;
}): IssuedCertificate {
  assertUuidV7(params.installationId, "installationId");
  const notBefore = new Date(Date.now() - 60_000);
  const notAfter = validityEnd(notBefore, params.validityDays);
  const subject = certificateName("breev-pharmacy-ca");
  const serial = createCertificateSerial();
  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: toArrayBuffer(serial),
    signature: signatureAlgorithm(),
    issuer: subject,
    validity: new Validity({ notBefore, notAfter }),
    subject,
    subjectPublicKeyInfo: parsePublicKey(params.publicKeyDer),
    extensions: new Extensions([
      extension(
        id_ce_basicConstraints,
        new BasicConstraints({ cA: true, pathLenConstraint: 0 }),
        true,
      ),
      extension(
        id_ce_keyUsage,
        new KeyUsage(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign),
        true,
      ),
      extension(
        id_ce_subjectAltName,
        new SubjectAlternativeName([
          new GeneralName({
            uniformResourceIdentifier: installationUri(params.installationId),
          }),
        ]),
      ),
    ]),
  });

  return signCertificate(tbs, params.keyHandle, notBefore, notAfter, serial);
}

export function buildServerCertificate(params: {
  readonly caKeyHandle: CngKeyHandle;
  readonly caCertPem: string;
  readonly installationId: string;
  readonly sanIPs: readonly string[];
  readonly validityDays: number;
}): IssuedLeafCertificate {
  assertUuidV7(params.installationId, "installationId");
  if (
    params.sanIPs.length === 0 ||
    params.sanIPs.some((ip) => isIP(ip) === 0)
  ) {
    throw new Error("A server certificate requires valid IP subject names");
  }

  const notBefore = new Date(Date.now() - 60_000);
  const notAfter = validityEnd(notBefore, params.validityDays);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const serial = createCertificateSerial();
  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: toArrayBuffer(serial),
    signature: signatureAlgorithm(),
    issuer: parseCertificate(params.caCertPem).tbsCertificate.subject,
    validity: new Validity({ notBefore, notAfter }),
    subject: certificateName(`breev-server-${params.installationId}`),
    subjectPublicKeyInfo: parsePublicKey(
      publicKey.export({ format: "der", type: "spki" }),
    ),
    extensions: new Extensions([
      extension(
        id_ce_basicConstraints,
        new BasicConstraints({ cA: false }),
        true,
      ),
      extension(
        id_ce_keyUsage,
        new KeyUsage(
          KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
        ),
        true,
      ),
      extension(
        id_ce_extKeyUsage,
        new ExtendedKeyUsage([id_kp_serverAuth]),
        true,
      ),
      extension(
        id_ce_subjectAltName,
        new SubjectAlternativeName([
          ...params.sanIPs.map((ip) => new GeneralName({ iPAddress: ip })),
          new GeneralName({
            uniformResourceIdentifier: installationUri(params.installationId),
          }),
        ]),
      ),
    ]),
  });
  const issued = signCertificate(
    tbs,
    params.caKeyHandle,
    notBefore,
    notAfter,
    serial,
  );

  return {
    ...issued,
    privateKeyPem: privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
  };
}

/**
 * A terminal device certificate. Its subject names bind the five facts that
 * make the certificate meaningful offline: which installation issued it, which
 * device it is, which pharmacy it belongs to, that it is a terminal rather than
 * anything else, and which licence paid for its seat. The random serial is the
 * sixth. None of them come from the caller's certificate request.
 */
export function buildDeviceCertificate(params: {
  readonly caKeyHandle: CngKeyHandle;
  readonly caCertPem: string;
  readonly deviceId: string;
  readonly devicePublicKeyDer: Buffer;
  readonly installationId: string;
  readonly licenceId: string;
  readonly pharmacyId: string;
  readonly validityDays: number;
}): IssuedCertificate {
  assertUuidV7(params.deviceId, "deviceId");
  assertUuidV7(params.installationId, "installationId");
  assertUuidV7(params.licenceId, "licenceId");
  assertUuidV7(params.pharmacyId, "pharmacyId");
  const notBefore = new Date(Date.now() - 60_000);
  const notAfter = validityEnd(notBefore, params.validityDays);
  const serial = createCertificateSerial();
  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: toArrayBuffer(serial),
    signature: signatureAlgorithm(),
    issuer: parseCertificate(params.caCertPem).tbsCertificate.subject,
    validity: new Validity({ notBefore, notAfter }),
    subject: certificateName(`breev-device-${params.deviceId}`),
    subjectPublicKeyInfo: parsePublicKey(params.devicePublicKeyDer),
    extensions: new Extensions([
      extension(
        id_ce_basicConstraints,
        new BasicConstraints({ cA: false }),
        true,
      ),
      extension(
        id_ce_keyUsage,
        new KeyUsage(KeyUsageFlags.digitalSignature),
        true,
      ),
      extension(
        id_ce_extKeyUsage,
        new ExtendedKeyUsage([id_kp_clientAuth]),
        true,
      ),
      extension(
        id_ce_subjectAltName,
        new SubjectAlternativeName([
          new GeneralName({
            uniformResourceIdentifier: installationUri(params.installationId),
          }),
          new GeneralName({
            uniformResourceIdentifier: deviceUri(params.deviceId),
          }),
          new GeneralName({
            uniformResourceIdentifier: pharmacyUri(params.pharmacyId),
          }),
          new GeneralName({
            uniformResourceIdentifier: TERMINAL_DEVICE_TYPE_URI,
          }),
          new GeneralName({
            uniformResourceIdentifier: licenceUri(params.licenceId),
          }),
        ]),
      ),
    ]),
  });

  return signCertificate(tbs, params.caKeyHandle, notBefore, notAfter, serial);
}

export function validateCertificate(params: {
  readonly certDer: Buffer;
  readonly caCertPem: string;
  readonly expectedRole: CertRole;
  readonly installationId: string;
  readonly expectedServerIp?: string | undefined;
  readonly now?: Date | undefined;
}): CertValidationResult {
  const now = params.now ?? new Date();
  let cert: X509Certificate;
  let caCert: X509Certificate;
  let parsed: Certificate;
  let parsedCa: Certificate;
  try {
    cert = new X509Certificate(params.certDer);
    caCert = new X509Certificate(params.caCertPem);
    parsed = parseCertificate(params.certDer);
    parsedCa = parseCertificate(params.caCertPem);
  } catch {
    return invalid("mtls-cert-invalid");
  }

  if (now < new Date(cert.validFrom)) {
    return invalid("cert-not-yet-valid");
  }
  if (now > new Date(cert.validTo)) {
    return invalid("cert-expired");
  }
  if (
    now < new Date(caCert.validFrom) ||
    now > new Date(caCert.validTo) ||
    !caCert.ca ||
    !caCert.verify(caCert.publicKey) ||
    !cert.checkIssued(caCert) ||
    !cert.verify(caCert.publicKey)
  ) {
    return invalid("cert-chain-invalid");
  }

  try {
    assertCaExtensions(parsedCa, params.installationId);
    const role = certificateRole(parsed);
    if (role !== params.expectedRole) {
      return invalid("cert-role-mismatch");
    }
    const names = subjectAlternativeNames(parsed);
    const expectedInstallationUri = installationUri(params.installationId);
    if (!hasSingleUri(names, expectedInstallationUri)) {
      return invalid("cert-installation-mismatch");
    }
    if (role === "server") {
      if (
        params.expectedServerIp === undefined ||
        names.length < 2 ||
        names.some(
          (name) =>
            name.uniformResourceIdentifier !== expectedInstallationUri &&
            name.iPAddress === undefined,
        ) ||
        cert.checkIP(params.expectedServerIp) === undefined
      ) {
        return invalid("mtls-cert-invalid");
      }
      return valid(role, undefined, cert);
    }

    // A device certificate carries exactly five subject names. Anything more,
    // anything fewer, or anything shaped differently is refused rather than
    // interpreted: the name set is the offline statement of who this device is.
    const deviceIds = uriSuffixes(names, DEVICE_URI_PREFIX);
    const pharmacyIds = uriSuffixes(names, PHARMACY_URI_PREFIX);
    const licenceIds = uriSuffixes(names, LICENCE_URI_PREFIX);
    const deviceId = deviceIds[0];
    if (
      names.length !== DEVICE_SUBJECT_NAME_COUNT ||
      deviceIds.length !== 1 ||
      pharmacyIds.length !== 1 ||
      licenceIds.length !== 1 ||
      deviceId === undefined ||
      !UUID_V7_PATTERN.test(deviceId) ||
      !UUID_V7_PATTERN.test(pharmacyIds[0] ?? "") ||
      !UUID_V7_PATTERN.test(licenceIds[0] ?? "") ||
      !hasSingleUri(names, TERMINAL_DEVICE_TYPE_URI)
    ) {
      return invalid("mtls-cert-invalid");
    }
    return valid(role, deviceId, cert);
  } catch {
    return invalid("mtls-cert-invalid");
  }
}

export function caCertificateMatches(params: {
  readonly certPem: string;
  readonly fingerprint: string;
  readonly installationId: string;
  readonly publicKeyDer: Buffer;
}): boolean {
  try {
    const cert = new X509Certificate(params.certPem);
    const parsed = parseCertificate(params.certPem);
    const certificatePublicKey = cert.publicKey.export({
      format: "der",
      type: "spki",
    });
    const expectedFingerprint = cert.fingerprint256
      .replace(/:/g, "")
      .toLowerCase();
    assertCaExtensions(parsed, params.installationId);
    return (
      cert.ca &&
      cert.verify(cert.publicKey) &&
      expectedFingerprint === params.fingerprint &&
      certificatePublicKey.length === params.publicKeyDer.length &&
      timingSafeEqual(certificatePublicKey, params.publicKeyDer)
    );
  } catch {
    return false;
  }
}

function signCertificate(
  tbs: TBSCertificate,
  keyHandle: CngKeyHandle,
  notBefore: Date,
  notAfter: Date,
  serial: Buffer,
): IssuedCertificate {
  const tbsDer = Buffer.from(AsnSerializer.serialize(tbs));
  const signature = signData(keyHandle, tbsDer, { algorithm: "SHA256" });
  const certDer = Buffer.from(
    AsnSerializer.serialize(
      new Certificate({
        tbsCertificate: tbs,
        signatureAlgorithm: signatureAlgorithm(),
        signatureValue: toArrayBuffer(signature),
      }),
    ),
  );
  const certPem = pemEncodeCert(certDer);
  const cert = new X509Certificate(certPem);
  if (cert.subject === cert.issuer && !cert.verify(cert.publicKey)) {
    throw new Error("The generated self-signed certificate is invalid");
  }
  return {
    certPem,
    fingerprint: cert.fingerprint256.replace(/:/g, "").toLowerCase(),
    notBefore,
    notAfter,
    serialHex: serial.toString("hex"),
  };
}

function assertCaExtensions(
  certificate: Certificate,
  installationId: string,
): void {
  assertExtensionSet(certificate, [
    id_ce_basicConstraints,
    id_ce_keyUsage,
    id_ce_subjectAltName,
  ]);
  const constraints = parseExtension(
    certificate,
    id_ce_basicConstraints,
    BasicConstraints,
    true,
  );
  const usage = parseExtension(certificate, id_ce_keyUsage, KeyUsage, true);
  const names = subjectAlternativeNames(certificate);
  if (
    !constraints.cA ||
    constraints.pathLenConstraint !== 0 ||
    usage.toNumber() !== (KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign) ||
    names.length !== 1 ||
    !hasSingleUri(names, installationUri(installationId))
  ) {
    throw new Error("The pharmacy CA certificate does not match its state");
  }
}

function certificateRole(certificate: Certificate): CertRole | null {
  assertExtensionSet(certificate, [
    id_ce_basicConstraints,
    id_ce_keyUsage,
    id_ce_extKeyUsage,
    id_ce_subjectAltName,
  ]);
  const constraints = parseExtension(
    certificate,
    id_ce_basicConstraints,
    BasicConstraints,
    true,
  );
  const usage = parseExtension(certificate, id_ce_keyUsage, KeyUsage, true);
  const eku = parseExtension(
    certificate,
    id_ce_extKeyUsage,
    ExtendedKeyUsage,
    true,
  );
  if (constraints.cA || (usage.toNumber() & KeyUsageFlags.keyCertSign) !== 0) {
    return null;
  }
  if (
    eku.length === 1 &&
    eku[0] === id_kp_serverAuth &&
    usage.toNumber() ===
      (KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment)
  ) {
    return "server";
  }
  if (
    eku.length === 1 &&
    eku[0] === id_kp_clientAuth &&
    usage.toNumber() === KeyUsageFlags.digitalSignature
  ) {
    return "device";
  }
  return null;
}

function subjectAlternativeNames(
  certificate: Certificate,
): SubjectAlternativeName {
  return parseExtension(
    certificate,
    id_ce_subjectAltName,
    SubjectAlternativeName,
  );
}

function parseExtension<T>(
  certificate: Certificate,
  oid: string,
  type: new () => T,
  critical = false,
): T {
  const matching = certificate.tbsCertificate.extensions?.filter(
    (item) => item.extnID === oid,
  );
  if (matching?.length !== 1 || matching[0]?.critical !== critical) {
    throw new Error(`Certificate extension ${oid} is missing or duplicated`);
  }
  return AsnParser.parse(matching[0]!.extnValue.buffer, type);
}

function assertExtensionSet(
  certificate: Certificate,
  expectedOids: readonly string[],
): void {
  const extensions = certificate.tbsCertificate.extensions ?? [];
  if (
    extensions.length !== expectedOids.length ||
    expectedOids.some(
      (oid) =>
        extensions.filter((extension) => extension.extnID === oid).length !== 1,
    )
  ) {
    throw new Error("Certificate extensions do not match the expected profile");
  }
}

function hasSingleUri(
  names: SubjectAlternativeName,
  expected: string,
): boolean {
  const matches = names.filter(
    (name) => name.uniformResourceIdentifier === expected,
  );
  return matches.length === 1;
}

function extension(oid: string, value: unknown, critical = false): Extension {
  return new Extension({
    extnID: oid,
    critical,
    extnValue: new OctetString(AsnSerializer.serialize(value)),
  });
}

function certificateName(commonName: string): Name {
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

function parsePublicKey(publicKeyDer: Buffer): SubjectPublicKeyInfo {
  return AsnParser.parse(publicKeyDer, SubjectPublicKeyInfo);
}

function parseCertificate(input: Buffer | string): Certificate {
  const der =
    typeof input === "string"
      ? Buffer.from(
          input.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
          "base64",
        )
      : input;
  return AsnParser.parse(der, Certificate, {
    berOptions: {
      maxDepth: 32,
      maxNodes: 512,
      maxContentLength: 64 * 1024,
    },
  });
}

function signatureAlgorithm(): AlgorithmIdentifier {
  return new AlgorithmIdentifier({
    algorithm: OID_SHA256_WITH_RSA,
    parameters: null,
  });
}

function createCertificateSerial(): Buffer {
  let serial: Buffer;
  do {
    serial = randomBytes(16);
    serial[0] = (serial[0] ?? 0) & 0x7f;
  } while (serial[0] === 0);
  return serial;
}

function validityEnd(notBefore: Date, validityDays: number): Date {
  const notAfter = new Date(notBefore.getTime() + validityDays * 86_400_000);
  if (notAfter.getTime() === notBefore.getTime()) {
    throw new Error("Certificate validity must not be empty");
  }
  return notAfter;
}

function installationUri(installationId: string): string {
  return `${INSTALLATION_URI_PREFIX}${installationId}`;
}

function deviceUri(deviceId: string): string {
  return `${DEVICE_URI_PREFIX}${deviceId}`;
}

function licenceUri(licenceId: string): string {
  return `${LICENCE_URI_PREFIX}${licenceId}`;
}

function pharmacyUri(pharmacyId: string): string {
  return `${PHARMACY_URI_PREFIX}${pharmacyId}`;
}

function uriSuffixes(names: SubjectAlternativeName, prefix: string): string[] {
  return names
    .map((name) => name.uniformResourceIdentifier)
    .filter((uri): uri is string => uri !== undefined && uri.startsWith(prefix))
    .map((uri) => uri.slice(prefix.length));
}

function assertUuidV7(value: string, name: string): void {
  if (!UUID_V7_PATTERN.test(value)) {
    throw new Error(`${name} must be an RFC 9562 UUIDv7`);
  }
}

function pemEncodeCert(der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function invalid(
  denialCode: CertValidationFailure["denialCode"],
): CertValidationFailure {
  return { valid: false, denialCode };
}

function valid(
  role: CertRole,
  deviceId: string | undefined,
  cert: X509Certificate,
): CertValidationSuccess {
  return {
    valid: true,
    role,
    deviceId,
    fingerprint: cert.fingerprint256.replace(/:/g, "").toLowerCase(),
  };
}
