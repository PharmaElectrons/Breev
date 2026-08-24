import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { expect, test } from "@playwright/test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import {
  createServer as createTcpServer,
  type Server as NetServer,
} from "node:net";
import path from "node:path";
import os from "node:os";
import { chromium, type Browser } from "playwright";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

test("the packaged desktop enforces its outer security and health seams", async () => {
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const apiPort = await reservePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  let api: ChildProcessWithoutNullStreams | undefined = spawnLocalApi(
    apiPort,
    postgres.getConnectionUri(),
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
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${userDataDirectory}`,
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      ],
      {
        env: {
          ...process.env,
          BREEV_LOCAL_API_URL: proxy.origin,
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

    api = spawnLocalApi(apiPort, postgres.getConnectionUri());
    await waitForHealth(apiOrigin, "healthy");
    await expect(window.getByTestId("shell-state")).toHaveText("Ready");

    proxy.setIncompatible(true);
    await expect(window.getByTestId("shell-state")).toHaveText(
      "Incompatible version",
    );
    proxy.setIncompatible(false);
    await expect(window.getByTestId("shell-state")).toHaveText("Ready");

    await stopProcess(api);
    api = spawnLocalApi(
      apiPort,
      postgres.getConnectionUri(),
      "repair-required",
    );
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
          apiVersion: "2",
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
  databaseUrl: string,
  installationState: "ready" | "repair-required" = "ready",
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
        DATABASE_URL: databaseUrl,
      },
    },
  );
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
