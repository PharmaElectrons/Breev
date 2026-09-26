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
  saleDraftMiscLinesPath,
  saleDraftLinePriceOverridePath,
  saleDraftsPath,
  saleProductSearchPath,
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
    await waitForHealth(apiOrigin, "healthy", api, 60_000);

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
    await expect(page.locator("#sale-draft-search")).toHaveCount(0);
    await pressKeyOnFocused(page, newDraft, "Enter");

    const search = page.locator("#sale-draft-search");
    await expect(search).toBeFocused();
    const draftId = await currentDraftId(page);
    const activeRow = page.locator(`[data-sale-draft-row="${draftId}"]`);
    await expect(activeRow).toHaveAttribute("data-current", "true");
    await expect(activeRow).toContainText("Current draft");
    await expect(
      activeRow.locator('[data-sale-draft-control="resume"]'),
    ).toHaveCount(0);
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
    const basketSuccess = page.locator(
      `[data-sale-basket-feedback="${panadol.id}"]`,
    );
    await expect(basketSuccess).toBeVisible();
    await expect(basketSuccess).toContainText("Added");
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
          const context = await browser.newContext({
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
          if (locale === "ar") {
            expect(trayBounds.x).toBeGreaterThanOrEqual(
              workspaceBounds.x + workspaceBounds.width - 1,
            );
          } else {
            expect(trayBounds.x + trayBounds.width).toBeLessThanOrEqual(
              workspaceBounds.x + 1,
            );
          }
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
          const activeRow = page.locator(`[data-sale-draft-row="${draftId}"]`);
          await expect(activeRow).toHaveAttribute("data-current", "true");
          await expect(
            page.locator(".sales-draft-tray-content"),
          ).toHaveAttribute("aria-busy", "false");
          await expect(
            activeRow.locator('[data-sale-draft-control="resume"]'),
          ).toHaveCount(0);
          const contextPanel = page.locator(
            '[data-sales-pane="draft-context"]',
          );
          await expect(contextPanel).toBeVisible();
          await expect(contextPanel.getByRole("button")).toHaveCount(0);
          const contextBounds = await contextPanel.evaluate((element) =>
            element.getBoundingClientRect().toJSON(),
          );
          const searchBounds = await page
            .locator("#sale-draft-search")
            .evaluate((element) => element.getBoundingClientRect().toJSON());
          if (locale === "ar") {
            expect(contextBounds.x + contextBounds.width).toBeLessThanOrEqual(
              searchBounds.x + 1,
            );
          } else {
            expect(contextBounds.x).toBeGreaterThanOrEqual(
              searchBounds.x + searchBounds.width - 1,
            );
          }
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

    const arabicContext = await browser.newContext();
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
      page.locator('[data-sale-draft-control="resume"]').first(),
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
      page.locator(`[data-sale-draft-id="${draft.id}"]`),
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
    await expect(page.locator(".sales-item-context")).toContainText(
      "No stock movement recorded",
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

    await invoice.getByRole("button", { name: /Open item record/ }).click();
    const itemRecord = page.getByRole("dialog", { name: "Item record" });
    await expect(itemRecord).toContainText("Panadol Extra GSK");
    await itemRecord
      .getByRole("button", { name: "Return to sale invoice" })
      .click();
    await expect(page.locator("#sale-draft-search")).toHaveValue(
      "Panadol Extra",
    );
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
      .locator(
        `[data-sale-draft-row="${draftId}"] [data-sale-draft-control="resume"]`,
      )
      .click();
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);

    const arabicContext = await browser.newContext({
      viewport: { width: 1878, height: 1002 },
    });
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
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await page.reload();
    await expect(page.locator("[data-sale-misc-open]")).toHaveCount(0);
    const denied = await apiRequest("POST", saleDraftMiscLinesPath(draftId), {
      displayName: "Should be denied",
      unitName: "service",
      quantity: "1",
      unitPriceFils: "1000",
      expectedVersion: added.version,
      idempotencyKey: uuidV7(),
    });
    expect(denied.status).toBe(403);
    expect((await apiRequest("GET", saleDraftPath(draftId))).body).toEqual(
      added,
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
    await page.locator(`[data-sale-line-add="${panadol.id}"]`).click();
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
    await page
      .getByRole("button", { name: /Change line price: Panadol Extra/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Change line price" });
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
    await expect(
      page.locator(`[data-sale-quick-add="${panadol.id}"]`),
    ).toBeVisible();
    await login(SELLER_USERNAME, SELLER_PASSWORD);
    await page.reload();
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

  test("opens Product creation from an unknown scan and returns to the unchanged draft", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/sales`);
    const draftId = await openFreshDraft(page);
    const search = page.locator("#sale-draft-search");
    await search.fill("9876543210012");
    const create = page.getByRole("button", { name: "Create new item" });
    await expect(create).toBeVisible();
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Create new item" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(search).toHaveValue("9876543210012");
    expect(
      ((await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft)
        .lines,
    ).toHaveLength(0);

    await create.click();
    await dialog.getByLabel("Trade name *").fill("Quick Sale Item");
    await dialog.getByLabel("Inventory Unit (base unit) *").fill("Piece");
    await dialog.getByLabel("Retail price (fils) *").fill("120000");
    await dialog.getByLabel("Uses per day").fill("1");
    await dialog.getByLabel("Food timing").selectOption("after-food");
    await dialog.getByRole("button", { name: "Create product" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(search).toHaveValue("Quick Sale Item");
    const found = await apiRequest(
      "GET",
      `${saleProductSearchPath()}?query=Quick%20Sale%20Item`,
    );
    expect(found.status).toBe(200);
    const productId = String(
      (found.body as { results: { product: { id: string } }[] }).results[0]
        ?.product.id,
    );
    await page.locator(`[data-sale-line-add="${productId}"]`).click();
    await expect(
      page.locator(`[data-sale-invoice="${draftId}"] [data-sale-line-id]`),
    ).toHaveCount(1);
    expect(
      (
        (await apiRequest("GET", saleDraftPath(draftId))).body as SaleDraft
      ).lines.map((line) => line.productId),
    ).toEqual([productId]);
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
