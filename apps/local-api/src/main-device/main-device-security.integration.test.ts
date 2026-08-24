import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  localProofEvidenceContract,
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
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const PACKAGED_RENDERER_ORIGIN = "breev://app";

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
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    credentials = createMainDeviceCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = spawnLocalApi(apiPort, postgres.getConnectionUri(), credentials);
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
    await waitForRateWindow();
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

  it("rejects a session token replayed from another device context", async () => {
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
    await waitForRateWindow();
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
    await waitForRateWindow();
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

    await stopProcess(api);
    api = spawnLocalApi(apiPort, postgres.getConnectionUri(), credentials);
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

    await waitForRateWindow();
    const afterWindow = await requestProofMutation(apiOrigin, credentials);
    expect(afterWindow.response.status).toBe(201);
    expect(afterWindow.body).toMatchObject({ status: "committed" });
  });

  it("bounds recent denial rows while retaining every denial in totals", async () => {
    await waitForRateWindow();
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

  function collectApiOutput(chunk: Buffer): void {
    apiOutput += chunk.toString();
  }
});

function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: randomUUID(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
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
  databaseUrl: string,
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
        BREEV_PROOF_RATE_LIMIT: "3",
        BREEV_PROOF_RATE_WINDOW_SECONDS: "2",
        DATABASE_URL: databaseUrl,
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

async function waitForRateWindow(): Promise<void> {
  const windowMilliseconds = 2_000;
  const untilNextWindow =
    windowMilliseconds - (Date.now() % windowMilliseconds) + 100;
  await delay(untilNextWindow);
}
