import { expect, test, type Page } from "@playwright/test";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
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
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import { Pool } from "pg";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../database-roles.js";
import {
  spawnLocalApiProcess,
  stopProcess,
  waitForHealth,
} from "../local-api-process.js";
import { evidencePath } from "./evidence-path.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "shell.nav.owner";
const OWNER_PASSWORD = "shell navigation test password stays here";

const EVIDENCE_DIR = evidencePath("shell-navigation", "after");

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface RendererServer {
  readonly origin: string;
  readonly server: Server;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function uuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createCredentials(): Credentials {
  return {
    deviceId: uuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function requestHeaders(
  currentCredentials: Credentials,
  json: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Breev-Device ${currentCredentials.deviceSecret}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: currentCredentials.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: currentCredentials.sessionToken,
    Origin: "breev://app",
  };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function listen(server: Server): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not listen for the renderer"));
      } else {
        resolve(address.port);
      }
    });
  });
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
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

function isApiRoute(url: string | undefined): boolean {
  return (
    url?.startsWith("/identity/") === true ||
    url?.startsWith("/catalog/") === true ||
    url?.startsWith("/inventory/") === true ||
    url?.startsWith("/sales/") === true ||
    url?.startsWith("/purchases/") === true ||
    url?.startsWith("/suppliers") === true
  );
}

