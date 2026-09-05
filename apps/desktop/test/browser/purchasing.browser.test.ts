import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  supplierSchema,
  type PurchaseDraft,
} from "@breev/contracts/local-rest";
import { expect, test, type Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_PASSWORD = "purchasing browser owner password stays in this test";
let delayNextDraftCreateResponse = false;

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface RendererServer {
  readonly origin: string;
  readonly server: Server;
}

test.describe.serial("Supplier and Purchase Draft screens", () => {
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let renderer: RendererServer;
  let supplierId = "";
  const evidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/issue-15/after",
  );

  test.beforeAll(async () => {
    await mkdir(evidenceDir, { recursive: true });
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    credentials = createCredentials();
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${apiPort}`;
    api = startApi(apiPort, databaseRoles, credentials);
    await waitForHealth(apiOrigin);

    expect(
      (
        await apiRequest(
          apiOrigin,
          credentials,
          "POST",
          "/identity/bootstrap",
          {
            owner: {
              displayName: "Purchase Browser Owner",
              password: OWNER_PASSWORD,
              username: "purchase.browser.owner",
            },
            pharmacyName: "Purchase Browser Pharmacy",
          },
        )
      ).status,
    ).toBe(201);
    const supplier = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/suppliers",
      {
        allowanceEffectiveFrom: "2026-01-01",
        defaultAllowancePercentage: "2.5",
        idempotencyKey: uuidV7(),
        name: "Al-Nahrain Medical",
        terms: "Net 30",
      },
    );
    expect(supplier.status).toBe(201);
    supplierId = supplierSchema.parse(supplier.body).id;
    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await postgres?.stop().catch(() => undefined);
  });

  test("enters the header keyboard-first, warns without blocking, and resumes after restart", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await expect(
      page.getByRole("heading", { name: "Purchases" }),
    ).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);

    const invoice = page.getByLabel("Supplier invoice number");
    await invoice.focus();
    await page.keyboard.type("SUP-2026-0042");
    await page.keyboard.press("Tab");
    const supplier = page.getByRole("combobox", {
      name: "Supplier",
      exact: true,
    });
    await expect(supplier).toBeFocused();
    await supplier.selectOption(supplierId);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Cash / debt context")).toBeFocused();
    await page.getByLabel("Cash / debt context").selectOption("debt");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Invoice date")).toBeFocused();
    await page.getByLabel("Invoice date").fill("2026-08-15");
    await page.getByRole("button", { name: "Create durable draft" }).click();

    await expect(page.getByText("2.5%", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft saved and durable.")).toBeVisible();
    await expect(
      page
        .locator(".purchase-snapshot")
        .getByText("Draft version", { exact: true })
        .locator(".."),
    ).toContainText("1");

    await stopProcess(api);
    api = startApi(apiPort, databaseRoles, credentials);
    await waitForHealth(apiOrigin);
    await page.reload();
    await page.getByRole("button", { name: /SUP-2026-0042/ }).click();
    await expect(invoice).toHaveValue("SUP-2026-0042");
    await expect(page.getByText("2.5%", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "New draft" }).click();
    await invoice.fill("SUP-2026-0042");
    await supplier.selectOption(supplierId);
    await page.getByLabel("Invoice date").fill("2026-08-15");
    await page.getByRole("button", { name: "Create durable draft" }).click();
    const warning = page.getByRole("alert");
    await expect(warning).toContainText("Warning:");
    await expect(warning).toContainText("Working default: Warn");
    await expect(page.getByText("Draft saved and durable.")).toBeVisible();

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.keyboard.press("Escape");
    await expect(page.getByText("2.5%", { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("Draft discarded after confirmation."),
    ).toBeVisible();
  });

  test("is accessible in Arabic RTL and English LTR in both themes", async ({
    browser,
  }) => {
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/purchases`);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(
          page.getByRole("heading", {
            name: locale === "ar" ? "المشتريات" : "Purchases",
          }),
        ).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: path.join(
            evidenceDir,
            `purchase-header-${locale}-${theme}.png`,
          ),
        });
        await context.close();
      }
    }
  });

  test("retries an uncertain draft creation without creating a duplicate", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await page.getByLabel("Supplier invoice number").fill("TIMEOUT-RETRY-1");
    await page
      .getByRole("combobox", { name: "Supplier", exact: true })
      .selectOption(supplierId);
    await page.getByLabel("Invoice date").fill("2026-08-15");

    delayNextDraftCreateResponse = true;
    await page.getByRole("button", { name: "Create durable draft" }).click();
    await expect(page.getByText(/The change was not saved/)).toBeVisible({
      timeout: 7_000,
    });
    await page.getByRole("button", { name: "Create durable draft" }).click();
    await expect(page.getByText("Draft saved and durable.")).toBeVisible();

    const active = await apiRequest(
      apiOrigin,
      credentials,
      "GET",
      "/purchases/drafts",
    );
    const drafts = (active.body as { drafts: PurchaseDraft[] }).drafts;
    expect(
      drafts.filter(
        (draft) => draft.supplierInvoiceNumber === "TIMEOUT-RETRY-1",
      ),
    ).toHaveLength(1);
  });

  test("preserves an invalid Supplier header and returns focus for correction", async ({
    page,
  }) => {
    const created = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/suppliers",
      {
        allowanceEffectiveFrom: "2026-01-01",
        defaultAllowancePercentage: "1",
        idempotencyKey: uuidV7(),
        name: "Supplier archived during entry",
        terms: null,
      },
    );
    const invalidSupplier = supplierSchema.parse(created.body);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    const invoice = page.getByLabel("Supplier invoice number");
    const supplier = page.getByRole("combobox", {
      name: "Supplier",
      exact: true,
    });
    await invoice.fill("INVALID-SUPPLIER-1");
    await supplier.selectOption(invalidSupplier.id);
    await page.getByLabel("Invoice date").fill("2026-08-15");
    expect(
      (
        await apiRequest(
          apiOrigin,
          credentials,
          "POST",
          `/suppliers/${invalidSupplier.id}/archivals`,
          {
            expectedRevision: invalidSupplier.revision,
            idempotencyKey: uuidV7(),
          },
        )
      ).status,
    ).toBe(201);

    await page.getByRole("button", { name: "Create durable draft" }).click();
    await expect(page.getByText(/The change was not saved/)).toBeVisible();
    await expect(invoice).toHaveValue("INVALID-SUPPLIER-1");
    await expect(supplier).toHaveValue(invalidSupplier.id);
    await expect(supplier).toBeFocused();
  });
});

