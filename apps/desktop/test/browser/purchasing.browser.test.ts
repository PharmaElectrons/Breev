import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  purchaseAdjustmentDraftPath,
  purchaseAdjustmentPostingsPath,
  purchaseAdjustmentSummaryPath,
  supplierSchema,
  type Product,
  type ProductCreateRequest,
  type PurchaseDraft,
  type PurchasePostResult,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentSummary,
  type PurchaseAdjustmentPostResult,
} from "@breev/contracts/local-rest";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import { pressKeyOnFocused } from "./focus.js";
import { Pool } from "pg";

import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../database-roles.js";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";
const OWNER_PASSWORD = "purchasing browser owner password stays in this test";
let delayNextDraftCreateResponse = false;
let delayNextPurchasePostResponse = false;
let denyNextPostedListResponse = false;
let failNextPostedListResponse = false;
let apiStartupOutput = "";

interface Credentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

interface RendererServer {
  readonly origin: string;
  readonly server: Server;
}

interface PrintLayoutMetrics {
  readonly buttons: number;
  readonly clientWidth: number;
  readonly rootDisplay: string;
  readonly scrollWidth: number;
  readonly sheetTop: number;
  readonly tableWider: boolean;
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
  let purchaseProduct: Product;
  let percentageProduct: Product;
  const evidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/purchases-prototype-alignment/after",
  );
  const rowEvidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/issue-18/after",
  );
  const postingEvidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/issue-50/after",
  );
  const reviewEvidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/issue-51/after",
  );
  const adjustmentEvidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/issue-52/after",
  );
  const returnEvidenceDir = path.resolve(
    import.meta.dirname,
    "../../../../evidence/issue-53/after",
  );

  test.beforeAll(async () => {
    await mkdir(evidenceDir, { recursive: true });
    await mkdir(rowEvidenceDir, { recursive: true });
    await mkdir(postingEvidenceDir, { recursive: true });
    await mkdir(reviewEvidenceDir, { recursive: true });
    await mkdir(adjustmentEvidenceDir, { recursive: true });
    await mkdir(returnEvidenceDir, { recursive: true });
    const administratorUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (
      process.env.BREEV_M2_T01_MANUAL === "1" ||
      process.env.BREEV_M2_T02_MANUAL === "1" ||
      process.env.BREEV_M2_T03_MANUAL === "1"
    ) {
      const manualUrl =
        administratorUrl === undefined ? null : new URL(administratorUrl);
      const manualPort =
        process.env.BREEV_M2_T03_MANUAL === "1" ? "5552" : "5549";
      if (
        manualUrl?.hostname !== "127.0.0.1" ||
        manualUrl.port !== manualPort
      ) {
        throw new Error(
          `The manual fixture requires this task's disposable loopback cluster on port ${manualPort}`,
        );
      }
    }
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
    const product = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/catalog/products",
      medicationRequest("Keyboard Purchase", "5012345678949"),
    );
    expect(product.status).toBe(201);
    purchaseProduct = product.body as Product;
    const percentageRequest = medicationRequest(
      "Percentage Purchase",
      "5012345678956",
    );
    const percentage = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/catalog/products",
      {
        ...percentageRequest,
        pricing: {
          costFils: "80000",
          marginPercentage: "20",
          method: "by-percentage",
          rounding: "off",
          wholesalePriceFils: "90000",
        },
      },
    );
    expect(percentage.status).toBe(201);
    percentageProduct = percentage.body as Product;
    await postPurchaseForReview(
      apiOrigin,
      credentials,
      supplierId,
      purchaseProduct.id,
      "BROWSER-REVIEW-A",
    );
    await postPurchaseForReview(
      apiOrigin,
      credentials,
      supplierId,
      purchaseProduct.id,
      "BROWSER-REVIEW-B",
    );
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
    await expect(page.locator(".purchase-lines-table")).toBeVisible();
    await expect(page.locator(".purchase-draft-table")).toBeHidden();
    await expect(
      page.getByRole("columnheader", { name: "Item name" }),
    ).toBeVisible();

    await page.getByLabel("Invoice date", { exact: true }).fill("2026-08-15");
    const supplier = page.getByRole("combobox", {
      name: "Supplier",
      exact: true,
    });
    await supplier.click();
    await page.getByRole("option", { name: "Al-Nahrain Medical" }).click();
    const invoice = page.getByLabel("Supplier invoice number");
    await invoice.focus();
    await page.keyboard.type("SUP-2026-0042");
    const paymentContext = page.getByRole("combobox", {
      name: /^Payment context/,
    });
    await paymentContext.focus();
    await paymentContext.selectOption("debt");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Save draft" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(
      page.locator(".purchase-snapshot").getByText("2.5%", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Item / Barcode", exact: true }),
    ).toBeFocused();
    await expect(page.getByText("Draft saved and durable.")).toBeVisible();
    await expect(supplier).toHaveValue("Al-Nahrain Medical");

    await page.getByRole("button", { name: "Saved drafts" }).click();
    const search = page.getByRole("searchbox", { name: "Search invoices" });
    await search.fill("SUP-2026-0042");
    await expect(
      page.getByRole("button", {
        name: /SUP-2026-0042/,
      }),
    ).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await search.press("Escape");
    await page.waitForTimeout(50);
    await expect(page.locator(".purchase-discard-dialog")).toBeHidden();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: /Saved drafts/ }).click();
    await search.fill("missing invoice");
    await expect(
      page.getByText("No drafts match these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(search).toHaveValue("");
    await expect(
      page.getByRole("button", {
        name: /SUP-2026-0042/,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /Saved drafts/ }).click();
    await expect(
      page.getByRole("heading", { name: "Saved purchase drafts" }),
    ).toBeFocused();

    await stopProcess(api);
    api = startApi(apiPort, databaseRoles, credentials);
    await waitForHealth(apiOrigin);
    await page.reload();
    await page.getByRole("button", { name: /Saved drafts/ }).click();
    await page.getByRole("button", { name: /SUP-2026-0042/ }).click();
    await expect(invoice).toHaveValue("SUP-2026-0042");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: /Saved drafts/ }).click();
    await expect(
      page.locator('.purchase-open-draft[aria-current="true"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.locator(".purchase-snapshot").getByText("2.5%", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New invoice" }).click();
    await page.getByLabel("Invoice date", { exact: true }).fill("2026-08-15");
    await supplier.click();
    await page.getByRole("option", { name: "Al-Nahrain Medical" }).click();
    await invoice.fill("SUP-2026-0042");
    await page.getByRole("button", { name: "Save draft" }).click();
    const warning = page.getByRole("alert");
    await expect(warning).toContainText("already recorded");
    await expect(warning).toContainText("Current rule: warn");
    await expect(page.getByText("Draft saved and durable.")).toBeVisible();
    // The asynchronous create commits its item-entry focus before accepting
    // another keyboard action from the user.
    await expect(
      page.getByRole("textbox", { name: "Item / Barcode", exact: true }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.locator(".purchase-discard-dialog")).toBeVisible();
    await page
      .locator(".purchase-discard-dialog")
      .getByRole("button", { name: "Close" })
      .click();
    await expect(
      page.locator(".purchase-snapshot").getByText("2.5%", { exact: true }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".purchase-discard-dialog")).toBeVisible();
    await page
      .locator(".purchase-discard-dialog")
      .getByRole("button", { name: "Discard draft" })
      .click();
    await expect(
      page.getByText("Draft discarded after confirmation."),
    ).toBeVisible();

    // Verify post-discard state: placeholder shows helpful prompt and invoice number is focused
    await expect(
      page.getByText(
        "Enter supplier invoice number and select supplier, then press Enter to start adding items.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start adding items ↵" }),
    ).toBeVisible();
    await expect(invoice).toBeFocused();

    // Re-enter new invoice seamlessly via keyboard: Enter moves to supplier, Enter creates draft and focuses table
    await invoice.fill("SUP-2026-RECOVER");
    await invoice.press("Enter");
    await expect(supplier).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Draft saved and durable.")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Item / Barcode", exact: true }),
    ).toBeFocused();
  });

  test("enters durable rows by scanner and Enter, quick-creates a Product, and follows persisted column order", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      recordVideo: {
        dir: path.resolve(
          import.meta.dirname,
          "../../../../test-results/issue-18-video",
        ),
        size: { height: 768, width: 1024 },
      },
    });
    const page = await context.newPage();
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await page.getByRole("button", { name: "New invoice" }).click();
    await page.getByRole("combobox", { name: "Supplier", exact: true }).click();
    await page.getByRole("option", { name: "Al-Nahrain Medical" }).click();
    await page.getByLabel("Supplier invoice number").fill("ROWS-49");
    await page.getByLabel("Invoice date", { exact: true }).fill("2026-09-07");
    await page.getByRole("button", { name: "Save draft" }).click();

    const item = page.getByRole("textbox", {
      name: "Item / Barcode",
      exact: true,
    });
    const quantity = page.getByRole("spinbutton", {
      name: "Quantity",
      exact: true,
    });
    const cost = page.getByRole("spinbutton", {
      name: "Primary cost",
      exact: true,
    });
    const sellingPrice = page.getByRole("spinbutton", {
      name: "Selling price",
      exact: true,
    });
    const expiry = page.getByRole("textbox", {
      name: "Expiry",
      exact: true,
    });
    await expect(item).toBeFocused();
    await item.fill("5012345678949");
    await item.press("Enter");
    await expect(quantity).toBeFocused();
    await expect(
      page.locator("aside.purchase-item-panel .purchase-item-trade-name"),
    ).toHaveText(purchaseProduct.displayName);

    // The item-details panel is the only surface that carries the wholesale
    // price, so it has to be readable while the row is being typed. Finding it
    // in the DOM is not enough: it has to be on screen without scrolling the
    // row table sideways or the page down, at the packaged window's default
    // inner size as well as the verification viewports.
    const panel = page.locator("aside.purchase-item-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expect(panel.locator("strong")).toHaveText(
      purchaseProduct.displayName,
    );
    await expect(panel.locator("dl > div dd")).toHaveText([
      "Paracetamol",
      "Pain relief",
      "Strip · Pack × 4",
      "90000",
    ]);
    await expect(page.locator("table.purchase-row-table")).not.toContainText(
      "90000",
    );
    // The empty state is not merely hidden while an item is selected: there is
    // only one panel now, so its placeholder is not in the document at all.
    await expect(page.locator(".purchase-item-empty")).toHaveCount(0);
    for (const viewport of [
      { height: 658, width: 1066 },
      { height: 800, width: 1280 },
      { height: 768, width: 1024 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expect(
        panel.locator(".purchase-fact-row:nth-child(3) .purchase-fact-value"),
      ).toBeInViewport({ ratio: 1 });
      // Polled: a resize relayouts asynchronously, so a single read can catch
      // the previous layout.
      await expect
        .poll(() =>
          page.evaluate<boolean>(
            "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
          ),
        )
        .toBe(true);
    }

    await quantity.fill("0");
    await quantity.press("Enter");
    await expect(quantity).toBeFocused();
    await expect(page.getByRole("alert")).toContainText(
      "positive whole quantity",
    );
    await quantity.fill("2");
    await quantity.press("Enter");
    await expect(cost).toBeFocused();
    await cost.fill("80000");
    await cost.press("Enter");
    await expect(sellingPrice).toBeFocused();
    await sellingPrice.fill("120000");
    await sellingPrice.press("Enter");
    await expect(expiry).toBeFocused();
    let postRequests = 0;
    page.on("request", (request) => {
      if (/\/post(?:ings)?$/u.test(new URL(request.url()).pathname))
        postRequests += 1;
    });
    await expiry.fill("2028-10-31");
    await expiry.press("Enter");
    await expect(
      page.getByText("Row committed and saved durably."),
    ).toBeVisible();
    await expect(item).toBeFocused();
    expect(postRequests).toBe(0);
    await expect(
      page.getByRole("button", { name: "Post purchase" }),
    ).toBeEnabled();
    await expect(page.locator(".purchase-review")).toContainText("160000");
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(2);

    // The base-unit preview is the last column, and it carries the scenario the
    // pharmacy actually buys by: two Packs of four record eight Strips. A column
    // that can only be reached by dragging a horizontal scrollbar is a column
    // nobody reads, so its position is asserted, not just its text.
    await item.fill("5012345678949");
    await item.press("Enter");
    await expect(quantity).toBeFocused();
    const committedBaseUnits = page.locator(
      '.purchase-row-table tbody tr:not(.purchase-entry-row) [data-column-field="inventory-units"]',
    );
    const entryBaseUnits = page.locator(
      '.purchase-entry-row [data-column-field="inventory-units"]',
    );
    await expect(committedBaseUnits.last()).toHaveText("8 Strip");
    await expect(entryBaseUnits).toHaveText("4 Strip");
    for (const viewport of [
      { height: 768, width: 1024 },
      { height: 658, width: 1066 },
      { height: 800, width: 1280 },
    ]) {
      await page.setViewportSize(viewport);
      await expectWorkspaceSectionsStacked(page);
      await expectBaseUnitColumnOnScreen(entryBaseUnits);
      await expectBaseUnitColumnOnScreen(committedBaseUnits.last());
    }
    await page.setViewportSize({ height: 768, width: 1024 });

    await item.fill("5012345678956");
    await item.press("Enter");
    await expect(
      page.locator("aside.purchase-item-panel .purchase-item-trade-name"),
    ).toHaveText(percentageProduct.displayName);
    await quantity.press("Enter");
    await cost.fill("80000");
    await cost.press("Enter");
    await expect(expiry).toBeFocused();
    await expect(sellingPrice).toHaveJSProperty("readOnly", true);
    await expect(sellingPrice).toHaveValue("100000");
    await expiry.press("Enter");
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(3);

    await item.fill("UNKNOWN PRODUCT");
    await item.press("Enter");
    const quickDialog = page.getByRole("dialog", {
      name: "Quick Product creation",
    });
    await expect(quickDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(quickDialog).toBeHidden();
    await expect(item).toBeFocused();
    await expect(item).toHaveValue("UNKNOWN PRODUCT");
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(3);

    await item.fill("5901234123457");
    await item.press("Enter");
    await expect(quickDialog).toBeVisible();
    await quickDialog.getByLabel("Trade name *").fill("Quick Purchase Product");
    await quickDialog.getByLabel("Inventory Unit (base unit) *").fill("Piece");
    await quickDialog.getByLabel("Retail price (fils) *").fill("250000");
    await quickDialog.getByRole("button", { name: "Create product" }).click();
    await expect(quickDialog).toBeHidden();
    await expect(item).toBeFocused();
    await expect(item).toHaveValue("Quick Purchase Product");
    await item.press("Enter");
    await quantity.fill("1");
    await quantity.press("Enter");
    await cost.fill("100000");
    await cost.press("Enter");
    await sellingPrice.press("Enter");
    await expiry.press("Enter");
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(4);

    const settings = page.locator(".purchase-entry-settings");
    await settings.locator("summary").click();
    const sellingSetting = settings.locator("li", { hasText: "Selling price" });
    await sellingSetting.getByRole("checkbox").uncheck();
    await settings
      .getByRole("button", { name: "Move earlier: Expiry" })
      .click();
    await settings
      .getByRole("button", { name: "Move earlier: Quantity" })
      .click();
    await settings
      .getByRole("button", { name: "Move earlier: Expiry" })
      .click();
    await settings.getByRole("button", { name: "Save entry settings" }).click();
    await expect(
      page.getByRole("region", { name: "Invoice rows" }).getByRole("status"),
    ).toHaveText("Purchase entry settings saved.");
    await expect(page.locator(".purchase-row-table thead th")).toHaveText([
      "#",
      "Quantity",
      "Item / Barcode",
      "Expiry",
      "Primary cost",
      "Inventory Units",
      "Actions",
    ]);

    await page.reload();
    await page
      .getByRole("button", { name: "Saved drafts", exact: true })
      .click();
    await page.getByRole("button", { name: /ROWS-49/ }).click();
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(4);
    await expect(quantity).toBeFocused();
    await quantity.press("Enter");
    const resumedItem = page.getByRole("textbox", {
      name: "Item / Barcode",
      exact: true,
    });
    await expect(resumedItem).toBeFocused();
    await resumedItem.fill("5012345678949");
    await resumedItem.press("Enter");
    await expect(expiry).toBeFocused();
    await expiry.press("Enter");
    await expect(cost).toBeFocused();
    await cost.press("Enter");
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(5);
    await expect(quantity).toBeFocused();

    const currentPreferences = await apiRequest(
      apiOrigin,
      credentials,
      "GET",
      "/purchases/entry-preferences",
    );
    const revision = String(
      (currentPreferences.body as { revision: string }).revision,
    );
    expect(
      (
        await apiRequest(
          apiOrigin,
          credentials,
          "PUT",
          "/purchases/entry-preferences",
          {
            afterCommit: "new-row",
            columns: [
              { field: "quantity", visible: true },
              { field: "cost", visible: true },
              { field: "selling-price", visible: true },
              { field: "expiry", visible: true },
              { field: "item", visible: true },
            ],
            detailsPanelFields: [
              "scientific-name",
              "category",
              "packaging",
              "wholesale-price",
            ],
            expectedRevision: revision,
            idempotencyKey: uuidV7(),
          },
        )
      ).status,
    ).toBe(200);
    await page.reload();
    await page
      .getByRole("button", { name: "Saved drafts", exact: true })
      .click();
    await page.getByRole("button", { name: /ROWS-49/ }).click();
    await expect(page.locator(".purchase-row-table thead th")).toHaveText([
      "#",
      "Quantity",
      "Primary cost",
      "Selling price",
      "Expiry",
      "Item / Barcode",
      "Inventory Units",
      "Actions",
    ]);
    await expect(quantity).toBeFocused();
    await quantity.press("Enter");
    await cost.press("Enter");
    await sellingPrice.fill("120000");
    await sellingPrice.press("Enter");
    await expiry.press("Enter");
    await expect(resumedItem).toBeFocused();
    await resumedItem.fill("5012345678949");
    await resumedItem.press("Enter");
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(6);
    await expect(quantity).toBeFocused();

    const itemLastPreferences = await apiRequest(
      apiOrigin,
      credentials,
      "GET",
      "/purchases/entry-preferences",
    );
    const itemLastRevision = String(
      (itemLastPreferences.body as { revision: string }).revision,
    );
    expect(
      (
        await apiRequest(
          apiOrigin,
          credentials,
          "PUT",
          "/purchases/entry-preferences",
          {
            afterCommit: "new-row",
            columns: [
              { field: "item", visible: true },
              { field: "quantity", visible: true },
              { field: "cost", visible: true },
              { field: "selling-price", visible: true },
              { field: "expiry", visible: true },
            ],
            detailsPanelFields: [
              "scientific-name",
              "category",
              "packaging",
              "wholesale-price",
            ],
            expectedRevision: itemLastRevision,
            idempotencyKey: uuidV7(),
          },
        )
      ).status,
    ).toBe(200);
    const video = page.video();
    await context.close();
    await video?.saveAs(path.join(rowEvidenceDir, "keyboard-row-loop.webm"));
  });

  test("is accessible in Arabic RTL and English LTR in both themes", async ({
    browser,
  }) => {
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { width: 1366, height: 768 },
        });
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
        await expect
          .poll(() =>
            page.evaluate<boolean>(
              "['IBM Plex Sans Arabic', 'JetBrains Mono'].every(family => Array.from(document.fonts).some(font => font.family.includes(family) && font.status === 'loaded'))",
            ),
          )
          .toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await expect(
          page.getByRole("button", {
            name: locale === "ar" ? "حفظ المسودة" : "Save draft",
            exact: true,
          }),
        ).toBeInViewport();
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: path.join(
            evidenceDir,
            `purchase-header-${locale}-${theme}.png`,
          ),
        });
        await page
          .getByRole("button", { name: /Saved drafts|المسودات المحفوظة/ })
          .click();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: path.join(
            evidenceDir,
            `purchase-register-${locale}-${theme}.png`,
          ),
        });
        await page.getByRole("button", { name: /SUP-2026-0042/ }).click();
        await expect(page.locator(".purchase-snapshot")).toBeVisible();
        const entryFields = page.locator(
          ".purchase-entry-row [data-enter-field]",
        );
        await expect(entryFields).toHaveCount(5);
        expect(
          await entryFields.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-enter-field")),
          ),
        ).toEqual(["item", "quantity", "cost", "selling-price", "expiry"]);

        // The panel used to sit inside the row table's horizontal overflow,
        // which put it at a negative inline offset in RTL. Its position is now
        // asserted in both directions and both themes.
        const entryItem = entryFields.nth(0);
        await entryItem.fill("5012345678949");
        await entryItem.press("Enter");
        const itemPanel = page.locator("aside.purchase-item-panel");
        const entryBaseUnits = page.locator(
          '.purchase-entry-row [data-column-field="inventory-units"]',
        );
        const committedBaseUnits = page.locator(
          '.purchase-row-table tbody tr:not(.purchase-entry-row) [data-column-field="inventory-units"]',
        );
        const expectedBaseUnits = locale === "ar" ? "4 أشرطة" : "4 Strip";
        await expect(entryBaseUnits).toHaveText(expectedBaseUnits);
        await expect(itemPanel).toBeVisible();
        // The first three viewports use the narrow band layout below 80rem;
        // the final viewport verifies the fixed side panel above that
        // breakpoint.
        for (const viewport of [
          { height: 658, width: 1066 },
          { height: 800, width: 1280 },
          { height: 768, width: 1024 },
          { height: 768, width: 1366 },
        ]) {
          await page.setViewportSize(viewport);
          await expect(itemPanel).toBeInViewport({ ratio: 1 });
          await expect(
            itemPanel.locator(
              ".purchase-fact-row:nth-child(3) .purchase-fact-value",
            ),
          ).toBeInViewport({ ratio: 1 });
          // The base-unit preview column, in this direction and theme.
          await expectWorkspaceSectionsStacked(page);
          await expectBaseUnitColumnOnScreen(entryBaseUnits);
          await expect
            .poll(() =>
              page.evaluate<boolean>(
                "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
              ),
            )
            .toBe(true);
        }
        await expect(itemPanel.locator(".purchase-item-trade-name")).toHaveText(
          purchaseProduct.displayName,
        );
        await expect(itemPanel.locator("dl > div dd")).toHaveCount(4);
        for (const value of ["Paracetamol", "Pain relief", "Strip", "90000"]) {
          await expect(itemPanel).toContainText(value);
        }
        await expect(page.locator(".purchase-item-empty")).toHaveCount(0);
        await expect(
          page.locator("table.purchase-row-table"),
        ).not.toContainText("90000");
        // The populated panel is its own accessibility surface: a landmark, a
        // heading and a description list that only exists once an item is
        // selected, so it is scanned in that state and not only while empty.
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await expect(
          page.getByRole("button", {
            name: locale === "ar" ? "حفظ التغييرات" : "Save changes",
            exact: true,
          }),
        ).toBeInViewport();
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: path.join(
            evidenceDir,
            `purchase-selected-${locale}-${theme}.png`,
          ),
        });
        // A committed row's base-unit cell has to be placed too, and it gets its
        // own draft per pass rather than a row committed into the shared one:
        // the screenshot above is taken from that shared draft, and all four
        // passes have to photograph the same invoice for the images to compare
        // like for like. One Pack of four records four Strips.
        const unitsInvoice = `BILINGUAL-UNITS-${locale}-${theme}`;
        const unitsDraft = await apiRequest(
          apiOrigin,
          credentials,
          "POST",
          "/purchases/drafts",
          {
            idempotencyKey: uuidV7(),
            invoiceDate: "2026-09-08",
            invoiceOffer: { mode: "none", value: "0" },
            settlementContext: "cash",
            supplierId,
            supplierInvoiceNumber: unitsInvoice,
          },
        );
        expect(unitsDraft.status).toBe(201);
        const unitsHeader = (unitsDraft.body as { draft: PurchaseDraft }).draft;
        expect(
          (
            await apiRequest(
              apiOrigin,
              credentials,
              "POST",
              purchaseDraftRowsPath(unitsHeader.id),
              {
                costFils: "80000",
                enteredQuantity: "1",
                expectedVersion: unitsHeader.version,
                expiryDate: "2029-05-31",
                idempotencyKey: uuidV7(),
                itemId: purchaseProduct.id,
                lotNumber: "BILINGUAL-UNITS",
                notes: null,
                pricing: { method: "by-price", retailPriceFils: "120000" },
                unit: { kind: "package-unit", packageUnitName: "Pack" },
              },
            )
          ).status,
        ).toBe(201);
        // The register renders the draft list the renderer loaded at mount, so
        // a draft created over REST since then is only reachable after a reload.
        await page.reload();
        await page
          .getByRole("button", { name: /Saved drafts|المسودات المحفوظة/ })
          .click();
        await page
          .getByRole("button", { name: new RegExp(unitsInvoice) })
          .click();
        await expect(committedBaseUnits.last()).toHaveText(
          locale === "ar" ? "4 أشرطة" : "4 Strip",
        );
        for (const viewport of [
          { height: 768, width: 1024 },
          { height: 658, width: 1066 },
          { height: 800, width: 1280 },
        ]) {
          await page.setViewportSize(viewport);
          await expectWorkspaceSectionsStacked(page);
          await expectBaseUnitColumnOnScreen(committedBaseUnits.last());
        }
        await page.setViewportSize({ height: 768, width: 1366 });

        await page
          .getByRole("button", {
            name: locale === "ar" ? "الموردون" : "Suppliers",
            exact: true,
          })
          .click();
        await expect(page.locator("#purchase-invoice-view")).toBeHidden();
        await expect(page.locator(".supplier-manager")).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: path.join(
            evidenceDir,
            `purchase-suppliers-${locale}-${theme}.png`,
          ),
        });
        await context.close();
      }
    }
  });

  test("switches to suppliers and back without losing either form", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await page.getByLabel("Supplier invoice number").fill("UNSAVED-HEADER");
    await page.getByRole("combobox", { name: "Supplier", exact: true }).click();
    await page.getByRole("option", { name: "Al-Nahrain Medical" }).click();
    const suppliersView = page.getByRole("button", {
      name: "Suppliers",
      exact: true,
    });
    await suppliersView.focus();
    await page.keyboard.press("Enter");
    await expect(suppliersView).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Supplier invoice number")).toBeHidden();
    await page
      .getByLabel("Supplier name", { exact: true })
      .fill("Unfinished supplier");
    await page
      .getByRole("button", { name: "Purchase invoice", exact: true })
      .click();
    await expect(page.getByLabel("Supplier invoice number")).toHaveValue(
      "UNSAVED-HEADER",
    );
    await expect(
      page.getByRole("combobox", { name: "Supplier", exact: true }),
    ).toHaveValue("Al-Nahrain Medical");
    await suppliersView.click();
    await expect(page.getByLabel("Supplier name", { exact: true })).toHaveValue(
      "Unfinished supplier",
    );
  });

  test("quarantines later accounting, report, OCR, and legal-print surfaces", async ({
    page,
  }) => {
    for (const locale of ["en", "ar"] as const) {
      await page.goto("about:blank");
      await installDesktopFake(page, renderer.origin, locale, "light");
      await page.goto(`${renderer.origin}#/purchases`);

      const labels =
        locale === "en"
          ? {
              account: "Accounts",
              accountStatement: "Account statement",
              adjustment: "Edit Invoice",
              importImage: "Import from image",
              invoiceLedger: "Invoice transaction ledger",
              liveBalance: "Live balance",
              printInvoice: "Print invoice",
              printReturn: "Print return slip",
              profile: "Supplier profile",
              reports: "Reports",
              purchaseReturn: "Purchase return",
              suppliers: "Suppliers",
            }
          : {
              account: "الحسابات",
              accountStatement: "كشف حساب",
              adjustment: "تعديل الفاتورة",
              importImage: "استيراد من صورة",
              invoiceLedger: "تفاصيل حركة الفواتير",
              liveBalance: "ديون المذخر (تلقائية)",
              printInvoice: "طباعة الفاتورة",
              printReturn: "طباعة فاتورة المرتجع",
              profile: "بيانات المذخر",
              reports: "التقارير",
              purchaseReturn: "فاتورة مردود",
              suppliers: "الموردون",
            };

      await expect(
        page.getByRole("link", { name: labels.reports, exact: true }),
      ).toHaveCount(0);
      await page.getByTestId("collapse-menu-trigger").click();
      await expect(
        page.getByRole("link", { name: labels.account, exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: labels.importImage, exact: true }),
      ).toHaveCount(0);

      await page
        .getByRole("button", { name: labels.suppliers, exact: true })
        .click();
      const supplierWorkspace = page.locator(".supplier-manager");
      await expect(supplierWorkspace.getByText(labels.profile)).toBeVisible();
      await expect(
        supplierWorkspace.getByText(labels.accountStatement, { exact: true }),
      ).toHaveCount(0);
      await expect(
        supplierWorkspace.getByText(labels.invoiceLedger, { exact: true }),
      ).toHaveCount(0);
      await expect(
        supplierWorkspace.getByText(labels.liveBalance, { exact: true }),
      ).toHaveCount(0);

      await postedInvoicesTab(page).click();
      const postedView = page.locator("#purchase-posted-view");
      await postedView
        .getByRole("button", {
          name: locale === "en" ? /Open invoice P/u : /فتح الفاتورة P/u,
        })
        .first()
        .click();
      await expect(
        postedView.getByRole("button", {
          name: labels.printInvoice,
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        postedView.getByRole("button", {
          name: labels.printReturn,
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        postedView.getByRole("button", {
          name: labels.adjustment,
        }),
      ).toBeVisible();
      await expect(
        postedView.getByRole("button", {
          name: labels.purchaseReturn,
        }),
      ).toBeVisible();
    }
  });

  test("contains wide and narrow layouts without document overflow", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);

    for (const viewport of [
      { height: 768, width: 1366 },
      { height: 800, width: 900 },
      { height: 800, width: 560 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(
        page.getByRole("heading", { name: "Purchases" }),
      ).toBeVisible();
      const dimensions = await page.evaluate<{
        scrollWidth: number;
        clientWidth: number;
      }>(
        "({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })",
      );
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );
    }

    const tableRegion = page.getByRole("group", {
      name: "Scrollable invoice items table",
    });
    expect(
      await tableRegion.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    await tableRegion.focus();
    await expect(tableRegion).toBeFocused();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.evaluate("document.documentElement.style.fontSize = '200%'");
    expect(
      await page.evaluate<boolean>(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Save draft", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeInViewport();
  });

  test("keeps connection details reachable and hides unentitled OCR", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await expect(page.getByLabel("Supplier invoice number")).toBeVisible();
    const menu = page.getByTestId("collapse-menu-dropdown");
    await expect(menu).toBeHidden();
    await page.getByTestId("collapse-menu-trigger").focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("shell-state")).toHaveText("Ready");
    await expect(menu.getByRole("button", { name: "Check now" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Import from image" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Item / Barcode", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Print invoice", exact: true }),
    ).toHaveCount(0);
  });

  test("retries an uncertain draft creation without creating a duplicate", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await page.getByRole("combobox", { name: "Supplier", exact: true }).click();
    await page.getByRole("option", { name: "Al-Nahrain Medical" }).click();
    await page.getByLabel("Supplier invoice number").fill("TIMEOUT-RETRY-1");
    await page.getByLabel("Invoice date", { exact: true }).fill("2026-08-15");

    delayNextDraftCreateResponse = true;
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/The change was not saved/)).toBeVisible({
      timeout: 7_000,
    });
    await page.getByRole("button", { name: "Save draft" }).click();
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

  test("posts only from the explicit action and shows the immutable server result", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await createPurchaseWithOneRow(
      page,
      renderer.origin,
      supplierId,
      "POST-ATOMIC-1",
      "2029-05-31",
    );

    const post = page.getByRole("button", { name: "Post purchase" });
    await expect(post).toBeEnabled();
    await post.focus();
    await page.keyboard.press("Enter");

    const receipt = page.locator(".posted-purchase-result");
    await expect(
      receipt.getByRole("heading", { name: "Posted purchase" }),
    ).toBeVisible();
    await expect(receipt).toContainText("POST-ATOMIC-1");
    await expect(receipt).toContainText("inventory");
    await expect(receipt).toContainText("Cash / Drawer");
    await expect(receipt).toContainText("Lot");
    await expect(receipt).toContainText("Expiry");
    await expect(page.getByLabel("Supplier invoice number")).toHaveValue("");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(postingEvidenceDir, "posted-purchase-en-light.png"),
    });
  });

  test("replays the same posting after a timeout and renderer reload exactly once", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "ar", "dark");
    await createPurchaseWithOneRow(
      page,
      renderer.origin,
      supplierId,
      "POST-RELOAD-1",
      "2029-06-30",
      "ar",
    );

    delayNextPurchasePostResponse = true;
    await page.getByRole("button", { name: "حفظ الفاتورة" }).click();
    await expect(page.getByText(/تعذر تأكيد النتيجة/)).toBeVisible({
      timeout: 7_000,
    });
    await page.reload();

    const receipt = page.locator(".posted-purchase-result");
    await expect(
      receipt.getByRole("heading", { name: "فاتورة شراء محفوظة" }),
    ).toBeVisible();
    await expect(receipt).toContainText("POST-RELOAD-1");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const administrator = new Pool({
      connectionString: databaseRoles.migrationUrl,
    });
    try {
      const counts = await administrator.query<{
        batches: string;
        journals: string;
        movements: string;
        postings: string;
      }>(
        `select
           count(distinct posted.id)::text as postings,
           count(distinct batch.id)::text as batches,
           count(distinct movement.id)::text as movements,
           count(distinct journal.id)::text as journals
         from posted_purchases posted
         join posted_purchase_rows posted_row on posted_row.posted_purchase_id = posted.id
         join inventory_batches batch on batch.id = posted_row.batch_id
         join inventory_movements movement on movement.id = posted_row.movement_id
         join accounting_journal_entries journal on journal.id = posted.journal_entry_id
         where posted.supplier_invoice_number = $1`,
        ["POST-RELOAD-1"],
      );
      expect(counts.rows[0]).toEqual({
        batches: "1",
        journals: "1",
        movements: "1",
        postings: "1",
      });
    } finally {
      await administrator.end();
    }

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: path.join(postingEvidenceDir, "posted-purchase-ar-dark.png"),
    });
  });

  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`binds Adjustment confirmation to saved evidence and recovers stale/restart/timeout attempts ${locale} ${theme}`, async ({
        page,
      }) => {
        const invoice = `BROWSER-CONFIRM-${locale}-${theme}`;
        const original = await postPurchaseForReview(
          apiOrigin,
          credentials,
          supplierId,
          purchaseProduct.id,
          invoice,
        );
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`${renderer.origin}#/purchases`);
        await postedInvoicesTab(page).click();
        const review = page.locator("#purchase-posted-view");
        const search = review.getByRole("searchbox");
        await search.fill(invoice);
        await search.press("Enter");
        await review
          .locator(".posted-purchase-list tbody tr")
          .first()
          .getByRole("button")
          .first()
          .click();
        await review
          .getByRole("button", {
            name: locale === "en" ? "Edit Invoice" : "تعديل الفاتورة",
          })
          .click();
        const create =
          locale === "en" ? "Create adjustment copy" : "إنشاء نسخة التعديل";
        const save =
          locale === "en" ? "Save and review Delta" : "حفظ ومراجعة الفرق";
        const confirm =
          locale === "en" ? "Confirm and post Delta" : "تأكيد وحفظ التعديل";
        await review.getByRole("button", { name: create }).click();
        await expect(review.getByRole("button", { name: create })).toHaveCount(
          0,
        );
        const headerEvidence = `Header evidence before quantity ${locale} ${theme}`;
        const headerEvidenceInput = review.getByRole("textbox", {
          name: locale === "en" ? "Reason evidence" : "دليل السبب",
          exact: true,
        });
        await headerEvidenceInput.pressSequentially(headerEvidence);
        await review
          .getByRole("textbox", {
            name: `${locale === "en" ? "Quantity" : "كمية"} ${purchaseProduct.displayName}`,
          })
          .fill("8");
        await expect(headerEvidenceInput).toHaveValue(headerEvidence);
        const summaries: PurchaseAdjustmentSummary[] = [];
        page.on("response", (response) => {
          if (response.url().endsWith("/summary") && response.ok()) {
            void response
              .json()
              .then((summary: PurchaseAdjustmentSummary) =>
                summaries.push(summary),
              );
          }
        });
        await review.getByRole("button", { name: save }).click();
        const summaryDialog = review.locator(".delta-summary-dialog");
        const confirmButton = summaryDialog.getByRole("button", {
          name: confirm,
        });
        await expect(confirmButton).toBeEnabled();
        await expect.poll(() => summaries.length).toBe(1);
        const first = summaries[0]!;
        expect(first.evidence).toBe(headerEvidence);
        // Manual A restarts after the first Save, before any summary edit.
        // Assert that exact boundary independently of the later re-save flow.
        await stopProcess(api);
        api = startApi(apiPort, databaseRoles, credentials);
        await waitForHealth(apiOrigin);
        await page.reload();
        await review
          .getByRole("button", {
            name: locale === "en" ? "Continue draft" : "متابعة المسودة",
          })
          .click();
        await expect(headerEvidenceInput).toHaveValue(headerEvidence);
        await expect(
          review.getByRole("combobox", {
            name: locale === "en" ? "Reason" : "السبب",
            exact: true,
          }),
        ).toHaveValue("quantity error");
        await review.getByRole("button", { name: save }).click();
        await expect(confirmButton).toBeEnabled();
        await expect.poll(() => summaries.length).toBe(2);
        expect(summaries[1]!.evidence).toBe(headerEvidence);
        const finalEvidence = `Final invoice evidence ${locale} ${theme}`;
        await summaryDialog.getByRole("textbox").fill(finalEvidence);
        await expect(confirmButton).toBeDisabled();
        await expect(summaryDialog.getByRole("status")).toBeVisible();
        const savedBefore = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          purchaseAdjustmentDraftPath(first.draftId),
        );
        expect((savedBefore.body as PurchaseAdjustmentDraft).evidence).toBe(
          headerEvidence,
        );
        await summaryDialog.getByRole("button", { name: save }).click();
        await expect(confirmButton).toBeEnabled();
        await expect.poll(() => summaries.length).toBe(3);
        expect(summaries[2]!.confirmationHash).not.toBe(first.confirmationHash);
        expect(summaries[2]!.evidence).toBe(finalEvidence);

        // Restart both API and renderer, as in manual case A, rather than
        // relying on the renderer's in-memory evidence or summary.
        await stopProcess(api);
        api = startApi(apiPort, databaseRoles, credentials);
        await waitForHealth(apiOrigin);
        await page.reload();
        await review
          .getByRole("button", {
            name: locale === "en" ? "Continue draft" : "متابعة المسودة",
          })
          .click();
        await expect(
          review.locator(".adjustment-banner-reason-input"),
        ).toHaveValue(finalEvidence);
        await review.getByRole("button", { name: save }).click();
        await expect(confirmButton).toBeEnabled();
        await expect.poll(() => summaries.length).toBe(4);
        const displayed = summaries[3]!;
        const loaded = (
          await apiRequest(
            apiOrigin,
            credentials,
            "GET",
            purchaseAdjustmentDraftPath(displayed.draftId),
          )
        ).body as PurchaseAdjustmentDraft;
        const concurrentEvidence = `Concurrent verified evidence ${locale} ${theme}`;
        const edited = await apiRequest(
          apiOrigin,
          credentials,
          "PUT",
          purchaseAdjustmentDraftPath(loaded.id),
          {
            evidence: concurrentEvidence,
            reason: loaded.reason,
            invoiceOffer: loaded.invoiceOffer,
            supplierId: loaded.supplierId,
            supplierInvoiceNumber: loaded.supplierInvoiceNumber,
            expectedVersion: loaded.version,
            idempotencyKey: uuidV7(),
            rows: loaded.rows.map((row) => ({
              costFils: row.costFils,
              enteredQuantity: row.enteredQuantity,
              expiryDate: row.expiryDate,
              itemId: row.itemId,
              lineageId: row.lineageId,
              lotNumber: row.lotNumber,
              notes: row.notes,
              originalRowId: row.originalRowId,
              unit: row.unit,
              pricing:
                row.pricingMethod === "by-price"
                  ? { method: "by-price", retailPriceFils: row.retailPriceFils }
                  : {
                      method: "by-percentage",
                      marginPercentage: row.marginPercentage,
                    },
            })),
          },
        );
        expect(edited.status).toBe(200);
        await confirmButton.click();
        await expect(confirmButton).toBeDisabled();
        await expect(review.getByRole("alert")).toContainText(
          locale === "en" ? "Posting conflict" : "تعارض",
        );
        await expect(summaryDialog.getByRole("alert")).toBeVisible();
        await expect(summaryDialog.getByRole("alert")).toBeFocused();
        await summaryDialog
          .getByRole("button", {
            name:
              locale === "en"
                ? "Reload saved adjustment"
                : "إعادة تحميل مسودة التعديل المحفوظة",
          })
          .click();
        await expect(
          review.locator(".adjustment-banner-reason-input"),
        ).toHaveValue(concurrentEvidence);
        await review.getByRole("button", { name: save }).click();
        await expect(confirmButton).toBeEnabled();
        await expect.poll(() => summaries.length).toBe(5);
        const accepted = summaries[4]!;
        expect(accepted.evidence).toBe(concurrentEvidence);
        expect(
          (
            await new AxeBuilder({ page })
              .include(".delta-summary-dialog")
              .analyze()
          ).violations,
        ).toEqual([]);
        const evidenceDir = path.resolve(
          import.meta.dirname,
          "../../../../evidence/issue-198/t02/confirmation-screenshots",
        );
        await mkdir(evidenceDir, { recursive: true });
        for (const viewport of [
          { width: 1280, height: 800 },
          { width: 1366, height: 768 },
        ]) {
          await page.setViewportSize(viewport);
          await expect(confirmButton).toBeInViewport();
          await summaryDialog.screenshot({
            animations: "disabled",
            path: path.join(
              evidenceDir,
              `summary-${locale}-${theme}-${viewport.width}x${viewport.height}.png`,
            ),
          });
        }
        await page.setViewportSize({ width: 640, height: 800 });
        await expect(confirmButton).toBeInViewport();
        await page.setViewportSize({ width: 1280, height: 800 });
        // Serve the test stylesheet from the renderer's own origin so the
        // text-size check respects its production CSP.
        await page.route("**/t01-text-zoom.css", (route) =>
          route.fulfill({
            contentType: "text/css",
            body: "html { font-size: 200%; }",
          }),
        );
        const enlargedText = await page.addStyleTag({
          url: `${renderer.origin}/t01-text-zoom.css`,
        });
        await expect(confirmButton).toBeInViewport();
        await enlargedText.evaluate((element) => element.remove());
        const attempts: unknown[] = [];
        let loseResponse = true;
        let posted: PurchaseAdjustmentPostResult | undefined;
        await page.route(
          `**${purchaseAdjustmentPostingsPath(accepted.draftId)}`,
          async (route) => {
            attempts.push(route.request().postDataJSON());
            const response = await route.fetch();
            posted = (await response.json()) as PurchaseAdjustmentPostResult;
            expect(response.status()).toBe(201);
            if (loseResponse) {
              loseResponse = false;
              await route.abort("failed");
            } else {
              await route.fulfill({ response });
            }
          },
        );
        await confirmButton.click();
        await expect(review.getByRole("alert")).toContainText(
          locale === "en"
            ? "posting result is uncertain"
            : "نتيجة الحفظ غير مؤكدة",
        );
        await expect(summaryDialog.getByRole("alert")).toBeFocused();
        await expect(summaryDialog.getByRole("textbox")).toBeDisabled();
        await expect(confirmButton).toBeEnabled();
        await confirmButton.click();
        await expect(
          review.locator(".adjustment-posted-success-card"),
        ).toBeVisible();
        expect(attempts).toHaveLength(2);
        expect(attempts[0]).toEqual(attempts[1]);
        expect(posted?.posted).toMatchObject({
          evidence: concurrentEvidence,
          reason: "quantity error",
          quantityDelta: "4",
          primarySupplierCostDeltaFils: "320000",
        });
        const savedSummary = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          purchaseAdjustmentSummaryPath(accepted.draftId),
        );
        expect(savedSummary.status).toBe(409);
        await review
          .getByRole("button", {
            name:
              locale === "en"
                ? "Back to original invoice"
                : "العودة إلى الفاتورة الأصلية",
          })
          .click();
        await review.getByRole("button", { name: /-A01\//u }).click();
        await expect(review.locator(".posted-adjustment-view")).toContainText(
          concurrentEvidence,
        );
        const corrections = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          `/purchases/posted/${original.posted.id}`,
        );
        expect(
          (corrections.body as { adjustments: unknown[] }).adjustments,
        ).toHaveLength(1);
      });
    }
  }

  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`T05 complete saved rows and preserved filtered navigation ${locale} ${theme}`, async ({
        page,
      }) => {
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.setViewportSize({ width: 1280, height: 800 });
        const invoice = `T05-NAV-${locale}-${theme}`;
        if (locale === "en" && theme === "light") {
          for (let index = 0; index < 22; index++) {
            await postPurchaseForReview(
              apiOrigin,
              credentials,
              supplierId,
              purchaseProduct.id,
              `T05-NAV-SCROLL-${index}`,
            );
          }
        }
        const created = await apiRequest(
          apiOrigin,
          credentials,
          "POST",
          "/purchases/drafts",
          {
            invoiceOffer: { mode: "percentage", value: "5" },
            idempotencyKey: uuidV7(),
            invoiceDate: "2026-06-15",
            settlementContext: "debt",
            supplierId,
            supplierInvoiceNumber: invoice,
          },
        );
        expect(created.status).toBe(201);
        let draft = (created.body as { draft: PurchaseDraft }).draft;
        for (const [quantity, cost, unit] of [
          ["2", "100000", { kind: "package-unit", packageUnitName: "Pack" }],
          ["1", "40000", { kind: "inventory-unit" }],
        ] as const) {
          const committed = await apiRequest(
            apiOrigin,
            credentials,
            "POST",
            purchaseDraftRowsPath(draft.id),
            {
              costFils: cost,
              enteredQuantity: quantity,
              expectedVersion: draft.version,
              expiryDate: "2029-06-30",
              idempotencyKey: uuidV7(),
              itemId: purchaseProduct.id,
              lotNumber: "T05-LOT",
              notes: "Saved note\nملاحظة محفوظة",
              pricing: { method: "by-price", retailPriceFils: "120000" },
              unit,
            },
          );
          expect(committed.status).toBe(201);
          draft = (committed.body as { draft: PurchaseDraft }).draft;
        }
        await page.goto(`${renderer.origin}#/purchases`);
        await page
          .getByRole("button", {
            name: locale === "en" ? "Saved drafts" : "المسودات المحفوظة",
            exact: true,
          })
          .click();
        await page
          .locator("#purchase-draft-register tbody tr", { hasText: invoice })
          .getByRole("button")
          .first()
          .click();
        const savedRows = page.locator(
          ".purchase-row-table tbody tr[data-row-id]",
        );
        const firstRow = savedRows.first();
        await firstRow.locator(".purchase-action-icon-btn.edit").click();
        await firstRow
          .locator("summary.purchase-action-icon-btn.optional")
          .click();
        const optional = firstRow.locator(".purchase-optional-controls-body");
        const productSearch = optional.getByRole("searchbox");
        await productSearch.fill("Percentage Purchase");
        await optional
          .getByRole("button", {
            name: percentageProduct.displayName,
            exact: true,
          })
          .click();
        await optional.getByRole("combobox").selectOption("inventory-unit");
        await optional
          .getByRole("button", {
            name: locale === "en" ? "Done" : "تم",
            exact: true,
          })
          .click();
        await firstRow.locator(".purchase-action-icon-btn.cancel").click();
        await expect(
          firstRow.locator(".purchase-action-icon-btn.edit"),
        ).toBeFocused();
        const unmodified = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          `/purchases/drafts/${draft.id}`,
        );
        expect(unmodified.body).toMatchObject({
          version: draft.version,
          rows: [
            { itemId: purchaseProduct.id, inventoryUnitQuantity: "8" },
            { inventoryUnitQuantity: "1" },
          ],
        });
        await firstRow.locator(".purchase-action-icon-btn.edit").click();
        await firstRow
          .locator("summary.purchase-action-icon-btn.optional")
          .click();
        await productSearch.fill("Percentage Purchase");
        await optional
          .getByRole("button", {
            name: percentageProduct.displayName,
            exact: true,
          })
          .click();
        await optional.getByRole("combobox").selectOption("inventory-unit");
        await optional
          .getByRole("button", {
            name: locale === "en" ? "Done" : "تم",
            exact: true,
          })
          .click();
        const correctedResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            response.url().includes("/rows/") &&
            response.status() === 200,
        );
        await expect(
          firstRow.getByPlaceholder(
            locale === "en" ? "Calculated on Save row" : "يحسب عند حفظ السطر",
            { exact: true },
          ),
        ).toHaveValue("");
        await firstRow.locator(".purchase-action-icon-btn.save").click();
        const corrected = (await (await correctedResponse).json()) as {
          draft: PurchaseDraft;
        };
        draft = corrected.draft;
        await expect(
          firstRow.locator(".purchase-action-icon-btn.edit"),
        ).toBeFocused();
        expect(corrected).toMatchObject({
          draft: {
            review: {
              grossFils: "240000",
              allowanceFils: "6000",
              netFils: "222000",
              invoiceOffer: { offerFils: "12000" },
            },
            rows: [
              {
                itemId: percentageProduct.id,
                inventoryUnitQuantity: "2",
                pricingMethod: "by-percentage",
                marginPercentage: "20",
                retailPriceFils: "125000",
                notes: "Saved note\nملاحظة محفوظة",
              },
              { inventoryUnitQuantity: "1" },
            ],
          },
        });
        const postedResponse = await apiRequest(
          apiOrigin,
          credentials,
          "POST",
          purchaseDraftPostingsPath(draft.id),
          { expectedVersion: draft.version, idempotencyKey: uuidV7() },
        );
        expect(postedResponse.status).toBe(201);
        const posted = (postedResponse.body as PurchasePostResult).posted;
        await postedInvoicesTab(page).click();
        const review = page.locator("#purchase-posted-view");
        await review.getByRole("searchbox").fill("T05-NAV-");
        await review.locator(".posted-review-filters summary").click();
        const filters = review.locator(".posted-review-filter-fields");
        await filters
          .getByLabel(locale === "en" ? "Date type" : "نوع التاريخ", {
            exact: true,
          })
          .selectOption("invoice-date");
        await filters
          .getByLabel(locale === "en" ? "From date" : "من تاريخ", {
            exact: true,
          })
          .fill("2026-01-01");
        await filters
          .getByLabel(locale === "en" ? "To date" : "إلى تاريخ", {
            exact: true,
          })
          .fill("2026-12-31");
        await filters
          .getByLabel(locale === "en" ? "Sort by" : "الترتيب حسب", {
            exact: true,
          })
          .selectOption("number");
        await filters
          .getByLabel(locale === "en" ? "Direction" : "اتجاه الترتيب", {
            exact: true,
          })
          .selectOption("ascending");
        const listRows = review.locator(".posted-purchase-list tbody tr");
        await expect(listRows.filter({ hasText: invoice })).toHaveCount(1);
        const scroll = review.locator(".proto-table-wrap");
        await scroll.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const scrollTop = await scroll.evaluate((element) => element.scrollTop);
        expect(scrollTop).toBeGreaterThan(0);
        await listRows
          .filter({ hasText: invoice })
          .getByRole("button")
          .first()
          .click();
        const detail = review.locator(".posted-purchase-review");
        await expect(detail.locator(".posted-row-notes")).toHaveCount(2);
        await detail.locator(".posted-row-snapshots summary").click();
        await expect(detail).toContainText(posted.rows[0]!.batchId);
        await expect(detail).toContainText(posted.rows[0]!.movementId);
        await expect(detail.locator(".posted-row-snapshots")).toContainText(
          locale === "en" ? "By Percentage" : "بالنسبة",
        );
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        const captures = path.resolve(
          import.meta.dirname,
          "../../../../evidence/issue-198/t05/screenshots",
        );
        await mkdir(captures, { recursive: true });
        await page.screenshot({
          path: path.join(captures, `snapshot-${locale}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
        const item = detail.getByRole("button", {
          name: new RegExp(
            `${locale === "en" ? "Open current item record" : "فتح سجل الصنف الحالي"} ${percentageProduct.displayName}`,
          ),
        });
        await item.click();
        await review
          .getByRole("button", {
            name: locale === "en" ? "Back to invoice" : "العودة إلى الفاتورة",
            exact: true,
          })
          .click();
        await expect(item).toBeFocused();
        await expect(detail.locator(".posted-row-notes")).toHaveCount(2);
        await expect(detail.locator(".posted-row-snapshots")).toHaveAttribute(
          "open",
          "",
        );
        const heading = detail.locator("#posted-detail-title");
        const originalHeading = await heading.textContent();
        await detail
          .getByRole("button", {
            name: locale === "en" ? /Previous/ : /السابق/,
          })
          .click();
        await expect(heading).not.toHaveText(originalHeading!);
        await detail
          .getByRole("button", { name: locale === "en" ? /Next/ : /التالي/ })
          .click();
        await expect(heading).toHaveText(originalHeading!);
        // Reproduce the manual checkpoint order: change current master units
        // before saving only Adjustment evidence on the historical invoice.
        const currentMasterResponse = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          `/catalog/products/${purchaseProduct.id}`,
        );
        expect(currentMasterResponse.status).toBe(200);
        const currentMaster = currentMasterResponse.body as Product;
        if (currentMaster.pricing.method !== "by-price") {
          throw new Error(
            "The Keyboard Purchase fixture must use by-price pricing",
          );
        }
        const restoreMaster = medicationRequest(
          "Keyboard Purchase",
          "5012345678949",
        );
        restoreMaster.pricing = currentMaster.pricing;
        const changedMaster = {
          ...restoreMaster,
          definition: medicationRequest(
            "T05 Current Master Changed",
            "5012345678949",
          ).definition,
          packaging: {
            ...restoreMaster.packaging,
            inventoryUnitName: "Tablet",
            packageUnits: [{ name: "Box", baseUnitsPerPackage: "6" }],
            defaultUnits: {
              ...restoreMaster.packaging.defaultUnits,
              purchase: { kind: "package-unit", packageUnitName: "Box" },
            },
          },
          expectedRevision: currentMaster.revision,
          idempotencyKey: uuidV7(),
        };
        const masterChangedResponse = await apiRequest(
          apiOrigin,
          credentials,
          "PUT",
          `/catalog/products/${purchaseProduct.id}`,
          changedMaster,
        );
        expect(masterChangedResponse.status).toBe(200);
        await detail
          .getByRole("button", {
            name: locale === "en" ? "Edit Invoice" : "تعديل الفاتورة",
            exact: true,
          })
          .click();
        const correction = review.locator(".purchase-adjustment");
        await review
          .getByRole("button", {
            name:
              locale === "en" ? "Create adjustment copy" : "إنشاء نسخة التعديل",
          })
          .click();
        await correction
          .locator(".adjustment-banner-reason-input")
          .fill("T05 dirty navigation evidence");
        await correction.locator('[data-adjustment-action="search"]').click();
        await expect(correction.getByRole("alertdialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          correction.locator(".adjustment-banner-reason-input"),
        ).toHaveValue("T05 dirty navigation evidence");
        await correction.locator('[data-adjustment-action="search"]').click();
        await correction
          .locator('[data-adjustment-action="save-leave"]')
          .click();
        await expect(review.getByRole("searchbox")).toHaveValue("T05-NAV-");
        const savedOriginal = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          `/purchases/posted/${posted.id}`,
        );
        const activeDrafts = (
          savedOriginal.body as { activeAdjustmentDrafts: { id: string }[] }
        ).activeAdjustmentDrafts;
        expect(activeDrafts).toHaveLength(1);
        const savedEvidence = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          purchaseAdjustmentDraftPath(activeDrafts[0]!.id),
        );
        expect(savedEvidence.body).toMatchObject({
          evidence: "T05 dirty navigation evidence",
          rows: [
            { inventoryUnitName: "Strip" },
            { inventoryUnitName: "Strip" },
          ],
        });
        const restoredMasterResponse = await apiRequest(
          apiOrigin,
          credentials,
          "PUT",
          `/catalog/products/${purchaseProduct.id}`,
          {
            ...restoreMaster,
            expectedRevision: (masterChangedResponse.body as Product).revision,
            idempotencyKey: uuidV7(),
          },
        );
        expect(restoredMasterResponse.status).toBe(200);
        await listRows
          .filter({ hasText: invoice })
          .getByRole("button")
          .first()
          .click();
        await expect(detail.locator(".posted-row-notes")).toHaveCount(2);
        await detail
          .getByRole("button", {
            name: locale === "en" ? "Back to results" : "العودة إلى النتائج",
            exact: true,
          })
          .click();
        await expect(review.getByRole("searchbox")).toHaveValue("T05-NAV-");
        await expect(
          filters.getByLabel(locale === "en" ? "Sort by" : "الترتيب حسب", {
            exact: true,
          }),
        ).toHaveValue("number");
        await expect(
          filters.getByLabel(locale === "en" ? "Direction" : "اتجاه الترتيب", {
            exact: true,
          }),
        ).toHaveValue("ascending");
        await expect(scroll).toHaveJSProperty("scrollTop", scrollTop);
        await expect(
          listRows.filter({ hasText: invoice }).getByRole("button").first(),
        ).toBeFocused();
        await page.screenshot({
          path: path.join(captures, `navigation-${locale}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
        for (const viewport of [
          { width: 1366, height: 768 },
          { width: 1024, height: 768 },
        ]) {
          await page.setViewportSize(viewport);
          await expect(review.getByRole("searchbox")).toBeInViewport();
          await expect(
            filters.getByLabel(locale === "en" ? "From date" : "من تاريخ", {
              exact: true,
            }),
          ).toBeInViewport();
          await expect(
            filters.getByLabel(
              locale === "en" ? "Direction" : "اتجاه الترتيب",
              { exact: true },
            ),
          ).toBeInViewport();
        }
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.evaluate('document.documentElement.style.fontSize = "200%"');
        await expect(review.getByRole("searchbox")).toBeInViewport();
        await expect(
          filters.getByLabel(locale === "en" ? "Direction" : "اتجاه الترتيب", {
            exact: true,
          }),
        ).toBeInViewport();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          path: path.join(captures, `navigation-200-${locale}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.evaluate(
          'document.documentElement.style.removeProperty("font-size")',
        );
      });

      test(`T04 saves independent invoice offers and immutable corrections ${locale} ${theme}`, async ({
        page,
      }) => {
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.setViewportSize({ width: 1280, height: 800 });
        const invoice = `T04-UI-${locale}-${theme}`;
        const t04Dir = path.resolve(
          import.meta.dirname,
          "../../../../evidence/issue-198/t04/screenshots",
        );
        await mkdir(t04Dir, { recursive: true });
        await createPurchaseWithOneRow(
          page,
          renderer.origin,
          supplierId,
          invoice,
          "2029-06-30",
          locale,
        );
        const percent = page.getByLabel(
          locale === "en" ? "Invoice offer %" : "عرض الفاتورة %",
          { exact: true },
        );
        const amount = page.getByLabel(
          locale === "en" ? "Invoice offer (IQD)" : "عرض الفاتورة (د.ع)",
          { exact: true },
        );
        const headerSave = page.getByRole("button", {
          name: locale === "en" ? "Save changes" : "حفظ التغييرات",
          exact: true,
        });
        await percent.fill("5");
        await expect(amount).toHaveValue("0");
        await page
          .getByRole("button", {
            name: locale === "en" ? "Post purchase" : "حفظ الفاتورة",
            exact: true,
          })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          locale === "en" ? "Save the offer" : "احفظ العرض",
        );
        await headerSave.click();
        await expect(page.locator(".purchase-invoice-offer")).toContainText(
          locale === "en" ? "148 IQD" : "١٤٨",
        );
        await stopProcess(api);
        api = startApi(apiPort, databaseRoles, credentials);
        await waitForHealth(apiOrigin);
        await page.reload();
        await page
          .getByRole("button", {
            name: locale === "en" ? "Saved drafts" : "المسودات المحفوظة",
            exact: true,
          })
          .click();
        await page
          .locator("#purchase-draft-register tbody tr", { hasText: invoice })
          .getByRole("button")
          .first()
          .click();
        await expect(percent).toHaveValue("5");
        await amount.fill("4");
        await expect(percent).toHaveValue("0");
        await headerSave.click();
        await expect(page.locator(".purchase-invoice-offer")).toContainText(
          locale === "en" ? "152 IQD" : "١٥٢",
        );
        await amount.fill("157");
        await headerSave.click();
        await expect(page.getByRole("alert")).toContainText(
          locale === "en" ? "cannot exceed" : "لا يمكن أن يتجاوز",
        );
        await expect(amount).toHaveValue("157");
        await amount.fill("4");
        await headerSave.click();
        await expect(headerSave).toBeEnabled();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: locale === "en" ? "Post purchase" : "حفظ الفاتورة",
            exact: true,
          }),
        ).toBeInViewport();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          path: path.join(t04Dir, `offer-draft-${locale}-${theme}.png`),
        });
        const postedPromise = page.waitForResponse(
          (response) =>
            response.url().endsWith("/postings") && response.status() === 201,
        );
        await page
          .getByRole("button", {
            name: locale === "en" ? "Post purchase" : "حفظ الفاتورة",
            exact: true,
          })
          .click();
        const original = (await (
          await postedPromise
        ).json()) as PurchasePostResult;
        expect(original.posted).toMatchObject({
          invoiceOffer: {
            input: { mode: "fixed", value: "4000" },
            offerFils: "4000",
          },
          costAfterDiscountFils: "152000",
          primarySupplierCostFils: "160000",
        });
        await page.goto(`${renderer.origin}#/purchases`);
        await postedInvoicesTab(page).click();
        const review = page.locator("#purchase-posted-view");
        await review.getByRole("searchbox").fill(invoice);
        await review.getByRole("searchbox").press("Enter");
        await review
          .locator(".posted-purchase-list tbody tr", { hasText: invoice })
          .getByRole("button")
          .first()
          .click();
        await review
          .getByRole("button", {
            name: locale === "en" ? "Edit Invoice" : "تعديل الفاتورة",
          })
          .click();
        await review
          .getByRole("button", {
            name:
              locale === "en" ? "Create adjustment copy" : "إنشاء نسخة التعديل",
          })
          .click();
        const adjustment = page.locator(".purchase-adjustment");
        await adjustment
          .getByLabel(locale === "en" ? "Invoice offer %" : "عرض الفاتورة %", {
            exact: true,
          })
          .fill("10");
        const summaryPromise = page.waitForResponse(
          (response) => response.url().endsWith("/summary") && response.ok(),
        );
        await adjustment
          .getByRole("button", {
            name:
              locale === "en" ? "Save and review Delta" : "حفظ ومراجعة الفرق",
          })
          .click();
        const summary = (await (
          await summaryPromise
        ).json()) as PurchaseAdjustmentSummary;
        expect(summary).toMatchObject({
          offerDeltaFils: "12000",
          primarySupplierCostDeltaFils: "0",
          costAfterDiscountDeltaFils: "-12000",
          stockEffects: [],
          supplierEffects: [],
        });
        const dialog = page.locator(".delta-summary-dialog");
        const confirm = dialog.getByRole("button", {
          name:
            locale === "en" ? "Confirm and post Delta" : "تأكيد وحفظ التعديل",
          exact: true,
        });
        await expect(confirm).toBeInViewport();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.screenshot({
          animations: "disabled",
          path: path.join(t04Dir, `offer-summary-${locale}-${theme}.png`),
        });
        const a01Promise = page.waitForResponse(
          (response) =>
            response.url().endsWith("/postings") && response.status() === 201,
        );
        await confirm.click();
        const a01 = (await (
          await a01Promise
        ).json()) as PurchaseAdjustmentPostResult;
        expect(a01.posted).toMatchObject({
          offerComparison: {
            before: { offerFils: "4000" },
            after: {
              input: { mode: "percentage", value: "10" },
              offerFils: "16000",
            },
          },
          offerDeltaFils: "12000",
          rowDeltas: [],
        });
        await page.reload();
        const originalGet = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          `/purchases/posted/${original.posted.id}`,
        );
        expect(originalGet.body).toMatchObject({
          invoiceOffer: original.posted.invoiceOffer,
          costAfterDiscountFils: "152000",
        });
      });
    }
  }

  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`corrects Adjustment supplier and invoice headers with immutable navigation ${locale} ${theme}`, async ({
        page,
      }) => {
        const invoice = `BROWSER-HEADERS-${locale}-${theme}`;
        const targetResponse = await apiRequest(
          apiOrigin,
          credentials,
          "POST",
          "/suppliers",
          {
            allowanceEffectiveFrom: "2026-01-01",
            defaultAllowancePercentage: "25",
            idempotencyKey: uuidV7(),
            name: `Header Supplier ${locale} ${theme}`,
            terms: "Net 30",
          },
        );
        expect(targetResponse.status).toBe(201);
        const target = supplierSchema.parse(targetResponse.body);
        const original = await postPurchaseForReview(
          apiOrigin,
          credentials,
          supplierId,
          purchaseProduct.id,
          invoice,
        );
        const duplicateNumber = `${invoice}-DUPLICATE`;
        await postPurchaseForReview(
          apiOrigin,
          credentials,
          target.id,
          purchaseProduct.id,
          duplicateNumber,
        );
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`${renderer.origin}#/purchases`);
        await postedInvoicesTab(page).click();
        const review = page.locator("#purchase-posted-view");
        const search = review.getByRole("searchbox");
        await search.fill(invoice);
        await search.press("Enter");
        await review
          .locator(".posted-purchase-list tbody tr")
          .filter({ hasText: invoice })
          .filter({ hasNotText: duplicateNumber })
          .getByRole("button")
          .first()
          .click();
        const edit = locale === "en" ? "Edit Invoice" : "تعديل الفاتورة";
        const create =
          locale === "en" ? "Create adjustment copy" : "إنشاء نسخة التعديل";
        const save =
          locale === "en" ? "Save and review Delta" : "حفظ ومراجعة الفرق";
        const confirm =
          locale === "en" ? "Confirm and post Delta" : "تأكيد وحفظ التعديل";
        const supplierLabel = locale === "en" ? "Supplier" : "المورد";
        const invoiceLabel =
          locale === "en" ? "Supplier invoice number" : "رقم الفاتورة";
        const reasonLabel = locale === "en" ? "Reason" : "السبب";
        const evidenceLabel =
          locale === "en" ? "Reason evidence" : "دليل السبب";
        const evidenceDir = path.resolve(
          import.meta.dirname,
          "../../../../evidence/issue-198/t02/screenshots",
        );
        await mkdir(evidenceDir, { recursive: true });
        for (const [index, reason] of [
          "supplier error",
          "invoice-number error",
        ].entries()) {
          await review.getByRole("button", { name: edit }).click();
          await review
            .getByRole("combobox", { name: reasonLabel, exact: true })
            .selectOption(reason);
          await review.getByRole("button", { name: create }).click();
          await expect(
            review.getByRole("button", { name: create }),
          ).toHaveCount(0);
          const expiry = review.getByRole("textbox", {
            name: `${locale === "en" ? "Expiry" : "الإكسباير"} ${purchaseProduct.displayName}`,
          });
          await expect(expiry).toHaveAttribute("readonly", "");
          await expect(
            review.getByRole("combobox", { name: reasonLabel, exact: true }),
          ).toHaveValue(reason);
          await review
            .getByRole("textbox", { name: evidenceLabel, exact: true })
            .fill(`Header evidence ${index} ${locale} ${theme}`);
          if (index === 0)
            await review
              .getByRole("combobox", { name: supplierLabel, exact: true })
              .selectOption(target.id);
          else
            await review
              .getByRole("textbox", { name: invoiceLabel, exact: true })
              .fill(duplicateNumber);
          await review.locator(".purchase-adjustment").screenshot({
            path: path.join(
              evidenceDir,
              `editor-${index}-${locale}-${theme}.png`,
            ),
            animations: "disabled",
          });
          await review.getByRole("button", { name: save }).click();
          const dialog = review.locator(".delta-summary-dialog");
          await expect(
            dialog.locator(".adjustment-header-comparison"),
          ).toContainText(index === 0 ? target.name : duplicateNumber);
          if (index === 0) {
            await expect(dialog).toContainText("Al-Nahrain Medical");
            await expect(dialog).toContainText(
              locale === "en" ? "−320 IQD" : "−٣٢٠ د.ع",
            );
          } else
            await expect(dialog.getByRole("status")).toContainText(
              locale === "en" ? "awaits milestone approval" : "اعتماد",
            );
          const summaries = await apiRequest(
            apiOrigin,
            credentials,
            "GET",
            `/purchases/posted/${original.posted.id}`,
          );
          const activeDrafts = (
            summaries.body as { activeAdjustmentDrafts: { id: string }[] }
          ).activeAdjustmentDrafts;
          const authoritative = await apiRequest(
            apiOrigin,
            credentials,
            "GET",
            purchaseAdjustmentSummaryPath(activeDrafts[0]!.id),
          );
          const summary = authoritative.body as PurchaseAdjustmentSummary;
          expect(summary).toMatchObject({
            quantityDelta: "0",
            primarySupplierCostDeltaFils: "0",
            rowDeltas: [],
            stockEffects: [],
          });
          expect(summary.reason).toBe(reason);
          expect(summary.headerComparison.after.supplierId).toBe(target.id);
          const confirmButton = dialog.getByRole("button", { name: confirm });
          await expect(confirmButton).toBeInViewport();
          expect(
            (
              await new AxeBuilder({ page })
                .include(".delta-summary-dialog")
                .analyze()
            ).violations,
          ).toEqual([]);
          for (const viewport of [
            { width: 1280, height: 800 },
            { width: 1366, height: 768 },
          ]) {
            await page.setViewportSize(viewport);
            await expect(confirmButton).toBeInViewport();
            await dialog.screenshot({
              path: path.join(
                evidenceDir,
                `${reason}-${locale}-${theme}-${viewport.width}x${viewport.height}.png`,
              ),
              animations: "disabled",
            });
          }
          await page.setViewportSize({ width: 640, height: 800 });
          await expect(confirmButton).toBeInViewport();
          await page.setViewportSize({ width: 1280, height: 800 });
          await page.route("**/t02-text-zoom.css", (route) =>
            route.fulfill({
              contentType: "text/css",
              body: "html { font-size: 200%; }",
            }),
          );
          const enlarged = await page.addStyleTag({
            url: `${renderer.origin}/t02-text-zoom.css`,
          });
          await expect(confirmButton).toBeInViewport();
          await enlarged.evaluate((element) => element.remove());
          await confirmButton.click();
          await expect(
            review.locator(".adjustment-posted-success-card"),
          ).toBeVisible();
          await review
            .getByRole("button", {
              name:
                locale === "en"
                  ? "Back to original invoice"
                  : "العودة إلى الفاتورة الأصلية",
            })
            .click();
          const detail = review.locator(".posted-purchase-review");
          await expect(detail).toContainText(invoice);
          await expect(detail).toContainText("Al-Nahrain Medical");
          await review
            .getByRole("button", { name: index === 0 ? /-A01\//u : /-A02\//u })
            .click();
          const posted = review.locator(".posted-adjustment-view");
          await expect(
            posted.locator(".adjustment-header-comparison"),
          ).toContainText(index === 0 ? target.name : duplicateNumber);
          await expect(posted).toContainText(
            `Header evidence ${index} ${locale} ${theme}`,
          );
          await posted
            .getByRole("button", {
              name: locale === "en" ? "Back to invoice" : "العودة إلى الفاتورة",
            })
            .click();
        }
      });
    }
  }

  test("protects percentage Adjustment pricing and shows the derived retail correction", async ({
    page,
  }) => {
    const created = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/purchases/drafts",
      {
        idempotencyKey: uuidV7(),
        invoiceDate: "2026-09-08",
        settlementContext: "debt",
        supplierId,
        supplierInvoiceNumber: "BROWSER-ADJUST-PERCENTAGE",
        invoiceOffer: { mode: "none", value: "0" },
      },
    );
    expect(created.status).toBe(201);
    const draft = (created.body as { draft: PurchaseDraft }).draft;
    const row = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      purchaseDraftRowsPath(draft.id),
      {
        costFils: "80000",
        enteredQuantity: "4",
        expectedVersion: draft.version,
        expiryDate: "2029-05-31",
        idempotencyKey: uuidV7(),
        itemId: percentageProduct.id,
        lotNumber: "PERCENTAGE-LOT",
        notes: null,
        pricing: { method: "by-percentage", marginPercentage: "20" },
        unit: { kind: "inventory-unit" },
      },
    );
    expect(row.status).toBe(201);
    const ready = (row.body as { draft: PurchaseDraft }).draft;
    const posted = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      purchaseDraftPostingsPath(ready.id),
      { expectedVersion: ready.version, idempotencyKey: uuidV7() },
    );
    expect(posted.status).toBe(201);
    const original = (posted.body as PurchasePostResult).posted;
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(
      `${renderer.origin}#/purchases/posted/${original.id}/adjustment`,
    );
    const review = page.locator("#purchase-posted-view");
    await review
      .getByRole("combobox", { name: "Reason", exact: true })
      .selectOption("price error");
    await review
      .getByRole("button", { name: "Create adjustment copy" })
      .click();
    const retail = review.getByRole("textbox", {
      name: `Retail price (fils) ${percentageProduct.displayName}`,
    });
    await expect(retail).toHaveAttribute("readonly", "");
    await expect(retail).toHaveValue("100000");
    await review
      .getByRole("textbox", {
        name: `Primary supplier cost (fils) ${percentageProduct.displayName}`,
      })
      .fill("100000");
    await review.getByRole("button", { name: "Save and review Delta" }).click();
    const summary = review.locator(".delta-summary-dialog");
    await expect(summary).toContainText("100 IQD");
    await expect(summary).toContainText("125 IQD");
    await expect(summary).toContainText("80 IQD");
    await expect(
      summary.getByRole("button", { name: "Confirm and post Delta" }),
    ).toBeEnabled();
  });

  for (const locale of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`Adjustment controls preserve filtered navigation, dirty work and exact totals ${locale} ${theme}`, async ({
        page,
      }) => {
        const prefix = `BROWSER-T03-${locale}-${theme}`;
        const originals: PurchasePostResult[] = [];
        for (const suffix of ["A", "B", "C"])
          originals.push(
            await postPurchaseForReview(
              apiOrigin,
              credentials,
              supplierId,
              purchaseProduct.id,
              `${prefix}-${suffix}`,
            ),
          );
        await postPurchaseForReview(
          apiOrigin,
          credentials,
          supplierId,
          purchaseProduct.id,
          `OUTSIDE-T03-${locale}-${theme}`,
        );
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`${renderer.origin}#/purchases`);
        await postedInvoicesTab(page).click();
        const review = page.locator("#purchase-posted-view");
        await review.getByRole("searchbox").fill(prefix);
        await review.getByRole("searchbox").press("Enter");
        const rows = review.locator(".posted-purchase-list tbody tr");
        await expect(rows).toHaveCount(3);
        await rows.first().getByRole("button").first().click();
        const heading = review.locator("article.posted-purchase-review");
        await expect(heading).toContainText(`${prefix}-C`);
        const editName = locale === "en" ? /Edit Invoice/u : /تعديل الفاتورة/u;
        const createName =
          locale === "en" ? "Create adjustment copy" : "إنشاء نسخة التعديل";
        const continueName =
          locale === "en" ? "Continue draft" : "متابعة المسودة";
        const adjustment = review.locator(".purchase-adjustment");
        const action = (name: string) =>
          adjustment.locator(`[data-adjustment-action="${name}"]`);
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await expect(action("previous")).toBeDisabled();
        await expect(
          adjustment
            .getByText(locale === "en" ? "Unavailable" : "غير متاح", {
              exact: true,
            })
            .first(),
        ).toBeVisible();
        await action("next").click();
        await expect(heading).toContainText(`${prefix}-B`);
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await expect(action("previous")).toBeEnabled();
        await adjustment.getByRole("button", { name: createName }).click();
        const quantity = adjustment.getByRole("textbox", {
          name: `${locale === "en" ? "Quantity" : "كمية"} ${purchaseProduct.displayName}`,
          exact: true,
        });
        const evidence = adjustment.locator(".adjustment-banner-reason-input");
        await quantity.fill("8");
        await evidence.pressSequentially(
          `T03 saved evidence ${locale} ${theme}`,
        );
        await expect(
          adjustment.locator(".adjustment-totals-bar"),
        ).toContainText(
          locale === "en"
            ? "Save and review to calculate"
            : "احفظ وراجع لحساب القيم",
        );
        await action("previous").click();
        const warning = adjustment.getByRole("alertdialog");
        await expect(warning).toBeVisible();
        await expect(action("keep-leave")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(warning).toBeHidden();
        await expect(action("previous")).toBeFocused();
        await expect(quantity).toHaveValue("8");
        await action("search").click();
        await action("save-leave").click();
        await expect(review.getByRole("searchbox")).toHaveValue(prefix);
        await expect(review.getByRole("searchbox")).toBeFocused();
        await rows
          .filter({ hasText: `${prefix}-B` })
          .getByRole("button")
          .first()
          .click();
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await adjustment.getByRole("button", { name: continueName }).click();
        await expect(quantity).toHaveValue("8");
        await expect(evidence).toHaveValue(
          `T03 saved evidence ${locale} ${theme}`,
        );
        // A malformed transient value cannot crash React or fabricate a total.
        await quantity.fill("1.5");
        await action("save-review").click();
        await expect(adjustment.getByRole("alert")).toContainText(
          locale === "en" ? "Check the quantities" : "راجع الكميات",
        );
        await expect(
          adjustment.getByRole("alert").locator("code"),
        ).toBeHidden();
        await quantity.fill("8");
        const summaryResponse = page.waitForResponse(
          (response) => response.url().endsWith("/summary") && response.ok(),
        );
        await action("save-review").click();
        const summary = (await (
          await summaryResponse
        ).json()) as PurchaseAdjustmentSummary;
        expect(summary.totalsComparison).toEqual({
          before: {
            offerFils: "0",
            primarySupplierCostFils: "320000",
            allowanceFils: "8000",
            costAfterDiscountFils: "312000",
          },
          after: {
            offerFils: "0",
            primarySupplierCostFils: "640000",
            allowanceFils: "16000",
            costAfterDiscountFils: "624000",
          },
        });
        const modal = adjustment.getByRole("dialog");
        const totals = modal.locator('[data-adjustment-totals="comparison"]');
        await expect(totals).toContainText(
          locale === "en" ? "624 IQD" : "٦٢٤ د.ع",
        );
        await expect(totals).toContainText(
          locale === "en" ? "312 IQD" : "٣١٢ د.ع",
        );
        await expect(modal).toContainText(
          locale === "en"
            ? "Primary Supplier Cost Delta"
            : "فرق كلفة المورد الأساسية",
        );
        await expect(action("close-summary")).toBeFocused();
        const confirm = modal.getByRole("button", {
          name:
            locale === "en" ? "Confirm and post Delta" : "تأكيد وحفظ التعديل",
        });
        await confirm.focus();
        await page.keyboard.press("Tab");
        await expect(modal.locator(".delta-summary-table-wrap")).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(confirm).toBeFocused();
        expect(
          (
            await new AxeBuilder({ page })
              .include(".delta-summary-dialog")
              .analyze()
          ).violations,
        ).toEqual([]);
        const captures = path.resolve(
          import.meta.dirname,
          "../../../../evidence/issue-198/t03/screenshots",
        );
        await mkdir(captures, { recursive: true });
        for (const viewport of [
          { width: 1280, height: 800 },
          { width: 1366, height: 768 },
        ]) {
          await page.setViewportSize(viewport);
          // Prototype purchases.tsx uses max-w-[640px], a 14px heading
          // and a 12px comparison table, without the generic h3 underline.
          await expect(modal).toHaveCSS("width", "640px");
          await expect(modal.locator(".delta-summary-title")).toHaveCSS(
            "font-size",
            "14px",
          );
          await expect(modal.locator(".delta-summary-title")).toHaveCSS(
            "border-bottom-width",
            "0px",
          );
          await expect(totals).toHaveCSS("font-size", "12px");
          await expect(
            modal
              .locator("table")
              .last()
              .locator("tbody tr")
              .first()
              .locator("td")
              .last(),
          ).toBeInViewport();
          await expect(action("close-summary")).toBeInViewport();
          await modal.screenshot({
            animations: "disabled",
            path: path.join(
              captures,
              `totals-${locale}-${theme}-${viewport.width}.png`,
            ),
          });
        }
        await page.setViewportSize({ width: 640, height: 800 });
        await expect(confirm).toBeInViewport();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.route("**/t03-text-zoom.css", (route) =>
          route.fulfill({
            contentType: "text/css",
            body: "html { font-size: 200%; }",
          }),
        );
        const zoom = await page.addStyleTag({
          url: `${renderer.origin}/t03-text-zoom.css`,
        });
        await expect(confirm).toBeInViewport();
        await zoom.evaluate((element) => element.remove());
        await page.keyboard.press("Escape");
        await expect(action("save-review")).toBeFocused();
        await expect(action("save-review")).toBeInViewport();
        await adjustment.screenshot({
          animations: "disabled",
          path: path.join(captures, `editor-${locale}-${theme}.png`),
        });
        // Permission refusal retains work; correlation is optional support detail.
        const supportReference = uuidV7();
        await page.route("**/purchases/adjustment-drafts/*/summary", (route) =>
          route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              status: "denied",
              code: "permission-denied",
              requestId: supportReference,
            }),
          }),
        );
        await evidence.fill(`T03 denied evidence ${locale}`);
        await action("save-review").click();
        const denial = adjustment.getByRole("alert");
        await expect(denial).toContainText(
          locale === "en"
            ? "This Adjustment action is not allowed"
            : "إجراء التعديل غير مسموح",
        );
        await expect(denial.locator("code")).toBeHidden();
        await denial.locator("summary").click();
        await expect(denial.locator("code")).toHaveText(supportReference);
        await page.unroute("**/purchases/adjustment-drafts/*/summary");
        await page.route("**/purchases/adjustment-drafts/*/summary", (route) =>
          route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
              status: "denied",
              code: "session-expired",
              requestId: uuidV7(),
            }),
          }),
        );
        await action("save-review").click();
        await expect(denial).toContainText(
          locale === "en" ? "Your session ended" : "انتهت جلستك",
        );
        await expect(denial.locator("code")).toBeHidden();
        await page.unroute("**/purchases/adjustment-drafts/*/summary");
        // An unavailable save cannot carry the user away or erase typed input.
        await quantity.fill("9");
        await page.route("**/purchases/adjustment-drafts/*", (route) =>
          route.request().method() === "PUT"
            ? route.abort("failed")
            : route.continue(),
        );
        await action("search").click();
        await action("save-leave").click();
        await expect(warning.getByRole("alert")).toContainText(
          locale === "en"
            ? "Your edits are still here"
            : "التغييرات ما زالت هنا",
        );
        await action("continue-editing").click();
        await expect(quantity).toHaveValue("9");
        await page.unroute("**/purchases/adjustment-drafts/*");
        await quantity.fill("8");
        await action("return").click();
        await action("keep-leave").click();
        await expect(
          review.getByRole("heading", {
            name:
              locale === "en"
                ? "Purchase Return · goods physically leave stock"
                : "مردود شراء · بضاعة تغادر المخزون فعلياً",
            exact: true,
          }),
        ).toBeVisible();
        await review
          .getByRole("button", {
            name:
              locale === "en"
                ? "Back to original invoice"
                : "العودة إلى الفاتورة الأصلية",
            exact: true,
          })
          .click();
        await expect(
          review.locator('button[data-review-focus^="return-"]'),
        ).toBeFocused();
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await adjustment.getByRole("button", { name: continueName }).click();
        await expect(evidence).toHaveValue(`T03 denied evidence ${locale}`);
        await quantity.fill("9");
        await action("back").click();
        await action("continue-editing").click();
        await expect(quantity).toHaveValue("9");
        await action("cancel-adjustment").click();
        await expect(action("save-leave")).toHaveCount(0);
        await action("discard-leave").click();
        await expect(heading).toContainText(`${prefix}-B`);
        const original = originals[1]!;
        const detail = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          `/purchases/posted/${original.posted.id}`,
        );
        expect(
          (detail.body as { activeAdjustmentDrafts: unknown[] })
            .activeAdjustmentDrafts,
        ).toHaveLength(0);
        expect(
          (detail.body as { primarySupplierCostFils: string })
            .primarySupplierCostFils,
        ).toBe("320000");
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await action("next").click();
        await expect(heading).toContainText(`${prefix}-A`);
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await expect(action("next")).toBeDisabled();
        await expect(action("previous")).toBeEnabled();
        await adjustment.getByRole("button", { name: createName }).click();
        await action("remove-row").click();
        await expect(action("save-review")).toBeFocused();
        const zeroResponse = page.waitForResponse(
          (response) => response.url().endsWith("/summary") && response.ok(),
        );
        await action("save-review").click();
        const zero = (await (
          await zeroResponse
        ).json()) as PurchaseAdjustmentSummary;
        expect(zero.totalsComparison.after).toEqual({
          offerFils: "0",
          primarySupplierCostFils: "0",
          allowanceFils: "0",
          costAfterDiscountFils: "0",
        });
        expect(zero.primarySupplierCostDeltaFils).toBe("-320000");
        await expect(
          adjustment
            .getByRole("dialog")
            .locator('[data-adjustment-totals="comparison"]'),
        ).toContainText(locale === "en" ? "0 IQD" : "٠ د.ع");
        await page.keyboard.press("Escape");
        await action("cancel-adjustment").click();
        await action("discard-leave").click();
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await action("search").click();
        await expect(review.getByRole("searchbox")).toHaveValue(prefix);
        await expect(rows).toHaveCount(3);
        await rows
          .filter({ hasText: `${prefix}-A` })
          .getByRole("button")
          .first()
          .click();
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await adjustment.getByRole("button", { name: createName }).click();
        await quantity.fill("6");
        await action("new-invoice").click();
        await action("save-leave").click();
        const freshInvoice = page
          .locator("#purchase-invoice-view")
          .getByLabel(
            locale === "en" ? "Supplier invoice number" : "رقم فاتورة المورد",
            { exact: true },
          );
        await expect(freshInvoice).toBeVisible();
        await expect(freshInvoice).toHaveValue("");
        const retained = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          `/purchases/posted/${originals[0]!.posted.id}`,
        );
        const retainedId = (
          retained.body as { activeAdjustmentDrafts: { id: string }[] }
        ).activeAdjustmentDrafts[0]!.id;
        const retainedDraft = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          purchaseAdjustmentDraftPath(retainedId),
        );
        expect(
          (retainedDraft.body as PurchaseAdjustmentDraft).rows[0]!
            .enteredQuantity,
        ).toBe("6");
        await freshInvoice.fill("UNSAVED-PURCHASE-WORK");
        await postedInvoicesTab(page).click();
        await review.getByRole("searchbox").fill(`${prefix}-A`);
        await review.getByRole("searchbox").press("Enter");
        await rows.first().getByRole("button").first().click();
        await review
          .getByRole("button", { name: editName, exact: true })
          .click();
        await adjustment.getByRole("button", { name: continueName }).click();
        await expect(action("new-invoice")).toHaveCount(0);
        await action("back").click();
        await action("keep-leave").click();
        await page
          .locator(
            'button.purchase-view-tab[aria-controls="purchase-invoice-view"]',
          )
          .click();
        await expect(freshInvoice).toHaveValue("UNSAVED-PURCHASE-WORK");
      });
    }
  }

  test("manual T03 Adjustment controls and totals in a disposable pharmacy", async ({
    page,
  }) => {
    test.skip(
      process.env.BREEV_M2_T03_MANUAL !== "1",
      "Opt-in interactive manual checkpoint",
    );
    test.setTimeout(0);
    let restartPurchaseId = "";
    for (const suffix of ["A", "B", "C"]) {
      const original = await postPurchaseForReview(
        apiOrigin,
        credentials,
        supplierId,
        purchaseProduct.id,
        `MANUAL-T03-${suffix}`,
      );
      if (suffix === "B") restartPurchaseId = original.posted.id;
    }
    await postPurchaseForReview(
      apiOrigin,
      credentials,
      supplierId,
      purchaseProduct.id,
      "OUTSIDE-MANUAL-CHECKPOINT",
    );
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${renderer.origin}#/purchases`);
    await postedInvoicesTab(page).click();
    const review = page.locator("#purchase-posted-view");
    await review.getByRole("searchbox").fill("MANUAL-T03-");
    await review.getByRole("searchbox").press("Enter");
    await expect(review.locator(".posted-purchase-list tbody tr")).toHaveCount(
      3,
    );
    const manualEvidence = path.resolve(
      import.meta.dirname,
      "../../../../evidence/issue-198/t03/screenshots",
    );
    await mkdir(manualEvidence, { recursive: true });
    await page.screenshot({
      path: path.join(manualEvidence, "manual-ready.png"),
      animations: "disabled",
      fullPage: true,
    });
    // Human completes clean/dirty/totals cases; Resume validates the saved
    // checkpoint through the API before a real restart, retaining the page on failure.
    for (;;) {
      await page.pause();
      const original = await apiRequest(
        apiOrigin,
        credentials,
        "GET",
        `/purchases/posted/${restartPurchaseId}`,
      );
      const active = (
        original.body as { activeAdjustmentDrafts: { id: string }[] }
      ).activeAdjustmentDrafts[0];
      if (active !== undefined) {
        const saved = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          purchaseAdjustmentDraftPath(active.id),
        );
        const draft = saved.body as PurchaseAdjustmentDraft;
        if (
          draft.rows[0]?.enteredQuantity === "8" &&
          draft.evidence === "T03 checkpoint saved"
        )
          break;
      }
      console.warn(
        "Restart skipped: Save MANUAL-T03-B with quantity 8 and evidence T03 checkpoint saved first. Input was not cleared.",
      );
    }
    await stopProcess(api!);
    api = startApi(apiPort, databaseRoles, credentials);
    await waitForHealth(apiOrigin);
    await page.reload();
    // Human checks resume/Return/filter/keyboard/theme behavior, then Resume
    // enables an explicitly labelled presentation-only permission simulation.
    await page.pause();
    await page.route("**/purchases/adjustment-drafts/*/summary", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          status: "denied",
          code: "permission-denied",
          requestId: uuidV7(),
        }),
      }),
    );
    console.warn(
      "Manual presentation simulation enabled: next Adjustment summary is denied. Real permission enforcement is proven separately by PostgreSQL tests.",
    );
    await page.pause();
    await page.unroute("**/purchases/adjustment-drafts/*/summary");
    console.warn(
      "Permission simulation removed. Finish discard/post/immutable review checks, then Resume to close the fixture.",
    );
    await page.pause();
  });

  test("manual T02 Adjustment reasons and protected fields in a disposable pharmacy", async ({
    page,
  }) => {
    test.skip(
      process.env.BREEV_M2_T02_MANUAL !== "1",
      "Opt-in interactive manual checkpoint",
    );
    test.setTimeout(0);
    const target = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/suppliers",
      {
        allowanceEffectiveFrom: "2026-01-01",
        defaultAllowancePercentage: "25",
        idempotencyKey: uuidV7(),
        name: "Manual T02 Supplier B",
        terms: "Net 30",
      },
    );
    expect(target.status).toBe(201);
    let quantityPurchaseId = "";
    for (const suffix of [
      "QUANTITY",
      "PRICE",
      "SUPPLIER",
      "INVOICE",
      "OTHER",
      "DUPLICATE",
    ]) {
      const original = await postPurchaseForReview(
        apiOrigin,
        credentials,
        supplierId,
        purchaseProduct.id,
        `MANUAL-T02-${suffix}`,
      );
      if (suffix === "QUANTITY") quantityPurchaseId = original.posted.id;
    }
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${renderer.origin}#/purchases`);
    // The human reviews the five independent reason cases. Resume once after
    // saving QUANTITY to preview, before Confirm, to exercise durable restart.
    for (;;) {
      await page.pause();
      const original = await apiRequest(
        apiOrigin,
        credentials,
        "GET",
        `/purchases/posted/${quantityPurchaseId}`,
      );
      expect(original.status).toBe(200);
      const active = (
        original.body as {
          activeAdjustmentDrafts: { id: string }[];
        }
      ).activeAdjustmentDrafts[0];
      if (active !== undefined) {
        const saved = await apiRequest(
          apiOrigin,
          credentials,
          "GET",
          purchaseAdjustmentDraftPath(active.id),
        );
        expect(saved.status).toBe(200);
        const draft = saved.body as PurchaseAdjustmentDraft;
        if (
          draft.reason === "quantity error" &&
          draft.evidence === "T02 quantity checked" &&
          draft.rows.length === 1 &&
          draft.rows[0]!.enteredQuantity === "8"
        )
          break;
      }
      console.warn(
        "Restart skipped: case A must first Save and review quantity 8, Quantity error, and evidence T02 quantity checked. The fixture will pause again without restarting or clearing your input.",
      );
    }
    await stopProcess(api!);
    api = startApi(apiPort, databaseRoles, credentials);
    await waitForHealth(apiOrigin);
    await page.reload();
    // Remain available for the rest of the human checkpoint; no automatic acceptance.
    await page.pause();
  });

  test("manual T01 Adjustment checkpoint in a disposable pharmacy", async ({
    page,
    context,
  }) => {
    test.skip(
      process.env.BREEV_M2_T01_MANUAL !== "1",
      "Opt-in interactive manual checkpoint",
    );
    test.setTimeout(0);
    await postPurchaseForReview(
      apiOrigin,
      credentials,
      supplierId,
      purchaseProduct.id,
      "MANUAL-T01-4-TO-8",
    );
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    const second = await context.newPage();
    await installDesktopFake(second, renderer.origin, "en", "light");
    await second.goto(`${renderer.origin}#/purchases`);
    // The human performs preview/evidence/concurrent-session checks in these
    // two tabs. Resume restarts the real API and renderer for the second half.
    await page.bringToFront();
    await page.pause();
    await stopProcess(api!);
    api = startApi(apiPort, databaseRoles, credentials);
    await waitForHealth(apiOrigin);
    await page.reload();
    await page.pause();
    await second.close();
  });

  test("searches and reviews immutable purchases entirely by keyboard", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      recordVideo: {
        dir: path.resolve(
          import.meta.dirname,
          "../../../../test-results/issue-52-video",
        ),
        size: { height: 768, width: 1024 },
      },
    });
    const page = await context.newPage();
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    const opener = postedInvoicesTab(page);
    await opener.focus();
    await pressKeyOnFocused(page, opener, "Enter");

    const dialog = page.locator("#purchase-posted-view");
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole("searchbox", {
      name: "Search posted purchases",
    });
    await expect(search).toBeFocused();
    await page.keyboard.type("BROWSER-REVIEW");
    await page.keyboard.press("Enter");
    await expect(dialog.locator(".posted-purchase-list tbody tr")).toHaveCount(
      2,
    );
    await expect(
      dialog.getByRole("columnheader", { name: "Primary Supplier Cost" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("columnheader", { name: "Cost After Discount" }),
    ).toBeVisible();

    const openNewest = dialog
      .getByRole("button", { name: /Open invoice P/u })
      .first();
    await openNewest.focus();
    await pressKeyOnFocused(page, openNewest, "Enter");
    const detail = dialog.locator(".posted-purchase-review");
    await expect(
      detail.locator("header").getByText("Historical snapshot"),
    ).toBeVisible();
    await expect(detail).toContainText(purchaseProduct.displayName);
    await expect(
      detail.locator("dt").getByText("Primary Supplier Cost"),
    ).toBeVisible();
    await expect(
      detail.locator("dt").getByText("Cost After Discount"),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: /delete/iu })).toHaveCount(
      0,
    );

    const initialPurchaseId = new URL(page.url()).hash.split("/")[3]!;
    const navigationResponse = await apiRequest(
      apiOrigin,
      credentials,
      "GET",
      `/purchases/posted/${initialPurchaseId}`,
    );
    expect(navigationResponse.status).toBe(200);
    const maximumNavigationSteps = (
      navigationResponse.body as { navigation: { total: number } }
    ).navigation.total;
    const next = dialog.getByRole("button", { name: /Next/u });
    for (let step = 0; step < maximumNavigationSteps; step += 1) {
      if ((await next.getAttribute("aria-disabled")) === "true") break;
      const currentNumber = await dialog
        .locator("#posted-detail-title")
        .textContent();
      await next.focus();
      await pressKeyOnFocused(page, next, "Enter");
      await expect(dialog.locator("#posted-detail-title")).not.toHaveText(
        currentNumber ?? "",
      );
    }
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await next.focus();
    await pressKeyOnFocused(page, next, "Enter");
    await expect(
      dialog.getByText("This is the last posted purchase invoice."),
    ).toBeAttached();
    const previous = dialog.getByRole("button", { name: /Previous/u });
    const lastHeading = await dialog
      .locator("#posted-detail-title")
      .textContent();
    await previous.focus();
    await pressKeyOnFocused(page, previous, "Enter");
    await expect(dialog.locator("#posted-detail-title")).not.toHaveText(
      lastHeading ?? "",
    );

    const supplierDrilldown = dialog.getByRole("button", {
      name: "Open current supplier record",
    });
    const selectedPurchaseId = new URL(page.url()).hash.split("/")[3]!;
    const selectedPurchase = await apiRequest(
      apiOrigin,
      credentials,
      "GET",
      `/purchases/posted/${selectedPurchaseId}`,
    );
    expect(selectedPurchase.status).toBe(200);
    const selectedSupplier = await apiRequest(
      apiOrigin,
      credentials,
      "GET",
      `/suppliers/${(selectedPurchase.body as { supplierId: string }).supplierId}`,
    );
    expect(selectedSupplier.status).toBe(200);
    await supplierDrilldown.focus();
    await pressKeyOnFocused(page, supplierDrilldown, "Enter");
    await expect(
      dialog.getByRole("heading", {
        name: supplierSchema.parse(selectedSupplier.body).name,
        exact: true,
      }),
    ).toBeVisible();
    const supplierBack = dialog.getByRole("button", {
      name: "Back to invoice",
    });
    await supplierBack.focus();
    await pressKeyOnFocused(page, supplierBack, "Enter");
    await expect(supplierDrilldown).toBeFocused();

    const itemDrilldown = dialog.getByRole("button", {
      name: new RegExp(
        `Open current item record ${purchaseProduct.displayName}`,
        "u",
      ),
    });
    await itemDrilldown.focus();
    await pressKeyOnFocused(page, itemDrilldown, "Enter");
    await expect(dialog.getByText("Current master record")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(itemDrilldown).toBeFocused();

    const backToResults = dialog.getByRole("button", {
      name: "Back to results",
    });
    await backToResults.focus();
    await pressKeyOnFocused(page, backToResults, "Enter");
    const adjustmentInvoice = dialog
      .getByRole("button", { name: /Open invoice P/u })
      .first();
    await adjustmentInvoice.focus();
    await pressKeyOnFocused(page, adjustmentInvoice, "Enter");
    await expect(dialog).toContainText("BROWSER-REVIEW");
    await dialog.screenshot({
      animations: "disabled",
      path: path.join(
        adjustmentEvidenceDir,
        "purchase-adjustment-before-en-light.png",
      ),
    });

    const adjustment = dialog.getByRole("button", { name: "Edit Invoice" });
    await adjustment.focus();
    await pressKeyOnFocused(page, adjustment, "Enter");
    await expect(page).toHaveURL(/\/adjustment$/u);
    await expect(
      dialog.getByRole("heading", {
        name: "Purchase Invoice Adjustment",
      }),
    ).toBeVisible();
    await dialog
      .getByRole("combobox", { name: "Reason" })
      .selectOption("quantity error");
    await dialog
      .getByRole("button", { name: "Create adjustment copy" })
      .click();
    await dialog
      .getByRole("button", { name: "Back to original invoice" })
      .click();
    await expect(dialog.getByRole("alertdialog")).toBeVisible();
    await dialog.getByRole("button", { name: "Continue draft" }).click();
    const adjustedQuantity = dialog.getByRole("textbox", {
      name: new RegExp(`Quantity ${purchaseProduct.displayName}`, "u"),
    });
    await adjustedQuantity.fill("8");
    await dialog.getByRole("button", { name: "Save and review Delta" }).click();
    await expect(
      dialog.getByRole("heading", { name: "Difference and impact" }),
    ).toBeVisible();
    await expect(dialog).toContainText("4 → 8 (4)");
    await dialog.screenshot({
      animations: "disabled",
      path: path.join(
        adjustmentEvidenceDir,
        "purchase-adjustment-summary-en-light.png",
      ),
    });
    await dialog
      .getByRole("button", { name: "Confirm and post Delta" })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Adjustment posted" }),
    ).toBeVisible();
    await expect(dialog).toContainText("-A01/");
    await dialog
      .getByRole("button", { name: "Back to original invoice" })
      .click();
    const adjustmentLink = dialog.getByRole("button", { name: /-A01\//u });
    await expect(adjustmentLink).toBeVisible();
    await adjustmentLink.click();
    await expect(dialog.locator("#posted-adjustment-title")).toContainText(
      "-A01/",
    );
    await dialog.getByRole("button", { name: "Back to invoice" }).click();
    await expect(adjustmentLink).toBeFocused();
    const purchaseReturn = dialog.getByRole("button", {
      name: /Purchase return/iu,
    });
    await purchaseReturn.focus();
    await pressKeyOnFocused(page, purchaseReturn, "Enter");
    await expect(page).toHaveURL(/\/return$/u);
    await expect(
      dialog.getByRole("heading", {
        name: "Purchase Return · goods physically leave stock",
      }),
    ).toBeVisible();
    await dialog.getByLabel("Return reason").fill("Supplier accepted damage");
    await dialog
      .getByLabel("Disposition evidence")
      .fill("Supplier collection note BROWSER-RT-1");
    await dialog
      .getByRole("button", { name: "Create Purchase Return" })
      .click();
    const returnQuantity = dialog.getByRole("textbox", {
      name: new RegExp(`Return quantity ${purchaseProduct.displayName}`, "u"),
    });
    await returnQuantity.focus();
    await returnQuantity.fill("1");
    await dialog
      .getByRole("button", { name: "Save and review physical return" })
      .click();
    await expect(dialog).toContainText("Inventory carrying amount");
    await expect(dialog).toContainText("Supplier balance reduction");
    await dialog.screenshot({
      animations: "disabled",
      path: path.join(
        returnEvidenceDir,
        "purchase-return-summary-en-light.png",
      ),
    });
    await dialog.getByLabel("Your password").fill(OWNER_PASSWORD);
    await dialog
      .getByRole("button", { name: "Approve and post return" })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Purchase Return posted" }),
    ).toBeVisible();
    await expect(dialog).toContainText("PR");
    await dialog
      .getByRole("button", { name: "Back to original invoice" })
      .click();
    // Regression: leaving the return stage restores focus to the correction
    // opener in the same commit that renders the invoice again, so the next
    // keystroke can never land on a stale control.
    await expect(purchaseReturn).toBeFocused();
    const returnLink = dialog.getByRole("button", { name: /PR\d+\//u });
    await expect(returnLink).toBeVisible();
    await returnLink.focus();
    await pressKeyOnFocused(page, returnLink, "Enter");
    await expect(dialog.locator("#posted-return-title")).toContainText("PR");
    await expect(dialog).toContainText("Original invoice");
    await dialog.getByRole("button", { name: "Back to invoice" }).click();
    await expect(returnLink).toBeFocused();

    expect(
      (
        await new AxeBuilder({ page })
          .include("#purchase-posted-view")
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    const video = page.video();
    await context.close();
    await video?.saveAs(
      path.join(returnEvidenceDir, "purchase-return-keyboard.webm"),
    );
  });

  test("renders explicit denied and recoverable unavailable register states", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    denyNextPostedListResponse = true;
    await postedInvoicesTab(page).click();
    const dialog = page.locator("#purchase-posted-view");
    await expect(dialog.getByRole("alert")).toContainText(
      "Access denied. Ask an authorized user",
    );
    await dialog.getByRole("button", { name: "Retry" }).click();
    await expect(
      dialog.locator(".posted-purchase-list tbody tr").first(),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();

    failNextPostedListResponse = true;
    await postedInvoicesTab(page).click();
    // Reopening preserves T05's loaded result set. Explicitly request a fresh
    // list before checking an unavailable response, rather than expecting Close
    // to discard the accepted navigation state.
    await dialog
      .getByRole("searchbox", { name: "Search posted purchases" })
      .press("Enter");
    await expect(dialog.getByRole("alert")).toContainText(
      "The local API is unavailable.",
    );
    await dialog.getByRole("button", { name: "Retry" }).click();
    await expect(
      dialog.locator(".posted-purchase-list tbody tr").first(),
    ).toBeVisible();
  });

  test("keeps posted-review-only roles out of the purchase draft workspace", async ({
    page,
  }) => {
    await page.route("**/identity/state", async (route) => {
      const response = await route.fetch();
      const identity = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: {
          ...identity,
          allowedPermissions: ["purchases.posted.view"],
        },
      });
    });
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);

    const dialog = page.locator("#purchase-posted-view");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();

    await expect(
      page.getByText(
        "Your role can review posted purchases. Purchase draft entry is hidden because this role does not have draft-management permission.",
      ),
    ).toBeVisible();
    await expect(postedInvoicesTab(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Purchase invoice" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Suppliers", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Reports", exact: true }),
    ).toHaveCount(0);
    await page.getByTestId("collapse-menu-trigger").click();
    await expect(
      page.getByRole("link", { name: "Accounts", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#purchase-invoice-view")).toBeHidden();
  });

  test("captures bilingual list and detail evidence in both themes", async ({
    page,
  }) => {
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await page.goto("about:blank");
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/purchases`);
        const postedInvoices = postedInvoicesTab(page);
        await expect(postedInvoices).toHaveAccessibleName(
          locale === "en" ? "Posted invoices" : "فواتير محفوظة",
        );
        await postedInvoices.click();
        const dialog = page.locator("#purchase-posted-view");
        const search = dialog.getByRole("searchbox", {
          name:
            locale === "en"
              ? "Search posted purchases"
              : "البحث في فواتير الشراء",
        });
        await search.fill("BROWSER-REVIEW");
        await search.press("Enter");
        const rows = dialog.locator(".posted-purchase-list tbody tr");
        await expect(rows.first()).toBeVisible();
        expect(await rows.count()).toBeGreaterThanOrEqual(2);
        await dialog.screenshot({
          animations: "disabled",
          path: path.join(
            reviewEvidenceDir,
            `posted-purchase-list-${locale}-${theme}.png`,
          ),
        });
        await dialog
          .locator(".posted-purchase-list tbody tr", {
            hasText: "BROWSER-REVIEW-A",
          })
          .getByRole("button", {
            name: locale === "en" ? /Open invoice/u : /فتح الفاتورة/u,
          })
          .first()
          .click();
        await expect(dialog.locator("#posted-detail-title")).toBeVisible();
        await dialog
          .getByRole("button", {
            name: locale === "en" ? /Purchase return/iu : "فاتورة مردود",
          })
          .click();
        await expect(dialog.locator("#return-title")).toBeVisible();
        await dialog.screenshot({
          animations: "disabled",
          path: path.join(
            returnEvidenceDir,
            `purchase-return-${locale}-${theme}.png`,
          ),
        });
        await dialog
          .getByRole("button", {
            name:
              locale === "en"
                ? "Back to original invoice"
                : "العودة إلى الفاتورة الأصلية",
          })
          .click();
        await dialog
          .getByRole("button", {
            name: locale === "en" ? "Edit Invoice" : "تعديل الفاتورة",
          })
          .click();
        await expect(
          dialog.getByRole("heading", {
            name:
              locale === "en"
                ? "Purchase Invoice Adjustment"
                : "تعديل فاتورة شراء",
          }),
        ).toBeVisible();
        await dialog.screenshot({
          animations: "disabled",
          path: path.join(
            adjustmentEvidenceDir,
            `purchase-adjustment-${locale}-${theme}.png`,
          ),
        });
        await dialog
          .getByRole("button", {
            name:
              locale === "en"
                ? "Back to original invoice"
                : "العودة إلى الفاتورة الأصلية",
          })
          .click();
        await expect(dialog.locator("#posted-detail-title")).toBeVisible();
        expect(
          (await new AxeBuilder({ page }).include("dialog").analyze())
            .violations,
        ).toEqual([]);
        await dialog.screenshot({
          animations: "disabled",
          path: path.join(
            reviewEvidenceDir,
            `posted-purchase-detail-${locale}-${theme}.png`,
          ),
        });
        await dialog
          .getByRole("button", {
            name: locale === "en" ? "Back to results" : "العودة إلى النتائج",
          })
          .click();
        await dialog
          .getByRole("button", {
            name: locale === "en" ? "Close" : "إغلاق",
          })
          .click();
      }
    }
  });

  test("keeps a rejected draft and focuses the named receipt-rule field", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await createPurchaseWithOneRow(
      page,
      renderer.origin,
      supplierId,
      "POST-REJECTED-1",
      "",
    );

    await page.getByRole("button", { name: "Post purchase" }).click();
    const alert = page.locator("#purchase-post-denial");
    await expect(alert).toHaveAttribute("data-denial-code", "expiry-required");
    await expect(alert).toContainText(
      "Posting refused: an expiry date is required for medication and cold-chain items.",
    );
    const expiryCell = page.locator(
      '[data-post-row="0"][data-post-field="expiryDate"]',
    );
    await expect(expiryCell).toHaveAttribute("data-post-error", "true");
    await expect(expiryCell).toBeFocused();
    await expect(page.getByLabel("Supplier invoice number")).toHaveValue(
      "POST-REJECTED-1",
    );
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(2);
  });

  test("allows correcting a missing expiry inline on the draft row and posting successfully", async ({
    page,
  }) => {
    await installDesktopFake(page, renderer.origin, "en", "light");
    await createPurchaseWithOneRow(
      page,
      renderer.origin,
      supplierId,
      "POST-REJECTED-FIX-1",
      "",
    );

    await page.getByRole("button", { name: "Post purchase" }).click();
    const alert = page.locator("#purchase-post-denial");
    await expect(alert).toHaveAttribute("data-denial-code", "expiry-required");
    await expect(alert).toContainText(
      "Posting refused: an expiry date is required for medication and cold-chain items.",
    );
    const expiryCell = page.locator(
      '[data-post-row="0"][data-post-field="expiryDate"]',
    );
    await expect(expiryCell).toHaveAttribute("data-post-error", "true");

    await page.getByRole("button", { name: /^Edit item:/ }).click();
    const expiryInput = page.locator(
      'tr[data-editing="true"] input[type="date"]',
    );
    await expect(expiryInput).toBeVisible();
    await expiryInput.fill("2029-06-30");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Row updated and saved durably."),
    ).toBeVisible();
    await expect(expiryCell).toContainText("2029-06-30");

    await page.getByRole("button", { name: "Post purchase" }).click();
    const receipt = page.locator(".posted-purchase-result");
    await expect(
      receipt.getByRole("heading", { name: "Posted purchase" }),
    ).toBeVisible();
    await expect(receipt).toContainText("POST-REJECTED-FIX-1");
  });

  test("allows deleting a draft row and re-sequencing the remaining rows", async ({
    page,
  }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await installDesktopFake(page, renderer.origin, "en", "light");
    await createPurchaseWithOneRow(
      page,
      renderer.origin,
      supplierId,
      "DELETE-ROW-1",
      "2029-12-31",
    );

    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: /^Delete item:/ }).click();
    await expect(page.getByText("Row deleted from draft.")).toBeVisible();
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(1);
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
    await supplier.click();
    await page.getByRole("option", { name: invalidSupplier.name }).click();
    await invoice.fill("INVALID-SUPPLIER-1");
    await page.getByLabel("Invoice date", { exact: true }).fill("2026-08-15");
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

    await page.getByRole("button", { name: /Start adding items/ }).click();
    await expect(page.getByText(/The change was not saved/)).toBeVisible();
    await expect(invoice).toHaveValue("INVALID-SUPPLIER-1");
    await expect(supplier).toHaveValue(invalidSupplier.name);
    await expect(supplier).toBeFocused();
  });

  test("keeps the item panel in view on an invoice longer than the window", async ({
    page,
  }) => {
    // Twelve committed rows through the REST contract, so the invoice is taller
    // than the packaged window and the page — not a nested scroller — is what
    // moves when the user returns to the item field.
    const created = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/purchases/drafts",
      {
        idempotencyKey: uuidV7(),
        invoiceDate: "2026-09-08",
        settlementContext: "cash",
        supplierId,
        supplierInvoiceNumber: "BROWSER-LONG-INVOICE",
        invoiceOffer: { mode: "none", value: "0" },
      },
    );
    expect(created.status).toBe(201);
    let draft = (created.body as { draft: PurchaseDraft }).draft;
    for (let row = 0; row < 12; row += 1) {
      const committed = await apiRequest(
        apiOrigin,
        credentials,
        "POST",
        purchaseDraftRowsPath(draft.id),
        {
          costFils: "80000",
          enteredQuantity: "1",
          expectedVersion: draft.version,
          expiryDate: "2029-05-31",
          idempotencyKey: uuidV7(),
          itemId: purchaseProduct.id,
          lotNumber: `LONG-${String(row)}`,
          notes: null,
          pricing: { method: "by-price", retailPriceFils: "120000" },
          unit: { kind: "inventory-unit" },
        },
      );
      expect(committed.status).toBe(201);
      draft = (committed.body as { draft: PurchaseDraft }).draft;
    }

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.setViewportSize({ height: 658, width: 1066 });
    await page.goto(`${renderer.origin}#/purchases`);
    await page
      .getByRole("button", { name: "Saved drafts", exact: true })
      .click();
    await page.getByRole("button", { name: /BROWSER-LONG-INVOICE/ }).click();
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(13);
    await expect
      .poll(() =>
        page.evaluate<boolean>(
          "document.documentElement.scrollHeight > document.documentElement.clientHeight",
        ),
      )
      .toBe(true);

    const item = page.getByRole("textbox", {
      name: "Item / Barcode",
      exact: true,
    });
    await item.fill("5012345678949");
    await item.press("Enter");
    const panel = page.locator("aside.purchase-item-panel");
    await expect(panel.locator(".purchase-item-trade-name")).toHaveText(
      purchaseProduct.displayName,
    );

    // Typing continues at the bottom of a long invoice, which scrolls the page
    // away from the panel's own place in the document. The details still have to
    // be on screen there, wholesale price included.
    await page.locator(".purchase-entry-row").scrollIntoViewIfNeeded();
    await item.focus();
    await expect(item).toBeFocused();
    await expect(item).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate<number>("document.documentElement.scrollTop"),
    ).toBeGreaterThan(0);
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expect(
      panel.locator(".purchase-fact-row:nth-child(3) .purchase-fact-value"),
    ).toBeInViewport({ ratio: 1 });
    await expect(panel).toContainText("90000");
  });

  test("brings a refused Purchase Return into view and gives it focus", async ({
    page,
  }) => {
    // Precondition through the REST contract: an eight-line invoice, each line
    // carrying 4 units, so a return of 5 on the first line is refused by the
    // server as over-eligible. The renderer does not clamp the field, so this
    // is the server's refusal and not a local guard. Eight lines also make the
    // return stage genuinely taller than its scrollport, which is the state the
    // refusal has to survive.
    const created = await apiRequest(
      apiOrigin,
      credentials,
      "POST",
      "/purchases/drafts",
      {
        idempotencyKey: uuidV7(),
        invoiceDate: "2026-09-08",
        settlementContext: "debt",
        supplierId,
        supplierInvoiceNumber: "BROWSER-OVER-RETURN",
        invoiceOffer: { mode: "none", value: "0" },
      },
    );
    expect(created.status).toBe(201);
    let returnDraft = (created.body as { draft: PurchaseDraft }).draft;
    for (let row = 0; row < 8; row += 1) {
      const committed = await apiRequest(
        apiOrigin,
        credentials,
        "POST",
        purchaseDraftRowsPath(returnDraft.id),
        {
          costFils: "80000",
          enteredQuantity: "4",
          expectedVersion: returnDraft.version,
          expiryDate: "2029-05-31",
          idempotencyKey: uuidV7(),
          itemId: purchaseProduct.id,
          lotNumber: `OVER-${String(row)}`,
          notes: null,
          pricing: { method: "by-price", retailPriceFils: "120000" },
          unit: { kind: "inventory-unit" },
        },
      );
      expect(committed.status).toBe(201);
      returnDraft = (committed.body as { draft: PurchaseDraft }).draft;
    }
    expect(
      (
        await apiRequest(
          apiOrigin,
          credentials,
          "POST",
          purchaseDraftPostingsPath(returnDraft.id),
          {
            expectedVersion: returnDraft.version,
            idempotencyKey: uuidV7(),
          },
        )
      ).status,
    ).toBe(201);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await postedInvoicesTab(page).click();
    const dialog = page.locator("#purchase-posted-view");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("searchbox", { name: "Search posted purchases" })
      .fill("BROWSER-OVER-RETURN");
    await dialog
      .getByRole("button", { name: /Open invoice P/u })
      .first()
      .click();
    await expect(dialog).toContainText("BROWSER-OVER-RETURN");

    await dialog.getByRole("button", { name: /Purchase return/iu }).click();
    await dialog.getByLabel("Return reason").fill("Damaged in transit");
    await dialog
      .getByLabel("Disposition evidence")
      .fill("Supplier collection note BROWSER-OVER-1");
    await dialog
      .getByRole("button", { name: "Create Purchase Return" })
      .click();
    const returnQuantities = dialog.getByRole("textbox", {
      name: new RegExp(`Return quantity ${purchaseProduct.displayName}`, "u"),
    });
    await expect(returnQuantities).toHaveCount(8);
    const returnQuantity = returnQuantities.first();
    await returnQuantity.fill("5");
    await dialog
      .getByRole("button", { name: "Save and review physical return" })
      .click();

    // The refusal renders at the top of a stage the user has scrolled down to
    // reach the action, inside a dialog that scrolls too. Same contract as the
    // adjustment stage: on screen, focused, and the draft is kept.
    const refusal = dialog
      .locator("section.purchase-return")
      .getByRole("alert");
    await expect(refusal).toContainText(
      "Return quantity exceeds eligible quantity",
    );
    await expect(refusal.locator("code")).toBeHidden();
    await expect(refusal).toBeFocused();
    await expect(refusal).toBeInViewport({ ratio: 1 });
    await expect(refusal).toHaveAttribute("role", "alert");
    await expect(returnQuantity).toHaveValue("5");
    await expect(
      dialog.getByRole("button", { name: "Save and review physical return" }),
    ).toBeVisible();
  });

  test("brings a blocked Delta refusal into view and gives it focus", async ({
    page,
  }) => {
    // Precondition through the REST contract: an invoice of 4, then a linked
    // Purchase Return of 3, so a Delta of 4 -> 1 asks the batch for 2 units
    // that are no longer there and the server refuses it.
    await postPurchaseForReview(
      apiOrigin,
      credentials,
      supplierId,
      purchaseProduct.id,
      "BROWSER-BLOCKED-DELTA",
    );
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/purchases`);
    await postedInvoicesTab(page).click();
    const dialog = page.locator("#purchase-posted-view");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("searchbox", { name: "Search posted purchases" })
      .fill("BROWSER-BLOCKED-DELTA");
    await dialog
      .getByRole("button", { name: /Open invoice P/u })
      .first()
      .click();
    await expect(dialog).toContainText("BROWSER-BLOCKED-DELTA");

    await dialog.getByRole("button", { name: /Purchase return/iu }).click();
    await dialog.getByLabel("Return reason").fill("Supplier accepted damage");
    await dialog
      .getByLabel("Disposition evidence")
      .fill("Supplier collection note BROWSER-BLOCKED-1");
    await dialog
      .getByRole("button", { name: "Create Purchase Return" })
      .click();
    await dialog
      .getByRole("textbox", {
        name: new RegExp(`Return quantity ${purchaseProduct.displayName}`, "u"),
      })
      .fill("3");
    await dialog
      .getByRole("button", { name: "Save and review physical return" })
      .click();
    await dialog.getByLabel("Your password").fill(OWNER_PASSWORD);
    await dialog
      .getByRole("button", { name: "Approve and post return" })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Purchase Return posted" }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Back to original invoice" })
      .click();

    await dialog.getByRole("button", { name: "Edit Invoice" }).click();
    await dialog
      .getByRole("combobox", { name: "Reason" })
      .selectOption("quantity error");
    await dialog
      .getByRole("button", { name: "Create adjustment copy" })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Create adjustment copy" }),
    ).toBeHidden();
    await dialog
      .getByRole("textbox", {
        name: new RegExp(`Quantity ${purchaseProduct.displayName}`, "u"),
      })
      .fill("1");
    await dialog.getByRole("button", { name: "Save and review Delta" }).click();

    // The refusal renders at the top of a correction stage the user has already
    // scrolled down, inside a dialog that scrolls too. It is only a refusal the
    // user can act on if it is on screen and announced, so it takes focus in
    // the commit that renders it.
    const refusal = dialog
      .locator("section.purchase-adjustment")
      .getByRole("alert");
    await expect(refusal).toContainText(
      "This Delta is not valid against current stock.",
    );
    await expect(refusal).toBeFocused();
    await expect(refusal).toBeInViewport({ ratio: 1 });
    await expect(refusal).toHaveAttribute("role", "alert");
    // The refusal keeps the draft: the Delta is still editable behind it.
    await expect(
      dialog.getByRole("button", { name: "Save and review Delta" }),
    ).toBeVisible();
  });

  test("prints the purchase snapshot as an A4 document in Arabic and English", async ({
    page,
  }) => {
    const printDir = path.resolve(
      import.meta.dirname,
      "../../../../test-results/purchase-snapshot-print",
    );
    await mkdir(printDir, { recursive: true });
    for (const locale of ["ar", "en"] as const) {
      await page.goto("about:blank");
      await installDesktopFake(page, renderer.origin, locale, "light");
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.goto(`${renderer.origin}#/purchases`);
      await postedInvoicesTab(page).click();
      const dialog = page.locator("#purchase-posted-view");
      const search = dialog.getByRole("searchbox", {
        name:
          locale === "ar"
            ? "البحث في فواتير الشراء"
            : "Search posted purchases",
      });
      await search.fill("BROWSER-REVIEW-A");
      await search.press("Enter");
      await dialog
        .getByRole("button", {
          name: locale === "ar" ? /فتح الفاتورة P/u : /Open invoice P/u,
        })
        .first()
        .click();
      const review = dialog.locator(".posted-purchase-review");
      await expect(review).toBeVisible();
      const number = (
        await dialog.locator("#posted-detail-title").innerText()
      ).trim();
      const supplierCost = await moneyBeside(
        review,
        locale === "ar" ? "الكلفة" : "Primary supplier cost",
      );
      const allowance = await moneyBeside(
        review,
        locale === "ar" ? "مبلغ السماح" : "Allowance amount",
      );
      const afterAllowance = await moneyBeside(
        review,
        locale === "ar" ? "الكلفة بعد الخصم" : "Cost after discount",
      );
      const sheet = page.locator("body > .purchase-snapshot-print");
      await expect(sheet).toBeHidden();
      await page.emulateMedia({ media: "print" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
      await expect(page.locator("#root")).toBeHidden();
      await expect(sheet.locator("button, a, input")).toHaveCount(0);
      await expect(sheet).toContainText(number);
      await expect(sheet).toContainText("Al-Nahrain Medical");
      await expect(sheet).toContainText("BROWSER-REVIEW-A");
      await expect(sheet).toContainText("2026-09-08");
      await expect(sheet).toContainText(supplierCost);
      await expect(sheet).toContainText(allowance);
      await expect(sheet).toContainText(afterAllowance);
      await expect(sheet).toContainText(
        locale === "ar" ? "لقطة نسبة السماح" : "Allowance snapshot",
      );
      await expect(sheet).toContainText(
        locale === "ar" ? "إجماليات الفاتورة" : "Invoice totals",
      );
      await expect(sheet).toContainText(purchaseProduct.displayName);
      await expect(sheet).toContainText(locale === "ar" ? "أشرطة" : "Strip");
      const metrics = await page.evaluate<PrintLayoutMetrics>(
        `(() => {
          const element = document.querySelector(".purchase-snapshot-print");
          const table = element === null ? null : element.querySelector("table");
          const root = document.getElementById("root");
          return {
            buttons:
              element === null
                ? -1
                : element.querySelectorAll("button, a, input").length,
            clientWidth: document.documentElement.clientWidth,
            rootDisplay:
              root === null ? "missing" : getComputedStyle(root).display,
            scrollWidth: document.documentElement.scrollWidth,
            sheetTop:
              element === null ? 999 : element.getBoundingClientRect().top,
            tableWider:
              table !== null && table.scrollWidth > table.clientWidth + 1,
          };
        })()`,
      );
      expect(metrics.rootDisplay).toBe("none");
      expect(metrics.sheetTop).toBeLessThan(8);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(metrics.tableWider).toBe(false);
      expect(metrics.buttons).toBe(0);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: path.join(printDir, `snapshot-${locale}.png`),
      });
      const pdf = await page.pdf({
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
      });
      await writeFile(path.join(printDir, `snapshot-${locale}.pdf`), pdf);
      const mediaBox =
        /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/u.exec(
          pdf.toString("latin1"),
        );
      expect(mediaBox).not.toBeNull();
      expect(Number(mediaBox?.[1])).toBeGreaterThan(590);
      expect(Number(mediaBox?.[1])).toBeLessThan(600);
      expect(Number(mediaBox?.[2])).toBeGreaterThan(835);
      expect(Number(mediaBox?.[2])).toBeLessThan(850);
      await page.emulateMedia({ media: "screen" });
    }
  });
});

