import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
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
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_PASSWORD = "correct horse battery staple, ca edition";
/** A health round-trip stalling on CA creation measured 1474 ms before the
 * fix this suite proves. A healthy read path should answer in a small
 * fraction of that. */
const HEALTH_LATENCY_BOUND_MS = 200;

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface ApiResponse {
  readonly body: Record<string, unknown> | undefined;
  readonly status: number;
}

/**
 * Proves, through real HTTP against a real PostgreSQL instance, that the read
 * paths `integration/identity-review` fixed — `GET
 * /devices/pairing-sessions/current`, the device inventory, and every
 * command that presupposes a pharmacy CA — never create one. It is spawned
 * exactly like `identity-access.integration.test.ts`, deliberately
 * **without** `BREEV_LAN_API_HOST`: with no LAN endpoint configured,
 * `main.ts` never calls `createLanMtlsServer`, so nothing calls
 * `PharmacyCaService.initializeCA()` at boot. That absence is what makes this
 * suite able to prove a read path avoids creating the CA — `devices
 * .integration.test.ts` boots the LAN mTLS server in its own `beforeAll`,
 * which needs a Windows CNG machine key that an unelevated account on this
 * host cannot get, so that whole suite (27 cases) skips here instead.
 *
 * Pairing-start itself is the one command that is allowed to create the CA,
 * and it needs the same CNG machine key. It cannot be exercised in this
 * environment either, and this suite does not fake or mock the key store to
 * work around that — it simply does not test pairing-start.
 */
describe.sequential("devices CA read-path seam", () => {
  let administrator: Pool;
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
    api = startApi();
    await waitForHealth(apiOrigin, () => apiOutput);
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });

    const bootstrap = await request(
      credentials,
      "POST",
      "/identity/bootstrap",
      {
        owner: {
          displayName: "CA Suite Owner",
          password: OWNER_PASSWORD,
          username: "ca.suite.owner",
        },
        pharmacyName: "Breev CA Read-Path Test Pharmacy",
      },
    );
    expect(bootstrap.status, failureContext([bootstrap])).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("never creates a pharmacy CA from repeated pairing-session status polls", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(
        credentials,
        "GET",
        "/devices/pairing-sessions/current",
      );
      expect(response, failureContext([response])).toMatchObject({
        status: 200,
        body: { state: "none" },
      });
    }
    expect(await pharmacyCaRowCount()).toBe(0);
  });

  it("never creates a pharmacy CA from the device inventory read", async () => {
    const response = await request(credentials, "GET", "/devices");
    expect(response, failureContext([response])).toMatchObject({
      status: 200,
      body: { devices: [], seatUsage: null },
    });
    expect(await pharmacyCaRowCount()).toBe(0);
  });

  it("denies every CA-presupposing command as ca-not-found, honestly, and creates no CA", async () => {
    const attempts: { label: string; response: ApiResponse }[] = [
      {
        label: "confirm",
        response: await request(
          credentials,
          "POST",
          `/devices/pairing-sessions/${createUuidV7()}/confirmation`,
          { idempotencyKey: createUuidV7() },
        ),
      },
      {
        label: "cancel",
        response: await request(
          credentials,
          "POST",
          `/devices/pairing-sessions/${createUuidV7()}/cancellation`,
          { idempotencyKey: createUuidV7(), reason: "user-cancelled" },
        ),
      },
      {
        label: "revoke",
        response: await request(
          credentials,
          "POST",
          `/devices/${createUuidV7()}/revocations`,
          {
            idempotencyKey: createUuidV7(),
            reason: "no CA has ever existed on this installation",
            stepUpChallengeId: createUuidV7(),
          },
        ),
      },
      {
        label: "seat-release-request",
        response: await request(
          credentials,
          "POST",
          "/devices/seat-release-requests",
          {
            deviceId: createUuidV7(),
            idempotencyKey: createUuidV7(),
            stepUpChallengeId: createUuidV7(),
          },
        ),
      },
      {
        label: "seat-release-approve",
        response: await request(
          credentials,
          "POST",
          `/devices/seat-release-requests/${createUuidV7()}/approvals`,
          {
            approverPassword: "does not matter, denied first",
            approverUsername: "nobody",
            idempotencyKey: createUuidV7(),
          },
        ),
      },
    ];

    for (const { label, response } of attempts) {
      expect(response, `${label}: ${failureContext([response])}`).toMatchObject(
        {
          status: 409,
          body: { code: "ca-not-found", status: "denied" },
        },
      );
    }

    const audit = await administrator.query<{
      installation_id: string | null;
      outcome: string;
    }>(
      `select installation_id, outcome from devices_audit_records
       where outcome = 'ca-not-found'
       order by occurred_at`,
    );
    expect(audit.rowCount).toBe(attempts.length);
    for (const row of audit.rows) {
      expect(row.installation_id).toBeNull();
      expect(row.outcome).toBe("ca-not-found");
    }
    expect(await pharmacyCaRowCount()).toBe(0);
  });

  it("keeps a concurrent GET /health well under the pre-fix stall while polling status", async () => {
    const pollLoop = (async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await request(credentials, "GET", "/devices/pairing-sessions/current");
      }
    })();

    const startedAt = Date.now();
    const health = await fetch(`${apiOrigin}/health`);
    const elapsedMs = Date.now() - startedAt;
    const healthBody = (await health.json()) as { status?: string };
    await pollLoop;

    // Printed as completion evidence for the fix this suite proves: the
    // stall it replaced measured 1474ms.
    console.info(`[devices-ca] GET /health round-trip: ${elapsedMs}ms`);
    expect(health.status, JSON.stringify(healthBody)).toBe(200);
    expect(healthBody.status).toBe("healthy");
    expect(
      elapsedMs,
      `GET /health took ${elapsedMs}ms concurrently with a status poll`,
    ).toBeLessThan(HEALTH_LATENCY_BOUND_MS);
  });

  async function pharmacyCaRowCount(): Promise<number> {
    const result = await administrator.query<{ count: string }>(
      "select count(*)::text as count from pharmacy_ca",
    );
    return Number(result.rows[0]?.count ?? "-1");
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
    child.stdout.on("data", collectOutput);
    child.stderr.on("data", collectOutput);
    return child;
  }

  function collectOutput(chunk: Buffer): void {
    apiOutput += chunk.toString();
  }

  function failureContext(responses: readonly ApiResponse[]): string {
    return `${apiOutput}\n${JSON.stringify(responses)}`;
  }

  async function request(
    binding: MainDeviceCredentials,
    method: "GET" | "PATCH" | "POST" | "PUT",
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