async function startRendererServer(
  currentApiOrigin: string,
  currentCredentials: Credentials,
): Promise<RendererServer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/health") {
        const upstream = await fetch(`${currentApiOrigin}/health`);
        response.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (isApiRoute(request.url)) {
        const body = await readBody(request);
        const upstream = await fetch(`${currentApiOrigin}${request.url}`, {
          ...(body.length === 0 ? {} : { body }),
          headers: requestHeaders(currentCredentials, body.length > 0),
          method: request.method ?? "GET",
        });
        response.writeHead(upstream.status, {
          "cache-control": "no-store",
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (request.url === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      const pathname = request.url === "/" ? "/index.html" : request.url;
      if (pathname === undefined || pathname.includes("..")) {
        response.writeHead(403).end();
        return;
      }
      const filePath = path.resolve(rendererRoot, `.${pathname.split("?")[0]}`);
      const extension = path.extname(filePath);
      const contentType =
        extension === ".html"
          ? "text/html; charset=utf-8"
          : extension === ".css"
            ? "text/css; charset=utf-8"
            : extension === ".js"
              ? "text/javascript; charset=utf-8"
              : extension === ".woff2"
                ? "font/woff2"
                : extension === ".woff"
                  ? "font/woff"
                  : "application/octet-stream";
      response.writeHead(200, {
        "content-type": contentType,
      });
      response.end(await readFile(filePath));
    } catch {
      if (!response.headersSent) response.writeHead(502).end("{}");
      else response.destroy();
    }
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${String(port)}`, server };
}

async function installDesktopFake(
  page: Page,
  currentApiOrigin: string,
  locale: "ar" | "en",
  theme: "dark" | "light",
): Promise<void> {
  await page.addInitScript(
    ({ apiOrigin: origin, locale: savedLocale, theme: savedTheme }) => {
      localStorage.setItem("breev.locale", savedLocale);
      localStorage.setItem("breev.theme", savedTheme);
      const pairing = { candidates: [], stage: "awaiting-invitation" as const };
      const desktopApi: BreevDesktopApi = Object.freeze({
        cancelTerminalPairing: async () => pairing,
        copyIdentifier: async () => ({ copied: true as const }),
        exportDiagnostics: async () => ({ status: "saved" as const }),
        getStartupConfig: async () => ({
          diagnosticReporting: "disabled" as const,
          localApiOrigin: origin,
          role: "main" as const,
        }),
        getTerminalPairingState: async () => pairing,
        openSupport: async () => ({ status: "unavailable" as const }),
        printBarcodeLabel: async () => ({ status: "handed-off" as const }),
        reportRendererIncident: async () => ({ accepted: true as const }),
        saveInventoryExport: async () => ({ status: "saved" as const }),
        submitDiagnostics: async () => ({ status: "unavailable" as const }),
        submitManualEndpoint: async () => pairing,
        submitPairingInvitation: async () => pairing,
      });
      Object.defineProperty(globalThis, "breevDesktop", {
        configurable: false,
        value: desktopApi,
        writable: false,
      });
    },
    { apiOrigin: currentApiOrigin, locale, theme },
  );
}

test.describe.serial("Shell Header and Navbar Stability Across Tabs", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let renderer: RendererServer;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await mkdir(EVIDENCE_DIR, { recursive: true });

    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    credentials = createCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = spawnLocalApiProcess(
      path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
      {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(apiPort),
        BREEV_INSTALLATION_STATE: "ready",
        BREEV_MAIN_DEVICE_ID: credentials.deviceId,
        BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
        DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
        DATABASE_URL: databaseRoles.applicationUrl,
      },
    );
    await waitForHealth(apiOrigin, "healthy", api);

    const bootstrapResponse = await fetch(`${apiOrigin}/identity/bootstrap`, {
      method: "POST",
      headers: requestHeaders(credentials, true),
      body: JSON.stringify({
        owner: {
          displayName: "Test Owner",
          password: OWNER_PASSWORD,
          username: OWNER_USERNAME,
        },
        pharmacyName: "Breev Navigation Pharmacy",
      }),
    });
    expect(bootstrapResponse.status).toBe(201);

    const loginResponse = await fetch(`${apiOrigin}/identity/login`, {
      method: "POST",
      headers: requestHeaders(credentials, true),
      body: JSON.stringify({
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      }),
    });
    expect(loginResponse.status).toBe(200);

    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    if (renderer?.server) {
      await new Promise<void>((resolve) =>
        renderer.server.close(() => resolve()),
      );
    }
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("preserves 100% identical header, brand, navbar, and controls dimensions across all tabs", async ({
    page,
  }) => {
    // Set standard desktop viewport 1280x800
    await page.setViewportSize({ width: 1280, height: 800 });

    // Mock Desktop Bridge to use real proxied renderer server
    await installDesktopFake(page, renderer.origin, "en", "light");

    const measurements: Record<
      string,
      {
        headerBox: BoundingBox;
        brandBox: BoundingBox;
        navBox: BoundingBox;
        endBox: BoundingBox;
      }
    > = {};

    const tabsToTest = [
      {
        id: "dashboard",
        name: "Dashboard",
        selector: 'a.module-tab[data-module="dashboard"]',
        workspaceSelector: ".home-dashboard",
      },
      {
        id: "sales",
        name: "Sales",
        selector: 'a.module-tab[data-module="sales"]',
        workspaceSelector: ".sales-screen",
      },
      {
        id: "purchases",
        name: "Purchases",
        selector: 'a.module-tab[data-module="purchases"]',
        workspaceSelector: ".purchasing-workspace",
      },
      {
        id: "inventory",
        name: "Inventory",
        selector: 'a.module-tab[data-module="inventory"]',
        workspaceSelector: ".inventory-workspace",
      },
      {
        id: "settings",
        name: "Settings",
        selector: "#/settings",
        workspaceSelector: ".settings-workspace",
      },
    ];

    // 1. Initial load at Dashboard
    await page.goto(`${renderer.origin}#/`);
    await expect(page.locator(".shell-header")).toBeVisible();
    await expect(page.locator(".home-dashboard")).toBeVisible();

    for (const [i, tab] of tabsToTest.entries()) {
      if (tab.id === "settings") {
        // Open collapse menu and click Settings
        const trigger = page.getByTestId("collapse-menu-trigger");
        await trigger.click();
        const settingsLink = page.locator(
          'a.collapse-menu-item[href="#/settings"]',
        );
        await expect(settingsLink).toBeVisible();
        await settingsLink.click();
      } else if (i > 0) {
        // Click navbar tab
        const tabLink = page.locator(tab.selector);
        await tabLink.click();
      }

      // Wait for the workspace body to be active
      await expect(page.locator(tab.workspaceSelector)).toBeVisible();

      // Ensure stable render
      await page.waitForTimeout(100);

      const header = page.locator(".shell-header");
      const brand = page.locator(".brand-lockup");
      const nav = page.locator(".module-nav");
      const end = page.locator(".shell-header-end");

      const headerBox = await header.boundingBox();
      const brandBox = await brand.boundingBox();
      const navBox = await nav.boundingBox();
      const endBox = await end.boundingBox();

      expect(headerBox).not.toBeNull();
      expect(brandBox).not.toBeNull();
      expect(navBox).not.toBeNull();
      expect(endBox).not.toBeNull();

      measurements[tab.id] = {
        headerBox: headerBox!,
        brandBox: brandBox!,
        navBox: navBox!,
        endBox: endBox!,
      };

      // Take screenshot for evidence
      const filename = `tab-${i + 1}-${tab.id}.png`;
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, filename),
        fullPage: false,
      });

      console.log(`[Tab: ${tab.name}] Measured:`, {
        header: `${headerBox!.width}x${headerBox!.height} @ (${headerBox!.x}, ${headerBox!.y})`,
        brandWidth: brandBox!.width,
        nav: `width=${navBox!.width} @ x=${navBox!.x}`,
        endWidth: endBox!.width,
      });
    }

    // Strictly assert that across all 5 views, dimensions are 100% identical!
    const views = ["dashboard", "sales", "purchases", "inventory", "settings"];
    const base = measurements["dashboard"];
    expect(base).toBeDefined();
    if (!base) return;

    for (const view of views) {
      const current = measurements[view];
      expect(current).toBeDefined();
      if (!current) continue;

      // 1. headerBox: x, y, width, height must be 100% identical
      expect(current.headerBox.x, `${view} headerBox.x`).toBe(base.headerBox.x);
      expect(current.headerBox.y, `${view} headerBox.y`).toBe(base.headerBox.y);
      expect(current.headerBox.width, `${view} headerBox.width`).toBe(
        base.headerBox.width,
      );
      expect(current.headerBox.height, `${view} headerBox.height`).toBe(
        base.headerBox.height,
      );

      // 2. navBox: x, width must be 100% identical
      expect(current.navBox.x, `${view} navBox.x`).toBe(base.navBox.x);
      expect(current.navBox.width, `${view} navBox.width`).toBe(
        base.navBox.width,
      );

      // 3. brandBox: width must be 100% identical
      expect(current.brandBox.width, `${view} brandBox.width`).toBe(
        base.brandBox.width,
      );

      // 4. endBox: width must be 100% identical
      expect(current.endBox.width, `${view} endBox.width`).toBe(
        base.endBox.width,
      );
    }
  });
});
