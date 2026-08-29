import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  LOCAL_RECOVERY_STATUS_SUCCESS_STATUS,
  LOCAL_RESTORE_QUARANTINE_STATUS,
  localHealthContract,
  localProofEvidenceContract,
  localRecoveryStatusContract,
  parseLocalRecoveryStatusResponse,
  localProofMutationContract,
  parseLocalProofEvidenceResponse,
  parseLocalProofMutationResponse,
  type LocalProofEvidenceSuccess,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { hashMainDeviceSecret } from "./main-device-binding.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const PACKAGED_RENDERER_ORIGIN = "breev://app";
const PROOF_RATE_LIMIT = "3";
const PROOF_RATE_WINDOW_SECONDS = "3600";

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

type HttpHeaders = Headers | Record<string, string>;

describe.sequential("Main device security persistence seam", () => {
  let api: ChildProcessWithoutNullStreams;
  let apiOutput = "";
  let apiOrigin: string;
  let apiPort: number;
  let credentials: MainDeviceCredentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = spawnLocalApi(apiPort, databaseRoles, credentials);
    api.stdout.on("data", collectApiOutput);
    api.stderr.on("data", collectApiOutput);
    await waitForHealth(apiOrigin, () => apiOutput);
  });

  afterAll(async () => {
    await stopProcess(api);
    await postgres?.stop().catch(() => undefined);
  });

  it("commits the protected mutation through a verified Main device session", async () => {
    const mutation = await requestProofMutation(apiOrigin, credentials);

    expect(mutation.response.status).toBe(201);
    expect(mutation.response.headers.get("access-control-allow-origin")).toBe(
      PACKAGED_RENDERER_ORIGIN,
    );
    expect(
      mutation.response.headers.get("access-control-allow-credentials"),
    ).toBeNull();
    expect(mutation.body).toEqual({
      status: "committed",
      mutationCount: "1",
    });

    const evidence = await getProofEvidence(apiOrigin, credentials);
    expect(evidence).toMatchObject({
      mutationCount: "1",
      recentDenialCount: "0",
      denials: [],
    });
  });

  it("commits concurrent proof mutations atomically in PostgreSQL", async () => {
    await expireRateWindow(databaseRoles, credentials);
    const before = await getProofEvidence(apiOrigin, credentials);
    const mutations = await Promise.all(
      Array.from(
        { length: 3 },
        async () => await requestProofMutation(apiOrigin, credentials),
      ),
    );

    expect(mutations.map(({ response }) => response.status)).toEqual([
      201, 201, 201,
    ]);
    expect(
      mutations
        .map(({ body }) =>
          body.status === "committed" ? BigInt(body.mutationCount) : -1n,
        )
        .sort((left, right) => (left < right ? -1 : 1)),
    ).toEqual([
      BigInt(before.mutationCount) + 1n,
      BigInt(before.mutationCount) + 2n,
      BigInt(before.mutationCount) + 3n,
    ]);
    const after = await getProofEvidence(apiOrigin, credentials);
    expect(after.mutationCount).toBe(String(BigInt(before.mutationCount) + 3n));
  });

  it("runs journaled Drizzle migrations outside the least-privilege application role", async () => {
    const applicationPool = new Pool({
      connectionString: databaseRoles.applicationUrl,
    });
    const administratorPool = new Pool({
      connectionString: postgres.getConnectionUri(),
    });
    try {
      const application = await applicationPool.query<{
        can_create_schema: boolean;
        role_name: string;
      }>(
        `select current_user as role_name,
                has_schema_privilege(current_user, 'public', 'create')
                  as can_create_schema`,
      );
      expect(application.rows[0]).toEqual({
        can_create_schema: false,
        role_name: "breev_app",
      });
      await expect(
        applicationPool.query(
          "create table forbidden_runtime_ddl (id integer)",
        ),
      ).rejects.toThrow();

      const migration = await administratorPool.query<{
        migration_count: string;
        tableowner: string;
      }>(
        `select p.tableowner,
                (select count(*)::text
                 from breev_migrations.breev_schema_migrations)
                  as migration_count
         from pg_tables p
         where p.schemaname = 'public' and p.tablename = 'main_devices'`,
      );
      expect(migration.rows[0]).toEqual({
        migration_count: "7",
        tableowner: "breev_schema_owner",
      });

      await expect(
        applicationPool.query(
          `insert into main_devices (id, credential_hash)
           values ($1, $2)`,
          [randomUUID(), randomBytes(32)],
        ),
      ).rejects.toThrow();
    } finally {
      await applicationPool.end();
      await administratorPool.end();
    }
  });

  it("serves health from the protected runtime connection file without the schema-owner credential", async () => {
    const runtimeRoot = await mkdtemp(
      path.join(tmpdir(), "breev-runtime-connection-"),
    );
    const runtimeUrlPath = path.join(runtimeRoot, "database-url");
    const runtimePort = await reservePort();
    let runtimeOutput = "";
    let runtimeApi: ChildProcessWithoutNullStreams | undefined;

    try {
      await writeFile(runtimeUrlPath, databaseRoles.applicationUrl, {
        encoding: "utf8",
        mode: 0o600,
      });
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(runtimePort),
        DATABASE_URL_FILE: runtimeUrlPath,
      };
      delete environment.DATABASE_MIGRATION_URL;
      delete environment.DATABASE_URL;
      runtimeApi = spawn(
        process.execPath,
        [path.resolve(import.meta.dirname, "../../dist/main.js")],
        { env: environment },
      );
      runtimeApi.stdout.on("data", (chunk: Buffer) => {
        runtimeOutput += chunk.toString();
      });
      runtimeApi.stderr.on("data", (chunk: Buffer) => {
        runtimeOutput += chunk.toString();
      });

      const runtimeOrigin = `http://127.0.0.1:${runtimePort}`;
      await waitForHealth(runtimeOrigin, () => runtimeOutput);
      const response = await fetch(`${runtimeOrigin}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "healthy",
        database: "available",
      });
    } finally {
      await stopProcess(runtimeApi);
      await rm(runtimeRoot, { force: true, recursive: true });
    }
  });

  it("rejects and audits a mutation without an Origin", async () => {
    const requestHeaders = mutationHeaders(credentials);
    requestHeaders.delete("Origin");

    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "origin-not-allowed",
      credentials,
      headers: requestHeaders,
      status: 403,
    });
  });

  it.each(["null", "https://attacker.example", "breev://app.attacker"])(
    "rejects and audits the non-exact Origin %s",
    async (origin) => {
      const headers = mutationHeaders(credentials);
      headers.set("Origin", origin);
      await expectDeniedWithoutMutation({
        apiOrigin,
        code: "origin-not-allowed",
        credentials,
        headers,
        status: 403,
      });
    },
  );

  it("does not mistake a forged allowed Origin for Main device authority", async () => {
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "binding-missing",
      credentials,
      headers: {
        [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
        "Content-Type": "application/json",
        Origin: PACKAGED_RENDERER_ORIGIN,
      },
      status: 401,
    });
  });

  it("guards an otherwise unknown state-changing route before routing", async () => {
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "binding-missing",
      credentials,
      headers: {
        [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
        "Content-Type": "application/json",
        Origin: PACKAGED_RENDERER_ORIGIN,
      },
      send: async () =>
        await requestProofMutation(apiOrigin, credentials, {
          headers: {
            [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
            "Content-Type": "application/json",
            Origin: PACKAGED_RENDERER_ORIGIN,
          },
          path: "/future-state-changing-route",
        }),
      status: 401,
    });
  });

  it("rejects a session token presented without its bound device credential", async () => {
    const headers = mutationHeaders(credentials);
    headers.set(LOCAL_DEVICE_SESSION_HEADER, credentials.sessionToken);
    headers.delete("Authorization");
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "binding-missing",
      credentials,
      headers,
      status: 401,
    });
  });

  it("rejects a caller-selected unregistered device context", async () => {
    const headers = mutationHeaders(credentials);
    headers.set(LOCAL_DEVICE_ID_HEADER, randomUUID());
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "binding-invalid",
      credentials,
      headers,
      status: 401,
    });
  });

  it("rejects a stolen session replayed with another verified device", async () => {
    const otherDevice = createMainDeviceCredentials();
    const applicationPool = new Pool({
      connectionString: databaseRoles.applicationUrl,
    });
    try {
      await applicationPool.query(
        `insert into main_devices (id, credential_hash)
         values ($1, $2)`,
        [otherDevice.deviceId, hashMainDeviceSecret(otherDevice.deviceSecret)],
      );
    } finally {
      await applicationPool.end();
    }

    const headers = mutationHeaders(credentials);
    headers.set(LOCAL_DEVICE_ID_HEADER, otherDevice.deviceId);
    headers.set("Authorization", `Breev-Device ${otherDevice.deviceSecret}`);
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "session-binding-invalid",
      credentials,
      headers,
      status: 401,
    });
  });

  it("rejects a session token that is not bound to the verified device", async () => {
    const headers = mutationHeaders(credentials);
    headers.set(
      LOCAL_DEVICE_SESSION_HEADER,
      randomBytes(32).toString("base64url"),
    );
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "session-binding-invalid",
      credentials,
      headers,
      status: 401,
    });
  });

  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=attack",
    "text/plain",
    "application/json; charset=utf-8",
    "Application/JSON",
  ])("rejects the state-changing content type %s", async (contentType) => {
    const headers = mutationHeaders(credentials);
    headers.set("Content-Type", contentType);
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "content-type-not-allowed",
      credentials,
      headers,
      status: 415,
    });
  });

  it("rejects a state-changing request without a content type", async () => {
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "content-type-not-allowed",
      credentials,
      headers: trustedHeaders(credentials),
      status: 415,
    });
  });

  it("rejects a mutation without the custom CSRF header", async () => {
    const headers = mutationHeaders(credentials);
    headers.delete(BREEV_CSRF_HEADER);
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "csrf-header-missing",
      credentials,
      headers,
      status: 403,
    });
  });

  it("rejects and audits invalid or oversized mutation bodies", async () => {
    await expireRateWindow(databaseRoles, credentials);
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "body-invalid",
      credentials,
      headers: mutationHeaders(credentials),
      send: async () =>
        await requestProofMutation(apiOrigin, credentials, {
          body: JSON.stringify({ increment: 1, tenantId: randomUUID() }),
        }),
      status: 400,
    });

    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "body-invalid",
      credentials,
      headers: mutationHeaders(credentials),
      send: async () =>
        await requestProofMutation(apiOrigin, credentials, { body: "{" }),
      status: 400,
    });

    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "request-too-large",
      credentials,
      headers: mutationHeaders(credentials),
      send: async () =>
        await requestProofMutation(apiOrigin, credentials, {
          body: JSON.stringify({
            increment: 1,
            padding: "x".repeat(9 * 1024),
          }),
        }),
      status: 413,
    });

    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "request-too-large",
      credentials,
      headers: mutationHeaders(credentials),
      send: async () =>
        await requestProofMutationWithChunkedBody(
          apiPort,
          mutationHeaders(credentials),
          JSON.stringify({ increment: 1, padding: "x".repeat(9 * 1024) }),
        ),
      status: 413,
    });
  });

  it("does not accept an ambient cookie as device or session authority", async () => {
    const headers = new Headers({
      [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
      "Content-Type": "application/json",
      Cookie: "breev_session=ambient-browser-credential",
      Origin: PACKAGED_RENDERER_ORIGIN,
    });
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "binding-missing",
      credentials,
      headers,
      status: 401,
    });
  });

  it("allows only the exact mutation preflight", async () => {
    const allowed = await fetch(
      new URL(localProofMutationContract.path, apiOrigin),
      {
        headers: {
          "Access-Control-Request-Headers": "content-type, x-breev-csrf",
          "Access-Control-Request-Method": "POST",
          Origin: PACKAGED_RENDERER_ORIGIN,
        },
        method: "OPTIONS",
      },
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      PACKAGED_RENDERER_ORIGIN,
    );
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST");
    expect(allowed.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, X-Breev-CSRF",
    );
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const before = await getProofEvidence(apiOrigin, credentials);
    const denied = await fetch(
      new URL(localProofMutationContract.path, apiOrigin),
      {
        headers: {
          "Access-Control-Request-Headers": "content-type, x-breev-csrf",
          "Access-Control-Request-Method": "POST",
          Origin: "https://attacker.example",
        },
        method: "OPTIONS",
      },
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    const denialBody = parseLocalProofMutationResponse(
      denied.status,
      await denied.json(),
    );
    expect(denialBody).toMatchObject({
      status: "denied",
      code: "origin-not-allowed",
    });
    const after = await getProofEvidence(apiOrigin, credentials);
    expect(after.mutationCount).toBe(before.mutationCount);
    expect(denialCount(after, "origin-not-allowed")).toBe(
      denialCount(before, "origin-not-allowed") + 1,
    );

    const widened = await fetch(
      new URL(localProofMutationContract.path, apiOrigin),
      {
        headers: {
          "Access-Control-Request-Headers":
            "content-type, x-breev-csrf, x-attacker-header",
          "Access-Control-Request-Method": "POST",
          Origin: PACKAGED_RENDERER_ORIGIN,
        },
        method: "OPTIONS",
      },
    );
    expect(widened.status).toBe(403);
    expect(widened.headers.get("access-control-allow-origin")).toBeNull();
    expect(
      parseLocalProofMutationResponse(widened.status, await widened.json()),
    ).toMatchObject({
      status: "denied",
      code: "cors-preflight-not-allowed",
    });
    const afterWidened = await getProofEvidence(apiOrigin, credentials);
    expect(afterWidened.mutationCount).toBe(before.mutationCount);
    expect(denialCount(afterWidened, "cors-preflight-not-allowed")).toBe(
      denialCount(after, "cors-preflight-not-allowed") + 1,
    );
  });

  it("rejects a rebound Host before the mutation handler", async () => {
    const headers = mutationHeaders(credentials);
    headers.set("Host", `rebound.attacker.example:${apiPort}`);
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "host-not-allowed",
      credentials,
      headers,
      send: async () => await requestProofMutationWithRawHost(apiPort, headers),
      status: 421,
    });
  });

  it("keeps the binding, audit, mutation, and rate window across restart", async () => {
    await expireRateWindow(databaseRoles, credentials);
    const before = await getProofEvidence(apiOrigin, credentials);
    for (let accepted = 0; accepted < 3; accepted += 1) {
      const mutation = await requestProofMutation(apiOrigin, credentials);
      expect(mutation.response.status).toBe(201);
    }

    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "rate-limit-exceeded",
      credentials,
      headers: mutationHeaders(credentials),
      status: 429,
    });
    expect(
      await latestDenialDeviceId(databaseRoles, "rate-limit-exceeded"),
    ).toBe(credentials.deviceId);

    await stopProcess(api);
    api = spawnLocalApi(apiPort, databaseRoles, credentials);
    api.stdout.on("data", collectApiOutput);
    api.stderr.on("data", collectApiOutput);
    await waitForHealth(apiOrigin, () => apiOutput);

    const afterRestart = await getProofEvidence(apiOrigin, credentials);
    expect(afterRestart.mutationCount).toBe(
      String(BigInt(before.mutationCount) + 3n),
    );
    await expectDeniedWithoutMutation({
      apiOrigin,
      code: "rate-limit-exceeded",
      credentials,
      headers: mutationHeaders(credentials),
      status: 429,
    });

    await expireRateWindow(databaseRoles, credentials);
    const afterWindow = await requestProofMutation(apiOrigin, credentials);
    expect(afterWindow.response.status).toBe(201);
    expect(afterWindow.body).toMatchObject({ status: "committed" });
  });

  it("bounds recent denial rows while retaining every denial in totals", async () => {
    await expireRateWindow(databaseRoles, credentials);
    const before = await getProofEvidence(apiOrigin, credentials);
    const headers = mutationHeaders(credentials);
    headers.delete("Origin");

    for (let attempt = 0; attempt < 260; attempt += 1) {
      const denial = await requestProofMutation(apiOrigin, credentials, {
        headers,
      });
      expect(denial.body).toMatchObject({
        status: "denied",
        code: "origin-not-allowed",
      });
    }

    const after = await getProofEvidence(apiOrigin, credentials);
    expect(after.mutationCount).toBe(before.mutationCount);
    expect(after.recentDenialCount).toBe("256");
    expect(denialCount(after, "origin-not-allowed")).toBe(
      denialCount(before, "origin-not-allowed") + 260,
    );
  });

  it("refuses normal use while the dataset is in Restore Quarantine", async () => {
    await expireRateWindow(databaseRoles, credentials);
    const pool = new Pool({ connectionString: databaseRoles.applicationUrl });
    try {
      await pool.query(
        `update system_quarantine_state
         set is_quarantined = true,
             quarantine_reason = 'Restored from recovery point',
             quarantined_at = now(),
             cleared_at = null,
             cleared_by = null
         where singleton = true`,
      );

      const denied = await fetch(
        `${apiOrigin}${localProofEvidenceContract.path}`,
        { headers: trustedHeaders(credentials), method: "GET" },
      );
      expect(denied.status).toBe(LOCAL_RESTORE_QUARANTINE_STATUS);
      expect(await denied.json()).toEqual({
        code: "restore-quarantine",
        quarantinedAt: expect.any(String),
        reason: "Restored from recovery point",
      });

      const mutation = await fetch(
        `${apiOrigin}${localProofMutationContract.path}`,
        {
          body: JSON.stringify({ increment: 1 }),
          headers: mutationHeaders(credentials),
          method: localProofMutationContract.method,
        },
      );
      expect(mutation.status).toBe(LOCAL_RESTORE_QUARANTINE_STATUS);

      // The handshake and the recovery status stay reachable so the quarantine
      // can be explained and its reason read.
      const health = await fetch(`${apiOrigin}${localHealthContract.path}`);
      expect(health.status).toBe(200);

      const status = await fetch(
        `${apiOrigin}${localRecoveryStatusContract.path}`,
        { headers: trustedHeaders(credentials), method: "GET" },
      );
      expect(status.status).toBe(LOCAL_RECOVERY_STATUS_SUCCESS_STATUS);
      expect(
        parseLocalRecoveryStatusResponse(status.status, await status.json()),
      ).toEqual({
        latestRecoveryPoint: null,
        quarantine: {
          clearedAt: null,
          isQuarantined: true,
          quarantineReason: "Restored from recovery point",
          quarantinedAt: expect.any(String),
        },
      });

      // The recorded mutation count proves the quarantined request never
      // reached the handler.
      const mutations = await pool.query<{ mutation_count: string }>(
        "select mutation_count from main_device_proof_state where singleton = true",
      );
      await pool.query(
        `update system_quarantine_state
         set is_quarantined = false, cleared_at = now(), cleared_by = 'test'
         where singleton = true`,
      );
      const evidence = await getProofEvidence(apiOrigin, credentials);
      expect(evidence.mutationCount).toBe(mutations.rows[0]?.mutation_count);
    } finally {
      await pool.query(
        `update system_quarantine_state
         set is_quarantined = false where singleton = true`,
      );
      await pool.end();
    }
  });

  function collectApiOutput(chunk: Buffer): void {
    apiOutput += chunk.toString();
  }
});

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

function trustedHeaders(credentials: MainDeviceCredentials): HttpHeaders {
  return {
    Authorization: `Breev-Device ${credentials.deviceSecret}`,
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: credentials.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: credentials.sessionToken,
    Origin: PACKAGED_RENDERER_ORIGIN,
  };
}

function mutationHeaders(credentials: MainDeviceCredentials): Headers {
  const headers = new Headers(trustedHeaders(credentials));
  headers.set("Content-Type", "application/json");
  return headers;
}

async function requestProofMutation(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
  overrides: {
    readonly body?: string;
    readonly headers?: HttpHeaders;
    readonly path?: string;
  } = {},
): Promise<{
  response: Response;
  body: ReturnType<typeof parseLocalProofMutationResponse>;
}> {
  const response = await fetch(
    new URL(overrides.path ?? localProofMutationContract.path, apiOrigin),
    {
      body: overrides.body ?? JSON.stringify({ increment: 1 }),
      headers:
        overrides.headers ??
        ({
          ...trustedHeaders(credentials),
          "Content-Type": "application/json",
        } satisfies HttpHeaders),
      method: localProofMutationContract.method,
    },
  );
  const payload: unknown = await response.json();
  return {
    response,
    body: parseLocalProofMutationResponse(response.status, payload),
  };
}

async function requestProofMutationWithRawHost(
  port: number,
  headers: Headers,
): Promise<Awaited<ReturnType<typeof requestProofMutation>>> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: Object.fromEntries(headers.entries()),
        hostname: "127.0.0.1",
        method: "POST",
        path: localProofMutationContract.path,
        port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          const payload: unknown = JSON.parse(Buffer.concat(chunks).toString());
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              responseHeaders.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
            }
          }
          resolve({
            response: new Response(JSON.stringify(payload), {
              headers: responseHeaders,
              status,
            }),
            body: parseLocalProofMutationResponse(status, payload),
          });
        });
      },
    );
    request.once("error", reject);
    request.end(JSON.stringify({ increment: 1 }));
  });
}

async function requestProofMutationWithChunkedBody(
  port: number,
  headers: Headers,
  body: string,
): Promise<Awaited<ReturnType<typeof requestProofMutation>>> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: Object.fromEntries(headers.entries()),
        hostname: "127.0.0.1",
        method: "POST",
        path: localProofMutationContract.path,
        port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          const payload: unknown = JSON.parse(Buffer.concat(chunks).toString());
          resolve({
            response: new Response(JSON.stringify(payload), { status }),
            body: parseLocalProofMutationResponse(status, payload),
          });
        });
      },
    );
    request.once("error", reject);
    const midpoint = Math.floor(body.length / 2);
    request.write(body.slice(0, midpoint));
    request.end(body.slice(midpoint));
  });
}

async function requestProofEvidence(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
): Promise<{
  response: Response;
  body: ReturnType<typeof parseLocalProofEvidenceResponse>;
}> {
  const response = await fetch(
    new URL(localProofEvidenceContract.path, apiOrigin),
    {
      headers: trustedHeaders(credentials),
      method: localProofEvidenceContract.method,
    },
  );
  const payload: unknown = await response.json();
  return {
    response,
    body: parseLocalProofEvidenceResponse(response.status, payload),
  };
}

async function getProofEvidence(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
): Promise<LocalProofEvidenceSuccess> {
  const result = await requestProofEvidence(apiOrigin, credentials);
  if ("status" in result.body) {
    throw new Error(`Proof evidence was denied: ${result.body.code}`);
  }
  return result.body;
}

function denialCount(
  evidence: Awaited<ReturnType<typeof getProofEvidence>>,
  code: string,
): number {
  return Number(
    evidence.denials.find((denial) => denial.code === code)?.count ?? "0",
  );
}

async function latestDenialDeviceId(
  databaseRoles: SeparatedDatabaseRoles,
  code: string,
): Promise<string | null | undefined> {
  const pool = new Pool({ connectionString: databaseRoles.applicationUrl });
  try {
    const result = await pool.query<{ device_id: string | null }>(
      `select device_id
       from main_device_recent_denials
       where code = $1
       order by denied_at desc, id desc
       limit 1`,
      [code],
    );
    return result.rows[0]?.device_id;
  } finally {
    await pool.end();
  }
}

async function expectDeniedWithoutMutation({
  apiOrigin,
  code,
  credentials,
  headers,
  send,
  status,
}: {
  readonly apiOrigin: string;
  readonly code: string;
  readonly credentials: MainDeviceCredentials;
  readonly headers: HttpHeaders;
  readonly send?: () => Promise<
    Awaited<ReturnType<typeof requestProofMutation>>
  >;
  readonly status: number;
}): Promise<void> {
  const before = await getProofEvidence(apiOrigin, credentials);
  const denial =
    send === undefined
      ? await requestProofMutation(apiOrigin, credentials, { headers })
      : await send();
  expect(denial.response.status).toBe(status);
  expect(denial.body).toMatchObject({ status: "denied", code });
  if (denial.body.status !== "denied") {
    throw new Error("Expected a denial response");
  }
  expect(denial.body.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  const after = await getProofEvidence(apiOrigin, credentials);
  expect(after.mutationCount).toBe(before.mutationCount);
  expect(denialCount(after, code)).toBe(denialCount(before, code) + 1);
}

function spawnLocalApi(
  port: number,
  databaseRoles: SeparatedDatabaseRoles,
  credentials: MainDeviceCredentials,
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, "../../dist/main.js")],
    {
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        BREEV_MAIN_DEVICE_ID: credentials.deviceId,
        BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
        BREEV_PROOF_RATE_LIMIT: PROOF_RATE_LIMIT,
        BREEV_PROOF_RATE_WINDOW_SECONDS: PROOF_RATE_WINDOW_SECONDS,
        DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
        DATABASE_URL: databaseRoles.applicationUrl,
      },
    },
  );
}

async function waitForHealth(
  apiOrigin: string,
  getOutput: () => string = () => "",
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiOrigin}/health`);
      if (response.status === 200) {
        return;
      }
    } catch {
      await delay(100);
    }
  }
  throw new Error(
    `Local API did not become healthy.\n${apiOrigin}\n${getOutput()}`,
  );
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local API port"));
        return;
      }
      server.close((error) => {
        if (error === undefined) {
          resolve(address.port);
        } else {
          reject(error);
        }
      });
    });
  });
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function expireRateWindow(
  databaseRoles: SeparatedDatabaseRoles,
  credentials: MainDeviceCredentials,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseRoles.applicationUrl });
  try {
    await pool.query(
      `update main_device_rate_windows
       set window_number = window_number - 1
       where device_id = $1 and action = 'proof-mutation'`,
      [credentials.deviceId],
    );
  } finally {
    await pool.end();
  }
}
