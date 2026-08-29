import {
  Attributes,
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
import {
  PAIRING_FINGERPRINT_DIGITS,
  PAIRING_INVITATION_PREFIX,
} from "@breev/contracts/local-rest";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import https from "node:https";
import { connect, type DetailedPeerCertificate } from "node:tls";

/**
 * The Additional POS Terminal, played by the test.
 *
 * The Main-side pairing screen can only be proven against a terminal that
 * really generates a keypair, really pins the pharmacy authority out of the
 * invitation before it sends anything, really proves possession of its key over
 * the LAN TLS channel, and really derives the twelve comparison digits. This
 * module is that terminal, written from the interface contract rather than from
 * the desktop implementation, so the digits the screen shows are checked
 * against digits an independent implementation computed.
 */
const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";

const FINGERPRINT_MODULUS = 10n ** BigInt(PAIRING_FINGERPRINT_DIGITS);
const HANDSHAKE_TIMEOUT_MS = 10_000;

const TRANSCRIPT_LABELS = {
  fetch: "breev-pairing-fetch-v1",
  fingerprint: "breev-pairing-fingerprint-v1",
  join: "breev-pairing-join-v1",
} as const;

export interface TerminalKeys {
  readonly privateKeyPem: string;
  readonly spkiDer: Buffer;
}

export interface PairingInvitation {
  readonly caFingerprint: string;
  readonly host: string;
  readonly installationId: string;
  readonly joinSecret: string;
  readonly port: number;
  readonly sessionId: string;
}

export interface PairingResponse {
  readonly body: Record<string, unknown>;
  readonly statusCode: number;
}

export function createTerminalKeys(): TerminalKeys {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
  });
  return {
    privateKeyPem: privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
    spkiDer: publicKey.export({ format: "der", type: "spki" }) as Buffer,
  };
}

export function buildCertificateRequest(keys: TerminalKeys): string {
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
      toArrayBuffer(keys.spkiDer),
      SubjectPublicKeyInfo,
    ),
    attributes: new Attributes([]),
  });
  const infoDer = Buffer.from(AsnSerializer.serialize(info));
  const request = new CertificationRequest({
    certificationRequestInfo: info,
    signature: toArrayBuffer(sign("sha256", infoDer, privateKeyOf(keys))),
    signatureAlgorithm: new AlgorithmIdentifier({
      algorithm: OID_SHA256_WITH_RSA,
      parameters: null,
    }),
  });
  return toPem(
    "CERTIFICATE REQUEST",
    Buffer.from(AsnSerializer.serialize(request)),
  );
}

export function decodePairingInvitation(uri: string): PairingInvitation {
  if (!uri.startsWith(PAIRING_INVITATION_PREFIX)) {
    throw new Error(`Not a Breev pairing invitation: ${uri}`);
  }
  const decoded: unknown = JSON.parse(
    Buffer.from(
      uri.slice(PAIRING_INVITATION_PREFIX.length),
      "base64url",
    ).toString("utf8"),
  );
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("The pairing invitation payload is not an object");
  }
  const payload = decoded as Record<string, unknown>;
  return {
    caFingerprint: requireString(payload.f, "caFingerprint"),
    host: requireString(payload.h, "host"),
    installationId: requireString(payload.i, "installationId"),
    joinSecret: requireString(payload.k, "joinSecret"),
    port: requireNumber(payload.p, "port"),
    sessionId: requireString(payload.s, "sessionId"),
  };
}

export function buildJoinTranscript(input: {
  readonly caFingerprint: string;
  readonly installationId: string;
  readonly sessionId: string;
  readonly spkiDer: Buffer;
}): Buffer {
  return concatTranscript(TRANSCRIPT_LABELS.join, [
    uuidToBytes(input.sessionId),
    uuidToBytes(input.installationId),
    Buffer.from(input.caFingerprint, "hex"),
    input.spkiDer,
  ]);
}

export function buildFetchTranscript(input: {
  readonly installationId: string;
  readonly sessionId: string;
  readonly spkiDer: Buffer;
}): Buffer {
  return concatTranscript(TRANSCRIPT_LABELS.fetch, [
    uuidToBytes(input.sessionId),
    uuidToBytes(input.installationId),
    input.spkiDer,
  ]);
}

export function buildFingerprintTranscript(input: {
  readonly caFingerprint: string;
  readonly installationId: string;
  readonly sessionId: string;
  readonly spkiDer: Buffer;
}): Buffer {
  return concatTranscript(TRANSCRIPT_LABELS.fingerprint, [
    uuidToBytes(input.sessionId),
    uuidToBytes(input.installationId),
    Buffer.from(input.caFingerprint, "hex"),
    input.spkiDer,
  ]);
}

/** Twelve decimal digits, derived exactly as both screens derive them. */
export function deriveFingerprintDigits(transcript: Buffer): string {
  const digest = createHash("sha256").update(transcript).digest();
  return (
    BigInt(`0x${digest.subarray(0, 8).toString("hex")}`) % FINGERPRINT_MODULUS
  )
    .toString(10)
    .padStart(PAIRING_FINGERPRINT_DIGITS, "0");
}

export function signTranscript(transcript: Buffer, keys: TerminalKeys): string {
  return sign("sha256", transcript, privateKeyOf(keys)).toString("base64");
}

/**
 * The one unauthenticated connection. It sends no application data: the
 * terminal reads the chain the LAN listener presents, keeps the authority whose
 * SHA-256 digest equals the pin inside the invitation, and drops the socket.
 */
