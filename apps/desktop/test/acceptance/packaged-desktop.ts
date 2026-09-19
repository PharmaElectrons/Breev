import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
} from "@breev/contracts/local-rest";
import type { Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createTcpServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";

import { createSeparatedDatabaseRoles } from "../database-roles.js";
import {
  spawnLocalApiProcess,
  stopProcess,
  waitForHealth,
} from "../local-api-process.js";
import { localApiEntryPoint, packagedExecutablePath } from "./provenance.js";

/**
 * The seam this harness drives: the packaged `Breev.exe` over CDP, against a
 * real `local-api` child process from this checkout, against a real PostgreSQL
 * 18 the test owns for the duration of one locale/theme pass.
 *
 * Each pass takes its own container and its own database so the client
 * scenarios can use their literal names and numbers — "every item containing
 * Extra" is only a checkable claim when the catalogue is exactly the one this
 * pass seeded.
 */
export const POSTGRES_IMAGE = "postgres:18.6-bookworm";

/**
 * The only ambient variables the spawned children inherit.
 *
 * Spreading `process.env` into the packaged desktop and the API would let
 * whatever happens to be set on the operator's shell decide how the build under
 * acceptance behaves — a `BREEV_*` override, a proxy, a Node flag — and the
 * transcript would have no way to say so. The children get this fixed list
 * (only the names that are actually set) plus the `BREEV_*` values the harness
 * itself chooses, and nothing else. The Testcontainers client is *not* in a
 * child: it runs inside the test process, which keeps its own environment, so
 * no Docker variable needs to cross this boundary.
 */
const INHERITED_ENVIRONMENT_KEYS: readonly string[] = [
  // Windows process basics.
  "COMSPEC",
  "HOMEDRIVE",
  "HOMEPATH",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SystemDrive",
  "SystemRoot",
  "windir",
  // Per-user locations Electron and Node write to.
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "USERPROFILE",
  // POSIX equivalents, so the same harness runs under CI's xvfb session.
  "DISPLAY",
  "HOME",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
];

function inheritedEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

export interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

export interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

export class LocalApi {
  public constructor(
    public readonly origin: string,
    private readonly credentials: MainDeviceCredentials,
  ) {}

  public async request(
    method: "DELETE" | "GET" | "POST" | "PUT",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(`${this.origin}${route}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: this.headers(body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
      status: response.status,
    };
  }

  private headers(json: boolean): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: `Breev-Device ${this.credentials.deviceSecret}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
      [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
      [LOCAL_DEVICE_ID_HEADER]: this.credentials.deviceId,
      [LOCAL_DEVICE_SESSION_HEADER]: this.credentials.sessionToken,
      Origin: "breev://app",
    };
  }
}

export interface AcceptanceEnvironment<TFixture> {
  readonly api: LocalApi;
  readonly credentials: MainDeviceCredentials;
  readonly fixture: TFixture;
  /**
   * The variable names the harness itself set on its children, read back from
   * the environment objects that were actually passed rather than from a list
   * kept in step with them by hand.
   */
  readonly injectedEnvironmentKeys: readonly string[];
  stop(): Promise<void>;
  readonly window: Page;
}

/**
 * Brings up the database and the API, seeds through `seed`, and only then
 * launches the packaged desktop.
 *
 * The order matters: the renderer reads its identity state once at start, so a
 * pharmacy bootstrapped after the window opened would leave the packaged app
 * sitting on the bootstrap form with nothing to drive.
 */
export async function startAcceptanceEnvironment<TFixture>(
  seed: (api: LocalApi) => Promise<TFixture>,
): Promise<AcceptanceEnvironment<TFixture>> {
  const credentials = createMainDeviceCredentials();
  let postgres: StartedPostgreSqlContainer | undefined;
  let apiProcess: ChildProcessWithoutNullStreams | undefined;
  let browser: Browser | undefined;
  let desktop: ChildProcessWithoutNullStreams | undefined;
  let userDataDirectory: string | undefined;

  const stop = async (): Promise<void> => {
    await browser?.close().catch(() => undefined);
    await stopProcess(desktop);
    await stopProcess(apiProcess);
    await postgres?.stop().catch(() => undefined);
    if (userDataDirectory !== undefined) {
      await rm(userDataDirectory, { force: true, recursive: true });
    }
  };

  const inherited = inheritedEnvironment();
  const injected = new Set<string>();
  const withInjected = (values: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
    for (const key of Object.keys(values)) injected.add(key);
    return { ...inherited, ...values };
  };

  try {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    const databaseRoles = await createSeparatedDatabaseRoles(postgres);
    const apiPort = await reservePort();
    const apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    apiProcess = spawnLocalApiProcess(
      localApiEntryPoint(),
      withInjected({
        API_HOST: "127.0.0.1",
        API_PORT: String(apiPort),
        BREEV_INSTALLATION_STATE: "ready",
        BREEV_MAIN_DEVICE_ID: credentials.deviceId,
        BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
        DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
        DATABASE_URL: databaseRoles.applicationUrl,
      }),
    );
    await waitForHealth(apiOrigin, "healthy", apiProcess, 60_000);

    const api = new LocalApi(apiOrigin, credentials);
    const fixture = await seed(api);

    const executablePath = packagedExecutablePath();
    await access(executablePath);
    userDataDirectory = await mkdtemp(
      path.join(os.tmpdir(), "breev-m2-acceptance-"),
    );
    desktop = spawn(
      executablePath,
      [
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDirectory}`,
      ],
      {
        env: withInjected({
          BREEV_LOCAL_API_URL: apiOrigin,
          BREEV_MAIN_DEVICE_ID: credentials.deviceId,
          BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
          BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
        }),
      },
    );
    let electronErrors = "";
    desktop.stderr.on("data", (chunk: Buffer) => {
      electronErrors += chunk.toString();
    });
    browser = await connectToPackagedDesktop(
      userDataDirectory,
      () => electronErrors,
    );
    const window = await waitForPackagedWindow(browser, () => electronErrors);

    return {
      api,
      credentials,
      fixture,
      injectedEnvironmentKeys: [...injected].sort(),
      stop,
      window,
    };
  } catch (caught) {
    await stop();
    throw caught;
  }
}

async function connectToPackagedDesktop(
  userDataDirectory: string,
  getElectronErrors: () => string,
): Promise<Browser> {
  const activePortFile = path.join(userDataDirectory, "DevToolsActivePort");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(activePortFile, "utf8");
      const [portString] = content.trim().split("\n");
      const port = Number.parseInt(portString ?? "", 10);
      if (Number.isInteger(port) && port > 0) {
        return await chromium.connectOverCDP(
          `http://127.0.0.1:${String(port)}`,
        );
      }
    } catch {
      await delay(100);
    }
  }
  throw new Error(
    `The packaged Electron debugging endpoint did not start.\n${getElectronErrors()}`,
  );
}

async function waitForPackagedWindow(
  browser: Browser,
  getElectronErrors: () => string,
): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page !== undefined) {
      return page as unknown as Page;
    }
    await delay(100);
  }
  throw new Error(
    `The packaged Breev window was not created.\n${getElectronErrors()}`,
  );
}

export function createMainDeviceCredentials(): MainDeviceCredentials {
  return {
    deviceId: uuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

export function uuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a loopback port"));
      } else {
        resolve(address.port);
      }
    });
  });
  await closeServer(server);
  return port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