/**
 * Proves the row workspace's sections are laid out one after another.
 *
 * The workspace is a grid whose table wrapper is a scroll container, so its
 * automatic minimum height is zero. Get the track sizing wrong and the grid
 * either crushes the table away or lets it paint over the section below — and
 * neither shows up in an assertion about any single element, because every
 * individual rect stays plausible. Comparing consecutive siblings is what
 * catches it.
 */
async function expectWorkspaceSectionsStacked(page: Page): Promise<void> {
  // Evaluated as source text: this test project carries no DOM library, so a
  // typed callback cannot name `document`.
  const overlaps = await page.evaluate<string[]>(
    `(() => {
      const workspace = document.querySelector(".purchase-row-workspace");
      if (workspace === null) return ["no workspace"];
      const boxes = [...workspace.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          name: child.className || child.tagName,
          top: rect.top,
        };
      });
      const found = [];
      for (let index = 1; index < boxes.length; index += 1) {
        const previous = boxes[index - 1];
        const current = boxes[index];
        // Half a pixel of rounding is not an overlap; a section drawn over its
        // neighbour is.
        if (current.top + 0.5 < previous.bottom) {
          found.push(
            previous.name +
              " (bottom " +
              Math.round(previous.bottom) +
              ") overlaps " +
              current.name +
              " (top " +
              Math.round(current.top) +
              ")",
          );
        }
      }
      return found;
    })()`,
  );
  expect(overlaps).toEqual([]);
}

