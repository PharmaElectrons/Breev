import { AsnParser, AsnSerializer } from "@peculiar/asn1-schema";
import {
  Attributes,
  CertificationRequest,
  CertificationRequestInfo,
} from "@peculiar/asn1-csr";
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  Name,
  RelativeDistinguishedName,
  SubjectPublicKeyInfo,
} from "@peculiar/asn1-x509";
import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import https from "node:https";

/**
 * A stand-in for the Additional POS Terminal: it holds a keypair, builds the
 * same PKCS#10 request the desktop client sends, signs the same transcripts,
 * and speaks to the LAN listener over real TLS — first without a certificate,
 * through the pairing channel, and afterwards with one, through mTLS.
 */
const OID_COMMON_NAME = "2.5.4.3";
const OID_ORGANIZATION = "2.5.4.10";
const OID_SHA256_WITH_RSA = "1.2.840.113549.1.1.11";

export interface TerminalKeys {
  readonly privateKeyPem: string;
  readonly publicKey: KeyObject;
  readonly spkiDer: Buffer;
}

export function createTerminalKeys(): TerminalKeys {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privateKeyPem: privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
    publicKey,
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
    subjectPKInfo: AsnParser.parse(keys.spkiDer, SubjectPublicKeyInfo),
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
  const der = Buffer.from(AsnSerializer.serialize(request));
  const lines = der.toString("base64").match(/.{1,64}/gu) ?? [];
  return `-----BEGIN CERTIFICATE REQUEST-----\n${lines.join("\n")}\n-----END CERTIFICATE REQUEST-----\n`;
}

export function signTranscript(transcript: Buffer, keys: TerminalKeys): string {
  return sign("sha256", transcript, privateKeyOf(keys)).toString("base64");
}

export interface TerminalResponse {
  readonly body: Record<string, unknown>;
  readonly statusCode: number;
}

export interface TerminalRequestOptions {
  readonly agent?: https.Agent | undefined;
  readonly body?: unknown;
  readonly caCertPem: string;
  readonly clientCertPem?: string | undefined;
  readonly clientKeyPem?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly method: string;
  readonly path: string;
  readonly port: number;
}

export function sendTerminalRequest(
  options: TerminalRequestOptions,
): Promise<TerminalResponse> {
  const payload =
    options.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(options.body), "utf8");
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        ca: [options.caCertPem],
        headers: {
          host: `127.0.0.1:${String(options.port)}`,
          ...(payload === undefined
            ? {}
            : {
                "content-length": String(payload.length),
                "content-type": "application/json",
              }),
          ...options.headers,
        },
        hostname: "127.0.0.1",
        method: options.method,
        path: options.path,
        port: options.port,
        rejectUnauthorized: true,
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(options.clientCertPem === undefined
          ? {}
          : { cert: options.clientCertPem }),
        ...(options.clientKeyPem === undefined
          ? {}
          : { key: options.clientKeyPem }),
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

/** The browser-defence headers the terminal bridge injects on every request. */
export const BRIDGE_HEADERS: Readonly<Record<string, string>> = {
  origin: "breev://app",
  "x-breev-csrf": "1",
};

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

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}
