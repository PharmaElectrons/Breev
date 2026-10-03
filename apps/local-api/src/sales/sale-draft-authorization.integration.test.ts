import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  IMPLEMENTED_PERMISSION_NAMES,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  saleDrawerBalancePath,
  saleDraftClearPath,
  saleDraftDiscardsPath,
  saleDraftDiscountPath,
  saleDraftLineChangesPath,
  saleDraftLinePriceOverridePath,
  saleDraftLineRemovalsPath,
  saleDraftLinesPath,
  saleDraftMiscLinesPath,
  saleDraftPath,
  saleDraftResumptionsPath,
  saleDraftSuspensionsPath,
  saleDraftsPath,
  saleProductContextPath,
  saleQuickAccessPath,
  type Product,
  type ProductCreateRequest,
  type SaleDraft,
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

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "sale.draft.authorization.owner";
const OWNER_PASSWORD =
  "sale draft authorization owner password stays in this test";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface Actor {
  readonly password: string;
  readonly username: string;
}

interface RawDraft {
  readonly created_at: string;
  readonly created_by: string;
  readonly device_id: string;
  readonly id: string;
  readonly pharmacy_id: string;
  readonly status: string;
  readonly updated_at: string;
  readonly updated_by: string;
  readonly version: string;
}

describe.sequential("Sale Draft server-boundary authorization matrix", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId = "";

  const actors = {
    customAllowed: actor("custom-allowed"),
    customDenied: actor("custom-denied"),
    customDrawerAllowed: actor("custom-drawer-allowed"),
    customDrawerOnly: actor("custom-drawer-only"),
    customDrawerPeer: actor("custom-drawer-peer"),
    customWholesaleAllowed: actor("custom-wholesale-allowed"),
    manager: actor("manager"),
    owner: { password: OWNER_PASSWORD, username: OWNER_USERNAME },
    salesEmployee: actor("sales-employee"),
  } as const;

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
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });

    const bootstrap = await request("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Sale Draft Authorization Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Sale Draft Authorization Pharmacy",
    });
    expect(bootstrap.status, diagnostics(bootstrap)).toBe(201);
    pharmacyId = String(
      (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
    await loginAs(actors.owner);

    const deniedRole = await createRole("Sale Draft denied", [
      "catalog.item.search",
    ]);
    const allowedRole = await createRole("Sale Draft allowed", [
      "catalog.item.search",
      "sales.drafts.manage",
    ]);
    const drawerAllowedRole = await createRole("Sale drawer allowed", [
      "sales.drafts.manage",
      "sales.drawer_balance.view",
    ]);
    const drawerOnlyRole = await createRole("Sale drawer only", [
      "sales.drawer_balance.view",
    ]);
    const wholesaleAllowedRole = await createRole("Sale wholesale allowed", [
      "catalog.item.search",
      "sales.drafts.manage",
      "sales.wholesale_price.view",
    ]);
    await createUser(actors.customDenied, deniedRole);
    await createUser(actors.customAllowed, allowedRole);
    await createUser(actors.customDrawerAllowed, drawerAllowedRole);
    await createUser(actors.customDrawerPeer, drawerAllowedRole);
    await createUser(actors.customDrawerOnly, drawerOnlyRole);
    await createUser(actors.customWholesaleAllowed, wholesaleAllowedRole);
    await createUser(actors.manager, await roleIdFor("manager"));
    await createUser(actors.salesEmployee, await roleIdFor("sales_employee"));
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("allows the built-in sales employee and a custom role with Sale access", async () => {
    for (const actorToTest of [actors.salesEmployee, actors.customAllowed]) {
      const login = await loginAs(actorToTest);
      expect(login.status, diagnostics(login)).toBe(200);
      const created = await createDraft();
      const listed = await request("GET", saleDraftsPath());
      expect(listed.status, diagnostics(listed)).toBe(200);
      expect(
        (listed.body as { drafts: readonly SaleDraft[] }).drafts,
      ).toContainEqual(created);
      const read = await request("GET", saleDraftPath(created.id));
      expect(read.status, diagnostics(read)).toBe(200);
      expect(read.body).toEqual(created);
    }
  });

  it("lets cashiers read quick access while only managers may replace settings", async () => {
    await loginAs(actors.owner);
    const original = await request("GET", saleQuickAccessPath());
    expect(original.status, diagnostics(original)).toBe(200);
    await loginAs(actors.salesEmployee);
    const read = await request("GET", saleQuickAccessPath());
    expect(read.status, diagnostics(read)).toBe(200);
    expect(read.body).toEqual(original.body);
    const deniedChange = await request("POST", saleQuickAccessPath(), {
      expectedVersion: "1",
      idempotencyKey: uuidV7(),
      categories: [],
    });
    expect(deniedChange.status, diagnostics(deniedChange)).toBe(403);
    await expectIdentityAudit(deniedChange, "sales.quick_access.manage");
    await loginAs(actors.owner);
    expect((await request("GET", saleQuickAccessPath())).body).toEqual(
      original.body,
    );
  });

  it("requires both Sale access and drawer-balance permission", async () => {
    for (const actorToTest of [actors.owner, actors.manager]) {
      await loginAs(actorToTest);
      const allowed = await request("GET", saleDrawerBalancePath());
      expect(allowed.status, diagnostics(allowed)).toBe(200);
      expect(allowed.body).toEqual({ balanceFils: null });
    }

    for (const actorToTest of [actors.customAllowed, actors.salesEmployee]) {
      await loginAs(actorToTest);
      const denied = await request("GET", saleDrawerBalancePath());
      expect(denied.status, diagnostics(denied)).toBe(403);
      await expectIdentityAudit(denied, "sales.drawer_balance.view");
    }

    await loginAs(actors.customDrawerOnly);
    const missingSalePermission = await request("GET", saleDrawerBalancePath());
    expect(
      missingSalePermission.status,
      diagnostics(missingSalePermission),
    ).toBe(403);
    await expectIdentityAudit(missingSalePermission, "sales.drafts.manage");
  });

  it("returns only the authenticated employee's assigned cash balance", async () => {
    await loginAs(actors.owner);
    await insertBalancedDrawerJournal();

    await loginAs(actors.customDrawerAllowed);
    const drawerBalance = await request("GET", saleDrawerBalancePath());
    expect(drawerBalance.status, diagnostics(drawerBalance)).toBe(200);
    expect(drawerBalance.body).toEqual({ balanceFils: "12500" });

    await loginAs(actors.customDrawerPeer);
    const peerBalance = await request("GET", saleDrawerBalancePath());
    expect(peerBalance.status, diagnostics(peerBalance)).toBe(200);
    expect(peerBalance.body).toEqual({ balanceFils: "7000" });
  });

  it("returns wholesale price only to a role with the exact view grant", async () => {
    await loginAs(actors.owner);
    const product = await createProduct("Sale context permission item");

    for (const actorToTest of [
      actors.owner,
      actors.manager,
      actors.customWholesaleAllowed,
    ]) {
      await loginAs(actorToTest);
      const allowed = await request("GET", saleProductContextPath(product.id));
      expect(allowed.status, diagnostics(allowed)).toBe(200);
      expect(allowed.body).toMatchObject({ wholesalePriceFils: "90000" });
    }

    for (const actorToTest of [actors.customAllowed, actors.salesEmployee]) {
      await loginAs(actorToTest);
      const visible = await request("GET", saleProductContextPath(product.id));
      expect(visible.status, diagnostics(visible)).toBe(200);
      expect(visible.body).toMatchObject({ wholesalePriceFils: null });
    }
  });

  it("denies a Sales cashier a manual price override before touching the draft", async () => {
    await loginAs(actors.owner);
    const draft = await createDraft();
    const before = await draftSnapshot(draft.id);
    await loginAs(actors.salesEmployee);
    const denied = await request(
      "POST",
      saleDraftLinePriceOverridePath(draft.id, uuidV7()),
      {
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
        unitPriceFils: "1",
        reason: "Unauthorized request",
      },
    );
    expect(denied.status, diagnostics(denied)).toBe(403);
    await expectIdentityAudit(denied, "draft.price.override");
    await loginAs(actors.owner);
    expect(await draftSnapshot(draft.id)).toEqual(before);
  });

  it("denies a custom role with no sales grant and leaves the draft byte-identical", async () => {
    await loginAs(actors.owner);
    const draft = await createDraft();
    const before = await draftSnapshot(draft.id);
    await loginAs(actors.customDenied);
    const list = await request("GET", saleDraftsPath());
    const create = await request("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    const read = await request("GET", saleDraftPath(draft.id));
    for (const response of [list, create, read]) {
      expect(response.status, diagnostics(response)).toBe(403);
      await expectIdentityAudit(response, "sales.drafts.manage");
      expect(await draftSnapshot(draft.id)).toEqual(before);
    }
  });

  it("denies draft mutations to a role without Sale access before changing the draft", async () => {
    await loginAs(actors.owner);
    const product = await createProduct("Denied draft mutation item");
    const draft = await createDraft();
    const added = await request("POST", saleDraftLinesPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
      productId: product.id,
    });
    expect(added.status, diagnostics(added)).toBe(200);
    const draftWithLine = added.body as SaleDraft;
    const lineId = String(draftWithLine.lines[0]?.id ?? "");
    expect(lineId).not.toBe("");
    const before = await draftSnapshot(draft.id);
    const expectedVersion = draftWithLine.version;

    await loginAs(actors.customDenied);
    const deniedCommands = [
      {
        body: { expectedVersion, idempotencyKey: uuidV7() },
        route: saleDraftResumptionsPath(draft.id),
      },
      {
        body: {
          expectedVersion,
          idempotencyKey: uuidV7(),
          productId: product.id,
        },
        route: saleDraftLinesPath(draft.id),
      },
      {
        body: {
          displayName: "Delivery service",
          expectedVersion,
          idempotencyKey: uuidV7(),
          quantity: "1",
          unitName: "service",
          unitPriceFils: "1000",
        },
        route: saleDraftMiscLinesPath(draft.id),
      },
      {
        body: {
          expectedVersion,
          idempotencyKey: uuidV7(),
          quantity: "2",
        },
        route: saleDraftLineChangesPath(draft.id, lineId),
      },
      {
        body: {
          expectedVersion,
          idempotencyKey: uuidV7(),
          unitPriceFils: "90000",
          reason: "Manager approved",
        },
        route: saleDraftLinePriceOverridePath(draft.id, lineId),
      },
      {
        body: { expectedVersion, idempotencyKey: uuidV7() },
        route: saleDraftLineRemovalsPath(draft.id, lineId),
      },
      {
        body: {
          expectedVersion,
          idempotencyKey: uuidV7(),
          invoiceDiscountFils: "0",
        },
        route: saleDraftDiscountPath(draft.id),
      },
      {
        body: { expectedVersion, idempotencyKey: uuidV7() },
        route: saleDraftClearPath(draft.id),
      },
      {
        body: { expectedVersion, idempotencyKey: uuidV7() },
        route: saleDraftSuspensionsPath(draft.id),
      },
      {
        body: { expectedVersion, idempotencyKey: uuidV7() },
        route: saleDraftDiscardsPath(draft.id),
      },
    ];

    for (const command of deniedCommands) {
      const denied = await request("POST", command.route, command.body);
      expect(denied.status, diagnostics(denied)).toBe(403);
      await expectIdentityAudit(denied, "sales.drafts.manage");
      expect(await draftSnapshot(draft.id)).toEqual(before);
    }
  });

  it("requires misc-line permission even when the request body is malformed", async () => {
    await loginAs(actors.owner);
    const draft = await createDraft();
    const before = await draftSnapshot(draft.id);

    await loginAs(actors.customAllowed);
    const denied = await request("POST", saleDraftMiscLinesPath(draft.id), {
      displayName: "Delivery service",
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
      unitName: "service",
      unitPriceFils: "1000",
    });
    expect(denied.status, diagnostics(denied)).toBe(403);
    await expectIdentityAudit(denied, "sales.misc.manage");
    expect(await draftSnapshot(draft.id)).toEqual(before);
  });

  it("keeps tenant, revoked-session, wrong-device, and absent-device denials outside the draft", async () => {
    await loginAs(actors.owner);
    const draft = await createDraft();
    const before = await draftSnapshot(draft.id);

    const foreign = await request("GET", saleDraftPath(uuidV7()));
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: "sale-draft-not-found" });
    expect(await draftSnapshot(draft.id)).toEqual(before);

    const wrongDevice = await requestAs(
      { ...credentials, deviceId: uuidV7() },
      "GET",
      saleDraftPath(draft.id),
    );
    expect(wrongDevice.status).toBe(401);
    expect(await draftSnapshot(draft.id)).toEqual(before);

    const absentDevice = await requestWithoutDevice(
      "GET",
      saleDraftPath(draft.id),
    );
    expect(absentDevice.status).toBe(401);
    expect(await draftSnapshot(draft.id)).toEqual(before);

    const logout = await request("POST", "/identity/logout", {});
    expect(logout.status, diagnostics(logout)).toBe(204);
    const revoked = await request("GET", saleDraftPath(draft.id));
    expect(revoked.status).toBe(401);
    expect(await draftSnapshot(draft.id)).toEqual(before);
  });

  it("keeps the implemented permission vocabulary grantable for custom roles", async () => {
    const roles = await request("GET", "/identity/roles");
    // The previous case deliberately logged the owner out. This request is
    // expected to fail until the identity flow restores a session.
    expect(roles.status).toBe(401);
    await loginAs(actors.owner);
    const restored = await request("GET", "/identity/roles");
    expect(restored.status, diagnostics(restored)).toBe(200);
    expect(
      (restored.body as { permissions: readonly string[] }).permissions,
    ).toEqual(expect.arrayContaining(["sales.drafts.manage"]));
    expect(IMPLEMENTED_PERMISSION_NAMES).toContain("sales.drafts.manage");
  });

  async function createRole(
    name: string,
    permissions: readonly string[],
  ): Promise<string> {
    await loginAs(actors.owner);
    const challengeId = await createChallenge("identity.role.create");
    const response = await request("POST", "/identity/roles", {
      challengeId,
      idempotencyKey: uuidV7(),
      name,
      permissions,
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return String((response.body as { id?: string }).id ?? "");
  }

  async function createUser(
    actorToCreate: Actor,
    roleId: string,
  ): Promise<void> {
    await loginAs(actors.owner);
    const challengeId = await createChallenge("identity.user.create");
    const response = await request("POST", "/identity/users", {
      challengeId,
      displayName: actorToCreate.username,
      idempotencyKey: uuidV7(),
      password: actorToCreate.password,
      roleId,
      username: actorToCreate.username,
    });
    expect(response.status, diagnostics(response)).toBe(201);
  }

  async function createChallenge(action: string): Promise<string> {
    await loginAs(actors.owner);
    const created = await request("POST", "/identity/step-up-challenges", {
      action,
      idempotencyKey: uuidV7(),
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

  async function createDraft(): Promise<SaleDraft> {
    const response = await request("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as SaleDraft;
  }

  async function createProduct(tradeName: string): Promise<Product> {
    const response = await request(
      "POST",
      "/catalog/products",
      productRequest(tradeName),
    );
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as Product;
  }

  async function insertBalancedDrawerJournal(): Promise<void> {
    const ownerId = await userIdFor(actors.owner.username);
    const cashierId = await userIdFor(actors.customDrawerAllowed.username);
    const peerId = await userIdFor(actors.customDrawerPeer.username);
    const client = await administrator.connect();
    try {
      await client.query("begin");
      const entry = await client.query<{ id: string }>(
        `insert into accounting_journal_entries (
           pharmacy_id, template_id, template_version, posted_by
         ) values ($1, 'purchase.invoice', 1, $2)
         returning id`,
        [pharmacyId, ownerId],
      );
      const entryId = entry.rows[0]?.id;
      if (entryId === undefined) {
        throw new Error("Drawer balance journal entry was not created");
      }

      const lines = [
        {
          accountCode: "cash",
          creditFils: "0",
          debitFils: "12500",
          drawerUserId: cashierId,
        },
        {
          accountCode: "inventory",
          creditFils: "12500",
          debitFils: "0",
          drawerUserId: null,
        },
        {
          accountCode: "cash",
          creditFils: "0",
          debitFils: "7000",
          drawerUserId: peerId,
        },
        {
          accountCode: "inventory",
          creditFils: "7000",
          debitFils: "0",
          drawerUserId: null,
        },
        {
          accountCode: "cash",
          creditFils: "0",
          debitFils: "45000",
          drawerUserId: null,
        },
        {
          accountCode: "inventory",
          creditFils: "45000",
          debitFils: "0",
          drawerUserId: null,
        },
      ] as const;
      for (const [index, line] of lines.entries()) {
        await client.query(
          `insert into accounting_journal_lines (
             pharmacy_id, entry_id, ordinal, account_code, drawer_user_id,
             debit_fils, credit_fils
           ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            pharmacyId,
            entryId,
            index + 1,
            line.accountCode,
            line.drawerUserId,
            line.debitFils,
            line.creditFils,
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function userIdFor(username: string): Promise<string> {
    const result = await administrator.query<{ id: string }>(
      `select id from identity_users where pharmacy_id = $1 and username = $2`,
      [pharmacyId, username],
    );
    const userId = result.rows[0]?.id;
    if (userId === undefined) {
      throw new Error(`Test user ${username} was not created`);
    }
    return userId;
  }

  async function draftSnapshot(draftId: string): Promise<{
    readonly auditFacts: string;
    readonly commandResults: string;
    readonly lines: string;
    readonly raw: RawDraft | undefined;
  }> {
    const [raw, auditFacts, commandResults, lines] = await Promise.all([
      administrator.query<RawDraft>(
        `select id, pharmacy_id, status::text, version::text, created_at::text,
                created_by, updated_at::text, updated_by, device_id
         from sale_drafts where pharmacy_id = $1 and id = $2`,
        [pharmacyId, draftId],
      ),
      administrator.query<{ count: string }>(
        `select count(*)::text as count from posting_audit_records
         where pharmacy_id = $1 and target_id = $2`,
        [pharmacyId, draftId],
      ),
      administrator.query<{ count: string }>(
        `select count(*)::text as count from posting_command_results
         where pharmacy_id = $1 and command_name like 'sale.draft.%'`,
        [pharmacyId],
      ),
      administrator.query<Record<string, unknown>>(
        `select * from sale_draft_lines
         where pharmacy_id = $1 and draft_id = $2 order by ordinal`,
        [pharmacyId, draftId],
      ),
    ]);
    return {
      auditFacts: auditFacts.rows[0]?.count ?? "",
      commandResults: commandResults.rows[0]?.count ?? "",
      lines: JSON.stringify(lines.rows),
      raw: raw.rows[0],
    };
  }

  async function expectIdentityAudit(
    response: ApiResponse,
    permission: string,
  ): Promise<void> {
    const requestId = (response.body as { requestId?: string }).requestId;
    expect(requestId).toBeTruthy();
    const audit = await administrator.query<{
      required_permission: string;
    }>(
      `select after_state->>'requiredPermission' as required_permission
       from identity_audit_records where id = $1`,
      [requestId],
    );
    expect(audit.rows[0]?.required_permission).toBe(permission);
  }

  async function loginAs(actorToLogin: Actor): Promise<ApiResponse> {
    return await request("POST", "/identity/login", {
      password: actorToLogin.password,
      username: actorToLogin.username,
    });
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
    method: "GET" | "POST",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    return await requestAs(credentials, method, route, body);
  }

  async function requestAs(
    binding: Credentials,
    method: "GET" | "POST",
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
    method: "GET",
    route: string,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      headers: {
        Accept: "application/json",
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

  function diagnostics(response: ApiResponse): string {
    return `${apiOutput}\n${JSON.stringify(response)}`;
  }
});

function actor(name: string): Actor {
  return {
    password: `sale draft authorization ${name} password stays in this test`,
    username: `sale.draft.authorization.${name}`,
  };
}

function productRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "دواء للبيع",
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
    supplierIds: [],
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: "#0000ff" },
    stockLevels: { maximumLevel: "60", minimumLevel: "10", reorderPoint: "20" },
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
