import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  identityDenialSchema,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  productArchivePath,
  reorderItemsPath,
  saleDraftPath,
  saleDraftResumptionsPath,
  saleDraftsPath,
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
const OWNER_USERNAME = "sale.draft.integration.owner";
const OWNER_PASSWORD =
  "sale draft integration owner password stays in this test";

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface SaleDraftRow {
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

describe.sequential("Sale Draft PostgreSQL seam", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId = "";
  let ownerRoleId = "";

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
        displayName: "Sale Draft Integration Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Sale Draft Integration Pharmacy",
    });
    expect(bootstrap.status, diagnostics(bootstrap)).toBe(201);
    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.status, diagnostics(login)).toBe(200);
    pharmacyId = String(
      (login.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
    const role = await administrator.query<{ id: string }>(
      `select role.id from pharmacy_roles role
       join identity_users identity_user on identity_user.role_id = role.id
       where identity_user.pharmacy_id = $1 and identity_user.username = $2`,
      [pharmacyId, OWNER_USERNAME],
    );
    ownerRoleId = role.rows[0]?.id ?? "";
    expect(ownerRoleId).not.toBe("");
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("1. creates, lists, and reads the minimal active draft", async () => {
    const draft = await createDraft();
    expect(draft).toMatchObject({ status: "active", version: "1" });
    const listed = await listDrafts();
    expect(listed).toContainEqual(draft);
    expect(await readDraft(draft.id)).toEqual(draft);
  });

  it("2. resumes at the expected version and preserves creation facts", async () => {
    const draft = await createDraft();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const resumed = await resumeDraft(draft.id, {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(resumed).toMatchObject({ status: "active", version: "2" });
    expect(resumed.createdAt).toBe(draft.createdAt);
    expect(resumed.createdBy).toEqual(draft.createdBy);
    expect(new Date(resumed.updatedAt).getTime()).toBeGreaterThan(
      new Date(draft.updatedAt).getTime(),
    );
  });

  it("3. survives a killed local API and resumes exactly", async () => {
    const draft = await createDraft();
    const resumed = await resumeDraft(draft.id, {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    const before = {
      draft: await readDraft(resumed.id),
      list: await listDrafts(),
    };

    const exited = new Promise<void>((resolve) =>
      api.once("exit", () => resolve()),
    );
    api.kill("SIGKILL");
    await exited;
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);

    expect({
      draft: await readDraft(resumed.id),
      list: await listDrafts(),
    }).toEqual(before);
  }, 60_000);

  it("4. lets exactly one concurrent resume advance one version", async () => {
    const draft = await createDraft();
    const expectedVersion = draft.version;
    const responses = await Promise.all([
      request("POST", saleDraftResumptionsPath(draft.id), {
        expectedVersion,
        idempotencyKey: uuidV7(),
      }),
      request("POST", saleDraftResumptionsPath(draft.id), {
        expectedVersion,
        idempotencyKey: uuidV7(),
      }),
    ]);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body).toMatchObject({ code: "version-conflict" });
    expect((await readDraft(draft.id)).version).toBe("2");
  });

  it("5. replays an idempotent resume and rejects a changed request", async () => {
    const draft = await createDraft();
    const body = { expectedVersion: draft.version, idempotencyKey: uuidV7() };
    const first = await request(
      "POST",
      saleDraftResumptionsPath(draft.id),
      body,
    );
    const replay = await request(
      "POST",
      saleDraftResumptionsPath(draft.id),
      body,
    );
    expect(first.status, diagnostics(first)).toBe(200);
    expect(replay).toEqual(first);
    const conflict = await request("POST", saleDraftResumptionsPath(draft.id), {
      expectedVersion: "999",
      idempotencyKey: body.idempotencyKey,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "idempotency-conflict" });
    const results = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
       where pharmacy_id = $1 and command_name = 'sale.draft.resume'
         and idempotency_key = $2`,
      [pharmacyId, body.idempotencyKey],
    );
    expect(results.rows[0]?.count).toBe("1");
  });

  it("6. rejects direct Sale Draft deletion and immutable-fact mutation", async () => {
    const draft = await createDraft();
    const mutations: (() => Promise<unknown>)[] = [
      () =>
        administrator.query(
          "delete from sale_drafts where pharmacy_id = $1 and id = $2",
          [pharmacyId, draft.id],
        ),
      () =>
        administrator.query(
          `update sale_drafts set version = version + 2
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, draft.id],
        ),
      () =>
        administrator.query(
          `update sale_drafts set created_by = updated_by
           where pharmacy_id = $1 and id = $2`,
          [pharmacyId, draft.id],
        ),
    ];
    for (const mutation of mutations) {
      await expect(mutation()).rejects.toMatchObject({ code: "55000" });
    }
  });

  it("7. lets every basket outcome leave the Sale Draft byte-identical", async () => {
    const draft = await createDraft();
    const product = await createProduct("Sale draft basket proof");

    await assertDraftUntouched(draft.id, async () => {
      const response = await request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: product.id,
      });
      expect(response.status, diagnostics(response)).toBe(200);
      expect(response.body).toMatchObject({ outcome: "added" });
    });

    await administrator.query(
      `delete from role_permission_grants
       where pharmacy_id = $1 and role_id = $2
         and permission_name = 'inventory.reorder.manage'`,
      [pharmacyId, ownerRoleId],
    );
    await assertDraftUntouched(draft.id, async () => {
      const response = await request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: product.id,
      });
      expect(response.status).toBe(403);
      const denial = identityDenialSchema.parse(response.body);
      const audit = await administrator.query<{
        action: string;
        outcome: string;
      }>("select action, outcome from identity_audit_records where id = $1", [
        denial.requestId,
      ]);
      expect(audit.rows[0]).toEqual({
        action: "identity.authorization",
        outcome: "denied",
      });
    });
    await administrator.query(
      `insert into role_permission_grants (
         pharmacy_id, role_id, permission_name, granted_by
       ) select $1, $2, 'inventory.reorder.manage', identity_user.id
         from identity_users identity_user
         where identity_user.pharmacy_id = $1
           and identity_user.role_id = $2
       on conflict (role_id, permission_name) do nothing`,
      [pharmacyId, ownerRoleId],
    );
    const archive = await request("POST", productArchivePath(product.id), {
      expectedRevision: product.revision,
      idempotencyKey: uuidV7(),
    });
    expect(archive.status, diagnostics(archive)).toBe(201);
    await assertDraftUntouched(draft.id, async () => {
      const response = await request("POST", reorderItemsPath(), {
        idempotencyKey: uuidV7(),
        productId: product.id,
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "reorder-product-inactive" });
      const requestId = String(
        (response.body as { requestId?: string }).requestId,
      );
      const audit = await administrator.query(
        "select id from posting_audit_records where id = $1",
        [requestId],
      );
      expect(audit.rows).toHaveLength(1);
    });
  }, 60_000);

  async function createDraft(): Promise<SaleDraft> {
    const response = await request("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    expect(response.status, diagnostics(response)).toBe(201);
    return response.body as SaleDraft;
  }

  async function resumeDraft(
    draftId: string,
    body: { readonly expectedVersion: string; readonly idempotencyKey: string },
  ): Promise<SaleDraft> {
    const response = await request(
      "POST",
      saleDraftResumptionsPath(draftId),
      body,
    );
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as SaleDraft;
  }

  async function listDrafts(): Promise<readonly SaleDraft[]> {
    const response = await request("GET", saleDraftsPath());
    expect(response.status, diagnostics(response)).toBe(200);
    return (response.body as { drafts: readonly SaleDraft[] }).drafts;
  }

  async function readDraft(draftId: string): Promise<SaleDraft> {
    const response = await request("GET", saleDraftPath(draftId));
    expect(response.status, diagnostics(response)).toBe(200);
    return response.body as SaleDraft;
  }

  async function assertDraftUntouched(
    draftId: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const before = {
      auditFacts: await draftAuditFactCount(draftId),
      commandResults: await saleDraftCommandResultCount(),
      draft: await readDraft(draftId),
      raw: await rawDraft(draftId),
    };
    await action();
    expect({
      auditFacts: await draftAuditFactCount(draftId),
      commandResults: await saleDraftCommandResultCount(),
      draft: await readDraft(draftId),
      raw: await rawDraft(draftId),
    }).toEqual(before);
  }

  async function rawDraft(draftId: string): Promise<SaleDraftRow | undefined> {
    const result = await administrator.query<SaleDraftRow>(
      `select id, pharmacy_id, status::text, version::text, created_at::text,
              created_by, updated_at::text, updated_by, device_id
       from sale_drafts where pharmacy_id = $1 and id = $2`,
      [pharmacyId, draftId],
    );
    return result.rows[0];
  }

  async function draftAuditFactCount(draftId: string): Promise<string> {
    const result = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where pharmacy_id = $1 and target_id = $2`,
      [pharmacyId, draftId],
    );
    return result.rows[0]?.count ?? "";
  }

  async function saleDraftCommandResultCount(): Promise<string> {
    const result = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_command_results
       where pharmacy_id = $1 and command_name like 'sale.draft.%'`,
      [pharmacyId],
    );
    return result.rows[0]?.count ?? "";
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
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: headers(body !== undefined),
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

  function headers(json: boolean): Record<string, string> {
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
});

function productRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "مسودة بيع",
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
