import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type Supplier,
} from "@breev/contracts/local-rest";
import { expect, test, type Page } from "@playwright/test";
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
const OWNER_USERNAME = "batch.safety.browser.owner";
const OWNER_PASSWORD = "batch safety browser owner password stays in this test";
const MANAGER_USERNAME = "batch.safety.browser.manager";
const MANAGER_PASSWORD =
  "batch safety browser manager password stays in this test";

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}
interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}
interface RendererServer {
  readonly origin: string;
  readonly server: Server;
}

test.describe.serial("batch safety renderer", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let product: Product;
  let renderer: RendererServer;
  let today = "";
  let nearExpiry = "";

  test.beforeAll("real local API fixture", async () => {
    test.setTimeout(180_000);
    await mkdir(evidencePath("issue-55", "after"), { recursive: true });
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
    const apiPort = await reservePort();
    apiOrigin = "http://127.0.0.1:" + String(apiPort);
    api = startApi(apiPort, credentials, databaseRoles);
    await waitForHealth(apiOrigin, "healthy", api);
    const bootstrap = await apiRequest("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Batch Safety Browser Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Batch Safety Browser Pharmacy",
    });
    expect(bootstrap.status).toBe(201);
    today = businessDate(new Date());
    nearExpiry = addDays(today, 10);
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const supplier = await createSupplier();
    const created = await apiRequest(
      "POST",
      "/catalog/products",
      medicationRequest(),
    );
    expect(created.status).toBe(201);
    product = created.body as Product;
    await postPurchase(supplier, product);
    await createManagerUser(
      String(
        (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
      ),
    );
    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("previews FEFO with a near-expiry warning and expired block", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await openMovements(page);
    await page.getByLabel("Quantity", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Preview pick" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "FEFO" }),
    ).toContainText("FEFO");
    await expect(
      page.locator(
        ".batch-safety-preview-result [data-eligibility='near-expiry']",
      ),
    ).toContainText("Near expiry");
    await expect(page.locator(".batch-safety-warning")).toContainText(
      "near expiry",
    );
    await expect(
      page.locator(".batch-safety-preview-result [data-eligibility='expired']"),
    ).toContainText("Expired");
    await expect(
      page.getByText("Blocked batches cannot be picked"),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath(
        "issue-55",
        "after",
        "batch-fefo-preview-near-expiry-en-light.png",
      ),
    });
  });

  test("runs review now, quarantines a batch, and preserves focus", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(renderer.origin + "#/inventory/safety-review");
    await page.getByRole("button", { name: "Run evaluation now" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "requested" }),
    ).toContainText("requested");
    await expect(
      page.locator("[data-eligibility='expired']").first(),
    ).toBeVisible();
    await openMovements(page);
    const row = page
      .locator(".batch-safety-table tbody tr")
      .filter({ hasText: "BROWSER-BATCH-ELIGIBLE" });
    const action = row.getByRole("button", { name: "Quarantine batch" });
    await action.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Browser quarantine review");
    await dialog
      .getByLabel("Evidence", { exact: true })
      .fill("Browser quarantine evidence");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    // The quarantine control disappears once the batch is quarantined, so
    // focus lands on the row's remaining correction control instead.
    await expect(action).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Correct expiry date" }),
    ).toBeFocused();
    await page.getByLabel("Quantity", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Preview pick" }).click();
    await expect(
      page.locator("[data-eligibility='quarantined']").first(),
    ).toContainText("Quarantined");
    await page.goto(renderer.origin + "#/inventory/safety-review");
    await expect(page.getByText("BROWSER-BATCH-ELIGIBLE")).toBeVisible();
  });

  test("corrects expiry through Step-Up and retains original history", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "dark");
    await openMovements(page);
    const row = page
      .locator(".batch-safety-table tbody tr")
      .filter({ hasText: "BROWSER-BATCH-NEAR" });
    const action = row.getByRole("button", { name: "Correct expiry date" });
    await action.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Effective expiry", { exact: true })
      .fill(addDays(today, 120));
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Supplier label correction");
    await dialog
      .getByLabel("Evidence", { exact: true })
      .fill("Supplier corrected label");
    await dialog.getByRole("button", { name: "Save" }).click();
    const stepUp = page.getByRole("dialog");
    await stepUp.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
    await stepUp.getByRole("button", { name: "Confirm password" }).click();
    await expect(action).toBeFocused();
    await row.getByText("Full history").click();
    await expect(row).toContainText(nearExpiry);
    await expect(row).toContainText("Corrected");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath(
        "issue-55",
        "after",
        "batch-expiry-correction-step-up-en-dark.png",
      ),
    });
  });

  test("covers keyboard, forced-colors, Arabic/English, and both themes", async ({
    browser,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    for (const locale of ["ar", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { height: 800, width: 1280 },
        });
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(renderer.origin + "#/inventory/safety-review");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        const previous = page.getByRole("button", {
          name: locale === "ar" ? "الشهر السابق" : "Previous month",
        });
        await previous.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(
          /#\/inventory\/safety-review\/\d{4}-\d{2}$/u,
        );
        await page.keyboard.press("Tab");
        await expect(page.locator("input[type='month']")).toBeFocused();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-55",
            "after",
            "batch-safety-review-" + locale + "-" + theme + ".png",
          ),
        });
        await openMovements(page);
        await page
          .getByLabel(locale === "ar" ? "الكمية" : "Quantity", { exact: true })
          .fill("1");
        await page
          .getByRole("button", {
            name: locale === "ar" ? "معاينة الاختيار" : "Preview pick",
          })
          .click();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-55",
            "after",
            "batch-fefo-preview-" + locale + "-" + theme + ".png",
          ),
        });
        await page.locator(".batch-safety-history summary").first().click();
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-55",
            "after",
            "batch-expiry-correction-" + locale + "-" + theme + ".png",
          ),
        });
        await context.close();
      }
    }
    const forcedContext = await browser.newContext({
      viewport: { height: 800, width: 1280 },
    });
    const forced = await forcedContext.newPage();
    await installDesktopFake(forced, renderer.origin, "en", "dark");
    await openMovements(forced);
    await forced.emulateMedia({ forcedColors: "active" });
    await expect(forced.locator(".state-indicator").first()).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page: forced })
          .disableRules(["color-contrast"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await forcedContext.close();
  });

  test("hides actions from a manager without permission and refuses forged POST", async ({
    page,
  }) => {
    await administrator.query(
      "delete from role_permission_grants " +
        "where role_id = (select id from pharmacy_roles where role_key = 'manager') " +
        "and permission_name = 'inventory.batch_safety.manage'",
    );
    await login(MANAGER_USERNAME, MANAGER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await openMovements(page);
    await expect(
      page.getByRole("button", { name: "Recall batch" }),
    ).toHaveCount(0);
    const forged = await apiRequest(
      "POST",
      "/inventory/batches/0198e7ce-7685-7000-8000-000000000001/status-changes",
      {
        evidence: "forged browser evidence",
        idempotencyKey: uuidV7(),
        kind: "recall",
        reason: "forged browser reason",
      },
    );
    expect(forged.status).toBe(403);
  });

  async function openMovements(page: Page): Promise<void> {
    await page.goto(renderer.origin + "#/inventory");
    await page
      .locator("tbody tr:first-child td[data-column-field='item'] button")
      .click();
    // The heading id is locale-independent; its text is Arabic or English.
    await expect(page.locator("#inventory-movement-title")).toBeVisible();
  }

  async function startRendererServer(
    origin: string,
    current: Credentials,
  ): Promise<RendererServer> {
    const rendererRoot = path.resolve(
      import.meta.dirname,
      "../../out/renderer",
    );
    const server = createServer(async (request, response) => {
      try {
        if (request.url === "/health") {
          const upstream = await fetch(origin + "/health");
          response.writeHead(upstream.status, {
            "content-type":
              upstream.headers.get("content-type") ?? "application/json",
          });
          response.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        }
        if (isApiRoute(request.url)) {
          const body = await readBody(request);
          const upstream = await fetch(origin + (request.url ?? "/"), {
            ...(body.length === 0 ? {} : { body }),
            headers: requestHeaders(current, body.length > 0),
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
        const pathname = request.url === "/" ? "/index.html" : request.url;
        if (pathname === undefined || pathname.includes("..")) {
          response.writeHead(403).end();
          return;
        }
        const filePath = path.resolve(
          rendererRoot,
          "." + pathname.split("?")[0],
        );
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
        if (!response.headersSent) response.writeHead(502).end("{}");
        else response.destroy();
      }
    });
    return {
      origin: "http://127.0.0.1:" + String(await listen(server)),
      server,
    };
  }

  async function installDesktopFake(
    page: Page,
    origin: string,
    locale: "ar" | "en",
    theme: "dark" | "light",
  ): Promise<void> {
    await page.addInitScript(
      ({ apiOrigin, savedLocale, savedTheme }) => {
        localStorage.setItem("breev.locale", savedLocale);
        localStorage.setItem("breev.theme", savedTheme);
        const pairing = {
          candidates: [],
          stage: "awaiting-invitation" as const,
        };
        const desktopApi: BreevDesktopApi = Object.freeze({
          cancelTerminalPairing: async () => pairing,
          copyIdentifier: async () => ({ copied: true as const }),
          exportDiagnostics: async () => ({ status: "saved" as const }),
          getStartupConfig: async () => ({
            diagnosticReporting: "disabled" as const,
            localApiOrigin: apiOrigin,
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
      { apiOrigin: origin, savedLocale: locale, savedTheme: theme },
    );
  }

  async function createManagerUser(pharmacyId: string): Promise<void> {
    const role = await administrator.query<{ id: string }>(
      "select id from pharmacy_roles where pharmacy_id = $1 and role_key = 'manager'",
      [pharmacyId],
    );
    const challenge = await apiRequest("POST", "/identity/step-up-challenges", {
      action: "identity.user.create",
      idempotencyKey: uuidV7(),
    });
    expect(challenge.status).toBe(201);
    const challengeId = String((challenge.body as { id?: string }).id ?? "");
    const approved = await apiRequest(
      "POST",
      "/identity/step-up-challenges/" + challengeId + "/approve",
      { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
    );
    expect(approved.status).toBe(200);
    const created = await apiRequest("POST", "/identity/users", {
      challengeId,
      displayName: "Batch Safety Browser Manager",
      idempotencyKey: uuidV7(),
      password: MANAGER_PASSWORD,
      roleId: role.rows[0]!.id,
      username: MANAGER_USERNAME,
    });
    expect(created.status).toBe(201);
  }

  async function createSupplier(): Promise<Supplier> {
    const response = await apiRequest("POST", "/suppliers", {
      allowanceEffectiveFrom: "2026-01-01",
      defaultAllowancePercentage: "0",
      idempotencyKey: uuidV7(),
      name: "Batch Safety Browser Supplier",
      terms: "Net 30",
    });
    expect(response.status).toBe(201);
    return response.body as Supplier;
  }

  async function postPurchase(
    supplier: Supplier,
    item: Product,
  ): Promise<void> {
    const created = await apiRequest("POST", "/purchases/drafts", {
      idempotencyKey: uuidV7(),
      invoiceDate: "2026-06-15",
      settlementContext: "debt",
      supplierId: supplier.id,
      supplierInvoiceNumber: "BROWSER-BATCH-SAFETY-1",
    });
    expect(created.status).toBe(201);
    let draft = (created.body as { draft: PurchaseDraft }).draft;
    const rows = [
      ["BROWSER-BATCH-NEAR", addDays(today, 10)],
      ["BROWSER-BATCH-ELIGIBLE", addDays(today, 200)],
      ["BROWSER-BATCH-EXPIRED", addDays(today, -1)],
    ] as const;
    for (const [lotNumber, expiryDate] of rows) {
      const row = await apiRequest("POST", purchaseDraftRowsPath(draft.id), {
        costFils: "1000",
        enteredQuantity: "8",
        expectedVersion: draft.version,
        expiryDate,
        idempotencyKey: uuidV7(),
        itemId: item.id,
        lotNumber,
        notes: null,
        pricing: { method: "by-price", retailPriceFils: "999999" },
        unit: { kind: "inventory-unit" },
      });
      expect(row.status).toBe(201);
      draft = (row.body as { draft: PurchaseDraft }).draft;
    }
    const posted = await apiRequest(
      "POST",
      purchaseDraftPostingsPath(draft.id),
      {
        expectedVersion: draft.version,
        idempotencyKey: uuidV7(),
      },
    );
    expect(posted.status).toBe(201);
  }

  function medicationRequest(): ProductCreateRequest {
    return {
      arabicSearchName: "مادة سلامة الدفعات",
      barcodes: [
        {
          kind: "product",
          value: randomBytes(6).toString("hex").slice(0, 13),
        },
      ],
      category: "Safety",
      definition: {
        fields: {
          dosageForm: "tablet",
          manufacturer: "Breev Labs",
          strength: "500 mg",
          tradeName: "Browser Batch Safety Item",
        },
        mode: "medication",
      },
      idempotencyKey: uuidV7(),
      instructions: {
        foodTiming: "after-food",
        usesPerDay: 3,
        usesPerMonth: null,
        usesPerWeek: null,
      },
      packaging: {
        defaultUnits: {
          count: { kind: "inventory-unit" },
          purchase: { kind: "inventory-unit" },
          sale: { kind: "inventory-unit" },
        },
        inventoryUnitName: "Strip",
        packageUnits: [],
        thirdUnit: null,
      },
      pricing: {
        method: "by-price",
        retailPriceFils: "100000",
        wholesalePriceFils: "90000",
      },
      scientificName: "Batch Safety",
      sharing: { aiSharingAllowed: false, externallyVisible: true },
      stateColours: { coldStorageRequired: false, manual: null },
      stockLevels: { maximumLevel: "30", minimumLevel: "5", reorderPoint: "4" },
    };
  }

  async function login(username: string, password: string): Promise<void> {
    const response = await apiRequest("POST", "/identity/login", {
      password,
      username,
    });
    expect(response.status).toBe(200);
  }

  async function apiRequest(
    method: "GET" | "POST",
    route: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const response = await fetch(apiOrigin + route, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: requestHeaders(credentials, body !== undefined),
      method,
    });
    const text = await response.text();
    return {
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
      status: response.status,
    };
  }
});

function isApiRoute(url: string | undefined): boolean {
  return (
    url?.startsWith("/identity/") === true ||
    url?.startsWith("/catalog/") === true ||
    url?.startsWith("/suppliers") === true ||
    url?.startsWith("/purchases/") === true ||
    url?.startsWith("/inventory/") === true
  );
}

function startApi(
  port: number,
  current: Credentials,
  roles: SeparatedDatabaseRoles,
): ChildProcessWithoutNullStreams {
  return spawnLocalApiProcess(
    path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
    {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_INSTALLATION_STATE: "ready",
      BREEV_MAIN_DEVICE_ID: current.deviceId,
      BREEV_MAIN_DEVICE_SECRET: current.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: current.sessionToken,
      DATABASE_MIGRATION_URL: roles.migrationUrl,
      DATABASE_URL: roles.applicationUrl,
    },
  );
}

function requestHeaders(
  current: Credentials,
  json: boolean,
): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: "Breev-Device " + current.deviceSecret,
    ...(json ? { "Content-Type": "application/json" } : {}),
    [BREEV_CSRF_HEADER]: BREEV_CSRF_VALUE,
    [LOCAL_DEVICE_ID_HEADER]: current.deviceId,
    [LOCAL_DEVICE_SESSION_HEADER]: current.sessionToken,
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
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-7" +
    hex.slice(13, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}

function businessDate(instant: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Baghdad",
      year: "numeric",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return (
    String(parts.year) + "-" + String(parts.month) + "-" + String(parts.day)
  );
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
        reject(new Error("Could not listen for renderer"));
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

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
