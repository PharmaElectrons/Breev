# Purchasing prototype alignment

The stakeholder requested the client appearance on 6 September 2026, then clarified that a compact saved-draft screen was still insufficient. The visual references are the running [local purchase page](../../design/prototype/src/routes/purchases.tsx) and [shared Lovable preview](https://lovable.dev/preview/r8S5RJqjSSfjeBoD0WXOB98BoDBH3Udw). Both were opened in Chromium and captured at 1366×768. The live preview additionally has saved-invoice and return tabs and document actions above the invoice header.

## Result and scope

The purchase workspace uses the reference's 320-pixel full-height item sidebar, 64-pixel shell header, compact metadata row, 12-column item table, six-column totals area, and bottom document/payment actions. The sidebar mirrors with locale direction and moves below the workspace at narrow widths. Saved drafts open in a native modal dialog with keyboard focus and Escape behavior.

The Suppliers view reproduces the prototype's 3-card composition: Supplier Profile with all client attributes (name, phone, address, default payment terms, default allowance % with steppers, max credit limit, due period, alert window), Live Debt Balance with credit limit utilization bar and currency formatting, and Invoice Transaction Ledger data table with empty-state handling. A top action toolbar provides Add, Archive (soft-delete protection), Account Statement modal, and Save actions, alongside a search sidebar. Switching to Suppliers cleanly hides the invoice item sidebar to provide full canvas width.

IBM Plex Sans Arabic and JetBrains Mono are bundled through Fontsource 5.3.0, including the required Arabic and Latin weights. Their OFL notices ship in `out/renderer/font-licenses/`. The renderer loads no remote fonts. The existing Ready card is accessible through a header disclosure on Purchases. Non-ready startup, recovery, and other module flows keep their existing status presentation.

This is a visual change to the current header slice, not the completion of purchase posting. Header create/update, durable recovery, saved-draft search, previous/next navigation, confirmed discard, and supplier management use the existing local API. Item entry, invoice calculations, returns, adjustments, and printing are visibly unavailable. Unknown financial values show a dash instead of a fabricated balance. OCR remains hidden without the paid entitlement and unavailable until its provider/review slice ships. Hard deletion and negative-stock operations from the prototype are not copied. The empty item panel does not claim populated inventory or pricing data.

Breev's stronger border, contrast, and dark-theme adaptations follow [quality](../../docs/quality.md). These required differences, the current Breev name, entitlement filtering, and unimplemented operations prevent a claim of literal pixel or functional parity with every demo control.

## Precedent and dependencies

[Odoo purchasing](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/manage_deals/rfq.html) separates vendor metadata from document rows. That composition fits Breev's repeated-entry workflow; its quotation/receipt lifecycle does not define Breev's posting behavior. The client UI controls visual composition. [Fontsource's installation instructions](https://fontsource.org/fonts/ibm-plex-sans-arabic/install) provide self-hosted CSS and font files, which fit offline Free Core. Existing React state and native forms, buttons, details, and dialog elements implement the presentation. No business dependency or service was added.

## Verification

The checks use Node 24.19.0 on Windows, the real local API, disposable PostgreSQL 18.6, and the typed desktop fake. All screenshot data is synthetic.

- Full workspace build passed. The final desktop build and desktop typecheck passed after font and layout changes. Both font notices were verified in the built renderer.
- Purchasing API unit tests passed, 2 tests.
- Purchasing PostgreSQL integration tests passed, 8 tests, covering audited supplier history, permission denial, duplicate warnings, stale versions, restart, preserved snapshots/references, and protected discard.
- Focused ESLint, formatting, and the repository boundary check passed.
- Purchasing browser suite passed, 7 tests. It covers header entry, restart, duplicate warnings, confirmed discard, modal search and focus, view-state preservation, uncertain-save retry, archived-supplier rejection, connection disclosure, Free Core OCR hiding, and disabled unimplemented entry/printing.
- The browser suite verified that both bundled font families actually load, Axe passes for invoice/register/supplier views in all four locale/theme combinations, Save remains visible at 1366×768, 900/560-pixel windows contain horizontal scrolling, and Save remains reachable at 200% text.
- Shell and Catalog browser regressions passed, 39 tests, including recovery, permissions/entitlements, Arabic/English, both themes, keyboard flows, and text resizing.

Two earlier browser runs missed the API fixture's startup deadline before UI assertions. Subsequent runs passed without changing that deadline. The fixture now collects bounded, redacted startup diagnostics and drains its process output. Search Escape first clears the native search input; the next Escape closes the dialog and never discards an invoice.

Screenshots in `after/` cover the invoice, selected-draft summary, saved-draft dialog, and Suppliers in Arabic/English and light/dark themes. `reference/` contains the client screenshots. Windows Narrator and physical-device certification were not run; screenshots and Axe results do not replace those release checks.

Compare [the live client preview](reference/lovable-preview-ar.png) with [the updated Arabic purchase screen](after/purchase-header-ar-light.png).
