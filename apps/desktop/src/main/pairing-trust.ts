import { AsnParser } from "@peculiar/asn1-schema";
import {
  BasicConstraints,
  Certificate,
  ExtendedKeyUsage,
  KeyUsage,
  KeyUsageFlags,
  SubjectAlternativeName,
  id_ce_basicConstraints,
  id_ce_extKeyUsage,
  id_ce_keyUsage,
  id_ce_subjectAltName,
  id_kp_serverAuth,
} from "@peculiar/asn1-x509";
import { X509Certificate, timingSafeEqual } from "node:crypto";

import { isUuidV7, pemEncode } from "./pairing-transcript.js";

const INSTALLATION_URI_PREFIX = "urn:breev:installation:";
const DEVICE_URI_PREFIX = "urn:breev:device:";
const DEVICE_TYPE_TERMINAL_URI = "urn:breev:device-type:terminal";
const MAXIMUM_CHAIN_LENGTH = 8;

export class PairingTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingTrustError";
  }
}

export interface PeerCertificateChainNode {
  readonly issuerCertificate?: PeerCertificateChainNode | undefined;
  readonly raw: Buffer;
}

export interface VerifiedPairingAuthority {
  readonly caCertificatePem: string;
  readonly caFingerprint: string;
}

/**
 * The invitation pins one certificate authority by fingerprint. Reading the
 * authority out of the presented chain and checking that pin is the only thing
 * that makes an unauthenticated first connection safe, so this runs before the
 * terminal writes a single application byte.
 */
export function verifyPairingServerChain(params: {
  readonly caFingerprint: string;
  readonly chain: readonly Buffer[];
  readonly installationId: string;
  readonly now?: Date | undefined;
}): VerifiedPairingAuthority {
  const now = params.now ?? new Date();
  if (params.chain.length < 2 || params.chain.length > MAXIMUM_CHAIN_LENGTH) {
    throw new PairingTrustError(
      "The Main installation did not present a leaf and its certificate authority",
    );
  }

  const certificates = params.chain.map((der) => parseX509(der));
  const leaf = certificates[0]!;
  const authority = certificates.at(-1)!;

  if (
    fingerprintOf(authority) !== params.caFingerprint ||
    !authority.ca ||
    !authority.verify(authority.publicKey) ||
    authority.subject !== authority.issuer
  ) {
    throw new PairingTrustError(
      "The Main installation certificate authority does not match the invitation pin",
    );
  }
  assertValidityWindow(authority, now);
  assertAuthorityProfile(authority, params.installationId);

  if (!leaf.checkIssued(authority) || !leaf.verify(authority.publicKey)) {
    throw new PairingTrustError(
      "The Main installation certificate was not issued by the pinned authority",
    );
  }
  assertValidityWindow(leaf, now);
  assertServerProfile(leaf, params.installationId);

  return {
    caCertificatePem: pemEncode("CERTIFICATE", Buffer.from(authority.raw)),
    caFingerprint: params.caFingerprint,
  };
}

/**
 * The bridge already restricts the trust store to the stored authority, so
 * this adds the two checks Node cannot make for us: the chain still ends at
 * the pinned authority and the leaf still names this installation.
 */
export function createPairingServerIdentityChecker(params: {
  readonly caFingerprint: string;
  readonly installationId: string;
  readonly now?: () => Date;
}): (hostname: string, peer: PeerCertificateChainNode) => Error | undefined {
  return (_hostname, peer) => {
    try {
      const chain = collectPeerChain(peer);
      const leaf = parseX509(chain[0]!);
      const authority = parseX509(chain.at(-1)!);
      if (
        chain.length > 1 &&
        fingerprintOf(authority) !== params.caFingerprint
      ) {
        return new PairingTrustError(
          "The Main installation chain no longer ends at the pinned certificate authority",
        );
      }
      assertValidityWindow(leaf, params.now?.() ?? new Date());
      assertServerProfile(leaf, params.installationId);
      return undefined;
    } catch (error) {
      return error instanceof Error
        ? error
        : new PairingTrustError(
            "The Main installation identity is not trusted",
          );
    }
  };
}

export interface VerifiedDeviceCertificate {
  readonly deviceId: string;
  readonly installationId: string;
}

/**
 * The issued certificate is accepted only when it belongs to the key this
 * device generated, chains to the pinned authority, and names the terminal
 * role for the expected installation.
 */
export function verifyIssuedDeviceCertificate(params: {
  readonly caCertificatePem: string;
  readonly caFingerprint: string;
  readonly certificatePem: string;
  readonly expectedInstallationId: string;
  readonly now?: Date | undefined;
  readonly subjectPublicKeyInfoDer: Buffer;
}): VerifiedDeviceCertificate {
  const now = params.now ?? new Date();
  const authority = parseX509(params.caCertificatePem);
  const certificate = parseX509(params.certificatePem);

  if (
    fingerprintOf(authority) !== params.caFingerprint ||
    !authority.ca ||
    !authority.verify(authority.publicKey)
  ) {
    throw new PairingTrustError(
      "The issued certificate authority does not match the invitation pin",
    );
  }
  assertValidityWindow(authority, now);
  assertAuthorityProfile(authority, params.expectedInstallationId);

  if (
    !certificate.checkIssued(authority) ||
    !certificate.verify(authority.publicKey)
  ) {
    throw new PairingTrustError(
      "The issued certificate was not signed by the pinned authority",
    );
  }
  assertValidityWindow(certificate, now);

  const presented = certificate.publicKey.export({
    format: "der",
    type: "spki",
  });
  if (
    presented.length !== params.subjectPublicKeyInfoDer.length ||
    !timingSafeEqual(presented, params.subjectPublicKeyInfoDer)
  ) {
    throw new PairingTrustError(
      "The issued certificate does not carry this device's public key",
    );
  }

  const names = subjectAlternativeNames(certificate);
  const installationId = singleUriSuffix(names, INSTALLATION_URI_PREFIX);
  const deviceId = singleUriSuffix(names, DEVICE_URI_PREFIX);
  if (
    installationId !== params.expectedInstallationId ||
    !isUuidV7(deviceId) ||
    !names.includes(DEVICE_TYPE_TERMINAL_URI)
  ) {
    throw new PairingTrustError(
      "The issued certificate does not identify this terminal",
    );
  }

  return { deviceId, installationId };
}

