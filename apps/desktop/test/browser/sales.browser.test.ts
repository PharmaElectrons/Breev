import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  productArchivePath,
  reorderBasketPath,
  reorderItemsPath,
  saleDraftPath,
  saleDraftsPath,
  type Product,
  type ProductCreateRequest,
  type ReorderItem,
  type SaleDraft,
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
import { pressKeyOnFocused } from "./focus.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "sales.browser.owner";
const OWNER_PASSWORD = "sales browser owner password stays in this test";
const SELLER_USERNAME = "sales.browser.seller";
const SELLER_PASSWORD = "sales browser seller password stays in this test";
const NO_BASKET_USERNAME = "sales.browser.nobasket";
const NO_BASKET_PASSWORD = "sales browser no basket password stays here";

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface RendererServer {
  readonly origin: string;
  readonly server: Server;
}

interface ApiResponse {
  readonly body: unknown;
  readonly status: number;
}

let sharedAdministrator: Pool | undefined;
let sharedCredentials: Credentials | undefined;
let sharedDatabaseRoles: SeparatedDatabaseRoles | undefined;

test.describe.serial("sale drafts and the reorder row action", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let pharmacyId = "";
  let postgres: StartedPostgreSqlContainer | undefined;
  let renderer: RendererServer;
  let panadol: Product;
  let other: Product;
  let laterArchived: Product;

  test.beforeAll("sale draft fixture", async () => {
    test.setTimeout(180_000);
    await mkdir(evidencePath("issue-58", "after"), { recursive: true });
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({ connectionString: databaseRoles.migrationUrl });
    sharedAdministrator = administrator;
    credentials = createCredentials();
    sharedCredentials = credentials;
    sharedDatabaseRoles = databaseRoles;
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi(apiPort);
    await waitForHealth(apiOrigin, "healthy", api);

    const bootstrap = await apiRequest("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Sales Browser Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Sales Browser Pharmacy",
    });
    expect(bootstrap.status).toBe(201);
    pharmacyId = String(
      (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
    expect(pharmacyId).toMatch(/^\S+$/u);
    await login(OWNER_USERNAME, OWNER_PASSWORD);

    // "panadol gs" must resolve through #17's ordered-subsequence matching.
    panadol = await createProduct("Panadol Extra GSK");
    other = await createProduct("Amoxil Forte Pfizer");
    laterArchived = await createProduct("Panadol Vanishing GSK");

    await createUser(
      pharmacyId,
      "sales_employee",
      SELLER_USERNAME,
      SELLER_PASSWORD,
      "Sales Browser Seller",
    );
    await createCustomRoleUser(pharmacyId);
    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("opens a draft, finds the item by keyboard, and baskets it without touching the draft", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);

    const newDraft = page.locator('[data-sale-draft-control="new"]');
    await expect(newDraft).toBeFocused();
    await pressKeyOnFocused(page, newDraft, "Enter");

    const search = page.locator("#sale-draft-search");
    await expect(search).toBeFocused();
    const draftId = await currentDraftId(page);
    const before = await apiRequest("GET", saleDraftPath(draftId));
    expect(before.status).toBe(200);
    const beforeVersion = await page
      .locator("[data-sale-draft-version]")
      .textContent();

    await page.keyboard.type("panadol gs");
    await expect(
      page.getByRole("status").filter({ hasText: "Search results: 2" }),
    ).toBeVisible();
    const addButton = page.locator(`[data-sale-basket-add="${panadol.id}"]`);
    await expect(addButton).toBeVisible();
    // The action is the next tab stop after the row it belongs to.
    await addButton.focus();
    await pressKeyOnFocused(page, addButton, "Enter");
    await expect(page.getByText(/Added .* to the order basket/u)).toBeVisible();
    await expect(addButton).toBeFocused();

    const after = await apiRequest("GET", saleDraftPath(draftId));
    expect(after.body).toEqual(before.body);
    expect(await page.locator("[data-sale-draft-version]").textContent()).toBe(
      beforeVersion,
    );

    const basket = await apiRequest("GET", reorderBasketPath());
    expect(basket.status).toBe(200);
    const items = (basket.body as { items: ReorderItem[] }).items;
    expect(items.map((item) => item.productId)).toContain(panadol.id);
  });

  test("resumes the same draft after a renderer restart with an empty search box", async ({
    browser,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const drafts = await apiRequest("GET", `${saleDraftsPath()}?status=active`);
    const open = (drafts.body as { drafts: SaleDraft[] }).drafts;
    expect(open).toHaveLength(1);
    const draft = open[0]!;

    const context = await browser.newContext({
      viewport: { height: 768, width: 1280 },
    });
    const page = await context.newPage();
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales/drafts/${draft.id}`);

    // Durable draft state is the server's; the query was transient and is gone.
    await expect(page.locator("#sale-draft-search")).toHaveValue("");
    await expect(
      page.locator(`[data-sale-draft-version="${draft.version}"]`),
    ).toBeVisible();

    await page.goto(`${renderer.origin}#/sales`);
    const resume = page.locator('[data-sale-draft-control="resume"]');
    await expect(resume).toBeFocused();
    await pressKeyOnFocused(page, resume, "Enter");
    await expect(page.locator("#sale-draft-search")).toBeFocused();

    const resumed = await apiRequest("GET", saleDraftPath(draft.id));
    expect((resumed.body as SaleDraft).id).toBe(draft.id);
    expect(BigInt((resumed.body as SaleDraft).version)).toBe(
      BigInt(draft.version) + 1n,
    );
    await context.close();
  });

  test("resumes the identical draft after the local API restarts", async ({
    page,
  }) => {
    const drafts = await apiRequest("GET", `${saleDraftsPath()}?status=active`);
    const draft = (drafts.body as { drafts: SaleDraft[] }).drafts[0]!;
    const before = await apiRequest("GET", saleDraftPath(draft.id));

    await stopProcess(api);
    api = startApi(apiPort);
    await waitForHealth(apiOrigin, "healthy", api);
    await login(SELLER_USERNAME, SELLER_PASSWORD);

    const after = await apiRequest("GET", saleDraftPath(draft.id));
    expect(after.body).toEqual(before.body);

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales/drafts/${draft.id}`);
    await expect(
      page.locator(`[data-sale-draft-version="${draft.version}"]`),
    ).toBeVisible();
  });

  test("keeps the draft and adds exactly once when the basket call cannot reach the API", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    const before = await apiRequest("GET", saleDraftPath(draftId));

    await page.route(`**${reorderItemsPath()}`, (route) => {
      void route.abort("failed");
    });
    await page.locator("#sale-draft-search").fill("Amoxil");
    const addButton = page.locator(`[data-sale-basket-add="${other.id}"]`);
    await expect(addButton).toBeVisible();
    await addButton.click();

    await expect(
      page.getByText("The order basket is unavailable."),
    ).toBeVisible();
    await expect(
      page.locator(`[data-sale-basket-retry="${other.id}"]`),
    ).toBeVisible();
    // Nothing was cleared: the query, the rows, and the draft all survive.
    await expect(page.locator("#sale-draft-search")).toHaveValue("Amoxil");
    await expect(addButton).toBeVisible();
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before.body,
    );

    await page.unroute(`**${reorderItemsPath()}`);
    await page.locator(`[data-sale-basket-retry="${other.id}"]`).click();
    await expect(page.getByText(/the order basket/u).first()).toBeVisible();

    const basket = await apiRequest("GET", reorderBasketPath());
    const rows = (basket.body as { items: ReorderItem[] }).items.filter(
      (item) => item.productId === other.id,
    );
    // The kept idempotency key makes the retry a retry, not a second row.
    expect(rows).toHaveLength(1);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before.body,
    );
  });

  test("explains an item archived after the search and resolves it", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    const before = await apiRequest("GET", saleDraftPath(draftId));

    // #17's search returns active products only, so an archived item can never
    // appear in the row list. The reachable case is an item archived between
    // the search and the press, which the server refuses at the basket.
    await page.locator("#sale-draft-search").fill("Panadol Vanishing");
    const vanishing = page.locator(
      `[data-sale-basket-add="${laterArchived.id}"]`,
    );
    await expect(vanishing).toBeEnabled();

    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await archiveProduct(laterArchived);
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await vanishing.click();

    await expect(
      page.getByText("This item is inactive and cannot be ordered."),
    ).toBeVisible();
    const searchAgain = page.locator("[data-sale-search-again]");
    await expect(searchAgain).toBeVisible();
    await searchAgain.click();
    // Resolved: the stale row is gone because the item is no longer active.
    await expect(vanishing).toHaveCount(0);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before.body,
    );
  });

  test("hides the row action without the basket permission and leaves the draft untouched", async ({
    page,
  }) => {
    await login(NO_BASKET_USERNAME, NO_BASKET_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    const before = await apiRequest("GET", saleDraftPath(draftId));

    await page.locator("#sale-draft-search").fill("panadol gs");
    await expect(
      page.locator(`[data-sale-basket-add="${panadol.id}"]`),
    ).toHaveCount(0);

    // UI hiding is never the boundary: the server refuses the same command.
    const denied = await apiRequest("POST", reorderItemsPath(), {
      idempotencyKey: uuidV7(),
      productId: panadol.id,
    });
    expect(denied.status).toBe(403);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before.body,
    );
  });

  test("covers Arabic and English RTL/LTR themes, accessibility, and keyboard evidence", async ({
    browser,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const videoPath = path.resolve(
      import.meta.dirname,
      "../../../../test-results/issue-58-video/sale-draft-keyboard.webm",
    );
    await mkdir(path.dirname(videoPath), { recursive: true });
    let englishOrder: readonly string[] | undefined;

    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          ...(locale === "en" && theme === "light"
            ? {
                recordVideo: {
                  dir: path.dirname(videoPath),
                  size: { height: 768, width: 1280 },
                },
              }
            : {}),
          viewport: { height: 768, width: 1280 },
        });
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/sales`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(
          page.locator('[data-sale-draft-control="new"]'),
        ).toBeVisible();
        await page.screenshot({
          path: evidencePath(
            "issue-58",
            "after",
            `sale-draft-index-${locale}-${theme}.png`,
          ),
          fullPage: true,
        });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );

        const draftId = await openFreshDraft(page);
        await page.locator("#sale-draft-search").fill("panadol gs");
        await expect(
          page.locator(`[data-sale-basket-add="${panadol.id}"]`),
        ).toBeVisible();
        await page.screenshot({
          path: evidencePath(
            "issue-58",
            "after",
            `sale-draft-search-results-${locale}-${theme}.png`,
          ),
          fullPage: true,
        });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await expect(
          page.locator(`[data-sale-basket-add="${panadol.id}"]`),
        ).toBeInViewport();

        if (theme === "light") {
          // Logical order must not depend on the visual direction.
          const order = await page
            .locator("table.sales-results-table tbody tr")
            .first()
            .locator("span.sale-result-name, button[data-sale-basket-add]")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.tagName.toLowerCase()),
            );
          if (locale === "en") englishOrder = order;
          else expect(order).toEqual(englishOrder);
        }

        expect(draftId).toMatch(/^\S+$/u);
        const video = page.video();
        await context.close();
        if (video !== null && locale === "en" && theme === "light") {
          await video.saveAs(videoPath);
        }
      }
    }
  });
});

