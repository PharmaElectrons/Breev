import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  purchaseAdjustmentDraftPath,
  purchaseAdjustmentDraftsPath,
  purchaseAdjustmentPostingsPath,
  purchaseAdjustmentSummaryPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  purchaseReturnDraftPath,
  purchaseReturnDraftsPath,
  purchaseReturnPostingsPath,
  purchaseReturnSummaryPath,
  type Product,
  type ProductCreateRequest,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentPostResult,
  type PurchaseAdjustmentSummary,
  type PurchaseDraft,
  type PurchasePostResult,
  type PurchaseReturnDraft,
  type PurchaseReturnPostResult,
  type PurchaseReturnSummary,
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
import { pressKeyOnFocused } from "./focus.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_USERNAME = "inventory.browser.owner";
const OWNER_PASSWORD = "inventory browser owner password stays in this test";
const MANAGER_USERNAME = "inventory.browser.manager";
const MANAGER_PASSWORD =
  "inventory browser manager password stays in this test";

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

test.describe.serial("read-only inventory review", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let product: Product;
  let renderer: RendererServer;

  test.beforeAll("inventory fixture", async () => {
    test.setTimeout(180_000);
    await mkdir(evidencePath("issue-54", "after"), { recursive: true });
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (administratorUrl === undefined) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
      databaseRoles = await createSeparatedDatabaseRoles(postgres);
    } else {
      databaseRoles =
        await createSeparatedDatabaseRolesFromUrl(administratorUrl);
    }
    administrator = new Pool({
      connectionString: databaseRoles.migrationUrl,
    });
    sharedAdministrator = administrator;
    credentials = createCredentials();
    sharedCredentials = credentials;
    sharedDatabaseRoles = databaseRoles;
    const apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi(apiPort);
    await waitForHealth(apiOrigin, "healthy", api);

    const bootstrap = await apiRequest("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Inventory Browser Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Inventory Browser Pharmacy",
    });
    expect(bootstrap.status).toBe(201);
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const supplier = await createSupplier();
    const created = await apiRequest(
      "POST",
      "/catalog/products",
      medicationRequest(),
    );
    expect(created.status).toBe(201);
    product = created.body as Product;
    const purchase = await postPurchase(supplier, product);
    await postPurchaseAdjustment(purchase.posted.id);
    await postPurchaseReturn(purchase.posted.id);
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

  test("sorts and changes visibility by keyboard while preserving table semantics", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory`);
    await expect(
      page.getByRole("heading", { name: "Inventory review" }),
    ).toBeVisible();
    const balanceHeader = page.getByRole("columnheader", {
      name: "Current balance",
    });
    const balanceButton = balanceHeader.getByRole("button");
    await balanceButton.focus();
    await pressKeyOnFocused(page, balanceButton, "Enter");
    await expect(balanceHeader).toHaveAttribute("aria-sort", "ascending");
    await pressKeyOnFocused(page, balanceButton, "Enter");
    await expect(balanceHeader).toHaveAttribute("aria-sort", "descending");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Current balance sorted descending." }),
    ).toBeAttached();
    await expect(page.locator("table")).toHaveCount(1);
    await expect(page.locator("th[data-column-field='branch']")).toHaveCount(0);
    await expect(page.locator("button[aria-label*='delete' i]")).toHaveCount(0);
    await expect(
      page.locator("td[data-column-field='balance'] input"),
    ).toHaveCount(0);

    await page.getByText("Column settings", { exact: true }).click();
    const valueCheckbox = page.getByRole("checkbox", { name: "Value" });
    const valueHeader = page.getByRole("columnheader", { name: "Value" });
    await valueCheckbox.focus();
    await pressKeyOnFocused(page, valueCheckbox, "Space");
    await expect(valueHeader).toHaveCount(0);
    await expect(valueCheckbox).toBeFocused();

    await pressKeyOnFocused(page, valueCheckbox, "Space");
    await expect(valueHeader).toBeVisible();
    // Regression: the first (hide) save resolves after the second (show)
    // toggle. Its stale response must not move the grid back. Wait until the
    // server holds the final "visible" state, then require the column to
    // still be there.
    await expect
      .poll(async () => await valueColumnVisibleOnServer())
      .toBe(true);
    await expect(valueHeader).toBeVisible();

    // Hiding the column while focus sits inside it hands focus to the
    // settings toggle in the same commit that removes the column. A
    // dispatched click, unlike a real one, leaves focus on the header button.
    const valueHeaderButton = page.locator(
      "th[data-column-field='value'] button",
    );
    const valueOption = page.locator("label[data-column-field='value'] input");
    await valueHeaderButton.focus();
    await expect(valueHeaderButton).toBeFocused();
    await valueOption.dispatchEvent("click");
    await expect(valueHeader).toHaveCount(0);
    await expect(
      page.getByText("Column settings", { exact: true }),
    ).toBeFocused();
    await expect
      .poll(async () => await valueColumnVisibleOnServer())
      .toBe(false);
    await restorePreferences();
  });

  test("opens movement history and the originating purchase, then restores focus", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await restorePreferences();
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory`);
    const itemLink = page.locator(
      "tbody tr:first-child td[data-column-field='item'] button.table-link",
    );
    await itemLink.focus();
    await itemLink.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Item movement details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Item movement details" }),
    ).toContainText(product.displayName);
    await assertMovementDetails(page, "en");
    const reference = page.locator(
      "tbody tr:first-child td:first-child button",
    );
    await reference.focus();
    await reference.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#posted-detail-title")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page).toHaveURL(/#\/inventory\/items\/[^/]+\/movements$/u);
    await expect(reference).toBeFocused();
    await page.getByRole("link", { name: "Back to inventory" }).click();
    await expect(page).toHaveURL(/#\/inventory$/u);
  });

  test("pairs state colour with text and an icon, including forced colours", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "dark");
    await page.goto(`${renderer.origin}#/inventory`);
    const indicator = page.locator(".state-indicator").first();
    await expect(indicator).toBeVisible();
    await expect(indicator.locator("svg")).toHaveCount(1);
    await expect(indicator).toContainText("Orange");
    await expect(indicator.locator(".visually-hidden")).toContainText("Orange");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.emulateMedia({ forcedColors: "active" });
    await expect(indicator.locator("svg")).toHaveCount(1);
    await expect(indicator).toContainText("Orange");
    // Forced-colors emulation uses a white canvas with the dark theme tokens.
    expect(
      (
        await new AxeBuilder({ page })
          .disableRules(["color-contrast"])
          .analyze()
      ).violations,
    ).toEqual([]);
  });

  test("renders Arabic RTL and English LTR evidence in both themes", async ({
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
        await page.goto(`${renderer.origin}#/inventory`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(
          page.getByRole("heading", {
            name: locale === "ar" ? "مراجعة المخزون" : "Inventory review",
          }),
        ).toBeVisible();
        await assertInventoryRow(page, locale);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-54",
            "after",
            `inventory-grid-${locale}-${theme}.png`,
          ),
        });
        const itemLink = page.locator(
          "tbody tr:first-child td[data-column-field='item'] button.table-link",
        );
        await itemLink.click();
        await expect(
          page.getByRole("heading", {
            name:
              locale === "ar" ? "تفاصيل حركات المادة" : "Item movement details",
          }),
        ).toBeVisible();
        await assertMovementDetails(page, locale);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-54",
            "after",
            `item-movements-${locale}-${theme}.png`,
          ),
        });
        await context.close();
      }
    }
  });

  test("shows a recoverable API-down state and owner-only export", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await stopProcess(api);
    api = undefined;
    await page.goto(`${renderer.origin}#/inventory`);
    await expect(
      page.getByRole("heading", { name: "Main unavailable" }),
    ).toBeVisible();
    const checkNow = page.getByRole("button", { name: "Check now" });
    await expect(checkNow).toBeVisible();
    // A manual check while the Main is still down has one deterministic
    // outcome: the shell stays unavailable and the control returns to its
    // idle label once the check has finished.
    await checkNow.click();
    await expect(
      page.getByRole("heading", { name: "Main unavailable" }),
    ).toBeVisible();
    await expect(checkNow).toBeEnabled();
    api = startApi(Number(new URL(apiOrigin).port));
    await waitForHealth(apiOrigin, "healthy", api);
    // The shell polls health every second and recovers on its own, replacing
    // the unavailable surface. The ready state to synchronize on is the
    // review itself, never the control the recovery removes.
    await expect(page.locator("table")).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Export sensitive inventory data" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Export sensitive inventory data" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
    await dialog.getByRole("button", { name: "Confirm password" }).click();
    await expect(page.getByText("Inventory export saved.")).toBeVisible();
    expect(
      await page
        .evaluate(() =>
          Boolean(
            (globalThis as { __inventoryExport?: unknown }).__inventoryExport,
          ),
        )
        .catch(() => false),
    ).toBe(true);

    await login(MANAGER_USERNAME, MANAGER_PASSWORD);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Export sensitive inventory data" }),
    ).toHaveCount(0);
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
      if (isApiRoute(request.url)) {
        const body = await readBody(request);
        const upstream = await fetch(`${apiOrigin}${request.url}`, {
          ...(body.length === 0 ? {} : { body }),
          headers: requestHeaders(credentials, body.length > 0),
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
    url?.startsWith("/suppliers") === true ||
    url?.startsWith("/purchases/") === true ||
    url?.startsWith("/inventory/") === true
  );
}

async function installDesktopFake(
  page: Page,
  apiOrigin: string,
  locale: "ar" | "en",
  theme: "dark" | "light",
): Promise<void> {
  await page.addInitScript(
    ({ apiOrigin: origin, locale: savedLocale, theme: savedTheme }) => {
      localStorage.setItem("breev.locale", savedLocale);
      localStorage.setItem("breev.theme", savedTheme);
      const pairing = { candidates: [], stage: "awaiting-invitation" as const };
      const assertExportKeys = (bundle: unknown): void => {
        const exactKeys = (
          value: unknown,
          expected: string[],
          label: string,
        ) => {
          if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value)
          )
            throw new Error(`${label} is not an object`);
          const actual = Object.keys(value).sort();
          const sortedExpected = [...expected].sort();
          if (actual.join(",") !== sortedExpected.join(","))
            throw new Error(`${label} has unexpected keys`);
        };

        exactKeys(
          bundle,
          [
            "counts",
            "exportedAt",
            "exportedBy",
            "items",
            "pharmacyId",
            "valuationMethod",
          ],
          "inventory export",
        );
        if (
          typeof bundle !== "object" ||
          bundle === null ||
          Array.isArray(bundle)
        )
          return;
        const record = bundle as {
          counts?: unknown;
          exportedBy?: unknown;
          items?: unknown;
        };
        exactKeys(
          record.counts,
          ["batches", "items", "movements"],
          "export counts",
        );
        exactKeys(record.exportedBy, ["displayName", "id"], "exported by");
        if (!Array.isArray(record.items)) return;
        for (const [index, item] of record.items.entries()) {
          exactKeys(
            item,
            [
              "averageUnitCostFils",
              "balance",
              "batches",
              "displayName",
              "productId",
              "status",
              "stockLevels",
              "suppliers",
              "valueFils",
            ],
            `export item ${String(index)}`,
          );
          if (typeof item !== "object" || item === null || Array.isArray(item))
            continue;
          const itemRecord = item as {
            batches?: unknown;
            stockLevels?: unknown;
            suppliers?: unknown;
          };
          exactKeys(
            itemRecord.stockLevels,
            ["maximumLevel", "minimumLevel", "reorderPoint"],
            `export item ${String(index)} stock levels`,
          );
          if (Array.isArray(itemRecord.batches)) {
            for (const [batchIndex, batch] of itemRecord.batches.entries()) {
              exactKeys(
                batch,
                ["balance", "batchId", "expiryDate", "lotNumber"],
                `export item ${String(index)} batch ${String(batchIndex)}`,
              );
            }
          }
          if (Array.isArray(itemRecord.suppliers)) {
            for (const [
              supplierIndex,
              supplier,
            ] of itemRecord.suppliers.entries()) {
              exactKeys(
                supplier,
                [
                  "lastCostAfterDiscountFils",
                  "lastInvoiceDate",
                  "lastPostedPurchaseId",
                  "lastPrimarySupplierCostFils",
                  "receiptCount",
                  "supplierId",
                  "supplierName",
                ],
                `export item ${String(index)} supplier ${String(supplierIndex)}`,
              );
            }
          }
        }
      };
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
        saveInventoryExport: async (
          request: Parameters<BreevDesktopApi["saveInventoryExport"]>[0],
        ) => {
          assertExportKeys(request.bundle);
          (globalThis as { __inventoryExport?: unknown }).__inventoryExport =
            request.bundle;
          return { status: "saved" as const };
        },
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
    { apiOrigin, locale, theme },
  );
}

