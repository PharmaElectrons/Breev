import {
  INVENTORY_REPORT_KINDS,
  inventoryReportPath,
  inventoryReportProtectedExportContract,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { HttpException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { Server } from "node:https";
import { createServer } from "node:net";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../licensing/licence-keys.js", async () => {
  const issuer = await import("../devices/test-helpers/licence-issuer.test.js");
  return {
    OFFLINE_LICENCE_PUBLIC_KEYS: {
      [issuer.TEST_ISSUER_KEY_ID]: issuer.TEST_ISSUER_PUBLIC_KEY_PEM,
    },
  };
});
import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { DevicesService } from "../devices/devices.service.js";
import {
  buildFetchTranscript,
  buildJoinTranscript,
  decodePairingInvitation,
} from "../devices/pairing-domain.js";
import { createPairingChannelHandler } from "../devices/pairing.routes.js";
import { mintLicence } from "../devices/test-helpers/licence-issuer.test.js";
import {
  BRIDGE_HEADERS,
  buildCertificateRequest,
  createTerminalKeys,
  sendTerminalRequest,
  signTranscript,
  type TerminalKeys,
} from "../devices/test-helpers/terminal-client.test.js";
import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import {
  IdentityAccessDenied,
  IdentityAccessService,
} from "../identity-access/identity-access.service.js";
import {
  LicensingDenied,
  LicensingService,
} from "../licensing/licensing.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import {
  createMainRequestSecurityMiddleware,
  MainDeviceSecurityService,
} from "../main-device/main-device-security.service.js";
import { createLanMtlsServer } from "../pharmacy-ca/lan-mtls-server.js";
import { PharmacyCaService } from "../pharmacy-ca/pharmacy-ca.service.js";
import {
  InventoryReportDenied,
  InventoryReportService,
} from "./inventory-report.service.js";
import { InventoryReportExportService } from "../inventory/inventory-report-export.service.js";
const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "report.terminal.owner";
const OWNER_PASSWORD = "report terminal owner password stays in this test";
interface PairedTerminal {
  readonly certificatePem: string;
  readonly deviceId: string;
  readonly keys: TerminalKeys;
}
describe.sequential("Report Additional POS entitlement boundary", () => {
  const mainDeviceId = "019b0000-0000-7000-8000-0000000007b1";
  const originalEnvironment = { ...process.env };
  let administrator: Pool;
  let reports: InventoryReportService;
  let exports: InventoryReportExportService;
  let database: LocalDatabaseService;
  let databaseRoles: SeparatedDatabaseRoles;
  let deviceSecret = "";
  let deviceSession = "";
  let devices: DevicesService;
  let identity: IdentityAccessService;
  let lanPort = 0;
  let licensing: LicensingService;
  let mainApi: express.Express;
  let ownerId = "";
  let pharmacyCa: PharmacyCaService;
  let pharmacyId = "";
  let postgres: StartedPostgreSqlContainer | undefined;
  let security: MainDeviceSecurityService;
  let server: Server;
  beforeAll(async () => {
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    deviceSecret = randomBytes(32).toString("base64url");
    deviceSession = randomBytes(32).toString("base64url");
    process.env.DATABASE_URL = databaseRoles.applicationUrl;
    process.env.DATABASE_MIGRATION_URL = databaseRoles.migrationUrl;
    process.env.BREEV_MAIN_DEVICE_ID = mainDeviceId;
    process.env.BREEV_MAIN_DEVICE_SECRET = deviceSecret;
    process.env.BREEV_MAIN_DEVICE_SESSION = deviceSession;

    database = new LocalDatabaseService();
    await database.ensureReady();
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    security = new MainDeviceSecurityService(database);
    pharmacyCa = new PharmacyCaService(database);
    licensing = new LicensingService(database);
    identity = new IdentityAccessService(
      database,
      security,
      licensing,
      new DurableJobsService(database),
    );
    reports = new InventoryReportService(database, identity);
    exports = new InventoryReportExportService(database, identity, reports);
    lanPort = await reservePort();
    devices = new DevicesService(database, identity, pharmacyCa, {
      host: "127.0.0.1",
      port: lanPort,
    });

    mainApi = express();
    mainApi.use(
      createMainRequestSecurityMiddleware({
        additionalExpectedHosts: [`127.0.0.1:${String(lanPort)}`],
        expectedHost: "127.0.0.1:1",
        security,
      }),
    );
    mainApi.use(
      express.json({ limit: 8 * 1024, strict: true, type: "application/json" }),
    );
    mainApi.post("/identity/login", (request, response) => {
      answerTerminal(response, async () =>
        identity.login(request, request.body as never),
      );
    });
    mainApi.get("/reports/inventory/:kind", (request, response) => {
      answerTerminal(response, () =>
        reports.read(request, String(request.params.kind), request.query),
      );
    });
    mainApi.get("/reports/inventory/:kind/export", (request, response) => {
      answerTerminal(response, () =>
        reports.read(request, String(request.params.kind), request.query, true),
      );
    });
    mainApi.get("/reports/inventory/:kind/activity", (request, response) => {
      answerTerminal(response, () =>
        reports.activity(request, String(request.params.kind), request.query),
      );
    });
    mainApi.post(
      inventoryReportProtectedExportContract.path,
      (request, response) => {
        answerTerminal(response, () =>
          exports.export(request, request.body as never),
        );
      },
    );
    mainApi.post("/identity/step-up-challenges", (request, response) => {
      answerTerminal(response, () =>
        identity.createStepUp(request, request.body as never),
      );
    });
    mainApi.post(
      "/identity/step-up-challenges/:id/approve",
      (request, response) => {
        answerTerminal(response, () =>
          identity.approveStepUp(
            request,
            String(request.params.id),
            request.body as never,
          ),
        );
      },
    );

    const lan = await createLanMtlsServer({
      apiHandler: mainApi as RequestHandler,
      host: "127.0.0.1",
      pairingHandler: createPairingChannelHandler(devices),
      pharmacyCa,
      security,
    });
    server = lan.server;
    devices.useSocketRegistry(lan.registry);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(lanPort, "127.0.0.1", resolve);
    });

    const bootstrapped = await identity.bootstrap(await verifiedMainRequest(), {
      owner: {
        displayName: "Terminal Report Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Terminal Report Pharmacy",
    });
    ownerId = bootstrapped.user.id;
    pharmacyId = bootstrapped.pharmacy.id;
    await installTerminalLicence(true);
  }, 240_000);

  afterAll(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await database?.onApplicationShutdown().catch(() => undefined);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    process.env = originalEnvironment;
  });

  it("rechecks terminal entitlement on all seven reports, activity and both export paths", async () => {
    const terminal = await pairTerminal();
    const login = await terminalCall(terminal, "POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.statusCode).toBe(200);
    const query = {
      from: "2020-01-01T00:00:00Z",
      to: new Date().toISOString(),
    };
    for (const kind of INVENTORY_REPORT_KINDS) {
      for (const suffix of ["", "/export", "/activity"]) {
        const input =
          suffix === "/activity" ? { query, rowId: mainDeviceId } : query;
        const response = await terminalCall(
          terminal,
          "GET",
          `${inventoryReportPath(kind)}${suffix}?query=${encodeURIComponent(JSON.stringify(input))}`,
        );
        expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
      }
      const challenge = await terminalCall(
        terminal,
        "POST",
        "/identity/step-up-challenges",
        {
          action: "inventory.sensitive.export",
          idempotencyKey: createUuidV7(),
        },
      );
      expect(challenge.statusCode).toBe(200);
      const approved = await terminalCall(
        terminal,
        "POST",
        `/identity/step-up-challenges/${String(challenge.body.id)}/approve`,
        { password: OWNER_PASSWORD, idempotencyKey: createUuidV7() },
      );
      expect(approved.statusCode).toBe(200);
      const protectedExport = await terminalCall(
        terminal,
        "POST",
        inventoryReportProtectedExportContract.path,
        {
          kind,
          query,
          challengeId: challenge.body.id,
          idempotencyKey: createUuidV7(),
        },
      );
      expect(
        protectedExport.statusCode,
        JSON.stringify(protectedExport.body),
      ).toBe(200);
    }
    await installTerminalLicence(false);
    for (const kind of INVENTORY_REPORT_KINDS) {
      for (const suffix of ["", "/export", "/activity"]) {
        const denied = await terminalCall(
          terminal,
          "GET",
          `${inventoryReportPath(kind)}${suffix}`,
        );
        expect(denied).toMatchObject({
          statusCode: 403,
          body: {
            code: "entitlement-denied",
            requiredCapability: "additional-device-pos",
          },
        });
      }
      const denied = await terminalCall(
        terminal,
        "POST",
        inventoryReportProtectedExportContract.path,
        {
          kind,
          query,
          challengeId: createUuidV7(),
          idempotencyKey: createUuidV7(),
        },
      );
      expect(denied).toMatchObject({
        statusCode: 403,
        body: { code: "entitlement-denied" },
      });
    }
    const domain = await administrator.query(
      "select (select count(*) from inventory_movements) as movements, (select count(*) from inventory_count_variance_applications) as applications, (select count(*) from accounting_journal_entries) as journals",
    );
    expect(domain.rows[0]).toEqual({
      movements: "0",
      applications: "0",
      journals: "0",
    });
  }, 120_000);
  async function installTerminalLicence(entitled: boolean): Promise<void> {
    await licensing.install({
      actorId: ownerId,
      encodedLicence: mintLicence({
        features: entitled ? ["additional-device-pos"] : [],
        licenceId: createUuidV7(),
        mainDeviceId,
        permittedDeviceCount: entitled ? 2 : 1,
        pharmacyId,
      }),
      mainDeviceId,
      now: new Date(),
      pharmacyId,
    });
  }

  async function pairTerminal(): Promise<PairedTerminal> {
    const challenge = await identity.createStepUp(await verifiedMainRequest(), {
      action: "devices.pairing.start",
      idempotencyKey: randomUUID(),
    });
    await identity.approveStepUp(await verifiedMainRequest(), challenge.id, {
      idempotencyKey: randomUUID(),
      password: OWNER_PASSWORD,
    });
    const started = await devices.startPairingSession(
      await verifiedMainRequest(),
      {
        idempotencyKey: randomUUID(),
        stepUpChallengeId: challenge.id,
      },
    );
    if (started.qrUri === undefined) {
      throw new Error("The terminal pairing invitation is missing");
    }
    const invitation = decodePairingInvitation(started.qrUri);
    if (invitation === undefined) {
      throw new Error("The terminal pairing invitation is invalid");
    }
    const keys = createTerminalKeys();
    const joined = await sendTerminalRequest({
      body: {
        csrPem: buildCertificateRequest(keys),
        deviceName: "Report Counter",
        joinSecret: invitation.joinSecret,
        sessionId: invitation.sessionId,
        transcriptSignature: signTranscript(
          buildJoinTranscript({
            caFingerprint: started.caFingerprint,
            installationId: pharmacyCa.installationId,
            sessionId: invitation.sessionId,
            spkiDer: keys.spkiDer,
          }),
          keys,
        ),
      },
      caCertPem: pharmacyCa.caCertPem,
      method: "POST",
      path: "/pairing/joins",
      port: lanPort,
    });
    expect(joined.statusCode).toBe(200);
    const confirmed = await devices.confirmPairingSession(
      await verifiedMainRequest(),
      invitation.sessionId,
      { idempotencyKey: randomUUID() },
    );
    const collected = await sendTerminalRequest({
      body: {
        sessionId: invitation.sessionId,
        signature: signTranscript(
          buildFetchTranscript({
            installationId: pharmacyCa.installationId,
            sessionId: invitation.sessionId,
            spkiDer: keys.spkiDer,
          }),
          keys,
        ),
      },
      caCertPem: pharmacyCa.caCertPem,
      method: "POST",
      path: "/pairing/certificates",
      port: lanPort,
    });
    expect(collected.statusCode).toBe(200);
    return {
      certificatePem: String(collected.body.certificatePem),
      deviceId: confirmed.deviceId,
      keys,
    };
  }

  async function verifiedMainRequest(): Promise<Request> {
    const headers: Readonly<Record<string, string>> = {
      authorization: `Breev-Device ${deviceSecret}`,
      "x-breev-device-id": mainDeviceId,
      "x-breev-device-session": deviceSession,
    };
    const request = {
      get: (name: string): string | undefined => headers[name.toLowerCase()],
    } as unknown as Request;
    const binding = await security.verifyBinding(request);
    expect(binding.status).toBe("verified");
    return request;
  }

  async function terminalCall(
    terminal: PairedTerminal,
    method: "GET" | "POST",
    route: string,
    body?: unknown,
  ) {
    return await sendTerminalRequest({
      ...(body === undefined ? {} : { body }),
      caCertPem: pharmacyCa.caCertPem,
      clientCertPem: terminal.certificatePem,
      clientKeyPem: terminal.keys.privateKeyPem,
      headers: BRIDGE_HEADERS,
      method,
      path: route,
      port: lanPort,
    });
  }
});
function answerTerminal(
  response: Response,
  work: () => Promise<unknown>,
): void {
  void work()
    .then((body) => response.status(200).json(body))
    .catch((error: unknown) => {
      if (error instanceof InventoryReportDenied) {
        response.status(error.statusCode).json(error.denial);
        return;
      }
      if (error instanceof IdentityAccessDenied) {
        response.status(error.statusCode).json(error.denial);
        return;
      }
      if (error instanceof LicensingDenied) {
        response.status(403).json(error.denial);
        return;
      }
      if (error instanceof HttpException) {
        response.status(error.getStatus()).json(error.getResponse());
        return;
      }
      response.status(500).json({ status: "fault" });
    });
}
function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}
