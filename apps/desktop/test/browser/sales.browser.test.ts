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
  saleDraftDiscountPath,
  saleDraftLineChangesPath,
  saleDraftLinesPath,
  saleDraftPath,
  saleDraftMiscLinesPath,
  saleDraftLinePriceOverridePath,
  saleDraftsPath,
  saleDrawerBalancePath,
  saleProductSearchPath,
  saleQuickAccessPath,
  type Product,
  type ProductCreateRequest,
  type ReorderItem,
  type SaleDraft,
  type SaleQuickAccess,
  type SaleQuickAccessReplaceRequest,
} from "@breev/contracts/local-rest";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
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
const ownedBrowserContexts = new Set<BrowserContext>();

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
    await mkdir(evidencePath("issue-62", "workspace"), { recursive: true });
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
    // The cold PostgreSQL schema and durable-job migrations can exceed the
    // shared 15-second readiness window on Windows.
    await waitForHealth(apiOrigin, "healthy", api, 120_000);

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
    await Promise.all(
      [...ownedBrowserContexts].map((context) =>
        context.close().catch(() => undefined),
      ),
    );
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
    await expect(page.locator("#sale-draft-search")).toHaveCount(0);
    await pressKeyOnFocused(page, newDraft, "Enter");

    const search = page.locator("#sale-draft-search");
    await expect(page.locator("#sale-draft-scan")).toBeFocused();
    const draftId = await currentDraftId(page);
    await expect(
      page.locator('[data-sale-draft-control="select"]'),
    ).toHaveValue(draftId);
    const before = await apiRequest("GET", saleDraftPath(draftId));
    expect(before.status).toBe(200);
    const beforeVersion = await selectedDraftVersion(page).getAttribute(
      "data-sale-draft-version",
    );

    await search.fill("panadol gs");
    await expect(
      page.getByRole("status").filter({ hasText: "Search results: 2" }),
    ).toBeVisible();
    const addButton = page.locator(`[data-sale-basket-add="${panadol.id}"]`);
    await expect(addButton).toBeVisible();
    await expect(
      addButton.locator("xpath=ancestor::tr").locator(".sale-result-code"),
    ).toHaveText(panadol.barcodes[0]!.value);
    // The action is the next tab stop after the row it belongs to.
    await addButton.focus();
    await pressKeyOnFocused(page, addButton, "Enter");
    const basketSuccess = page.locator(
      `[data-sale-basket-feedback="${panadol.id}"]`,
    );
    await expect(basketSuccess).toBeVisible();
    await expect(basketSuccess).toContainText("Added");
    await expect(addButton).toBeFocused();

    const after = await apiRequest("GET", saleDraftPath(draftId));
    expect(after.body).toEqual(before.body);
    await expect(selectedDraftVersion(page)).toHaveAttribute(
      "data-sale-draft-version",
      beforeVersion ?? "",
    );

    const basket = await apiRequest("GET", reorderBasketPath());
    expect(basket.status).toBe(200);
    const items = (basket.body as { items: ReorderItem[] }).items;
    expect(items.map((item) => item.productId)).toContain(panadol.id);

    const footer = page.locator(".sales-action-footer");
    for (const label of [
      "Print",
      "Search",
      "Cash",
      "Return",
      "Pause",
      "Save",
      "Delete",
    ]) {
      await expect(footer.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(footer.getByRole("button", { name: "Return" })).toBeDisabled();
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      for (const button of await footer.getByRole("button").all()) {
        await expect(button).toBeInViewport();
      }
    }
    await page.evaluate('document.documentElement.style.fontSize = "200%"');
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      for (const button of await footer.getByRole("button").all()) {
        await expect(button).toBeInViewport();
      }
    }
    await page.evaluate('document.documentElement.style.fontSize = ""');
    await search.focus();
    await search.press("ArrowDown");
    await expect(page.locator("#sale-search-result-1")).toHaveAttribute(
      "data-focused",
      "true",
    );
    await search.press("Escape");
    await expect(page.locator("#sale-search-results")).toHaveCount(0);
    const scan = page.locator("#sale-draft-scan");
    await scan.fill(panadol.barcodes[0]!.value);
    await scan.press("Enter");
    await expect(scan).toBeFocused();
    await expect(scan).toHaveValue("");
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toContainText(panadol.displayName);

    const scannedDraft = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    expect(scannedDraft.lines).toHaveLength(1);
    expect(scannedDraft.lines[0]!.productId).toBe(panadol.id);
    expect(scannedDraft.lines[0]!.kind).toBe("catalog");
    expect(scannedDraft.lines[0]!.quantity).toBe("1");
    expect(scannedDraft.lines[0]!.unitPriceFils).toBe("100000");
    expect(scannedDraft.totals.totalFils).toBe("100000");
    expect(BigInt(scannedDraft.version)).toBe(
      BigInt((before.body as SaleDraft).version) + 1n,
    );
    await expect(selectedDraftVersion(page)).toBeVisible();
    await expect(selectedDraftVersion(page)).toHaveAttribute(
      "data-sale-draft-version",
      scannedDraft.version,
    );
  });

  test("resumes the same draft after a renderer restart with an empty search box", async ({
    browser,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const drafts = await apiRequest("GET", `${saleDraftsPath()}?status=active`);
    const open = (drafts.body as { drafts: SaleDraft[] }).drafts;
    expect(open).toHaveLength(1);
    const draft = open[0]!;

    const context = trackBrowserContext(
      await browser.newContext({
        viewport: { height: 768, width: 1280 },
      }),
    );
    const page = await context.newPage();
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales/drafts/${draft.id}`);

    // Durable draft state is the server's; the query was transient and is gone.
    await expect(page.locator("#sale-draft-search")).toHaveValue("");
    await expect(selectedDraftVersion(page)).toBeVisible();
    await expect(selectedDraftVersion(page)).toHaveAttribute(
      "data-sale-draft-version",
      draft.version,
    );

    await page.goto(`${renderer.origin}#/sales`);
    const select = page.locator('[data-sale-draft-control="select"]');
    await expect(select).toBeFocused();
    await select.selectOption(draft.id);
    await expect(page.locator("#sale-draft-scan")).toBeVisible();

    const resumed = await apiRequest("GET", saleDraftPath(draft.id));
    expect((resumed.body as SaleDraft).id).toBe(draft.id);
    expect(BigInt((resumed.body as SaleDraft).version)).toBe(
      BigInt(draft.version),
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
    await expect(selectedDraftVersion(page)).toBeVisible();
    await expect(selectedDraftVersion(page)).toHaveAttribute(
      "data-sale-draft-version",
      draft.version,
    );
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
    test.setTimeout(240_000);
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const videoPath = path.resolve(
      import.meta.dirname,
      "../../../../test-results/issue-62-video/sale-draft-keyboard.webm",
    );
    await mkdir(path.dirname(videoPath), { recursive: true });
    let englishOrder: readonly string[] | undefined;
    const viewports = [
      { height: 800, name: "1280x800", width: 1280 },
      { height: 768, name: "1366x768", width: 1366 },
      { height: 832, name: "1599x832", width: 1599 },
    ] as const;

    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        for (const viewport of viewports) {
          const context = trackBrowserContext(
            await browser.newContext({
              ...(locale === "en" &&
              theme === "light" &&
              viewport.name === "1280x800"
                ? {
                    recordVideo: {
                      dir: path.dirname(videoPath),
                      size: { height: viewport.height, width: viewport.width },
                    },
                  }
                : {}),
              viewport: { height: viewport.height, width: viewport.width },
            }),
          );
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
          await expect(page.locator("#sale-draft-search")).toHaveCount(0);
          await expect(
            page.locator('[data-sales-pane="draft-context"]'),
          ).toHaveCount(0);
          await expect(
            page.locator(".sales-draft-tray-content"),
          ).toHaveAttribute("aria-busy", "false");
          const trayBounds = await page
            .locator(".sales-draft-tray")
            .evaluate((element) => element.getBoundingClientRect().toJSON());
          const workspaceBounds = await page
            .locator(".sales-workspace-main")
            .evaluate((element) => element.getBoundingClientRect().toJSON());
          expect(trayBounds.y).toBeGreaterThanOrEqual(workspaceBounds.y - 1);
          expect(trayBounds.width).toBeLessThan(workspaceBounds.width);
          const moduleList = page.locator(".module-nav ul");
          const navState = await moduleList.evaluate((list) => ({
            clientWidth: list.clientWidth,
            scrollLeft: list.scrollLeft,
            scrollWidth: list.scrollWidth,
          }));
          if (navState.scrollWidth > navState.clientWidth) {
            await expect(
              page.locator(".module-nav-overflow-cue"),
            ).toBeVisible();
            await expect(moduleList).toHaveCSS("scrollbar-width", "auto");

            const lastModule = page.locator(".module-tab").last();
            await lastModule.focus();
            const reachedLastModule = await lastModule.evaluate((link) => {
              const list = link.closest("ul");
              if (list === null) return false;
              const linkBounds = link.getBoundingClientRect();
              const listBounds = list.getBoundingClientRect();
              return (
                linkBounds.left >= listBounds.left &&
                linkBounds.right <= listBounds.right
              );
            });
            expect(reachedLastModule).toBe(true);
            await moduleList.evaluate((list, scrollLeft) => {
              list.scrollLeft = scrollLeft;
            }, navState.scrollLeft);
            await lastModule.evaluate((link) => link.blur());
          }
          await page.screenshot({
            path: evidencePath(
              "issue-62",
              "workspace",
              `sales-index-${viewport.name}-${locale}-${theme}.png`,
            ),
            fullPage: true,
          });
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
            [],
          );

          const draftId = await openFreshDraft(page);
          await expect(
            page.locator(".sales-draft-tray-content"),
          ).toHaveAttribute("aria-busy", "false");
          await expect(
            page.locator('[data-sale-draft-control="select"]'),
          ).toHaveValue(draftId);
          const contextPanel = page.locator(
            '[data-sales-pane="draft-context"]',
          );
          await expect(contextPanel).toHaveCount(0);
          await page.screenshot({
            path: evidencePath(
              "issue-62",
              "workspace",
              `sales-active-${viewport.name}-${locale}-${theme}.png`,
            ),
            fullPage: true,
          });
          await page.locator("#sale-draft-search").fill("panadol gs");
          await expect(
            page.locator(`[data-sale-basket-add="${panadol.id}"]`),
          ).toBeVisible();
          await page.screenshot({
            path: evidencePath(
              "issue-62",
              "workspace",
              `sales-results-${viewport.name}-${locale}-${theme}.png`,
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
            if (locale === "en" && englishOrder === undefined)
              englishOrder = order;
            else expect(order).toEqual(englishOrder);
          }

          expect(draftId).toMatch(/^\S+$/u);
          const video = page.video();
          await context.close();
          if (
            video !== null &&
            locale === "en" &&
            theme === "light" &&
            viewport.name === "1280x800"
          ) {
            await video.saveAs(videoPath);
          }
        }
      }
    }
  });

  test("continues Sales search beyond the first 50 matching products", async ({
    browser,
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    let lastProduct: Product | undefined;
    for (let index = 0; index < 52; index += 1) {
      lastProduct = await createProduct(
        `Pageprobe Marker ${String(index).padStart(2, "0")}`,
      );
    }

    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);
    await page.locator("#sale-draft-search").fill("pageprobe");

    await expect(
      page.getByRole("status").filter({ hasText: "Search results: 52" }),
    ).toBeVisible();
    const rows = page.locator(".sales-results-table tbody tr");
    await expect(rows).toHaveCount(50);
    await page.getByRole("button", { name: "Load more results" }).click();
    await expect(rows).toHaveCount(52);
    expect(lastProduct).toBeDefined();
    await expect(
      page.locator(`[data-sale-basket-add="${lastProduct!.id}"]`),
    ).toBeVisible();

    const arabicContext = trackBrowserContext(await browser.newContext());
    const arabicPage = await arabicContext.newPage();
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(arabicPage, renderer.origin, "ar", "light");
    await arabicPage.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(arabicPage);
    await arabicPage.locator("#sale-draft-search").fill("pageprobe");
    const arabicRows = arabicPage.locator(".sales-results-table tbody tr");
    await expect(arabicRows).toHaveCount(50);
    await arabicPage
      .getByRole("button", { name: "عرض المزيد من النتائج" })
      .click();
    await expect(arabicRows).toHaveCount(52);
    await arabicContext.close();
  });

  test("keeps a failed draft-list read unknown and offers reload", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    let failedFirstRead = false;
    await page.route(
      (url) =>
        url.pathname === saleDraftsPath() &&
        url.searchParams.get("status") === "active",
      async (route) => {
        if (!failedFirstRead && route.request().method() === "GET") {
          failedFirstRead = true;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    await page.goto(`${renderer.origin}#/sales`);
    await expect(
      page.getByText(
        "The sale draft is unavailable. Check the connection and try again.",
      ),
    ).toBeVisible();
    await expect(page.getByText("There are no open sale drafts.")).toHaveCount(
      0,
    );
    await expect(page.getByText("Loading…")).toHaveCount(0);

    const reload = page.locator(
      '[data-sale-draft-control="draft-list-reload"]',
    );
    await expect(reload).toBeVisible();
    await reload.click();
    await expect(reload).toHaveCount(0);
    await expect(
      page.locator('[data-sale-draft-control="select"]'),
    ).toBeVisible();
  });

  test("retries an uncertain New command with its original idempotency key", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const before = await apiRequest("GET", `${saleDraftsPath()}?status=active`);
    const beforeIds = new Set(
      (before.body as { drafts: SaleDraft[] }).drafts.map(({ id }) => id),
    );
    const idempotencyKeys: string[] = [];
    let committedResponseLost = false;

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.route(
      (url) => url.pathname === saleDraftsPath(),
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        idempotencyKeys.push(
          String(
            (route.request().postDataJSON() as { idempotencyKey: string })
              .idempotencyKey,
          ),
        );
        if (!committedResponseLost) {
          committedResponseLost = true;
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    await page.goto(`${renderer.origin}#/sales`);
    const newDraft = page.locator('[data-sale-draft-control="new"]');
    await newDraft.click();
    await expect(
      page.getByText(
        "The sale draft is unavailable. Check the connection and try again.",
      ),
    ).toBeVisible();
    await expect(newDraft).toBeEnabled();
    const reconciled = await apiRequest(
      "GET",
      `${saleDraftsPath()}?status=active`,
    );
    const visibleCreated = (
      reconciled.body as { drafts: SaleDraft[] }
    ).drafts.filter(({ id }) => !beforeIds.has(id));
    expect(visibleCreated).toHaveLength(1);
    await newDraft.click();
    await expect(page.locator("#sale-draft-search")).toBeVisible();

    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    const after = await apiRequest("GET", `${saleDraftsPath()}?status=active`);
    const created = (after.body as { drafts: SaleDraft[] }).drafts.filter(
      ({ id }) => !beforeIds.has(id),
    );
    expect(created).toHaveLength(1);
  });

  test("recovers a draft read in place after a temporary API failure", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const created = await apiRequest("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    expect(created.status).toBe(201);
    const draft = created.body as SaleDraft;
    let failedFirstRead = false;

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.route(
      (url) => url.pathname === saleDraftPath(draft.id),
      async (route) => {
        if (!failedFirstRead && route.request().method() === "GET") {
          failedFirstRead = true;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );

    await page.goto(`${renderer.origin}#/sales/drafts/${draft.id}`);
    await expect(
      page.getByText(
        "The sale draft is unavailable. Check the connection and try again.",
      ),
    ).toBeVisible();
    const reload = page.locator('[data-sale-draft-control="draft-reload"]');
    await expect(reload).toBeVisible();
    await reload.click();
    await expect(page.locator("#sale-draft-search")).toBeVisible();
    await expect(
      page.locator(`[data-sale-invoice="${draft.id}"]`),
    ).toBeVisible();
  });

  test("does not leave old actionable products after a search failure", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);

    const search = page.locator("#sale-draft-search");
    await search.fill("Panadol Extra");
    const previousResult = page.locator(
      `[data-sale-basket-add="${panadol.id}"]`,
    );
    await expect(previousResult).toBeVisible();

    await page.route(
      (url) =>
        url.pathname === "/sales/product-search" &&
        url.searchParams.get("query") === "Amoxil",
      async (route) => {
        await route.abort("failed");
      },
    );
    await search.fill("Amoxil");
    await expect(
      page.getByText(
        "The search is unavailable. Check the connection and try again.",
      ),
    ).toBeVisible();
    await expect(previousResult).toHaveCount(0);
  });

  test("adds a product to the sale invoice and keeps it after reopening the draft", async ({
    browser,
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    const basketBefore = await apiRequest("GET", reorderBasketPath());

    await page.locator("#sale-draft-search").fill("Panadol Extra");
    const add = page.locator(`[data-sale-line-add="${panadol.id}"]`);
    await expect(add).toBeVisible();
    await add.click();
    const invoice = page.locator(`[data-sale-invoice="${draftId}"]`);
    await expect(invoice.locator("[data-sale-line-id]")).toHaveCount(1);
    await expect(invoice).toContainText("Panadol Extra GSK");
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator(".sales-item-context")).toBeVisible();
    await expect(page.locator(".sales-item-context")).toContainText(
      "No stock record",
    );
    const calculator = page.getByRole("region", { name: "Calculator" });
    await calculator.getByRole("textbox", { name: "Calculator" }).fill("2");
    await calculator.getByRole("button", { name: "Apply to draft" }).click();
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .lines[0]?.quantity,
      )
      .toBe("2");
    await calculator.getByRole("button", { name: "Line discount %" }).click();
    await calculator.getByRole("textbox", { name: "Calculator" }).fill("10");
    await calculator.getByRole("button", { name: "Apply to draft" }).click();
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .lines[0]?.lineDiscountPercentage,
      )
      .toBe("10");
    await calculator.getByRole("button", { name: "Invoice discount" }).click();
    await calculator.getByRole("textbox", { name: "Calculator" }).fill("1");
    await calculator.getByRole("button", { name: "Apply to draft" }).click();
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .invoiceDiscountFils,
      )
      .toBe("1000");

    const quantityEditor = invoice
      .locator(".sales-line-editor")
      .getByLabel("Quantity");
    await quantityEditor.fill("7");
    await calculator.getByRole("button", { name: "Invoice discount" }).click();
    await calculator.getByRole("textbox", { name: "Calculator" }).fill("2");
    await calculator.getByRole("button", { name: "Apply to draft" }).click();
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .invoiceDiscountFils,
      )
      .toBe("2000");
    await expect(quantityEditor).toHaveValue("7");

    await page.screenshot({
      path: evidencePath("issue-62", "workspace", "sale-invoice-en-light.png"),
    });
    const saved = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    expect(saved.lines.map((line) => line.productId)).toEqual([panadol.id]);
    expect(BigInt(saved.totals.totalFils)).toBeGreaterThan(0n);
    expect((await apiRequest("GET", reorderBasketPath())).body).toEqual(
      basketBefore.body,
    );

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(invoice.locator(".sales-invoice-final")).toBeInViewport();
      await expect(invoice.locator(".sales-invoice-actions")).toBeInViewport();
      await page.screenshot({
        path: evidencePath(
          "issue-62",
          "workspace",
          `sale-invoice-${viewport.width}x${viewport.height}-en-light.png`,
        ),
      });
    }

    await page.setViewportSize({ width: 512, height: 384 });
    await invoice.locator(".sales-invoice-final").scrollIntoViewIfNeeded();
    await expect(invoice.locator(".sales-invoice-final")).toBeInViewport();
    const invoiceActions = invoice.locator(".sales-invoice-actions");
    await invoiceActions.scrollIntoViewIfNeeded();
    await expect(invoiceActions.getByRole("button").last()).toBeInViewport();
    const salesActions = page.locator(".sales-action-footer");
    await salesActions.scrollIntoViewIfNeeded();
    await expect(salesActions.getByRole("button").last()).toBeInViewport();

    await invoice.getByRole("button", { name: /Open item record/ }).click();
    const itemRecord = page.getByRole("dialog", { name: "Item record" });
    await expect(itemRecord).toContainText("Panadol Extra GSK");
    await itemRecord
      .getByRole("button", { name: "Return to sale invoice" })
      .click();
    await expect(page.locator("#sale-draft-search")).toHaveValue("");
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      saved,
    );

    await page.locator('[data-sale-draft-control="new"]').click();
    const newConfirmation = page.getByRole("group", {
      name: "Confirm new sale draft",
    });
    await expect(newConfirmation).toBeVisible();
    await newConfirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(newConfirmation).toHaveCount(0);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      saved,
    );

    await page.reload();
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);
    await expect(page.locator("#sale-draft-search")).toHaveValue("");
    await page.goto(`${renderer.origin}#/sales`);
    await page
      .locator('[data-sale-draft-control="select"]')
      .selectOption(draftId);
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);

    const arabicContext = trackBrowserContext(
      await browser.newContext({
        viewport: { width: 1878, height: 1002 },
      }),
    );
    const arabicPage = await arabicContext.newPage();
    await installDesktopFake(arabicPage, renderer.origin, "ar", "light");
    await arabicPage.goto(`${renderer.origin}#/sales/drafts/${draftId}`);
    const arabicInvoice = arabicPage.locator(
      `[data-sale-invoice="${draftId}"]`,
    );
    await expect(arabicInvoice.locator("[data-sale-line-id]")).toHaveCount(1);
    await expect(
      arabicInvoice.locator(".sales-invoice-final"),
    ).toBeInViewport();
    await expect(
      arabicInvoice.locator(".sales-invoice-actions"),
    ).toBeInViewport();
    await arabicPage.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sale-invoice-1878x1002-ar-light.png",
      ),
    });
    await arabicContext.close();
  });

  test("Quick Add saves a misc line for the owner and denies the sales role", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    await page.locator("[data-sale-misc-open]").click();
    const form = page.locator(".sales-misc-form");
    await form.getByLabel("Name").fill("Delivery service");
    await form.getByLabel("Unit", { exact: true }).fill("service");
    await form.getByLabel("Quantity").fill("2");
    await form.getByLabel("Unit price (IQD)").fill("12.5");
    await form.getByLabel("Cost (IQD)").fill("8.25");
    await form.getByRole("button", { name: "Add to sale" }).click();
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .lines.length,
      )
      .toBe(1);
    const added = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    expect(added.lines[0]).toMatchObject({
      kind: "misc",
      productId: null,
      totalFils: "25000",
    });

    const costResult = await administrator.query<{ cost_fils: string }>(
      "select cost_fils::text from sale_draft_lines where draft_id = $1 and line_kind = 'misc' order by ordinal asc limit 1",
      [draftId],
    );
    expect(costResult.rows[0]?.cost_fils).toBe("8250");

    // Optional empty cost defaults to 0
    await page.locator("[data-sale-misc-open]").click();
    await form.getByLabel("Name").fill("Packaging fee");
    await form.getByLabel("Unit", { exact: true }).fill("pack");
    await form.getByLabel("Quantity").fill("1");
    await form.getByLabel("Unit price (IQD)").fill("3.0");
    // Leave Cost (IQD) empty
    await form.getByRole("button", { name: "Add to sale" }).click();
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .lines.length,
      )
      .toBe(2);

    const emptyCostResult = await administrator.query<{ cost_fils: string }>(
      "select cost_fils::text from sale_draft_lines where draft_id = $1 and line_kind = 'misc' order by ordinal desc limit 1",
      [draftId],
    );
    expect(emptyCostResult.rows[0]?.cost_fils).toBe("0");

    const twoLinesDraft = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;

    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await page.reload();
    await expect(page.locator("[data-sale-misc-open]")).toHaveCount(0);
    const denied = await apiRequest("POST", saleDraftMiscLinesPath(draftId), {
      displayName: "Should be denied",
      unitName: "service",
      quantity: "1",
      unitPriceFils: "1000",
      expectedVersion: twoLinesDraft.version,
      idempotencyKey: uuidV7(),
    });
    expect(denied.status).toBe(403);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      twoLinesDraft,
    );
  });

  test("records an authorized price override and keeps it after reopening", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    await page.locator("#sale-draft-search").fill("Panadol Extra");
    const addPanadol = page.locator(`[data-sale-line-add="${panadol.id}"]`);
    await expect(addPanadol).toBeVisible();
    await addPanadol.click();
    await expect
      .poll(async () =>
        (
          (await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft
        ).lines.map((line) => line.productId),
      )
      .toEqual([panadol.id]);
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .lines.length,
      )
      .toBe(1);
    const before = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    const line = before.lines[0]!;
    const priceButton = page.getByRole("button", {
      name: /Change line price: Panadol Extra/,
    });
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await priceButton.scrollIntoViewIfNeeded();
      await expect(priceButton).toBeInViewport({ ratio: 1 });
      await priceButton.click({ trial: true });
    }
    await page.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sale-price-merge-1280x800-en-light.png",
      ),
    });
    await priceButton.click();
    const dialog = page.getByRole("dialog", { name: "Change line price" });
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("Unit price (IQD)")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(priceButton).toBeFocused();
    await priceButton.click();
    await dialog.getByLabel("Unit price (IQD)").fill("77.5");
    await dialog.getByLabel("Reason").fill("Approved local promotion");
    await dialog.getByRole("button", { name: "Save price" }).click();
    await expect(dialog).toHaveCount(0);
    const saved = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    expect(saved.lines[0]).toMatchObject({
      id: line.id,
      unitPriceFils: "77500",
      priceSource: "manual",
      priceOverrideReason: "Approved local promotion",
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: /Change line price: Panadol Extra/ }),
    ).toBeVisible();
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      saved,
    );

    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /Change line price/ }),
    ).toHaveCount(0);
    const denied = await apiRequest(
      "POST",
      saleDraftLinePriceOverridePath(draftId, line.id),
      {
        expectedVersion: saved.version,
        idempotencyKey: uuidV7(),
        unitPriceFils: "80000",
        reason: "Unapproved change",
      },
    );
    expect(denied.status).toBe(403);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      saved,
    );
  });

  test("preserves unsubmitted row edits across Products navigation and clears them after Apply", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    await page.locator("#sale-draft-search").fill("Panadol Extra");
    const addPanadol = page.locator(`[data-sale-line-add="${panadol.id}"]`);
    await expect(addPanadol).toBeVisible();
    await addPanadol.click();
    await expect
      .poll(async () =>
        (
          (await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft
        ).lines.map((line) => line.productId),
      )
      .toEqual([panadol.id]);
    const invoice = page.locator(`[data-sale-invoice="${draftId}"]`);
    const editor = invoice.locator(".sales-line-editor");
    await expect(editor.getByLabel("Quantity")).toHaveValue("1");
    const before = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    const line = before.lines[0]!;
    expect(line.kind).toBe("catalog");
    if (line.kind !== "catalog") throw new Error("Expected a catalog line");
    const alternativeUnit = line.eligibleUnits.find(
      (unit) => unit.unitId !== line.unitId,
    )!;
    expect(alternativeUnit).toBeDefined();
    await editor.getByLabel("Quantity").fill("7");
    await editor.getByLabel("Line discount %").fill("12");
    await editor.getByRole("combobox").selectOption(alternativeUnit.unitId);

    const returnToDraft = async (): Promise<void> => {
      await page.getByRole("link", { name: "Products", exact: true }).click();
      await expect(page.locator(".catalog-workspace")).toBeVisible();
      await page.getByRole("link", { name: "Sales", exact: true }).click();
      await page
        .locator('[data-sale-draft-control="select"]')
        .selectOption(draftId);
      await expect(invoice).toBeVisible();
    };
    await returnToDraft();
    await expect(editor.getByLabel("Quantity")).toHaveValue("7");
    await expect(editor.getByLabel("Line discount %")).toHaveValue("12");
    await expect(editor.getByRole("combobox")).toHaveValue(
      alternativeUnit.unitId,
    );
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before,
    );

    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    await expect
      .poll(async () => {
        const saved = (await apiRequest("GET", saleDraftPath(draftId)))
          .body as SaleDraft;
        return saved.lines[0]?.quantity;
      })
      .toBe("7");
    await expect(
      editor.getByRole("button", { name: "Apply", exact: true }),
    ).toBeEnabled();
    // A later authoritative edit must not resurrect a cached acknowledged value.
    const calculator = page.getByRole("region", { name: "Calculator" });
    await calculator
      .getByRole("button", { name: "Change quantity", exact: true })
      .click();
    await calculator.getByRole("textbox", { name: "Calculator" }).fill("3");
    await calculator
      .getByRole("button", { name: "Apply to draft", exact: true })
      .click();
    await expect(editor.getByLabel("Quantity")).toHaveValue("3");
    await returnToDraft();
    await expect(editor.getByLabel("Quantity")).toHaveValue("3");
    await expect(editor.getByLabel("Line discount %")).toHaveValue("12");
    await expect(editor.getByRole("combobox")).toHaveValue(
      alternativeUnit.unitId,
    );
  });

  test("a manager pin persists and a sales tile adds its configured catalog unit", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    await page.locator("#sale-draft-search").fill("Panadol Extra");
    await page
      .getByRole("button", { name: /Pin to quick access: Panadol Extra/ })
      .click();
    const pin = page.locator(".sales-quick-pin-form");
    await expect(pin).toBeVisible();
    await pin.getByLabel("Category").fill("Favorites");
    const unitId = await pin.getByLabel("Selling unit").inputValue();
    await pin.getByRole("button", { name: "Save pin" }).click();
    await expect(page.locator("#sale-quick-links-panel")).toBeHidden();
    await page.getByRole("button", { name: "Quick Links" }).click();
    await expect(
      page.locator(`[data-sale-quick-add="${panadol.id}"]`),
    ).toBeVisible();
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await page.reload();
    await page.getByRole("button", { name: "Quick Links" }).click();
    await expect(
      page.getByRole("button", { name: /Pin to quick access/ }),
    ).toHaveCount(0);
    await page.locator(`[data-sale-quick-add="${panadol.id}"]`).click();
    await expect
      .poll(
        async () =>
          ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
            .lines.length,
      )
      .toBe(1);
    const saved = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    expect(saved.lines[0]).toMatchObject({ productId: panadol.id, unitId });
    await page.reload();
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);
  });

  test("creates from an unknown scan with its barcode and preserves the existing draft line", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    await page.locator("#sale-draft-search").fill("Panadol Extra");
    await page.locator(`[data-sale-line-add="${panadol.id}"]`).click();
    await expect
      .poll(async () =>
        (
          (await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft
        ).lines.map((line) => line.productId),
      )
      .toEqual([panadol.id]);
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);
    const before = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    expect(before.lines.map((line) => line.productId)).toEqual([panadol.id]);

    const scan = page.locator("#sale-draft-scan");
    await scan.fill("9876543210012");
    await scan.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create new item" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(scan).toHaveValue("9876543210012");
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before,
    );

    // Re-submit the same unknown scan, then verify ProductForm carries it into
    // the barcode list before completing product creation.
    await scan.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("9876543210012", { exact: true }),
    ).toBeVisible();
    await dialog.getByLabel("Trade name").fill("Quick Sale Item");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByLabel("Inventory Unit (base unit)")).toBeVisible();
    await dialog.getByLabel("Inventory Unit (base unit)").fill("Piece");
    await dialog.getByLabel("Retail price (fils)").fill("120000");
    await dialog.getByLabel("Uses per day").fill("1");
    await dialog.getByLabel("Food timing").selectOption("after-food");
    await dialog.getByRole("button", { name: "Create product" }).click();
    await expect(dialog).toHaveCount(0);

    // New item is attached automatically without replacing the existing line.
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(2);
    await expect(scan).toBeFocused();

    const found = await apiRequest(
      "GET",
      `${saleProductSearchPath()}?query=Quick%20Sale%20Item`,
    );
    expect(found.status).toBe(200);
    const productId = String(
      (found.body as { results: { product: { id: string } }[] }).results[0]
        ?.product.id,
    );
    const barcodeMatch = await apiRequest(
      "GET",
      `${saleProductSearchPath()}?query=9876543210012`,
    );
    expect(
      (
        barcodeMatch.body as {
          results: { matchedField: string; product: { id: string } }[];
        }
      ).results,
    ).toContainEqual({
      matchedField: "barcode",
      product: expect.objectContaining({ id: productId }),
    });
    const after = (await apiRequest("GET", saleDraftPath(draftId)))
      .body as SaleDraft;
    expect(after.lines.map((line) => line.productId)).toEqual([
      panadol.id,
      productId,
    ]);
    expect(after.lines[0]).toEqual(before.lines[0]);
  });

  test("an unknown barcode matching another product name opens creation instead of adding that product", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const scannedBarcode = "9876543210999";
    const nameMatchedProduct = await createProduct(scannedBarcode);
    const nameSearch = await apiRequest(
      "GET",
      `${saleProductSearchPath()}?query=${scannedBarcode}`,
    );
    expect(
      (
        nameSearch.body as {
          results: { matchedField: string; product: { id: string } }[];
        }
      ).results,
    ).toContainEqual({
      matchedField: "english-name",
      product: expect.objectContaining({ id: nameMatchedProduct.id }),
    });

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    await page.locator("#sale-draft-search").fill("Panadol Extra");
    await page.locator(`[data-sale-line-add="${panadol.id}"]`).click();
    await expect
      .poll(async () =>
        (
          (await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft
        ).lines.map((line) => line.productId),
      )
      .toEqual([panadol.id]);
    const before = await apiRequest("GET", saleDraftPath(draftId));

    const scan = page.locator("#sale-draft-scan");
    await scan.fill(scannedBarcode);
    await scan.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Create new item" });
    await expect(dialog).toBeVisible();
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before.body,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      before.body,
    );
  });

  test("Clear cancel preserves a populated draft and confirmation clears it in one version", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const initial = await createPopulatedDraft(panadol.id);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales/drafts/${initial.id}`);
    const invoice = page.locator(`[data-sale-invoice="${initial.id}"]`);
    await expect(invoice.locator("[data-sale-line-id]")).toHaveCount(1);
    expect(initial.invoiceDiscountFils).toBe("1000");
    expect(initial.lines[0]?.lineDiscountPercentage).toBe("10");

    await invoice.getByRole("button", { name: "Clear invoice" }).click();
    const confirmation = page.getByRole("group", {
      name: /This removes every line and discount/u,
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    expect((await apiRequest("GET", saleDraftPath(initial.id))).body).toEqual(
      initial,
    );

    await invoice.getByRole("button", { name: "Clear invoice" }).click();
    await page
      .getByRole("group", { name: /This removes every line and discount/u })
      .getByRole("button", { name: "Clear invoice" })
      .click();
    await expect
      .poll(
        async () => (await apiRequest("GET", saleDraftPath(initial.id))).body,
      )
      .toMatchObject({
        invoiceDiscountFils: "0",
        lines: [],
        status: "active",
      });
    const cleared = (await apiRequest("GET", saleDraftPath(initial.id)))
      .body as SaleDraft;
    expect(BigInt(cleared.version)).toBe(BigInt(initial.version) + 1n);
    expect(cleared.totals.lineDiscountFils).toBe("0");
  });

  test("confirming New keeps the populated server draft and opens a separate draft", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const original = await createPopulatedDraft(panadol.id);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales/drafts/${original.id}`);
    await expect(
      page.locator(`[data-sale-invoice="${original.id}"] [data-sale-line-id]`),
    ).toHaveCount(1);

    await page.locator('[data-sale-draft-control="new"]').click();
    const confirmation = page.getByRole("group", {
      name: "Confirm new sale draft",
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Open new draft" }).click();

    await expect.poll(() => currentDraftId(page)).not.toBe(original.id);
    const newDraftId = await currentDraftId(page);
    expect(newDraftId).not.toBe(original.id);
    await expect(
      page.locator(`[data-sale-invoice="${newDraftId}"] [data-sale-line-id]`),
    ).toHaveCount(0);
    expect((await apiRequest("GET", saleDraftPath(original.id))).body).toEqual(
      original,
    );
    const opened = (await apiRequest("GET", saleDraftPath(newDraftId)))
      .body as SaleDraft;
    expect(opened.status).toBe("active");
    expect(opened.lines).toEqual([]);
    expect(opened.invoiceDiscountFils).toBe("0");
  });

  test("Delete cancel preserves a populated draft and confirmation discards it", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const original = await createPopulatedDraft(panadol.id);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales/drafts/${original.id}`);
    await expect(
      page.locator(`[data-sale-invoice="${original.id}"] [data-sale-line-id]`),
    ).toHaveCount(1);

    const footer = page.locator(".sales-action-footer");
    await footer.getByRole("button", { name: "Delete" }).click();
    let confirmation = page.getByRole("group", { name: "Confirm delete" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    expect((await apiRequest("GET", saleDraftPath(original.id))).body).toEqual(
      original,
    );

    await footer.getByRole("button", { name: "Delete" }).click();
    confirmation = page.getByRole("group", { name: "Confirm delete" });
    await confirmation.getByRole("button", { name: "Confirm delete" }).click();
    await expect
      .poll(
        async () =>
          (
            (await apiRequest("GET", saleDraftPath(original.id)))
              .body as SaleDraft
          ).status,
      )
      .toBe("discarded");
    const discarded = (await apiRequest("GET", saleDraftPath(original.id)))
      .body as SaleDraft;
    expect(BigInt(discarded.version)).toBe(BigInt(original.version) + 1n);
    expect(discarded.lines).toEqual(original.lines);
    expect(discarded.invoiceDiscountFils).toBe(original.invoiceDiscountFils);
  });

  test("Enter or Add on empty Pick Item search reliably opens ProductForm before debounced search completes", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    const search = page.locator("#sale-draft-search");
    const dialog = page.getByRole("dialog", { name: "Create new item" });

    // Enter on empty query opens ProductForm
    await search.fill("");
    await search.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    // Enter before debounced search completes on unknown query
    await search.fill("Unregistered Quick Med 99");
    await search.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    // Add button on unknown query
    await search.fill("Another Unknown Med 88");
    await page.locator("[data-sale-entry-add]").click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    expect(
      ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
        .lines,
    ).toHaveLength(0);
  });

  test("navigates open drafts without resuming, then pauses, edits, and discards one", async ({
    page,
  }) => {
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const firstResponse = await apiRequest("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    const secondResponse = await apiRequest("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    const first = firstResponse.body as SaleDraft;
    const second = secondResponse.body as SaleDraft;
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await page
      .locator('[data-sale-draft-control="select"]')
      .selectOption(second.id);
    await page.locator('[data-sale-draft-control="next"]').click();
    await expect(
      page.locator('[data-sale-draft-control="select"]'),
    ).toHaveValue(first.id);
    expect(
      ((await apiRequest("GET", saleDraftPath(first.id))).body as SaleDraft)
        .version,
    ).toBe(first.version);
    await page
      .locator(".sales-action-footer")
      .getByRole("button", { name: "Pause" })
      .click();
    await expect(
      page.locator('[data-sale-draft-control="select"]'),
    ).toHaveValue("");
    await page
      .locator('[data-sale-draft-control="select"]')
      .selectOption(first.id);
    await expect(
      page.locator(`[data-sale-invoice="${first.id}"]`),
    ).toContainText("read only");
    await expect(page.locator("#sale-draft-search")).toHaveCount(0);
    await page.locator('[data-sale-draft-control="edit"]').click();
    await expect(page.locator("#sale-draft-scan")).toBeVisible();
    await page
      .locator(".sales-action-footer")
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("group", { name: "Confirm delete" })
      .getByRole("button", { name: "Confirm delete" })
      .click();
    await expect(
      page.locator('[data-sale-draft-control="select"]'),
    ).toHaveValue("");
    expect(
      ((await apiRequest("GET", saleDraftPath(first.id))).body as SaleDraft)
        .status,
    ).toBe("discarded");
  });

  test("presentation settings persist across reload with consumption months, fields, and drawer balance", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);

    // Open quick access panel if not already open
    const quickToggle = page.getByRole("button", { name: "Quick Links" });
    if (await page.locator("#sale-quick-links-panel").isHidden()) {
      await quickToggle.click();
    }
    await expect(page.locator("#sale-quick-links-panel")).toBeVisible();

    // Trigger presentation settings modal
    const settingsBtn = page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", {
      name: "POS Presentation Settings",
    });
    await expect(dialog).toBeVisible();
    const closeButton = dialog.getByRole("button", { name: "Close" });
    const saveButton = dialog.getByRole("button", { name: "Save settings" });
    await expect(closeButton).toBeInViewport({ ratio: 1 });
    await expect(saveButton).toBeInViewport({ ratio: 1 });
    await expect(dialog).toBeFocused();
    expect(
      (
        await new AxeBuilder({ page })
          .include(".sales-presentation-dialog")
          .analyze()
      ).violations,
    ).toEqual([]);
    await saveButton.focus();
    await pressKeyOnFocused(page, saveButton, "Tab");
    await expect(closeButton).toBeFocused();

    // This tab contains the item fields and drawer settings.
    await dialog.getByRole("button", { name: "Item Panel Fields" }).click();

    // Select 1 month consumption
    const radio1Month = dialog
      .locator('input[type="radio"][name="consumptionMonths"]')
      .first();
    await radio1Month.check();
    await expect(radio1Month).toBeChecked();

    // Uncheck "Wholesale Price" field
    const wholesaleCheckbox = dialog.getByLabel(
      "Wholesale price (when permitted)",
    );
    if (await wholesaleCheckbox.isChecked()) {
      await wholesaleCheckbox.uncheck();
    }
    await expect(wholesaleCheckbox).not.toBeChecked();

    // Toggle drawer balance
    const drawerCheckbox = dialog.getByLabel(
      "Show cash drawer balance in the sales interface",
    );
    if (!(await drawerCheckbox.isChecked())) await drawerCheckbox.check();
    await expect(drawerCheckbox).toBeChecked();

    await page.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sales-presentation-fields-en-light.png",
      ),
    });

    await page.evaluate('document.documentElement.style.fontSize = "200%"');
    const settingsBody = dialog.locator(".sales-presentation-scroll-content");
    await expect(settingsBody).toHaveCSS("overflow-y", "auto");
    await expect(
      dialog.locator(".sales-presentation-close-btn"),
    ).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport(
      { ratio: 1 },
    );
    await expect(saveButton).toBeInViewport({ ratio: 1 });
    await drawerCheckbox.scrollIntoViewIfNeeded();
    await expect(drawerCheckbox).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator(".sales-presentation-footer")).toBeVisible();
    await dialog.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sales-presentation-fields-en-light-200-percent.png",
      ),
    });
    await page.evaluate('document.documentElement.style.fontSize = ""');

    // Save
    await dialog.locator(".sales-presentation-save-btn").click();
    await expect(dialog).toBeHidden();

    // Verify on server via API
    await expect
      .poll(async () => {
        const res = await apiRequest("GET", saleQuickAccessPath());
        return (res.body as SaleQuickAccess).panelSettings;
      })
      .toMatchObject({
        consumptionMonths: 1,
        showDrawerBalance: true,
      });

    // Reload page and verify settings persisted in UI
    await page.reload();
    if (await page.locator("#sale-quick-links-panel").isHidden()) {
      await quickToggle.click();
    }
    await page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first()
      .click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Item Panel Fields" }).click();

    await expect(
      dialog.locator('input[type="radio"][name="consumptionMonths"]').first(),
    ).toBeChecked();
    await expect(
      dialog.getByLabel("Wholesale price (when permitted)"),
    ).not.toBeChecked();
    await expect(
      dialog.getByLabel("Show cash drawer balance in the sales interface"),
    ).toBeChecked();

    await dialog.locator(".sales-presentation-cancel-btn").click();
    await expect(dialog).toBeHidden();
    await expect(settingsBtn).toBeFocused();
  });

  test("presentation settings dialog supports both locales and themes with focus and accessibility", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    await login(OWNER_USERNAME, OWNER_PASSWORD);

    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = trackBrowserContext(
          await browser.newContext({
            viewport: { height: 800, width: 1280 },
          }),
        );
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/sales`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openFreshDraft(page);
        const quickToggle = page.getByRole("button", {
          name: locale === "ar" ? "روابط سريعة" : "Quick Links",
        });
        if (await page.locator("#sale-quick-links-panel").isHidden()) {
          await quickToggle.click();
        }
        const settingsTrigger = page
          .locator("[data-sale-presentation-settings-trigger]:visible")
          .first();
        await settingsTrigger.click();

        const dialog = page.getByRole("dialog");
        const title = dialog.locator(".sales-presentation-title");
        const closeButton = dialog.locator(".sales-presentation-close-btn");
        const saveButton = dialog.locator(".sales-presentation-save-btn");
        const fieldsTab = dialog.locator(".sales-presentation-tab-btn").first();
        await expect(dialog).toBeVisible();
        await expect(closeButton).toBeInViewport({ ratio: 1 });
        await expect(saveButton).toBeInViewport({ ratio: 1 });
        await expect(dialog).toBeFocused();
        await expect(title).toBeVisible();
        await expect(closeButton).toBeVisible();
        await expect(saveButton).toBeVisible();
        await expect(fieldsTab).toBeVisible();
        await expect(dialog.locator("nav")).toHaveAttribute(
          "aria-label",
          (await title.innerText()).trim(),
        );
        if (locale === "en") {
          await expect(title).toHaveText("POS Presentation Settings");
          await expect(closeButton).toHaveAccessibleName("Close");
          await expect(saveButton).toHaveText("Save settings");
          await expect(fieldsTab).toHaveText("Item Panel Fields");
        } else {
          await expect(title).toHaveText(/[\u0600-\u06ff]/u);
          await expect(closeButton).toHaveAccessibleName(/[\u0600-\u06ff]/u);
          await expect(saveButton).toHaveText(/[\u0600-\u06ff]/u);
          await expect(fieldsTab).toHaveText(/[\u0600-\u06ff]/u);
        }
        expect(
          (
            await new AxeBuilder({ page })
              .include(".sales-presentation-dialog")
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: evidencePath(
            "issue-62",
            "workspace",
            `sales-presentation-modal-${locale}-${theme}.png`,
          ),
        });

        await saveButton.focus();
        await pressKeyOnFocused(page, saveButton, "Tab");
        await expect(closeButton).toBeFocused();
        await closeButton.click();
        await expect(dialog).toHaveCount(0);
        await expect(settingsTrigger).toBeFocused();
        await context.close();
      }
    }
  });

  test("retries an unconfirmed settings save with the same command after the server committed it", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const initial = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    const expectedWholesaleVisible =
      !initial.panelSettings.visibleFields.includes("wholesalePrice");
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);
    const quickToggle = page.getByRole("button", { name: "Quick Links" });
    if (await page.locator("#sale-quick-links-panel").isHidden()) {
      await quickToggle.click();
    }
    await expect(page.locator("#sale-quick-links-panel")).toBeVisible();
    await page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first()
      .click();

    const dialog = page.getByRole("dialog", {
      name: "POS Presentation Settings",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Item Panel Fields" }).click();
    const wholesaleCheckbox = dialog.getByLabel(
      "Wholesale price (when permitted)",
    );
    if (expectedWholesaleVisible) {
      await wholesaleCheckbox.check();
    } else {
      await wholesaleCheckbox.uncheck();
    }

    const payloads: unknown[] = [];
    const upstreamStatuses: number[] = [];
    await page.route(
      (url) => url.pathname === saleQuickAccessPath(),
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        payloads.push(route.request().postDataJSON());
        const upstream = await route.fetch();
        upstreamStatuses.push(upstream.status());
        if (payloads.length === 1) {
          // The API committed, but the renderer loses its response.
          await route.abort("failed");
          return;
        }
        await route.fulfill({ response: upstream });
      },
    );

    await dialog.locator(".sales-presentation-save-btn").click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Quick access save is unconfirmed. Retry it.",
    );
    const save = dialog.getByRole("button", { name: "Save settings" });
    await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(save).toBeEnabled();
    await expect(dialog).toBeFocused();
    await pressKeyOnFocused(page, dialog, "Escape");
    await expect(dialog).toBeVisible();
    await expect(wholesaleCheckbox).toBeDisabled();
    await expect(
      dialog.locator('input[type="radio"][name="consumptionMonths"]').first(),
    ).toBeDisabled();
    await expect(
      dialog.getByLabel("Show cash drawer balance in the sales interface"),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Quick-Access Categories" })
      .click();
    await expect(
      dialog.getByPlaceholder("New category name..."),
    ).toBeDisabled();
    await expect(save).toBeEnabled();
    expect(payloads).toHaveLength(1);
    expect(upstreamStatuses).toEqual([200]);
    await page.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sales-presentation-unconfirmed-retry-en-light.png",
      ),
    });

    const committedOnce = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    expect(BigInt(committedOnce.version)).toBe(BigInt(initial.version) + 1n);
    expect(
      committedOnce.panelSettings.visibleFields.includes("wholesalePrice"),
    ).toBe(expectedWholesaleVisible);

    await save.click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => payloads.length).toBe(2);
    expect(payloads[1]).toEqual(payloads[0]);
    expect(upstreamStatuses).toEqual([200, 200]);
    const retried = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    expect(BigInt(retried.version)).toBe(BigInt(initial.version) + 1n);
    expect(retried.panelSettings.visibleFields.includes("wholesalePrice")).toBe(
      expectedWholesaleVisible,
    );
    await page.unroute((url) => url.pathname === saleQuickAccessPath());
  });

  test("keeps settings editable after the API rejects an oversized save", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const initial = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    const targetWholesaleVisible =
      !initial.panelSettings.visibleFields.includes("wholesalePrice");
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);
    const quickToggle = page.getByRole("button", { name: "Quick Links" });
    if (await page.locator("#sale-quick-links-panel").isHidden()) {
      await quickToggle.click();
    }
    await page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first()
      .click();

    const dialog = page.getByRole("dialog", {
      name: "POS Presentation Settings",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Item Panel Fields" }).click();
    const wholesaleCheckbox = dialog.getByLabel(
      "Wholesale price (when permitted)",
    );
    if (targetWholesaleVisible) {
      await wholesaleCheckbox.check();
    } else {
      await wholesaleCheckbox.uncheck();
    }

    const payloads: unknown[] = [];
    await page.route(
      (url) => url.pathname === saleQuickAccessPath(),
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        payloads.push(route.request().postDataJSON());
        await route.fulfill({
          status: 413,
          contentType: "application/json",
          body: JSON.stringify({
            status: "denied",
            code: "request-too-large",
            requestId: uuidV7(),
          }),
        });
      },
    );

    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Quick-access settings and images exceed 1 MB. Remove some images or use smaller files.",
    );
    await expect(dialog).toBeVisible();
    await expect(wholesaleCheckbox).toBeEnabled();
    await expect(wholesaleCheckbox).toBeChecked({
      checked: targetWholesaleVisible,
    });
    await expect(
      dialog.getByRole("button", { name: "Save settings" }),
    ).toBeEnabled();
    expect(payloads).toHaveLength(1);

    const after = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    expect(after.version).toBe(initial.version);
    expect(after.panelSettings).toEqual(initial.panelSettings);
    await page.unroute((url) => url.pathname === saleQuickAccessPath());
  });

  test("a quick-access version conflict reloads server settings before another save", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const initial = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    const initialWholesaleVisible =
      initial.panelSettings.visibleFields.includes("wholesalePrice");
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);
    const quickToggle = page.getByRole("button", { name: "Quick Links" });
    if (await page.locator("#sale-quick-links-panel").isHidden()) {
      await quickToggle.click();
    }
    await page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "POS Presentation Settings",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Item Panel Fields" }).click();
    const wholesaleCheckbox = dialog.getByLabel(
      "Wholesale price (when permitted)",
    );
    if (initialWholesaleVisible) {
      await wholesaleCheckbox.uncheck();
    } else {
      await wholesaleCheckbox.check();
    }

    const outsideChange = await apiRequest("POST", saleQuickAccessPath(), {
      expectedVersion: initial.version,
      idempotencyKey: uuidV7(),
      categories: toQuickAccessWriteCategories(initial.categories),
      panelSettings: {
        ...initial.panelSettings,
        showDrawerBalance: !initial.panelSettings.showDrawerBalance,
      },
    });
    expect(outsideChange.status).toBe(200);
    const serverChanged = outsideChange.body as SaleQuickAccess;
    expect(BigInt(serverChanged.version)).toBe(BigInt(initial.version) + 1n);

    const requests: unknown[] = [];
    await page.route(
      (url) => url.pathname === saleQuickAccessPath(),
      async (route) => {
        if (route.request().method() === "POST") {
          requests.push(route.request().postDataJSON());
        }
        await route.continue();
      },
    );
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Quick access changed elsewhere. Review it and retry your edit.",
    );
    if (initialWholesaleVisible) {
      await expect(wholesaleCheckbox).toBeChecked();
    } else {
      await expect(wholesaleCheckbox).not.toBeChecked();
    }
    await expect(
      dialog.getByLabel("Show cash drawer balance in the sales interface"),
    ).toBeChecked({ checked: !initial.panelSettings.showDrawerBalance });

    if (initialWholesaleVisible) {
      await wholesaleCheckbox.uncheck();
    } else {
      await wholesaleCheckbox.check();
    }
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => requests.length).toBe(2);

    const firstRequest = requests[0] as {
      expectedVersion: string;
      idempotencyKey: string;
    };
    const secondRequest = requests[1] as {
      expectedVersion: string;
      idempotencyKey: string;
    };
    expect(firstRequest.expectedVersion).toBe(initial.version);
    expect(secondRequest.expectedVersion).toBe(serverChanged.version);
    expect(secondRequest.idempotencyKey).not.toBe(firstRequest.idempotencyKey);
    const saved = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    expect(BigInt(saved.version)).toBe(BigInt(initial.version) + 2n);
    expect(saved.panelSettings.showDrawerBalance).toBe(
      !initial.panelSettings.showDrawerBalance,
    );
    expect(saved.panelSettings.visibleFields.includes("wholesalePrice")).toBe(
      !initialWholesaleVisible,
    );
    await page.unroute((url) => url.pathname === saleQuickAccessPath());
  });

  test("settings stay open with unsaved fields when refresh fails after a version conflict", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const initial = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    const initialWholesaleVisible =
      initial.panelSettings.visibleFields.includes("wholesalePrice");
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);
    if (await page.locator("#sale-quick-links-panel").isHidden()) {
      await page.getByRole("button", { name: "Quick Links" }).click();
    }
    await page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "POS Presentation Settings",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Item Panel Fields" }).click();
    const wholesaleCheckbox = dialog.getByLabel(
      "Wholesale price (when permitted)",
    );
    if (initialWholesaleVisible) {
      await wholesaleCheckbox.uncheck();
    } else {
      await wholesaleCheckbox.check();
    }

    const outsideChange = await apiRequest("POST", saleQuickAccessPath(), {
      expectedVersion: initial.version,
      idempotencyKey: uuidV7(),
      categories: toQuickAccessWriteCategories(initial.categories),
      panelSettings: {
        ...initial.panelSettings,
        showDrawerBalance: !initial.panelSettings.showDrawerBalance,
      },
    });
    expect(outsideChange.status).toBe(200);

    let failRefresh = false;
    let refreshFailed = false;
    await page.route(
      (url) => url.pathname === saleQuickAccessPath(),
      async (route) => {
        if (
          failRefresh &&
          !refreshFailed &&
          route.request().method() === "GET"
        ) {
          refreshFailed = true;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    failRefresh = true;
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Quick access changed elsewhere. Review it and retry your edit.",
    );
    expect(refreshFailed).toBe(true);
    await expect(dialog).toBeVisible();
    if (initialWholesaleVisible) {
      await expect(wholesaleCheckbox).not.toBeChecked();
    } else {
      await expect(wholesaleCheckbox).toBeChecked();
    }
    await expect(
      dialog.getByRole("button", { name: "Save settings" }),
    ).toBeEnabled();
    await page.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sales-presentation-conflict-refresh-failed-en-light.png",
      ),
    });
    await page.unroute((url) => url.pathname === saleQuickAccessPath());
  });

  test("manager can add, rename, reorder, delete quick access categories and tiles with thumbnail persistence", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const initialQuickAccess = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    const resetQuickAccess = await apiRequest("POST", saleQuickAccessPath(), {
      expectedVersion: initialQuickAccess.version,
      idempotencyKey: uuidV7(),
      categories: [],
      panelSettings: initialQuickAccess.panelSettings,
    });
    expect(resetQuickAccess.status).toBe(200);
    expect((resetQuickAccess.body as SaleQuickAccess).categories).toEqual([]);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);

    // Pin Panadol to category "Painkillers"
    await page.locator("#sale-draft-search").fill("Panadol Extra");
    await page
      .getByRole("button", { name: /Pin to quick access: Panadol Extra/ })
      .click();
    const pin = page.locator(".sales-quick-pin-form");
    await expect(pin).toBeVisible();
    await pin.getByLabel("Category").fill("Painkillers");
    await pin.getByRole("button", { name: "Save pin" }).click();
    await expect(page.locator("#sale-quick-links-panel")).toBeHidden();

    // Open quick links panel and trigger presentation settings
    await page.getByRole("button", { name: "Quick Links" }).click();
    await expect(page.locator("#sale-quick-links-panel")).toBeVisible();
    await page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first()
      .click();

    const dialog = page.getByRole("dialog", {
      name: "POS Presentation Settings",
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Quick-Access Categories" })
      .click();

    // Add a second category "Vitamins"
    const addCatInput = dialog.getByPlaceholder("New category name...");
    await addCatInput.fill("Vitamins");
    await dialog.getByRole("button", { name: "Add category" }).click();

    // Verify 2 categories exist
    const catCards = dialog.locator(".sales-presentation-cat-card");
    await expect(catCards).toHaveCount(2);

    // Rename first category ("Painkillers" -> "Analgesics")
    const firstCatInput = catCards
      .first()
      .locator(".sales-presentation-cat-name-input");
    await firstCatInput.fill("Analgesics");

    // Move first category down
    const moveDownBtn = catCards
      .first()
      .locator('button[title="Move category down"]');
    await moveDownBtn.click();

    // Upload the real >30 KB PNG fixture through FileReader and the bounded
    // quick-access command body allowance.
    const testPngBuffer = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../../local-api/src/sales/test-fixtures/thumbnail.png",
      ),
    );
    expect(testPngBuffer.byteLength).toBeGreaterThan(30_000);
    const fileInput = dialog.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: testPngBuffer,
    });

    // Verify thumbnail preview renders
    await expect(
      dialog.locator(".sales-presentation-tile-thumb img"),
    ).toBeVisible();
    await page.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sales-presentation-quick-access-en-light.png",
      ),
    });

    // Save settings
    await dialog.locator(".sales-presentation-save-btn").click();
    await expect(dialog).toBeHidden();

    // Verify persisted via API
    await expect
      .poll(async () => {
        const res = await apiRequest("GET", saleQuickAccessPath());
        return (res.body as SaleQuickAccess).categories.map((c) => c.name);
      })
      .toEqual(["Vitamins", "Analgesics"]);

    const serverQuick = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    const analgesicsCat = serverQuick.categories.find(
      (c) => c.name === "Analgesics",
    );
    expect(analgesicsCat?.tiles[0]?.thumbnailDataUrl).toContain(
      "data:image/png;base64,",
    );
    expect(
      analgesicsCat?.tiles[0]?.thumbnailDataUrl?.length ?? 0,
    ).toBeGreaterThan(40_000);

    // Reload page and check thumbnail renders on quick access tile
    await page.reload();
    if (await page.locator("#sale-quick-links-panel").isHidden()) {
      await page.getByRole("button", { name: "Quick Links" }).click();
    }
    await expect(page.locator(".sales-quick-tile-thumbnail")).toBeVisible();
    await page.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sales-quick-access-panel-en-light.png",
      ),
    });

    // Delete the empty "Vitamins" category in presentation settings
    await page
      .locator("[data-sale-presentation-settings-trigger]:visible")
      .first()
      .click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Quick-Access Categories" })
      .click();
    const deleteBtn = dialog
      .locator(".sales-presentation-cat-card")
      .first()
      .getByRole("button", { name: "Delete category: Vitamins" });
    await deleteBtn.click();
    await expect(dialog.locator(".sales-presentation-cat-card")).toHaveCount(1);
    await dialog.locator(".sales-presentation-save-btn").click();
    await expect(dialog).toBeHidden();
  });

  test("an owner with the drawer permission sees their balance on an empty draft", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const quickAccess = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    if (!quickAccess.panelSettings.showDrawerBalance) {
      const updated = await apiRequest("POST", saleQuickAccessPath(), {
        expectedVersion: quickAccess.version,
        idempotencyKey: uuidV7(),
        categories: toQuickAccessWriteCategories(quickAccess.categories),
        panelSettings: {
          ...quickAccess.panelSettings,
          showDrawerBalance: true,
        },
      });
      expect(updated.status).toBe(200);
    }

    const created = await apiRequest("POST", saleDraftsPath(), {
      idempotencyKey: uuidV7(),
    });
    expect(created.status).toBe(201);
    const draft = created.body as SaleDraft;
    expect(draft.lines).toEqual([]);

    await installDesktopFake(page, renderer.origin, "en", "light");
    let drawerRequests = 0;
    await page.route(
      (url) => url.pathname === saleDrawerBalancePath(),
      async (route) => {
        drawerRequests++;
        await route.continue();
      },
    );
    await page.goto(`${renderer.origin}#/sales/drafts/${draft.id}`);

    const balance = page.locator("[data-sales-drawer-balance]");
    await expect(balance).toBeVisible();
    await expect(balance.locator(".sales-drawer-balance-value")).toContainText(
      "No drawer activity recorded",
    );
    await expect(page.locator(".sales-calculator")).toBeVisible();
    const serverBalance = await apiRequest("GET", saleDrawerBalancePath());
    expect(serverBalance.status).toBe(200);
    expect(serverBalance.body).toMatchObject({ balanceFils: null });
    await expect.poll(() => drawerRequests).toBeGreaterThan(0);
    await page.screenshot({
      path: evidencePath(
        "issue-62",
        "workspace",
        "sales-empty-draft-drawer-en-light.png",
      ),
    });
  });

  test("seller without sales.drawer_balance.view permission does not trigger drawer balance network request", async ({
    page,
  }) => {
    // Ensure drawer balance is enabled in panel settings
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const currentQuick = (await apiRequest("GET", saleQuickAccessPath()))
      .body as SaleQuickAccess;
    await apiRequest("POST", saleQuickAccessPath(), {
      expectedVersion: currentQuick.version,
      idempotencyKey: uuidV7(),
      categories: toQuickAccessWriteCategories(currentQuick.categories),
      panelSettings: {
        ...currentQuick.panelSettings,
        showDrawerBalance: true,
      },
    });

    // Log in as seller who lacks sales.drawer_balance.view
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");

    let drawerBalanceRequests = 0;
    await page.route(
      (url) => url.pathname === saleDrawerBalancePath(),
      (route) => {
        drawerBalanceRequests++;
        return route.continue();
      },
    );

    await page.goto(`${renderer.origin}#/sales`);
    await openFreshDraft(page);

    // Calculator is visible, but drawer balance badge is NOT rendered
    await expect(
      page.getByRole("region", { name: "Calculator" }),
    ).toBeVisible();
    await expect(page.locator("[data-sales-drawer-balance]")).toHaveCount(0);

    // Verify zero network requests were dispatched to /sales/drawer-balance
    expect(drawerBalanceRequests).toBe(0);
  });

  test("selected item panel, calculator, and row actions fit four locale and theme combinations", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    const draft = await createPopulatedDraft(panadol.id);

    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = trackBrowserContext(
          await browser.newContext({
            viewport: { height: 800, width: 1280 },
          }),
        );
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/sales/drafts/${draft.id}`);

        const invoice = page.locator(`[data-sale-invoice="${draft.id}"]`);
        const lineRow = invoice.locator("[data-sale-line-id]").first();
        await expect(lineRow).toBeVisible();
        const itemPanel = page.locator(".sales-item-panel");
        await expect(itemPanel).toBeVisible();
        const scrollBody = itemPanel.locator(".sales-item-scroll-body");
        const itemDetailsLabel = await itemPanel.getAttribute("aria-label");
        expect(itemDetailsLabel).toBeTruthy();
        await expect(scrollBody).toHaveAttribute("role", "group");
        await expect(scrollBody).toHaveAttribute(
          "aria-label",
          itemDetailsLabel ?? "",
        );
        await expect(scrollBody).toHaveAttribute("tabindex", "0");
        await scrollBody.evaluate((element) => {
          element.scrollTop = 0;
        });
        await scrollBody.focus();
        await expect(scrollBody).toBeFocused();
        await expect(scrollBody).toHaveCSS("outline-style", "solid");
        const scrollMetrics = await scrollBody.evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }));
        if (scrollMetrics.scrollHeight > scrollMetrics.clientHeight) {
          await pressKeyOnFocused(page, scrollBody, "PageDown");
          await expect
            .poll(async () =>
              scrollBody.evaluate((element) => element.scrollTop),
            )
            .toBeGreaterThan(0);
          await scrollBody.evaluate((element) => {
            element.scrollTop = 0;
          });
          await expect
            .poll(async () =>
              scrollBody.evaluate((element) => element.scrollTop),
            )
            .toBe(0);
        }
        await page.locator(".sales-draft-context").evaluate((element) => {
          element.scrollTop = 0;
        });
        await expect(
          page.locator(".sales-item-context > strong"),
        ).toContainText(panadol.displayName);
        await expect(
          itemPanel.locator(".sales-item-balance-section"),
        ).toBeVisible();
        await expect(itemPanel.locator(".sales-item-fact-sheet")).toBeVisible();
        await expect(itemPanel).toContainText(
          locale === "ar" ? "لا يوجد سجل مبيعات" : "No sales history",
        );
        await expect(
          itemPanel.locator(".sales-item-batches-section"),
        ).toBeVisible();

        const calculator = page.locator(".sales-calculator");
        const removeLine = lineRow.locator(".sales-col-actions button");
        await expect(calculator).toBeInViewport();
        await expect(removeLine).toBeInViewport();
        await expect(lineRow).toBeInViewport();

        const aiSlot = page.locator(
          '.sales-ai-recommendations-slot[data-slot="ai-recommendations"]',
        );
        await expect(aiSlot).toBeHidden();
        expect(
          (
            await new AxeBuilder({ page })
              .include(".sales-item-panel")
              .include(".sales-calculator")
              .include(`[data-sale-invoice="${draft.id}"]`)
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: evidencePath(
            "issue-62",
            "workspace",
            `sales-item-panel-1280x800-${locale}-${theme}.png`,
          ),
          fullPage: true,
        });
        await context.close();
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

async function createPopulatedDraft(productId: string): Promise<SaleDraft> {
  const created = await apiRequest("POST", saleDraftsPath(), {
    idempotencyKey: uuidV7(),
  });
  expect(created.status).toBe(201);
  const draft = created.body as SaleDraft;

  const added = await apiRequest("POST", saleDraftLinesPath(draft.id), {
    expectedVersion: draft.version,
    idempotencyKey: uuidV7(),
    productId,
  });
  expect(added.status).toBe(200);
  const withLine = added.body as SaleDraft;
  const line = withLine.lines[0];
  expect(line).toBeDefined();

  const discountedLine = await apiRequest(
    "POST",
    saleDraftLineChangesPath(draft.id, line!.id),
    {
      expectedVersion: withLine.version,
      idempotencyKey: uuidV7(),
      lineDiscountPercentage: "10",
    },
  );
  expect(discountedLine.status).toBe(200);
  const lineDiscount = discountedLine.body as SaleDraft;
  const invoiceDiscount = await apiRequest(
    "POST",
    saleDraftDiscountPath(draft.id),
    {
      expectedVersion: lineDiscount.version,
      idempotencyKey: uuidV7(),
      invoiceDiscountFils: "1000",
    },
  );
  expect(invoiceDiscount.status).toBe(200);
  return invoiceDiscount.body as SaleDraft;
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
    supplierIds: [],
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

function selectedDraftVersion(page: Page): Locator {
  return page.locator(".sales-draft-tray [data-sale-draft-version]");
}

function toQuickAccessWriteCategories(
  categories: SaleQuickAccess["categories"],
): SaleQuickAccessReplaceRequest["categories"] {
  return categories.map((category) => ({
    name: category.name,
    tiles: category.tiles.map((tile) => ({
      productId: tile.productId,
      unitId: tile.unitId,
      ...(tile.thumbnailDataUrl === null
        ? {}
        : { thumbnailDataUrl: tile.thumbnailDataUrl }),
    })),
  }));
}

function trackBrowserContext(context: BrowserContext): BrowserContext {
  ownedBrowserContexts.add(context);
  context.on("close", () => ownedBrowserContexts.delete(context));
  return context;
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