async function createManagerUser(pharmacyId: string): Promise<void> {
  await login(OWNER_USERNAME, OWNER_PASSWORD);
  const role = await requireAdministrator().query<{ id: string }>(
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
    `/identity/step-up-challenges/${challengeId}/approve`,
    { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
  );
  expect(approved.status).toBe(200);
  const created = await apiRequest("POST", "/identity/users", {
    challengeId,
    displayName: "Inventory Browser Manager",
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
    name: "Inventory Browser Supplier",
    terms: "Net 30",
  });
  expect(response.status).toBe(201);
  return response.body as Supplier;
}

async function postPurchase(
  supplier: Supplier,
  item: Product,
): Promise<PurchasePostResult> {
  const created = await apiRequest("POST", "/purchases/drafts", {
    idempotencyKey: uuidV7(),
    invoiceDate: "2026-06-15",
    settlementContext: "debt",
    supplierId: supplier.id,
    supplierInvoiceNumber: "BROWSER-INVENTORY-1",
  });
  expect(created.status).toBe(201);
  let draft = (created.body as { draft: PurchaseDraft }).draft;
  const row = await apiRequest("POST", purchaseDraftRowsPath(draft.id), {
    costFils: "1000",
    enteredQuantity: "4",
    expectedVersion: draft.version,
    expiryDate: "2027-01-31",
    idempotencyKey: uuidV7(),
    itemId: item.id,
    lotNumber: "BROWSER-LOT-1",
    notes: null,
    pricing: { method: "by-price", retailPriceFils: "999999" },
    unit: { kind: "inventory-unit" },
  });
  expect(row.status).toBe(201);
  draft = (row.body as { draft: PurchaseDraft }).draft;
  const posted = await apiRequest("POST", purchaseDraftPostingsPath(draft.id), {
    expectedVersion: draft.version,
    idempotencyKey: uuidV7(),
  });
  expect(posted.status).toBe(201);
  const result = posted.body as PurchasePostResult;
  expect(result.posted.id).toBeTruthy();
  return result;
}

async function postPurchaseAdjustment(purchaseId: string): Promise<void> {
  const created = await apiRequest(
    "POST",
    purchaseAdjustmentDraftsPath(purchaseId),
    {
      evidence: null,
      idempotencyKey: uuidV7(),
      reason: "quantity error",
    },
  );
  expect(created.status).toBe(201);
  const draft = created.body as PurchaseAdjustmentDraft;
  const updated = await apiRequest(
    "PUT",
    purchaseAdjustmentDraftPath(draft.id),
    {
      evidence: null,
      expectedVersion: draft.version,
      idempotencyKey: uuidV7(),
      reason: draft.reason,
      rows: draft.rows.map((row) => ({
        costFils: row.costFils,
        enteredQuantity: (BigInt(row.enteredQuantity) - 1n).toString(),
        expiryDate: row.expiryDate,
        itemId: row.itemId,
        lineageId: row.lineageId,
        lotNumber: row.lotNumber,
        notes: row.notes,
        originalRowId: row.originalRowId,
        pricing:
          row.pricingMethod === "by-price"
            ? { method: "by-price", retailPriceFils: row.retailPriceFils }
            : {
                marginPercentage: row.marginPercentage ?? "0",
                method: "by-percentage",
              },
        unit: row.unit,
      })),
      supplierId: draft.supplierId,
      supplierInvoiceNumber: draft.supplierInvoiceNumber,
    },
  );
  expect(updated.status).toBe(200);
  const updatedDraft = updated.body as PurchaseAdjustmentDraft;
  const summaryResponse = await apiRequest(
    "GET",
    purchaseAdjustmentSummaryPath(updatedDraft.id),
  );
  expect(summaryResponse.status).toBe(200);
  const summary = summaryResponse.body as PurchaseAdjustmentSummary;
  const posted = await apiRequest(
    "POST",
    purchaseAdjustmentPostingsPath(updatedDraft.id),
    {
      confirmationHash: summary.confirmationHash,
      expectedVersion: updatedDraft.version,
      idempotencyKey: uuidV7(),
    },
  );
  expect(posted.status).toBe(201);
  expect(
    (posted.body as PurchaseAdjustmentPostResult).posted.quantityDelta,
  ).toBe("-1");
}

async function postPurchaseReturn(purchaseId: string): Promise<void> {
  const created = await apiRequest(
    "POST",
    purchaseReturnDraftsPath(purchaseId),
    {
      evidence: "Supplier collection note",
      idempotencyKey: uuidV7(),
      reason: "Supplier accepted returned stock",
    },
  );
  expect(created.status).toBe(201);
  const draft = created.body as PurchaseReturnDraft;
  const updated = await apiRequest("PUT", purchaseReturnDraftPath(draft.id), {
    evidence: draft.evidence,
    expectedVersion: draft.version,
    idempotencyKey: uuidV7(),
    reason: draft.reason,
    rows: draft.rows.map((row) => ({
      originalPurchaseRowId: row.originalPurchaseRowId,
      returnQuantity: "1",
    })),
  });
  expect(updated.status).toBe(200);
  const updatedDraft = updated.body as PurchaseReturnDraft;
  const summaryResponse = await apiRequest(
    "GET",
    purchaseReturnSummaryPath(updatedDraft.id),
  );
  expect(summaryResponse.status).toBe(200);
  const summary = summaryResponse.body as PurchaseReturnSummary;
  const challenge = await apiRequest("POST", "/identity/step-up-challenges", {
    action: "purchase.return.post",
    idempotencyKey: uuidV7(),
    subjectId: updatedDraft.id,
  });
  expect(challenge.status).toBe(201);
  const challengeId = String((challenge.body as { id?: string }).id ?? "");
  const approved = await apiRequest(
    "POST",
    `/identity/step-up-challenges/${challengeId}/approve`,
    { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
  );
  expect(approved.status).toBe(200);
  const posted = await apiRequest(
    "POST",
    purchaseReturnPostingsPath(updatedDraft.id),
    {
      confirmationHash: summary.confirmationHash,
      expectedVersion: updatedDraft.version,
      idempotencyKey: uuidV7(),
      stepUpChallengeId: challengeId,
    },
  );
  expect(posted.status).toBe(201);
  expect(
    (posted.body as PurchaseReturnPostResult).posted
      .inventoryCarryingAmountFils,
  ).toBe("1000");
}

async function assertInventoryRow(
  page: Page,
  locale: "ar" | "en",
): Promise<void> {
  const row = page.locator("tbody tr").first();
  await expect
    .poll(async () =>
      normalizeBidiMarks(
        await row.locator("td[data-column-field='balance']").innerText(),
      ),
    )
    .toBe(locale === "ar" ? "٢" : "2");
  await expect
    .poll(async () =>
      normalizeBidiMarks(
        await row.locator("td[data-column-field='value']").innerText(),
      ),
    )
    .toMatch(locale === "ar" ? /٢٫٠٠٠/u : /IQD\s*2\.000/u);
  await expect
    .poll(async () =>
      normalizeBidiMarks(
        await row.locator("td[data-column-field='averageCost']").innerText(),
      ),
    )
    .toMatch(locale === "ar" ? /١٫٠٠٠/u : /IQD\s*1\.000/u);
  await expect
    .poll(async () =>
      normalizeBidiMarks(
        await row
          .locator("td[data-column-field='consumptionRate']")
          .innerText(),
      ),
    )
    .toBe(locale === "ar" ? "٠" : "0");

  const riskCell = row.locator("td[data-column-field='risk']");
  await expect(
    riskCell.locator("[data-indicator='below-minimum']"),
  ).toContainText(locale === "ar" ? "دون الحد الأدنى" : "Below minimum");
  await expect(
    riskCell.locator("[data-indicator='at-or-below-reorder-point']"),
  ).toContainText(
    locale === "ar"
      ? "عند نقطة إعادة الطلب أو دونها"
      : "At or below reorder point",
  );
}

async function assertMovementDetails(
  page: Page,
  locale: "ar" | "en",
): Promise<void> {
  const labels =
    locale === "ar"
      ? {
          adjustment: "تعديل شراء",
          receipt: "استلام شراء",
          return: "مرتجع شراء",
        }
      : {
          adjustment: "Purchase adjustment",
          receipt: "Purchase receipt",
          return: "Purchase return",
        };
  const table = page.locator(".inventory-table-scroll table");
  await expect(table.locator("thead th")).toHaveText(
    locale === "ar"
      ? [
          "المستند المرجعي",
          "نوع الحركة",
          "التاريخ",
          "الوقت",
          "المستخدم",
          "الكمية",
          "القيمة",
        ]
      : [
          "Reference document",
          "Movement kind",
          "Date",
          "Time",
          "User",
          "Quantity",
          "Value",
        ],
  );
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("td").nth(1)).toHaveText(labels.receipt);
  await expect(rows.nth(1).locator("td").nth(1)).toHaveText(labels.adjustment);
  await expect(rows.nth(2).locator("td").nth(1)).toHaveText(labels.return);

  const adjustmentCells = rows.nth(1).locator("td");
  await expect(adjustmentCells).toHaveCount(7);
  await expect(adjustmentCells.nth(0)).toHaveText(
    /P\d+\/\d+-\d+ · Inventory Browser Supplier/u,
  );
  await expect
    .poll(async () =>
      normalizeBidiMarks(await adjustmentCells.nth(2).innerText()),
    )
    .toMatch(/\S/u);
  await expect
    .poll(async () =>
      normalizeBidiMarks(await adjustmentCells.nth(3).innerText()),
    )
    .toMatch(/\S/u);
  await expect(adjustmentCells.nth(4)).toHaveText("Inventory Browser Owner");
  await expect
    .poll(async () =>
      normalizeBidiMarks(await adjustmentCells.nth(5).innerText()),
    )
    .toBe(locale === "ar" ? "-١" : "-1");
  await expect
    .poll(async () =>
      normalizeBidiMarks(await adjustmentCells.nth(6).innerText()),
    )
    .toMatch(/-/u);
  await expect
    .poll(async () =>
      normalizeBidiMarks(await adjustmentCells.nth(6).innerText()),
    )
    .not.toBe("—");

  const returnCells = rows.nth(2).locator("td");
  await expect(returnCells).toHaveCount(7);
  await expect(returnCells.nth(0)).toHaveText(
    /PR\d+\/\d+ · P\d+\/\d+ · Inventory Browser Supplier/u,
  );
  await expect
    .poll(async () => normalizeBidiMarks(await returnCells.nth(5).innerText()))
    .toBe(locale === "ar" ? "-١" : "-1");
  await expect
    .poll(async () => normalizeBidiMarks(await returnCells.nth(6).innerText()))
    .not.toBe("—");
}

// Strip locale bidi marks so RTL numeric and date output compares by its visible value.
function normalizeBidiMarks(value: string): string {
  return value.replace(/[\u061C\u200E\u200F\u2068\u2069]/gu, "");
}

function medicationRequest(): ProductCreateRequest {
  return {
    arabicSearchName: "مادة مراجعة المخزون",
    barcodes: [
      { kind: "product", value: randomBytes(6).toString("hex").slice(0, 13) },
    ],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName: "Browser Inventory Item",
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
    scientificName: "Paracetamol",
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: null },
    stockLevels: { maximumLevel: "10", minimumLevel: "5", reorderPoint: "4" },
  };
}

