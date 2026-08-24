import {
  parseLocalHealthResponse,
  type LocalHealthResponse,
} from "@breev/contracts/local-rest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "./database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

describe.sequential("local API health persistence seam", () => {
  let api: ChildProcessWithoutNullStreams;
  let apiOutput = "";
  let baseUrl: string;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    api = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../dist/main.js")],
      {
        env: {
          ...process.env,
          API_HOST: "127.0.0.1",
          API_PORT: String(port),
          DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
          DATABASE_URL: databaseRoles.applicationUrl,
        },
      },
    );
    api.stdout.on("data", (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });
    api.stderr.on("data", (chunk: Buffer) => {
      apiOutput += chunk.toString();
    });

    await waitForHealth(baseUrl);
  });

  afterAll(async () => {
    await stopProcess(api);
    if (postgres !== undefined) {
      await postgres.stop().catch(() => undefined);
    }
  });

  it("reports healthy only after a real PostgreSQL query succeeds", async () => {
    const { response, body } = await getHealth(baseUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "breev://app",
    );
    expect(body).toMatchObject({
      status: "healthy",
      database: "available",
    });
  });

  it("reports the defined repair requirement from the real API", async () => {
    const repairPort = await reservePort();
    const repairBaseUrl = `http://127.0.0.1:${repairPort}`;
    const repairApi = spawn(
      process.execPath,
      [path.resolve(import.meta.dirname, "../dist/main.js")],
      {
        env: {
          ...process.env,
          API_HOST: "127.0.0.1",
          API_PORT: String(repairPort),
          BREEV_INSTALLATION_STATE: "repair-required",
          DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
          DATABASE_URL: databaseRoles.applicationUrl,
        },
      },
    );

    try {
      const { response, body } = await waitForRepairRequired(repairBaseUrl);
      expect(response.status).toBe(503);
      expect(body).toEqual({
        apiVersion: "2",
        schemaVersion: "1",
        status: "repair-required",
        repair: { code: "installation-state-invalid" },
      });
    } finally {
      await stopProcess(repairApi);
    }
  });

  it("keeps the API reachable and reports PostgreSQL failure", async () => {
    await postgres.stop();

    const { response, body } = await waitForDatabaseUnavailable(baseUrl);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      database: "unavailable",
    });
    expect(api.exitCode, apiOutput).toBeNull();
  });
});

async function getHealth(
  baseUrl: string,
): Promise<{ response: Response; body: LocalHealthResponse }> {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: "breev://app" },
  });
  const payload: unknown = await response.json();
  return {
    response,
    body: parseLocalHealthResponse(response.status, payload),
  };
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const { response } = await getHealth(baseUrl);
      if (response.status === 200) {
        return;
      }
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Local API did not become healthy at ${baseUrl}`);
}

async function waitForDatabaseUnavailable(
  baseUrl: string,
): Promise<{ response: Response; body: LocalHealthResponse }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await getHealth(baseUrl);
    if (result.response.status === 503) {
      return result;
    }
    await delay(100);
  }

  throw new Error("Local API did not report the stopped PostgreSQL instance");
}

async function waitForRepairRequired(
  baseUrl: string,
): Promise<{ response: Response; body: LocalHealthResponse }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const result = await getHealth(baseUrl);
      if (result.body.status === "repair-required") {
        return result;
      }
    } catch {
      await delay(100);
    }
  }

  throw new Error("Local API did not report the repair-required signal");
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