/**
 * Places the row table's base-unit preview column.
 *
 * The defect was horizontal: the column sat past the right edge of the window
 * (LTR) or past the left (RTL), reachable only by dragging a scrollbar. So the
 * horizontal claim is asserted directly against the viewport, independently of
 * where the page happens to be scrolled vertically.
 */
async function expectBaseUnitColumnOnScreen(cell: Locator): Promise<void> {
  // Vertical position is a scrolling question — a long invoice puts the entry
  // row below the fold at any window size — so the row is brought to the middle
  // of the viewport first. `inline: "nearest"` keeps that scroll vertical, and
  // the check below proves the table has nowhere to scroll sideways anyway.
  await cell.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
  });
  // The viewport width is passed in rather than read as `window.innerWidth`:
  // this test project carries no DOM library, so a typed callback cannot name
  // browser globals.
  const viewportWidth = cell.page().viewportSize()?.width ?? 0;
  await expect
    .poll(() =>
      cell.evaluate((element, width) => {
        const wrap = element.closest(".purchase-row-table-wrap");
        if (wrap === null) return false;
        const rect = element.getBoundingClientRect();
        return (
          wrap.scrollWidth <= wrap.clientWidth &&
          wrap.scrollLeft === 0 &&
          element.ownerDocument.documentElement.scrollLeft === 0 &&
          rect.width > 0 &&
          rect.left >= 0 &&
          rect.right <= width
        );
      }, viewportWidth),
    )
    .toBe(true);
  await expect(cell).toBeVisible();
  await expect(cell).toBeInViewport({ ratio: 1 });
}

