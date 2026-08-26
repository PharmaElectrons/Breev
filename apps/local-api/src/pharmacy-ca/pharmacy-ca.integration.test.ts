import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { generateKeyPairSync } from "node:crypto";
import express from "express";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { MainDeviceSecurityService } from "../main-device/main-device-security.service.js";
import { tryExportPrivateKey } from "./cng-addon.js";
import { createLanMtlsServer } from "./lan-mtls-server.js";
import {
  buildCACertificate,
  buildDeviceCertificate,
  createUuidV7,
} from "./pharmacy-ca-crypto.js";
import { PharmacyCaService } from "./pharmacy-ca.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

describe.sequential("Pharmacy CA and Terminal mTLS Integration Seam", () => {
  let postgres: StartedPostgreSqlContainer;
  let databaseRoles: SeparatedDatabaseRoles;
  let pool: Pool;
  let localDb: LocalDatabaseService;
  let security: MainDeviceSecurityService;
  let pharmacyCa: PharmacyCaService;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);

    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;

    localDb = new LocalDatabaseService();
    await localDb.onModuleInit();
    pool = localDb.requirePool();
    security = new MainDeviceSecurityService(localDb);
    pharmacyCa = new PharmacyCaService(localDb);
  }, 120_000);

  afterAll(async () => {
    await localDb?.onApplicationShutdown();
    await postgres?.stop().catch(() => undefined);
  });

  // ─── Group A: CA Initialization & Idempotency ─────────────────────────────

  describe("Group A: CA Initialization & Idempotency", () => {
    it("creates a pharmacy CA on first initialization", async () => {
      await pharmacyCa.initializeCA();
      const state = pharmacyCa.requireState();

      expect(state.installationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(state.caCertPem).toContain("-----BEGIN CERTIFICATE-----");
      expect(state.assuranceLevel).toMatch(
        /^(platform-tpm|software-cng-fallback)$/,
      );

      // Verify row in database
      const rows = await pool.query(
        "select singleton, installation_id, assurance_level, ca_fingerprint from pharmacy_ca",
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]?.singleton).toBe(true);
      expect(rows.rows[0]?.installation_id).toBe(state.installationId);
    });

    it("is idempotent and reuses the existing CA on subsequent initialization", async () => {
      const initialId = pharmacyCa.installationId;
      const initialCert = pharmacyCa.caCertPem;

      // Re-initialize
      await pharmacyCa.initializeCA();

      expect(pharmacyCa.installationId).toBe(initialId);
      expect(pharmacyCa.caCertPem).toBe(initialCert);

      const count = await pool.query(
        "select count(*)::int as count from pharmacy_ca",
      );
      expect(count.rows[0]?.count).toBe(1);
    });

    it("fails closed when the existing CA key is missing or inaccessible", async () => {
      // Simulate broken/missing key by pointing database to non-existent key
      const initialId = pharmacyCa.installationId;
      const fakeInstallationId = createUuidV7();
      const testPool = new Pool({
        connectionString: databaseRoles.migrationUrl,
      });
      try {
        await testPool.query(
          `update pharmacy_ca
           set installation_id = $1
           where singleton = true`,
          [fakeInstallationId],
        );

        const brokenService = new PharmacyCaService(localDb);
        await expect(brokenService.initializeCA()).rejects.toThrow(
          /PHARMACY_CA_KEY_INACCESSIBLE|Repair is required/,
        );
      } finally {
        // Restore original installation ID
        await testPool.query(
          `update pharmacy_ca
           set installation_id = $1
           where singleton = true`,
          [initialId],
        );
        await testPool.end();
      }
    });

    it("fails closed when the stored CA identity does not match its key", async () => {
      const testPool = new Pool({
        connectionString: databaseRoles.migrationUrl,
      });
      const original = await testPool.query<{ ca_fingerprint: string }>(
        "select ca_fingerprint from pharmacy_ca where singleton = true",
      );
      const originalFingerprint = original.rows[0]?.ca_fingerprint ?? "";
      try {
        await testPool.query(
          "update pharmacy_ca set ca_fingerprint = repeat('0', 64) where singleton = true",
        );
        const mismatchedService = new PharmacyCaService(localDb);
        await expect(mismatchedService.initializeCA()).rejects.toMatchObject({
          code: "PHARMACY_CA_IDENTITY_MISMATCH",
        });
      } finally {
        await testPool.query(
          "update pharmacy_ca set ca_fingerprint = $1 where singleton = true",
          [originalFingerprint],
        );
        await testPool.end();
      }
    });
  });

  // ─── Group B: Certificate Issuance ────────────────────────────────────────

  describe("Group B: Certificate Issuance", () => {
    const testDeviceId = createUuidV7();

    it("issues a server certificate chaining to CA with breev-server role", async () => {
      const creds = await pharmacyCa.issueServerCertificate(["127.0.0.1"]);
      expect(creds.certPem).toContain("-----BEGIN CERTIFICATE-----");
      expect(creds.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
      expect(creds.caCertPem).toBe(pharmacyCa.caCertPem);

      // Verify in server_certificates table
      const rows = await pool.query(
        "select count(*)::int as count from server_certificates where installation_id = $1",
        [pharmacyCa.installationId],
      );
      expect(rows.rows[0]?.count).toBeGreaterThanOrEqual(1);

      // Validate certificate
      const certDer = Buffer.from(
        creds.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
        "base64",
      );
      const validation = pharmacyCa.validateCertificate(certDer, "server", {
        expectedServerIp: "127.0.0.1",
      });
      expect(validation).toEqual({
        valid: true,
        role: "server",
        deviceId: undefined,
        fingerprint: expect.any(String),
      });
    });

    it("issues a device certificate chaining to CA with breev-device role", async () => {
      const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });

      const deviceCert = await pharmacyCa.issueDeviceCertificate({
        deviceId: testDeviceId,
        devicePublicKeyDer: deviceSpki,
      });

      expect(deviceCert.certPem).toContain("-----BEGIN CERTIFICATE-----");

      // Verify in terminal_devices table
      const rows = await pool.query(
        "select id, installation_id, cert_fingerprint, revoked_at from terminal_devices where id = $1",
        [testDeviceId],
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]?.revoked_at).toBeNull();

      // Validate certificate
      const certDer = Buffer.from(
        deviceCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
        "base64",
      );
      const validation = pharmacyCa.validateCertificate(certDer, "device");
      expect(validation).toEqual({
        valid: true,
        role: "device",
        deviceId: testDeviceId,
        fingerprint: expect.any(String),
      });
    });
  });

  // ─── Group C: Validation Pipeline ─────────────────────────────────────────

  describe("Group C: Validation Pipeline", () => {
    it("rejects an expired certificate", async () => {
      const state = pharmacyCa.requireState();
      const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });

      const expiredCert = buildDeviceCertificate({
        caKeyHandle: state.keyHandle,
        caCertPem: state.caCertPem,
        deviceId: createUuidV7(),
        installationId: state.installationId,
        devicePublicKeyDer: deviceSpki,
        validityDays: -1, // expired yesterday
      });

      const certDer = Buffer.from(
        expiredCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
        "base64",
      );
      const validation = pharmacyCa.validateCertificate(certDer, "device");
      expect(validation).toEqual({
        valid: false,
        denialCode: "cert-expired",
      });
    });

    it("rejects role mismatch (server presented as device)", async () => {
      const creds = await pharmacyCa.issueServerCertificate(["127.0.0.1"]);
      const certDer = Buffer.from(
        creds.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
        "base64",
      );

      const validation = pharmacyCa.validateCertificate(certDer, "device");
      expect(validation).toEqual({
        valid: false,
        denialCode: "cert-role-mismatch",
      });
    });

    it("rejects role mismatch (device presented as server)", async () => {
      const deviceId = createUuidV7();
      const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });

      const deviceCert = await pharmacyCa.issueDeviceCertificate({
        deviceId,
        devicePublicKeyDer: deviceSpki,
      });

      const certDer = Buffer.from(
        deviceCert.certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
        "base64",
      );
      const validation = pharmacyCa.validateCertificate(certDer, "server", {
        expectedServerIp: "127.0.0.1",
      });
      expect(validation).toEqual({
        valid: false,
        denialCode: "cert-role-mismatch",
      });
    });

    it("rejects a certificate with a mismatched installation identity", async () => {
      const state = pharmacyCa.requireState();
      const foreignInstallationId = createUuidV7();
      const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });

      const mismatchedCert = buildDeviceCertificate({
        caKeyHandle: state.keyHandle,
        caCertPem: state.caCertPem,
        deviceId: createUuidV7(),
        installationId: foreignInstallationId,
        devicePublicKeyDer: deviceSpki,
        validityDays: 365,
      });

      const certDer = Buffer.from(
        mismatchedCert.certPem
          .replace(/-----[^-]+-----/g, "")
          .replace(/\s/g, ""),
        "base64",
      );
      const validation = pharmacyCa.validateCertificate(certDer, "device");
      expect(validation).toEqual({
        valid: false,
        denialCode: "cert-installation-mismatch",
      });
    });

    it("rejects a certificate signed by a foreign CA", async () => {
      const foreignKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const foreignSpki = foreignKeys.publicKey.export({
        format: "der",
        type: "spki",
      });
      const foreignCa = buildCACertificate({
        keyHandle: {
          keyName: "foreign-ca",
          providerName: "test",
          isMachineKey: false,
          softwareFallbackKey: foreignKeys.privateKey,
        },
        publicKeyDer: foreignSpki,
        installationId: pharmacyCa.installationId,
        validityDays: 365,
      });

      const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });

      const foreignDeviceCert = buildDeviceCertificate({
        caKeyHandle: {
          keyName: "foreign-ca",
          providerName: "test",
          isMachineKey: false,
          softwareFallbackKey: foreignKeys.privateKey,
        },
        caCertPem: foreignCa.certPem,
        deviceId: createUuidV7(),
        installationId: pharmacyCa.installationId,
        devicePublicKeyDer: deviceSpki,
        validityDays: 365,
      });

      const certDer = Buffer.from(
        foreignDeviceCert.certPem
          .replace(/-----[^-]+-----/g, "")
          .replace(/\s/g, ""),
        "base64",
      );
      const validation = pharmacyCa.validateCertificate(certDer, "device");
      expect(validation).toEqual({
        valid: false,
        denialCode: "cert-chain-invalid",
      });
    });

    it("detects and enforces device revocation per request in PostgreSQL", async () => {
      const deviceId = createUuidV7();
      const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });

      const certificate = await pharmacyCa.issueDeviceCertificate({
        deviceId,
        devicePublicKeyDer: deviceSpki,
      });

      // Initially active
      let check = await pharmacyCa.checkDeviceRevocation(
        deviceId,
        certificate.fingerprint,
      );
      expect(check).toEqual({ revoked: false });

      // Revoke the device
      await pharmacyCa.revokeDevice(deviceId, "terminal replaced");

      // Now revoked
      check = await pharmacyCa.checkDeviceRevocation(
        deviceId,
        certificate.fingerprint,
      );
      expect(check).toEqual({
        revoked: true,
        reason: "terminal replaced",
      });
    });

    it("rejects a replaced certificate while accepting the current certificate", async () => {
      const deviceId = createUuidV7();
      const firstKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const first = await pharmacyCa.issueDeviceCertificate({
        deviceId,
        devicePublicKeyDer: firstKey.publicKey.export({
          format: "der",
          type: "spki",
        }),
      });
      const secondKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const second = await pharmacyCa.issueDeviceCertificate({
        deviceId,
        devicePublicKeyDer: secondKey.publicKey.export({
          format: "der",
          type: "spki",
        }),
      });

      await expect(
        pharmacyCa.checkDeviceRevocation(deviceId, first.fingerprint),
      ).resolves.toEqual({
        revoked: true,
        reason: "certificate replaced",
      });
      await expect(
        pharmacyCa.checkDeviceRevocation(deviceId, second.fingerprint),
      ).resolves.toEqual({ revoked: false });
    });
  });

  // ─── Group D & E: HTTPS mTLS Connection & Hardening Fixture ───────────────

  describe("Group D & E: HTTPS mTLS Connection & Hardening Fixture", () => {
    let server: https.Server | undefined;
    let serverPort: number;
    let serverKeyPem: string;
    let serverCertPem: string;

    beforeAll(async () => {
      const serverCreds = await pharmacyCa.issueServerCertificate([
        "127.0.0.1",
      ]);
      serverKeyPem = serverCreds.privateKeyPem;
      serverCertPem = serverCreds.certPem;

      const lanApp = express();
      lanApp.get("/", (request, response) => {
        const socket = request.socket as TLSSocket;
        response.json({
          status: "authenticated",
          deviceId: (request as unknown as Record<string, unknown>)[
            "breevMtlsDeviceId"
          ],
          tlsVersion: socket.getProtocol?.(),
        });
      });

      server = await createLanMtlsServer({
        apiHandler: lanApp,
        host: "127.0.0.1",
        pharmacyCa,
        security,
      });

      await new Promise<void>((resolve) => {
        server!.listen(0, "127.0.0.1", () => {
          serverPort = (server!.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (server !== undefined) {
        const activeServer = server;
        await new Promise<void>((resolve) =>
          activeServer.close(() => resolve()),
        );
      }
    });

    it("authenticates a terminal over mTLS with a valid device certificate", async () => {
      const deviceId = createUuidV7();
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });
      const deviceKeyPem = privateKey.export({
        format: "pem",
        type: "pkcs8",
      }) as string;

      const deviceCert = await pharmacyCa.issueDeviceCertificate({
        deviceId,
        devicePublicKeyDer: deviceSpki,
      });

      const response = await sendMtlsRequest({
        port: serverPort,
        caCertPem: pharmacyCa.caCertPem,
        clientCertPem: deviceCert.certPem,
        clientKeyPem: deviceKeyPem,
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        status: "authenticated",
        deviceId,
      });
    });

    it("rejects an mTLS request when client certificate is omitted", async () => {
      const response = await sendMtlsRequest({
        port: serverPort,
        caCertPem: pharmacyCa.caCertPem,
        clientCertPem: undefined,
        clientKeyPem: undefined,
      });

      expect(response.statusCode).toBe(401);
      expect(response.body).toMatchObject({
        status: "denied",
        code: "mtls-cert-missing",
      });
    });

    it("rejects an mTLS request with a revoked device certificate", async () => {
      const deviceId = createUuidV7();
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const deviceSpki = publicKey.export({ format: "der", type: "spki" });
      const deviceKeyPem = privateKey.export({
        format: "pem",
        type: "pkcs8",
      }) as string;

      const deviceCert = await pharmacyCa.issueDeviceCertificate({
        deviceId,
        devicePublicKeyDer: deviceSpki,
      });

      // Revoke the device
      await pharmacyCa.revokeDevice(deviceId, "lost terminal");

      const response = await sendMtlsRequest({
        port: serverPort,
        caCertPem: pharmacyCa.caCertPem,
        clientCertPem: deviceCert.certPem,
        clientKeyPem: deviceKeyPem,
      });

      expect(response.statusCode).toBe(403);
      expect(response.body).toMatchObject({
        status: "denied",
        code: "device-revoked",
      });
      const audit = await pool.query<{ terminal_device_id: string }>(
        `select terminal_device_id
         from main_device_recent_denials
         where code = 'device-revoked'
         order by denied_at desc, id desc
         limit 1`,
      );
      expect(audit.rows[0]?.terminal_device_id).toBe(deviceId);
    });

    it("rejects an mTLS request when server cert is used as client cert", async () => {
      const response = await sendMtlsRequest({
        port: serverPort,
        caCertPem: pharmacyCa.caCertPem,
        clientCertPem: serverCertPem,
        clientKeyPem: serverKeyPem,
      });

      expect(response.statusCode).toBe(403);
      expect(response.body).toMatchObject({
        status: "denied",
        code: "cert-role-mismatch",
      });
    });
  });

  // ─── Group F: Non-Exportability Proof ─────────────────────────────────────

  describe.runIf(process.platform === "win32")(
    "Group F: Windows CNG Non-Exportability Proof",
    () => {
      it("proves the CA private key is non-exportable from Windows CNG", async () => {
        const state = pharmacyCa.requireState();
        const exportResult = tryExportPrivateKey(state.keyHandle);

        expect(exportResult.exported).toBe(false);
        expect(exportResult.message).toContain("EXPORT_DENIED");
      });
    },
  );
});

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

interface MtlsRequestOptions {
  readonly port: number;
  readonly caCertPem: string;
  readonly clientCertPem: string | undefined;
  readonly clientKeyPem: string | undefined;
}

interface MtlsResponse {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

function sendMtlsRequest(options: MtlsRequestOptions): Promise<MtlsResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: options.port,
        path: "/",
        method: "GET",
        ca: [options.caCertPem],
        cert: options.clientCertPem,
        key: options.clientKeyPem,
        rejectUnauthorized: true,
      },
      (res) => {
        let rawData = "";
        res.on("data", (chunk) => {
          rawData += chunk;
        });
        res.on("end", () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = { raw: rawData };
          }
          resolve({
            statusCode: res.statusCode ?? 500,
            body: parsed,
          });
        });
      },
    );

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}
