import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createSeparatedDatabaseRoles } from "./database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

/**
 * The Windows service starts `dist/main.js` with only API_HOST, API_PORT,
 * DATABASE_URL_FILE, and BREEV_BACKUP_DIRECTORY. The installer runs privileged
 * migrations separately, so the API itself has no migration credentials. This
 * seam locks down the crash-loop class where a database that is unreachable or
 * unmigrated at startup aborted the whole bootstrap before the port bound,
 * which the Windows service manager then restarted forever.
 */
describe.sequential(
  "local API boot under the Windows service configuration",
  () => {
    const startedProcesses: ChildProcessWithoutNullStreams[] = [];
    let postgres: StartedPostgreSqlContainer | undefined;

    afterAll(async () => {
      for (const child of startedProcesses) {
        await stopProcess(child);
      }
      if (postgres !== undefined) {
        await postgres.stop().catch(() => undefined);
      }
    });

    it(
      "stays up and reports degraded when PostgreSQL is unreachable",
      { timeout: 90_000 },
      async () => {
        const unreachablePort = await reservePort();
        const { api, baseUrl, collectOutput } = await spawnWindowsStyleApi(
          `postgresql://breev_app:wrong@127.0.0.1:${unreachablePort}/breev`,
        );
        startedProcesses.push(api);

        const { response, body } = await waitForAnyHealthResponse(baseUrl);
        expect(response.status).toBe(503);
        expect(body).toMatchObject({
          status: "degraded",
          database: "unavailable",
        });
        expect(api.exitCode, collectOutput()).toBeNull();
      },
    );

    it(
      "stays up and reports degraded against an unmigrated database",
      { timeout: 120_000 },
      async () => {
        postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
        const databaseRoles = await createSeparatedDatabaseRoles(postgres);
        const { api, baseUrl, collectOutput } = await spawnWindowsStyleApi(
          databaseRoles.applicationUrl,
        );
        startedProcesses.push(api);

        // The database answers `select 1`, but the durable-job runtime cannot
        // start against the missing schema, so health must not report healthy on
        // an installation whose migrations have not run.
        const { response, body } = await waitForAnyHealthResponse(baseUrl);
        expect(response.status).toBe(503);
        expect(body).toMatchObject({
          status: "degraded",
          database: "unavailable",
        });
        expect(api.exitCode, collectOutput()).toBeNull();
      },
    );
  },
);

async function spawnWindowsStyleApi(databaseUrl: string): Promise<{
  api: ChildProcessWithoutNullStreams;
  baseUrl: string;
  collectOutput: () => string;
}> {
  const configRoot = await mkdtemp(path.join(tmpdir(), "breev-windows-boot-"));
  const databaseUrlFile = path.join(configRoot, "database-url");
  await writeFile(databaseUrlFile, databaseUrl, "ascii");

  const port = await reservePort();
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.DATABASE_URL_FILE;
  delete environment.DATABASE_MIGRATION_URL;
  delete environment.DATABASE_MIGRATION_URL_FILE;
  delete environment.BREEV_INSTALLATION_STATE;

  const api = spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, "../dist/main.js")],
    {
      env: {
        ...environment,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        BREEV_BACKUP_DIRECTORY: path.join(configRoot, "backups"),
        DATABASE_URL_FILE: databaseUrlFile,
      },
    },
  );
  let output = "";
  api.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  api.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  return {
    api,
    baseUrl: `http://127.0.0.1:${port}`,
    collectOutput: () => output,
  };
}

/**
 * Polls exactly the way the installer's Wait-ApiReady does: a plain GET with
 * no Origin header. Any HTTP response proves the bootstrap survived and bound
 * the port.
 */
async function waitForAnyHealthResponse(
  baseUrl: string,
): Promise<{ response: Response; body: unknown }> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      return { response, body: await response.json() };
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }

  throw new Error(`Local API never bound ${baseUrl}: ${String(lastError)}`);
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