async function valueColumnVisibleOnServer(): Promise<boolean | undefined> {
  const current = await apiRequest("GET", "/inventory/review-preferences");
  if (current.status !== 200) return undefined;
  const columns = (
    current.body as { columns: Array<{ field: string; visible: boolean }> }
  ).columns;
  return columns.find((column) => column.field === "value")?.visible;
}

async function restorePreferences(): Promise<void> {
  let lastStatus = 409;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await apiRequest("GET", "/inventory/review-preferences");
    const columns = (
      current.body as { columns: Array<{ field: string; visible: boolean }> }
    ).columns.map((column) => ({ ...column, visible: true }));
    const saved = await apiRequest("PUT", "/inventory/review-preferences", {
      columns,
      expectedRevision: (current.body as { revision: string }).revision,
      idempotencyKey: uuidV7(),
    });
    lastStatus = saved.status;
    if (saved.status === 200) return;
    if (saved.status !== 409) {
      expect(saved.status).toBe(200);
      return;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  expect(lastStatus).toBe(200);
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
  const credentials = requireCredentials();
  const databaseRoles = requireDatabaseRoles();
  requestCredentials = credentials;
  return spawnLocalApiProcess(
    path.resolve(import.meta.dirname, "../../../local-api/dist/main.js"),
    {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      BREEV_INSTALLATION_STATE: "ready",
      BREEV_MAIN_DEVICE_ID: credentials.deviceId,
      BREEV_MAIN_DEVICE_SECRET: credentials.deviceSecret,
      BREEV_MAIN_DEVICE_SESSION: credentials.sessionToken,
      DATABASE_MIGRATION_URL: databaseRoles.migrationUrl,
      DATABASE_URL: databaseRoles.applicationUrl,
    },
  );
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
