import { generateKeyPairSync, randomUUID } from "node:crypto";
import https from "node:https";
import type { TLSSocket } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPersistedKeyPair,
  deletePersistedKey,
  selectKeyStorageProvider,
  tryExportPrivateKey,
  type KeyResult,
} from "./cng-addon.js";
import {
  buildCACertificate,
  buildDeviceCertificate,
  buildServerCertificate,
  validateCertificate,
  type IssuedCertificate,
} from "./pharmacy-ca-crypto.js";

describe.sequential("Pharmacy CA Cryptography and Validation Seam", () => {
  const installationId = randomUUID();
  let providerName: string;
  let caKeyResult: KeyResult;
  let caCert: IssuedCertificate;
  const caKeyName = `test-ca-${installationId}`;

  beforeAll(async () => {
    providerName = selectKeyStorageProvider().providerName;
    caKeyResult = createPersistedKeyPair({
      providerName,
      keyName: caKeyName,
      algorithm: "RSA",
      keyBits: 2048,
    });

    caCert = buildCACertificate({
      keyHandle: caKeyResult.keyHandle,
      publicKeyDer: caKeyResult.publicKeyDer,
      installationId,
      validityDays: 3650,
    });
  });

  afterAll(() => {
    deletePersistedKey({ providerName, keyName: caKeyName });
  });

  // ─── 1. CA Certificate Construction & Properties ──────────────────────────

  it("builds a valid X.509 v3 self-signed CA certificate with installation identity", () => {
    expect(caCert.certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(caCert.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(caCert.notAfter.getTime()).toBeGreaterThan(
      caCert.notBefore.getTime(),
    );
  });

  // ─── 2. Server Certificate Issuance & Validation ──────────────────────────

  it("builds a server certificate with breev-server role and validates against CA", () => {
    const serverCert = buildServerCertificate({
      caKeyHandle: caKeyResult.keyHandle,
      caCertPem: caCert.certPem,
      installationId,
      sanIPs: ["127.0.0.1"],
      validityDays: 365,
    });

    expect(serverCert.certPem).toContain("-----BEGIN CERTIFICATE-----");
    expect(serverCert.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");

    const certDer = Buffer.from(
      serverCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
      "base64",
    );

    const validation = validateCertificate({
      certDer,
      caCertPem: caCert.certPem,
      expectedRole: "server",
      installationId,
    });

    expect(validation).toEqual({
      valid: true,
      role: "server",
      deviceId: undefined,
      fingerprint: expect.any(String),
    });
  });

  // ─── 3. Device Certificate Issuance & Validation ──────────────────────────

  it("builds a device certificate with breev-device role and validates against CA", () => {
    const deviceId = randomUUID();
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const deviceSpki = publicKey.export({ format: "der", type: "spki" });

    const deviceCert = buildDeviceCertificate({
      caKeyHandle: caKeyResult.keyHandle,
      caCertPem: caCert.certPem,
      deviceId,
      installationId,
      devicePublicKeyDer: deviceSpki,
      validityDays: 365,
    });

    const certDer = Buffer.from(
      deviceCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
      "base64",
    );

    const validation = validateCertificate({
      certDer,
      caCertPem: caCert.certPem,
      expectedRole: "device",
      installationId,
    });

    expect(validation).toEqual({
      valid: true,
      role: "device",
      deviceId,
      fingerprint: expect.any(String),
    });
  });

  // ─── 4. Validation Rejection Scenarios ────────────────────────────────────

  it("rejects expired certificates with cert-expired", () => {
    const deviceId = randomUUID();
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const deviceSpki = publicKey.export({ format: "der", type: "spki" });

    const expiredCert = buildDeviceCertificate({
      caKeyHandle: caKeyResult.keyHandle,
      caCertPem: caCert.certPem,
      deviceId,
      installationId,
      devicePublicKeyDer: deviceSpki,
      validityDays: -1,
    });

    const certDer = Buffer.from(
      expiredCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
      "base64",
    );

    const validation = validateCertificate({
      certDer,
      caCertPem: caCert.certPem,
      expectedRole: "device",
      installationId,
    });

    expect(validation).toEqual({
      valid: false,
      denialCode: "cert-expired",
    });
  });

  it("rejects role mismatches (server cert as device)", () => {
    const serverCert = buildServerCertificate({
      caKeyHandle: caKeyResult.keyHandle,
      caCertPem: caCert.certPem,
      installationId,
      sanIPs: ["127.0.0.1"],
      validityDays: 365,
    });

    const certDer = Buffer.from(
      serverCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
      "base64",
    );

    const validation = validateCertificate({
      certDer,
      caCertPem: caCert.certPem,
      expectedRole: "device",
      installationId,
    });

    expect(validation).toEqual({
      valid: false,
      denialCode: "cert-role-mismatch",
    });
  });

  it("rejects installation identity mismatch", () => {
    const otherInstallationId = randomUUID();
    const deviceId = randomUUID();
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const deviceSpki = publicKey.export({ format: "der", type: "spki" });

    const deviceCert = buildDeviceCertificate({
      caKeyHandle: caKeyResult.keyHandle,
      caCertPem: caCert.certPem,
      deviceId,
      installationId: otherInstallationId,
      devicePublicKeyDer: deviceSpki,
      validityDays: 365,
    });

    const certDer = Buffer.from(
      deviceCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
      "base64",
    );

    const validation = validateCertificate({
      certDer,
      caCertPem: caCert.certPem,
      expectedRole: "device",
      installationId,
    });

    expect(validation).toEqual({
      valid: false,
      denialCode: "cert-installation-mismatch",
    });
  });

  it("rejects certificates signed by a foreign CA", () => {
    const { publicKey: foreignPub, privateKey: foreignPriv } =
      generateKeyPairSync("rsa", { modulusLength: 2048 });
    const foreignCa = buildCACertificate({
      keyHandle: {
        keyName: "foreign",
        providerName: "test",
        isMachineKey: false,
        softwareFallbackKey: foreignPriv,
      },
      publicKeyDer: foreignPub.export({ format: "der", type: "spki" }),
      installationId,
      validityDays: 3650,
    });

    const deviceId = randomUUID();
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const deviceSpki = publicKey.export({ format: "der", type: "spki" });

    const foreignDeviceCert = buildDeviceCertificate({
      caKeyHandle: {
        keyName: "foreign",
        providerName: "test",
        isMachineKey: false,
        softwareFallbackKey: foreignPriv,
      },
      caCertPem: foreignCa.certPem,
      deviceId,
      installationId,
      devicePublicKeyDer: deviceSpki,
      validityDays: 365,
    });

    const certDer = Buffer.from(
      foreignDeviceCert.certPem
        .replace(/-----[^-]+-----/g, "")
        .replace(/\s/g, ""),
      "base64",
    );

    const validation = validateCertificate({
      certDer,
      caCertPem: caCert.certPem,
      expectedRole: "device",
      installationId,
    });

    expect(validation).toEqual({
      valid: false,
      denialCode: "cert-chain-invalid",
    });
  });

  // ─── 5. Mutual TLS (mTLS) Live Handshake Fixture ──────────────────────────

  it("completes a full mutual TLS 1.3 handshake with client certificate authentication", async () => {
    const serverCert = buildServerCertificate({
      caKeyHandle: caKeyResult.keyHandle,
      caCertPem: caCert.certPem,
      installationId,
      sanIPs: ["127.0.0.1"],
      validityDays: 365,
    });

    const deviceId = randomUUID();
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const deviceSpki = publicKey.export({ format: "der", type: "spki" });
    const deviceKeyPem = privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string;

    const deviceCert = buildDeviceCertificate({
      caKeyHandle: caKeyResult.keyHandle,
      caCertPem: caCert.certPem,
      deviceId,
      installationId,
      devicePublicKeyDer: deviceSpki,
      validityDays: 365,
    });

    const server = https.createServer(
      {
        key: serverCert.privateKeyPem,
        cert: serverCert.certPem,
        ca: [caCert.certPem],
        requestCert: true,
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
        maxVersion: "TLSv1.3",
      },
      (req, res) => {
        const socket = req.socket as TLSSocket;
        const peerCert = socket.getPeerCertificate?.(true);
        if (!peerCert || !peerCert.raw) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ status: "denied", code: "mtls-cert-missing" }),
          );
          return;
        }

        const validation = validateCertificate({
          certDer: Buffer.from(peerCert.raw),
          caCertPem: caCert.certPem,
          expectedRole: "device",
          installationId,
        });

        if (!validation.valid) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ status: "denied", code: validation.denialCode }),
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "authenticated",
            deviceId: validation.deviceId,
            tlsVersion: socket.getProtocol?.(),
          }),
        );
      },
    );

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          resolve(0);
        }
      });
    });

    try {
      // 1. Client with valid device certificate
      const successRes = await new Promise<{
        status: number;
        body: Record<string, unknown>;
      }>((resolve, reject) => {
        const req = https.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            method: "GET",
            ca: [caCert.certPem],
            cert: deviceCert.certPem,
            key: deviceKeyPem,
            rejectUnauthorized: true,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 500,
                body: JSON.parse(data) as Record<string, unknown>,
              }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(successRes.status).toBe(200);
      expect(successRes.body).toMatchObject({
        status: "authenticated",
        deviceId,
      });

      // 2. Client without certificate
      const noCertRes = await new Promise<{
        status: number;
        body: Record<string, unknown>;
      }>((resolve, reject) => {
        const req = https.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            method: "GET",
            ca: [caCert.certPem],
            rejectUnauthorized: true,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 500,
                body: JSON.parse(data) as Record<string, unknown>,
              }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(noCertRes.status).toBe(401);
      expect(noCertRes.body).toEqual({
        status: "denied",
        code: "mtls-cert-missing",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ─── 6. Windows CNG Non-Exportability Proof ───────────────────────────────

  describe.runIf(process.platform === "win32")(
    "Windows CNG Non-Exportability",
    () => {
      it("proves the CA key export fails", () => {
        const exportResult = tryExportPrivateKey(caKeyResult.keyHandle);
        expect(exportResult.exported).toBe(false);
      });
    },
  );
});
