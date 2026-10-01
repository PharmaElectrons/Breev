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
  inventoryBatchStatusChangePath,
  inventoryReportExportSchema,
  purchaseDraftPostingsPath,
  purchaseDraftRowsPath,
  purchasePostedPath,
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
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { serializeInventoryReportCsv } from "../../src/main/inventory-report-csv.js";

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

test.use({ trace: "retain-on-failure" });

test.describe.serial("read-only inventory review", () => {
  let administrator: Pool;
  let api: ChildProcessWithoutNullStreams | undefined;
  let apiOrigin = "";
  let credentials: Credentials;
  let databaseRoles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let product: Product;
  let supplier: Supplier;
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
    supplier = await createSupplier();
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
    await expect(page.locator("#inventory-title")).toHaveText(
      "Inventory review",
    );
    await expect(page.getByText("Total inventory value")).toBeVisible();
    await expect(page.getByText("Distinct items")).toBeVisible();
    await expect(
      page.locator(".inventory-metric[data-tone='accent']").first(),
    ).toHaveCSS("color", "rgb(30, 42, 51)");
    const settingsSummary = page.getByText("Column settings", { exact: true });
    const exportButton = page.getByRole("button", {
      name: "Export sensitive inventory data",
    });
    await expect(settingsSummary).toBeVisible();
    await expect(exportButton).toBeVisible();
    const settingsBox = await settingsSummary.boundingBox();
    const exportBox = await exportButton.boundingBox();
    expect(settingsBox?.height).toBe(exportBox?.height);
    const balanceHeader = page.getByRole("columnheader", {
      name: "Current balance",
    });
    const balanceButton = balanceHeader.getByRole("button");
    await expect(
      page.getByRole("columnheader", { name: "Item" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await expect(balanceHeader.locator(".inventory-sort-icon")).toHaveText("↕");
    await expect(
      page.getByRole("columnheader", { name: "Batches" }),
    ).not.toHaveAttribute("aria-sort", /.+/u);
    await expect(
      page
        .getByRole("columnheader", { name: "Batches" })
        .locator(".inventory-sort-icon"),
    ).toHaveText("↕");
    await balanceButton.focus();
    await pressKeyOnFocused(page, balanceButton, "Enter");
    await expect(balanceHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(balanceHeader.locator(".inventory-sort-icon")).toHaveText("↑");
    await pressKeyOnFocused(page, balanceButton, "Enter");
    await expect(balanceHeader).toHaveAttribute("aria-sort", "descending");
    await expect(balanceHeader.locator(".inventory-sort-icon")).toHaveText("↓");
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
    const search = page.getByRole("searchbox", {
      name: "Search by item name or barcode",
    });
    await search.fill(product.displayName.slice(0, 7));
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await search.fill(product.barcodes[0]!.value);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await search.fill("");
    const reviewRow = page.locator("tbody tr:first-child");
    await reviewRow.locator('td[data-column-field="balance"]').click();
    await expect(reviewRow).toHaveAttribute("data-selected", "true");
    const cartAction = reviewRow.getByRole("button", {
      name: `Add ${product.displayName} to the order basket`,
    });
    await expect(cartAction).toHaveAttribute("title", "Add to order basket");
    await expect(cartAction).toHaveText("");
    await expect(page.locator(".inventory-selection")).toContainText(
      product.displayName,
    );
    await expect(page.locator(".inventory-selection a")).toHaveAttribute(
      "href",
      `#/inventory/items/${product.id}/movements`,
    );
    await expect(page.locator(".inventory-selection")).toContainText(
      "Current balance",
    );
    await reviewRow.focus();
    await reviewRow.press("Enter");
    await expect(reviewRow).toHaveAttribute("data-selected", "true");
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
        await expect(page.locator("#inventory-title")).toHaveText(
          locale === "ar" ? "مراجعة المخزون" : "Inventory review",
        );
        await assertInventoryRow(page, locale);
        for (const viewport of [
          { height: 900, width: 1440 },
          { height: 800, width: 1280 },
          { height: 800, width: 1100 },
          { height: 768, width: 1024 },
        ]) {
          await page.setViewportSize(viewport);
          await expect(page.locator(".inventory-search input")).toBeInViewport({
            ratio: 1,
          });
          await expect(
            page.getByRole("link", {
              name: locale === "ar" ? "بدء جلسة جرد" : "Start count session",
            }),
          ).toBeInViewport({ ratio: 1 });
          await expect
            .poll(() =>
              page.evaluate<boolean>(
                "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
              ),
            )
            .toBe(true);
        }
        await page.setViewportSize({ height: 800, width: 1280 });
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

  test("shows all seven read-only reports in both languages and themes", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await mkdir(evidencePath("issue-64", "after"), { recursive: true });
    for (const locale of ["ar", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { height: 800, width: 1280 },
        });
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
        await expect(page.locator("#inventory-reports-title")).toHaveText(
          locale === "ar" ? "تقارير المخزون" : "Inventory reports",
        );
        await expect(page.locator(".report-categories button")).toHaveCount(7);
        await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
        await expect(
          page.locator(".report-table th[aria-sort='ascending']"),
        ).toHaveCount(1);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        await expect(page.locator(".report-actions")).toBeInViewport({
          ratio: 1,
        });
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-64",
            "after",
            `quantity-${locale}-${theme}.png`,
          ),
        });
        await assertReportTextResize(page);
        const sourceButton = page
          .locator(".report-table tbody tr")
          .first()
          .locator("td")
          .last()
          .getByRole("button");
        await sourceButton.click();
        await expect(page.locator(".report-source-dialog")).toBeVisible();
        await expect(
          page
            .locator(
              ".report-source-dialog .posted-purchase-snapshot, .report-source-dialog .report-correction-snapshot",
            )
            .first(),
        ).toBeVisible();
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-64",
            "after",
            `purchase-source-${locale}-${theme}.png`,
          ),
        });
        await page.locator(".report-source-dialog header button").click();
        await expect(sourceButton).toBeFocused();
        const captureActivity = async (kind: string) => {
          const rows = page.locator(".report-table tbody tr");
          if ((await rows.count()) === 0) return;
          const opener = rows.first().locator("td").nth(-2).getByRole("button");
          await opener.focus();
          await pressKeyOnFocused(page, opener, "Enter");
          const activity = page.locator(
            "dialog[aria-labelledby='report-activity-title']",
          );
          await expect(activity).toBeVisible();
          await expect(activity).toHaveAttribute(
            "dir",
            locale === "ar" ? "rtl" : "ltr",
          );
          await expect(activity.locator("header button")).toBeFocused();
          await expect(activity.locator("footer")).toBeInViewport({ ratio: 1 });
          await expect(
            activity.locator("footer button").first(),
          ).toHaveAttribute("aria-disabled", "true");
          await expect(
            activity
              .locator(".report-activity-list, p[role='status']")
              .filter({ hasNotText: locale === "ar" ? "جارٍ" : "Loading" }),
          ).toHaveCount(1);
          if (locale === "ar") {
            await expect(activity).not.toContainText(
              /Count session|purchase-receipt|purchase-adjustment|purchase-return|count-variance|Asia\/Baghdad/u,
            );
          }
          if (kind === "quantity") {
            const references = activity.locator(
              ".report-source-reference:enabled",
            );
            for (let index = 0; index < (await references.count()); index++) {
              const reference = references.nth(index);
              await reference.focus();
              await pressKeyOnFocused(page, reference, "Enter");
              const snapshot = page.locator(".report-source-dialog");
              await expect(snapshot).toBeVisible();
              await expect(snapshot).toHaveAttribute(
                "dir",
                locale === "ar" ? "rtl" : "ltr",
              );
              await expect(snapshot.locator("table")).toBeVisible();
              for (const total of await snapshot
                .locator(".report-snapshot-totals dd")
                .all())
                await expect(total).not.toHaveText("—");
              const close = snapshot.locator("header button");
              await expect(close).toBeFocused();
              if (locale === "ar")
                await expect(snapshot).not.toContainText(
                  /Strip|quantity error/u,
                );
              for (const viewport of [
                { width: 800, height: 600 },
                { width: 640, height: 480 },
              ]) {
                await page.setViewportSize(viewport);
                await expect(close).toBeInViewport({ ratio: 1 });
                await expect
                  .poll(() =>
                    snapshot.evaluate(
                      (element) => element.scrollWidth <= element.clientWidth,
                    ),
                  )
                  .toBe(true);
              }
              await page.setViewportSize({ width: 1280, height: 800 });
              expect(
                (await new AxeBuilder({ page }).analyze()).violations,
              ).toEqual([]);
              await page.screenshot({
                path: evidencePath(
                  "issue-64",
                  "after",
                  `report-snapshot-${index}-${locale}-${theme}.png`,
                ),
              });
              await pressKeyOnFocused(page, close, "Shift+Tab");
              expect(
                await snapshot.evaluate((element) =>
                  element.contains(element.ownerDocument.activeElement),
                ),
              ).toBe(true);
              await page.keyboard.press("Escape");
              await expect(snapshot).toHaveCount(0);
              await expect(reference).toBeFocused();
            }
            await page.setViewportSize({ width: 640, height: 480 });
            await expect(activity.locator("footer")).toBeInViewport({
              ratio: 1,
            });
            await expect(activity.locator("header button")).toBeInViewport({
              ratio: 1,
            });
            await expect
              .poll(() =>
                activity.evaluate(
                  (element) => element.scrollWidth <= element.clientWidth,
                ),
              )
              .toBe(true);
            await page.setViewportSize({ width: 1280, height: 800 });
          }
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
            [],
          );
          await page.screenshot({
            animations: "disabled",
            fullPage: true,
            path: evidencePath(
              "issue-64",
              "after",
              `${kind}-activity-${locale}-${theme}.png`,
            ),
          });
          await activity.locator("header button").click();
          await expect(opener).toBeFocused();
        };
        await captureActivity("quantity");
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        for (const kind of [
          "value",
          "average-cost",
          "batches-expiry",
          "consumption",
          "alerts",
          "stocktake-movements",
        ] as const) {
          await page.goto(`${renderer.origin}#/reports/inventory/${kind}`);
          await expect(
            page.locator(".report-categories button[aria-current='page']"),
          ).toBeVisible();
          await expect(page.locator(".report-actions")).toBeVisible();
          await expect(page.locator(".report-timezone")).toHaveText(
            locale === "ar" ? "توقيت بغداد" : "Asia/Baghdad",
          );
          if (locale === "ar")
            await expect(page.locator(".report-table")).not.toContainText(
              /Strip|Count session|Report saved|eligible|available|quarantined/u,
            );
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
            [],
          );
          await page.screenshot({
            animations: "disabled",
            fullPage: true,
            path: evidencePath(
              "issue-64",
              "after",
              `${kind}-${locale}-${theme}.png`,
            ),
          });
          await assertReportTextResize(page);
          await captureActivity(kind);
        }
        await context.close();
      }
    }
  });

  test("normalizes Arabic report date entry including month ١٠ and submitted business dates", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "ar", "light");
    await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
    await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
    const posting = page.locator(
      ".report-date-toolbar input:not([aria-hidden])",
    );
    await expect(
      page.getByRole("button", { name: "اختيار التاريخ", exact: true }),
    ).toHaveCount(4);
    for (const control of await page.locator(".report-date-entry").all()) {
      const field = await control
        .locator("input:not([aria-hidden])")
        .boundingBox();
      const picker = await control.getByRole("button").boundingBox();
      expect(picker!.x).toBeGreaterThanOrEqual(field!.x + field!.width - 32);
      expect(picker!.x + picker!.width).toBeLessThanOrEqual(
        field!.x + field!.width,
      );
    }
    await page
      .getByRole("button", { name: "اختيار التاريخ", exact: true })
      .first()
      .click();
    await page.keyboard.press("Escape");
    await posting.nth(0).fill("٢٠٢٠-٠١-٠١T٠٠:٠٠:٠٠.٠٠٠");
    await expect(posting.nth(0)).toHaveValue("2020-01-01T00:00:00.000");
    await posting.nth(0).evaluate((input) => {
      const field = input as typeof input & {
        focus(): void;
        setSelectionRange(start: number, end: number): void;
      };
      field.focus();
      field.setSelectionRange(5, 7);
    });
    await expect(posting.nth(0)).toBeFocused();
    await page.keyboard.insertText("١");
    await page.keyboard.insertText("٠");
    await expect(posting.nth(0)).toHaveValue("2020-10-01T00:00:00.000");
    await posting.nth(1).fill("٢٠٢٦-١٠-٠١T٠٠:٠٠:٠٠.٠٠٠");
    await expect(posting.nth(1)).toHaveValue("2026-10-01T00:00:00.000");
    for (const name of ["businessFrom", "businessTo"]) {
      const input = page.locator(`[name='${name}']`);
      await input.fill(name === "businessFrom" ? "٢٠٢٠-٠١-٠١" : "٢٠٢٦-٠١-٠١");
      await input.evaluate((element) => {
        const field = element as typeof element & {
          focus(): void;
          setSelectionRange(start: number, end: number): void;
        };
        field.focus();
        field.setSelectionRange(5, 7);
      });
      await expect(input).toBeFocused();
      await page.keyboard.insertText("١");
      await page.keyboard.insertText("٠");
      await expect(input).toHaveValue(
        name === "businessFrom" ? "2020-10-01" : "2026-10-01",
      );
    }
    for (const language of ["التبديل إلى الإنجليزية", "Switch to Arabic"]) {
      await page.getByTestId("collapse-menu-trigger").click();
      await page.getByRole("button", { name: language, exact: true }).click();
      await expect(page.locator("[name='businessFrom']")).toHaveValue(
        "2020-10-01",
      );
      await expect(page.locator("[name='businessTo']")).toHaveValue(
        "2026-10-01",
      );
    }
    const sent = page.waitForRequest("**/reports/inventory/quantity?*");
    await page.locator(".report-controls button[type='submit']").click();
    expect(
      JSON.parse(new URL((await sent).url()).searchParams.get("query")!),
    ).toMatchObject({
      from: "2020-09-30T21:00:00.000Z",
      to: "2026-09-30T21:00:00.000Z",
      businessFrom: "2020-10-01",
      businessTo: "2026-10-01",
    });
    await expect(page.locator(".report-controls [role='alert']")).toHaveCount(
      0,
    );
  });

  test("keeps the Reports label fully visible on direct entry at 1280×800 in both languages and themes", async ({
    browser,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
        await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
        const link = page.locator(".module-tab[data-module='reports']");
        await expectNavigationLabelVisible(link);
        await page.screenshot({
          path: evidencePath(
            "issue-64",
            "remediation",
            `reports-navigation-${locale}-${theme}.png`,
          ),
        });
        await context.close();
      }
    }
  });

  for (const theme of ["light", "dark"] as const) {
    for (const locale of ["ar", "en"] as const) {
      test(`keeps active Reports navigation visible after ${locale === "ar" ? "Arabic -> English" : "English -> Arabic"} at 1280×800 (${theme})`, async ({
        browser,
      }) => {
        await login(OWNER_USERNAME, OWNER_PASSWORD);
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
        await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
        const link = page.locator(".module-tab[data-module='reports']");
        await expectNavigationLabelVisible(link);
        const menu = page.getByTestId("collapse-menu-trigger");
        await menu.click();
        const language = page.getByRole("button", {
          name: locale === "ar" ? "التبديل إلى الإنجليزية" : "Switch to Arabic",
          exact: true,
        });
        await language.focus();
        await pressKeyOnFocused(page, language, "Enter");
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          locale === "ar" ? "en" : "ar",
        );
        await expect(link).not.toBeFocused();
        await expect(link).toHaveAttribute("aria-current", "page");
        await expectNavigationLabelVisible(link);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await context.close();
      });

      test(`keeps active Reports navigation visible after resize 1920 -> 1280 (${locale}, ${theme})`, async ({
        browser,
      }) => {
        await login(OWNER_USERNAME, OWNER_PASSWORD);
        const context = await browser.newContext({
          viewport: { width: 1920, height: 800 },
        });
        const page = await context.newPage();
        await installDesktopFake(page, renderer.origin, locale, theme);
        await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
        await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
        const link = page.locator(".module-tab[data-module='reports']");
        await expectNavigationLabelVisible(link);
        const submit = page.locator(".report-controls button[type='submit']");
        await submit.focus();
        await expect(submit).toBeFocused();
        await page.setViewportSize({ width: 1280, height: 800 });
        await expectNavigationLabelVisible(link);
        await expect(submit).toBeFocused();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

        // Keyboard focus can still reveal other tabs, and leaving Reports
        // removes its visibility subscription before the next resize.
        const inventory = page.locator(".module-tab[data-module='inventory']");
        await inventory.focus();
        await expectNavigationLabelVisible(inventory);
        await pressKeyOnFocused(page, inventory, "Enter");
        await expect(page.locator("#inventory-title")).toBeVisible();
        await page.setViewportSize({ width: 1920, height: 800 });
        await page.setViewportSize({ width: 1280, height: 800 });
        await expectNavigationLabelVisible(inventory);
        await expect(inventory).toBeFocused();
        await expect(inventory).toHaveAttribute("aria-current", "page");
        await context.close();
      });
    }
  }

  test("traverses immutable adjustment and return sources to the permission-checked parent invoice", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
    await page
      .locator(".report-table tbody tr")
      .first()
      .locator("td")
      .nth(-2)
      .getByRole("button")
      .click();
    const activity = page.locator(".report-activity-dialog");
    for (const type of ["purchase-adjustment", "purchase-return"]) {
      const record = (
        await administrator.query<{ id: string; original_purchase_id: string }>(
          `select id, original_purchase_id from ${type === "purchase-adjustment" ? "posted_purchase_adjustments" : "posted_purchase_returns"} order by posted_at limit 1`,
        )
      ).rows[0]!;
      const source = activity
        .locator(".report-source-reference")
        .filter({ hasText: type === "purchase-adjustment" ? "-A01" : "PR" })
        .first();
      await source.click();
      const snapshot = page.locator(".report-source-dialog");
      await expect(
        snapshot.locator(".report-correction-snapshot"),
      ).toBeVisible();
      const title = await snapshot.locator("h2").textContent();
      const parent = snapshot.getByRole("button", {
        name: "Open original purchase invoice",
        exact: true,
      });
      const opened = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          purchasePostedPath(record.original_purchase_id),
      );
      await parent.click();
      expect((await opened).status()).toBe(200);
      await expect(snapshot.locator(".posted-purchase-snapshot")).toBeVisible();
      await expect(snapshot.locator(".posted-purchase-snapshot")).toContainText(
        product.displayName,
      );
      await snapshot
        .getByRole("button", { name: "Back to source record", exact: true })
        .click();
      await expect(snapshot.locator("h2")).toHaveText(title!);
      await expect(parent).toBeFocused();
      await snapshot.locator("header button").click();
      await expect(source).toBeFocused();
    }
    await activity.locator("header button").click();
    // Permission can change while the immutable correction is already open.
    const temporary = await administrator.query<{
      role_id: string;
      permission_name: string;
    }>(
      `insert into role_permission_grants (pharmacy_id, role_id, permission_name, granted_by)
       select role.pharmacy_id, role.id, permission, (select granted_by from role_permission_grants where role_id = role.id limit 1)
       from pharmacy_roles role cross join unnest(array['reports.inventory.view', 'purchases.posted.view', 'purchases.costs.view']) permission
       where role.role_key = 'manager' on conflict do nothing returning role_id, permission_name`,
    );
    await login(MANAGER_USERNAME, MANAGER_PASSWORD);
    await page.reload();
    await page
      .locator(".report-table tbody tr")
      .first()
      .locator("td")
      .nth(-2)
      .getByRole("button")
      .click();
    await activity
      .locator(".report-source-reference")
      .filter({ hasText: "-A01" })
      .first()
      .click();
    const snapshot = page.locator(".report-source-dialog");
    await expect(snapshot.locator(".report-correction-snapshot")).toBeVisible();
    const revoked = await administrator.query<{
      pharmacy_id: string;
      role_id: string;
      granted_by: string;
    }>(
      "delete from role_permission_grants where role_id = (select id from pharmacy_roles where role_key = 'manager') and permission_name = 'purchases.posted.view' returning pharmacy_id, role_id, granted_by",
    );
    try {
      expect(revoked.rows).toHaveLength(1);
      await snapshot
        .getByRole("button", {
          name: "Open original purchase invoice",
          exact: true,
        })
        .click();
      await expect(snapshot.getByRole("alert")).toHaveText(
        "Your account cannot access this report or source record.",
      );
      await expect(snapshot.locator(".posted-purchase-snapshot")).toHaveCount(
        0,
      );
      await expect(
        snapshot.locator(".report-correction-snapshot"),
      ).toBeVisible();
    } finally {
      const grant = revoked.rows[0];
      if (grant)
        await administrator.query(
          "insert into role_permission_grants (pharmacy_id, role_id, permission_name, granted_by) values ($1, $2, 'purchases.posted.view', $3)",
          [grant.pharmacy_id, grant.role_id, grant.granted_by],
        );
      for (const permission of temporary.rows)
        await administrator.query(
          "delete from role_permission_grants where role_id = $1 and permission_name = $2",
          [permission.role_id, permission.permission_name],
        );
      await login(OWNER_USERNAME, OWNER_PASSWORD);
    }
  });

  test("preserves report keyboard focus through delayed, superseded and failed refreshes", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/reports/inventory/batches-expiry`);
    await expect(page.locator(".report-table tbody tr").first()).toBeVisible();
    const header = page
      .getByRole("columnheader", { name: "Closing quantity" })
      .getByRole("button");
    const gates: Array<{ release: () => void; entered: Promise<void> }> = [];
    let fail = false;
    await page.route("**/reports/inventory/batches-expiry?*", async (route) => {
      if (fail) {
        await route.fulfill({
          status: 503,
          json: { message: "deterministic unavailable fixture" },
        });
        return;
      }
      let release!: () => void;
      let entered!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const acknowledged = new Promise<void>((resolve) => {
        entered = resolve;
      });
      gates.push({ release, entered: acknowledged });
      const response = await route.fetch();
      entered();
      await wait;
      await route.fulfill({ response });
    });
    const requested = page.waitForRequest(
      "**/reports/inventory/batches-expiry?*",
    );
    await header.focus();
    await pressKeyOnFocused(page, header, "Enter");
    await requested;
    await expect(
      page.getByRole("status").filter({ hasText: "Loading report" }),
    ).toBeVisible();
    await expect(header).toBeFocused();
    const nextRequest = page.waitForRequest(
      "**/reports/inventory/batches-expiry?*",
    );
    await pressKeyOnFocused(page, header, "Space");
    await nextRequest;
    await expect.poll(() => gates.length).toBe(2);
    await gates[1]!.entered;
    gates[1]!.release();
    await expect(header.locator("..")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(header).toBeFocused();
    const from = page.getByLabel("From · posting time", { exact: true });
    await from.focus();
    await expect(from).toBeFocused();
    await gates[0]!.entered;
    gates[0]!.release();
    await expect(header.locator("..")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(from).toBeFocused();
    fail = true;
    await header.focus();
    await pressKeyOnFocused(page, header, "Enter");
    await expect(page.getByRole("alert")).toContainText("could not");
    await expect(header).toBeFocused();
    await expect(
      page.getByRole("button", {
        name: "Export CSV · without costs",
        exact: true,
      }),
    ).toBeDisabled();
    await from.fill("2026-09-01T00:00:00.123");
    await page.unroute("**/reports/inventory/batches-expiry?*");
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await retry.focus();
    await pressKeyOnFocused(page, retry, "Enter");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(from).toHaveValue("2026-09-01T00:00:00.123");
    await expect(
      page.getByRole("button", {
        name: "Export CSV · without costs",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Export CSV · without costs",
        exact: true,
      }),
    ).toBeEnabled();
  });

  test("filters exact displayed IQD and localized enums with announced validation", async ({
    browser,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    for (const locale of ["en", "ar"] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await installDesktopFake(page, renderer.origin, locale, "light");
      await page.goto(`${renderer.origin}#/reports/inventory/value`);
      await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
      const add = page.getByRole("button", {
        name: locale === "en" ? "Add column filter" : "إضافة مرشح عمود",
        exact: true,
      });
      await add.click();
      const filter = page.locator(".report-filter-row").first();
      await filter.locator("select").first().selectOption("closingValueFils");
      await filter.locator("input").fill("1.0001");
      const apply = page.getByRole("button", {
        name: locale === "en" ? "Apply filters" : "تطبيق المرشحات",
        exact: true,
      });
      await apply.click();
      await expect(filter.getByRole("alert")).toBeVisible();
      await expect(filter.locator("input")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await filter.locator("select").nth(1).selectOption("gte");
      await filter.locator("input").fill(locale === "ar" ? "-٠٫٠٠١" : "-0.001");
      const submitted = page.waitForRequest("**/reports/inventory/value?*");
      await apply.click();
      const wire = JSON.parse(
        new URL((await submitted).url()).searchParams.get("query")!,
      ) as { filters: Array<{ value: string }> };
      expect(wire.filters[0]!.value).toBe("-1");
      await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
      await expect(filter.getByRole("alert")).toHaveCount(0);
      await page.locator(".report-categories button").nth(3).click();
      await expect(page.locator(".report-table caption")).toContainText(
        locale === "en" ? "Batches" : "الدفعات",
      );
      await add.click();
      await page
        .locator(".report-filter-row select")
        .first()
        .selectOption("status");
      const enumSelect = page.locator(".report-filter-row select").nth(2);
      await enumSelect.selectOption({
        label: locale === "en" ? "Eligible" : "مؤهل",
      });
      const enumRequest = page.waitForRequest(
        "**/reports/inventory/batches-expiry?*",
      );
      await apply.click();
      const enumWire = JSON.parse(
        new URL((await enumRequest).url()).searchParams.get("query")!,
      ) as { filters: Array<{ value: string }> };
      expect(enumWire.filters[0]!.value).toBe("eligible");
      await expect(
        page.locator(".report-table tbody tr").first(),
      ).toBeVisible();
      await context.close();
    }
  });

  test("filters, groups, sorts, and exports the complete report without costs", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
    await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
    await page.getByLabel(/^Group by/u).selectOption("item");
    await page
      .getByRole("button", { name: "Add column filter", exact: true })
      .click();
    await page
      .getByLabel("Filter value", { exact: true })
      .fill("Browser Inventory");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(page.locator(".report-groups li")).toHaveCount(1);
    await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
    const sort = page
      .getByRole("columnheader", { name: "Closing quantity" })
      .getByRole("button");
    await sort.focus();
    await pressKeyOnFocused(page, sort, "Enter");
    await expect(
      page.getByRole("columnheader", { name: "Closing quantity" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await page
      .getByRole("button", { name: "Export CSV · without costs", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Report saved." }),
    ).toBeVisible();
    const wire = await page.evaluate(
      () => (globalThis as { __inventoryExport?: unknown }).__inventoryExport,
    );
    expect(wire).toBeDefined();
    const { format, ...bundle } = wire as Record<string, unknown>;
    expect(format).toBe("csv");
    const exported = inventoryReportExportSchema.parse(bundle);
    const csv = serializeInventoryReportCsv(exported, "en");
    expect(csv.split("\r\n")[0]).toContain('"Recorded item"');
    expect(csv).not.toMatch(
      /Pharmacy ID|Product ID|Applied query|Explanations|openingQuantity/u,
    );
    expect(csv).not.toContain(exported.pharmacyId);
    await mkdir(evidencePath("issue-64", "remediation"), { recursive: true });
    await writeFile(
      evidencePath("issue-64", "remediation", "quantity-en.csv"),
      csv,
    );
    expect(exported.sensitivity).toBe("redacted");
    expect(exported.rows).toHaveLength(exported.totalRows);
    expect(exported.query).toMatchObject({
      groupBy: "item",
      sort: "closingQuantity",
      filters: [
        { column: "item", operator: "contains", value: "Browser Inventory" },
      ],
    });
    expect(
      exported.rows.every((row) => row.cells.closingValueFils === undefined),
    ).toBe(true);
    await page
      .getByRole("button", {
        name: "Protected export · with costs",
        exact: true,
      })
      .click();
    const stepUp = page
      .getByRole("dialog")
      .filter({ has: page.getByLabel("Password", { exact: true }) });
    await stepUp.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
    await stepUp.getByRole("button", { name: "Confirm password" }).click();
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              (globalThis as { __inventoryExport?: { sensitivity?: string } })
                .__inventoryExport?.sensitivity,
          ),
      )
      .toBe("valuation");
    await page
      .getByLabel("Filter value", { exact: true })
      .fill("No matching pharmacy item");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "No matching rows for this period and filters." }),
    ).toBeVisible();
  });

  test("redacts exports after sensitive sorting and refuses sensitive membership", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    await installDesktopFake(page, renderer.origin, "en", "light");
    for (const kind of ["value", "average-cost"]) {
      await page.goto(`${renderer.origin}#/reports/inventory/${kind}`);
      await expect(page.locator(".report-table tbody tr")).toHaveCount(1);
      const column = kind === "value" ? "Closing value" : "Closing WAC / unit";
      const header = page
        .getByRole("columnheader", { name: column })
        .getByRole("button");
      await header.click();
      await expect(header.locator("..")).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      const exportButton = page.getByRole("button", {
        name: "Export CSV · without costs",
        exact: true,
      });
      await expect(exportButton).toBeEnabled();
      await exportButton.click();
      const confirmation = page.getByRole("dialog", {
        name: "Export CSV · without costs",
        exact: true,
      });
      await expect(confirmation).toContainText(
        "order items by name, ascending",
      );
      await confirmation
        .getByRole("button", { name: "Continue to save", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "Report saved." }),
      ).toBeVisible();
      const saved = await page.evaluate(
        () =>
          (globalThis as { __inventoryExport?: Record<string, unknown> })
            .__inventoryExport,
      );
      expect(saved).toBeDefined();
      delete saved!.format;
      const exported = inventoryReportExportSchema.parse(saved);
      expect(exported.query.sort).toBe("item");
      expect(exported.query.direction).toBe("ascending");
      expect(exported.rows[0]!.cells.closingValueFils).toBeUndefined();
      expect(exported.rows[0]!.cells.closingAverageCostScaled).toBeUndefined();
    }
    await page
      .getByRole("button", { name: "Add column filter", exact: true })
      .click();
    await page
      .locator(".report-filter-row select")
      .first()
      .selectOption("closingAverageCostScaled");
    await page.locator(".report-filter-row input").fill("1");
    await page.locator(".report-filter-row select").nth(1).selectOption("gte");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(page.locator("#report-ordinary-blocked")).toContainText(
      "Cost criteria determine",
    );
    await expect(
      page.getByRole("button", {
        name: "Export CSV · without costs",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(page.locator("#report-sensitive-export")).toBeEnabled();
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
        .evaluate(
          () =>
            (globalThis as { __inventoryExport?: { format?: string } })
              .__inventoryExport?.format,
        )
        .catch(() => "missing"),
    ).toBeUndefined();
    await page.getByRole("button", { name: "Export inventory CSV" }).click();
    await dialog.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
    await dialog.getByRole("button", { name: "Confirm password" }).click();
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              (globalThis as { __inventoryExport?: { format?: string } })
                .__inventoryExport?.format,
          ),
      )
      .toBe("csv");

    await login(MANAGER_USERNAME, MANAGER_PASSWORD);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Export sensitive inventory data" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Export inventory CSV" }),
    ).toHaveCount(0);
  });

  test("loads the shared item panel with inventory units, expiry, and coverage", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const expiryDate = "2029-06-15";
    const created = await apiRequest(
      "POST",
      "/catalog/products",
      catalogProduct({
        barcode: "4815162342",
        packageUnits: [
          { baseUnitsPerPackage: "4", name: "Pack" },
          { baseUnitsPerPackage: "20", name: "Box" },
        ],
        stockLevels: {
          maximumLevel: "40",
          minimumLevel: "8",
          reorderPoint: null,
        },
        tradeName: "Panel Parcel Item",
      }),
    );
    expect(created.status).toBe(201);
    const item = created.body as Product;
    await purchaseStock(item, "25", expiryDate, "PANEL-PARCEL");

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory`);
    const row = page.locator("tbody tr").filter({
      hasText: "Panel Parcel Item",
    });
    await expect(row).toBeVisible();
    const panel = page.locator("aside.purchase-item-panel");
    await expect(panel.locator(".purchase-item-empty")).toBeVisible();
    await row.locator("td[data-column-field='balance']").click();
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(panel.locator(".purchase-item-trade-name")).toHaveText(
      item.displayName,
    );
    await expect(panel.locator(".purchase-item-barcode")).toHaveText(
      "4815162342",
    );
    const cells = panel.locator(".purchase-fraction-cell");
    await expect(cells.nth(0).locator(".purchase-fraction-label")).toHaveText(
      "Box",
    );
    await expect(cells.nth(0).locator(".purchase-fraction-num")).toHaveText(
      "1",
    );
    await expect(cells.nth(1).locator(".purchase-fraction-label")).toHaveText(
      "Pack",
    );
    await expect(cells.nth(1).locator(".purchase-fraction-num")).toHaveText(
      "1",
    );
    await expect(cells.nth(2).locator(".purchase-fraction-label")).toHaveText(
      "Strip",
    );
    await expect(cells.nth(2).locator(".purchase-fraction-num")).toHaveText(
      "1",
    );
    await expect(panel.locator(".purchase-fact-value").first()).toHaveText(
      "1 Box = 20 Strip",
    );
    const wholesale = panel.locator(".money-amount");
    await expect(wholesale).toHaveText("IQD 90.000");
    await expect(wholesale).toHaveAttribute("dir", "ltr");
    await expect(wholesale).toHaveCSS("white-space", "nowrap");
    await expect(panel.locator(".stock-unit")).toHaveText("Strip");
    await expect(panel.locator(".stock-min")).toContainText("8");
    await expect(panel.locator(".stock-max")).toContainText("40");
    const expiry = panel.locator(".purchase-fact-row").filter({
      hasText: "Expiry",
    });
    await expect(expiry).toContainText(expiryDate);
    await expect(expiry).toContainText(
      `${String(daysUntil(expiryDate))} d left`,
    );
    await expect(panel.locator(".purchase-rate-control")).toContainText("0");
    await expect(panel.locator(".purchase-rate-control")).toContainText(
      "Strip",
    );
    await expect(
      panel.locator(".purchase-fact-row").filter({
        hasText: "Days of supply",
      }),
    ).toContainText("—");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Switch to Arabic" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(cells.nth(0).locator(".purchase-fraction-label")).toHaveText(
      "Box",
    );
    await expect(cells.nth(1).locator(".purchase-fraction-label")).toHaveText(
      "علبة",
    );
    await expect(cells.nth(2).locator(".purchase-fraction-label")).toHaveText(
      "شريط",
    );
    await expect(panel.locator(".purchase-fact-value").first()).toHaveText(
      "١ Box = ٢٠ شريط",
    );
    await expect(wholesale).toContainText("٩٠٫٠٠٠");
    await expect(wholesale).toContainText("د.ع");
    await expect(wholesale).not.toContainText("IQD");
    await expect(wholesale).not.toHaveAttribute("dir", "ltr");
    await expect(panel.locator(".stock-unit")).toHaveText("شريط");
    await expect(panel.locator(".stock-min")).toContainText("٨");
    await expect(panel.locator(".stock-max")).toContainText("٤٠");
    await expect(panel.locator(".purchase-balance-total-text")).toContainText(
      "٢٥ شريط",
    );
    await expect(panel.locator(".purchase-rate-control")).toContainText(
      "٠ شريط",
    );
  });

  test("finds an item when the barcode is typed with Arabic-Indic digits", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const barcode = "918273645";
    const created = await apiRequest(
      "POST",
      "/catalog/products",
      catalogProduct({
        barcode,
        tradeName: "Arabic Digit Item",
      }),
    );
    expect(created.status).toBe(201);
    await purchaseStock(created.body as Product, "1", "2029-06-15", "AR-DIGIT");

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory`);
    const search = page.getByRole("searchbox", {
      name: "Search by item name or barcode",
    });
    await search.fill(toArabicIndicDigits(barcode));
    const row = page
      .locator("tbody tr")
      .filter({ hasText: "Arabic Digit Item" });
    await expect(row).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });

  test("finds an inventory item past the first 100 catalog matches", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    for (let offset = 0; offset < 101; offset += 10) {
      await Promise.all(
        Array.from({ length: Math.min(10, 101 - offset) }, (_, index) => {
          const number = offset + index;
          return apiRequest(
            "POST",
            "/catalog/products",
            catalogProduct({
              barcode: `77${String(number).padStart(6, "0")}`,
              tradeName: `Zulu Product kind ${String(number).padStart(3, "0")}`,
            }),
          ).then((response) => {
            expect(response.status).toBe(201);
          });
        }),
      );
    }
    const created = await apiRequest(
      "POST",
      "/catalog/products",
      catalogProduct({
        barcode: "760000101",
        tradeName: "Zulu Parcel kept",
      }),
    );
    expect(created.status).toBe(201);
    await purchaseStock(
      created.body as Product,
      "1",
      "2029-06-15",
      "LATE-CATALOG",
    );

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory`);
    await page
      .getByRole("searchbox", { name: "Search by item name or barcode" })
      .fill("zpk");
    const row = page
      .locator("tbody tr")
      .filter({ hasText: "Zulu Parcel kept" });
    await expect(row).toBeVisible();
    await expect(
      page.locator("tbody tr").filter({ hasText: "Zulu Product kind 100" }),
    ).toBeVisible();
    await expect(
      page.locator("tbody tr").filter({ hasText: "Browser Inventory Item" }),
    ).toHaveCount(0);
    await expect(page.locator("tbody tr")).toHaveCount(102);
  });

  test("shows recalled and quarantined badges and sorts risk by medical priority", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const recalled = await stockNamedItem(
      "Zebra Recalled Item",
      "630000001",
      "RECALL-STOCK",
    );
    const quarantined = await stockNamedItem(
      "Alpha Quarantine Item",
      "630000002",
      "QUARANTINE-STOCK",
    );
    await changeBatchStatus(recalled.batchId, "recall");
    await changeBatchStatus(quarantined.batchId, "quarantine");

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory`);
    const recalledRow = page.locator("tbody tr").filter({
      hasText: "Zebra Recalled Item",
    });
    const quarantineRow = page.locator("tbody tr").filter({
      hasText: "Alpha Quarantine Item",
    });
    await expect(
      recalledRow.locator("[data-indicator='recalled']"),
    ).toContainText("Recalled");
    await expect(
      quarantineRow.locator("[data-indicator='quarantined']"),
    ).toContainText("Quarantined");

    const statusHeader = page.getByRole("columnheader", { name: "Status" });
    await statusHeader.getByRole("button").click();
    await expect(statusHeader).toHaveAttribute("aria-sort", "ascending");
    await expect
      .poll(async () => riskOrder(page))
      .toEqual([
        "Zebra Recalled Item",
        "Alpha Quarantine Item",
        "Browser Inventory Item",
      ]);
  });

  test("blocks count completion until the pending variance is applied", async ({
    page,
    browser,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const stocked = await stockNamedItem(
      "Count Gate Item",
      "424242",
      "COUNT-GATE",
      "4",
    );

    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/inventory/count`);
    await page
      .getByRole("button", { name: "Start count session", exact: true })
      .click();
    await expect(page.locator("#count-loop-title")).toBeVisible();
    const item = page.locator("#count-item");
    await item.fill(stocked.barcode);
    await pressKeyOnFocused(page, item, "Enter");
    const strip = page.locator('[data-count-field="unit:Strip"]');
    await expect(strip).toBeFocused();
    await strip.fill("3");
    await pressKeyOnFocused(page, strip, "Enter");
    await expect(item).toBeFocused();

    const complete = page.locator("#count-complete");
    await expect(complete).toBeDisabled();
    await expect(page.locator("#count-complete-blocked")).toContainText(
      "Apply 1 pending variances before completing this session.",
    );

    const row = page.locator("table.count-lines-table tbody tr").filter({
      hasText: "Count Gate Item",
    });
    await row
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Apply variance" });
    // Visibility precedes the dialog's initial focus commit. Synchronize on
    // that commit before typing so a late focus request cannot steal evidence.
    await expect(
      dialog.getByRole("textbox", { name: "Application reason", exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole("textbox", { name: "Application reason", exact: true })
      .fill("Shelf was one strip short");
    await dialog
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Count sheet gate");
    await expect(
      dialog.getByRole("textbox", { name: "Application reason", exact: true }),
    ).toHaveValue("Shelf was one strip short");
    await expect(
      dialog.getByRole("textbox", { name: "Evidence", exact: true }),
    ).toHaveValue("Count sheet gate");
    await dialog
      .getByRole("button", { name: "Apply variance", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(complete).toBeEnabled();
    await expect(page.locator("#count-complete-blocked")).toHaveCount(0);
    await complete.click();
    await expect(complete).toHaveText("Session completed.");
    for (const locale of ["ar", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { height: 800, width: 1280 },
        });
        const reportPage = await context.newPage();
        await installDesktopFake(reportPage, renderer.origin, locale, theme);
        await reportPage.goto(
          `${renderer.origin}#/reports/inventory/stocktake-movements`,
        );
        const reportRow = reportPage
          .locator(".report-table tbody tr")
          .filter({ hasText: "Count Gate Item" });
        await expect(reportRow).toHaveCount(1);
        expect(
          (await new AxeBuilder({ page: reportPage }).analyze()).violations,
        ).toEqual([]);
        await reportPage.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-64",
            "after",
            `stocktake-movements-${locale}-${theme}.png`,
          ),
        });
        const source = reportRow.locator("td").last().getByRole("button");
        await source.click();
        const review = reportPage.locator(".count-session-review-dialog");
        await expect(review).toBeVisible();
        await expect(review).toHaveAttribute(
          "dir",
          locale === "ar" ? "rtl" : "ltr",
        );
        if (locale === "ar")
          await expect(review).not.toContainText(
            /Strip|Count session|applied/u,
          );
        await expect(review.locator("tbody")).toContainText("Count Gate Item");
        await expect(review.locator("input, textarea, select")).toHaveCount(0);
        const reviewClose = review.locator("header button");
        await expect(reviewClose).toBeFocused();
        await pressKeyOnFocused(reportPage, reviewClose, "Shift+Tab");
        await expect(review.locator(".count-review-table-wrap")).toBeFocused();
        await pressKeyOnFocused(
          reportPage,
          review.locator(".count-review-table-wrap"),
          "Tab",
        );
        await expect(reviewClose).toBeFocused();
        await reportPage.setViewportSize({ width: 640, height: 480 });
        await expect(reviewClose).toBeInViewport({ ratio: 1 });
        await expect
          .poll(() =>
            review.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          )
          .toBe(true);
        await reportPage.setViewportSize({ width: 1280, height: 800 });
        expect(
          (await new AxeBuilder({ page: reportPage }).analyze()).violations,
        ).toEqual([]);
        await reportPage.screenshot({
          animations: "disabled",
          fullPage: true,
          path: evidencePath(
            "issue-64",
            "after",
            `count-source-${locale}-${theme}.png`,
          ),
        });
        await review.locator("header button").click();
        await expect(source).toBeFocused();
        await expect(reportRow).toHaveCount(1);
        await context.close();
      }
    }
  });

  test("pages complete posted activity and restores nested source and drawer focus", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    for (let index = 0; index < 51; index++)
      await postPurchase(supplier, product, `ACTIVITY-${index}`);
    const frozen = await administrator.query<{
      movements: string;
      journals: string;
    }>(
      `select (select count(*)::text from inventory_movements) as movements,
              (select count(*)::text from accounting_journal_entries) as journals`,
    );
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
    const row = page
      .locator(".report-table tbody tr")
      .filter({ hasText: product.displayName });
    const opener = row.locator("td").nth(-2).getByRole("button");
    await opener.focus();
    await pressKeyOnFocused(page, opener, "Enter");
    const activity = page.locator(
      "dialog[aria-labelledby='report-activity-title']",
    );
    await expect(activity.locator("li")).toHaveCount(50);
    await expect(activity.locator("footer")).toBeInViewport({ ratio: 1 });
    await expect(
      activity.locator("footer span[aria-live='polite']"),
    ).toHaveText("Page 1");
    const source = activity.locator("li").first().getByRole("button");
    await source.focus();
    await pressKeyOnFocused(page, source, "Space");
    await expect(page.locator(".report-source-dialog")).toBeVisible();
    await page.locator(".report-source-dialog header button").click();
    await expect(source).toBeFocused();
    const next = activity.getByRole("button", {
      name: "Next page",
      exact: true,
    });
    await next.focus();
    await pressKeyOnFocused(page, next, "Enter");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();
    await expect(activity.locator("li")).toHaveCount(5);
    await expect(
      activity.locator("footer span[aria-live='polite']"),
    ).toHaveText("Page 2");
    await activity
      .getByRole("button", { name: "Previous page", exact: true })
      .click();
    await expect(activity.locator("li")).toHaveCount(50);
    await activity.locator("header button").click();
    await expect(opener).toBeFocused();
    const after = await administrator.query<{
      movements: string;
      journals: string;
    }>(
      `select (select count(*)::text from inventory_movements) as movements,
              (select count(*)::text from accounting_journal_entries) as journals`,
    );
    expect(after.rows).toEqual(frozen.rows);
  });
  test("localizes report units, timezone and export outcomes across language switches", async ({
    page,
  }) => {
    await login(OWNER_USERNAME, OWNER_PASSWORD);
    const bottleRequest = medicationRequest();
    bottleRequest.definition = {
      mode: "medication",
      fields: {
        tradeName: "Report Bottle Item",
        strength: null,
        dosageForm: null,
        manufacturer: null,
      },
    };
    bottleRequest.packaging.inventoryUnitName = "Bottle";
    const created = await apiRequest(
      "POST",
      "/catalog/products",
      bottleRequest,
    );
    expect(created.status).toBe(201);
    const bottle = created.body as Product;
    await postPurchase(supplier, bottle, "REPORT-BOTTLE");
    await installDesktopFake(page, renderer.origin, "en", "light");
    await page.setViewportSize({ height: 800, width: 1280 });
    await page.goto(`${renderer.origin}#/reports/inventory/quantity`);
    const screen = page.locator(".inventory-reports-workspace");
    const bottleRow = screen
      .locator("tbody tr")
      .filter({ hasText: bottle.displayName });
    const stripRow = screen
      .locator("tbody tr")
      .filter({ hasText: product.displayName });
    await expect(bottleRow.locator("td").first()).toHaveText("Bottle");
    await expect(stripRow.locator("td").first()).toHaveText("Strip");
    await expect(screen.locator(".report-timezone")).toHaveText("Asia/Baghdad");
    await page.getByLabel(/^Group by/u).selectOption("item");
    await screen
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(screen.locator(".report-groups")).toContainText("Bottle");
    const switchLanguage = async (from: "ar" | "en") => {
      await page.getByTestId("collapse-menu-trigger").click();
      await page
        .getByRole("button", {
          name: from === "en" ? "Switch to Arabic" : "التبديل إلى الإنجليزية",
          exact: true,
        })
        .click();
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        from === "en" ? "ar" : "en",
      );
    };
    const exportButton = () =>
      screen.getByRole("button", {
        name: /^(Export CSV · without costs|تصدير جدول · دون التكاليف)$/u,
      });
    await exportButton().click();
    await expect(screen.locator(".report-actions")).toContainText(
      "Report saved.",
    );
    await page.screenshot({
      path: evidencePath("inventory-report-localization", "english.png"),
      fullPage: true,
    });
    await screen.locator(".report-table").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: evidencePath("inventory-report-localization", "english-table.png"),
    });
    await switchLanguage("en");
    await expect(bottleRow.locator("td").first()).toHaveText("زجاجة");
    await expect(stripRow.locator("td").first()).toHaveText("شريط");
    await expect(screen.locator(".report-timezone")).toHaveText("توقيت بغداد");
    await expect(screen.locator(".report-groups")).toContainText("زجاجة");
    await expect(screen.locator(".report-groups")).toContainText("شريط");
    await expect(screen.locator(".report-actions")).toContainText(
      "تم حفظ التقرير.",
    );
    await expect(screen.locator(".report-actions")).not.toContainText(
      "Report saved",
    );
    const activityOpener = bottleRow.locator("td").nth(-2).getByRole("button");
    await activityOpener.click();
    const movementDialog = page.locator(".report-activity-dialog");
    await expect(movementDialog).toContainText("زجاجة");
    await movementDialog.locator(".report-source-reference").first().click();
    const bottleSnapshot = page.locator(".report-source-dialog");
    await expect(bottleSnapshot.locator("table")).toContainText("زجاجة");
    await expect(bottleSnapshot.locator("tbody tr td").nth(2)).toHaveText(
      "زجاجة",
    );
    await expect(bottleSnapshot.locator("tbody tr td").first()).toHaveText(
      bottle.displayName,
    );
    await bottleSnapshot.locator("header button").click();
    await movementDialog.locator("header button").click();
    await page.screenshot({
      path: evidencePath("inventory-report-localization", "arabic.png"),
      fullPage: true,
    });
    await screen.locator(".report-table").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: evidencePath("inventory-report-localization", "arabic-table.png"),
    });

    // A native save finishing after a language change uses the current UI locale.
    await switchLanguage("ar");
    await page.evaluate(() => {
      (globalThis as { __holdReportExport?: boolean }).__holdReportExport =
        true;
    });
    await exportButton().click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            typeof (globalThis as { __releaseReportExport?: () => void })
              .__releaseReportExport,
        ),
      )
      .toBe("function");
    await switchLanguage("en");
    await page.evaluate(() => {
      (
        globalThis as { __releaseReportExport?: () => void }
      ).__releaseReportExport?.();
    });
    await expect(screen.locator(".report-actions")).toContainText(
      "تم حفظ التقرير.",
    );
    await expect(screen.locator(".report-actions")).not.toContainText(
      "Report saved",
    );
    await page.evaluate(() => {
      (globalThis as { __holdReportExport?: boolean }).__holdReportExport =
        false;
    });

    for (const outcome of [
      { status: "cancelled", ar: "أُلغي التصدير.", en: "Export cancelled." },
      {
        status: "export-too-large",
        ar: "يتجاوز التقرير حد التصدير.",
        en: "The report exceeds the export limit.",
      },
      {
        status: "failed",
        ar: "تعذّر حفظ التقرير.",
        en: "The report could not be saved.",
      },
    ] as const) {
      await page.evaluate((status) => {
        (
          globalThis as { __reportExportResult?: { status: string } }
        ).__reportExportResult = { status };
      }, outcome.status);
      await exportButton().click();
      await expect(screen.locator(".report-actions")).toContainText(outcome.ar);
      await switchLanguage("ar");
      await expect(screen.locator(".report-actions")).toContainText(outcome.en);
      await switchLanguage("en");
      await expect(screen.locator(".report-actions")).toContainText(outcome.ar);
    }
    const wire = await page.evaluate(
      () => (globalThis as { __inventoryExport?: unknown }).__inventoryExport,
    );
    const { format, ...bundle } = wire as Record<string, unknown>;
    expect(format).toBe("csv");
    const exported = inventoryReportExportSchema.parse(bundle);
    expect(exported.timeZone).toBe("Asia/Baghdad");
    expect(
      exported.rows.find((row) => row.productId === bottle.id)?.cells.unit,
    ).toBe("Bottle");
    expect(
      exported.rows.find((row) => row.productId === product.id)?.cells.unit,
    ).toBe("Strip");

    await screen
      .getByRole("button", { name: "إضافة مرشح عمود", exact: true })
      .click();
    await screen
      .locator(".report-filter-row select")
      .first()
      .selectOption("closingQuantity");
    await screen.getByLabel("قيمة المرشح", { exact: true }).fill("1.5");
    await screen
      .getByRole("button", { name: "تطبيق المرشحات", exact: true })
      .click();
    await expect(
      screen.locator(".report-filter-row [role='alert']"),
    ).toContainText("المنازل العشرية زائدة");
    await switchLanguage("ar");
    await expect(
      screen.locator(".report-filter-row [role='alert']"),
    ).toContainText("Too many decimal places");
    await switchLanguage("en");
    await expect(
      screen.locator(".report-filter-row [role='alert']"),
    ).not.toContainText("Too many decimal places");
  });
});

