import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  purchaseDraftDiscardPath,
  purchaseDraftHeaderPath,
  type PurchaseDraft,
  type Supplier,
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
const OWNER_USERNAME = "purchasing.owner";
const OWNER_PASSWORD = "purchasing owner password stays in this test";
const DENIED_USERNAME = "purchasing.denied";
const DENIED_PASSWORD = "purchasing denied password stays in this test";
interface Credentials {
  deviceId: string;
  deviceSecret: string;
  sessionToken: string;
}
interface ApiResponse {
  body: Record<string, unknown> | undefined;
  status: number;
}

describe.sequential("Supplier and Purchase Draft PostgreSQL seam", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams;
  let apiOrigin = "";
  let apiOutput = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let draft: PurchaseDraft;
  let postgres: StartedPostgreSqlContainer | undefined;
  let pharmacyId = "";
  let ownerId = "";
  let supplier: Supplier;

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
    expect(
      (
        await request("POST", "/identity/bootstrap", {
          owner: {
            displayName: "Purchasing Owner",
            password: OWNER_PASSWORD,
            username: OWNER_USERNAME,
          },
          pharmacyName: "Breev Purchasing Test Pharmacy",
        })
      ).status,
    ).toBe(201);
    const login = await request("POST", "/identity/login", {
      password: OWNER_PASSWORD,
      username: OWNER_USERNAME,
    });
    expect(login.status).toBe(200);
    ownerId = String(
      (login.body?.user as { id?: string } | undefined)?.id ?? "",
    );
    pharmacyId = String(
      (login.body?.pharmacy as { id?: string } | undefined)?.id ?? "",
    );
  }, 120_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("creates an audited supplier with append-only effective-dated allowance", async () => {
    const response = await request(
      "POST",
      "/suppliers",
      supplierBody("Al-Nahrain", "2.5", "2026-01-01"),
    );
    expect(response.status, diagnostics(response)).toBe(201);
    supplier = response.body as unknown as Supplier;
    expect(supplier).toMatchObject({
      defaultAllowancePercentage: "2.5",
      status: "active",
      terms: "Net 30",
    });
    const audit = await administrator.query<{ count: string }>(
      `select count(*)::text as count from posting_audit_records
       where action = 'supplier.create' and target_id = $1 and outcome = 'committed'`,
      [supplier.id],
    );
    expect(audit.rows[0]?.count).toBe("1");
    await expect(
      administrator.query(
        `update supplier_allowance_rates set allowance_percentage = 9 where supplier_id = $1`,
        [supplier.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("copies the invoice-date allowance and never changes the draft snapshot later", async () => {
    const created = await request(
      "POST",
      "/purchases/drafts",
      draftBody(supplier.id, "INV-100", "2026-06-15"),
    );
    expect(created.status, diagnostics(created)).toBe(201);
    expect(created.body?.warnings).toEqual([]);
    draft = created.body?.draft as unknown as PurchaseDraft;
    expect(draft.allowanceSnapshot).toEqual({
      basisFils: "0",
      percentage: "2.5",
    });

    const editedSupplier = await request("PUT", `/suppliers/${supplier.id}`, {
      ...supplierBody("Al-Nahrain", "7.75", "2026-07-01"),
      expectedRevision: supplier.revision,
    });
    expect(editedSupplier.status, diagnostics(editedSupplier)).toBe(200);
    supplier = editedSupplier.body as unknown as Supplier;
    const resumed = await request("GET", `/purchases/drafts/${draft.id}`);
    expect(
      (resumed.body as unknown as PurchaseDraft).allowanceSnapshot.percentage,
    ).toBe("2.5");

    const retroactiveRate = await request("PUT", `/suppliers/${supplier.id}`, {
      ...supplierBody("Al-Nahrain", "9.25", "2026-02-01"),
      expectedRevision: supplier.revision,
    });
    expect(retroactiveRate.status, diagnostics(retroactiveRate)).toBe(200);
    supplier = retroactiveRate.body as unknown as Supplier;
    const headerOnlyEdit = await request(
      "PUT",
      purchaseDraftHeaderPath(draft.id),
      {
        ...draftBody(supplier.id, "INV-100", "2026-06-15"),
        expectedVersion: draft.version,
        settlementContext: "debt",
      },
    );
    expect(headerOnlyEdit.status, diagnostics(headerOnlyEdit)).toBe(200);
    draft = headerOnlyEdit.body?.draft as unknown as PurchaseDraft;
    expect(draft.allowanceSnapshot.percentage).toBe("2.5");

    const later = await request(
      "POST",
      "/purchases/drafts",
      draftBody(supplier.id, "INV-101", "2026-08-01"),
    );
    expect(
      (later.body?.draft as unknown as PurchaseDraft).allowanceSnapshot
        .percentage,
    ).toBe("7.75");
  });

  it("warns for the same supplier number, allows saving, and ignores another supplier", async () => {
    const duplicate = await request(
      "POST",
      "/purchases/drafts",
      draftBody(supplier.id, "INV-100", "2026-06-15"),
    );
    expect(duplicate.status, diagnostics(duplicate)).toBe(201);
    expect(duplicate.body?.warnings).toMatchObject([
      {
        code: "duplicate-supplier-invoice-number",
        operationalRule: "warn-open-decision",
      },
    ]);
    const otherResponse = await request(
      "POST",
      "/suppliers",
      supplierBody("Baghdad Medical", "1", "2026-01-01"),
    );
    const other = otherResponse.body as unknown as Supplier;
    const different = await request(
      "POST",
      "/purchases/drafts",
      draftBody(other.id, "INV-100", "2026-06-15"),
    );
    expect(different.body?.warnings).toEqual([]);
  });

  it("rejects a stale version and keeps the committed header", async () => {
    const first = await request("PUT", purchaseDraftHeaderPath(draft.id), {
      ...draftBody(supplier.id, "INV-100-A", "2026-06-15"),
      expectedVersion: draft.version,
    });
    expect(first.status, diagnostics(first)).toBe(200);
    const updated = first.body?.draft as unknown as PurchaseDraft;
    const stale = await request("PUT", purchaseDraftHeaderPath(draft.id), {
      ...draftBody(supplier.id, "STALE", "2026-06-15"),
      expectedVersion: draft.version,
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { code: "version-conflict" },
    });
    draft = updated;
  });

  it("survives an API restart with its version and header intact", async () => {
    await stopProcess(api);
    apiOutput = "";
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    const resumed = await request("GET", `/purchases/drafts/${draft.id}`);
    expect(resumed.status, diagnostics(resumed)).toBe(200);
    expect(resumed.body).toMatchObject({
      id: draft.id,
      supplierInvoiceNumber: "INV-100-A",
      version: draft.version,
    });
  });

  it("archives or merges suppliers without rewriting existing draft references", async () => {
    const survivorResponse = await request(
      "POST",
      "/suppliers",
      supplierBody("Unified Supplier", "4", "2026-01-01"),
    );
    const survivor = survivorResponse.body as unknown as Supplier;
    const merged = await request("POST", `/suppliers/${supplier.id}/merges`, {
      expectedRevision: supplier.revision,
      idempotencyKey: uuidV7(),
      survivorSupplierId: survivor.id,
    });
    expect(merged).toMatchObject({
      status: 201,
      body: { status: "merged", mergedIntoSupplierId: survivor.id },
    });
    const preserved = await request("GET", `/purchases/drafts/${draft.id}`);
    expect(preserved.body).toMatchObject({
      supplierId: supplier.id,
      supplierNameSnapshot: "Al-Nahrain",
    });
    const redirected = await request(
      "POST",
      "/purchases/drafts",
      draftBody(supplier.id, "MERGED-1", "2026-08-01"),
    );
    expect(redirected.body?.draft).toMatchObject({
      supplierId: survivor.id,
      supplierNameSnapshot: survivor.name,
    });
    const archived = await request(
      "POST",
      `/suppliers/${survivor.id}/archivals`,
      {
        expectedRevision: survivor.revision,
        idempotencyKey: uuidV7(),
      },
    );
    expect(archived).toMatchObject({
      status: 201,
      body: { status: "archived" },
    });
    expect(
      (await request("GET", `/purchases/drafts/${draft.id}`)).body,
    ).toMatchObject({ supplierId: supplier.id });
  });

  it("requires explicit discard confirmation and never exposes hard delete", async () => {
    const missing = await request("POST", purchaseDraftDiscardPath(draft.id), {
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
    });
    expect(missing).toMatchObject({
      status: 400,
      body: { code: "body-invalid" },
    });
    const discarded = await request(
      "POST",
      purchaseDraftDiscardPath(draft.id),
      {
        confirmation: "discard-populated-purchase-draft",
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(discarded).toMatchObject({
      status: 201,
      body: { status: "discarded" },
    });
    await expect(
      administrator.query(`delete from purchase_drafts where id = $1`, [
        draft.id,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    expect(
      (await request("DELETE", `/purchases/drafts/${draft.id}`, {})).status,
    ).toBe(404);
    expect(
      (await request("DELETE", `/suppliers/${supplier.id}`, {})).status,
    ).toBe(404);
  });

  it("default-denies both supplier and draft commands and audits the denials", async () => {
    const role = await administrator.query<{ id: string }>(
      `select id from pharmacy_roles where pharmacy_id = $1 and role_key = 'pharmacist'`,
      [pharmacyId],
    );
    const challenge = await request("POST", "/identity/step-up-challenges", {
      action: "identity.user.create",
      idempotencyKey: uuidV7(),
    });
    expect(challenge.status, diagnostics(challenge)).toBe(201);
    const challengeId = String(challenge.body?.id ?? "");
    expect(
      (
        await request(
          "POST",
          `/identity/step-up-challenges/${challengeId}/approve`,
          { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request("POST", "/identity/users", {
          challengeId,
          displayName: "Denied User",
          idempotencyKey: uuidV7(),
          password: DENIED_PASSWORD,
          roleId: role.rows[0]?.id,
          username: DENIED_USERNAME,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("POST", "/identity/login", {
          password: DENIED_PASSWORD,
          username: DENIED_USERNAME,
        })
      ).status,
    ).toBe(200);
    const supplierDenied = await request(
      "POST",
      "/suppliers",
      supplierBody("Denied", "1", "2026-01-01"),
    );
    const draftDenied = await request(
      "POST",
      "/purchases/drafts",
      draftBody(supplier.id, "DENIED", "2026-06-15"),
    );
    expect(supplierDenied).toMatchObject({
      status: 403,
      body: {
        code: "permission-denied",
        requiredPermission: "suppliers.manage",
      },
    });
    expect(draftDenied).toMatchObject({
      status: 403,
      body: {
        code: "permission-denied",
        requiredPermission: "purchases.drafts.manage",
      },
    });
    const audits = await administrator.query<{ count: string }>(
      `select count(*)::text as count from identity_audit_records
       where pharmacy_id = $1 and actor_user_id <> $2
         and action = 'identity.authorization' and outcome = 'denied'`,
      [pharmacyId, ownerId],
    );
    expect(audits.rows[0]?.count).toBe("2");
  });

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
    method: "DELETE" | "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${apiOrigin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: headers(credentials, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body:
        text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>),
      status: response.status,
    };
  }
  function diagnostics(response: ApiResponse): string {
    return `${apiOutput}\n${JSON.stringify(response)}`;
  }
});

function supplierBody(name: string, percentage: string, effectiveFrom: string) {
  return {
    allowanceEffectiveFrom: effectiveFrom,
    defaultAllowancePercentage: percentage,
    idempotencyKey: uuidV7(),
    name,
    terms: "Net 30",
  };
}
function draftBody(
  supplierId: string,
  supplierInvoiceNumber: string,
  invoiceDate: string,
) {
  return {
    idempotencyKey: uuidV7(),
    invoiceDate,
    settlementContext: "debt" as const,
    supplierId,
    supplierInvoiceNumber,
  };
}
function headers(
  credentials: Credentials,
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
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).status === 200) return;
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
      if (address === null || typeof address === "string")
        reject(new Error("Could not reserve a port"));
      else resolve(address.port);
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
