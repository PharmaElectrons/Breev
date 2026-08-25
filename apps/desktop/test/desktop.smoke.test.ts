import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { expect, test } from "@playwright/test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import {
  createServer as createTcpServer,
  type Server as NetServer,
} from "node:net";
import path from "node:path";
import os from "node:os";
import { chromium, type Browser } from "playwright";

import {
  createSeparatedDatabaseRoles,
  type SeparatedDatabaseRoles,
} from "./database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

interface MainDeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

test("the packaged desktop enforces its outer security and health seams", async () => {
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const databaseRoles = await createSeparatedDatabaseRoles(postgres);
  const credentials = createMainDeviceCredentials();
  const apiPort = await reservePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  let api: ChildProcessWithoutNullStreams | undefined = spawnLocalApi(
    apiPort,
    databaseRoles,
    "ready",
    credentials,
  );
  let browser: Browser | undefined;
  let desktop: ChildProcessWithoutNullStreams | undefined;
  let proxy: HealthProxy | undefined;
  const userDataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "breev-desktop-smoke-"),
  );

  try {
    await waitForHealth(apiOrigin, "healthy");
    proxy = await startHealthProxy(apiOrigin);
    const executablePath = packagedExecutablePath();
    await access(executablePath);
    await expectRequiredFuses(executablePath);

    const debuggingPort = await reservePort();
    desktop = spawn(
      executablePath,
      [
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${userDataDirectory}`,
      ],
      {
        env: {
          ...process.env,
          BREEV_LOCAL_API_URL: proxy.origin,
          BREEV_MAIN_DEVICE_ID: credentials.deviceId,
          BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
          BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
          ELECTRON_RENDERER_URL: "https://attacker.example",
        },
      },
    );
    let electronErrors = "";
    desktop.stderr.on("data", (chunk: Buffer) => {
      electronErrors += chunk.toString();
    });
    browser = await connectToPackagedDesktop(
      debuggingPort,
      () => electronErrors,
    );
    const window = await waitForPackagedWindow(browser, () => electronErrors);
    await expect(window.getByTestId("shell-state")).toHaveText("Ready");
    expect(window.url()).toBe("breev://app/index.html");

    const rendererBoundary = await window.evaluate(async () => {
      const runtimeGlobal = globalThis as unknown as {
        breevDesktop: Record<string, unknown>;
        breevRuntime?: unknown;
        ipcRenderer?: unknown;
        process?: unknown;
        require?: unknown;
      };
      const appResponse = await fetch("breev://app/index.html");
      const traversalResponse = await fetch(
        "breev://app/%2e%2e%2fpackage.json",
      );
      let invalidPreloadCall = "accepted";
      try {
        await Reflect.apply(
          runtimeGlobal.breevDesktop.getStartupConfig as () => Promise<unknown>,
          runtimeGlobal.breevDesktop,
          [{ channel: "generic" }],
        );
      } catch {
        invalidPreloadCall = "rejected";
      }

      return {
        appProtocolStatus: appResponse.status,
        csp: appResponse.headers.get("content-security-policy"),
        invalidPreloadCall,
        legacyRuntime: typeof runtimeGlobal.breevRuntime,
        nodeProcess: typeof runtimeGlobal.process,
        nodeRequire: typeof runtimeGlobal.require,
        preloadKeys: Object.keys(runtimeGlobal.breevDesktop),
        rawIpc: typeof runtimeGlobal.ipcRenderer,
        traversalStatus: traversalResponse.status,
      };
    });
    expect(rendererBoundary).toMatchObject({
      appProtocolStatus: 200,
      invalidPreloadCall: "rejected",
      legacyRuntime: "undefined",
      nodeProcess: "undefined",
      nodeRequire: "undefined",
      preloadKeys: ["getStartupConfig"],
      rawIpc: "undefined",
      traversalStatus: 403,
    });
    expect(rendererBoundary.csp).toContain("default-src 'none'");
    expect(rendererBoundary.csp).not.toContain("unsafe-inline");

    const openedWindow = await window.evaluate(
      `globalThis.open("https://example.com", "_blank") === null`,
    );
    expect(openedWindow).toBe(true);

    await stopProcess(api);
    api = undefined;
    await expect(window.getByTestId("shell-state")).toHaveText(
      "Main unavailable",
    );
    await expectNoFallbackStorage(window);

    api = spawnLocalApi(apiPort, databaseRoles, "ready", credentials);
    await waitForHealth(apiOrigin, "healthy");
    await expect(window.getByTestId("shell-state")).toHaveText("Ready");

    proxy.setIncompatible(true);
    await expect(window.getByTestId("shell-state")).toHaveText(
      "Incompatible version",
    );
    proxy.setIncompatible(false);
    await expect(window.getByTestId("shell-state")).toHaveText("Ready");

    await stopProcess(api);
    api = spawnLocalApi(apiPort, databaseRoles, "repair-required", credentials);
    await waitForHealth(apiOrigin, "repair-required");
    await expect(window.getByTestId("shell-state")).toHaveText(
      "Repair required",
    );

    await expectNavigationDenied(window, "https://example.com/forged");
    await expectNavigationDenied(window, "file:///etc/passwd");
  } finally {
    await browser?.close();
    await stopProcess(desktop);
    await closeServer(proxy?.server);
    await stopProcess(api);
    await postgres.stop().catch(() => undefined);
    await rm(userDataDirectory, { force: true, recursive: true });
  }
});

test("the packaged desktop commits through its bound Main session offline and after API restart", async () => {
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const databaseRoles = await createSeparatedDatabaseRoles(postgres);
  const credentials = createMainDeviceCredentials();
  const apiPort = await reservePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  let api: ChildProcessWithoutNullStreams | undefined = spawnLocalApi(
    apiPort,
    databaseRoles,
    "ready",
    credentials,
  );
  let browser: Browser | undefined;
  let desktop: ChildProcessWithoutNullStreams | undefined;
  const userDataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "breev-device-proof-"),
  );

  try {
    await waitForHealth(apiOrigin, "healthy");
    const executablePath = packagedExecutablePath();
    await access(executablePath);
    const debuggingPort = await reservePort();
    desktop = spawn(
      executablePath,
      [
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${userDataDirectory}`,
      ],
      {
        env: {
          ...process.env,
          BREEV_LOCAL_API_URL: apiOrigin,
          BREEV_MAIN_DEVICE_ID: credentials.deviceId,
          BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
          BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
        },
      },
    );
    let electronErrors = "";
    desktop.stderr.on("data", (chunk: Buffer) => {
      electronErrors += chunk.toString();
    });
    browser = await connectToPackagedDesktop(
      debuggingPort,
      () => electronErrors,
    );
    const window = await waitForPackagedWindow(browser, () => electronErrors);
    await expect(window.getByTestId("shell-state")).toHaveText("Ready");
    expect(await window.evaluate("navigator.userAgent")).toContain(
      "Chrome/150.0.7871.224 Electron/43.4.1",
    );

    const browserContext = browser.contexts()[0];
    if (browserContext === undefined) {
      throw new Error("The packaged desktop browser context is unavailable");
    }
    const cdp = await browserContext.newCDPSession(window);
    await cdp.send("Network.enable");
    const requests: Array<{
      readonly headers: Record<string, boolean | number | string>;
      readonly method: string;
      readonly requestId: string;
      readonly url: string;
    }> = [];
    const extraHeaders = new Map<string, Record<string, string>>();
    cdp.on("Network.requestWillBeSent", (event) => {
      requests.push({
        headers: {
          ...event.request.headers,
          ...extraHeaders.get(event.requestId),
        },
        method: event.request.method,
        requestId: event.requestId,
        url: event.request.url,
      });
    });
    cdp.on("Network.requestWillBeSentExtraInfo", (event) => {
      const request = requests.find(
        (candidate) => candidate.requestId === event.requestId,
      );
      if (request === undefined) {
        extraHeaders.set(event.requestId, event.headers);
        return;
      }
      Object.assign(request.headers, event.headers);
    });

    await window.getByRole("button", { name: "Verify Main device" }).click();
    await expect(
      window.getByText("This device and session binding is verified."),
    ).toBeVisible();
    await waitForMutationCount(apiOrigin, credentials, "1");

    const proofRequests = requests.filter((request) =>
      request.url.endsWith("/security/device-session-proof"),
    );
    const preflight = proofRequests.find(
      (request) => request.method === "OPTIONS",
    );
    const mutation = proofRequests.find((request) => request.method === "POST");
    expect(requestHeader(preflight?.headers, "origin")).toBe("breev://app");
    expect(requestHeader(mutation?.headers, "origin")).toBe("breev://app");
    expect(requestHeader(mutation?.headers, "sec-fetch-site")).toBe(
      "cross-site",
    );
    expect(requestHeader(mutation?.headers, "x-breev-csrf")).toBe("1");
    expect(requestHeader(mutation?.headers, "host")).toBe(
      `127.0.0.1:${apiPort}`,
    );

    const screenshotPath = path.resolve(
      import.meta.dirname,
      "../../../evidence/issue-35/after/en-light-device-binding.png",
    );
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await window.screenshot({
      animations: "disabled",
      fullPage: true,
      path: screenshotPath,
    });

    await stopProcess(api);
    api = undefined;
    await expect(window.getByTestId("shell-state")).toHaveText(
      "Main unavailable",
    );
    api = spawnLocalApi(apiPort, databaseRoles, "ready", credentials);
    await waitForHealth(apiOrigin, "healthy");
    await expect(window.getByTestId("shell-state")).toHaveText("Ready");
    await window.getByRole("button", { name: "Verify Main device" }).click();
    await waitForMutationCount(apiOrigin, credentials, "2");
  } finally {
    await browser?.close();
    await stopProcess(desktop);
    await stopProcess(api);
    await postgres.stop().catch(() => undefined);
    await rm(userDataDirectory, { force: true, recursive: true });
  }
});