async function currentDraftId(page: Page): Promise<string> {
  const hash = new URL(page.url()).hash;
  const match = /#\/sales\/drafts\/([^/?]+)/u.exec(hash);
  expect(match?.[1]).toBeDefined();
  return match![1]!;
}

async function openFreshDraft(page: Page): Promise<string> {
  await page.locator('[data-sale-draft-control="new"]').click();
  await expect(page.locator("#sale-draft-search")).toBeVisible();
  return await currentDraftId(page);
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
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${String(port)}`, server };
}

function isApiRoute(url: string | undefined): boolean {
  return (
    url?.startsWith("/identity/") === true ||
    url?.startsWith("/catalog/") === true ||
    url?.startsWith("/inventory/") === true ||
    url?.startsWith("/sales/") === true
  );
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

async function createProduct(tradeName: string): Promise<Product> {
  const response = await apiRequest(
    "POST",
    "/catalog/products",
    productRequest(tradeName),
  );
  expect(response.status).toBe(201);
  return response.body as Product;
}

async function archiveProduct(product: Product): Promise<void> {
  const response = await apiRequest("POST", productArchivePath(product.id), {
    expectedRevision: product.revision,
    idempotencyKey: uuidV7(),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

function productRequest(tradeName: string): ProductCreateRequest {
  return {
    arabicSearchName: "بانادول للاختبار",
    barcodes: [
      { kind: "product", value: randomBytes(6).toString("hex").slice(0, 13) },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName,
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
      packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
      thirdUnit: null,
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: "90000",
    },
    scientificName: tradeName,
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: null },
    stockLevels: {
      maximumLevel: "60",
      minimumLevel: "10",
      reorderPoint: "20",
    },
  };
}

async function createUser(
  currentPharmacyId: string,
  roleKey: string,
  username: string,
  password: string,
  displayName: string,
): Promise<void> {
  await login(OWNER_USERNAME, OWNER_PASSWORD);
  const role = await requireAdministrator().query<{ id: string }>(
    "select id from pharmacy_roles where pharmacy_id = $1 and role_key = $2",
    [currentPharmacyId, roleKey],
  );
  expect(role.rows[0]?.id).toBeDefined();
  await createUserForRole(role.rows[0]!.id, username, password, displayName);
}

/** A role that may open drafts and search, but may not touch the basket. */
async function createCustomRoleUser(currentPharmacyId: string): Promise<void> {
  await login(OWNER_USERNAME, OWNER_PASSWORD);
  const challenge = await apiRequest("POST", "/identity/step-up-challenges", {
    action: "identity.role.create",
    idempotencyKey: uuidV7(),
  });
  expect(challenge.status).toBe(201);
  const challengeId = String((challenge.body as { id?: string }).id ?? "");
  const approval = await apiRequest(
    "POST",
    `/identity/step-up-challenges/${challengeId}/approve`,
    { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
  );
  expect(approval.status).toBe(200);
  const role = await apiRequest("POST", "/identity/roles", {
    challengeId,
    idempotencyKey: uuidV7(),
    name: "Sales Draft Without Basket",
    permissions: ["catalog.item.search", "sales.drafts.manage"],
  });
  expect(role.status).toBe(201);
  const roleId = String((role.body as { id?: string }).id ?? "");
  expect(currentPharmacyId).toMatch(/^\S+$/u);
  await createUserForRole(
    roleId,
    NO_BASKET_USERNAME,
    NO_BASKET_PASSWORD,
    "Sales Draft Without Basket",
  );
}

async function createUserForRole(
  roleId: string,
  username: string,
  password: string,
  displayName: string,
): Promise<void> {
  const challenge = await apiRequest("POST", "/identity/step-up-challenges", {
    action: "identity.user.create",
    idempotencyKey: uuidV7(),
  });
  expect(challenge.status).toBe(201);
  const challengeId = String((challenge.body as { id?: string }).id ?? "");
  const approved = await apiRequest(
    "POST",
    `/identity/step-up-challenges/${challengeId}/approve`,
    { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
  );
  expect(approved.status).toBe(200);
  const created = await apiRequest("POST", "/identity/users", {
    challengeId,
    displayName,
    idempotencyKey: uuidV7(),
    password,
    roleId,
    username,
  });
  expect(created.status).toBe(201);
}

async function login(username: string, password: string): Promise<void> {
  const response = await apiRequest("POST", "/identity/login", {
    password,
    username,
  });
  expect(response.status).toBe(200);
}

async function apiRequest(
  method: "GET" | "POST" | "PUT",
  route: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${apiOriginForRequests()}${route}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: requestHeaders(credentialsForRequests(), body !== undefined),
    method,
  });
  const text = await response.text();
  return {
    body: text === "" ? undefined : (JSON.parse(text) as unknown),
    status: response.status,
  };
}

let requestOrigin = "";
let requestCredentials: Credentials | undefined;

function apiOriginForRequests(): string {
  return requestOrigin;
}

function credentialsForRequests(): Credentials {
  if (requestCredentials === undefined)
    throw new Error("Browser fixture is not ready");
  return requestCredentials;
}

function requireCredentials(): Credentials {
  if (sharedCredentials === undefined)
    throw new Error("Browser credentials are not ready");
  return sharedCredentials;
}

function requireDatabaseRoles(): SeparatedDatabaseRoles {
  if (sharedDatabaseRoles === undefined)
    throw new Error("Browser database roles are not ready");
  return sharedDatabaseRoles;
}

function requireAdministrator(): Pool {
  if (sharedAdministrator === undefined)
    throw new Error("Browser administrator is not ready");
  return sharedAdministrator;
}

function startApi(port: number): ChildProcessWithoutNullStreams {
  requestOrigin = `http://127.0.0.1:${String(port)}`;
  const currentCredentials = requireCredentials();
  const currentDatabaseRoles = requireDatabaseRoles();
  requestCredentials = currentCredentials;
  return spawnLocalApiProcess(
    path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
    {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_INSTALLATION_STATE: "ready",
      BREEV_MAIN_DEVICE_ID: currentCredentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: currentCredentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: currentCredentials.sessionToken,
      DATABASE_MIGRATION_URL: currentDatabaseRoles.migrationUrl,
      DATABASE_URL: currentDatabaseRoles.applicationUrl,
    },
  );
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

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