function postedInvoicesTab(page: Page): Locator {
  return page.locator(
    'button.purchase-view-tab[aria-controls="purchase-posted-view"]',
  );
}

async function moneyBeside(review: Locator, label: string): Promise<string> {
  return (
    await review
      .locator("dt", { hasText: label })
      .first()
      .locator("xpath=following-sibling::dd[1]")
      .innerText()
  ).trim();
}

async function createPurchaseWithOneRow(
  page: Page,
  rendererOrigin: string,
  supplierId: string,
  invoiceNumber: string,
  expiryDate: string,
  locale: "ar" | "en" = "en",
): Promise<void> {
  const labels =
    locale === "ar"
      ? {
          cost: "الكلفة الأساسية",
          expiry: "تاريخ الانتهاء",
          invoice: "رقم فاتورة المورد",
          item: "الصنف / الباركود",
          quantity: "الكمية",
          save: "حفظ المسودة",
          saved: "تم حفظ المسودة بشكل دائم.",
          sellingPrice: "سعر البيع",
          supplier: "اسم المورد",
        }
      : {
          cost: "Primary cost",
          expiry: "Expiry",
          invoice: "Supplier invoice number",
          item: "Item / Barcode",
          quantity: "Quantity",
          save: "Save draft",
          saved: "Draft saved and durable.",
          sellingPrice: "Selling price",
          supplier: "Supplier",
        };
  await page.goto(`${rendererOrigin}#/purchases`);
  await page
    .getByRole("combobox", { name: labels.supplier, exact: true })
    .click();
  await page.locator(`[data-supplier-id="${supplierId}"]`).click();
  await page.getByLabel(labels.invoice).fill(invoiceNumber);
  await page
    .getByLabel(locale === "ar" ? "تاريخ الفاتورة" : "Invoice date", {
      exact: true,
    })
    .fill("2026-09-08");
  await page.getByRole("button", { name: labels.save }).click();
  await expect(page.getByText(labels.saved)).toBeVisible();

  const item = page.getByRole("textbox", { name: labels.item, exact: true });
  const quantity = page.getByLabel(labels.quantity, { exact: true });
  const cost = page.getByLabel(labels.cost, { exact: true });
  const sellingPrice = page.getByLabel(labels.sellingPrice, { exact: true });
  const expiry = page.getByLabel(labels.expiry, { exact: true });
  await item.fill("5012345678949");
  await item.press("Enter");
  await quantity.fill("2");
  await quantity.press("Enter");
  await cost.fill("80000");
  await cost.press("Enter");
  await sellingPrice.fill("120000");
  await sellingPrice.press("Enter");
  if (expiryDate !== "") await expiry.fill(expiryDate);
  await expiry.press("Enter");
  await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(2);
}