async function connectToPackagedDesktop(
  debuggingPort: number,
  getElectronErrors: () => string,
): Promise<Browser> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${debuggingPort}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(
    `The packaged Electron debugging endpoint did not start.\n${getElectronErrors()}`,
  );
}

async function waitForPackagedWindow(
  browser: Browser,
  getElectronErrors: () => string,
): Promise<import("@playwright/test").Page> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page !== undefined) {
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `The packaged Breev window was not created.\n${getElectronErrors()}`,
  );
}

interface HealthProxy {
  readonly origin: string;
  readonly server: Server;
  setIncompatible(value: boolean): void;
}

async function startHealthProxy(apiOrigin: string): Promise<HealthProxy> {
  let incompatible = false;
  const server = createServer(async (request, response) => {
    const headers = {
      "access-control-allow-origin": "breev://app",
      "content-type": "application/json",
    };
    if (request.url !== "/health") {
      response.writeHead(404, headers).end("{}");
      return;
    }
    if (incompatible) {
      response.writeHead(200, headers).end(
        JSON.stringify({
          apiVersion: "1",
          schemaVersion: "1",
          status: "healthy",
          database: "available",
        }),
      );
      return;
    }

    try {
      const upstream = await fetch(`${apiOrigin}/health`);
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502, headers).end("{}");
    }
  });
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    server,
    setIncompatible(value) {
      incompatible = value;
    },
  };
}

