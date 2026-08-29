import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect } from "node:net";
import { createServer } from "node:net";
import { request } from "node:https";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "./database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const MAIN_ENTRY = path.resolve(import.meta.dirname, "../dist/main.js");

// The installer wires BREEV_LAN_API_HOST and BREEV_LAN_API_PORT into the
// service only when it resolves a LAN address; a single-machine installation
// registers neither. This proves both halves of that switch through the same
// entrypoint the Windows service runs: with the endpoint set the LAN mutual-TLS
// listener binds and serves the pre-authentication pairing route, and with it
// unset nothing binds the LAN port at all. The listener runs on 127.0.0.1 here
// because that is a concrete address the harness can reach; the address the
// installer chooses on a pharmacy machine is a routable LAN address instead.
describe.sequential("Windows service LAN listener seam", () => {
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseRoles = await createSeparatedDatabaseRoles(postgres);
  }, 120_000);

  afterAll(async () => {
    if (postgres !== undefined) {
      await postgres.stop().catch(() => undefined);
    }
  });

  it("binds the LAN mutual-TLS listener when the endpoint is configured", async () => {
    const apiPort = await reservePort();
    const lanPort = await reservePort();
    const api = startApi({
      apiPort,
      lan: { host: "127.0.0.1", port: lanPort },
    });
    try {
      await waitForHealth(apiPort, api);
      // The loopback listener comes up before the LAN server, which then
      // initializes the pharmacy CA and issues its certificate, so a healthy
      // /health does not yet guarantee the LAN port is accepting. Poll it until
      // it answers rather than racing a single request against that startup.
      const caCertificate = await waitForPairingCaCertificate(lanPort, api);
      expect(caCertificate.status).toBe(200);
      expect(caCertificate.body).toMatch(/-----BEGIN CERTIFICATE-----/);
    } finally {
      await stopProcess(api);
    }
  }, 120_000);

  it("binds no LAN listener when the endpoint is absent", async () => {
    const apiPort = await reservePort();
    const lanPort = await reservePort();
    const api = startApi({ apiPort });
    try {
      await waitForHealth(apiPort, api);
      await expect(probeTcp(lanPort)).resolves.toBe("refused");
    } finally {
      await stopProcess(api);
    }
  }, 120_000);

  function startApi(options: {
    apiPort: number;
    lan?: { host: string; port: number };
  }): ChildProcessWithoutNullStreams {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(options.apiPort),
      DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
      DATABASE_URL: databaseRoles.applicationUrl,
    };
    if (options.lan !== undefined) {
      environment.BREEV_LAN_API_HOST = options.lan.host;
      environment.BREEV_LAN_API_PORT = String(options.lan.port);
    }
    const api = spawn(process.execPath, [MAIN_ENTRY], { env: environment });
    let output = "";
    const record = (chunk: Buffer) => {
      output += chunk.toString();
    };
    api.stdout.on("data", record);
    api.stderr.on("data", record);
    api.once("exit", (code) => {
      if (code !== null && code !== 0) {
        process.stderr.write(`local API exited with ${code}: ${output}\n`);
      }
    });
    return api;
  }
});

async function waitForPairingCaCertificate(
  lanPort: number,
  api: ChildProcessWithoutNullStreams,
): Promise<{ body: string; status: number }> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) {
      throw new Error(`local API exited early with code ${api.exitCode}`);
    }
    try {
      const response = await getPairingCaCertificate(lanPort);
      if (response.status === 200) {
        return response;
      }
      lastError = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      // ECONNREFUSED while the LAN server is still binding: keep polling.
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `the LAN listener did not answer in time: ${String(lastError)}`,
  );
}

async function getPairingCaCertificate(
  lanPort: number,
): Promise<{ body: string; status: number }> {
  return await new Promise((resolve, reject) => {
    const call = request(
      {
        host: "127.0.0.1",
        port: lanPort,
        path: "/pairing/ca-certificate",
        method: "GET",
        headers: { host: `127.0.0.1:${lanPort}` },
        // The listener presents a pharmacy-CA-signed certificate this harness
        // has no prior trust for; the endpoint under test is reachability, not
        // the certificate chain, which the terminal verifies against the
        // pinned fingerprint in its own pairing flow.
        rejectUnauthorized: false,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          resolve({ body, status: response.statusCode ?? 0 });
        });
      },
    );
    call.once("error", reject);
    call.end();
  });
}

function probeTcp(port: number): Promise<"open" | "refused"> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve("open");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") {
        resolve("refused");
        return;
      }
      reject(error);
    });
  });
}

async function waitForHealth(
  apiPort: number,
  api: ChildProcessWithoutNullStreams,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) {
      throw new Error(`local API exited early with code ${api.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/health`);
      const body = (await response.json()) as { status?: string };
      if (response.status === 200 && body.status === "healthy") {
        return;
      }
    } catch {
      // The service is not accepting connections yet.
    }
    await delay(500);
  }
  throw new Error("the local API did not become healthy");
}

async function stopProcess(api: ChildProcessWithoutNullStreams): Promise<void> {
  if (api.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    api.once("exit", () => resolve());
    api.kill("SIGTERM");
    setTimeout(() => api.kill("SIGKILL"), 5_000).unref();
  });
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("could not reserve a port"));
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
