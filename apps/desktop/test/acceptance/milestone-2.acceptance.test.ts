import { AxeBuilder } from "@axe-core/playwright";
import {
  inventoryBatchListPath,
  inventoryMovementHistoryPath,
  reorderBasketPath,
  saleDraftPath,
  type InventoryMovement,
  type Product,
  type ReorderItem,
} from "@breev/contracts/local-rest";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { acceptanceEvidencePath } from "./evidence-path.js";
import {
  activate,
  enterDate,
  localeDigits,
  pressOn,
  replaceValue,
  selectByKeyboard,
  stripBidiMarks,
  typeInto,
} from "./keyboard.js";
import {
  POSTGRES_IMAGE,
  startAcceptanceEnvironment,
  uuidV7,
  type AcceptanceEnvironment,
  type LocalApi,
} from "./packaged-desktop.js";
import {
  readExecutableProvenance,
  readLocalApiProvenance,
  readSourceProvenance,
} from "./provenance.js";
import {
  ADJUSTMENT_INVOICE_NUMBER,
  BLOCKED_INVOICE_NUMBER,
  EXTRA_COLD_NAME,
  EXTRA_VITAMIN_NAME,
  OWNER_PASSWORD,
  PANADOL_ARABIC_SEARCH_NAME,
  PANADOL_BARCODE,
  PANADOL_DISPLAY_NAME,
  PANADOL_INVENTORY_UNIT,
  PANADOL_MANUFACTURER,
  PANADOL_RETAIL_PRICE_FILS,
  PANADOL_TRADE_NAME,
  PANEL_ITEM_BARCODE,
  PANEL_ITEM_CATEGORY,
  PANEL_ITEM_PACKAGING,
  PANEL_ITEM_SCIENTIFIC_NAME,
  PANEL_ITEM_WHOLESALE_PRICE_FILS,
  seedFixture,
  type SeededFixture,
} from "./seed.js";
import {
  runRecord,
  writeTranscript,
  type Locale,
  type Take,
  type Theme,
  type TranscriptContext,
} from "./transcript.js";

/**
 * Milestone 2 acceptance: the contractual criterion clause by clause, the four
 * client acceptance scenarios with their literal strings and numbers, and the
 * sales-side reorder action — driven keyboard-only through the packaged
 * `Breev.exe` over CDP, against a real `local-api` process and a real
 * PostgreSQL 18, in Arabic/RTL and English/LTR and in both themes.
 *
 * This harness adds no product behaviour and fixes none. Where the build does
 * not do what a clause or scenario says, the assertion stays and the transcript
 * records the failure; the fix is a separate, reviewed change.
 */

const CRITERION = {
  clause1:
    "A user defines an item and finds it with the approved smart-search behavior",
  clause2:
    "then enters and saves a supplier invoice with cost and price updated per the item's pricing mode.",
  clause3:
    "A purchase adjustment records only the difference, or the user creates a separate purchase return.",
  clause4:
    "Quantities, batches, and expiry appear correctly in inventory, stocktaking, and the reorder basket.",
} as const;

const SCENARIOS = {
  adjustment:
    "Purchase adjustment: changing a posted line quantity from 4 to 8 posts exactly +4; unchanged lines create no movements; an adjustment whose delta would break the balance or batch state is blocked.",
  margin:
    "Margin: cost 80 with a 20% margin yields a selling price of 100 before rounding (margin on selling price, not markup); rounding to 250/500/1,000 IQD applies only when enabled.",
  search:
    'Search: "panadol gs" returns "Panadol Extra GSK"; "extra" returns every item containing "Extra"; Arabic, English, and barcode queries all match instantly.',
  units:
    'Units: 1 pack = 4 strips — purchasing 1 pack records 4 strips in the base unit; a stocktake entry of "2 packs + 1 strip" converts to 9 strips at that ratio; no fractional base-unit balance ever posts.',
} as const;

/** `docs/delivery.md` §Milestone 2 scope sentence, for the reorder record. */
const REORDER_TITLE = "the reorder basket and Ordered Items";
/** The same scope sentence names this surface in its own right. */
const SCOPE_ITEM_DETAILS_PANEL = "the item-details panel in purchasing";
/** `docs/quality.md` §Usability and accessibility. */
const BILINGUAL_TITLE =
  "Validate Arabic with RTL and English with LTR in both themes.";

/**
 * Renderer copy the assertions read back. Everything that has a stable id,
 * class, or `data-` attribute is addressed that way instead; this table exists
 * only for the messages whose text *is* the evidence.
 */
const TEXT = {
  ar: {
    adjustmentBlocked:
      "هذا الفرق غير صالح مقابل المخزون الحالي. عالجه بجرد المخزون أو مردود شراء أو تصحيح آخر، ثم أعد المحاولة.",
    adjustmentPosted: "تم حفظ التعديل",
    countIntegerOnly: "استخدم أعداداً صحيحة غير سالبة.",
    draftSaved: "تم حفظ المسودة بشكل دائم.",
    movementAdjustment: "تعديل شراء",
    newInvoice: "فاتورة جديدة",
    movementReceipt: "استلام شراء",
    postedInvoices: "فواتير الشراء المُرحّلة",
    quantityInvalid: "أدخل كمية صحيحة موجبة.",
    returnPosted: "تم حفظ مردود الشراء",
    rowCommitted: "تم حفظ البند بشكل دائم.",
    unchangedLines: "الأسطر التي لم تتغير لا تنشئ حركة مخزون أو أثر قيمة.",
  },
  en: {
    adjustmentBlocked:
      "This Delta is not valid against current stock. Resolve it through a stock count, a Purchase Return, or another correction, then retry.",
    adjustmentPosted: "Adjustment posted",
    countIntegerOnly: "Use whole, non-negative numbers.",
    draftSaved: "Draft saved and durable.",
    movementAdjustment: "Purchase adjustment",
    newInvoice: "New invoice",
    movementReceipt: "Purchase receipt",
    postedInvoices: "Posted invoices",
    quantityInvalid: "Enter a positive whole quantity.",
    returnPosted: "Purchase Return posted",
    rowCommitted: "Row committed and saved durably.",
    unchangedLines: "Unchanged lines create no stock or value effects.",
  },
} as const;

type DateEntryPath = "typed" | "value-api";

/**
 * Every record one pass produces, in order. It is written into each record so a
 * flow that never ran — because an earlier one failed and the serial group
 * stopped — is visibly missing from the transcript rather than silently absent.
 */
const PASS_FLOWS: readonly string[] = [
  "clause-1",
  "scenario-search",
  "clause-2",
  "scenario-margin",
  "clause-3",
  "clause-4",
  "reorder-from-sales",
  "bilingual",
  // These last on purpose. The two correction flows leave drafts and a modal
  // register behind them, and the units scenario currently ends in a failing
  // on-screen assertion against this build; a serial group stops at its first
  // failure, so running them after the rest keeps that failure from hiding the
  // flows that pass. No clause depends on what they post: clause 4 reads its
  // own seeded item.
  "scenario-adjustment",
  "scope-item-details-panel",
  "scenario-units",
];

function flowsExpectedFor(locale: Locale, theme: Theme): readonly string[] {
  return PASS_FLOWS.map((flow) => recordId(flow, locale, theme));
}

const COMBINATIONS: readonly { locale: Locale; theme: Theme }[] = [
  { locale: "en", theme: "light" },
  { locale: "en", theme: "dark" },
  { locale: "ar", theme: "light" },
  { locale: "ar", theme: "dark" },
];

for (const combination of COMBINATIONS) {
  declareAcceptancePass(combination.locale, combination.theme);
}

