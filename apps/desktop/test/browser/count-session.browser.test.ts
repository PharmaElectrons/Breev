import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  inventoryBatchListPath,
  inventoryBatchStatusChangePath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchasePostResult,
  type Supplier,
} from "@breev/contracts/local-rest";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
const OWNER_USERNAME = "count.browser.owner";
const OWNER_PASSWORD = "count browser owner password stays in this test";
const MANAGER_USERNAME = "count.browser.manager";
const MANAGER_PASSWORD = "count browser manager password stays in this test";
const EMPLOYEE_USERNAME = "count.browser.employee";
const EMPLOYEE_PASSWORD = "count browser employee password stays in this test";
const CUSTOM_USERNAME = "count.browser.custom";
const CUSTOM_PASSWORD = "count browser custom password stays in this test";

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

test.describe.serial("durable count sessions", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let renderer: RendererServer;
  let supplier: Supplier;
  let healthyProduct: Product;
  let blockedProduct: Product;
  let healthyBarcode: string;
  let blockedBarcode: string;
  let countSessionId = "";

  test.beforeAll("count session fixture", async () => {
    test.setTimeout(180_000);
    await mkdir(evidencePath("issue-56", "after"), { recursive: true });
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
    apiPort = await reservePort();
    apiOrigin = `http://127.0.0.1:${String(apiPort)}`;
    api = startApi(apiPort);
    await waitForHealth(apiOrigin, "healthy", api);

    const bootstrap = await apiRequest("POST", "/identity/bootstrap", {
      owner: {
        displayName: "Count Browser Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Count Browser Pharmacy",
    });
    expect(bootstrap.status).toBe(201);
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    supplier = await createSupplier();

    healthyBarcode = randomBytes(6).toString("hex").slice(0, 13);
    const healthyResponse = await apiRequest(
      "POST",
      "/catalog/products",
      countProductRequest("Count Healthy Item", healthyBarcode),
    );
    expect(healthyResponse.status).toBe(201);
    healthyProduct = healthyResponse.body as Product;
    await postPurchase(supplier, healthyProduct, "8", "COUNT-HEALTHY-1");

    blockedBarcode = randomBytes(6).toString("hex").slice(0, 13);
    const blockedResponse = await apiRequest(
      "POST",
      "/catalog/products",
      countProductRequest("Count Quarantined Item", blockedBarcode),
    );
    expect(blockedResponse.status).toBe(201);
    blockedProduct = blockedResponse.body as Product;
    await postPurchase(supplier, blockedProduct, "8", "COUNT-BLOCKED-1");
    const batches = await apiRequest(
      "GET",
      inventoryBatchListPath(blockedProduct.id),
    );
    expect(batches.status).toBe(200);
    const batchId = String(
      (
        batches.body as {
          batches?: Array<{ readonly batchId?: string }>;
        }
      ).batches?.[0]?.batchId ?? "",
    );
    expect(batchId).toMatch(/^\S+$/u);
    const quarantined = await apiRequest(
      "POST",
      inventoryBatchStatusChangePath(batchId),
      {
        evidence: "Count browser quarantine evidence",
        idempotencyKey: uuidV7(),
        kind: "quarantine",
        reason: "Count browser quarantine reason",
      },
    );
    expect(quarantined.status).toBe(201);

    const pharmacyId = String(
      (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
    await createUser(pharmacyId, "manager", MANAGER_USERNAME, MANAGER_PASSWORD);
    await createUser(
      pharmacyId,
      "inventory_employee",
      EMPLOYEE_USERNAME,
      EMPLOYEE_PASSWORD,
    );
    await createCustomRecordUser(pharmacyId);
    renderer = await startRendererServer(apiOrigin, credentials);
  });

  test.afterAll(async () => {
    await closeServer(renderer?.server);
    await stopProcess(api);
    await administrator?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  test("records a scanner-first mixed-unit loop with keyboard only", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory/count`);
    await expect(page.locator("#count-title")).toBeVisible();
    await page
      .getByRole("button", { name: "Start count session", exact: true })
      .click();
    await expect(page.locator("#count-loop-title")).toBeVisible();
    countSessionId = new URL(page.url()).hash.split("/").at(-1) ?? "";
    expect(countSessionId).toMatch(/^\S+$/u);

    const item = page.locator("#count-item");
    await expect(item).toBeFocused();
    await item.fill(healthyBarcode);
    await expect(item).toBeFocused();
    await pressKeyOnFocused(page, item, "Enter");
    const healthyStrip = page.locator('[data-count-field="unit:Strip"]');
    await expect(healthyStrip).toBeFocused();
    await healthyStrip.fill("12");
    await expect(healthyStrip).toBeFocused();
    await pressKeyOnFocused(page, healthyStrip, "Enter");
    await expect(item).toBeFocused();
    await expect(item).toHaveValue("");
    await expect(
      page.getByRole("status").filter({ hasText: "Count saved" }),
    ).toBeAttached();

    await item.fill(blockedBarcode);
    await expect(item).toBeFocused();
    await pressKeyOnFocused(page, item, "Enter");
    const pack = page.locator('[data-count-field="unit:Pack"]');
    const strip = page.locator('[data-count-field="unit:Strip"]');
    await expect(strip).toBeFocused();
    await pressKeyOnFocused(page, strip, "Shift+Tab");
    await expect(pack).toBeFocused();
    await pack.fill("2");
    await expect(pack).toBeFocused();
    await pressKeyOnFocused(page, pack, "Tab");
    await expect(strip).toBeFocused();
    await strip.fill("1");
    await expect(strip).toBeFocused();
    await expect(page.locator(".count-live-caption")).toContainText(
      "2 Pack + 1 Strip = 9 Strip",
    );
    await pressKeyOnFocused(page, strip, "Enter");
    await expect(item).toBeFocused();

    const row = countRow(page, blockedProduct.displayName).last();
    await expect(row).toContainText("2 Pack + 1 Strip");
    await expect(row.locator("td").nth(1)).toContainText("9 Strip");
    await expect
      .poll(async () =>
        normalizeBidiMarks(await row.locator("td").nth(2).innerText()),
      )
      .toContain("8");
    await expect
      .poll(async () =>
        normalizeBidiMarks(await row.locator("td").nth(3).innerText()),
      )
      .toContain("9");
    await expect
      .poll(async () =>
        normalizeBidiMarks(await row.locator("td").nth(4).innerText()),
      )
      .toContain("+1");
  });

  test("keeps focus and entered values for count validation failures", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory/count/${countSessionId}`);
    const item = page.locator("#count-item");
    await expect(item).toBeFocused();
    await pressKeyOnFocused(page, item, "Enter");
    await expect(page.getByRole("alert")).toContainText(
      "Enter an item or barcode first.",
    );
    await expect(item).toBeFocused();

    await item.fill(healthyBarcode);
    await expect(item).toBeFocused();
    await pressKeyOnFocused(page, item, "Enter");
    const strip = page.locator('[data-count-field="unit:Strip"]');
    await expect(strip).toBeFocused();
    await strip.fill("1.5");
    await expect(strip).toBeFocused();
    await pressKeyOnFocused(page, strip, "Enter");
    await expect(page.getByRole("alert")).toContainText(
      "Use whole, non-negative numbers.",
    );
    await expect(strip).toHaveValue("1.5");
    await expect(strip).toBeFocused();

    await item.fill("unknown-count-barcode");
    await expect(item).toBeFocused();
    await pressKeyOnFocused(page, item, "Enter");
    await expect(page.getByRole("alert")).toContainText(
      "No active item matched this entry.",
    );
    await expect(item).toHaveValue("unknown-count-barcode");
    await expect(item).toBeFocused();
  });

  test("applies a variance and drills from movement history into the session review", async ({
    page,
  }) => {
    await login(MANAGER_USERNAME, MANAGER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory/count/${countSessionId}`);
    const healthyRow = countRow(page, healthyProduct.displayName).first();
    const apply = healthyRow.getByRole("button", {
      name: "Apply variance",
      exact: true,
    });
    await expect(apply).toBeVisible();
    await apply.click();
    const dialog = page.getByRole("dialog", { name: "Apply variance" });
    const reason = dialog.getByRole("textbox", {
      name: "Application reason",
      exact: true,
    });
    await expect(reason).toBeFocused();
    await pressKeyOnFocused(page, reason, "Escape");
    await expect(dialog).toBeHidden();
    await expect(apply).toBeFocused();

    await apply.click();
    const reopened = page.getByRole("dialog", { name: "Apply variance" });
    await reopened
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    await expect(reopened.getByRole("alert")).toContainText("required");
    await expect(
      reopened.getByRole("textbox", {
        name: "Application reason",
        exact: true,
      }),
    ).toBeFocused();
    await reopened
      .getByRole("textbox", { name: "Application reason", exact: true })
      .fill("Counted surplus on shelf");
    await reopened
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Signed count sheet 56-1");
    await reopened
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    await expect(reopened).toBeHidden();
    await expect(
      page.getByRole("status").filter({ hasText: "Count variance applied" }),
    ).toBeAttached();
    await expect(page.locator("#count-item")).toBeFocused();
    await expect(healthyRow).toContainText("Applied");

    await page.goto(
      `${renderer.origin}#/inventory/items/${healthyProduct.id}/movements`,
    );
    await expect(page.locator("#inventory-movement-title")).toBeVisible();
    const movement = page.locator("table tbody tr").filter({
      hasText: "Count variance",
    });
    await expect(movement).toBeVisible();
    const reference = movement.getByRole("button");
    await expect(reference).toHaveText(/C\d+\/\d+ · line 1/u);
    await reference.click();
    const review = page.locator(".count-session-review-dialog");
    await expect(review).toBeVisible();
    await expect(review).toContainText(healthyProduct.displayName);
    const close = review.getByRole("button", { name: "Close", exact: true });
    await close.click();
    await expect(review).toBeHidden();
    await expect(reference).toBeFocused();
  });

  test("reports stale balances and refuses a blocked-stock variance", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory/count/${countSessionId}`);
    const item = page.locator("#count-item");
    await expect(item).toBeFocused();
    await item.fill(healthyBarcode);
    await expect(item).toBeFocused();
    await pressKeyOnFocused(page, item, "Enter");
    const strip = page.locator('[data-count-field="unit:Strip"]');
    await expect(strip).toBeFocused();
    await strip.fill("14");
    await expect(strip).toBeFocused();
    await pressKeyOnFocused(page, strip, "Enter");
    await expect(item).toBeFocused();

    let purchaseInserted = false;
    await page.route(
      "**/inventory/count-sessions/*/lines/*/variance-applications",
      async (route) => {
        if (!purchaseInserted) {
          purchaseInserted = true;
          await postPurchase(
            supplier,
            healthyProduct,
            "1",
            "COUNT-HEALTHY-RACE",
          );
        }
        await route.continue();
      },
    );
    const staleRow = countRow(page, healthyProduct.displayName).last();
    const staleApply = staleRow.getByRole("button", {
      name: "Apply variance",
      exact: true,
    });
    await staleApply.click();
    let applyDialog = page.getByRole("dialog", { name: "Apply variance" });
    await applyDialog
      .getByRole("textbox", { name: "Application reason", exact: true })
      .fill("Reconcile the received strip");
    await applyDialog
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Receipt posted during count apply");
    await applyDialog
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Current balance: 13" }),
    ).toBeAttached();
    await expect(item).toBeFocused();
    await page.unroute(
      "**/inventory/count-sessions/*/lines/*/variance-applications",
    );

    const refreshedStaleRow = countRow(page, healthyProduct.displayName).last();
    await refreshedStaleRow
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    applyDialog = page.getByRole("dialog", { name: "Apply variance" });
    await applyDialog
      .getByRole("textbox", { name: "Application reason", exact: true })
      .fill("Reconcile the received strip");
    await applyDialog
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Receipt posted during count apply");
    await applyDialog
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    await expect(applyDialog).toBeHidden();
    await expect(
      page.getByRole("status").filter({ hasText: "Count variance applied" }),
    ).toBeAttached();

    await item.fill(blockedBarcode);
    await expect(item).toBeFocused();
    await pressKeyOnFocused(page, item, "Enter");
    const blockedStrip = page.locator('[data-count-field="unit:Strip"]');
    await expect(blockedStrip).toBeFocused();
    await blockedStrip.fill("4");
    await expect(blockedStrip).toBeFocused();
    await pressKeyOnFocused(page, blockedStrip, "Enter");
    await expect(item).toBeFocused();
    const blockedRow = countRow(page, blockedProduct.displayName).last();
    await expect(blockedRow).toContainText("Includes 8 blocked");
    await blockedRow
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    applyDialog = page.getByRole("dialog", { name: "Apply variance" });
    await applyDialog
      .getByRole("textbox", { name: "Application reason", exact: true })
      .fill("Investigate quarantined stock");
    await applyDialog
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Quarantine review required");
    await applyDialog
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "The variance cannot be applied to blocked stock.",
    );
    await expect(
      page.getByRole("alert").getByRole("link", { name: "Review batches" }),
    ).toHaveAttribute(
      "href",
      `#/inventory/items/${blockedProduct.id}/movements`,
    );
    await applyDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
  });

  test("restarts the API and resumes the durable session with its lines", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory/count`);
    await expect(
      page.locator("[data-count-start-control='resume']").first(),
    ).toBeVisible();
    await page.goto(`${renderer.origin}#/inventory/count/${countSessionId}`);
    await expect(page.locator("#count-loop-title")).toBeVisible();
    await stopProcess(api);
    api = startApi(apiPort);
    await waitForHealth(apiOrigin, "healthy", api);
    await page.reload();
    await expect(page.locator("#count-loop-title")).toBeVisible();
    await expect(
      countRow(page, healthyProduct.displayName).first(),
    ).toBeVisible();
    await expect(
      countRow(page, blockedProduct.displayName).last(),
    ).toBeVisible();
    await expect(page.locator("#count-item")).toBeFocused();
  });

  test("enforces record-only and approval boundaries at the renderer and API", async ({
    page,
  }) => {
    await login(EMPLOYEE_USERNAME, EMPLOYEE_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory/count/${countSessionId}`);
    await expect(
      page.getByRole("button", { name: "Apply variance", exact: true }),
    ).toHaveCount(0);
    const employeeSession = await apiRequest(
      "GET",
      `/inventory/count-sessions/${countSessionId}`,
    );
    expect(employeeSession.status).toBe(200);
    const employeeBody = employeeSession.body as {
      version: string;
      lines: Array<{ id: string; currentBalance: string }>;
    };
    const pendingLine = employeeBody.lines.at(-1);
    expect(pendingLine).toBeDefined();
    const forged = await apiRequest(
      "POST",
      `/inventory/count-sessions/${countSessionId}/lines/${pendingLine!.id}/variance-applications`,
      {
        evidence: "Forged employee evidence",
        expectedBalanceBefore: pendingLine!.currentBalance,
        expectedVersion: employeeBody.version,
        idempotencyKey: uuidV7(),
        reason: "Forged employee application",
      },
    );
    expect(forged.status).toBe(403);

    await login(CUSTOM_USERNAME, CUSTOM_PASSWORD);
    await page.reload();
    await page.goto(`${renderer.origin}#/inventory`);
    await expect(page.locator("#count-title")).toBeVisible();
    await expect(page.locator("#count-item")).toHaveCount(0);
  });

  test("covers Arabic and English RTL/LTR themes, accessibility, and the loop video", async ({
    browser,
  }) => {
    const videoPath = path.resolve(
      import.meta.dirname,
      "../../../../test-results/issue-56-video/count-loop.webm",
    );
    await mkdir(path.dirname(videoPath), { recursive: true });
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          ...(locale === "en" && theme === "light"
            ? {
                recordVideo: {
                  dir: path.dirname(videoPath),
                  size: { height: 768, width: 1024 },
                },
              }
            : {}),
          viewport: { height: 768, width: 1280 },
        });
        const page = await context.newPage();
        await login(OWNER_USERNAME, OWNER_PASSWORD);
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(
          `${renderer.origin}#/inventory/count/${countSessionId}`,
        );
        await expect(page.locator("#count-loop-title")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        const item = page.locator("#count-item");
        await expect(item).toBeFocused();
        await item.fill(healthyBarcode);
        await expect(item).toBeFocused();
        await pressKeyOnFocused(page, item, "Enter");
        const fields = page.locator("[data-count-field]");
        await expect(fields.nth(0)).toHaveAttribute("data-count-field", "item");
        await expect(fields.nth(1)).toHaveAttribute(
          "data-count-field",
          "unit:Pack",
        );
        await expect(fields.nth(2)).toHaveAttribute(
          "data-count-field",
          "unit:Strip",
        );
        const loopViolations = (await new AxeBuilder({ page }).analyze())
          .violations;
        expect(loopViolations).toEqual([]);
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-56",
            "after",
            `count-session-loop-${locale}-${theme}.png`,
          ),
        });

        await page.goto(
          `${renderer.origin}#/inventory/count/${countSessionId}`,
        );
        const apply = page.getByRole("button", {
          name: locale === "ar" ? "تطبيق الفرق" : "Apply variance",
          exact: true,
        });
        await expect(apply.first()).toBeVisible();
        await apply.first().click();
        await expect(page.getByRole("dialog")).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-56",
            "after",
            `count-variance-dialog-${locale}-${theme}.png`,
          ),
        });
        await page
          .getByRole("dialog")
          .getByRole("button", {
            name: locale === "ar" ? "إلغاء" : "Cancel",
            exact: true,
          })
          .click();

        await page.goto(
          `${renderer.origin}#/inventory/items/${healthyProduct.id}/movements`,
        );
        await expect(page.locator("#inventory-movement-title")).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-56",
            "after",
            `count-movement-history-${locale}-${theme}.png`,
          ),
        });
        const video = page.video();
        await context.close();
        if (video !== null && locale === "en" && theme === "light") {
          await video.saveAs(videoPath);
        }
      }
    }
  });
});