async function postPurchaseForReview(
  apiOrigin: string,
  credentials: Credentials,
  supplierId: string,
  productId: string,
  invoiceNumber: string,
): Promise<PurchasePostResult> {
  const created = await apiRequest(
    apiOrigin,
    credentials,
    "POST",
    "/purchases/drafts",
    {
      idempotencyKey: uuidV7(),
      invoiceDate: "2026-09-08",
      settlementContext: "debt",
      supplierId,
      supplierInvoiceNumber: invoiceNumber,
      invoiceOffer: { mode: "none", value: "0" },
    },
  );
  expect(created.status).toBe(201);
  let draft = (created.body as { draft: PurchaseDraft }).draft;
  const committed = await apiRequest(
    apiOrigin,
    credentials,
    "POST",
    purchaseDraftRowsPath(draft.id),
    {
      costFils: "80000",
      enteredQuantity: "4",
      expectedVersion: draft.version,
      expiryDate: "2029-05-31",
      idempotencyKey: uuidV7(),
      itemId: productId,
      lotNumber: "REVIEW-LOT",
      notes: null,
      pricing: { method: "by-price", retailPriceFils: "120000" },
      unit: { kind: "inventory-unit" },
    },
  );
  expect(committed.status).toBe(201);
  draft = (committed.body as { draft: PurchaseDraft }).draft;
  const posted = await apiRequest(
    apiOrigin,
    credentials,
    "POST",
    purchaseDraftPostingsPath(draft.id),
    { expectedVersion: draft.version, idempotencyKey: uuidV7() },
  );
  expect(posted.status).toBe(201);
  return posted.body as PurchasePostResult;
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
      if (
        request.url?.startsWith("/identity/") ||
        request.url?.startsWith("/catalog/") ||
        request.url?.startsWith("/suppliers") ||
        request.url?.startsWith("/purchases/")
      ) {
        if (
          request.method === "GET" &&
          request.url.startsWith("/purchases/posted") &&
          denyNextPostedListResponse
        ) {
          denyNextPostedListResponse = false;
          response.writeHead(403, { "content-type": "application/json" }).end(
            JSON.stringify({
              code: "permission-denied",
              requestId: "018fa000-0000-7000-8000-000000000051",
              requiredPermission: "purchases.posted.view",
              status: "denied",
            }),
          );
          return;
        }
        if (
          request.method === "GET" &&
          request.url.startsWith("/purchases/posted") &&
          failNextPostedListResponse
        ) {
          failNextPostedListResponse = false;
          response
            .writeHead(503, { "content-type": "application/json" })
            .end("{}");
          return;
        }
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
        if (
          delayNextPurchasePostResponse &&
          request.method === "POST" &&
          /\/purchases\/drafts\/[^/]+\/postings$/u.test(request.url)
        ) {
          delayNextPurchasePostResponse = false;
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

function medicationRequest(
  tradeName: string,
  barcode: string,
): ProductCreateRequest {
  return {
    arabicSearchName: "اختبار الشراء",
    barcodes: [{ kind: "product", value: barcode }],
    category: "Pain relief",
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "GSK",
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
        purchase: { kind: "package-unit", packageUnitName: "Pack" },
        sale: { kind: "inventory-unit" },
      },
      inventoryUnitName: "Strip",
      packageUnits: [{ baseUnitsPerPackage: "4", name: "Pack" }],
      thirdUnit: { name: "Treatment day" },
    },
    pricing: {
      method: "by-price",
      retailPriceFils: "100000",
      wholesalePriceFils: "90000",
    },
    scientificName: "Paracetamol",
    sharing: { aiSharingAllowed: false, externallyVisible: true },
    stateColours: { coldStorageRequired: false, manual: "blue" },
    stockLevels: { maximumLevel: null, minimumLevel: null, reorderPoint: null },
  };
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
        printBarcodeLabel: async () => ({ status: "handed-off" as const }),
        exportDiagnostics: async () => ({ status: "saved" as const }),
        saveInventoryExport: async () => ({ status: "saved" as const }),
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
  apiStartupOutput = "";
  const api = spawn(
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
  const capture = (chunk: Buffer): void => {
    let output = chunk.toString();
    for (const secret of [
      roles.applicationUrl,
      roles.migrationUrl,
      credentials.deviceSecret,
      credentials.sessionToken,
    ]) {
      output = output.replaceAll(secret, "[redacted]");
    }
    apiStartupOutput = (apiStartupOutput + output).slice(-8000);
  };
  api.stdout.on("data", capture);
  api.stderr.on("data", capture);
  return api;
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch {
      // The process has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Local API did not become healthy at ${origin}\n${apiStartupOutput}`,
  );
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
