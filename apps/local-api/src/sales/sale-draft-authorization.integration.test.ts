import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  IMPLEMENTED_PERMISSION_NAMES,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  saleDraftPath,
  saleDraftsPath,
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
      "sales.drafts.manage",
    ]);
    await createUser(actors.customDenied, deniedRole);
    await createUser(actors.customAllowed, allowedRole);
    await createUser(actors.salesEmployee, await roleIdFor("sales_employee"));
  }, 180_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("allows the built-in sales employee and a custom role with the exact grant", async () => {
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

  async function draftSnapshot(draftId: string): Promise<{
    readonly auditFacts: string;
    readonly commandResults: string;
    readonly raw: RawDraft | undefined;
  }> {
    const [raw, auditFacts, commandResults] = await Promise.all([
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
    ]);
    return {
      auditFacts: auditFacts.rows[0]?.count ?? "",
      commandResults: commandResults.rows[0]?.count ?? "",
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