async function startRendererServer(
  apiOrigin: string,
  credentials: Credentials,
): Promise<RendererServer> {
  const rendererRoot = path.resolve(import.meta.dirname, "../../out/renderer");
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/health") {
        const upstream = await fetch(`${apiOrigin}/health`);
        response.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (
        request.url?.startsWith("/identity/") ||
        request.url?.startsWith("/suppliers") ||
        request.url?.startsWith("/purchases/")
      ) {
        const body = await readBody(request);
        const upstream = await fetch(`${apiOrigin}${request.url}`, {
          ...(body.length === 0 ? {} : { body }),
          headers: requestHeaders(credentials, body.length > 0),
          method: request.method ?? "GET",
        });
        const upstreamBody = Buffer.from(await upstream.arrayBuffer());
        if (
          delayNextDraftCreateResponse &&
          request.method === "POST" &&
          request.url === "/purchases/drafts"
        ) {
          delayNextDraftCreateResponse = false;
          await new Promise((resolve) => setTimeout(resolve, 5_500));
        }
        response.writeHead(upstream.status, {
          "cache-control": "no-store",
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(upstreamBody);
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
      response.writeHead(200, {
        "content-type":
          extension === ".html"
            ? "text/html; charset=utf-8"
            : extension === ".css"
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8",
      });
      response.end(await readFile(filePath));
    } catch {
      if (!response.headersSent) {
        response
          .writeHead(502, { "content-type": "application/json" })
          .end("{}");
      } else {
        response.destroy();
      }
    }
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${port}`, server };
}

async function installDesktopFake(
  page: Page,
  apiOrigin: string,
  locale: "ar" | "en",
  theme: "dark" | "light",
): Promise<void> {
  await page.addInitScript(
    ({ origin, savedLocale, savedTheme }) => {
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
        reportRendererIncident: async () => ({ accepted: true as const }),
        submitManualEndpoint: async () => pairing,
        submitDiagnostics: async () => ({ status: "unavailable" as const }),
        submitPairingInvitation: async () => pairing,
      });
      Object.defineProperty(globalThis, "breevDesktop", { value: desktopApi });
    },
    { origin: apiOrigin, savedLocale: locale, savedTheme: theme },
  );
}

function startApi(
  port: number,
  roles: SeparatedDatabaseRoles,
  credentials: Credentials,
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [path.resolve(import.meta.dirname, "../../../local-api/dist/main.js")],
    {
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        API_PORT: String(port),
        BREEV_INSTALLATION_STATE: "ready",
        BREEV_MAIN_DEVICE_ID: credentials.deviceId,
        BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
        DATABASE_MIGRATION_URL: roles.migrationUrl,
        DATABASE_URL: roles.applicationUrl,
      },
    },
  );
}

async function apiRequest(
  origin: string,
  credentials: Credentials,
  method: "GET" | "POST" | "PUT",
  route: string,
  body?: unknown,
): Promise<{ body: unknown; status: number }> {
  const response = await fetch(`${origin}${route}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: requestHeaders(credentials, body !== undefined),
    method,
  });
  const text = await response.text();
  return {
    body: text.length === 0 ? undefined : (JSON.parse(text) as unknown),
    status: response.status,
  };
}

function requestHeaders(
  credentials: Credentials,
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

function createCredentials(): Credentials {
  return {
    deviceId: uuidV7(),
    deviceSecret: randomBytes(32).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
}

function uuidV7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readBody(
  request: import("node:http").IncomingMessage,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function waitForHealth(origin: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch {
      // The process has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local API did not become healthy at ${origin}`);
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string")
        reject(new Error("Could not reserve a port"));
      else resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

async function listen(server: Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string")
        reject(new Error("Could not listen"));
      else resolve(address.port);
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

async function stopProcess(
  process: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (process === undefined || process.exitCode !== null) return;
  process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    process.once("exit", () => resolve());
    setTimeout(() => {
      process.kill("SIGKILL");
      resolve();
    }, 5_000).unref();
  });
}