export function fingerprintOfCertificate(pem: string): string {
  return fingerprintOf(parseX509(pem));
}

export function collectPeerChain(
  peer: PeerCertificateChainNode,
): readonly Buffer[] {
  const chain: Buffer[] = [];
  const seen = new Set<string>();
  let node: PeerCertificateChainNode | undefined = peer;
  while (node !== undefined && chain.length < MAXIMUM_CHAIN_LENGTH) {
    const key = node.raw.toString("base64");
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    chain.push(node.raw);
    node = node.issuerCertificate;
  }
  if (chain.length === 0) {
    throw new PairingTrustError(
      "The Main installation presented no certificate",
    );
  }
  return chain;
}

function parseX509(input: Buffer | string): X509Certificate {
  try {
    return new X509Certificate(input);
  } catch {
    throw new PairingTrustError("A presented certificate is not readable");
  }
}

function fingerprintOf(certificate: X509Certificate): string {
  return certificate.fingerprint256.replaceAll(":", "").toLowerCase();
}

function assertValidityWindow(certificate: X509Certificate, now: Date): void {
  if (
    now < new Date(certificate.validFrom) ||
    now > new Date(certificate.validTo)
  ) {
    throw new PairingTrustError(
      "A presented certificate is outside its validity window",
    );
  }
}

function assertAuthorityProfile(
  certificate: X509Certificate,
  installationId: string,
): void {
  const parsed = parseCertificate(certificate);
  assertExtensionSet(parsed, [
    id_ce_basicConstraints,
    id_ce_keyUsage,
    id_ce_subjectAltName,
  ]);
  const constraints = parseExtension(
    parsed,
    id_ce_basicConstraints,
    BasicConstraints,
    true,
  );
  const usage = parseExtension(parsed, id_ce_keyUsage, KeyUsage, true);
  const names = subjectAlternativeNames(certificate);
  if (
    !constraints.cA ||
    constraints.pathLenConstraint !== 0 ||
    usage.toNumber() !== (KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign) ||
    names.length !== 1 ||
    names[0] !== `${INSTALLATION_URI_PREFIX}${installationId}`
  ) {
    throw new PairingTrustError(
      "The presented certificate authority does not match the Breev profile",
    );
  }
}

function assertServerProfile(
  certificate: X509Certificate,
  installationId: string,
): void {
  const parsed = parseCertificate(certificate);
  assertExtensionSet(parsed, [
    id_ce_basicConstraints,
    id_ce_keyUsage,
    id_ce_extKeyUsage,
    id_ce_subjectAltName,
  ]);
  const constraints = parseExtension(
    parsed,
    id_ce_basicConstraints,
    BasicConstraints,
    true,
  );
  const usage = parseExtension(parsed, id_ce_keyUsage, KeyUsage, true);
  const extendedUsage = parseExtension(
    parsed,
    id_ce_extKeyUsage,
    ExtendedKeyUsage,
    true,
  );
  if (
    constraints.cA ||
    usage.toNumber() !==
      (KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment) ||
    extendedUsage.length !== 1 ||
    extendedUsage[0] !== id_kp_serverAuth
  ) {
    throw new PairingTrustError(
      "The Main installation certificate does not carry the server role",
    );
  }
  if (
    singleUriSuffix(
      subjectAlternativeNames(certificate),
      INSTALLATION_URI_PREFIX,
    ) !== installationId
  ) {
    throw new PairingTrustError(
      "The Main installation certificate names another installation",
    );
  }
}

function subjectAlternativeNames(
  certificate: X509Certificate,
): readonly string[] {
  const parsed = parseCertificate(certificate);
  const names = parseExtension(
    parsed,
    id_ce_subjectAltName,
    SubjectAlternativeName,
  );
  return names
    .map((name) => name.uniformResourceIdentifier)
    .filter((uri): uri is string => uri !== undefined);
}

function singleUriSuffix(names: readonly string[], prefix: string): string {
  const matching = names.filter((name) => name.startsWith(prefix));
  if (matching.length !== 1) {
    throw new PairingTrustError(
      `A presented certificate does not carry exactly one ${prefix} name`,
    );
  }
  return matching[0]!.slice(prefix.length);
}

function parseCertificate(certificate: X509Certificate): Certificate {
  return AsnParser.parse(Buffer.from(certificate.raw), Certificate, {
    berOptions: { maxContentLength: 64 * 1024, maxDepth: 32, maxNodes: 512 },
  });
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
    throw new PairingTrustError(
      `A presented certificate extension ${oid} is missing or duplicated`,
    );
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
    throw new PairingTrustError(
      "A presented certificate does not match the expected extension profile",
    );
  }
}