export async function readPinnedAuthority(
  invitation: PairingInvitation,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connect({
      host: invitation.host,
      port: invitation.port,
      rejectUnauthorized: false,
      timeout: HANDSHAKE_TIMEOUT_MS,
    });
    const settle = (error: Error | undefined, value?: string): void => {
      socket.destroy();
      if (error === undefined && value !== undefined) {
        resolve(value);
        return;
      }
      reject(error ?? new Error("The pairing handshake produced no authority"));
    };
    socket.once("secureConnect", () => {
      try {
        const authority = collectChain(socket.getPeerCertificate(true)).find(
          (certificate) =>
            createHash("sha256").update(certificate).digest("hex") ===
            invitation.caFingerprint,
        );
        if (authority === undefined) {
          throw new Error(
            "The presented chain does not carry the pinned pharmacy authority",
          );
        }
        settle(undefined, toPem("CERTIFICATE", authority));
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once("timeout", () =>
      settle(new Error("The Main installation did not answer in time")),
    );
    socket.once("error", (error: Error) => settle(error));
  });
}

export async function sendPairingRequest(options: {
  readonly body?: unknown;
  readonly caCertificatePem: string;
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly port: number;
}): Promise<PairingResponse> {
  const payload =
    options.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(options.body), "utf8");
  return await new Promise<PairingResponse>((resolve, reject) => {
    const request = https.request(
      {
        ca: [options.caCertificatePem],
        headers: {
          host: `${options.host}:${String(options.port)}`,
          ...(payload === undefined
            ? {}
            : {
                "content-length": String(payload.length),
                "content-type": "application/json",
              }),
        },
        host: options.host,
        method: options.method,
        path: options.path,
        port: options.port,
        rejectUnauthorized: true,
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += String(chunk);
        });
        response.on("end", () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            parsed = { raw };
          }
          resolve({ body: parsed, statusCode: response.statusCode ?? 500 });
        });
      },
    );
    request.on("error", reject);
    if (payload !== undefined) {
      request.write(payload);
    }
    request.end();
  });
}

export interface JoinedTerminal {
  readonly caCertificatePem: string;
  readonly fingerprintDigits: string;
  readonly invitation: PairingInvitation;
  readonly keys: TerminalKeys;
  readonly response: PairingResponse;
}

/**
 * The whole terminal half of the ceremony up to the point where a human has to
 * decide: pin the authority, generate a key, prove possession over the pairing
 * channel, and derive the digits the operator will compare.
 */
export async function joinAsTerminal(input: {
  readonly deviceName: string;
  readonly joinSecret?: string;
  readonly keys?: TerminalKeys;
  readonly qrUri: string;
}): Promise<JoinedTerminal> {
  const invitation = decodePairingInvitation(input.qrUri);
  const keys = input.keys ?? createTerminalKeys();
  const caCertificatePem = await readPinnedAuthority(invitation);
  const response = await sendPairingRequest({
    body: {
      csrPem: buildCertificateRequest(keys),
      deviceName: input.deviceName,
      joinSecret: input.joinSecret ?? invitation.joinSecret,
      sessionId: invitation.sessionId,
      transcriptSignature: signTranscript(
        buildJoinTranscript({
          caFingerprint: invitation.caFingerprint,
          installationId: invitation.installationId,
          sessionId: invitation.sessionId,
          spkiDer: keys.spkiDer,
        }),
        keys,
      ),
    },
    caCertificatePem,
    host: invitation.host,
    method: "POST",
    path: "/pairing/joins",
    port: invitation.port,
  });
  return {
    caCertificatePem,
    fingerprintDigits: deriveFingerprintDigits(
      buildFingerprintTranscript({
        caFingerprint: invitation.caFingerprint,
        installationId: invitation.installationId,
        sessionId: invitation.sessionId,
        spkiDer: keys.spkiDer,
      }),
    ),
    invitation,
    keys,
    response,
  };
}

/** Collects the issued certificate, which only the bound key can ask for. */
export async function collectTerminalCertificate(
  terminal: JoinedTerminal,
): Promise<PairingResponse> {
  return await sendPairingRequest({
    body: {
      sessionId: terminal.invitation.sessionId,
      signature: signTranscript(
        buildFetchTranscript({
          installationId: terminal.invitation.installationId,
          sessionId: terminal.invitation.sessionId,
          spkiDer: terminal.keys.spkiDer,
        }),
        terminal.keys,
      ),
    },
    caCertificatePem: terminal.caCertificatePem,
    host: terminal.invitation.host,
    method: "POST",
    path: "/pairing/certificates",
    port: terminal.invitation.port,
  });
}

const privateKeys = new WeakMap<TerminalKeys, KeyObject>();

function privateKeyOf(keys: TerminalKeys): KeyObject {
  const cached = privateKeys.get(keys);
  if (cached !== undefined) {
    return cached;
  }
  const key = createPrivateKey(keys.privateKeyPem);
  privateKeys.set(keys, key);
  return key;
}

function collectChain(peer: DetailedPeerCertificate): Buffer[] {
  const chain: Buffer[] = [];
  let current: DetailedPeerCertificate | undefined = peer;
  while (current !== undefined && chain.length < 8) {
    if (Buffer.isBuffer(current.raw)) {
      chain.push(current.raw);
    }
    const issuer: DetailedPeerCertificate | undefined =
      current.issuerCertificate;
    current = issuer === current ? undefined : issuer;
  }
  return chain;
}

function concatTranscript(label: string, parts: readonly Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(label, "utf8"), Buffer.of(0x00), ...parts]);
}

function uuidToBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function toPem(label: string, der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The pairing invitation has no ${field}`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`The pairing invitation has no ${field}`);
  }
  return value;
}