async function expectRequiredFuses(executablePath: string): Promise<void> {
  const fuses = await getCurrentFuseWire(executablePath);
  expect(fuses[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
  expect(fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(
    FuseState.DISABLE,
  );
  expect(fuses[FuseV1Options.EnableNodeCliInspectArguments]).toBe(
    FuseState.DISABLE,
  );
  expect(fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).not.toBe(
    FuseState.ENABLE,
  );
  expect(fuses[FuseV1Options.OnlyLoadAppFromAsar]).not.toBe(FuseState.ENABLE);
}

async function expectNavigationDenied(
  window: import("@playwright/test").Page,
  target: string,
): Promise<void> {
  const currentUrl = window.url();
  await window.evaluate(
    (url) =>
      (
        globalThis as unknown as { location: { assign(target: string): void } }
      ).location.assign(url),
    target,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(window.url()).toBe(currentUrl);
}

async function expectNoFallbackStorage(
  window: import("@playwright/test").Page,
): Promise<void> {
  const evidence = await window.evaluate(`(async () => ({
    caches: await caches.keys(),
    databases: (await indexedDB.databases()).map((database) => database.name),
    localKeys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage)
  }))()`);
  expect(evidence).toEqual({
    caches: [],
    databases: [],
    localKeys: [],
    sessionKeys: [],
  });
}

function spawnLocalApi(
  port: number,
  databaseRoles: SeparatedDatabaseRoles,
  installationState: "ready" | "repair-required" = "ready",
  credentials?: MainDeviceCredentials,
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, "../../local-api/dist/main.js")],
    {
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        BREEV_INSTALLATION_STATE: installationState,
        BREEV_MAIN_DEVICE_ID: credentials?.deviceId,
        BREEV_MAIN_DEVICE_SECRET: credentials?.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: credentials?.sessionToken,
        DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
        DATABASE_URL: databaseRoles.applicationUrl,
      },
    },
  );
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

async function waitForMutationCount(
  apiOrigin: string,
  credentials: MainDeviceCredentials,
  expectedCount: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiOrigin}/security/device-session-proof`, {
      headers: {
        Authorization: `Breev-Device ${credentials.deviceSecret}`,
        "X-Breev-CSRF": "1",
        "X-Breev-Device-Id": credentials.deviceId,
        "X-Breev-Device-Session": credentials.sessionToken,
        Origin: "breev://app",
      },
    });
    const body = (await response.json()) as { mutationCount?: string };
    if (body.mutationCount === expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The proof mutation count did not reach ${expectedCount}`);
}

function requestHeader(
  headers: Record<string, boolean | number | string> | undefined,
  requestedName: string,
): boolean | number | string | undefined {
  return Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === requestedName.toLowerCase(),
  )?.[1];
}

function packagedExecutablePath(): string {
  const artifact = path.resolve(
    import.meta.dirname,
    `../../../artifacts/Breev-${process.platform}-${process.arch}`,
  );
  if (process.platform === "win32") {
    return path.join(artifact, "Breev.exe");
  }
  if (process.platform === "darwin") {
    return path.join(artifact, "Breev.app", "Contents", "MacOS", "Breev");
  }
  return path.join(artifact, "Breev");
}

async function waitForHealth(
  baseUrl: string,
  status: "healthy" | "repair-required",
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const body = (await response.json()) as { status?: string };
      if (body.status === status) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Local API did not report ${status} at ${baseUrl}`);
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function listen(server: NetServer): Promise<number> {
  return await new Promise((resolve, reject) => {
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
}

async function closeServer(server: NetServer | undefined): Promise<void> {
  if (server === undefined) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
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