function countRow(page: Page, itemName: string): Locator {
  return page.locator("table.count-lines-table tbody tr").filter({
    hasText: itemName,
  });
}

function normalizeBidiMarks(value: string): string {
  return value.replace(/[\u061C\u200E\u200F\u2068\u2069]/gu, "");
}

function countProductRequest(
  tradeName: string,
  barcode: string,
): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار جرد المخزون",
    barcodes: [{ kind: "product", value: barcode }],
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
    stockLevels: { maximumLevel: null, minimumLevel: null, reorderPoint: null },
  };
}

async function createSupplier(): Promise<Supplier> {
  const response = await apiRequest("POST", "/suppliers", {
    allowanceEffectiveFrom: "2026-01-01",
    defaultAllowancePercentage: "0",
    idempotencyKey: uuidV7(),
    name: "Count Browser Supplier",
    terms: "Net 30",
  });
  expect(response.status).toBe(201);
  return response.body as Supplier;
}

async function postPurchase(
  purchaseSupplier: Supplier,
  item: Product,
  quantity: string,
  invoiceNumber: string,
): Promise<PurchasePostResult> {
  const created = await apiRequest("POST", "/purchases/drafts", {
    idempotencyKey: uuidV7(),
    invoiceDate: "2026-06-15",
    settlementContext: "debt",
    supplierId: purchaseSupplier.id,
    supplierInvoiceNumber: invoiceNumber,
  });
  expect(created.status).toBe(201);
  let draft = (created.body as { draft: PurchaseDraft }).draft;
  const row = await apiRequest("POST", purchaseDraftRowsPath(draft.id), {
    costFils: "1000",
    enteredQuantity: quantity,
    expectedVersion: draft.version,
    expiryDate: "2027-01-31",
    idempotencyKey: uuidV7(),
    itemId: item.id,
    lotNumber: invoiceNumber,
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
  return posted.body as PurchasePostResult;
}

async function createUser(
  pharmacyId: string,
  roleKey: string,
  username: string,
  password: string,
): Promise<void> {
  await login(OWNER_USERNAME, OWNER_PASSWORD);
  const role = await requireAdministrator().query<{ id: string }>(
    "select id from pharmacy_roles where pharmacy_id = $1 and role_key = $2",
    [pharmacyId, roleKey],
  );
  expect(role.rows[0]?.id).toBeDefined();
  await createUserForRole(role.rows[0]!.id, username, password, roleKey);
}

async function createCustomRecordUser(pharmacyId: string): Promise<void> {
  await login(OWNER_USERNAME, OWNER_PASSWORD);
  const roleChallenge = await apiRequest(
    "POST",
    "/identity/step-up-challenges",
    { action: "identity.role.create", idempotencyKey: uuidV7() },
  );
  expect(roleChallenge.status).toBe(201);
  const roleChallengeId = String(
    (roleChallenge.body as { id?: string }).id ?? "",
  );
  const roleApproval = await apiRequest(
    "POST",
    `/identity/step-up-challenges/${roleChallengeId}/approve`,
    { idempotencyKey: uuidV7(), password: OWNER_PASSWORD },
  );
  expect(roleApproval.status).toBe(200);
  const role = await apiRequest("POST", "/identity/roles", {
    challengeId: roleChallengeId,
    idempotencyKey: uuidV7(),
    name: "Count Record Only",
    permissions: ["inventory.counts.record"],
  });
  expect(role.status).toBe(201);
  const roleId = String((role.body as { id?: string }).id ?? "");
  expect(roleId).toMatch(/^\S+$/u);
  expect(pharmacyId).toMatch(/^\S+$/u);
  await createUserForRole(
    roleId,
    CUSTOM_USERNAME,
    CUSTOM_PASSWORD,
    "Count Record Only",
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