function declareAcceptancePass(locale: Locale, theme: Theme): void {
  // Serial: one pass is a single walk through the milestone, and each flow
  // builds on the state the previous one posted. Serial mode also keeps the
  // worker alive across a failure, so the environment is not rebuilt mid-pass.
  test.describe.serial(`milestone 2 acceptance · ${locale} · ${theme}`, () => {
    let context: TranscriptContext;
    let environment: AcceptanceEnvironment<SeededFixture>;
    let fixture: SeededFixture;
    let page: Page;
    let panadolId = "";

    /**
     * Every path `enterDate` took anywhere in this pass. The bilingual record's
     * claim about keyboard entry is derived from this, not from one call.
     */
    let blockedMessagePlacement = "(not measured)";
    /**
     * Where each subject a record claims "appeared" actually sat in the
     * packaged window. Every one of them is asserted on screen as well; the
     * coordinates are kept because "it was in view" is worth reading back with
     * numbers when the layout changes again.
     */
    const placements: string[] = [];
    const dateEntryPaths: DateEntryPath[] = [];
    const trackDateEntry = (entryPath: DateEntryPath): string => {
      dateEntryPaths.push(entryPath);
      return entryPath;
    };

    test.beforeAll(async () => {
      const source = readSourceProvenance();
      const executable = await readExecutableProvenance();
      const localApi = await readLocalApiProvenance(source);

      environment = await startAcceptanceEnvironment(seedFixture);
      page = environment.window;
      fixture = environment.fixture;

      context = {
        breevEnvironmentVariables: environment.injectedEnvironmentKeys,
        executable,
        flowsExpected: flowsExpectedFor(locale, theme),
        localApi,
        locale,
        postgresImage: POSTGRES_IMAGE,
        sourceCommit: source.commit,
        theme,
        workingTreeStatus: source.workingTreeStatus,
      };

      // The shell starts in its English default; the pass switches from there
      // through the header controls.
      // The renderer's own health request aborts at three seconds and retries
      // once a second, so a cold packaged start on a loaded host can show
      // "Main unavailable" for a poll or two before it settles. This is the
      // one wait sized for process start-up rather than for a rendered change;
      // every assertion in the pass itself keeps the suite's 10 s default.
      await expect(page.getByTestId("shell-state")).toHaveText("Ready", {
        timeout: 120_000,
      });
      await applyPresentation(page, locale, theme);
    });

    test.afterAll(async () => {
      await environment?.stop();
      await writeTranscript();
    });

    test("clause 1 — defines an item and finds it by smart search", async () => {
      await runRecord(
        context,
        {
          id: recordId("clause-1", locale, theme),
          kind: "clause",
          title: CRITERION.clause1,
        },
        async (take) => {
          await take.step(
            "Open the Products module from the module tab bar by keyboard",
            "The catalogue workspace is addressed",
            async () => {
              await activate(page, moduleTab(page, "products"));
              await expect(page).toHaveURL(/#\/catalog\/products$/u);
              return page.url();
            },
          );

          await take.step(
            `Define "${PANADOL_DISPLAY_NAME}" through the product form, keyboard only`,
            `The generated display name is exactly "${PANADOL_DISPLAY_NAME}"`,
            async () => {
              await activate(page, page.locator("a.catalog-rail-new"));
              await expect(page).toHaveURL(/#\/catalog\/products\/new$/u);
              const form = page.locator("form.identity-form");
              await typeInto(
                page,
                form.locator('input[name="tradeName"]'),
                PANADOL_TRADE_NAME,
              );
              await typeInto(
                page,
                form.locator('input[name="manufacturer"]'),
                PANADOL_MANUFACTURER,
              );
              await typeInto(
                page,
                form.locator('input[name="arabicSearchName"]'),
                PANADOL_ARABIC_SEARCH_NAME,
              );
              const barcode = form.locator('input[name="newBarcode"]');
              await typeInto(page, barcode, PANADOL_BARCODE);
              await pressOn(page, barcode, "Enter");
              await expect(
                form.getByText(PANADOL_BARCODE, { exact: true }),
              ).toBeVisible();
              await typeInto(
                page,
                form.locator('input[name="packaging.inventoryUnitName"]'),
                PANADOL_INVENTORY_UNIT,
              );
              await typeInto(
                page,
                form.locator('input[name="pricing.retailPriceFils"]'),
                PANADOL_RETAIL_PRICE_FILS,
              );
              await expect(
                page.getByTestId("generated-display-name"),
              ).toHaveText(PANADOL_DISPLAY_NAME);
              return await page
                .getByTestId("generated-display-name")
                .innerText();
            },
          );

          await take.step(
            "Submit the definition with Enter on the create action",
            "The saved item record shows the composed display name",
            async () => {
              await activate(
                page,
                page.locator('form.identity-form button[type="submit"]'),
              );
              await expect(page.getByTestId("product-display-name")).toHaveText(
                PANADOL_DISPLAY_NAME,
              );
              panadolId = productIdFromUrl(page.url());
              return `${PANADOL_DISPLAY_NAME} (${panadolId})`;
            },
          );

          await take.step(
            'Find the item by typing "panadol gs" into the catalogue search',
            `The first result is "${PANADOL_DISPLAY_NAME}"`,
            async () => await searchCatalogue(page, "panadol gs"),
          );

          await captureEvidence(
            take,
            page,
            "clause-1-define-and-search",
            locale,
            theme,
          );
          await scanAccessibility(take, page, "the catalogue workspace");
        },
      );

      await runRecord(
        context,
        {
          id: recordId("scenario-search", locale, theme),
          kind: "scenario",
          title: SCENARIOS.search,
        },
        async (take) => {
          await take.step(
            'Type "panadol gs" into the catalogue search',
            `Returns "${PANADOL_DISPLAY_NAME}"`,
            async () => await searchCatalogue(page, "panadol gs"),
          );

          await take.step(
            'Type "extra" into the catalogue search',
            `Returns exactly every item containing "Extra": ${[
              EXTRA_COLD_NAME,
              PANADOL_DISPLAY_NAME,
              EXTRA_VITAMIN_NAME,
            ]
              .slice()
              .sort()
              .join(", ")}`,
            async () => {
              await replaceValue(
                page,
                page.locator("input.catalog-rail-search"),
                "extra",
              );
              const expected = [
                EXTRA_COLD_NAME,
                EXTRA_VITAMIN_NAME,
                PANADOL_DISPLAY_NAME,
              ].sort();
              await expect
                .poll(async () =>
                  (await page.locator(".catalog-rail-name").allInnerTexts())
                    .map((value) => stripBidiMarks(value).trim())
                    .sort(),
                )
                .toEqual(expected);
              return expected.join(", ");
            },
          );

          await take.step(
            `Type the Arabic search name "${PANADOL_ARABIC_SEARCH_NAME}"`,
            `Returns "${PANADOL_DISPLAY_NAME}"`,
            async () => await searchCatalogue(page, PANADOL_ARABIC_SEARCH_NAME),
          );

          await take.step(
            `Scan the barcode ${PANADOL_BARCODE} into the search and press Enter`,
            `Opens the record for "${PANADOL_DISPLAY_NAME}"`,
            async () => {
              const search = page.locator("input.catalog-rail-search");
              await replaceValue(page, search, PANADOL_BARCODE);
              await pressOn(page, search, "Enter");
              await expect(page.getByTestId("product-display-name")).toHaveText(
                PANADOL_DISPLAY_NAME,
              );
              return page.url();
            },
          );

          take.note(
            'Assess the scenario\'s word "instantly"',
            "Functional match recorded; response time not claimed",
            "Every query matched functionally. Response timing is a provisional performance target (docs/quality.md §Performance targets, p95 ≤200 ms for product search) confirmed or revised at G-16 in milestone 4; this run does not measure it and does not claim it.",
          );

          await captureEvidence(take, page, "scenario-search", locale, theme);
          await scanAccessibility(take, page, "the catalogue search results");
        },
      );
    });

    test("clause 2 — saves a supplier invoice with cost and price per pricing mode", async () => {
      await runRecord(
        context,
        {
          id: recordId("clause-2", locale, theme),
          kind: "clause",
          title: CRITERION.clause2,
        },
        async (take) => {
          await take.step(
            "Open the Purchases module and save an invoice header by keyboard",
            `The renderer reports "${TEXT[locale].draftSaved}"`,
            async () => {
              await activate(page, moduleTab(page, "purchases"));
              await expect(page).toHaveURL(/#\/purchases$/u);
              const datePath = trackDateEntry(
                await saveInvoiceHeader(
                  page,
                  fixture.supplierId,
                  "M2-INV-CLAUSE2",
                  locale,
                ),
              );
              await expect(
                page.getByText(TEXT[locale].draftSaved),
              ).toBeVisible();
              return `${TEXT[locale].draftSaved} · invoice date entered by ${datePath}`;
            },
          );

          await take.step(
            "Enter a By Percentage row: cost 80,000 fils at a 20% margin",
            "The selling price is locked and calculated as 100,000 fils",
            async () => {
              const row = entryRow(page);
              const datePath = trackDateEntry(
                await commitRow(page, {
                  barcode: "5000167000105",
                  cost: "80000",
                  expiry: "2029-05-31",
                  observeBeforeExpiry: async () => {
                    await expect(row.selling).toHaveJSProperty(
                      "readOnly",
                      true,
                    );
                    await expect(row.selling).toHaveValue("100000");
                  },
                  quantity: "1",
                }),
              );
              await expect(
                page.getByText(TEXT[locale].rowCommitted),
              ).toBeVisible();
              return `${await committedCell(page, 0, "pricing")} · expiry entered by ${datePath}`;
            },
          );

          await take.step(
            "Enter a By Price row and type a retail price of 123,000 fils",
            "The selling price field is editable and keeps the typed price",
            async () => {
              const row = entryRow(page);
              const datePath = trackDateEntry(
                await commitRow(page, {
                  barcode: "5000167000109",
                  cost: "60000",
                  expiry: "2029-05-31",
                  quantity: "1",
                  selling: "123000",
                  observeBeforeExpiry: async () => {
                    await expect(row.selling).toHaveJSProperty(
                      "readOnly",
                      false,
                    );
                  },
                }),
              );
              return `${await committedCell(page, 1, "pricing")} · expiry entered by ${datePath}`;
            },
          );

          await take.step(
            "Post the invoice from its explicit action",
            "The immutable posted result is shown",
            async () => {
              return (await postInvoice(page, "M2-INV-CLAUSE2")).slice(0, 300);
            },
          );

          await take.step(
            "Read the By Price item back through the catalogue contract",
            "The invoice price became the item's current price (123,000 fils)",
            async () => {
              const response = await environment.api.request(
                "GET",
                `/catalog/products/${fixture.byPrice.id}`,
              );
              expect(response.status).toBe(200);
              const product = response.body as Product;
              expect(product.pricing.retailPriceFils).toBe("123000");
              return `retailPriceFils=${product.pricing.retailPriceFils}`;
            },
          );

          await take.step(
            "Read the By Percentage item back through the catalogue contract",
            "The calculated method does not propagate an invoice price (still 100,000 fils)",
            async () => {
              const response = await environment.api.request(
                "GET",
                `/catalog/products/${fixture.marginOff.id}`,
              );
              expect(response.status).toBe(200);
              const product = response.body as Product;
              expect(product.pricing.method).toBe("by-percentage");
              expect(product.pricing.retailPriceFils).toBe("100000");
              return `${product.pricing.method} retailPriceFils=${product.pricing.retailPriceFils}`;
            },
          );

          await captureEvidence(
            take,
            page,
            "clause-2-supplier-invoice",
            locale,
            theme,
          );
          await scanAccessibility(take, page, "the posted purchase result");
        },
      );
    });

    test("margin scenario — 80 at 20% is 100, and rounding applies only when enabled", async () => {
      await runRecord(
        context,
        {
          id: recordId("scenario-margin", locale, theme),
          kind: "scenario",
          title: SCENARIOS.margin,
        },
        async (take) => {
          await take.step(
            "Start a new supplier invoice for the margin cases",
            `The renderer reports "${TEXT[locale].draftSaved}"`,
            async () => {
              await activate(page, moduleTab(page, "purchases"));
              const datePath = trackDateEntry(
                await saveInvoiceHeader(
                  page,
                  fixture.supplierId,
                  "M2-INV-MARGIN",
                  locale,
                ),
              );
              await expect(
                page.getByText(TEXT[locale].draftSaved),
              ).toBeVisible();
              return `${TEXT[locale].draftSaved} · invoice date entered by ${datePath}`;
            },
          );

          const cases = [
            {
              barcode: "5000167000105",
              cost: "80000",
              expected: "100000",
              label: "rounding off — the scenario's own figures (80 IQD, 20%)",
              tie: false,
            },
            {
              barcode: "5000167000116",
              cost: "250000",
              expected: "250000",
              label:
                "rounding to the nearest 250 IQD enabled, away from the step midpoint",
              tie: false,
            },
            {
              barcode: "5000167000106",
              cost: "300000",
              expected: "500000",
              label: "rounding to the nearest 250 IQD enabled",
              tie: true,
            },
            {
              barcode: "5000167000107",
              cost: "200000",
              expected: "500000",
              label: "rounding to the nearest 500 IQD enabled",
              tie: true,
            },
            {
              barcode: "5000167000108",
              cost: "400000",
              expected: "1000000",
              label: "rounding to the nearest 1,000 IQD enabled",
              tie: true,
            },
          ] as const;

          for (const [index, testCase] of cases.entries()) {
            await take.step(
              `Enter a row with ${testCase.label}: cost ${testCase.cost} fils`,
              testCase.tie
                ? `The locked selling price reads ${testCase.expected} fils. This exact price sits on the step midpoint, so the row also exercises the tie rule (round half away from zero), which is an engineering working default pending G-01 approval, not an approved client value.`
                : `The locked selling price reads ${testCase.expected} fils, independently of any tie rule.`,
              async () => {
                const row = entryRow(page);
                const datePath = trackDateEntry(
                  await commitRow(page, {
                    barcode: testCase.barcode,
                    cost: testCase.cost,
                    expiry: "2029-05-31",
                    observeBeforeExpiry: async () => {
                      await expect(row.selling).toHaveJSProperty(
                        "readOnly",
                        true,
                      );
                      await expect(row.selling).toHaveValue(testCase.expected);
                    },
                    quantity: "1",
                  }),
                );
                return `${await committedCell(page, index, "pricing")} · expiry entered by ${datePath}`;
              },
            );
          }

          take.note(
            "Separate what these figures do and do not depend on",
            "The enabled/disabled claim stands without the tie decision",
            'Cost 250,000 fils at 20% is exactly 312,500 — a quarter of the way up the 250-IQD step, which no tie decision can move — and it rounds down to 250,000. That case alone carries "rounding applies only when enabled". The three midpoint cases additionally show the working-default tie rule, which G-01 has not approved.',
          );

          await captureEvidence(take, page, "scenario-margin", locale, theme);
          await scanAccessibility(take, page, "the purchase row entry");

          await take.step(
            "Post the margin invoice",
            "The immutable posted result is shown",
            async () => {
              return (await postInvoice(page, "M2-INV-MARGIN")).slice(0, 300);
            },
          );
        },
      );
    });

    test("clause 3 — an adjustment records only the difference, and a return is separate", async () => {
      await runRecord(
        context,
        {
          id: recordId("clause-3", locale, theme),
          kind: "clause",
          title: CRITERION.clause3,
        },
        async (take) => {
          await take.step(
            `Open the posted invoice ${ADJUSTMENT_INVOICE_NUMBER} in the posted register`,
            "The historical snapshot of the invoice is shown",
            async () => {
              await openPostedInvoice(
                page,
                fixture.adjustmentPurchaseId,
                locale,
              );
              return stripBidiMarks(
                await page.locator("#posted-detail-title").innerText(),
              );
            },
          );

          await take.step(
            "Start an adjustment and change the posted line quantity from 4 to 8",
            'The difference reads "4 → 8 (4)" and only the changed line appears',
            async () => {
              await startAdjustment(page);
              const quantity = adjustmentQuantity(page, fixture.adjusted);
              await replaceValue(page, quantity, "8");
              await activate(
                page,
                page.locator(".adjustment-form > button").last(),
              );
              const summary = page.locator(".adjustment-summary");
              await expect(summary).toContainText("4 → 8 (4)");
              await expect(summary.locator("ul > li")).toHaveCount(1);
              await expectOnScreen(summary.locator("ul > li").first());
              placements.push(
                await measureElement(page, ".adjustment-summary ul > li"),
              );
              return stripBidiMarks(
                await summary.locator("ul > li").innerText(),
              );
            },
          );

          await take.step(
            "Read the workflow's statement about unchanged lines",
            `The workspace states "${TEXT[locale].unchangedLines}"`,
            async () => {
              await expect(
                page.locator("section.purchase-adjustment"),
              ).toContainText(TEXT[locale].unchangedLines);
              return TEXT[locale].unchangedLines;
            },
          );

          await captureEvidence(
            take,
            page,
            "clause-3-adjustment-difference",
            locale,
            theme,
            { fullPage: false },
          );
          await captureEvidence(
            take,
            page,
            "clause-3-adjustment-difference-full-page",
            locale,
            theme,
          );

          await take.step(
            "Confirm and post the Delta",
            `The workflow reports "${TEXT[locale].adjustmentPosted}" with an -A01 number`,
            async () => {
              await activate(page, page.locator(".adjustment-summary button"));
              const posted = page.locator("section.purchase-adjustment");
              await expect(posted).toContainText(TEXT[locale].adjustmentPosted);
              await expect(posted).toContainText("-A01/");
              return stripBidiMarks(
                await posted.locator("div[role='status'] bdi").innerText(),
              );
            },
          );

          await take.step(
            "Create a separate Purchase Return of 1 unit on the same invoice",
            `The return posts and reports "${TEXT[locale].returnPosted}"`,
            async () => {
              await activate(
                page,
                page.locator(".purchase-adjustment > button.quiet-button"),
              );
              await expect(page.locator("#posted-detail-title")).toBeVisible();
              return await postPurchaseReturn(
                page,
                fixture.adjustmentPurchaseId,
                fixture.adjusted,
                "1",
                locale,
              );
            },
          );

          await take.step(
            "Return to the original invoice",
            "Both corrections are linked from the invoice",
            async () => {
              await activate(
                page,
                page.locator(".purchase-return > button.quiet-button"),
              );
              await expect(
                page.locator('[data-review-focus^="posted-adjustment-"]'),
              ).toBeVisible();
              await expect(
                page.locator('[data-review-focus^="posted-return-"]'),
              ).toBeVisible();
              return "adjustment and return both linked from the posted invoice";
            },
          );

          await captureEvidence(
            take,
            page,
            "clause-3-linked-return",
            locale,
            theme,
          );
          take.note(
            "Measure where each subject of this record sat in the packaged window",
            "Measured, not asserted — see the item-details panel record for the one thrown assertion",
            placements.length === 0
              ? "(nothing measured in this record)"
              : placements.join(" || "),
          );

          await scanAccessibility(take, page, "the posted purchase register");
        },
      );
    });

    test("clause 4 — quantities, batches and expiry in inventory, stocktaking and the basket", async () => {
      await runRecord(
        context,
        {
          id: recordId("clause-4", locale, theme),
          kind: "clause",
          title: CRITERION.clause4,
        },
        async (take) => {
          await take.step(
            "Read the inventory review row for the pack-purchased item",
            "Quantity, batch count and earliest expiry are all shown",
            async () => {
              await closeDialogIfOpen(page);
              await activate(page, moduleTab(page, "inventory"));
              await expect(page.locator("#inventory-title")).toBeVisible();
              const row = inventoryRow(page, fixture.reviewItem);
              await expect
                .poll(async () =>
                  stripBidiMarks(
                    await row
                      .locator("td[data-column-field='balance']")
                      .innerText(),
                  ).trim(),
                )
                .toBe(localeDigits(4, locale));
              await expect(
                row.locator("td[data-column-field='batches']"),
              ).toHaveText(localeDigits(1, locale));
              await expect(
                row.locator("td[data-column-field='expiry']"),
              ).toHaveText("2029-05-31");
              return `balance ${localeDigits(4, locale)} · batches ${localeDigits(1, locale)} · earliest expiry 2029-05-31`;
            },
          );

          await captureEvidence(
            take,
            page,
            "clause-4-inventory",
            locale,
            theme,
          );
          await scanAccessibility(take, page, "the inventory review grid");

          await take.step(
            "Open the batch panel for the two-batch item from inventory",
            "Batches are listed in FEFO order, earliest effective expiry first",
            async () => {
              await activate(
                page,
                page.locator(
                  `button[data-review-focus="inventory-item-${fixture.fefoItem.id}"]`,
                ),
              );
              await expect(
                page.locator("#inventory-movement-title"),
              ).toBeVisible();
              const table = page.locator("table.batch-safety-table");
              await expect(table).toBeVisible();
              await expect(
                table.locator('th[aria-sort="ascending"]'),
              ).toHaveCount(1);
              const expiries = (
                await table.locator("tbody tr td:nth-child(3)").allInnerTexts()
              ).map((value) => stripBidiMarks(value).trim());
              expect(expiries.length).toBeGreaterThan(1);
              expect([...expiries].sort()).toEqual(expiries);
              return expiries.join(" → ");
            },
          );

          await captureEvidence(
            take,
            page,
            "clause-4-batches-fefo",
            locale,
            theme,
          );
          await scanAccessibility(take, page, "the item batch panel");

          await take.step(
            "Add the pack-purchased item to the reorder basket from inventory",
            "The basket shows the item with its inventory balance",
            async () => {
              await activate(
                page,
                page.locator('a[href="#/inventory"]').first(),
              );
              await expect(page.locator("#inventory-title")).toBeVisible();
              await activate(
                page,
                page.locator(
                  `[data-review-focus="inventory-basket-add-${fixture.reviewItem.id}"]`,
                ),
              );
              await expect
                .poll(async () => await basketProductIds(environment.api))
                .toContain(fixture.reviewItem.id);
              await activate(page, moduleTab(page, "basket"));
              await expect(page.locator("#basket-title")).toBeVisible();
              const row = page
                .locator("table.basket-table tbody tr")
                .filter({ hasText: fixture.reviewItem.displayName });
              await expect(row.locator("td").first()).toContainText(
                `${localeDigits(4, locale)} ${PANADOL_INVENTORY_UNIT}`,
              );
              return stripBidiMarks(await row.innerText()).replaceAll(
                "\n",
                " | ",
              );
            },
          );

          await captureEvidence(take, page, "clause-4-basket", locale, theme);
          await scanAccessibility(take, page, "the reorder basket");
        },
      );
    });

    test("reorder from sales — the draft is byte-identical before and after", async () => {
      await runRecord(
        context,
        {
          id: recordId("reorder-from-sales", locale, theme),
          kind: "reorder",
          title: REORDER_TITLE,
        },
        async (take) => {
          let draftId = "";
          let before: unknown;
          let versionBefore: string | null = null;

          await take.step(
            "Open a Sale Draft from the sales surface by keyboard",
            "A durable draft opens with its search box focused",
            async () => {
              await activate(page, moduleTab(page, "sales"));
              const newDraft = page.locator('[data-sale-draft-control="new"]');
              await activate(page, newDraft);
              await expect(page.locator("#sale-draft-search")).toBeFocused();
              draftId = saleDraftIdFromUrl(page.url());
              const response = await environment.api.request(
                "GET",
                saleDraftPath(draftId),
              );
              expect(response.status).toBe(200);
              before = response.body;
              versionBefore = await page
                .locator("[data-sale-draft-version]")
                .textContent();
              return `draft ${draftId} version ${String(versionBefore)}`;
            },
          );

          await take.step(
            'Find the item by typing "panadol gs" in the sale draft search',
            `The result row for "${PANADOL_DISPLAY_NAME}" offers the basket action`,
            async () => {
              await typeInto(
                page,
                page.locator("#sale-draft-search"),
                "panadol gs",
              );
              const add = page.locator(`[data-sale-basket-add="${panadolId}"]`);
              await expect(add).toBeVisible();
              return PANADOL_DISPLAY_NAME;
            },
          );

          await take.step(
            "Add the found item to the order basket from the sales surface",
            "The basket holds the item and focus stays on the action",
            async () => {
              const add = page.locator(`[data-sale-basket-add="${panadolId}"]`);
              await activate(page, add);
              await expect
                .poll(async () => await basketProductIds(environment.api))
                .toContain(panadolId);
              await expect(add).toBeFocused();
              return `${PANADOL_DISPLAY_NAME} is in the order basket`;
            },
          );

          await take.step(
            "Re-read the Sale Draft through the sales contract",
            "The draft body and version are unchanged",
            async () => {
              const after = await environment.api.request(
                "GET",
                saleDraftPath(draftId),
              );
              expect(after.status).toBe(200);
              expect(after.body).toEqual(before);
              expect(
                await page.locator("[data-sale-draft-version]").textContent(),
              ).toBe(versionBefore);
              return `draft ${draftId} unchanged at version ${String(versionBefore)}`;
            },
          );

          await captureEvidence(
            take,
            page,
            "reorder-from-sales",
            locale,
            theme,
          );
          await scanAccessibility(take, page, "the sale draft surface");
        },
      );
    });

    test("bilingual pass — direction, theme and keyboard operation", async () => {
      await runRecord(
        context,
        {
          id: recordId("bilingual", locale, theme),
          kind: "bilingual",
          title: BILINGUAL_TITLE,
        },
        async (take) => {
          await take.step(
            "Read the document language and direction of the packaged renderer",
            `lang=${locale} and dir=${locale === "ar" ? "rtl" : "ltr"}`,
            async () => {
              const html = page.locator("html");
              await expect(html).toHaveAttribute("lang", locale);
              await expect(html).toHaveAttribute(
                "dir",
                locale === "ar" ? "rtl" : "ltr",
              );
              return `${locale} / ${locale === "ar" ? "rtl" : "ltr"}`;
            },
          );

          await take.step(
            "Read the applied theme of the packaged renderer",
            `data-theme=${theme}`,
            async () => {
              await expect(page.locator("html")).toHaveAttribute(
                "data-theme",
                theme,
              );
              return theme;
            },
          );

          await take.step(
            "Walk the module tab bar and confirm each acceptance surface opens",
            "Catalogue, purchases, inventory, basket and sales all open by keyboard",
            async () => {
              const visited: string[] = [];
              for (const [moduleId, marker] of [
                ["products", "input.catalog-rail-search"],
                ["purchases", "#purchase-header-form"],
                ["inventory", "#inventory-title"],
                ["basket", "#basket-title"],
                ["sales", '[data-sale-draft-control="resume"]'],
              ] as const) {
                await activate(page, moduleTab(page, moduleId));
                await expect(page.locator(marker).first()).toBeVisible();
                visited.push(moduleId);
              }
              return visited.join(", ");
            },
          );

          take.note(
            "Record how every native date control in this pass was operated",
            "Derived from all date entries in the pass, not from one of them",
            describeDateEntry(dateEntryPaths),
          );

          await captureEvidence(take, page, "bilingual-shell", locale, theme);
          await scanAccessibility(
            take,
            page,
            "the shell in this locale and theme",
          );
        },
      );
    });

    test("adjustment scenario — 4 to 8 posts exactly +4, unchanged lines are silent, invalid Delta blocked", async () => {
      await runRecord(
        context,
        {
          id: recordId("scenario-adjustment", locale, theme),
          kind: "scenario",
          title: SCENARIOS.adjustment,
        },
        async (take) => {
          await take.step(
            "Read the adjusted item's movement history in inventory",
            "Exactly one purchase-adjustment movement, of +4",
            async () => {
              await closeDialogIfOpen(page);
              const adjustments = await adjustmentMovements(
                environment.api,
                fixture.adjusted.id,
              );
              expect(adjustments).toHaveLength(1);
              expect(adjustments[0]?.quantity).toBe("4");
              return `purchase-adjustment movements: ${adjustments.length}, quantity ${String(adjustments[0]?.quantity)}`;
            },
          );

          await take.step(
            "Read the unchanged line's movement history in inventory",
            "No adjustment movement exists for the unchanged line",
            async () => {
              const adjustments = await adjustmentMovements(
                environment.api,
                fixture.silent.id,
              );
              expect(adjustments).toHaveLength(0);
              return `purchase-adjustment movements for the unchanged line: ${adjustments.length}`;
            },
          );

          await take.step(
            "Show the adjusted item's movement history in the packaged renderer",
            `Exactly one "${TEXT[locale].movementAdjustment}" row, of ${localeDigits(4, locale)}`,
            async () => {
              await openItemMovements(page, fixture.adjusted.id);
              const adjustmentRows = movementRows(page).filter({
                hasText: TEXT[locale].movementAdjustment,
              });
              await expect(adjustmentRows).toHaveCount(1);
              // Reference document, movement kind, date, time, user, quantity,
              // value — the quantity is the sixth cell.
              await expect(adjustmentRows.locator("td").nth(5)).toHaveText(
                localeDigits(4, locale),
              );
              // The claim is "one adjustment movement, of 4", so the subject
              // is the quantity cell that carries it. The row itself is as wide
              // as a scrollable table and is not something a window has to hold
              // whole.
              await expectReachableOnScreen(
                adjustmentRows.locator("td").nth(5),
              );
              placements.push(
                await measureElement(
                  page,
                  ".inventory-table-scroll table tbody tr",
                ),
              );
              return stripBidiMarks(await adjustmentRows.innerText())
                .replaceAll("\n", " | ")
                .replaceAll("\t", " · ");
            },
          );

          await take.step(
            "Show the unchanged line's movement history in the packaged renderer",
            `No "${TEXT[locale].movementAdjustment}" row appears for the unchanged line`,
            async () => {
              await openItemMovements(page, fixture.silent.id);
              const rows = movementRows(page);
              await expect(
                rows.filter({ hasText: TEXT[locale].movementAdjustment }),
              ).toHaveCount(0);
              // The line still received its purchase, so an empty table would
              // prove nothing: the receipt is there and the adjustment is not.
              await expect(
                rows.filter({ hasText: TEXT[locale].movementReceipt }),
              ).toHaveCount(1);
              return stripBidiMarks(await rows.first().innerText())
                .replaceAll("\n", " | ")
                .replaceAll("\t", " · ");
            },
          );

          await captureEvidence(
            take,
            page,
            "scenario-adjustment-movements",
            locale,
            theme,
            { fullPage: false },
          );
          await captureEvidence(
            take,
            page,
            "scenario-adjustment-movements-full-page",
            locale,
            theme,
          );

          await take.step(
            `Consume the batch on ${BLOCKED_INVOICE_NUMBER} with a Purchase Return of 3 of 4`,
            "The return posts, leaving 1 unit on the batch",
            async () => {
              const posted = await postPurchaseReturn(
                page,
                fixture.blockedPurchaseId,
                fixture.blocked,
                "3",
                locale,
                { open: true },
              );
              // The Delta below is invalid only because the batch no longer
              // holds enough stock, so the balance the return left behind is
              // part of the evidence rather than an assumption.
              const batches = await environment.api.request(
                "GET",
                inventoryBatchListPath(fixture.blocked.id),
              );
              expect(batches.status, JSON.stringify(batches.body)).toBe(200);
              return `${posted} · batches after the return: ${JSON.stringify(
                (
                  batches.body as {
                    readonly batches: readonly { readonly balance: string }[];
                  }
                ).batches.map((batch) => batch.balance),
              )}`;
            },
          );

          await take.step(
            "Attempt a downward Delta from 4 to 1 on the consumed line",
            `The renderer blocks it with "${TEXT[locale].adjustmentBlocked}", brings the refusal into view, and puts focus on it`,
            async () => {
              await activate(
                page,
                page.locator(".purchase-return > button.quiet-button"),
              );
              await startAdjustment(page);
              const quantity = adjustmentQuantity(page, fixture.blocked);
              await replaceValue(page, quantity, "1");
              await activate(
                page,
                page.locator(".adjustment-form > button").last(),
              );
              const error = page.locator(
                "section.purchase-adjustment p.form-error",
              );
              await expect(error).toHaveText(TEXT[locale].adjustmentBlocked);
              await expect(page.locator(".adjustment-summary")).toHaveCount(0);
              // The refusal lives inside the posted-register dialog's own
              // scroller, so being in the document proves nothing: it has to be
              // in view, and focused, for a keyboard user to meet it at all.
              await expectOnScreen(error);
              await expect(error).toBeFocused();
              blockedMessagePlacement = await measureElement(
                page,
                "section.purchase-adjustment p.form-error",
              );
              return stripBidiMarks(await error.innerText());
            },
          );

          take.note(
            "Record the route that reproduced the block",
            "Public REST and renderer only; no SQL",
            `The blocked state was reached entirely through product surfaces: post ${BLOCKED_INVOICE_NUMBER} with a line of 4, post a linked Purchase Return of 3 through the renderer, then attempt a Delta of 4 → 1 whose -3 exceeds the 1 unit left on the batch. No direct database write was used.`,
          );

          await captureEvidence(
            take,
            page,
            "scenario-adjustment-blocked",
            locale,
            theme,
            { fullPage: false },
          );
          await captureEvidence(
            take,
            page,
            "scenario-adjustment-blocked-full-page",
            locale,
            theme,
          );
          await scanAccessibility(take, page, "the blocked adjustment");

          take.note(
            "Measure the blocked message in the packaged window",
            "Measured at the moment the refusal appeared",
            blockedMessagePlacement,
          );

          await take.step(
            "Leave the blocked adjustment and delete its draft",
            "The workflow refuses to leave silently, and the invoice returns",
            async () => {
              await activate(
                page,
                page.locator(".purchase-adjustment > button.quiet-button"),
              );
              const warning = page.locator(
                '.purchase-adjustment [role="alertdialog"]',
              );
              await expect(warning).toBeVisible();
              const question = stripBidiMarks(
                await warning.locator("p").innerText(),
              );
              await activate(page, warning.locator("button").last());
              await expect(page.locator("#posted-detail-title")).toBeVisible();
              return question;
            },
          );
        },
      );
    });

    test("scope — the item-details panel in purchasing", async () => {
      await runRecord(
        context,
        {
          id: recordId("scope-item-details-panel", locale, theme),
          kind: "scope",
          title: SCOPE_ITEM_DETAILS_PANEL,
        },
        async (take) => {
          await take.step(
            "Set the purchase entry preferences to show all four panel fields",
            "The contract accepts scientific-name, category, packaging and wholesale-price",
            async () =>
              await setDetailsPanelFields(environment.api, [
                "scientific-name",
                "category",
                "packaging",
                "wholesale-price",
              ]),
          );

          await take.step(
            "Open a supplier invoice and scan the item into the row by keyboard",
            `The panel names "${fixture.panelItem.displayName}"`,
            async () => {
              await closeDialogIfOpen(page);
              await activate(page, moduleTab(page, "purchases"));
              const datePath = trackDateEntry(
                await saveInvoiceHeader(
                  page,
                  fixture.supplierId,
                  "M2-INV-PANEL",
                  locale,
                ),
              );
              await expect(
                page.getByText(TEXT[locale].draftSaved),
              ).toBeVisible();
              const row = entryRow(page);
              await typeInto(page, row.item, PANEL_ITEM_BARCODE);
              await pressOn(page, row.item, "Enter");
              await expect(row.quantity).toBeFocused();
              const panel = page.locator("aside.purchase-item-panel");
              await expect(panel.locator("strong")).toHaveText(
                fixture.panelItem.displayName,
              );
              return `${stripBidiMarks(await panel.locator("strong").innerText())} · invoice date entered by ${datePath}`;
            },
          );

          await take.step(
            "Read the four fields the panel shows for the selected item",
            `Scientific name "${PANEL_ITEM_SCIENTIFIC_NAME}", category "${PANEL_ITEM_CATEGORY}", packaging "${PANEL_ITEM_PACKAGING}", and the wholesale price as the panel prints it — the exact fils integer "${PANEL_ITEM_WHOLESALE_PRICE_FILS}", not a locale-formatted amount`,
            async () => {
              const values = page.locator(
                "aside.purchase-item-panel dl > div dd",
              );
              // The panel renders its fields in a fixed order and the
              // preferences decide only which of them appear, so with all four
              // enabled the values are read by position and the assertion needs
              // no locale-specific term labels.
              await expect(values).toHaveText([
                PANEL_ITEM_SCIENTIFIC_NAME,
                PANEL_ITEM_CATEGORY,
                PANEL_ITEM_PACKAGING,
                PANEL_ITEM_WHOLESALE_PRICE_FILS,
              ]);
              return (await values.allInnerTexts())
                .map((value) => stripBidiMarks(value).trim())
                .join(" | ");
            },
          );

          take.note(
            "Measure the panel in the packaged window while the item is selected",
            "Measured while the item was selected; the assertion follows below",
            await measurePanel(page),
          );

          await captureEvidence(
            take,
            page,
            "purchase-item-panel",
            locale,
            theme,
            { fullPage: false },
          );
          await captureEvidence(
            take,
            page,
            "purchase-item-panel-full-page",
            locale,
            theme,
          );
          await scanAccessibility(
            take,
            page,
            "the purchasing item-details panel",
          );

          await take.step(
            "Look for the wholesale price outside the panel, item still selected",
            "The wholesale price is in the item panel and not in the entry row",
            async () => {
              await expect(
                page.locator("aside.purchase-item-panel"),
              ).toContainText(PANEL_ITEM_WHOLESALE_PRICE_FILS);
              // The entry row and any committed rows share one table, so a
              // single assertion covers the whole invoice grid.
              await expect(
                page.locator("table.purchase-row-table"),
              ).not.toContainText(PANEL_ITEM_WHOLESALE_PRICE_FILS);
              return `panel shows ${PANEL_ITEM_WHOLESALE_PRICE_FILS}; the purchase row table does not`;
            },
          );

          await take.step(
            "Commit the row and look again across the whole invoice",
            "Neither the committed row nor the invoice review carries the wholesale price, and the panel clears with the row",
            async () => {
              const row = entryRow(page);
              await replaceValue(page, row.quantity, "2");
              await pressOn(page, row.quantity, "Enter");
              await expect(row.cost).toBeFocused();
              await replaceValue(page, row.cost, "70000");
              await pressOn(page, row.cost, "Enter");
              await expect(row.selling).toBeFocused();
              await pressOn(page, row.selling, "Enter");
              await expect(row.expiry).toBeFocused();
              trackDateEntry(await enterDate(page, row.expiry, "2029-05-31"));
              await pressOn(page, row.expiry, "Enter");
              await expect(
                page.getByText(TEXT[locale].rowCommitted),
              ).toBeVisible();

              await expect(
                page.locator("table.purchase-row-table"),
              ).not.toContainText(PANEL_ITEM_WHOLESALE_PRICE_FILS);
              await expect(page.locator(".purchase-review")).not.toContainText(
                PANEL_ITEM_WHOLESALE_PRICE_FILS,
              );
              // The panel follows the row's current item, so committing the row
              // empties it again: the wholesale price is never left on screen
              // for a line that is no longer being entered.
              const panel = page.locator("aside.purchase-item-panel");
              await expect(panel).not.toContainText(
                PANEL_ITEM_WHOLESALE_PRICE_FILS,
              );
              return stripBidiMarks(await panel.innerText()).replaceAll(
                "\n",
                " | ",
              );
            },
          );

          take.note(
            "Record how the panel prints the wholesale price in this locale",
            "Read from the panel's own DOM, not assumed",
            `The panel renders the wholesale price through \`<bdi>{wholesalePriceFils}</bdi>\` — the stored fils integer as exact text — so it reads "${PANEL_ITEM_WHOLESALE_PRICE_FILS}" in Arabic exactly as in English, with no Arabic-Indic digits and no currency formatting. Inventory review formats the same kind of amount as currency for the locale, so the two surfaces present amounts differently; the assertion above compares against what this panel actually prints.`,
          );

          take.note(
            "Record the decision this placement follows",
            "Working default, not an approved rule",
            'docs/open-decisions.md "Wholesale/special price selection" keeps the wholesale price in the item panel only. That placement is the recorded working default for this build, not an approved client decision.',
          );

          await take.step(
            "Post the invoice",
            "The immutable posted result is shown",
            async () => (await postInvoice(page, "M2-INV-PANEL")).slice(0, 300),
          );

          await take.step(
            "Select the item again and see the panel, not merely find it",
            "The panel and all four values are visible, and the panel is inside the packaged window's viewport",
            async () => {
              trackDateEntry(
                await saveInvoiceHeader(
                  page,
                  fixture.supplierId,
                  "M2-INV-PANEL-VISIBILITY",
                  locale,
                ),
              );
              const row = entryRow(page);
              await typeInto(page, row.item, PANEL_ITEM_BARCODE);
              await pressOn(page, row.item, "Enter");
              await expect(row.quantity).toBeFocused();

              // `toHaveText` is satisfied by an element that is hidden or
              // parked outside the viewport, so the reads above do not show
              // that the panel "appears during purchasing" to a user. These
              // assertions are deliberately not preceded by a scroll: if the
              // panel is only reachable by scrolling sideways, that is the
              // finding, not something to work around.
              const panel = page.locator("aside.purchase-item-panel");
              const values = panel.locator("dl > div dd");
              for (let index = 0; index < 4; index += 1) {
                await expect(values.nth(index)).toBeVisible();
              }
              await expectOnScreen(panel);
              return await measurePanel(page);
            },
          );
        },
      );
    });

    test("units scenario — one pack is four strips and a stocktake of 2 packs + 1 strip is 9", async () => {
      await runRecord(
        context,
        {
          id: recordId("scenario-units", locale, theme),
          kind: "scenario",
          title: SCENARIOS.units,
        },
        async (take) => {
          await take.step(
            "Start a supplier invoice and select the pack-purchased item",
            "The entry row offers the item's Pack as its purchase unit",
            async () => {
              await activate(page, moduleTab(page, "purchases"));
              trackDateEntry(
                await saveInvoiceHeader(
                  page,
                  fixture.supplierId,
                  "M2-INV-UNITS",
                  locale,
                ),
              );
              await expect(
                page.getByText(TEXT[locale].draftSaved),
              ).toBeVisible();
              const row = entryRow(page);
              await typeInto(page, row.item, "5000167000110");
              await pressOn(page, row.item, "Enter");
              await expect(row.quantity).toBeFocused();
              return fixture.unitsItem.displayName;
            },
          );

          await take.step(
            "Type a fractional quantity of 1.5 packs and press Enter",
            `The row is refused with "${TEXT[locale].quantityInvalid}" and keeps focus`,
            async () => {
              const row = entryRow(page);
              await replaceValue(page, row.quantity, "1.5");
              await pressOn(page, row.quantity, "Enter");
              const refusal = page.getByRole("alert");
              await expect(refusal).toContainText(TEXT[locale].quantityInvalid);
              await expectOnScreen(refusal);
              placements.push(await measureElement(page, '[role="alert"]'));
              await expect(row.quantity).toBeFocused();
              return stripBidiMarks(await refusal.innerText());
            },
          );

          await take.step(
            "Correct the quantity to 1 pack",
            "The row preview shows 4 Strip in the base unit, in view — the scenario's claim is about what a user records, so a value behind the table's horizontal scrollbar would not satisfy it",
            async () => {
              const row = entryRow(page);
              await replaceValue(page, row.quantity, "1");
              // The purchase entry preview prints the base-unit quantity as
              // exact text rather than through the locale number formatter, so
              // it reads "4 Strip" in both locales. The scenario's claim is the
              // conversion, and this is that literal.
              await expect(row.inventoryUnits).toHaveText(
                `4 ${PANADOL_INVENTORY_UNIT}`,
              );
              // That column is the last one inside
              // `.purchase-row-table-wrap { overflow-x: auto }`, so a text
              // assertion alone can pass while the value sits behind the
              // table's own scrollbar. Nothing scrolls it into view first.
              // Noted first, so the coordinates reach the transcript even
              // when the assertion that follows them fails and the record's
              // closing summary never runs.
              take.note(
                "Measure the base-unit preview cell in the packaged window",
                "Measured before the assertion that follows",
                await measureElement(
                  page,
                  'tr.purchase-entry-row [data-column-field="inventory-units"]',
                ),
              );
              await expectOnScreen(row.inventoryUnits);
              return stripBidiMarks(await row.inventoryUnits.innerText());
            },
          );

          await take.step(
            "Commit the row and post the invoice",
            "The committed row records 4 Strip for one purchased Pack, and that cell is in view too",
            async () => {
              const row = entryRow(page);
              await pressOn(page, row.quantity, "Enter");
              await expect(row.cost).toBeFocused();
              await replaceValue(page, row.cost, "40000");
              await pressOn(page, row.cost, "Enter");
              await expect(row.selling).toBeFocused();
              await replaceValue(page, row.selling, "60000");
              await pressOn(page, row.selling, "Enter");
              await expect(row.expiry).toBeFocused();
              trackDateEntry(await enterDate(page, row.expiry, "2029-05-31"));
              await pressOn(page, row.expiry, "Enter");
              await expect(
                page.getByText(TEXT[locale].rowCommitted),
              ).toBeVisible();
              const committed = stripBidiMarks(
                await page
                  .locator(".purchase-row-table tbody tr")
                  .first()
                  .locator('[data-column-field="inventory-units"]')
                  .innerText(),
              );
              expect(committed).toContain(`4 ${PANADOL_INVENTORY_UNIT}`);
              take.note(
                "Measure the committed row's base-unit cell in the packaged window",
                "Measured before the assertion that follows",
                await measureElement(
                  page,
                  '.purchase-row-table tbody tr:first-child [data-column-field="inventory-units"]',
                ),
              );
              await expectOnScreen(
                page
                  .locator(".purchase-row-table tbody tr")
                  .first()
                  .locator('[data-column-field="inventory-units"]'),
              );
              await postInvoice(page, "M2-INV-UNITS");
              return committed;
            },
          );

          await take.step(
            "Read the inventory balance for the pack-purchased item",
            "Inventory review shows 4 in the base unit",
            async () => {
              await activate(page, moduleTab(page, "inventory"));
              await expect(page.locator("#inventory-title")).toBeVisible();
              const balance = inventoryRow(page, fixture.unitsItem).locator(
                "td[data-column-field='balance']",
              );
              await expect
                .poll(async () =>
                  stripBidiMarks(await balance.innerText()).trim(),
                )
                .toBe(localeDigits(4, locale));
              return localeDigits(4, locale);
            },
          );

          await take.step(
            'Record a stocktake entry of "2 packs + 1 strip"',
            `The live caption reads "${localeDigits(2, locale)} Pack + ${localeDigits(1, locale)} Strip = ${localeDigits(9, locale)} Strip"`,
            async () => {
              await activate(page, page.locator('a[href="#/inventory/count"]'));
              await expect(page.locator("#count-title")).toBeVisible();
              await activate(
                page,
                page.locator('[data-count-start-control="start"]'),
              );
              await expect(page.locator("#count-loop-title")).toBeVisible();

              const item = page.locator("#count-item");
              await typeInto(page, item, "5000167000110");
              await pressOn(page, item, "Enter");
              const pack = page.locator('[data-count-field="unit:Pack"]');
              const strip = page.locator('[data-count-field="unit:Strip"]');
              await expect(strip).toBeFocused();
              await pressOn(page, strip, "Shift+Tab");
              await replaceValue(page, pack, "2");
              await pressOn(page, pack, "Tab");
              await replaceValue(page, strip, "1");
              const expected = `${localeDigits(2, locale)} Pack + ${localeDigits(1, locale)} Strip = ${localeDigits(9, locale)} Strip`;
              await expect
                .poll(async () =>
                  collapseSpaces(
                    stripBidiMarks(
                      await page.locator(".count-live-caption").innerText(),
                    ),
                  ),
                )
                .toBe(expected);
              await expectOnScreen(page.locator(".count-live-caption"));
              placements.push(
                await measureElement(page, ".count-live-caption"),
              );
              return expected;
            },
          );

          await take.step(
            "Type a fractional strip count of 1.5 and press Enter",
            `The entry is refused with "${TEXT[locale].countIntegerOnly}"`,
            async () => {
              const strip = page.locator('[data-count-field="unit:Strip"]');
              await replaceValue(page, strip, "1.5");
              await pressOn(page, strip, "Enter");
              const refusal = page.getByRole("alert");
              await expect(refusal).toContainText(
                TEXT[locale].countIntegerOnly,
              );
              await expectOnScreen(refusal);
              placements.push(await measureElement(page, '[role="alert"]'));
              await expect(strip).toHaveValue("1.5");
              return stripBidiMarks(await refusal.innerText());
            },
          );

          await take.step(
            "Restore the strip count to 1 and commit the count line",
            "The committed line converts to 9 in the base unit against a system balance of 4",
            async () => {
              const strip = page.locator('[data-count-field="unit:Strip"]');
              await replaceValue(page, strip, "1");
              await pressOn(page, strip, "Enter");
              const row = page
                .locator("table.count-lines-table tbody tr")
                .filter({ hasText: fixture.unitsItem.displayName })
                .last();
              await expect
                .poll(async () =>
                  stripBidiMarks(await row.locator("td").nth(1).innerText()),
                )
                .toContain(`${localeDigits(9, locale)} Strip`);
              await expect
                .poll(async () =>
                  stripBidiMarks(await row.locator("td").nth(2).innerText()),
                )
                .toContain(localeDigits(4, locale));
              return stripBidiMarks(await row.innerText()).replaceAll(
                "\n",
                " | ",
              );
            },
          );

          take.note(
            "Record how each surface shapes the digits it shows",
            "Observation only; no scenario figure depends on it",
            'The purchase entry preview and the committed purchase row print the base-unit quantity as exact text ("4 Strip") in both locales, while inventory review and the count caption run it through the locale number formatter and show Arabic-Indic digits in Arabic. The converted quantity is identical either way; only the numeral shaping differs between the two surfaces.',
          );

          take.note(
            'Assess "no fractional base-unit balance ever posts"',
            "Both entry points refuse a fraction, and the property test pins the rest",
            "The purchase row and the count entry each refused a fractional quantity above. The exhaustive claim is pinned by the property test in apps/local-api/src/catalog/catalog-packaging.unit.test.ts and by the bigint inventory columns; this run proves the two renderer entry points.",
          );

          take.note(
            "Measure where each subject of this record sat in the packaged window",
            "Each subject above was also asserted on screen; these are its coordinates",
            placements.length === 0
              ? "(nothing measured in this record)"
              : placements.join(" || "),
          );

          await captureEvidence(take, page, "scenario-units", locale, theme, {
            fullPage: false,
          });
          await captureEvidence(
            take,
            page,
            "scenario-units-full-page",
            locale,
            theme,
          );
          await scanAccessibility(take, page, "the count session loop");
        },
      );
    });
  });
}

/**
 * States how the pass entered dates, from every `enterDate` it made rather than
 * from the first one. A single fallback anywhere has to weaken the claim.
 */
function describeDateEntry(paths: readonly DateEntryPath[]): string {
  const total = paths.length;
  const fallbacks = paths.filter((entry) => entry === "value-api").length;
  if (total === 0) {
    return "This pass entered no date.";
  }
  if (fallbacks === 0) {
    return `All ${String(total)} date entries in this pass accepted a typed key sequence, so every field in the pass — dates included — was reached and filled by keyboard.`;
  }
  if (fallbacks === total) {
    return `None of the ${String(total)} native date controls in this pass accepted a locale-stable typed key sequence, so each was set through the control's value API; every other field in the pass was typed.`;
  }
  return `${String(fallbacks)} of ${String(total)} date entries in this pass did not accept a locale-stable typed key sequence and were set through the control's value API; the other ${String(total - fallbacks)} were typed, as was every other field in the pass.`;
}

function recordId(flow: string, locale: Locale, theme: Theme): string {
  return `${flow}-${locale}-${theme}`;
}

function moduleTab(page: Page, moduleId: string): Locator {
  return page.locator(`a[data-module="${moduleId}"]`);
}

/**
 * Switches the packaged renderer to this pass's locale and theme through the
 * shell header's own controls, by keyboard. The packaged window is already
 * loaded by the time the harness attaches over CDP, so an init script cannot
 * seed the stored preference the way a browser suite does — and pressing the
 * control is what a pharmacist does anyway.
 */
async function applyPresentation(
  page: Page,
  locale: Locale,
  theme: Theme,
): Promise<void> {
  // The shell always starts English and light, so both controls carry their
  // English names here. The theme goes first: once the language has switched,
  // the theme control is labelled in Arabic.
  const controls = page.locator(".preference-controls");
  await expect(controls).toBeVisible();

  if (theme === "dark") {
    await activate(
      page,
      controls.getByRole("button", { name: "Use dark theme", exact: true }),
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }
  if (locale === "ar") {
    await activate(
      page,
      controls.getByRole("button", { name: "Switch to Arabic", exact: true }),
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

async function searchCatalogue(page: Page, query: string): Promise<string> {
  await replaceValue(page, page.locator("input.catalog-rail-search"), query);
  const first = page.locator(".catalog-rail-name").first();
  await expect(first).toHaveText(PANADOL_DISPLAY_NAME);
  return stripBidiMarks(await first.innerText());
}

function productIdFromUrl(url: string): string {
  const match = /#\/catalog\/products\/([^/?]+)/u.exec(url);
  if (match?.[1] === undefined) {
    throw new Error(`No product id in ${url}`);
  }
  return match[1];
}

function saleDraftIdFromUrl(url: string): string {
  const match = /#\/sales\/drafts\/([^/?]+)/u.exec(url);
  if (match?.[1] === undefined) {
    throw new Error(`No sale draft id in ${url}`);
  }
  return match[1];
}

interface EntryRow {
  readonly cost: Locator;
  readonly expiry: Locator;
  readonly inventoryUnits: Locator;
  readonly item: Locator;
  readonly quantity: Locator;
  readonly selling: Locator;
}

/**
 * The purchase entry row's controls, addressed by the renderer's own
 * `data-column-field` hooks rather than by label or by position, so one helper
 * serves both locales and survives a change to the configurable column order.
 */
function entryRow(page: Page): EntryRow {
  const cell = (field: string): Locator =>
    page.locator(`tr.purchase-entry-row [data-column-field="${field}"]`);
  return {
    cost: cell("cost").locator("input"),
    expiry: cell("expiry").locator("input"),
    inventoryUnits: cell("inventory-units"),
    item: cell("item").locator("input"),
    quantity: cell("quantity").locator("input"),
    selling: cell("selling-price").locator("input"),
  };
}

async function committedCell(
  page: Page,
  rowIndex: number,
  field: string,
): Promise<string> {
  return stripBidiMarks(
    await page
      .locator(`[data-post-row="${rowIndex}"][data-post-field="${field}"]`)
      .innerText(),
  ).trim();
}

/**
 * Chooses which fields the purchasing item-details panel shows, through the
 * same public preferences contract the entry-settings disclosure writes.
 *
 * The column order is sent back exactly as the server's default
 * (`purchasing.service.ts` `DEFAULT_ENTRY_PREFERENCES`), because every other
 * flow in this pass addresses the entry row by column position.
 */
async function setDetailsPanelFields(
  api: LocalApi,
  detailsPanelFields: readonly string[],
): Promise<string> {
  const current = await api.request("GET", "/purchases/entry-preferences");
  expect(current.status, JSON.stringify(current.body)).toBe(200);
  const expectedRevision = (current.body as { readonly revision: string })
    .revision;
  const updated = await api.request("PUT", "/purchases/entry-preferences", {
    afterCommit: "new-row",
    columns: [
      { field: "item", visible: true },
      { field: "quantity", visible: true },
      { field: "cost", visible: true },
      { field: "selling-price", visible: true },
      { field: "expiry", visible: true },
    ],
    detailsPanelFields,
    expectedRevision,
    idempotencyKey: uuidV7(),
  });
  expect(updated.status, JSON.stringify(updated.body)).toBe(200);
  return (
    updated.body as { readonly detailsPanelFields: readonly string[] }
  ).detailsPanelFields.join(", ");
}

async function saveInvoiceHeader(
  page: Page,
  supplierId: string,
  invoiceNumber: string,
  locale: Locale,
): Promise<"typed" | "value-api"> {
  const form = page.locator("#purchase-header-form");
  await expect(form).toBeVisible();
  // A draft left open by an earlier flow would be edited instead of a new one
  // created, and its row entry would carry the previous item. Starting a fresh
  // invoice first makes each flow independent of what ran before it; the row
  // workspace exists only while a draft is active, so its presence is the test.
  if ((await page.locator("tr.purchase-entry-row").count()) > 0) {
    await activate(
      page,
      page.getByRole("button", { name: TEXT[locale].newInvoice, exact: true }),
    );
    await expect(page.locator("tr.purchase-entry-row")).toHaveCount(0);
  }
  const datePath = await enterDate(
    page,
    form.locator('input[type="date"]'),
    "2026-09-08",
  );
  await replaceValue(
    page,
    form.locator('input[maxlength="120"]'),
    invoiceNumber,
  );
  await selectByKeyboard(page, form.locator("select"), supplierId);
  await activate(
    page,
    page.locator('button[type="submit"][form="purchase-header-form"]'),
  );
  return datePath;
}

/**
 * Posts the open invoice from its explicit action and clears the receipt.
 *
 * The receipt stays on screen until the user dismisses it, so leaving it there
 * would let a later flow read a previous invoice's result. Asserting the
 * supplier invoice number and then dismissing makes each post self-evident.
 */
async function postInvoice(page: Page, invoiceNumber: string): Promise<string> {
  await activate(
    page,
    page.locator(".purchase-review-actions button.primary-button"),
  );
  const receipt = page.locator(".posted-purchase-result");
  await expect(receipt).toContainText(invoiceNumber);
  // The receipt is rendered in the ordinary document flow below the invoice, so
  // unlike a message inside a scroller it is reachable by scrolling the page
  // and a full-page capture does photograph it. Its place in the window is
  // measured and recorded rather than asserted, because "the posted result is
  // shown" does not claim it lands above the fold.
  await expect(receipt).toBeVisible();
  const placement = await measureElement(page, ".posted-purchase-result");
  const text = stripBidiMarks(await receipt.innerText()).replaceAll(
    "\n",
    " | ",
  );
  await activate(
    page,
    receipt.locator(".posted-purchase-heading button.primary-button"),
  );
  await expect(receipt).toHaveCount(0);
  return `${text} · placement ${placement}`;
}

async function commitRow(
  page: Page,
  options: {
    readonly barcode: string;
    readonly cost: string;
    readonly expiry: string;
    readonly observeBeforeExpiry?: () => Promise<void>;
    readonly quantity: string;
    readonly selling?: string;
  },
): Promise<"typed" | "value-api"> {
  const row = entryRow(page);
  await typeInto(page, row.item, options.barcode);
  await pressOn(page, row.item, "Enter");
  await expect(row.quantity).toBeFocused();
  await replaceValue(page, row.quantity, options.quantity);
  await pressOn(page, row.quantity, "Enter");
  await expect(row.cost).toBeFocused();
  await replaceValue(page, row.cost, options.cost);
  if (options.observeBeforeExpiry !== undefined) {
    await options.observeBeforeExpiry();
  }
  await pressOn(page, row.cost, "Enter");
  if (options.selling !== undefined) {
    await expect(row.selling).toBeFocused();
    await replaceValue(page, row.selling, options.selling);
    await pressOn(page, row.selling, "Enter");
  }
  await expect(row.expiry).toBeFocused();
  const datePath = await enterDate(page, row.expiry, options.expiry);
  await pressOn(page, row.expiry, "Enter");
  await expect(row.item).toBeFocused();
  return datePath;
}

/**
 * Opens one posted invoice in the posted register. The register opener is the
 * only control in this harness addressed by its visible text, because it
 * carries no id, class, or `data-` hook of its own; its copy is taken from the
 * active locale rather than guessed.
 */
async function openPostedInvoice(
  page: Page,
  purchaseId: string,
  locale: Locale,
): Promise<void> {
  await activate(page, moduleTab(page, "purchases"));
  await activate(
    page,
    page.getByRole("button", { name: TEXT[locale].postedInvoices }),
  );
  await activate(
    page,
    page.locator(`[data-review-focus="posted-${purchaseId}"]`),
  );
  await expect(page.locator("#posted-detail-title")).toBeVisible();
}

async function startAdjustment(page: Page): Promise<void> {
  const detailId = await page
    .locator('[data-review-focus^="adjustment-"]')
    .getAttribute("data-review-focus");
  if (detailId === null) {
    throw new Error("The posted invoice offers no adjustment action");
  }
  await activate(page, page.locator(`[data-review-focus="${detailId}"]`));
  await expect(page.locator("section.purchase-adjustment")).toBeVisible();
  await selectByKeyboard(
    page,
    page.locator(".adjustment-form select").first(),
    "quantity error",
  );
  await activate(page, page.locator(".adjustment-form > button").last());
  await expect(page.locator(".adjustment-form table")).toBeVisible();
}

function adjustmentQuantity(page: Page, product: Product): Locator {
  return page
    .locator("section.purchase-adjustment table tbody tr")
    .filter({ hasText: product.displayName })
    .locator("td")
    .first()
    .locator("input");
}

async function postPurchaseReturn(
  page: Page,
  purchaseId: string,
  product: Product,
  quantity: string,
  locale: Locale,
  options: { readonly open?: boolean } = {},
): Promise<string> {
  if (options.open === true) {
    await closeDialogIfOpen(page);
    await openPostedInvoice(page, purchaseId, locale);
  }
  await activate(
    page,
    page.locator(`[data-review-focus="return-${purchaseId}"]`),
  );
  const workflow = page.locator("section.purchase-return");
  await expect(workflow).toBeVisible();
  const startForm = workflow.locator(".return-form");
  await typeInto(
    page,
    startForm.locator("textarea").first(),
    "Supplier accepted damage",
  );
  await typeInto(
    page,
    startForm.locator("textarea").nth(1),
    `Supplier collection note ${purchaseId}`,
  );
  await activate(page, startForm.locator("button").last());
  await expect(workflow.locator(".return-form table")).toBeVisible();
  const quantityField = workflow
    .locator("table tbody tr")
    .filter({ hasText: product.displayName })
    .locator("input")
    .first();
  await replaceValue(page, quantityField, quantity);
  await activate(page, workflow.locator(".return-form > button").last());
  const summary = workflow.locator(".return-summary");
  await expect(summary).toBeVisible();
  await replaceValue(
    page,
    summary.locator('input[type="password"]'),
    OWNER_PASSWORD,
  );
  await activate(page, summary.locator("button").last());
  await expect(workflow.locator("div[role='status']")).toBeVisible();
  return stripBidiMarks(
    await workflow.locator("div[role='status']").innerText(),
  ).replaceAll("\n", " ");
}

/**
 * Closes the posted-purchase register from its own Close control.
 *
 * An unfinished correction draft makes the register ask before leaving instead
 * of closing, so the close is followed through: delete the draft, then close.
 * That is the same path a user takes, and it keeps one flow's leftover draft
 * from blocking the next flow behind a modal dialog.
 */
async function closeDialogIfOpen(page: Page): Promise<void> {
  const dialog = page.locator("dialog[open]");
  if ((await dialog.count()) === 0) {
    return;
  }
  await activate(page, page.locator(".posted-review-heading button"));
  const leaveWarning = page.locator('dialog[open] [role="alertdialog"]');
  if ((await leaveWarning.count()) > 0) {
    await activate(page, leaveWarning.locator("button").last());
    await activate(page, page.locator(".posted-review-heading button"));
  }
  await expect(dialog).toHaveCount(0);
}

/**
 * Asserts that a subject a record claims "appeared" is genuinely on screen.
 *
 * `toHaveText` and `toContainText` are satisfied by an element that is hidden,
 * or parked outside the viewport, or scrolled out of an inner scroller — and a
 * full-page screenshot cannot reach inside a scroller either, so neither the
 * assertion nor the picture would show what the record claims. Nothing here
 * scrolls the subject into view first: if a message or panel is only reachable
 * by scrolling, that is the finding.
 */
/**
 * For a cell inside a data table that scrolls horizontally by design
 * (`.inventory-table-scroll`), where a user reads one column at a time and the
 * table is *meant* to be wider than the window. The subject still has to be on
 * screen; it does not have to fit whole. Everything a user must take in as a
 * unit — a panel, a message, a single converted quantity — uses
 * {@link expectOnScreen} instead, and the measurement note records
 * `fullyInsideViewport` either way so the difference is visible.
 */
async function expectReachableOnScreen(subject: Locator): Promise<void> {
  await expect(subject).toBeVisible();
  await expect(subject).toBeInViewport();
}

async function expectOnScreen(subject: Locator): Promise<void> {
  await expect(subject).toBeVisible();
  // ratio 1, not the default: a subject one pixel of which peeks into the
  // window is not a subject a person can read, and the default ratio would
  // call that "in viewport".
  await expect(subject).toBeInViewport({ ratio: 1 });
}

/**
 * Measures where an element actually sits in the packaged window, and whether
 * an ancestor scroller is hiding it, so a verdict about visibility can be read
 * rather than inferred.
 */
async function measureElement(page: Page, selector: string): Promise<string> {
  // Evaluated as source text: the Node test project carries no DOM library,
  // so a typed callback cannot name `document`, `window` or `getComputedStyle`.
  const script = `(() => {
    const round = (value) => Math.round(value);
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);
    if (element === null) return JSON.stringify({ found: false, selector });
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const scrollingAncestors = [];
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      const scrollsWider = node.scrollWidth > node.clientWidth + 1;
      const scrollsTaller = node.scrollHeight > node.clientHeight + 1;
      if (!scrollsWider && !scrollsTaller) continue;
      if (!/auto|scroll|overlay/u.test(nodeStyle.overflowX + " " + nodeStyle.overflowY)) continue;
      scrollingAncestors.push({
        className: String(node.className),
        clientHeight: node.clientHeight,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        scrollLeft: round(node.scrollLeft),
        scrollTop: round(node.scrollTop),
        scrollWidth: node.scrollWidth,
        tag: node.tagName.toLowerCase(),
      });
    }
    return JSON.stringify({
      display: style.display,
      found: true,
      fullyInsideViewport:
        box.left >= 0 && box.top >= 0 &&
        box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      intersectsViewport:
        box.right > 0 && box.bottom > 0 &&
        box.left < window.innerWidth && box.top < window.innerHeight,
      rect: {
        bottom: round(box.bottom), height: round(box.height),
        right: round(box.right), width: round(box.width),
        x: round(box.x), y: round(box.y),
      },
      scrollingAncestors,
      selector,
      visibility: style.visibility,
      windowInnerHeight: window.innerHeight,
      windowInnerWidth: window.innerWidth,
    });
  })()`;
  const measurements = JSON.parse(
    String(await page.evaluate(script)),
  ) as Record<string, unknown>;
  const locatorVisible = await page.locator(selector).first().isVisible();
  return JSON.stringify({ ...measurements, locatorVisible });
}

async function measurePanel(page: Page): Promise<string> {
  return await measureElement(page, "aside.purchase-item-panel");
}

/** Opens one item's movement history from the inventory review grid. */
async function openItemMovements(page: Page, productId: string): Promise<void> {
  await activate(page, moduleTab(page, "inventory"));
  await expect(page.locator("#inventory-title")).toBeVisible();
  await activate(
    page,
    page.locator(`button[data-review-focus="inventory-item-${productId}"]`),
  );
  await expect(page.locator("#inventory-movement-title")).toBeVisible();
}

function movementRows(page: Page): Locator {
  return page.locator(".inventory-table-scroll table tbody tr");
}

function inventoryRow(page: Page, product: Product): Locator {
  return page
    .locator("table tbody tr")
    .filter({ hasText: product.displayName });
}

async function adjustmentMovements(
  api: LocalApi,
  productId: string,
): Promise<readonly InventoryMovement[]> {
  const response = await api.request(
    "GET",
    inventoryMovementHistoryPath(productId),
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const { movements } = response.body as {
    readonly movements: InventoryMovement[];
  };
  return movements.filter(
    (movement) => movement.kind === "purchase-adjustment",
  );
}

async function basketProductIds(api: LocalApi): Promise<readonly string[]> {
  const response = await api.request("GET", reorderBasketPath());
  expect(response.status).toBe(200);
  return (response.body as { readonly items: ReorderItem[] }).items.map(
    (item) => item.productId,
  );
}

/**
 * Captures one screenshot into the bundle.
 *
 * `fullPage` is the default because most flows are read top to bottom, but a
 * full-page capture of a workspace that scrolls sideways can leave the very
 * thing a record is about out of the picture. A flow whose subject sits beside
 * the main canvas asks for `fullPage: false`, which photographs exactly what a
 * user sees in the packaged window.
 */
async function captureEvidence(
  take: Take,
  page: Page,
  flow: string,
  locale: Locale,
  theme: Theme,
  options: { readonly fullPage?: boolean } = {},
): Promise<void> {
  const fileName = `${flow}-${locale}-${theme}.png`;
  const filePath = acceptanceEvidencePath(fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await page.screenshot({
    animations: "disabled",
    fullPage: options.fullPage ?? true,
    path: filePath,
  });
  take.addScreenshot(fileName);
}

async function scanAccessibility(
  take: Take,
  page: Page,
  surface: string,
): Promise<void> {
  await take.step(
    `Run an axe accessibility scan on ${surface}`,
    "No accessibility violations",
    async () => {
      // Legacy mode keeps the whole scan inside the packaged window. The
      // default mode finishes its run in a fresh blank page, and Electron's
      // CDP has no `Target.createTarget`, so it cannot open one. The packaged
      // renderer has no cross-origin frames, which is the only thing the
      // default mode adds.
      const results = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
      return `${results.passes.length} axe checks passed, 0 violations`;
    },
  );
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
