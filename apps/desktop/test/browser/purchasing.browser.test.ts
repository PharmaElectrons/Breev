import { AxeBuilder } from "@axe-core/playwright";
import type { BreevDesktopApi } from "@breev/contracts/desktop-preload";
import {
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  LOCAL_DEVICE_ID_HEADER,
  LOCAL_DEVICE_SESSION_HEADER,
  supplierSchema,
  type Product,
  type ProductCreateRequest,
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

  test.beforeAll(async () => {
    await mkdir(evidenceDir, { recursive: true });
    await mkdir(rowEvidenceDir, { recursive: true });
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

    await page.getByLabel("Invoice date").fill("2026-08-15");
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
    await expect(page.getByText("Draft saved and durable.")).toBeVisible();
    await expect(
      page
        .locator(".purchase-snapshot")
        .getByText("Version", { exact: true })
        .locator(".."),
    ).toContainText("1");
    await page
      .getByRole("button", { name: "Search invoices", exact: true })
      .click();
    const search = page.getByRole("searchbox", { name: "Search invoices" });
    await search.fill("SUP-2026-0042");
    await expect(
      page.locator(".purchase-draft-table tbody tr", {
        hasText: "SUP-2026-0042",
      }),
    ).toBeVisible();
    let filterOpenedDiscard = false;
    page.once("dialog", async (dialog) => {
      filterOpenedDiscard = true;
      await dialog.dismiss();
    });
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await search.press("Escape");
    await page.waitForTimeout(50);
    expect(filterOpenedDiscard).toBe(false);
    page.removeAllListeners("dialog");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: /Saved drafts/ }).click();
    await search.fill("missing invoice");
    await expect(
      page.getByText("No drafts match these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
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
    await invoice.fill("SUP-2026-0042");
    await supplier.selectOption(supplierId);
    await page.getByLabel("Invoice date").fill("2026-08-15");
    await page.getByRole("button", { name: "Save draft" }).click();
    const warning = page.getByRole("alert");
    await expect(warning).toContainText("already recorded");
    await expect(warning).toContainText("Current rule: warn");
    await expect(page.getByText("Draft saved and durable.")).toBeVisible();

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.keyboard.press("Escape");
    await expect(
      page.locator(".purchase-snapshot").getByText("2.5%", { exact: true }),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("Draft discarded after confirmation."),
    ).toBeVisible();
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
    await page.getByLabel("Supplier invoice number").fill("ROWS-49");
    await page
      .getByRole("combobox", { name: "Supplier", exact: true })
      .selectOption(supplierId);
    await page.getByLabel("Invoice date").fill("2026-09-07");
    await page.getByRole("button", { name: "Save draft" }).click();

    const item = page.getByRole("textbox", {
      name: "Item / Barcode",
      exact: true,
    });
    const quantity = page.getByRole("textbox", {
      name: "Quantity",
      exact: true,
    });
    const cost = page.getByRole("textbox", {
      name: "Primary cost",
      exact: true,
    });
    const sellingPrice = page.getByRole("textbox", {
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
      page.getByText(purchaseProduct.displayName, { exact: true }).last(),
    ).toBeVisible();

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
    ).toBeDisabled();
    await expect(page.locator(".purchase-review")).toContainText("160000");
    await expect(page.locator(".purchase-row-table tbody tr")).toHaveCount(2);

    await item.fill("5012345678956");
    await item.press("Enter");
    await expect(
      page.getByText(percentageProduct.displayName).last(),
    ).toBeVisible();
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
      .getByRole("radio", { name: "Return to Item / Barcode" })
      .check();
    await settings
      .getByRole("button", { name: "Move earlier: Expiry" })
      .click();
    await settings.getByRole("button", { name: "Save entry settings" }).click();
    await expect(
      page.getByText("Purchase entry settings saved."),
    ).toBeVisible();
    await expect(page.locator(".purchase-row-table thead th")).toHaveText([
      "#",
      "Quantity",
      "Item / Barcode",
      "Expiry",
      "Primary cost",
      "Inventory Units",
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
    await expect(resumedItem).toBeFocused();

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
    await page
      .getByRole("combobox", { name: "Supplier", exact: true })
      .selectOption(supplierId);
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
    ).toHaveValue(supplierId);
    await suppliersView.click();
    await expect(page.getByLabel("Supplier name", { exact: true })).toHaveValue(
      "Unfinished supplier",
    );
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
    await expect(page.getByTestId("shell-state")).toBeHidden();
    const statusToggle = page.locator(".purchase-connection > summary");
    await statusToggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shell-state")).toHaveText("Ready");
    await expect(page.getByRole("button", { name: "Check now" })).toBeVisible();
    await statusToggle.press("Enter");
    await expect(page.getByTestId("shell-state")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Import from image" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Barcode / item search")).toBeDisabled();
    await expect(
      page
        .locator(".purchase-actions")
        .getByRole("button", { name: "Print invoice", exact: true }),
    ).toBeDisabled();
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

    await page.getByRole("button", { name: "Save draft" }).click();
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
        request.url?.startsWith("/catalog/") ||
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
