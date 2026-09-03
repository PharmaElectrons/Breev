import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  productPath,
  type Product,
  type ProductCreateRequest,
  type ProductEditRequest,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { HttpException } from "@nestjs/common";
import type { PermissionName } from "../identity-access/authorization.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { Server } from "node:https";
import { createServer } from "node:net";
import path from "node:path";
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
import { CatalogDenied, CatalogService } from "./catalog.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "authorization.owner";
const OWNER_PASSWORD = "authorization owner password stays in this test";
const PHARMACIST_USERNAME = "authorization.pharmacist";
const PHARMACIST_PASSWORD =
  "authorization pharmacist password stays in this test";

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: Record<string, unknown> | undefined;
  readonly status: number;
}

describe.sequential("Catalog server-boundary allow/deny matrix", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let ownerId = "";
  let pharmacistId = "";
  let pharmacyId = "";
  let postgres: StartedPostgreSqlContainer;
  let product: Product;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });

    const bootstrapped = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Authorization Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Catalog Authorization Pharmacy",
    });
    expect(bootstrapped.status, failureContext([bootstrapped])).toBe(201);
    const login = await loginAs(OWNER_USERNAME, OWNER_PASSWORD);
    ownerId = String(
      (login.body?.user as { id?: string } | undefined)?.id ?? "",
    );
    pharmacyId = String(
      (login.body?.pharmacy as { id?: string } | undefined)?.id ?? "",
    );

    const created = await request(
      "POST",
      "/catalog/products",
      medicationRequest("Authorization Product"),
    );
    expect(created.status, failureContext([created])).toBe(201);
    product = created.body as unknown as Product;

    const challenge = await request(
      "POST",
      "/identity/step-up-challenges",
      command({ action: "identity.user.create" }),
    );
    expect(challenge.status, failureContext([challenge])).toBe(201);
    const challengeId = String(challenge.body?.id ?? "");
    const approved = await request(
      "POST",
      `/identity/step-up-challenges/${challengeId}/approve`,
      command({ password: OWNER_PASSWORD }),
    );
    expect(approved.status, failureContext([approved])).toBe(200);
    const pharmacistRole = await administrator.query<{ id: string }>(
      "select id from pharmacy_roles where role_key = 'pharmacist'",
    );
    const pharmacist = await request("POST", "/identity/users", {
      challengeId,
      displayName: "Authorization Pharmacist",
      idempotencyKey: createUuidV7(),
      password: PHARMACIST_PASSWORD,
      roleId: pharmacistRole.rows[0]?.id,
      username: PHARMACIST_USERNAME,
    });
    expect(pharmacist.status, failureContext([pharmacist])).toBe(201);
    pharmacistId = String(pharmacist.body?.id ?? "");
  }, 120_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("allows item editing with the matching tenant, active user, verified device, permission, and Free Core entitlement", async () => {
    const login = await loginAs(OWNER_USERNAME, OWNER_PASSWORD);
    expect(login.body?.entitlement).toMatchObject({
      licence: null,
      status: "free-core",
    });
    const edited = await editProduct("Allowed Owner Edit", product.revision, {
      aiSharingAllowed: false,
      externallyVisible: false,
    });
    expect(edited.status, failureContext([edited])).toBe(200);
    expect(edited.body).toMatchObject({
      displayName: "Allowed Owner Edit 20 mg capsule Breev Labs",
      sharing: { aiSharingAllowed: false, externallyVisible: false },
    });
    product = edited.body as unknown as Product;
  });

  it("denies an unauthorized user by default and makes the permission denial auditable", async () => {
    await loginAs(PHARMACIST_USERNAME, PHARMACIST_PASSWORD);
    const body = editBody("Denied Pharmacist Edit", product.revision, {
      aiSharingAllowed: true,
      externallyVisible: true,
    });
    const denied = await request("PUT", productPath(product.id), body);
    expect(denied.status, failureContext([denied])).toBe(403);
    expect(denied.body).toMatchObject({
      code: "permission-denied",
      requiredPermission: "catalog.item.manage",
      status: "denied",
    });
    const audit = await administrator.query<{
      action: string;
      after_state: unknown;
      id: string;
      outcome: string;
    }>(
      "select id, action, outcome, after_state from identity_audit_records where id = $1",
      [denied.body?.requestId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "identity.authorization",
      after_state: { requiredPermission: "catalog.item.manage" },
      id: denied.body?.requestId,
      outcome: "denied",
    });
    expect(await request("GET", productPath(product.id))).toMatchObject({
      status: 403,
      body: { code: "permission-denied" },
    });

    await grantCatalogPermission();
    const allowed = await request("PUT", productPath(product.id), body);
    expect(allowed.status, failureContext([allowed])).toBe(200);
    product = allowed.body as unknown as Product;
  });

  it("allows an active authorized user and denies the same user when locked", async () => {
    const active = await request("GET", productPath(product.id));
    expect(active.status, failureContext([active])).toBe(200);

    await administrator.query(
      "update identity_users set status = 'locked' where id = $1",
      [pharmacistId],
    );
    const locked = await request("PUT", productPath(product.id), {
      ...editBody("Locked User Edit", product.revision, {
        aiSharingAllowed: false,
        externallyVisible: true,
      }),
    });
    expect(locked.status, failureContext([locked])).toBe(401);
    expect(locked.body).toMatchObject({
      code: "session-revoked",
      status: "denied",
    });
    const audit = await administrator.query<{ id: string }>(
      "select id from identity_audit_records where id = $1",
      [locked.body?.requestId],
    );
    expect(audit.rows).toHaveLength(1);
    await administrator.query(
      "update identity_users set status = 'active' where id = $1",
      [pharmacistId],
    );
  });

  it("allows the verified Main device and denies an invalid device binding before item editing", async () => {
    await loginAs(PHARMACIST_USERNAME, PHARMACIST_PASSWORD);
    expect(await request("GET", productPath(product.id))).toMatchObject({
      status: 200,
      body: { id: product.id },
    });

    const invalidCredentials = {
      ...credentials,
      deviceSecret: randomBytes(32).toString("base64url"),
    };
    const denied = await requestWith(
      invalidCredentials,
      "PUT",
      productPath(product.id),
      editBody("Invalid Device Edit", product.revision, {
        aiSharingAllowed: false,
        externallyVisible: false,
      }),
    );
    expect(denied.status, failureContext([denied])).toBe(401);
    expect(denied.body).toMatchObject({
      code: "binding-invalid",
      status: "denied",
    });
    const audit = await administrator.query<{ id: string }>(
      "select id from main_device_recent_denials where id = $1",
      [denied.body?.requestId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("allows the context pharmacy and denies a Product outside that tenant-scoped resource set", async () => {
    expect(await request("GET", productPath(product.id))).toMatchObject({
      status: 200,
      body: { id: product.id },
    });
    const otherTenantProductId = createUuidV7();
    const denied = await request("GET", productPath(otherTenantProductId));
    expect(denied.status, failureContext([denied])).toBe(404);
    expect(denied.body).toMatchObject({
      code: "product-not-found",
      status: "denied",
    });
    const audit = await administrator.query<{
      action: string;
      id: string;
      target_id: string;
    }>(
      "select id, action, target_id from posting_audit_records where id = $1",
      [denied.body?.requestId],
    );
    expect(audit.rows[0]).toEqual({
      action: "catalog.product.read",
      id: denied.body?.requestId,
      target_id: otherTenantProductId,
    });
  });

  it("keeps Catalog in Free Core while the inherited entitlement boundary denies an unavailable paid capability", async () => {
    // The paid route checks permission before entitlement, so the pharmacist
    // needs its permission for the refusal under test to be the entitlement.
    await grantCatalogPermission("pharmacy.settings.manage");
    const paidDenial = await request("POST", "/licensing/capability-proof", {
      capability: "one-way-cloud-sync",
    });
    expect(paidDenial.status, failureContext([paidDenial])).toBe(403);
    expect(paidDenial.body).toMatchObject({
      code: "entitlement-denied",
      requiredCapability: "one-way-cloud-sync",
      status: "denied",
    });

    const allowed = await editProduct(
      "Free Core Catalog Edit",
      product.revision,
      {
        aiSharingAllowed: true,
        externallyVisible: true,
      },
    );
    expect(allowed.status, failureContext([allowed])).toBe(200);
    expect(allowed.body).toMatchObject({
      sharing: { aiSharingAllowed: true, externallyVisible: true },
    });
    product = allowed.body as unknown as Product;

    const licensingAudit = await administrator.query<{
      capability: string;
      outcome: string;
    }>(
      "select capability, outcome from licensing_audit_records where id = $1",
      [paidDenial.body?.requestId],
    );
    expect(licensingAudit.rows[0]).toEqual({
      capability: "one-way-cloud-sync",
      outcome: "denied",
    });
  });

  async function grantCatalogPermission(
    permissionName: PermissionName = "catalog.item.manage",
  ): Promise<void> {
    const role = await administrator.query<{ id: string }>(
      "select role_id as id from identity_users where id = $1",
      [pharmacistId],
    );
    const roleId = role.rows[0]?.id;
    expect(roleId).toBeDefined();
    await administrator.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) values ($1, $2, $4, $3)
       on conflict (role_id, permission_name) do nothing`,
      [pharmacyId, roleId, ownerId, permissionName],
    );
    await administrator.query(
      "update pharmacy_roles set revision = revision + 1 where id = $1",
      [roleId],
    );
    await administrator.query(
      "update pharmacies set identity_revision = identity_revision + 1 where id = $1",
      [pharmacyId],
    );
  }

  async function editProduct(
    tradeName: string,
    expectedRevision: string,
    sharing: ProductCreateRequest["sharing"],
  ): Promise<ApiResponse> {
    return await request(
      "PUT",
      productPath(product.id),
      editBody(tradeName, expectedRevision, sharing),
    );
  }

  function startApi(): ChildProcessWithoutNullStreams {
    const child = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../dist/main.js")],
      {
        env: {
          ...process.env,
          API_HOST: "127.0.0.1",
          API_PORT: String(apiPort),
          BREEV_MAIN_DEVICE_ID: credentials.deviceId,
          BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
          BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
          DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
          DATABASE_URL: databaseRoles.applicationUrl,
          HTTPS_PROXY: "http://127.0.0.1:1",
          HTTP_PROXY: "http://127.0.0.1:1",
        },
      },
    );
    child.stdout.on("data", (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });
    return child;
  }

  async function loginAs(
    username: string,
    password: string,
  ): Promise<ApiResponse> {
    const response = await request("POST", "/identity/login", {
      password,
      username,
    });
    expect(response.status, failureContext([response])).toBe(200);
    return response;
  }

  function failureContext(responses: readonly ApiResponse[]): string {
    return `${apiOutput}\n${JSON.stringify(responses)}`;
  }

  async function request(
    method: "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    return await requestWith(credentials, method, route, body);
  }

  async function requestWith(
    binding: MainDeviceCredentials,
    method: "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: requestHeaders(binding, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body:
        text.length === 0
          ? undefined
          : (JSON.parse(text) as Record<string, unknown>),
      status: response.status,
    };
  }
});

interface PairedTerminal {
  readonly certificatePem: string;
  readonly deviceId: string;
  readonly keys: TerminalKeys;
}

describe.sequential("Catalog Additional POS entitlement boundary", () => {
  const mainDeviceId = "019b0000-0000-7000-8000-0000000007b1";
  const originalEnvironment = { ...process.env };
  let administrator: Pool;
  let catalog: CatalogService;
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
  let postgres: StartedPostgreSqlContainer;
  let product: Product;
  let security: MainDeviceSecurityService;
  let server: Server;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
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
    catalog = new CatalogService(database, identity);
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
    mainApi.put("/catalog/products/:productId", (request, response) => {
      answerTerminal(response, async () =>
        catalog.edit(
          request,
          String(request.params.productId),
          request.body as ProductEditRequest,
        ),
      );
    });

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
        displayName: "Terminal Catalog Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Terminal Catalog Pharmacy",
    });
    ownerId = bootstrapped.user.id;
    pharmacyId = bootstrapped.pharmacy.id;
    await installTerminalLicence(true);
    product = await catalog.create(
      await verifiedMainRequest(),
      medicationRequest("Terminal Catalog Product"),
    );
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

  it("allows an entitled paired terminal and denies it immediately after its entitlement is removed", async () => {
    const terminal = await pairTerminal();
    const login = await terminalCall(terminal, "POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.statusCode).toBe(200);

    const allowed = await terminalCall(
      terminal,
      "PUT",
      productPath(product.id),
      editBody("Entitled Terminal Edit", product.revision, {
        aiSharingAllowed: false,
        externallyVisible: false,
      }),
    );
    expect(allowed.statusCode).toBe(200);
    product = allowed.body as unknown as Product;

    await installTerminalLicence(false);
    const denied = await terminalCall(
      terminal,
      "PUT",
      productPath(product.id),
      editBody("Unentitled Terminal Edit", product.revision, {
        aiSharingAllowed: true,
        externallyVisible: true,
      }),
    );
    expect(denied).toMatchObject({
      statusCode: 403,
      body: {
        code: "entitlement-denied",
        requiredCapability: "additional-device-pos",
        status: "denied",
      },
    });
    const audit = await administrator.query<{
      capability: string;
      outcome: string;
      terminal_device_id: string;
    }>(
      `select capability, outcome, terminal_device_id
       from licensing_audit_records where id = $1`,
      [denied.body.requestId],
    );
    expect(audit.rows[0]).toEqual({
      capability: "additional-device-pos",
      outcome: "denied",
      terminal_device_id: terminal.deviceId,
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
        deviceName: "Catalog Counter",
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
    method: "POST" | "PUT",
    route: string,
    body: unknown,
  ) {
    return await sendTerminalRequest({
      body,
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

function medicationRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "منتج التخويل",
    barcodes: [],
    category: "Authorization",
    definition: {
      fields: {
        dosageForm: "capsule",
        manufacturer: "Breev Labs",
        strength: "20 mg",
        tradeName,
      },
      mode: "medication",
    },
    idempotencyKey: createUuidV7(),
    instructions: {
      foodTiming: "regardless-of-food",
      usesPerDay: 1,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    scientificName: null,
    sharing: { aiSharingAllowed: false, externallyVisible: false },
    stateColours: { coldStorageRequired: false, manual: null },
  };
}

function answerTerminal(
  response: Response,
  work: () => Promise<unknown>,
): void {
  void work()
    .then((body) => response.status(200).json(body))
    .catch((error: unknown) => {
      if (error instanceof CatalogDenied) {
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

function editBody(
  tradeName: string,
  expectedRevision: string,
  sharing: ProductCreateRequest["sharing"],
): ProductCreateRequest & { readonly expectedRevision: string } {
  return { ...medicationRequest(tradeName), expectedRevision, sharing };
}

function command<T extends Record<string, unknown>>(
  body: T,
): T & { idempotencyKey: string } {
  return { ...body, idempotencyKey: createUuidV7() };
}

function requestHeaders(
  credentials: MainDeviceCredentials,
  json: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Breev-Device ${credentials.deviceSecret}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
    Origin: "breev://app",
  };
}

function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: createUuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function createUuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function waitForHealth(
  origin: string,
  diagnostics: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).status === 200) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Local API did not start at ${origin}\n${diagnostics()}`);
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

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
