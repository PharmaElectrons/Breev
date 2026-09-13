import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  productArchivePath,
  productMergePath,
  productPath,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  reorderBasketPath,
  reorderItemConfirmationsPath,
  reorderItemPath,
  reorderItemsPath,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchasePostResult,
  type ReorderItem,
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
const OWNER_USERNAME = "basket.browser.owner";
const OWNER_PASSWORD = "basket browser owner password stays in this test";
const MANAGER_USERNAME = "basket.browser.manager";
const MANAGER_PASSWORD = "basket browser manager password stays in this test";
const EMPLOYEE_USERNAME = "basket.browser.employee";
const EMPLOYEE_PASSWORD = "basket browser employee password stays in this test";
const CUSTOM_USERNAME = "basket.browser.custom";
const CUSTOM_PASSWORD = "basket browser custom password stays in this test";

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

interface ForgedResponse {
  readonly body: { readonly code?: string; readonly requestId?: string };
  readonly status: number;
}

let sharedAdministrator: Pool | undefined;
let sharedCredentials: Credentials | undefined;
let sharedDatabaseRoles: SeparatedDatabaseRoles | undefined;

test.describe.serial("reorder basket and Ordered Items", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let apiPort = 0;
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let pharmacyId = "";
  let postgres: StartedPostgreSqlContainer | undefined;
  let renderer: RendererServer;
  let supplier: Supplier;
  let productA: Product;
  let productB: Product;
  let productC: Product;
  let productD: Product;
  let productE: Product;
  let itemAId = "";
  let itemBId = "";
  let itemCId = "";
  let itemDId = "";

  test.beforeAll("reorder basket fixture", async () => {
    test.setTimeout(180_000);
    await mkdir(evidencePath("issue-57", "after"), { recursive: true });
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
        displayName: "Basket Browser Owner",
        password: OWNER_PASSWORD,
        username: OWNER_USERNAME,
      },
      pharmacyName: "Breev Basket Browser Pharmacy",
    });
    expect(bootstrap.status).toBe(201);
    pharmacyId = String(
      (bootstrap.body as { pharmacy?: { id?: string } }).pharmacy?.id ?? "",
    );
    expect(pharmacyId).toMatch(/^\S+$/u);
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    supplier = await createSupplier();
    productA = await createProduct(
      "Basket Item A",
      { maximumLevel: "60", minimumLevel: "10", reorderPoint: "20" },
      2,
      supplier,
    );
    productB = await createProduct(
      "Basket Item B",
      { maximumLevel: null, minimumLevel: null, reorderPoint: null },
      0,
      supplier,
    );
    productC = await createProduct(
      "Basket Item C",
      { maximumLevel: "4", minimumLevel: "1", reorderPoint: "2" },
      2,
      supplier,
    );
    productD = await createProduct(
      "Basket Item D",
      { maximumLevel: null, minimumLevel: null, reorderPoint: null },
      0,
      supplier,
    );
    productE = await createProduct(
      "Basket Item E",
      { maximumLevel: null, minimumLevel: null, reorderPoint: null },
      0,
      supplier,
    );
    await createUser(
      pharmacyId,
      "manager",
      MANAGER_USERNAME,
      MANAGER_PASSWORD,
      "Basket Browser Manager",
    );
    await createUser(
      pharmacyId,
      "inventory_employee",
      EMPLOYEE_USERNAME,
      EMPLOYEE_PASSWORD,
      "Basket Browser Employee",
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

  test("adds product A from the grid by keyboard without changing grid rows", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory`);
    await expect(
      page.getByRole("heading", { name: "Inventory review" }),
    ).toBeVisible();

    const gridRows = page.locator("table tbody tr");
    await expect(gridRows).toHaveCount(5);
    const initialRows = await gridRows.allTextContents();
    const productRow = gridRows.filter({ hasText: productA.displayName });
    const itemButton = productRow.locator(
      `button[data-review-focus="inventory-item-${productA.id}"]`,
    );
    const addButton = page.locator(
      `[data-review-focus="inventory-basket-add-${productA.id}"]`,
    );
    await itemButton.focus();
    await expect(itemButton).toBeFocused();
    await pressKeyOnFocused(page, itemButton, "Tab");
    await expect(addButton).toBeFocused();
    await pressKeyOnFocused(page, addButton, "Enter");
    await expect(statusRegion(page)).toContainText(
      `Added 52 Strip for ${productA.displayName} to the order basket.`,
    );
    await expect(addButton).toBeFocused();
    await expect(gridRows).toHaveCount(5);
    await expect(gridRows).toHaveText(initialRows);
    const basketAfterFirstAdd = await readBasketItems();

    // A second press is a new command, not a replay: the row is updated in
    // place and the renderer says so.
    await pressKeyOnFocused(page, addButton, "Enter");
    await expect(statusRegion(page)).toHaveText(
      `${productA.displayName} is already in the order basket. The proposal was refreshed; the quantity is now 52 Strip.`,
    );
    await expect(addButton).toBeFocused();
    const basketAfterReplay = await readBasketItems();
    const firstAddedA = requireItem(basketAfterFirstAdd, productA);
    const replayedA = requireItem(basketAfterReplay, productA);
    expect(
      basketAfterReplay.filter((item) => item.productId === productA.id),
    ).toHaveLength(1);
    expect(replayedA.quantity).toBe("52");
    expect(BigInt(replayedA.version)).toBeGreaterThan(
      BigInt(firstAddedA.version),
    );
    itemAId = replayedA.id;

    const openBasket = page.getByRole("link", {
      name: "Open the order basket",
      exact: true,
    });
    await expect(openBasket).toBeVisible();
    await openBasket.click();
    await expect(page).toHaveURL(/#\/basket$/u);
    await expect(page.locator("section.basket-workspace")).toBeVisible();
  });

  test("shows live basket facts, warnings, captions, and validation focus", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    const addB = await apiRequest("POST", reorderItemsPath(), {
      idempotencyKey: uuidV7(),
      productId: productB.id,
    });
    expect(addB.status).toBe(200);
    const addC = await apiRequest("POST", reorderItemsPath(), {
      idempotencyKey: uuidV7(),
      productId: productC.id,
    });
    expect(addC.status).toBe(200);
    const seededItems = await readBasketItems();
    itemAId = requireItem(seededItems, productA).id;
    itemBId = requireItem(seededItems, productB).id;
    itemCId = requireItem(seededItems, productC).id;

    await page.goto(`${renderer.origin}#/basket`);
    await expect(page.locator("table.basket-table")).toBeVisible();
    const rowA = basketRow(page, productA);
    await expect(rowA).toContainText("8 Strip");
    // The item column is a row header, so data cells start after it.
    await expect(rowA.locator("td").nth(1)).toContainText("10 / 60");
    await expect(rowA.locator("td").nth(2)).toContainText("0");
    await expect(
      rowA.locator("td").nth(3).locator(".inventory-indicators"),
    ).toBeVisible();
    await expect(
      rowA.locator("[data-indicator='below-minimum']"),
    ).toContainText("Below minimum");
    const quantityA = page.locator(`[data-basket-field="quantity:${itemAId}"]`);
    await expect(quantityA).toHaveValue("52");
    await expect(rowA.locator(".basket-quantity-caption")).toHaveText(
      "13 Pack",
    );

    const rowB = basketRow(page, productB);
    await expect(rowB).toContainText("0 Strip");
    await expect(rowB.locator(".basket-proposal-basis")).toHaveText(
      "No maximum level",
    );
    const rowC = basketRow(page, productC);
    await expect(rowC).toContainText("0 Strip");
    await expect(rowC.locator(".basket-proposal-basis")).toHaveText(
      "Balance is at or above the maximum",
    );

    await quantityA.focus();
    await expect(quantityA).toBeFocused();
    await pressKeyOnFocused(page, quantityA, "ControlOrMeta+A");
    await quantityA.fill("60");
    await expect(quantityA).toBeFocused();
    await pressKeyOnFocused(page, quantityA, "Enter");
    await expect(statusRegion(page)).toHaveText(
      `Saved 60 Strip for ${productA.displayName} — projected 68 exceeds the maximum 60 and could create surplus or waste.`,
    );
    const surplus = rowA.locator("[data-warning='surplus']");
    await expect(surplus).toBeVisible();
    await expect(surplus).toContainText(
      "Projected 68 — could create surplus or waste (maximum 60)",
    );
    // Async completion leaves the edited control focused (workflows.md).
    await expect(quantityA).toBeFocused();

    await pressKeyOnFocused(page, quantityA, "ControlOrMeta+A");
    await quantityA.fill("52");
    await expect(quantityA).toBeFocused();
    await pressKeyOnFocused(page, quantityA, "Enter");
    await expect(statusRegion(page)).toHaveText(
      `Saved 52 Strip for ${productA.displayName} — projected 60 is within the maximum 60.`,
    );
    await expect(rowA.locator("[data-warning='surplus']")).toHaveCount(0);
    await expect(rowA.locator("td").nth(5)).toContainText("Within the maximum");
    await expect(quantityA).toBeFocused();

    await pressKeyOnFocused(page, quantityA, "ControlOrMeta+A");
    await quantityA.fill("1.5");
    await expect(quantityA).toBeFocused();
    await pressKeyOnFocused(page, quantityA, "Enter");
    await expect(page.getByRole("alert")).toContainText(
      "Use a whole, non-negative number.",
    );
    await expect(quantityA).toHaveValue("1.5");
    await expect(quantityA).toBeFocused();
  });

  test("confirms, returns, and refuses a zero-quantity order", async ({
    page,
  }) => {
    await login(MANAGER_USERNAME, MANAGER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/basket`);
    const rowA = basketRow(page, productA);
    const confirmA = rowA.locator(`[data-basket-action="confirm:${itemAId}"]`);
    await expect(confirmA).toBeVisible();
    await confirmA.click();
    await expect(statusRegion(page)).toContainText(
      `${productA.displayName} moved to Ordered Items.`,
    );
    await expect(rowA).toHaveCount(0);
    const rowB = basketRow(page, productB);
    await expect(
      rowB.locator(`[data-basket-field="quantity:${itemBId}"]`),
    ).toBeFocused();

    await page.locator("#basket-tab-ordered").click();
    await expect(page.locator("#basket-tab-ordered")).toHaveAttribute(
      "aria-current",
      "page",
    );
    const orderedA = page.locator(`tr[data-basket-row="${itemAId}"]`);
    await expect(orderedA).toBeVisible();
    await expect(orderedA.locator(".basket-ordered-status")).toContainText(
      "Ordered",
    );
    await expect(orderedA.locator("td").nth(2)).not.toContainText("—");
    await expect(orderedA.locator("td").nth(3)).toContainText(
      "Basket Browser Manager",
    );

    await orderedA.locator(`[data-basket-action="return:${itemAId}"]`).click();
    await expect(statusRegion(page)).toContainText(
      `${productA.displayName} returned to the order basket.`,
    );
    await expect(page.locator("#basket-tab-ordered")).toBeFocused();
    await page.locator("#basket-tab-basket").click();
    await expect(basketRow(page, productA)).toBeVisible();
    await expect(
      page.locator(`[data-basket-field="quantity:${itemAId}"]`),
    ).toHaveValue("52");

    const rowBAfterReturn = basketRow(page, productB);
    const confirmB = rowBAfterReturn.locator(
      `[data-basket-action="confirm:${itemBId}"]`,
    );
    await confirmB.focus();
    await expect(confirmB).toBeFocused();
    await confirmB.click();
    await expect(page.getByRole("alert")).toContainText(
      "An order quantity of zero cannot be confirmed.",
    );
    await expect(rowBAfterReturn).toBeVisible();
    await expect(confirmB).toBeFocused();
  });

  test("renders archived rows, removes a basket row, and offers only return for an archived ordered row", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/basket`);
    const currentA = await apiRequest("GET", productPath(productA.id));
    expect(currentA.status).toBe(200);
    const archivedA = await apiRequest(
      "POST",
      productArchivePath(productA.id),
      {
        expectedRevision: (currentA.body as Product).revision,
        idempotencyKey: uuidV7(),
      },
    );
    expect(archivedA.status).toBe(201);
    await page.reload();
    const archivedRowA = basketRow(page, productA);
    await expect(archivedRowA.locator(".basket-product-state")).toContainText(
      "Archived — remove from the basket",
    );
    await expect(archivedRowA.locator(".basket-product-state svg")).toHaveCount(
      1,
    );
    await expect(
      archivedRowA.locator(`[data-basket-action^="confirm:"]`),
    ).toHaveCount(0);
    await expect(
      archivedRowA.locator(`[data-basket-field="quantity:${itemAId}"]`),
    ).toBeDisabled();
    await archivedRowA
      .locator(`[data-basket-action="remove:${itemAId}"]`)
      .click();
    await expect(archivedRowA).toHaveCount(0);
    await expect(statusRegion(page)).toContainText(
      `${productA.displayName} was removed from the order basket.`,
    );

    await login(MANAGER_USERNAME, MANAGER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.reload();
    const rowC = basketRow(page, productC);
    const quantityC = page.locator(`[data-basket-field="quantity:${itemCId}"]`);
    await quantityC.fill("1");
    await expect(quantityC).toBeFocused();
    await pressKeyOnFocused(page, quantityC, "Enter");
    await expect(statusRegion(page)).toContainText("Saved 1 Strip");
    await rowC.locator(`[data-basket-action="confirm:${itemCId}"]`).click();
    await expect(statusRegion(page)).toContainText(
      `${productC.displayName} moved to Ordered Items.`,
    );

    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.reload();
    const currentC = await apiRequest("GET", productPath(productC.id));
    expect(currentC.status).toBe(200);
    const archivedC = await apiRequest(
      "POST",
      productArchivePath(productC.id),
      {
        expectedRevision: (currentC.body as Product).revision,
        idempotencyKey: uuidV7(),
      },
    );
    expect(archivedC.status).toBe(201);
    const addD = await apiRequest("POST", reorderItemsPath(), {
      idempotencyKey: uuidV7(),
      productId: productD.id,
    });
    expect(addD.status).toBe(200);
    itemDId = requireItem(await readBasketItems(), productD).id;
    const currentD = await apiRequest("GET", productPath(productD.id));
    expect(currentD.status).toBe(200);
    const mergedD = await apiRequest("POST", productMergePath(productD.id), {
      expectedRevision: (currentD.body as Product).revision,
      idempotencyKey: uuidV7(),
      survivorProductId: productE.id,
    });
    expect(mergedD.status).toBe(201);
    await page.goto(`${renderer.origin}#/basket`);
    await page.reload();
    const mergedRowD = basketRow(page, productD);
    await expect(mergedRowD.locator(".basket-product-state")).toContainText(
      `Merged into ${productE.displayName} — remove from the basket`,
    );
    await expect(mergedRowD.locator(".basket-product-state svg")).toHaveCount(
      1,
    );
    await expect(mergedRowD.locator("[data-basket-merged-link]")).toHaveText(
      `Merged into ${productE.displayName} — remove from the basket`,
    );
    await expect(
      mergedRowD.locator("[data-basket-merged-link]"),
    ).toHaveAttribute("href", `#/inventory/items/${productE.id}/movements`);
    await expect(
      mergedRowD.locator(`[data-basket-field="quantity:${itemDId}"]`),
    ).toBeDisabled();
    await expect(mergedRowD.locator("[data-basket-action]")).toHaveCount(1);
    await expect(
      mergedRowD.locator(`[data-basket-action^="remove:"]`),
    ).toHaveCount(1);
    await expect(
      mergedRowD.locator(`[data-basket-action^="confirm:"]`),
    ).toHaveCount(0);
    await mergedRowD
      .locator(`[data-basket-action="remove:${itemDId}"]`)
      .click();
    await expect(mergedRowD).toHaveCount(0);
    await expect(statusRegion(page)).toContainText(
      `${productD.displayName} was removed from the order basket.`,
    );

    // Navigation to Ordered Items is followed by a full reload so the archive
    // is read from the server rather than from the previous route state.
    await page.goto(`${renderer.origin}#/basket/ordered`);
    await page.reload();
    const orderedArchivedC = page.locator(`tr[data-basket-row="${itemCId}"]`);
    await expect(orderedArchivedC).toBeVisible();
    await expect(
      orderedArchivedC.locator(".basket-product-state"),
    ).toContainText("Archived — return it to the basket, then remove it");
    await expect(
      orderedArchivedC.locator(`[data-basket-action^="return:"]`),
    ).toHaveCount(1);
    await expect(
      orderedArchivedC.locator(`[data-basket-action^="remove:"]`),
    ).toHaveCount(0);
    await expect(orderedArchivedC.locator("input.basket-quantity")).toHaveCount(
      0,
    );
    await expect(
      orderedArchivedC.locator(`[data-basket-action^="confirm:"]`),
    ).toHaveCount(0);
  });

  test("keeps a failed edit visible for retry and survives API restart with committed rows", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/basket`);
    const rowB = basketRow(page, productB);
    const quantityB = page.locator(`[data-basket-field="quantity:${itemBId}"]`);
    const currentB = requireItem(await readBasketItems(), productB);
    await expect(quantityB).toHaveValue(currentB.quantity);
    const apiQuantity = "7";
    const typedQuantity = "9";
    const bumped = await apiRequest("PUT", reorderItemPath(currentB.id), {
      expectedVersion: currentB.version,
      idempotencyKey: uuidV7(),
      quantity: apiQuantity,
    });
    expect(bumped.status).toBe(200);
    // Pin the conflict at the network layer: whatever version the page holds
    // (a health-poll remount could have refreshed it), the request carries
    // the version from before the API edit, so the server must answer 409.
    const stalePattern = `**${reorderItemPath(currentB.id)}`;
    await page.route(stalePattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.continue({
        postData: JSON.stringify({
          ...body,
          expectedVersion: currentB.version,
        }),
      });
    });
    await quantityB.fill(typedQuantity);
    await expect(quantityB).toBeFocused();
    await pressKeyOnFocused(page, quantityB, "Enter");
    await expect(statusRegion(page)).toHaveText(
      `${productB.displayName} was refreshed. The saved quantity is now ${apiQuantity} Strip.`,
    );
    await page.unroute(stalePattern);
    // load() initializes only unknown quantity ids, so the stale typed value
    // remains visible while the announcement reports the server quantity.
    await expect(quantityB).toHaveValue(typedQuantity);
    await expect(quantityB).toBeFocused();

    await page.route("**/inventory/reorder-basket/items/*", async (route) => {
      if (route.request().method() === "PUT") await route.abort();
      else await route.continue();
    });
    await quantityB.fill("1");
    await expect(quantityB).toBeFocused();
    await pressKeyOnFocused(page, quantityB, "Enter");
    await expect(rowB.locator(".basket-not-saved")).toContainText("Not saved");
    await expect(
      rowB.locator(`[data-basket-retry="${itemBId}"]`),
    ).toBeVisible();
    await expect(statusRegion(page)).toContainText("Not saved");
    await expect(quantityB).toHaveValue("1");
    await expect(quantityB).toBeFocused();
    await page.unroute("**/inventory/reorder-basket/items/*");
    await rowB.locator(`[data-basket-retry="${itemBId}"]`).click();
    await expect(statusRegion(page)).toContainText("Saved 1 Strip");
    await expect(quantityB).toHaveValue("1");
    await expect(quantityB).toBeFocused();
    await expect(rowB.locator(".basket-not-saved")).toHaveCount(0);
    await expect(rowB.locator(`[data-basket-retry="${itemBId}"]`)).toHaveCount(
      0,
    );

    await stopProcess(api);
    api = undefined;
    await expect(
      page.getByRole("heading", { name: "Main unavailable" }),
    ).toBeVisible();
    api = startApi(apiPort);
    await waitForHealth(apiOrigin, "healthy", api);
    await page.reload();
    await expect(page.locator("table.basket-table")).toBeVisible();
    await expect(
      page.locator(`[data-basket-field="quantity:${itemBId}"]`),
    ).toHaveValue("1");
    await expect(basketRow(page, productA)).toHaveCount(0);
    await page.goto(`${renderer.origin}#/basket/ordered`);
    const orderedC = page.locator(`tr[data-basket-row="${itemCId}"]`);
    await expect(orderedC).toBeVisible();
    await expect(orderedC.locator(".basket-ordered-status")).toContainText(
      "Ordered",
    );
  });

  test("enforces employee and custom-role denials in the renderer and API", async ({
    page,
  }) => {
    await login(EMPLOYEE_USERNAME, EMPLOYEE_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/basket`);
    await expect(page.locator("table.basket-table")).toBeVisible();
    await expect(page.locator("[data-basket-action^='confirm:']")).toHaveCount(
      0,
    );
    await page.goto(`${renderer.origin}#/basket/ordered`);
    await expect(page.locator("[data-basket-action^='return:']")).toHaveCount(
      0,
    );
    const orderedItems = await readBasketItems("ordered");
    const orderedC = requireItem(orderedItems, productC);
    const confirmationDenial = await forgeFetch(page, {
      body: {
        expectedVersion: orderedC.version,
        idempotencyKey: uuidV7(),
      },
      path: reorderItemConfirmationsPath(orderedC.id),
    });
    expect(confirmationDenial.status).toBe(403);
    expect(confirmationDenial.body.code).toBe("permission-denied");
    expect(confirmationDenial.body.requestId).toMatch(/^\S+$/u);
    const employeeAudit = await administrator.query<{
      outcome: string;
      required_permission: string;
    }>(
      `select outcome, after_state->>'requiredPermission' as required_permission
       from identity_audit_records
       where id = $1`,
      [confirmationDenial.body.requestId],
    );
    expect(employeeAudit.rows).toEqual([
      {
        outcome: "denied",
        required_permission: "inventory.reorder.confirm",
      },
    ]);

    await login(CUSTOM_USERNAME, CUSTOM_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.reload();
    await page.goto(`${renderer.origin}#/inventory`);
    await expect(page.locator('a[href="#/basket"]')).toHaveCount(0);
    await expect(
      page.locator("[data-review-focus^='inventory-basket-add-']"),
    ).toHaveCount(0);
    const addDenial = await forgeFetch(page, {
      body: { idempotencyKey: uuidV7(), productId: productB.id },
      path: reorderItemsPath(),
    });
    expect(addDenial.status).toBe(403);
    expect(addDenial.body.code).toBe("permission-denied");
    expect(addDenial.body.requestId).toMatch(/^\S+$/u);
    const customAudit = await administrator.query<{
      outcome: string;
      required_permission: string;
    }>(
      `select outcome, after_state->>'requiredPermission' as required_permission
       from identity_audit_records
       where id = $1`,
      [addDenial.body.requestId],
    );
    expect(customAudit.rows).toEqual([
      {
        outcome: "denied",
        required_permission: "inventory.reorder.manage",
      },
    ]);
  });

  test("covers Arabic and English RTL/LTR themes, accessibility, logical order, and video evidence", async ({
    browser,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const videoPath = path.resolve(
      import.meta.dirname,
      "../../../../test-results/issue-57-video/basket-keyboard.webm",
    );
    await mkdir(path.dirname(videoPath), { recursive: true });
    const basketHeaders = {
      ar: [
        "المادة",
        "الرصيد",
        "الحد الأدنى / الأقصى",
        "الاستهلاك لكل 30 يوماً",
        "المخاطر",
        "الكمية",
        "الرصيد المتوقع",
        "الإجراءات",
      ],
      en: [
        "Item",
        "Balance",
        "Minimum / maximum",
        "Consumption / 30 days",
        "Risk",
        "Quantity",
        "Projection",
        "Actions",
      ],
    } as const;
    let englishLightKeyboardOrder: readonly string[] | undefined;
    const orderedHeaders = {
      ar: ["المادة", "الكمية", "الحالة", "تاريخ الطلب", "طلبها", "الإجراءات"],
      en: ["Item", "Quantity", "Status", "Order date", "Ordered by", "Actions"],
    } as const;
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
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/basket`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(
          page.locator("main.shell-page[data-basket-workspace]"),
        ).toBeVisible();
        await expect(page.locator("table.basket-table")).toBeVisible();
        expect(
          (
            await page.locator("table.basket-table thead th").allTextContents()
          ).map((text) => text.trim()),
        ).toEqual(basketHeaders[locale]);
        await expect(
          page.locator(`[data-basket-field="quantity:${itemBId}"]`),
        ).toBeVisible();
        if (theme === "light") {
          const keyboardOrder = await collectBasketKeyboardOrder(page, itemBId);
          if (locale === "en") {
            englishLightKeyboardOrder = keyboardOrder;
          } else {
            expect(keyboardOrder).toEqual(englishLightKeyboardOrder);
          }
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-57",
            "after",
            `basket-${locale}-${theme}.png`,
          ),
        });
        await page.emulateMedia({ forcedColors: "active" });
        expect(
          (
            await new AxeBuilder({ page })
              .disableRules(["color-contrast"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.emulateMedia({ forcedColors: "none" });

        await page.goto(`${renderer.origin}#/basket/ordered`);
        await expect(page.locator("table.basket-ordered-table")).toBeVisible();
        expect(
          (
            await page
              .locator("table.basket-ordered-table thead th")
              .allTextContents()
          ).map((text) => text.trim()),
        ).toEqual(orderedHeaders[locale]);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-57",
            "after",
            `ordered-items-${locale}-${theme}.png`,
          ),
        });

        await page.goto(`${renderer.origin}#/inventory`);
        const gridBasketAction = page.locator(
          `[data-review-focus="inventory-basket-add-${productB.id}"]`,
        );
        await expect(gridBasketAction).toBeVisible();
        await expect(gridBasketAction).toHaveAttribute(
          "aria-label",
          locale === "ar"
            ? `إضافة ${productB.displayName} إلى سلة الطلبات`
            : `Add ${productB.displayName} to the order basket`,
        );
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-57",
            "after",
            `inventory-grid-basket-action-${locale}-${theme}.png`,
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

function statusRegion(page: Page): Locator {
  // The shell also owns a polite status region (support actions); the grid
  // and the basket announce through their visually-hidden one.
  return page.locator('p.visually-hidden[role="status"][aria-live="polite"]');
}

async function collectBasketKeyboardOrder(
  page: Page,
  itemId: string,
): Promise<readonly string[]> {
  const firstRow = page.locator("table.basket-table tbody tr").first();
  const itemLink = firstRow.locator("[data-basket-item-link]");
  const quantity = firstRow.locator(`[data-basket-field="quantity:${itemId}"]`);
  const remove = firstRow.locator(`[data-basket-action="remove:${itemId}"]`);
  const confirm = firstRow.locator(`[data-basket-action="confirm:${itemId}"]`);
  await itemLink.focus();
  await expect(itemLink).toBeFocused();
  const sequence: string[] = [];
  let current = itemLink;
  for (const next of [quantity, remove, confirm]) {
    await pressKeyOnFocused(page, current, "Tab");
    await expect(next).toBeFocused();
    const attribute = await page.evaluate(() => {
      const active = (
        globalThis as unknown as {
          document: {
            activeElement: {
              getAttribute: (name: string) => string | null;
            } | null;
          };
        }
      ).document.activeElement;
      return (
        active?.getAttribute("data-basket-field") ??
        active?.getAttribute("data-basket-action") ??
        active?.getAttribute("data-basket-item-link")
      );
    });
    expect(attribute).not.toBeNull();
    sequence.push(attribute as string);
    current = next;
  }
  return sequence;
}

function basketRow(page: Page, product: Product): Locator {
  return page.locator("table.basket-table tbody tr").filter({
    hasText: product.displayName,
  });
}

function requireItem(
  items: readonly ReorderItem[],
  product: Product,
): ReorderItem {
  const item = items.find((candidate) => candidate.productId === product.id);
  if (item === undefined)
    throw new Error(`No reorder item found for ${product.displayName}`);
  return item;
}

async function readBasketItems(
  status?: "basket" | "ordered",
): Promise<readonly ReorderItem[]> {
  const route =
    status === undefined
      ? reorderBasketPath()
      : `${reorderBasketPath()}?status=${encodeURIComponent(status)}`;
  const response = await apiRequest("GET", route);
  expect(response.status).toBe(200);
  return (response.body as { items: readonly ReorderItem[] }).items;
}

async function forgeFetch(
  page: Page,
  input: { readonly body: unknown; readonly path: string },
): Promise<ForgedResponse> {
  return await page.evaluate(async ({ body, path: requestPath }) => {
    const response = await fetch(requestPath, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return {
      body: (await response.json()) as {
        readonly code?: string;
        readonly requestId?: string;
      },
      status: response.status,
    };
  }, input);
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
    url?.startsWith("/suppliers") === true ||
    url?.startsWith("/purchases/") === true ||
    url?.startsWith("/inventory/") === true
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

async function createProduct(
  name: string,
  stockLevels: ProductCreateRequest["stockLevels"],
  purchasePacks: number,
  purchaseSupplier: Supplier,
): Promise<Product> {
  const response = await apiRequest(
    "POST",
    "/catalog/products",
    productRequest(name, stockLevels),
  );
  expect(response.status).toBe(201);
  const product = response.body as Product;
  if (purchasePacks > 0)
    await postPurchase(
      purchaseSupplier,
      product,
      String(purchasePacks),
      `BASKET-${name}`,
    );
  return product;
}

function productRequest(
  tradeName: string,
  stockLevels: ProductCreateRequest["stockLevels"],
): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار سلة الطلبات",
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
    stockLevels,
  };
}

async function createSupplier(): Promise<Supplier> {
  const response = await apiRequest("POST", "/suppliers", {
    allowanceEffectiveFrom: "2026-01-01",
    defaultAllowancePercentage: "0",
    idempotencyKey: uuidV7(),
    name: "Basket Browser Supplier",
    terms: "Net 30",
  });
  expect(response.status).toBe(201);
  return response.body as Supplier;
}

async function postPurchase(
  purchaseSupplier: Supplier,
  item: Product,
  enteredQuantity: string,
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
    enteredQuantity,
    expectedVersion: draft.version,
    expiryDate: "2029-12-31",
    idempotencyKey: uuidV7(),
    itemId: item.id,
    lotNumber: `${invoiceNumber}-LOT`,
    notes: null,
    pricing: { method: "by-price", retailPriceFils: "999999" },
    unit: { kind: "package-unit", packageUnitName: "Pack" },
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

async function createCustomRoleUser(currentPharmacyId: string): Promise<void> {
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
    name: "Basket Search Review Only",
    permissions: ["catalog.item.search", "inventory.review"],
  });
  expect(role.status).toBe(201);
  const roleId = String((role.body as { id?: string }).id ?? "");
  expect(roleId).toMatch(/^\S+$/u);
  expect(currentPharmacyId).toMatch(/^\S+$/u);
  await createUserForRole(
    roleId,
    CUSTOM_USERNAME,
    CUSTOM_PASSWORD,
    "Basket Search Review Only",
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
