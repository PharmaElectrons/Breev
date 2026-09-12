import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  IMPLEMENTED_PERMISSION_NAMES,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  countSessionCompletionPath,
  countSessionLinesPath,
  countSessionPath,
  countVarianceApplicationPath,
  type CountLine,
  type CountSession,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchasePostResult,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "inventory.count.auth.owner";
const OWNER_PASSWORD = "inventory count auth owner password stays in this test";

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
  readonly canApprove: boolean;
  readonly canRecord: boolean;
  readonly password: string;
  readonly username: string;
}

describe.sequential(
  "Inventory count server-boundary authorization matrix",
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
    let baseline: { readonly line: CountLine; readonly session: CountSession };
    const actors: Record<string, Actor> = {
      accountant: {
        canApprove: false,
        canRecord: false,
        password: "inventory count accountant password stays in this test",
        username: "inventory.count.auth.accountant",
      },
      custom: {
        canApprove: false,
        canRecord: false,
        password: "inventory count custom password stays in this test",
        username: "inventory.count.auth.custom",
      },
      inventory_employee: {
        canApprove: false,
        canRecord: true,
        password: "inventory count employee password stays in this test",
        username: "inventory.count.auth.employee",
      },
      manager: {
        canApprove: true,
        canRecord: true,
        password: "inventory count manager password stays in this test",
        username: "inventory.count.auth.manager",
      },
      owner: {
        canApprove: true,
        canRecord: true,
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacist: {
        canApprove: false,
        canRecord: true,
        password: "inventory count pharmacist password stays in this test",
        username: "inventory.count.auth.pharmacist",
      },
      purchasing_employee: {
        canApprove: false,
        canRecord: false,
        password: "inventory count purchasing password stays in this test",
        username: "inventory.count.auth.purchasing",
      },
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
          displayName: "Inventory Count Authorization Owner",
          password: OWNER_PASSWORD,
          username: OWNER_USERNAME,
        },
        pharmacyName: "Breev Inventory Count Authorization Pharmacy",
      });
      expect(bootstrap.status, diagnostics(bootstrap)).toBe(201);
      await loginAs(actors.owner!);
      pharmacyId = String(
        (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
      );
      await createUsersAndRoles();
      const product = await createStockedProduct();
      const session = await startSession();
      baseline = await recordLine(session, product.id);
    }, 180_000);

    afterAll(async () => {
      await stopProcess(api);
      await administrator?.end().catch(() => undefined);
      await postgres?.stop().catch(() => undefined);
    });

    it("allows and denies each count command by record and approve permission", async () => {
      for (const [roleKey, actor] of Object.entries(actors)) {
        await loginAs(actor);
        const listed = await request("GET", "/inventory/count-sessions");
        if (!actor.canRecord && !actor.canApprove) {
          expect(listed.status, diagnostics(listed)).toBe(403);
          await expectAudit(listed);
          const deniedStart = await request(
            "POST",
            "/inventory/count-sessions",
            {
              idempotencyKey: uuidV7(),
            },
          );
          expect(deniedStart.status, diagnostics(deniedStart)).toBe(403);
          await expectAudit(deniedStart);
          continue;
        }
        expect(listed.status, diagnostics(listed)).toBe(200);
        if (!actor.canRecord) {
          const deniedRecord = await request(
            "POST",
            countSessionLinesPath(baseline.session.id),
            {
              entries: [inventoryEntry("2")],
              expectedVersion: baseline.session.version,
              idempotencyKey: uuidV7(),
              productId: baseline.line.productId,
            },
          );
          expect(deniedRecord.status, diagnostics(deniedRecord)).toBe(403);
          await expectAudit(deniedRecord);
          const allowedApply = await request(
            "POST",
            countVarianceApplicationPath(baseline.session.id, baseline.line.id),
            applyBody(baseline.session.version, "4"),
          );
          expect(allowedApply.status, diagnostics(allowedApply)).toBe(201);
          continue;
        }

        const product = await createStockedProduct();
        await loginAs(actor);
        const session = await startSession();
        const recorded = await recordLine(session, product.id);
        if (actor.canApprove) {
          const applied = await request(
            "POST",
            countVarianceApplicationPath(session.id, recorded.line.id),
            applyBody(recorded.session.version, "4"),
          );
          expect(applied.status, diagnostics(applied)).toBe(201);
          const completed = await request(
            "POST",
            countSessionCompletionPath(session.id),
            {
              expectedVersion: (applied.body as { session: CountSession })
                .session.version,
              idempotencyKey: uuidV7(),
            },
          );
          expect(completed.status, diagnostics(completed)).toBe(200);
        } else {
          const deniedApply = await request(
            "POST",
            countVarianceApplicationPath(session.id, recorded.line.id),
            applyBody(recorded.session.version, "4"),
          );
          expect(deniedApply.status, diagnostics(deniedApply)).toBe(403);
          await expectAudit(deniedApply);
          const completed = await request(
            "POST",
            `${countSessionPath(session.id)}/completions`,
            {
              expectedVersion: recorded.session.version,
              idempotencyKey: uuidV7(),
            },
          );
          expect(completed.status, diagnostics(completed)).toBe(200);
        }
        expect(roleKey).toMatch(
          /^(owner|manager|pharmacist|inventory_employee)$/u,
        );
      }
    }, 90_000);

    it("lets approve-only users read and apply but not record, and audits required evidence", async () => {
      const approveOnly = await loginByUsername(
        "inventory.count.auth.approver",
        "inventory count approver password stays in this test",
      );
      expect(approveOnly.status, diagnostics(approveOnly)).toBe(200);
      const read = await request("GET", countSessionPath(baseline.session.id));
      expect(read.status, diagnostics(read)).toBe(200);
      const record = await request(
        "POST",
        countSessionLinesPath(baseline.session.id),
        {
          entries: [inventoryEntry("2")],
          expectedVersion: baseline.session.version,
          idempotencyKey: uuidV7(),
          productId: baseline.line.productId,
        },
      );
      expect(record.status, diagnostics(record)).toBe(403);
      await expectAudit(record);

      const reasonMissing = await request(
        "POST",
        countVarianceApplicationPath(baseline.session.id, baseline.line.id),
        {
          evidence: "Evidence",
          expectedBalanceBefore: "4",
          expectedVersion: baseline.session.version,
          idempotencyKey: uuidV7(),
          reason: "",
        },
      );
      expect(reasonMissing.status, diagnostics(reasonMissing)).toBe(400);
      expect(reasonMissing.body).toMatchObject({
        code: "body-invalid",
        fieldErrors: [{ rule: "inventory.count.reason-required" }],
      });
      const evidenceMissing = await request(
        "POST",
        countVarianceApplicationPath(baseline.session.id, baseline.line.id),
        {
          evidence: "",
          expectedBalanceBefore: "4",
          expectedVersion: baseline.session.version,
          idempotencyKey: uuidV7(),
          reason: "Reason",
        },
      );
      expect(evidenceMissing.status, diagnostics(evidenceMissing)).toBe(400);
      expect(evidenceMissing.body).toMatchObject({
        code: "body-invalid",
        fieldErrors: [{ rule: "inventory.count.evidence-required" }],
      });
    });

    it("hides sensitive valuation fields and keeps approved step-up unrelated to count authority", async () => {
      await loginAs(actors.owner!);
      const product = await createStockedProduct();
      const session = await startSession();
      const line = await recordLine(session, product.id);
      const applied = await request(
        "POST",
        countVarianceApplicationPath(session.id, line.line.id),
        applyBody(line.session.version, "4"),
      );
      expect(applied.status, diagnostics(applied)).toBe(201);
      const ownerRead = await request("GET", countSessionPath(session.id));
      expect(ownerRead.status, diagnostics(ownerRead)).toBe(200);
      expect(
        (ownerRead.body as CountSession).lines[0]?.application,
      ).toMatchObject({
        averageUnitCostScaled: expect.any(String),
        carryingAmountFils: expect.any(String),
        journal: expect.objectContaining({
          entryId: expect.any(String),
          templateId: "inventory.count",
        }),
      });
      await loginAs(actors.pharmacist!);
      const pharmacistRead = await request("GET", countSessionPath(session.id));
      expect(pharmacistRead.status, diagnostics(pharmacistRead)).toBe(200);
      expect(
        (pharmacistRead.body as CountSession).lines[0]?.application,
      ).toMatchObject({
        averageUnitCostScaled: null,
        carryingAmountFils: null,
        journal: null,
      });
      const forgedStepUp = await request(
        "POST",
        countVarianceApplicationPath(session.id, line.line.id),
        {
          ...applyBody(line.session.version, "4"),
          challengeId: uuidV7(),
        },
      );
      expect(forgedStepUp.status, diagnostics(forgedStepUp)).toBe(403);
      expect(forgedStepUp.body).toMatchObject({
        code: "permission-denied",
        requiredPermission: "inventory.counts.approve",
      });
      await loginAs(actors.owner!);
      const unknownField = await request(
        "POST",
        countVarianceApplicationPath(session.id, line.line.id),
        {
          ...applyBody(line.session.version, "4"),
          challengeId: uuidV7(),
        },
      );
      expect(unknownField.status, diagnostics(unknownField)).toBe(400);
      expect(unknownField.body).toMatchObject({ code: "body-invalid" });
    });

    it("audits tenant, locked-user, stale-version, and device-boundary denials", async () => {
      await loginAs(actors.owner!);
      const foreign = await request("GET", countSessionPath(uuidV7()));
      expect(foreign.status, diagnostics(foreign)).toBe(404);
      expect(foreign.body).toMatchObject({ code: "count-session-not-found" });
      await expectPostingAudit(foreign);

      const stale = await request(
        "POST",
        countSessionLinesPath(baseline.session.id),
        {
          entries: [inventoryEntry("2")],
          expectedVersion: "1",
          idempotencyKey: uuidV7(),
          productId: baseline.line.productId,
        },
      );
      expect(stale.status, diagnostics(stale)).toBe(409);
      expect(stale.body).toMatchObject({ code: "version-conflict" });
      await expectPostingAudit(stale);

      const invalidDevice = await requestAs(
        { ...credentials, deviceId: uuidV7() },
        "GET",
        "/inventory/count-sessions",
      );
      expect(invalidDevice.status, diagnostics(invalidDevice)).toBe(401);
      const lockedLogin = await loginByUsername(
        "inventory.count.auth.locked",
        "inventory count locked password stays in this test",
      );
      expect(lockedLogin.status, diagnostics(lockedLogin)).toBe(401);
    });

    async function createUsersAndRoles(): Promise<void> {
      const customPermissions = IMPLEMENTED_PERMISSION_NAMES.filter(
        (permission) =>
          permission !== "inventory.counts.approve" &&
          permission !== "inventory.counts.record",
      );
      const customRoleId = await createRole(
        "Count complete except count",
        customPermissions,
      );
      const approverRoleId = await createRole("Count approver only", [
        "inventory.counts.approve",
      ]);
      await createUser("manager", "manager");
      await createUser("pharmacist", "pharmacist");
      await createUser("inventory_employee", "inventory_employee");
      await createUser("purchasing_employee", "purchasing_employee");
      await createUser("accountant", "accountant");
      await createUserByRole(actors.custom!, customRoleId);
      await createUserByRole(
        {
          canApprove: true,
          canRecord: false,
          password: "inventory count approver password stays in this test",
          username: "inventory.count.auth.approver",
        },
        approverRoleId,
      );
      const lockedActor: Actor = {
        canApprove: false,
        canRecord: true,
        password: "inventory count locked password stays in this test",
        username: "inventory.count.auth.locked",
      };
      const locked = await createUserByRole(
        lockedActor,
        await roleIdFor("inventory_employee"),
      );
      const lockedUserId = String((locked.body as { id?: string }).id ?? "");
      const lockChallenge = await createChallenge(
        "identity.user.update",
        lockedUserId,
      );
      const lock = await request("PATCH", `/identity/users/${lockedUserId}`, {
        challengeId: lockChallenge,
        expectedRevision: String(
          (locked.body as { revision?: string }).revision ?? "1",
        ),
        idempotencyKey: uuidV7(),
        status: "locked",
      });
      expect(lock.status, diagnostics(lock)).toBe(200);
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

    async function createChallenge(
      action: string,
      subjectId?: string,
    ): Promise<string> {
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

    async function startSession(): Promise<CountSession> {
      const response = await request("POST", "/inventory/count-sessions", {
        idempotencyKey: uuidV7(),
      });
      expect(response.status, diagnostics(response)).toBe(201);
      return response.body as CountSession;
    }

    async function recordLine(
      session: CountSession,
      productId: string,
    ): Promise<{ readonly line: CountLine; readonly session: CountSession }> {
      const response = await request(
        "POST",
        countSessionLinesPath(session.id),
        {
          entries: [inventoryEntry("3")],
          expectedVersion: session.version,
          idempotencyKey: uuidV7(),
          productId,
        },
      );
      expect(response.status, diagnostics(response)).toBe(201);
      return response.body as { line: CountLine; session: CountSession };
    }

    async function createStockedProduct(): Promise<Product> {
      await loginAs(actors.owner!);
      const created = await request(
        "POST",
        "/catalog/products",
        productRequest(),
      );
      expect(created.status, diagnostics(created)).toBe(201);
      const product = created.body as Product;
      const draftResponse = await request("POST", "/purchases/drafts", {
        idempotencyKey: uuidV7(),
        invoiceDate: "2026-06-15",
        settlementContext: "debt",
        supplierId: await ensureSupplier(),
        supplierInvoiceNumber: `COUNT-AUTH-${String(++invoiceSequence)}`,
      });
      expect(draftResponse.status, diagnostics(draftResponse)).toBe(201);
      let draft = (draftResponse.body as { draft: PurchaseDraft }).draft;
      const rowResponse = await request(
        "POST",
        purchaseDraftRowsPath(draft.id),
        {
          costFils: "1000",
          enteredQuantity: "1",
          expectedVersion: draft.version,
          expiryDate: "2029-12-31",
          idempotencyKey: uuidV7(),
          itemId: product.id,
          lotNumber: `COUNT-AUTH-LOT-${String(invoiceSequence)}`,
          notes: null,
          pricing: { method: "by-price", retailPriceFils: "999999" },
          unit: { kind: "package-unit", packageUnitName: "Pack" },
        },
      );
      expect(rowResponse.status, diagnostics(rowResponse)).toBe(201);
      draft = (rowResponse.body as { draft: PurchaseDraft }).draft;
      const posted = await request(
        "POST",
        purchaseDraftPostingsPath(draft.id),
        { expectedVersion: draft.version, idempotencyKey: uuidV7() },
      );
      expect(posted.status, diagnostics(posted)).toBe(201);
      const result = posted.body as PurchasePostResult;
      expect(result.posted.rows[0]).toBeDefined();
      return product;
    }

    async function ensureSupplier(): Promise<string> {
      if (supplierId !== "") return supplierId;
      const response = await request("POST", "/suppliers", {
        allowanceEffectiveFrom: "2026-01-01",
        defaultAllowancePercentage: "0",
        idempotencyKey: uuidV7(),
        name: "Inventory Count Authorization Supplier",
        terms: "Net 30",
      });
      expect(response.status, diagnostics(response)).toBe(201);
      supplierId = String((response.body as { id: string }).id);
      return supplierId;
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

    async function expectAudit(response: ApiResponse): Promise<void> {
      const requestId = (response.body as { requestId?: string }).requestId;
      expect(requestId).toBeTruthy();
      const found = await administrator.query(
        `select id from identity_audit_records where id = $1`,
        [requestId],
      );
      expect(found.rows).toHaveLength(1);
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

function applyBody(
  expectedVersion: string,
  expectedBalanceBefore: string,
  idempotencyKey = uuidV7(),
) {
  return {
    evidence: "Authorization evidence",
    expectedBalanceBefore,
    expectedVersion,
    idempotencyKey,
    reason: "Authorization count reason",
  };
}

function inventoryEntry(count: string) {
  return { count, unit: { kind: "inventory-unit" } };
}

function productRequest(): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار صلاحيات الجرد",
    barcodes: [
      { kind: "product", value: randomBytes(6).toString("hex").slice(0, 13) },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName: `Authorization count ${uuidV7().slice(0, 8)}`,
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
    stockLevels: { maximumLevel: null, minimumLevel: null, reorderPoint: null },
  };
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
