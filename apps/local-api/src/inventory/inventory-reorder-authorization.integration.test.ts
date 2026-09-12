import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  IMPLEMENTED_PERMISSION_NAMES,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  reorderItemConfirmationsPath,
  reorderItemPath,
  reorderItemRemovalsPath,
  reorderItemReturnsPath,
  reorderItemsPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchasePostResult,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { HttpException } from "@nestjs/common";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
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
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import {
  buildFetchTranscript,
  buildJoinTranscript,
  decodePairingInvitation,
} from "../devices/pairing-domain.js";
import { createPairingChannelHandler } from "../devices/pairing.routes.js";
import { DevicesService } from "../devices/devices.service.js";
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
import { CatalogService } from "../catalog/catalog.service.js";
import { InventoryReorderController } from "./inventory-reorder.controller.js";
import {
  InventoryReorderDenied,
  InventoryReorderService,
} from "./inventory-reorder.service.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "inventory.reorder.authorization.owner";
const OWNER_PASSWORD =
  "inventory reorder authorization owner password stays in this test";

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Actor {
  readonly canConfirm: boolean;
  readonly canManage: boolean;
  readonly password: string;
  readonly username: string;
}

interface ReorderItem {
  readonly id: string;
  readonly productId: string;
  readonly version: string;
  readonly quantity: string;
  readonly status: "basket" | "ordered";
}

interface ReorderResponse {
  readonly item: ReorderItem;
  readonly outcome?: string;
}