function catalogProduct(input: {
  readonly barcode: string;
  readonly packageUnits?: readonly {
    readonly baseUnitsPerPackage: string;
    readonly name: string;
  }[];
  readonly stockLevels?: ProductCreateRequest["stockLevels"];
  readonly tradeName: string;
}): ProductCreateRequest {
  const request = medicationRequest();
  return {
    ...request,
    barcodes: [{ kind: "product", value: input.barcode }],
    definition: {
      fields: {
        dosageForm: "tablet",
        manufacturer: "Breev Labs",
        strength: "500 mg",
        tradeName: input.tradeName,
      },
      mode: "medication",
    },
    idempotencyKey: uuidV7(),
    packaging: {
      ...request.packaging,
      packageUnits: [...(input.packageUnits ?? [])],
    },
    stockLevels: input.stockLevels ?? {
      maximumLevel: null,
      minimumLevel: null,
      reorderPoint: null,
    },
  };
}

async function purchaseStock(
  item: Product,
  quantity: string,
  expiryDate: string,
  invoiceNumber: string,
): Promise<string> {
  const supplier = await createSupplier(`Inventory ${invoiceNumber}`);
  const created = await apiRequest("POST", "/purchases/drafts", {
    idempotencyKey: uuidV7(),
    invoiceDate: "2026-06-15",
    settlementContext: "debt",
    supplierId: supplier.id,
    supplierInvoiceNumber: invoiceNumber,
  });
  expect(created.status).toBe(201);
  let draft = (created.body as { draft: PurchaseDraft }).draft;
  const row = await apiRequest("POST", purchaseDraftRowsPath(draft.id), {
    costFils: "1000",
    enteredQuantity: quantity,
    expectedVersion: draft.version,
    expiryDate,
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
  const batchId = (posted.body as PurchasePostResult).posted.rows[0]?.batchId;
  if (batchId === undefined) throw new Error("Posted purchase had no batch");
  return batchId;
}

async function stockNamedItem(
  tradeName: string,
  barcode: string,
  invoiceNumber: string,
  quantity = "6",
): Promise<{ readonly barcode: string; readonly batchId: string }> {
  const created = await apiRequest(
    "POST",
    "/catalog/products",
    catalogProduct({ barcode, tradeName }),
  );
  expect(created.status).toBe(201);
  const batchId = await purchaseStock(
    created.body as Product,
    quantity,
    "2029-06-15",
    invoiceNumber,
  );
  return { barcode, batchId };
}

async function changeBatchStatus(
  batchId: string,
  kind: "quarantine" | "recall",
): Promise<void> {
  const response = await apiRequest(
    "POST",
    inventoryBatchStatusChangePath(batchId),
    {
      evidence: `${kind} evidence for the inventory browser test`,
      idempotencyKey: uuidV7(),
      kind,
      reason: `${kind} for the inventory browser test`,
    },
  );
  expect(response.status).toBe(201);
}

async function expectNavigationLabelVisible(link: Locator): Promise<void> {
  await expect
    .poll(() =>
      link.evaluate((element) => {
        const label = element
          .querySelector(".module-tab-label")!
          .getBoundingClientRect();
        const list = element.closest("ul")!;
        const bounds = list.getBoundingClientRect();
        const left = bounds.left + list.clientLeft;
        const right = left + list.clientWidth;
        return Math.max(0, left - label.left, label.right - right);
      }),
    )
    .toBe(0);
  await expect(link).toBeInViewport({ ratio: 1 });
}

async function assertReportTextResize(page: Page): Promise<void> {
  await page.setViewportSize({ height: 768, width: 1024 });
  await page.locator("html").evaluate((root) => {
    root.style.fontSize = "200%";
  });
  for (const control of [
    page.locator(".report-controls button[type='submit']"),
    page.locator(".report-actions button").last(),
    page.locator(".report-categories button[aria-current='page']"),
  ]) {
    await control.scrollIntoViewIfNeeded();
    // Chromium can round a scrolled boundary by a fraction of a CSS pixel.
    await expect(control).toBeInViewport({ ratio: 0.99 });
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(24);
    expect(bounds?.height).toBeGreaterThanOrEqual(24);
  }
  expect(
    await page
      .locator("html")
      .evaluate((root) => root.scrollWidth <= root.clientWidth),
  ).toBe(true);
  await page.locator("html").evaluate((root) => {
    root.style.fontSize = "";
  });
  await page.setViewportSize({ height: 800, width: 1280 });
}

async function riskOrder(page: Page): Promise<string[]> {
  const wanted = [
    "Zebra Recalled Item",
    "Alpha Quarantine Item",
    "Browser Inventory Item",
  ];
  const names = await page
    .locator("tbody tr td[data-column-field='item']")
    .allInnerTexts();
  return names.flatMap((text) => {
    const match = wanted.find((name) => text.includes(name));
    return match === undefined ? [] : [match];
  });
}

function daysUntil(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const expiry = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round((expiry - todayUtc) / 86_400_000);
}

function toArabicIndicDigits(value: string): string {
  return value.replace(/\d/gu, (digit) =>
    String.fromCharCode(0x0660 + Number(digit)),
  );
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
    url?.startsWith("/inventory/") === true ||
    url?.startsWith("/reports/") === true
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

        if (typeof bundle === "object" && bundle !== null && "kind" in bundle) {
          exactKeys(
            bundle,
            [
              "kind",
              "pharmacyId",
              "capturedAt",
              "exportedAt",
              "timeZone",
              "query",
              "dateBasis",
              "balanceBasis",
              "sensitivity",
              "columns",
              "actors",
              "rows",
              "totalRows",
              "hasMore",
              "groups",
              "explanations",
            ],
            "inventory report export",
          );
          return;
        }

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
          (globalThis as { __inventoryExport?: unknown }).__inventoryExport = {
            ...request.bundle,
            format: request.format,
          };
          const controls = globalThis as {
            __holdReportExport?: boolean;
            __releaseReportExport?: () => void;
            __reportExportResult?: Awaited<
              ReturnType<BreevDesktopApi["saveInventoryExport"]>
            >;
          };
          if (controls.__holdReportExport)
            await new Promise<void>((resolve) => {
              controls.__releaseReportExport = resolve;
            });
          return controls.__reportExportResult ?? { status: "saved" as const };
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

async function createSupplier(
  name = "Inventory Browser Supplier",
): Promise<Supplier> {
  const response = await apiRequest("POST", "/suppliers", {
    allowanceEffectiveFrom: "2026-01-01",
    defaultAllowancePercentage: "0",
    idempotencyKey: uuidV7(),
    name,
    terms: "Net 30",
  });
  expect(response.status).toBe(201);
  return response.body as Supplier;
}

async function postPurchase(
  supplier: Supplier,
  item: Product,
  reference = "BROWSER-INVENTORY-1",
): Promise<PurchasePostResult> {
  const created = await apiRequest("POST", "/purchases/drafts", {
    idempotencyKey: uuidV7(),
    invoiceDate: "2026-06-15",
    settlementContext: "debt",
    supplierId: supplier.id,
    supplierInvoiceNumber: reference,
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
    lotNumber:
      reference === "BROWSER-INVENTORY-1" ? "BROWSER-LOT-1" : reference,
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
    .toBe(locale === "ar" ? "٢٫٠٠٠ د.ع" : "IQD 2.000");
  await expect(
    row.locator("td[data-column-field='value'] .money-amount"),
  ).toHaveCSS("white-space", "nowrap");
  if (locale === "en") {
    await expect(
      row.locator("td[data-column-field='value'] .money-amount"),
    ).toHaveAttribute("dir", "ltr");
  }
  await expect
    .poll(async () =>
      normalizeBidiMarks(
        await row.locator("td[data-column-field='averageCost']").innerText(),
      ),
    )
    .toBe(locale === "ar" ? "١٫٠٠٠ د.ع" : "IQD 1.000");
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
