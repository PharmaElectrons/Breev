# Project-wide localization and formatting QA audit

**Audit date:** 1 October 2026. **Disposition:** audit only; no fixes, application-code changes, migrations, or merges.

**Result:** 40 screen/view families reviewed, with nested surfaces and failure states reviewed separately. **17 distinct confirmed findings: 1 High, 12 Medium, 4 Low.** Repeated occurrences are grouped under their shared cause rather than counted as separate bugs.

## Baseline and method

- The running application and source review used [`9460c6065eecb1b4ebd4dade69350cf8dcd30239`](https://github.com/PharmaElectrons/Breev/tree/9460c6065eecb1b4ebd4dade69350cf8dcd30239), `issue/33-report-inventory-consumption`, including the latest report-localization fixes in open [PR #201](https://github.com/PharmaElectrons/Breev/pull/201).
- Remote `dev` was fetched and recorded at [`ae4752d338d82a939bbfb43fa4ef6f748ac9b46d`](https://github.com/PharmaElectrons/Breev/tree/ae4752d338d82a939bbfb43fa4ef6f748ac9b46d). The publication branch is based on this remote `dev`, not the older local `dev` branch. The audit covers the existing application plus the report extension on PR #201; it does not claim those reports are already merged into `dev`.
- Product, glossary, workflow, domain, architecture, quality, traceability, and local-authority ADR documentation were read. Governing presentation requirements are [bilingual local operation](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/docs/product.md), [UTC persistence and pharmacy-zone display](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/docs/domain.md), and [Arabic/English usability and state coverage](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/docs/quality.md). This audit changes no requirement or release gate.
- Source inspection covered every production renderer screen/component and message catalogue, shared formatting/input helpers, navigation, relevant Main-process dialogs, CSV serializers, and print surfaces. Prototype text and unmerged feature branches were not treated as shipped application behavior.
- The renderer was rebuilt and exercised in Playwright Chromium on Linux against the real local API and a **new disposable PostgreSQL 18.6 container**, with separated application/migration roles. No existing pharmacy database or workstation configuration was used. Only the desktop bridge was faked, as in the repository's browser seam.
- Synthetic data included `Strip`, `Pack`, `Bottle`, an Arabic-entered unit, 1,234 inventory units, a 12.5% supplier allowance, fractional-fils-equivalent IQD prices, posted purchases, purchase and sale drafts, stocktake movements, and reorder items. Operations only affected the disposable database.
- Runtime inspection used Arabic/RTL and English/LTR at 1366×768, predominantly light theme, with dashboard dark-theme captures. A separate browser timezone probe used `America/Los_Angeles` against the pharmacy's `Asia/Baghdad` zone. Print CSS was exercised with Chromium print-media emulation; this is not physical-printer certification.
- Network failure and Catalog permission-denial presentations were reproduced using controlled browser response interception. These prove UI handling, not a new server-authorization defect. Arabic/Persian input probes used the real API and renderer.

**Evidence notation:** **R** = observed in the running renderer; **S** = confirmed from a reachable rendering/serialization path in source; **B** = desktop-bridge presentation fixture. Local screenshots and text/control snapshots are in `test-results/project-localization-audit/`. They are intentionally Git-ignored. Only this README is published, as requested; screenshot filenames below refer to local captures, not files on the audit branch. Exact text excerpts and immutable source links make the published findings independently reviewable.

## Screen coverage

Each row counts once, irrespective of language, theme, reloads, or screenshot count. Report categories and Settings tabs count separately because they expose different tables/forms. A screenshot of a route that fell back to another view was not counted as a separate screen.

| #   | Screen/view and route/entry                                               | Coverage                                                                                                             |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 01  | Pharmacy/first-owner setup, unauthenticated root                          | R: Arabic/English labels and form; S: validation/denials                                                             |
| 02  | Login/session recovery, unauthenticated root                              | S: form, invalid/expired/revoked-session messages and loading                                                        |
| 03  | Startup/recovery shell                                                    | S: starting, connecting, ready, Main unavailable, incompatible, repair, unpaired; R/B: ready and unpaired            |
| 04  | Dashboard, `#/dashboard`                                                  | R: both languages, light/dark, KPI cards, notifications, filters, table, identifiers                                 |
| 05  | Open/suspended Sales draft list, `#/sales`                                | R: empty/populated; S: suspended/denied/error states                                                                 |
| 06  | Active Sales draft, `#/sales/drafts/<id>`                                 | R: invoice, item/batch panel, calculator, misc form, clear confirmation; S: remaining nested controls                |
| 07  | Catalog list/search, `#/catalog/products`                                 | R: both languages, rail, counts, matching opener; S: empty/search/load-more                                          |
| 08  | Product record, `#/catalog/products/<id>`                                 | R: units, stock levels, usage, prices, barcode, archive/merge; controlled error/denial                               |
| 09  | Create Product, `#/catalog/products/new`                                  | R: both languages; S: mode switch and nested packaging/pricing controls                                              |
| 10  | Edit Product, `#/catalog/products/<id>/edit`                              | R: both languages, Arabic/Persian price validation and language switching                                            |
| 11  | Purchase invoice workspace, `#/purchases`                                 | R: empty and populated rows, units, totals, allowance, entry/settings controls                                       |
| 12  | Saved Purchase Drafts, Purchasing tab                                     | R: list, search/date/payment filters, open/discard                                                                   |
| 13  | Posted Purchase register, Purchasing tab                                  | R: both languages, table, totals and invoice navigation                                                              |
| 14  | Posted Purchase detail, register row / `#/purchases/posted/<id>`          | R: both languages, snapshot, allowance, rows, source-record controls                                                 |
| 15  | Purchase Adjustment workspace, posted-detail action                       | R: both languages, reason options and editor; S: delta, denial/success, posted snapshot                              |
| 16  | Purchase Return workspace, posted-detail action                           | R: both languages, reason/evidence entry; S: row/summary/posted/error stages                                         |
| 17  | Supplier list, Purchasing Suppliers tab                                   | R: both languages, archived filter, empty/add/save controls                                                          |
| 18  | Selected Supplier profile, same tab                                       | R: allowance/payment/due-period form; S: merge/archive and error handling                                            |
| 19  | Inventory review, `#/inventory`                                           | R: both languages, summary/grid, column settings, selected item panel, export entry                                  |
| 20  | Item movements and batch-safety panel, `#/inventory/items/<id>/movements` | R: both languages, movements, expiry, status, generated count source; S: FEFO/history/corrections                    |
| 21  | Monthly safety review, `#/inventory/safety-review`                        | R: Arabic empty/missed-run state; S: English, month controls and populated table                                     |
| 22  | Stocktake register, `#/inventory/count`                                   | R: Arabic active/completed sections and empty states; S: English and pagination                                      |
| 23  | Stocktake session, `#/inventory/count/<id>`                               | R: Arabic matched line; S: English, entry, stale/variance/apply/completion states                                    |
| 24  | Reorder basket, `#/basket`                                                | R: both languages, quantities/units and Arabic/Persian input; S: invalid/denied/confirmation                         |
| 25  | Ordered Items, `#/basket/ordered`                                         | R: Arabic empty view; S: English and populated/date/status/undo paths                                                |
| 26  | Quantity report, `#/reports/inventory/quantity`                           | R: both languages, filters, table, pagination, activity and source dialogs                                           |
| 27  | Value report, `#/reports/inventory/value`                                 | R: both languages; S: valuation denial and exact money formatting                                                    |
| 28  | Average-cost report, `#/reports/inventory/average-cost`                   | R: both languages; S: scaled precision/input validation                                                              |
| 29  | Batches/expiry report, `#/reports/inventory/batches-expiry`               | R: both languages, dates/status/unit cells                                                                           |
| 30  | Consumption report, `#/reports/inventory/consumption`                     | R: both languages, window options and unavailable-demand explanation                                                 |
| 31  | Alerts report, `#/reports/inventory/alerts`                               | R: both languages, historical-policy explanations; S: status filter options                                          |
| 32  | Stocktake-movements report, `#/reports/inventory/stocktake-movements`     | R: both languages, initial empty state; S: populated sources/columns                                                 |
| 33  | Pharmacy settings, `#/settings/pharmacy`                                  | R: both languages; S: save/error behavior                                                                            |
| 34  | Password settings, `#/settings/password`                                  | R: both languages; S: validation/denial/success                                                                      |
| 35  | User management, `#/settings/users`                                       | R: both languages, built-in roles/status; Arabic Step-Up and create form; S: remaining dialogs                       |
| 36  | Role/permission management, `#/settings/roles`                            | R: both languages, group tabs/counts and permission descriptions; S: create/rename/error                             |
| 37  | Licence/devices settings, `#/settings/licence`                            | R: both languages, Free Core/renewal form; S: paid/grace/expiry and devices/pairing/seat-release surfaces            |
| 38  | Connection/system information, `#/settings/connection`                    | R: both languages, identifiers and localized status labels                                                           |
| 39  | Patient route, `#/patients`                                               | R: both languages, actual unavailable screen; no Patient Profile implementation on this baseline                     |
| 40  | Additional-terminal pairing ceremony                                      | B: both languages, invitation/manual address/no-discovery empty state; S: progress/fingerprint/failure/expiry states |

Nested review also covered the navigation menu and diagnostic confirmation/fallback; identity Step-Up, user creation/reset and role creation/rename; Catalog daily matching, archive/merge, mode-switch and packaging confirmations; barcode print label; Sales calculator, price dialog, misc/quick-create and quick-access controls, clear/discard confirmations; supplier archive/merge; Purchase discard, column preferences, row editing, review, delta and return summaries; batch quarantine/recall/expiry amendment, FEFO/history; stocktake variance/completion/review; report filter validation, activity/source/correction/count dialogs, grouping and export outcomes; protected-export Step-Up; and licence/device/pairing/seat-release states. **Source coverage is not a claim that every nested stage was manually completed in both languages.**

## Confirmed findings

### F01 — Recognized unit display names are mapped inconsistently

**Severity: Medium. Modes: Arabic. Evidence: R + S.**

- **Screens:** Catalog record/default-unit dropdowns; active Sales row/unit selector/item panel/price dialog/quick-access labels; Purchase rows and item panel; Inventory item panel; basket and Ordered Items; print snapshots where the same helpers are used.
- **Exact problem:** Catalog displays `Strip`, `Pack`, `Pack = 4 Strip`; Sales displays `Pack`, `١٬٢٣٤ Strip` and `Pack = 4 Strip`. The basket displays `١٬٢٣٤ Bottle`, while its Pack/Strip names are Arabic. The shared Inventory item panel displays `BOTTLE`, `الإجمالي : ١٬٢٣٤ Bottle`, and `١ علبة = ٤ Bottle`. The report table correctly displays `زجاجة` for the same stored `Bottle` value.
- **Expected:** approved recognized names consistently display `شريط`, `علبة`, `زجاجة`, etc., with localized quantities and isolated direction. Preserve the stored unit identity, package ratio, custom name, and historical snapshot.
- **Cause/components:** [panel-unit-label.ts](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/panel-unit-label.ts#L88) only recognizes Pack/Strip, while [report-workspace.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/report-workspace.tsx#L64) has a broader report-only mapping. `product-record.tsx`, `product-form.tsx`, `sales-invoice-view.tsx`, `sales-workspace-view.tsx`, `sales-price-dialog.tsx`, and `sales-screen.tsx` also interpolate unit names directly.
- **Captures:** `product-record-ar.png`, `product-edit-ar.png`, `sales-active-ar.png`, `basket-ar.png`, `inventory-item-panel-deep-ar.png`, `report-category-quantity-ar.png`.

### F02 — Ordinary counts and quantities bypass locale formatting

**Severity: Medium. Modes: Arabic; English grouping also affected. Evidence: R + S.**

- **Screens:** Dashboard table/notifications, Catalog rail/record, Sales item panel, Purchasing lists/rows/navigation, Inventory item panel and basket badge, stocktake/safety review, role permission-group tabs.
- **Exact problem:** Arabic Dashboard shows `3 مادة`, stock `1234`, alert `حد إعادة الطلب: 10000`, and monthly rate `309.0`, alongside correctly Arabic-formatted profit. Catalog shows `المواد (3)`, `عدد نتائج البحث: 3`, stock levels `10000`/`20000`, `4 Strip`, and usage count `3`. Roles show `3/3`, `2/2`, etc. while role summaries use `٢٧ من ٢٧`. Safety review shows `التقييمات المكتملة: 0، التواريخ الفائتة: 1`. Purchase rows/snapshots show quantity `1234`, and navigation shows `1 / 3`.
- **Expected:** the active locale's digit/grouping/decimal conventions for ordinary display: e.g. `١٬٢٣٤`, `١٠٬٠٠٠`, `٣٠٩٫٠`, `٣/٣`; English large quantities should also be grouped consistently. Keep document IDs, technical revisions and editable canonical values separate from ordinary display counts.
- **Cause/components:** direct JSX interpolation, `.toString()` and `.toFixed()` rather than the existing formatter: `home-screen.tsx`, `catalog-screen.tsx`, `product-record.tsx`, `sales-workspace-view.tsx`, `purchase-row-entry.tsx`, `posted-purchase-review.tsx`, `posted-purchase-snapshots.tsx`, `role-editor.tsx`, `batch-safety-review.tsx`, `purchase-item-details.tsx`, and count/message templates.
- **Captures:** `dashboard-ar.png`, `product-record-ar.png`, `settings-roles-ar.png`, `batch-safety-review-ar.png`, `purchase-editor-ar.png`, `posted-detail-open-ar.png`.

### F03 — Percentages use raw digits/decimal text across screens

**Severity: Medium. Modes: Arabic. Evidence: R + S.**

- **Screens:** Dashboard KPI/table, Purchase Draft allowance strip, posted Purchase/print snapshot, Supplier drill-down and adjustment displays, Sales discount cells.
- **Exact problem:** `0.0%`, `35.2%`, and `12.5%` appear in Arabic views. Sales at least localizes the numeral but independently appends `%`; other percentage displays bypass even numeric localization.
- **Expected:** one consistent localized percent presentation preserving the exact rate, e.g. `٣٥٫٢٪` and `١٢٫٥٪`, with an approved symbol/spacing convention and no change to rate calculations.
- **Cause/components:** `home-screen.tsx` `.toFixed(1)`, direct `allowancePercentageSnapshot` in `purchasing-screen.tsx` / `posted-purchase-review.tsx` / `posted-purchase-snapshots.tsx`, and independent percentage templates in Sales and adjustment components.
- **Captures:** `dashboard-ar.png`, `purchase-editor-ar.png`, `posted-detail-open-ar.png`, `posted-purchase-print-ar.png`.

### F04 — Purchase row money is shown as bare fils under denomination-free headings

**Severity: High. Modes: Arabic and English. Evidence: R + S.**

- **Screen:** populated Purchase invoice workspace, saved draft opened for row entry.
- **Exact problem:** the saved row under `الكلفة الأساسية` / `Primary supplier cost` displays `800000`; `سعر البيع` / `Selling price` displays `1234567`. Those are **fils**, representing IQD 800.000 and IQD 1,234.567. The displayed column headings do not identify fils. Nearby posted and Catalog views display dinars with a currency label, creating a 1,000-fold denomination ambiguity. Review totals separately say `987200000 فلس`, so the problem is specifically the bare monetary row cells, not an incorrect server total.
- **Expected:** clearly denominated, localized exact amounts: e.g. `٨٠٠٫٠٠٠ د.ع` / `IQD 800.000`, or an explicitly fils-labelled presentation (`٨٠٠٬٠٠٠ فلس`) if that is the approved entry convention. No stored-price, calculation, conversion-ratio, posting or rounding change.
- **Cause/component:** [purchase-row-entry.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/purchase-row-entry.tsx#L2425), `rowCell` directly renders `row.costFils` / `row.retailPriceFils`.
- **Captures:** `purchase-editor-ar.png`, `purchase-editor-en.png`. Treat the monetary row ambiguity separately from the already tracked Adjustment misleading-total work in #190/#198.

### F05 — Dashboard currency formatting loses fils and disagrees with other screens

**Severity: Medium. Modes: Arabic and English. Evidence: R + S.**

- **Screens:** Dashboard warehouse cost/retail KPI and money displays compared with Catalog, Sales and Inventory.
- **Exact problem:** Arabic KPI shows `2,961,600 د.ع` and `4,570,367 د.ع` with Latin digits/separators. Synthetic retail value is IQD **4,570,367.034**; the KPI formatter discards the `.034`. Elsewhere the same application uses Arabic digits and exact fractional IQD. English formatter placement also varies: Catalog `1,234.567 IQD`, Sales/Inventory `IQD 1,234.567`, Dashboard `… IQD`.
- **Expected:** preserve the exact value or explicitly identify a professionally approved aggregate-display rounding policy; use consistent locale digits, separators, currency placement and precision conventions. Formatting cleanup must not introduce an accounting rounding decision.
- **Cause/components:** [home-screen.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/home-screen.tsx#L223) divides `bigint` by 1,000 before converting to `Number` and calls `toLocaleString("en-US")`; it duplicates `product-record.tsx::formatFilsToIqd` and `preferences.ts::formatCurrencyFromFils`.
- **Captures:** `dashboard-ar.png`, `dashboard-dark-en.png`, `product-record-ar.png`, `sales-active-ar.png`, `inventory-ar.png`.

### F06 — Date-only values leak ISO storage strings into localized UI and print

**Severity: Medium. Modes: Arabic and English. Evidence: R + S.**

- **Screens:** Dashboard expiry, Sales batch panel, Purchase Draft/register/detail/adjustment/return and print, Inventory grid/item panel/batches/status history, reports/activity/source snapshots.
- **Exact problem:** Arabic displays `2027-01-31`, `2026-09-30`, and `2026-10-01` beside localized dates such as `٠١‏/١٠‏/٢٠٢٦`. Reports localize posting timestamps but still show raw ISO values for recorded expiry and business date. Print snapshots do the same.
- **Expected:** consistent active-locale **date-only** display (e.g. `٣١‏/٠١‏/٢٠٢٧` / `31 Jan 2027`, subject to the existing product convention). Native control values may remain ISO internally. Do not convert a date-only business/expiry fact through a timezone or change its day.
- **Cause/components:** direct `invoiceDate` / `expiryDate` / `businessDate` JSX; [report-workspace.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/report-workspace.tsx#L53) formats `postedAt` but falls through for date-only columns. Owners include `home-screen.tsx`, `sales-workspace-view.tsx`, `purchase-row-entry.tsx`, `posted-purchase-review.tsx`, `posted-purchase-snapshots.tsx`, `purchase-item-details.tsx`, `inventory-screen.tsx`, and `batch-safety-panel.tsx`.
- **Captures:** `dashboard-ar.png`, `inventory-movements-ar.png`, `posted-detail-open-ar.png`, `posted-purchase-print-ar.png`, `report-category-batches-expiry-ar.png`, `report-activity-dialog-ar.png`.

### F07 — Timestamp formatters disagree on locale, precision, clock style and timezone

**Severity: Medium. Modes: Arabic and English. Evidence: R + S.**

- **Screens:** shell clock, Inventory movements/counts, Sales drafts, paid licence/device dates, Purchasing timestamps, report activity and source snapshots.
- **Exact problem:** the shell clock uses `en-GB` in both modes (`15:28`); English header date is `1 Oct 2026`, but movement timestamps are `Oct 1, 2026` / `3:28:38 PM`, and Purchase timestamps omit seconds (`Oct 1, 2026, 3:28 PM`). Purchasing uses `ar-EG`/`en-US`, general helpers use `ar-IQ`/`en-IQ`, and the header uses `en-GB`. Most timestamp helpers omit `timeZone`, so they follow the workstation; report activity correctly uses the pharmacy timezone. Report source snapshots reuse the workstation-zone formatter, despite being opened from a pharmacy-zone report.
- **Expected:** the same UTC event displays in the pharmacy's configured zone across operational views, report drill-down and print, with deliberate, consistent locale and precision conventions. The shell's current-time clock can remain a workstation clock if explicitly identified, but it must follow an approved Arabic/English digit/clock presentation. Persisted UTC instants and business dates stay unchanged.
- **Cause/components:** [preferences.ts](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/preferences.ts#L35), `settings-screen.tsx::formatLicenceDate`, `purchasing-screen.tsx::formatDraftTimestamp`, `posted-purchase-snapshots.tsx::formatTimestamp`, `report-correction-snapshot.tsx`, `count-session-review.tsx`, and [app-shell.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/app-shell.tsx#L488). Only `report-time.ts::reportTimestamp` explicitly receives the pharmacy zone; `report-source-review.tsx` forwards it to unit/source-label helpers, not snapshot timestamps.
- **Evidence:** default-zone captures show the style differences. With the workstation set to Los Angeles, `report-timezone-los-angeles-en.png` displays the receipt at `Oct 1, 2026, 3:28:38 PM`; `report-source-timezone-los-angeles-en.png` displays that same receipt's Posted at value as `Oct 1, 2026, 5:28 AM`. The activity uses Baghdad time, while its source snapshot uses workstation time.

### F08 — English report header exposes the raw timezone identifier

**Severity: Low. Mode: English. Evidence: R + S. PR #201 extension.**

- **Screen:** all seven Inventory report categories.
- **Exact problem:** visible heading `Asia/Baghdad`. Arabic correctly says `توقيت بغداد`.
- **Expected:** a friendly English display label, e.g. `Baghdad time`, retaining `Asia/Baghdad` as the underlying query/configuration ID. An explicitly labelled technical-details field may retain the ID.
- **Cause/component:** [report-time.ts](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/report-time.ts#L10) returns the raw ID for English.
- **Capture:** `report-category-quantity-en.png`. The earlier report-only fix deliberately preserved English mappings; this audit records the remaining presentation gap without changing that branch.

### F09 — Catalog exposes raw failures/denial codes and a misleading error heading

**Severity: Medium. Modes: Arabic and English. Evidence: R + S.**

- **Screens:** Catalog list/detail, Product Form and Product Record barcode/archive/merge actions; the same forms are reused in quick creation.
- **Exact problem:** aborting the barcode-print request produces Arabic heading `المنتج المطلوب غير موجود في الفهرس.` followed by **`Failed to fetch`**, even though the Product exists. A contract-valid intercepted permission denial shows **`permission-denied`** in both language modes. Product Form generic errors also use `error.message` directly.
- **Expected:** localized, action-appropriate explanations (`تعذر طباعة الباركود. تحقق من الاتصال وحاول مجدداً.` / `The barcode label could not be printed. Check the connection and try again.`; permission denial via the existing localized permission message). Keep a labelled support/reference identifier where intentionally exposed.
- **Cause/components:** [catalog-screen.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/catalog-screen.tsx#L87) stores `err.message`; [product-record.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/product-record.tsx#L110) does the same and hardcodes the not-found catalogue heading at line 246; `product-form.tsx` repeats raw generic-error handling.
- **Captures:** `catalog-network-error-ar.png`, `catalog-network-error-en.png`, `catalog-denied-ar.png`, `catalog-denied-en.png`; text snapshots record the alert even when the scrolled record hides it above the viewport.
- The old Purchasing `adjustment-empty · <UUID>` dump is already tracked in #189/#198 and is not duplicated here.

### F10 — Existing validation/error strings retain the previous language

**Severity: Medium. Modes: Arabic → English and English → Arabic. Evidence: R + S.**

- **Screen:** Product edit, after an invalid numeric submission and in-place language switch; component is reused by Catalog and quick-create/edit paths.
- **Exact problem:** after Arabic → English, the English form still shows `بيانات المنتج المدخلة غير صالحة.` and `قيمة غير صالحة.`. After English → Arabic, the Arabic form still shows `The submitted product data is invalid.` and `Invalid value.`.
- **Expected:** visible validation and status messages follow the current language immediately, preserving input and error association. Do not re-submit or mutate the business operation to translate a message.
- **Cause/component:** `product-form.tsx` stores translated strings in `generalError` and `fieldErrors`. Several other components also store translated error/announcement strings; these are a cleanup search scope, not independently counted confirmed runtime bugs. Reports already contain specific locale-change protections.
- **Captures:** `product-validation-language-switch-ar.png` (resulting English mode), `product-validation-language-switch-en.png` (resulting Arabic mode).

### F11 — Arabic/Persian numeric input is accepted in some modules and rejected in others

**Severity: Medium. Modes: Arabic and English with Arabic/Persian pasted digits. Evidence: R + S.**

- **Screens:** Product edit price, Sales invoice-discount field; equivalent ASCII-only parsers exist in Sales price/calculator. Basket and stocktake/report adapters provide working precedents.
- **Exact problem:** Product price `١٢٣٤٥٦٧` or `۱۲۳۴۵۶۷` yields `قيمة غير صالحة.` / `Invalid value.`; those inputs represent the same valid fils value as `1234567`. Sales discount `١٢٫٥٠٠` and `۱۲.۵۰۰` are rejected with the localized “at most three decimal places” message, while `12.500` succeeds. Basket quantities `١٨٧٦٦` and `۱۸۷۶۶` normalize successfully to `18766`.
- **Expected:** normalize recognized Arabic-Indic/Persian digits and the supported localized decimal separator at the UI input boundary, then apply the **same existing** exact-number grammar, range, unit and precision validation. Invalid input must not silently become zero. Wire data remains canonical ASCII.
- **Cause/components:** `product-form.tsx` forwards raw strings; [sales-invoice-view.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/sales-invoice-view.tsx#L142) / `sales-price-dialog.tsx` / `sales-calculator.tsx` use ASCII-only regexes. The existing contracts helper `normalizeIndicDigits`, `count-entry.ts`, and `report-filter.ts` already support normalization in other paths.
- **Captures/measurements:** `product-price-digits-arabic-ar.png`, `product-price-digits-persian-en.png`, `sales-discount-digits-arabic-ar.png`, `sales-discount-digits-persian-en.png`; `measurements.json` records rejected localized inputs, accepted ASCII equivalent and accepted Basket input.

### F12 — Assistive UI names bypass translation

**Severity: Medium. Mode: Arabic. Evidence: R DOM + S.**

- **Screens:** Dashboard regions, Product Form/Record error dismiss controls, Supplier allowance controls.
- **Exact accessible labels:** `KPI Metrics`, `Table Filters`, `Dismiss error`, `Decrease discount by 0.5 percent`, `Increase discount by 0.5 percent`. The Supplier +/- buttons visually show only symbols, so the untranslated accessible label is their spoken name.
- **Expected:** Arabic accessible names, e.g. `مؤشرات الأداء`, `مرشحات الجدول`, `إغلاق رسالة الخطأ`, `خفض نسبة السماح بمقدار ٠٫٥ بالمئة`, and the matching increase label; English retains English names.
- **Cause/components:** literal attributes in `home-screen.tsx` lines 792/1374, `product-form.tsx` line 951, `product-record.tsx` line 249, and `suppliers-workspace.tsx` lines 536/556.
- **Evidence:** `captures.json` control attributes for Dashboard, Product errors and `supplier-selected-ar.png`. Actual Windows Narrator speech was not tested.

### F13 — Human-facing CSV headings and status/source captions bypass the display locale

**Severity: Medium. Mode: exports initiated from Arabic UI. Evidence: S.**

- **Surfaces:** Inventory item-summary CSV; Inventory report CSV, including ordinary/protected exports.
- **Exact problem:** Inventory CSV headers are hardcoded `Item`, `Status`, `Balance (inventory units)`, etc., with raw `item.status`. Report CSV table headers use internal column names such as `openingQuantity` and `closingQuantity`; cells are serialized directly rather than applying the Arabic unit/display labels seen in the table. The English metadata captions and canonical source/explanation keys also travel with the export, but intentionally technical contract fields must be distinguished from human headings before cleanup.
- **Expected:** the human spreadsheet's visible headings and known status/unit/generated-source captions follow the requested display language. Preserve exact numeric values, fils/scaled-unit basis, escaping/formula protection, IDs, UTC/zone metadata, complete filtered membership and permission/redaction boundaries. Machine-readable JSON and intentionally technical metadata are not translation bugs and must retain their contract.
- **Cause/components:** [inventory-export-csv.ts](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/main/inventory-export-csv.ts#L3) and [inventory-report-csv.ts](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/main/inventory-report-csv.ts#L9) accept no display locale; the Main save-dialog filter/title already has localized text, but serialization does not.
- **Evidence:** serializer source is deterministic. No actual Windows Save dialog or spreadsheet import was exercised. Do not blindly localize numeric wire strings or existing machine metadata.

### F14 — Generated stocktake references retain English glue text

**Severity: Medium. Mode: Arabic. Evidence: R + S.**

- **Screen:** Inventory item movement table, stocktake variance source link.
- **Exact problem:** a real variance movement displays **`C1/2026 · line 1`** in the Arabic `المستند المرجعي` column. Active unnumbered references have the source-generated form `Count session started <timestamp> · line <n>` and use the same direct-display path. The numbered occurrence was reproduced; the unnumbered variant is source-confirmed.
- **Expected:** keep `C1/2026` verbatim, translate only generated words/counts: e.g. `C1/2026 · السطر ١`; format any generated timestamp in the pharmacy zone. Never translate user-entered evidence or document IDs.
- **Cause/components:** `inventory-count-persistence.ts` generates the caption, and [inventory-screen.tsx](https://github.com/PharmaElectrons/Breev/blob/9460c6065eecb1b4ebd4dade69350cf8dcd30239/apps/desktop/src/renderer/src/inventory-screen.tsx#L1452) renders `movement.reference.label` directly. Reports have a separate `reportSourceLabel` mapping, so this is an operational movement-view gap rather than a duplicate report fix.
- **Capture:** `inventory-generated-count-source-ar.png`.

### F15 — English item-table header remains physically right-aligned

**Severity: Low. Mode: English/LTR. Evidence: R computed style + S.**

- **Screen:** Dashboard performance table.
- **Exact problem:** `ITEM` is right-aligned while the product-name cells beneath it align to the LTR start (left). The same forced-right text-header choice appears in English; Arabic alignment is appropriate.
- **Expected:** align the item-name header and text cells consistently with the active direction. Keep intentional numeric-column alignment separate.
- **Cause/component:** `home-screen.tsx::PerformanceTableSection` uses `<th className="text-right">` for the item header. `measurements.json` confirms `direction: ltr`, header `textAlign: right`, body `textAlign: start`.
- **Capture:** `dashboard-dark-en.png`. Remediation must be Dashboard-scoped, without global styles or shell geometry changes.

### F16 — Arabic Catalog section heading uses hardcoded English punctuation

**Severity: Low. Mode: Arabic. Evidence: R + S.**

- **Screen:** Product record, classification/barcode section.
- **Exact problem:** **`التصنيف & أرقام الباركود`**.
- **Expected:** a localized combined heading such as `التصنيف وأرقام الباركود`, rather than an English conjunction/punctuation fragment between two translated labels.
- **Cause/component:** `product-record.tsx` line 761 concatenates two message keys with literal `&amp;`.
- **Capture:** `product-record-ar.png` / `catalog-network-error-ar.png`.

### F17 — Report page number lacks a localized label

**Severity: Low. Modes: Arabic and English. Evidence: R + S. PR #201 extension.**

- **Screen:** report table pagination summary, every category.
- **Exact problem:** **`الصفوف المطابقة: ٣ · ١`** / **`Matching rows: 3 · 1`**. The trailing number is the current page but has no label; the activity dialog already correctly labels `الصفحة ١` / `Page 1`.
- **Expected:** e.g. `الصفوف المطابقة: ٣ · الصفحة ١` / `Matching rows: 3 · Page 1`, retaining existing page calculations and previous/next behavior.
- **Cause/component:** `inventory-reports-screen.tsx` lines 669–670 interpolates the page after a separator without `copy.page`.
- **Captures:** `report-category-quantity-ar.png`, `report-category-quantity-en.png`, `report-activity-dialog-en.png`.

## Shared root causes and cleanup checklist

These are presentation tasks, not permission to implement new features or change domain behavior.

- [ ] **Shared unit display vocabulary — F01:** use approved recognized unit captions across all existing views, selectors, announcements and print; preserve unknown/custom names and stored identities.
- [ ] **Display numbers/money/percentages — F02–F05:** replace raw output and competing formatters; make Purchase row denominations explicit; retain exact money and avoid unapproved rounding. Include counts, quantities, conversion captions, role-group badges and safety summaries.
- [ ] **Temporal display — F06–F08:** localize date-only values; make UTC event display consistently pharmacy-zone aware; reconcile timestamp conventions and friendly zone labels. Do not change business dates, cutoffs, timestamps or timezone IDs.
- [ ] **Localized failures and message lifetime — F09–F10:** map known failures to action-appropriate localized text; re-render retained validation/errors in the active language without repeating operations.
- [ ] **Localized numeric input boundary — F11:** recognize Arabic/Persian digits and supported separators before existing exact validation; no arithmetic, range, precision or unit-rule changes.
- [ ] **Hardcoded user-facing attributes/fragments — F12/F16:** include accessible names and punctuation in localization coverage, preserving language-choice autonyms and technical identifiers.
- [ ] **Spreadsheet presentation — F13:** localize human headings/known captions while preserving exact values, explicit basis, safe escaping and machine contracts.
- [ ] **Generated source captions — F14:** distinguish generated wording from immutable IDs/user content across operational and report views.
- [ ] **Direction and pagination consistency — F15/F17:** use direction-aware text alignment and label current pages, within the owning feature styles/components.

Acceptance for cleanup must exercise both languages, language switching with visible validation/status, Arabic/Persian/ASCII numeric input, large and fractional values, zero/negative display, mixed-direction names/IDs, dates around midnight with a differing workstation zone, dialogs, error/denial/empty/loading states, and print/CSV labels. Existing calculation, authorization, entitlement, tenant/device, offline, atomic-posting and snapshot tests must remain intact. No new business policy, legal print wording, or pending professional/release decision is authorized by this audit.

## Existing open work and de-duplication

All open issues were fetched before preparing the cleanup issue; relevant overlaps were reviewed by body, not title alone.

| Existing work                                                                                                                                        | Treatment in this audit/cleanup issue                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#189](https://github.com/PharmaElectrons/Breev/issues/189), Purchasing frontend localization/design                                                 | References the old raw reason options and correction-denial dumps. Current reason options were localized in the inspected Adjustment view. Do not create duplicate tasks for that already tracked correction workflow. F09 is specifically Catalog; F04 is specifically bare Purchase row denomination.       |
| [#198](https://github.com/PharmaElectrons/Breev/issues/198) / [#190](https://github.com/PharmaElectrons/Breev/issues/190), M2 Purchasing remediation | Own Adjustment authoritative-total/denial/snapshot and prototype work. Coordinate any shared formatter use without duplicating those tasks or reopening protected Quick Product/keyboard-flow redesign.                                                                                                       |
| [#175](https://github.com/PharmaElectrons/Breev/issues/175), Posted Purchase modal/navigation work                                                   | Already owns nested-flow/navigation/coverage defects. They are outside this localization issue; audit only the strings, dates and values of those surfaces.                                                                                                                                                   |
| [#178](https://github.com/PharmaElectrons/Breev/issues/178), duplicate-barcode validation                                                            | Owns the duplicate-barcode generic-denial/highlighting defect. F11 concerns valid localized numeric representation, not that barcode case.                                                                                                                                                                    |
| [#199](https://github.com/PharmaElectrons/Breev/issues/199), startup/login diagnostic UX                                                             | Owns startup flashing/diagnostic-card clutter. No duplicate finding about those layouts.                                                                                                                                                                                                                      |
| [#64](https://github.com/PharmaElectrons/Breev/issues/64) / [PR #201](https://github.com/PharmaElectrons/Breev/pull/201), Inventory reports          | Report unit, Arabic timezone, generated source and report outcome localization already improved on the audit baseline. Do not re-file those fixed report-only occurrences. Remaining date-only/source timestamp/English-zone/pagination/CSV gaps are identified above, conditional on this extension landing. |
| [#109](https://github.com/PharmaElectrons/Breev/issues/109), bilingual/accessibility certification                                                   | Keep physical Windows/Narrator certification there; this cleanup supplies specific defects and evidence, not a duplicate certification issue.                                                                                                                                                                 |
| [#60](https://github.com/PharmaElectrons/Breev/issues/60) / [PR #185](https://github.com/PharmaElectrons/Breev/pull/185), Patient Profiles           | Not implemented on this audit baseline. Patient unavailable text was reviewed; the separate unmerged Patient UI was not certified.                                                                                                                                                                            |
| [PR #200](https://github.com/PharmaElectrons/Breev/pull/200), compact Catalog/Sales workflows                                                        | Not part of the executed baseline. Re-check findings against its eventual merge rather than assuming the pending branch has the same defects.                                                                                                                                                                 |

## Intentional/verbatim content and positive checks

- User-entered product/trade/scientific names, Arabic search names shown in English, manufacturer, category, pharmacy/supplier/user/custom-role names, evidence, notes and terms remain verbatim. For example, `اسم الصنف Strip` beneath an English-mode Product is a stored search name, not a translation leak.
- `P1/2026`, `QA-1`, `LOT-QA-123`, UUIDs, usernames and barcodes are identifiers, not translated prose. API/schema versions and technical revision fields were not counted as ordinary display-number defects. Unknown/custom unit names are excluded; F01 only concerns recognized units with existing approved display equivalents.
- `Breev`, `QR`, `CSV`, protocol identifiers and intentionally explained technical acronyms are not blanket translation findings. `English` / `العربية` language-choice autonyms are intentional.
- Pairing fingerprints are deliberately identical ASCII comparison artifacts, with LTR isolation; `m:ss` pairing countdown is documented as identical across locales. Neither is counted as an Arabic digit defect.
- Bootstrap/native startup-fatal fallbacks deliberately include both Arabic and English before a locale can reliably be read. Their bilingual support copy is not counted as accidental language leakage.
- Built-in roles, user status, permission names/descriptions, licence capabilities/Free Core status, batch eligibility/status, movement kinds, adjustment reason options and general unavailable-state copy have localized catalogues. Controlled Catalog denial leakage is F09; raw values were not assumed merely because contracts contain enums.
- Report table/group unit mapping, Arabic friendly timezone, generated report source labels, numeric filters, exact IQD/average-cost formatting and main report/activity pagination buttons are substantially localized. Date-only fields and the remaining summary-label gap are recorded separately.
- Stocktake/Basket Arabic/Persian normalization and core money display helpers work; their successes are controls for the inconsistencies above.
- Barcode print source caption correctly displays `باركود مقدم من الصيدلية` / `Pharmacy-provided barcode`. Posted Purchase print headings/totals are translated, but their date, quantity and percentage formatting shares F02/F03/F06/F07.
- Report and inventory native Save-dialog titles/filter names are selected by locale in Main. No defect is inferred for OS-provided dialog chrome.

## Limits and verification record

This is a presentation audit, not release or accessibility certification. Forty families received source review; the coverage table explicitly distinguishes runtime, fixture and source-only checks.

- **Not independently runtime-verified:** physical Windows/Electron native Save/print/error dialogs, printer output, Windows Narrator, every paid licence/grace/device-seat lifecycle, every nested correction/return success stage, all per-role/tenant/device combinations, long multi-page datasets, 200% resizing, every dark-theme state, live LAN pairing, and restart/offline behavior across every module.
- Login/session-recovery rendering was source-reviewed; later ad-hoc login capture attempts did not complete reliably. Do not infer a Login localization defect from this limitation.
- The source-snapshot timezone gap was reproduced successfully in a Los Angeles browser context against Baghdad pharmacy time. An earlier source probe reached a denial state; that probe failure is not counted as a defect.
- Patient Profiles, accounting, patient/messaging/sales report families and cloud/backup/restore operational screens are absent/unavailable or on separate unmerged work on this baseline. Their implemented placeholders/navigation and relevant shared copy were reviewed; nonexistent workflows were not invented or counted as reviewed screens.
- Screenshot captures use synthetic data and the narrow browser desktop fake. No screenshots or temporary QA scripts are committed. Local JSON captures retain exact DOM text/attributes; `measurements.json` records numeric-input and alignment probes.
- The evidence publication branch contains only `evidence/project-localization-audit/README.md` and is based on remote `dev`. It must not be merged as part of this task. Application code, tests, contracts, migrations and authoritative requirements are unchanged.

Pre-publication verification on the audited application baseline:

| Check                      | Result                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`               | Passed                                                                                                                                  |
| `pnpm format:check`        | Passed                                                                                                                                  |
| `pnpm lint`                | Passed, including 473-file boundary check                                                                                               |
| `pnpm typecheck`           | Passed across four workspaces                                                                                                           |
| `pnpm test:unit`           | Passed; Contracts 219, Desktop 697 and Local API 639 tests passed, with two existing Local API skips; release-tooling tests also passed |
| `pnpm test:integration`    | Passed; Local API reported 39 files, 327 passing tests and two skips against disposable PostgreSQL                                      |
| `pnpm test:browser`        | All 138 scenarios passed                                                                                                                |
| Evidence README formatting | Written and checked with Prettier, explicitly bypassing the evidence directory's ignore rule                                            |
| Publication diff           | Only this README; clean whitespace check; parent is the recorded remote `dev`                                                           |

Only the evidence file was formatted, rather than applying repository-wide write formatting, because this task expressly prohibits application changes. Desktop packaging/smoke checks are not required for an evidence-only change; no Main, Preload, renderer or contracts files were modified. Check logs remain in `/tmp/breev-localization-*.log`. Passing tests do not imply the localization gaps above are covered by existing assertions.