describe.sequential(
  "Inventory reorder server-boundary authorization matrix",
  () => {
    let administrator: Pool;
    let api: ChildProcessWithoutNullStreams;
    let apiOrigin = "";
    let apiOutput = "";
    let apiPort = 0;
    let credentials: Credentials;
    let databaseRoles: SeparatedDatabaseRoles;
    let postgres: StartedPostgreSqlContainer | undefined;
    let pharmacyId = "";
    let supplierId = "";
    let invoiceSequence = 0;

    const actors: Record<string, Actor> = {
      accountant: actor("accountant", false, false),
      confirmOnly: actor("confirm-only", false, true),
      custom: actor("custom", false, false),
      inventory_employee: actor("inventory-employee", true, false),
      manager: actor("manager", true, true),
      owner: {
        canConfirm: true,
        canManage: true,
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacist: actor("pharmacist", true, false),
      purchasing_employee: actor("purchasing", true, true),
      sales_employee: actor("sales", true, false),
    };

    beforeAll(async () => {
      const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
      if (administratorUrl === undefined) {
        postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
        databaseRoles = await createSeparatedDatabaseRoles(postgres);
      } else {
        databaseRoles =
          await createSeparatedDatabaseRolesFromUrl(administratorUrl);
      }
      credentials = createCredentials();
      apiPort = await reservePort();
      apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
      api = startApi();
      await waitForHealth(apiOrigin, () => apiOutput);
      administrator = new Pool({
        connectionString: databaseRoles.migrationUrl,
      });

      const bootstrap = await request("POST", "/identity/bootstrap", {
        owner: {
          displayName: "Inventory Reorder Authorization Owner",
          password: OWNER_PASSWORD,
          username: OWNER_USERNAME,
        },
        pharmacyName: "Breev Inventory Reorder Authorization Pharmacy",
      });
      expect(bootstrap.status, diagnostics(bootstrap)).toBe(201);
      await loginAs(actors.owner!);
      pharmacyId = String(
        (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
      );
      await createUsersAndRoles();
      await ensureSupplier();
    }, 180_000);

    afterAll(async () => {
      await stopProcess(api);
      await administrator?.end().catch(() => undefined);
      await postgres?.stop().catch(() => undefined);
    });

    it("allows the split permissions and audits every denied command", async () => {
      for (const [roleKey, actor] of Object.entries(actors)) {
        await loginAs(actor);
        const listed = await request("GET", "/inventory/reorder-basket");
        if (!actor.canManage && !actor.canConfirm) {
          expect(listed.status, diagnostics(listed)).toBe(403);
          await expectIdentityAudit(listed, "inventory.reorder.manage");
          const deniedProduct = await createProduct(`Denied add ${roleKey}`);
          await loginAs(actor);
          const deniedAdd = await request("POST", reorderItemsPath(), {
            idempotencyKey: uuidV7(),
            productId: deniedProduct.id,
          });
          expect(deniedAdd.status, diagnostics(deniedAdd)).toBe(403);
          await expectIdentityAudit(deniedAdd, "inventory.reorder.manage");
          continue;
        }
        expect(listed.status, diagnostics(listed)).toBe(200);

        if (actor.canManage) {
          const product = await createProduct(`Manage ${roleKey}`);
          const row = await addAsOwner(product.id);
          await loginAs(actor);
          const updated = await request("PUT", reorderItemPath(row.id), {
            expectedVersion: row.version,
            idempotencyKey: uuidV7(),
            quantity: "3",
          });
          expect(updated.status, diagnostics(updated)).toBe(200);
          const removed = await request(
            "POST",
            reorderItemRemovalsPath(row.id),
            transitionBody((updated.body as ReorderResponse).item.version),
          );
          expect(removed.status, diagnostics(removed)).toBe(200);
        } else {
          const product = await createProduct(`Confirm only manage ${roleKey}`);
          const row = await addAsOwner(product.id);
          await loginAs(actor);
          const deniedAdd = await request("POST", reorderItemsPath(), {
            idempotencyKey: uuidV7(),
            productId: product.id,
          });
          expect(deniedAdd.status, diagnostics(deniedAdd)).toBe(403);
          await expectIdentityAudit(deniedAdd, "inventory.reorder.manage");
          const deniedUpdate = await request("PUT", reorderItemPath(row.id), {
            expectedVersion: row.version,
            idempotencyKey: uuidV7(),
            quantity: "3",
          });
          expect(deniedUpdate.status, diagnostics(deniedUpdate)).toBe(403);
          await expectIdentityAudit(deniedUpdate, "inventory.reorder.manage");
          const deniedRemove = await request(
            "POST",
            reorderItemRemovalsPath(row.id),
            transitionBody(row.version),
          );
          expect(deniedRemove.status, diagnostics(deniedRemove)).toBe(403);
          await expectIdentityAudit(deniedRemove, "inventory.reorder.manage");
        }

        const confirmProduct = await createProduct(`Confirm ${roleKey}`);
        const confirmRow = await addAsOwner(confirmProduct.id);
        await loginAs(actor);
        const confirm = await request(
          "POST",
          reorderItemConfirmationsPath(confirmRow.id),
          transitionBody(confirmRow.version),
        );
        if (actor.canConfirm) {
          expect(confirm.status, diagnostics(confirm)).toBe(200);
          const ordered = (confirm.body as ReorderResponse).item;
          const returned = await request(
            "POST",
            reorderItemReturnsPath(ordered.id),
            transitionBody(ordered.version),
          );
          expect(returned.status, diagnostics(returned)).toBe(200);
        } else {
          expect(confirm.status, diagnostics(confirm)).toBe(403);
          await expectIdentityAudit(confirm, "inventory.reorder.confirm");
          const deniedReturn = await request(
            "POST",
            reorderItemReturnsPath(confirmRow.id),
            transitionBody(confirmRow.version),
          );
          expect(deniedReturn.status, diagnostics(deniedReturn)).toBe(403);
          await expectIdentityAudit(deniedReturn, "inventory.reorder.confirm");
        }
      }
    }, 180_000);

    it("audits tenant, locked-user, device, step-up, and expected-version boundaries", async () => {
      await loginAs(actors.owner!);
      const product = await createProduct("Authorization boundaries");
      const row = await addAsOwner(product.id);

      const foreign = await request("PUT", reorderItemPath(uuidV7()), {
        expectedVersion: row.version,
        idempotencyKey: uuidV7(),
        quantity: "3",
      });
      expect(foreign.status, diagnostics(foreign)).toBe(404);
      expect(foreign.body).toMatchObject({ code: "reorder-item-not-found" });
      await expectPostingAudit(foreign);

      const advanced = await request("PUT", reorderItemPath(row.id), {
        expectedVersion: row.version,
        idempotencyKey: uuidV7(),
        quantity: "5",
      });
      expect(advanced.status, diagnostics(advanced)).toBe(200);
      // The row moved on; the original version is now stale.
      const stale = await request("PUT", reorderItemPath(row.id), {
        expectedVersion: row.version,
        idempotencyKey: uuidV7(),
        quantity: "4",
      });
      expect(stale.status, diagnostics(stale)).toBe(409);
      expect(stale.body).toMatchObject({ code: "version-conflict" });
      await expectPostingAudit(stale);

      const invalidDevice = await requestAs(
        { ...credentials, deviceId: uuidV7() },
        "GET",
        "/inventory/reorder-basket",
      );
      expect(invalidDevice.status, diagnostics(invalidDevice)).toBe(401);
      const missingDevice = await requestWithoutDevice(
        "GET",
        "/inventory/reorder-basket",
      );
      expect(missingDevice.status, diagnostics(missingDevice)).toBe(401);

      const locked = await createLockedUser();
      const lockedLogin = await loginByUsername(
        locked.username,
        locked.password,
      );
      expect(lockedLogin.status, diagnostics(lockedLogin)).toBe(401);

      const challenge = await createChallenge("inventory.sensitive.export");
      expect(challenge).toBeTruthy();
      await loginAs(actors.inventory_employee!);
      const forgedStepUp = await request(
        "POST",
        reorderItemConfirmationsPath(row.id),
        transitionBody(row.version),
      );
      expect(forgedStepUp.status, diagnostics(forgedStepUp)).toBe(403);
      expect(forgedStepUp.body).toMatchObject({ code: "permission-denied" });
    }, 90_000);

    async function createUsersAndRoles(): Promise<void> {
      const customPermissions = IMPLEMENTED_PERMISSION_NAMES.filter(
        (permission) =>
          permission !== "inventory.reorder.confirm" &&
          permission !== "inventory.reorder.manage",
      );
      const customRoleId = await createRole(
        "Reorder all except reorder",
        customPermissions,
      );
      const confirmOnlyRoleId = await createRole("Reorder confirm only", [
        "inventory.reorder.confirm",
      ]);
      for (const roleKey of [
        "manager",
        "pharmacist",
        "inventory_employee",
        "purchasing_employee",
        "sales_employee",
        "accountant",
      ]) {
        await createUser(roleKey, roleKey);
      }
      await createUserByRole(actors.custom!, customRoleId);
      await createUserByRole(actors.confirmOnly!, confirmOnlyRoleId);
    }

    async function createRole(
      name: string,
      permissions: readonly string[],
    ): Promise<string> {
      await loginAs(actors.owner!);
      const challenge = await createChallenge("identity.role.create");
      const response = await request("POST", "/identity/roles", {
        challengeId: challenge,
        idempotencyKey: uuidV7(),
        name,
        permissions,
      });
      expect(response.status, diagnostics(response)).toBe(201);
      return String((response.body as { id?: string }).id ?? "");
    }

    async function createUser(
      roleKey: string,
      actorKey: string,
    ): Promise<void> {
      await createUserByRole(actors[actorKey]!, await roleIdFor(roleKey));
    }

    async function createUserByRole(
      actor: Actor,
      roleId: string,
    ): Promise<ApiResponse> {
      await loginAs(actors.owner!);
      const challenge = await createChallenge("identity.user.create");
      const response = await request("POST", "/identity/users", {
        challengeId: challenge,
        displayName: actor.username,
        idempotencyKey: uuidV7(),
        password: actor.password,
        roleId,
        username: actor.username,
      });
      expect(response.status, diagnostics(response)).toBe(201);
      return response;
    }

    async function createLockedUser(): Promise<Actor> {
      const locked = actor("locked", true, false);
      const created = await createUserByRole(
        locked,
        await roleIdFor("inventory_employee"),
      );
      const userId = String((created.body as { id?: string }).id ?? "");
      const challenge = await createChallenge("identity.user.update", userId);
      await request("PATCH", `/identity/users/${userId}`, {
        challengeId: challenge,
        expectedRevision: String(
          (created.body as { revision?: string }).revision ?? "1",
        ),
        idempotencyKey: uuidV7(),
        status: "locked",
      });
      return locked;
    }

    async function createChallenge(
      action: string,
      subjectId?: string,
    ): Promise<string> {
      await loginAs(actors.owner!);
      const created = await request("POST", "/identity/step-up-challenges", {
        action,
        idempotencyKey: uuidV7(),
        ...(subjectId === undefined ? {} : { subjectId }),
      });
      expect(created.status, diagnostics(created)).toBe(201);
      const challengeId = String((created.body as { id?: string }).id ?? "");
      const approved = await request(
        "POST",
        `/identity/step-up-challenges/${challengeId}/approve`,
        { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
      );
      expect(approved.status, diagnostics(approved)).toBe(200);
      return challengeId;
    }

    async function roleIdFor(roleKey: string): Promise<string> {
      const result = await administrator.query<{ id: string }>(
        `select id from pharmacy_roles where pharmacy_id = $1 and role_key = $2`,
        [pharmacyId, roleKey],
      );
      return result.rows[0]?.id ?? "";
    }

    async function addAsOwner(productId: string): Promise<ReorderItem> {
      await loginAs(actors.owner!);
      const response = await request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId,
      });
      expect(response.status, diagnostics(response)).toBe(200);
      return (response.body as ReorderResponse).item;
    }

    async function createProduct(name: string): Promise<Product> {
      await loginAs(actors.owner!);
      const created = await request(
        "POST",
        "/catalog/products",
        productRequest(name),
      );
      expect(created.status, diagnostics(created)).toBe(201);
      const product = created.body as Product;
      await purchaseProduct(product);
      return product;
    }

    async function purchaseProduct(product: Product): Promise<void> {
      const draftResponse = await request("POST", "/purchases/drafts", {
        idempotencyKey: uuidV7(),
        invoiceDate: "2026-06-15",
        settlementContext: "debt",
        supplierId: await ensureSupplier(),
        supplierInvoiceNumber: `REORDER-AUTH-${String(++invoiceSequence)}`,
      });
      expect(draftResponse.status, diagnostics(draftResponse)).toBe(201);
      let draft = (draftResponse.body as { draft: PurchaseDraft }).draft;
      const row = await request("POST", purchaseDraftRowsPath(draft.id), {
        costFils: "1000",
        enteredQuantity: "1",
        expectedVersion: draft.version,
        expiryDate: "2029-12-31",
        idempotencyKey: uuidV7(),
        itemId: product.id,
        lotNumber: `REORDER-AUTH-LOT-${String(invoiceSequence)}`,
        notes: null,
        pricing: { method: "by-price", retailPriceFils: "999999" },
        unit: { kind: "package-unit", packageUnitName: "Pack" },
      });
      expect(row.status, diagnostics(row)).toBe(201);
      draft = (row.body as { draft: PurchaseDraft }).draft;
      const posted = await request(
        "POST",
        purchaseDraftPostingsPath(draft.id),
        {
          expectedVersion: draft.version,
          idempotencyKey: uuidV7(),
        },
      );
      expect(posted.status, diagnostics(posted)).toBe(201);
      expect((posted.body as PurchasePostResult).posted.rows[0]).toBeDefined();
    }

    async function ensureSupplier(): Promise<string> {
      if (supplierId !== "") return supplierId;
      const response = await request("POST", "/suppliers", {
        allowanceEffectiveFrom: "2026-01-01",
        defaultAllowancePercentage: "0",
        idempotencyKey: uuidV7(),
        name: "Inventory Reorder Authorization Supplier",
        terms: "Net 30",
      });
      expect(response.status, diagnostics(response)).toBe(201);
      supplierId = String((response.body as { id: string }).id);
      return supplierId;
    }

    async function expectIdentityAudit(
      response: ApiResponse,
      permission: string,
    ): Promise<void> {
      const requestId = (response.body as { requestId?: string }).requestId;
      expect(requestId).toBeTruthy();
      const found = await administrator.query<{
        required_permission: string;
      }>(
        `select after_state->>'requiredPermission' as required_permission
       from identity_audit_records where id = $1`,
        [requestId],
      );
      expect(found.rows[0]?.required_permission).toBe(permission);
    }

    async function expectPostingAudit(response: ApiResponse): Promise<void> {
      const requestId = (response.body as { requestId?: string }).requestId;
      expect(requestId).toBeTruthy();
      const found = await administrator.query(
        `select id from posting_audit_records where id = $1`,
        [requestId],
      );
      expect(found.rows).toHaveLength(1);
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

    async function loginAs(actor: Actor): Promise<ApiResponse> {
      return await loginByUsername(actor.username, actor.password);
    }

    async function loginByUsername(
      username: string,
      password: string,
    ): Promise<ApiResponse> {
      return await request("POST", "/identity/login", { password, username });
    }

    async function request(
      method: "GET" | "PATCH" | "POST" | "PUT",
      route: string,
      body?: unknown,
    ): Promise<ApiResponse> {
      return await requestAs(credentials, method, route, body);
    }

    async function requestAs(
      binding: Credentials,
      method: "GET" | "PATCH" | "POST" | "PUT",
      route: string,
      body?: unknown,
    ): Promise<ApiResponse> {
      const response = await fetch(`${apiOrigin}${route}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: headers(binding, body !== undefined),
        method,
      });
      const text = await response.text();
      return {
        body: text === "" ? undefined : (JSON.parse(text) as unknown),
        status: response.status,
      };
    }

    async function requestWithoutDevice(
      method: "GET" | "PATCH" | "POST" | "PUT",
      route: string,
    ): Promise<ApiResponse> {
      const response = await fetch(`${apiOrigin}${route}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Breev-Device ${credentials.deviceSecret}`,
          [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
          Origin: "breev://app",
        },
        method,
      });
      const text = await response.text();
      return {
        body: text === "" ? undefined : (JSON.parse(text) as unknown),
        status: response.status,
      };
    }

    function diagnostics(response: ApiResponse): string {
      return `${apiOutput}\n${JSON.stringify(response)}`;
    }

    function headers(
      binding: Credentials,
      json: boolean,
    ): Record<string, string> {
      return {
        Accept: "application/json",
        Authorization: `Breev-Device ${binding.deviceSecret}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
        [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
        [LOCAL_DEVICE_ID_HEADER]: binding.deviceId,
        [LOCAL_DEVICE_SESSION_HEADER]: binding.sessionToken,
        Origin: "breev://app",
      };
    }
  },
);

interface PairedTerminal {
  readonly certificatePem: string;
  readonly deviceId: string;
  readonly keys: TerminalKeys;
}

describe.sequential("Inventory reorder POS entitlement boundary", () => {
  const mainDeviceId = "019b0000-0000-7000-8000-0000000007c1";
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
  let postgres: StartedPostgreSqlContainer | undefined;
  let product: Product;
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
    catalog = new CatalogService(database, identity);
    const reorder = new InventoryReorderController(
      new InventoryReorderService(database, identity),
    );
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
    mainApi.post(reorderItemsPath(), (request, response) => {
      answerTerminal(response, async () =>
        reorder.add(request.body as never, request),
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
        displayName: "Inventory Reorder Terminal Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Inventory Reorder Terminal Pharmacy",
    });
    ownerId = bootstrapped.user.id;
    pharmacyId = bootstrapped.pharmacy.id;
    await installTerminalLicence(true);
    product = await catalog.create(
      await verifiedMainRequest(),
      productRequest("Inventory Reorder Terminal Product"),
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

  it("allows an entitled terminal and denies it after entitlement removal", async () => {
    const terminal = await pairTerminal();
    const login = await terminalCall(terminal, "POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.statusCode).toBe(200);

    const allowed = await terminalCall(terminal, "POST", reorderItemsPath(), {
      idempotencyKey: uuidV7(),
      productId: product.id,
    });
    expect(allowed.statusCode).toBe(200);

    await installTerminalLicence(false);
    const denied = await terminalCall(terminal, "POST", reorderItemsPath(), {
      idempotencyKey: uuidV7(),
      productId: product.id,
    });
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
        licenceId: uuidV7(),
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
      idempotencyKey: uuidV7(),
    });
    await identity.approveStepUp(await verifiedMainRequest(), challenge.id, {
      idempotencyKey: uuidV7(),
      password: OWNER_PASSWORD,
    });
    const started = await devices.startPairingSession(
      await verifiedMainRequest(),
      { idempotencyKey: uuidV7(), stepUpChallengeId: challenge.id },
    );
    if (started.qrUri === undefined)
      throw new Error("Missing pairing invitation");
    const invitation = decodePairingInvitation(started.qrUri);
    if (invitation === undefined) throw new Error("Invalid pairing invitation");
    const keys = createTerminalKeys();
    const joined = await sendTerminalRequest({
      body: {
        csrPem: buildCertificateRequest(keys),
        deviceName: "Reorder Counter",
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
      { idempotencyKey: uuidV7() },
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
    method: "POST",
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

function actor(name: string, canManage: boolean, canConfirm: boolean): Actor {
  return {
    canConfirm,
    canManage,
    password: `inventory reorder authorization ${name} password stays in this test`,
    username: `inventory.reorder.authorization.${name}`,
  };
}

function productRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار صلاحيات سلة الطلبات",
    barcodes: [
      { kind: "product", value: randomBytes(6).toString("hex").slice(0, 13) },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName,
      },
      mode: "medication",
    },
    idempotencyKey: uuidV7(),
    instructions: {
      foodTiming: "after-food",
      usesPerDay: 3,
      usesPerMonth: null,
      usesPerWeek: null,
    },
    packaging: {
      defaultUnits: {
        count: { kind: "package-unit", packageUnitName: "Pack" },
        purchase: { kind: "package-unit", packageUnitName: "Pack" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Strip",
      packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
      thirdUnit: null,
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: "90000",
    },
    scientificName: "Paracetamol",
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: "blue" },
    stockLevels: { maximumLevel: "60", minimumLevel: "10", reorderPoint: "20" },
  };
}

function answerTerminal(
  response: Response,
  work: () => Promise<unknown>,
): void {
  void work()
    .then((body) => response.status(200).json(body))
    .catch((error: unknown) => {
      if (error instanceof InventoryReorderDenied) {
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

function transitionBody(expectedVersion: string) {
  return { expectedVersion, idempotencyKey: uuidV7() };
}

function createCredentials(): Credentials {
  return {
    deviceId: uuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function uuidV7(): string {
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).status === 200) return;
    } catch {
      // The compiled API has not opened its loopback listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local API did not start\n${diagnostics()}`);
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a port"));
      } else {
        resolve(address.port);
      }
    });
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

async function stopProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
