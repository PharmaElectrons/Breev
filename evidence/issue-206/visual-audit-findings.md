# Comprehensive Visual Audit & Findings Report: Breev Milestone 2 Phase 2 (Issue #206)

**Branch:** `issue/206-m2-prototype-ui`  
**Base:** `dev` (`ad1d492`)  
**Audit Date:** 2 October 2026  
**Auditor:** Antigravity Pair Programmer (Autonomous Inspection Mode)  
**Overall Phase Status:** **REJECTED / FAIL — VISUAL FIDELITY DEFECTS CONFIRMED**

---

## Executive Summary

A comprehensive, side-by-side visual audit was conducted on every reference and implementation surface pair for **Breev Milestone 2 Phase 2** (Purchasing UI). Every pair was inspected at native resolution (1366×768, 1280×800, narrow viewports, and 200% text scale) comparing container bounds, headers, tabs, toolbars, columns, row heights, rail width, cards, whitespace, padding, gaps, borders, shadows, typography, colors, icons, buttons, inputs, labels, badges, totals, dialogs, and responsive behavior.

### Critical Audit Findings
1. **The User's Rejection is 100% Validated**: Phase 2 has **NOT** passed. The implementation visibly departs from the checked-in prototype (`design/prototype/src/`) in layout, hierarchy, component composition, and styling across multiple core screens.
2. **Previous Gallery Masking / Omission**: The previous comparison gallery (`comparison.html`) showed only 9 sections, completely omitting 7 of the 14 checked-in reference screenshots (including empty states and all Arabic references). For the remaining rows, it paired implementation captures against other implementation captures rather than against prototype references.
3. **Severe Text Collision Defects**:
   - In both English and Arabic invoice workspaces (`invoice-selected-rail-1366x768.png` and `ar-light/invoice-selected-rail-1366x768.png`), the review titles and stats grid from `PurchaseRowEntry` (`GROSS`, `ALLOWANCE`, `NET`, `INVOICE OFFER`, `CASH TENDER EFFECT`) collide and overlap directly with the footer totals (`GROSS: 160 IQD`, `ALLOWANCE AMOUNT: 4 IQD`, etc.), producing illegible stacked text.
   - In the Adjustment edit view (`adjustment-edit-1366x768.png`), `.adjustment-totals-grand` blows up in font size and overlaps adjacent lines (`Primary cost Delta: Save and review to calculate` overlapping with other totals).
4. **Bespoke Redesigns Violating Prototype Fidelity**:
   - **Purchase Return**: The prototype uses the full invoice workspace with negative quantities, red badge, and persistent rail. The implementation completely discarded this and invented an unstyled bespoke card with a dark-red left border, two massive textareas, and zero visual resemblance to the prototype.
   - **Suppliers Workspace**: The prototype's 3-card layout (profile form, Live Balance card with red 320 IQD, and Transaction Ledger card) was destroyed; the implementation stretched the form 100% full width with giant empty white voids and omitted the persistent item rail.
   - **Saved Drafts Register**: The prototype's compact 13-column `SavedInvoicesGrid` was replaced with a custom 10-column table featuring unprompted date/payment filter dropdowns, an unprompted "Close" button, and no item rail.
   - **Item Rail**: At 1280×800, the rail collapses into a massive horizontal banner that pushes action buttons off the screen. At 1366×768, it displays only 2 balance tiles instead of 3, features an unprompted `[X]` close button, and replaces the compact 5-row section with a 10-row key-value table full of "Not available in M2" placeholders.
   - **200% Text Scaling Defect**: At 200% zoom, the Return dialog header title is completely clipped and invisible.

Per explicit user instruction, **no production code edits have been made**. This report establishes the complete factual ledger of defects, root causes, and required transplant fixes.

---

## Complete Pair-by-Pair Visual Audit Table

Every pair has been evaluated against native prototype truth. Verdicts are strictly classified as:
- `MATCH`: Pixel-true or identical layout, hierarchy, and styling to the prototype.
- `VISUAL DEFECT`: Unauthorized visual discrepancy in layout, geometry, typography, color, spacing, or component structure.
- `EXPLICIT AUTHORIZED DEVIATION`: Deviation explicitly mandated by confirmed product requirements (e.g. 5-field keyboard entry order, exact server-authoritative money, immutable snapshot review, dark theme, or logical LTR/RTL).
- `INCOMPARABLE—RECAPTURE REQUIRED`: Discrepancy caused by mismatched state, viewport, or uncalibrated fixture.

| # | Surface / State | Prototype Observation | Current Implementation Observation | Specific Difference & Approximate Location | Verdict | Required Fix |
|---|---|---|---|---|---|---|
| 1 | **Invoice & Rail (Populated, EN 1366×768)** | Persistent 320px rail on start side. Top metadata bar contains inline Barcode/Item Search. 12-column table with compact row boxes. 3-tile balance cards. Compact 6-part footer with large bold monospace grand total. | Rail on right with unprompted `[X]` close button. Top metadata bar omits search bar entirely. Table has 8 plain HTML columns. Rail has only 2 balance tiles and a 10-row placeholder table. Severe text collision in totals. | Text collision in footer: headers `GROSS`, `ALLOWANCE`, `NET` overlap footer values. Search bar missing from top header. Rail missing 3rd tile (`PACK`). Extra unprompted buttons. | **VISUAL DEFECT** | 1. Fix CSS/DOM overlap in review/totals. 2. Restore header search bar. 3. Restore 3-tile balance grid in rail. 4. Transplant prototype table container, row styling, and button layout. |
| 2 | **Invoice & Rail (Empty, EN 1366×768)** | Rail is persistently visible on left with empty circle icon and text "No item selected. Pick a medicine...". Header has Barcode/Item search. Centered empty state text. | Rail is collapsed/hidden by default, replaced with unprompted `Product Info` button. Header has unprompted `Start adding items ↵` button. Missing search bar. Verbose multi-line prompt. | Missing persistent rail. Missing header search bar. Extraneous header buttons. | **VISUAL DEFECT** | Keep rail open with prototype empty state. Remove unprompted buttons. Add barcode search bar to header. |
| 3 | **Saved Invoices / Drafts Register (EN 1366×768)** | Item rail visible on left. Single search input with count and double-click prompt. 13-column compact table (`STATUS`, `STATEMENT`, `OPERATOR`, `NET COST`, `GROSS COST`, `EXPENSES`, `SUPPLIER`, `PAYMENT`, `DATE`, `# REF`, `# INVOICE`, `TYPE`, `#`). Bottom totals row. | Item rail absent. Unprompted `Close` button on top right. Extra date/payment filter dropdowns. Custom 10-column table with `Open` button in row. Missing bottom totals row. | Missing rail, extraneous `Close` button and filter dropdowns, missing 3 columns, missing bottom totals row. | **VISUAL DEFECT** | Transplant prototype `SavedInvoicesGrid` JSX/CSS from `routes/purchases.tsx`. Remove extra dropdowns and `Close` button. Retain rail. |
| 4 | **Adjustment Workspace (Edit Mode, EN 1366×768)** | Active tab remains `Purchase Invoice`. Rail visible. Top bar has orange `Adjustment draft` badge, blue `Original: purchase invoice #` button, reason input, `Full Return`, and `Edit Invoice`. Full invoice table. | Switched to `Posted invoices` tab. Rail missing. Custom screen with large orange banner, blue button, custom form card, legalistic paragraph, 9-column custom table, severe totals text collision. | No rail, active tab incorrect, severe totals text overlap (`Primary cost Delta: Save and review...` blown up over adjacent text), custom card redesign. | **VISUAL DEFECT** | Maintain `Purchase Invoice` workspace with rail. Fix totals container line-height. Transplant prototype adjustment header and table. |
| 5 | **Delta Summary Modal (EN 1366×768)** | 640px wide compact modal (~250px high). Single 7-column table (`Item`, `Qty Before`, `Qty After`, `Qty Delta`, `Cost Before`, `Cost After`, `Value Delta`). Clean footer with net delta, reason input, Cancel, and Confirm & post. | Tall multi-section modal (>500px high). Stacked 4-row header cost breakdown table, raw text for inventory/supplier changes, second table with truncated medicine names. | Over-complicated layout with multiple stacked tables and raw text blocks; truncated medicine names in second table; different modal title. | **VISUAL DEFECT** | Unify into prototype's single-table 640px modal. Format medicine names with proper ellipsis/wrap. Match prototype title and footer. |
| 6 | **Purchase Return Workspace (Edit Mode, EN 1366×768)** | Full purchase invoice workspace active with rail on left. Pink `Purchase Return` badge, blue linked button, negative table rows, negative grand total (`-320 IQD`). | Entirely custom card with dark-red left border, two huge textareas for reason and evidence, custom table box with `[ 1 ] / 4`, no rail, no invoice table, no totals. | Complete visual departure from prototype. Bespoke card layout abandoning prototype return workspace. | **VISUAL DEFECT** | Discard bespoke card. Transplant prototype return workspace from `routes/purchases.tsx` with persistent rail and negative values. |
| 7 | **Suppliers Workspace & Profile (EN 1366×768)** | 3-card layout: 1. Profile form (2 columns of 4 fields). 2. Live Balance card with big red `320 IQD`. 3. Transaction Ledger table. Persistent rail on left. Search on top of supplier list with debt amount. | Rail missing. Form stretched 100% full width with giant empty voids. Live Balance card missing. Transaction ledger missing. Missing `MAX CREDIT LIMIT` and `DUE ALERT WINDOW`. Missing debt amount in supplier list. | Missing rail, flattened full-width card leaving massive whitespace, missing Live Balance and Ledger cards, missing fields. | **VISUAL DEFECT** | Retain persistent rail. Preserve 3-card layout proportions. Restore missing profile fields. |
| 8 | **Invoice & Rail (Populated, AR 1366×768)** | RTL layout. Rail on start side (left). 3 balance tiles (`3 PACK`, `0 شريط`, `0 STRIP`). Compact 5-row summary. Top header bar with barcode search. 12-column table. Clean totals. | Rail has unwanted `[X]` button, only 2 balance tiles, 10-row placeholder table. Missing search bar in header. Severe text collision in `مراجعة الشراء`. | Severe text collision in totals: `الإجمالي`, `السماح`, `الصافي`, `عرض الفاتورة`, `أثر الدفع النقدي` overlapping with values below. Rail missing 3rd tile. | **VISUAL DEFECT** | Fix CSS text collision. Restore 3 rail tiles. Remove `[X]` button. Add header barcode search bar. |
| 9 | **Invoice & Rail (Empty, AR 1366×768)** | Rail visible on start side with empty circle icon and Arabic text. Header barcode search bar present. Centered empty message. | Rail collapsed by default behind `i شريط معلومات المادة` button. Header has unprompted `بدء إدخال المواد ↵` button. Missing search bar. | Missing persistent rail, unprompted buttons, missing barcode search bar. | **VISUAL DEFECT** | Keep rail open by default. Remove unprompted buttons. Include barcode search in header. |
| 10 | **Saved Invoices / Drafts Register (AR 1366×768)** | Rail visible on left. Search bar with `1 فاتورة` count and double-click prompt. 13 columns in RTL order. Bottom totals row (`312`, `320`, `0`). | Rail missing. Unprompted `إغلاق` button. Extra date/payment filter dropdowns. 10 columns only. Action button in row. Missing bottom totals row. | Missing rail, unprompted `Close` button and extra dropdowns, missing columns, missing totals row. | **VISUAL DEFECT** | Transplant prototype `SavedInvoicesGrid` RTL table. Remove extraneous controls. |
| 11 | **Adjustment Workspace (Edit Mode, AR 1366×768)** | Active tab remains `فاتورة الشراء`. Rail visible. Top bar has orange badge, blue original button, reason input, return button, print, and edit button. 12-column table. | Switched to `فواتير محفوظة`. Rail missing. Severe text collision in totals: `كلفة المورد الأساسية` overlapping `فرق كلفة الأساسية` in giant bold font. Custom card layout. | Severe text collision, missing rail, incorrect active tab, custom card layout. | **VISUAL DEFECT** | Fix totals text collision; keep rail open; transplant prototype adjustment view. |
| 12 | **Delta Summary Modal (AR 1366×768)** | 640px compact modal. Title `ملخص الفروقات` with icon on right. Single 7-column table. Clean footer with `صافي الفرق المرحّل: 0 IQD`. | Tall modal with 3 stacked sections (header cost table, raw text for inventory/supplier changes, second table with truncated medicine names). | Multiple stacked tables and raw text blocks; truncated medicine names; altered proportions. | **VISUAL DEFECT** | Transplant prototype single-table 640px modal layout. |
| 13 | **Purchase Return Workspace (AR 1366×768)** | Full invoice workspace with rail, negative table rows, red badge `مردود مشتريات`, blue link `مرتبطة بفاتورة شراء رقم ...`. | Bespoke card with dark-red left border, huge textareas, custom single-row table, no rail, no invoice table. | Complete departure from prototype return workspace. | **VISUAL DEFECT** | Discard bespoke card, transplant prototype return workspace. |
| 14 | **Suppliers Workspace (AR 1366×768)** | 3-card layout (profile form, live balance card with big red `IQD 320`, transaction ledger card), rail on left. | Stretched single card with vast whitespace, missing live balance card, missing ledger card, missing rail. | Missing rail, flattened single card, missing 2 cards, missing fields. | **VISUAL DEFECT** | Restore 3-card layout proportions and rail. |
| 15 | **Posted Invoices Register List (`posted-list-1366x768.png`)** | Prototype does not have a separate tab; `SavedInvoicesGrid` serves all saved/posted records. | Custom list view under `Posted invoices` tab with accordion filters and an unprompted `Close` button on bottom right. | Extraneous `Close` button, styling and column differences compared to `SavedInvoicesGrid`. | **VISUAL DEFECT** | Align styling and typography with prototype `SavedInvoicesGrid`, remove unprompted `Close` button. |
| 16 | **Posted Purchase Detail Snapshot (`posted-detail-1366x768.png`)** | Prototype loads saved invoice directly into the invoice workspace with `Edit Invoice` and `Full Return` buttons. | Dedicated "Historical snapshot" view with a 6-card metric grid, full-width supplier button, and items table. | Immutable snapshot review is an authorized Phase 1 architectural requirement, but the card borders, button hierarchy, and fonts depart from prototype tokens. | **EXPLICIT AUTHORIZED DEVIATION** (Architecture) / **VISUAL DEFECT** (Styling) | Preserve immutable snapshot review, but restyle metric cards, buttons, and tables to match prototype tokens. |
| 17 | **Adjustment Warning Modal (`adjustment-nested-warning-1366x768.png`)** | Prototype has no dark theme and does not capture stacked dialog states. | Centered modal above backdrop blur with Tab/Shift+Tab trap and safe Cancel/Continue focus. | None (Breev dark theme adaptation with standard APG modal pattern). | **EXPLICIT AUTHORIZED DEVIATION** | None; behavior and styling comply with requirements. |
| 18 | **Step-Up Authorization Modal (`return-summary-step-up-1366x768.png`)** | Prototype has no password challenge or Step-Up modal. | 640px modal with carrying amount, supplier reduction, and password input. | None (Security/Step-Up requirement adaptation). | **EXPLICIT AUTHORIZED DEVIATION** | Ensure modal title remains visible at all text scales. |
| 19 | **Return Summary @ 200% Text Scale (`return-summary-text-200.png`)** | Prototype has no 200% zoom reference. | Dialog header title `مراجعة مردود الشراء الفعلي` is completely clipped and invisible! Only the red error text shows. | Dialog header title is pushed out of bounds or hidden at 200% zoom. | **VISUAL DEFECT** | Add `overflow: auto` and flexible header container so titles are never clipped. |
| 20 | **Invoice Workspace @ 1280×800 (`invoice-selected-rail-1280x800.png`)** | Prototype 1366×768 has persistent 320px sidebar rail. | At 1280×800, rail collapses into a massive horizontal band (>300px high) above table, pushing table down and clipping footer actions offscreen. | Rail consumes excessive vertical space, causing bottom review totals to overlap and clip offscreen. | **VISUAL DEFECT** | Maintain sidebar rail at 1280×800 or provide a compact collapsible drawer instead of an oversized horizontal band. |

---

## Root Causes of Visual Deviations

1. **Failure to Transplant Visual JSX & CSS**: Rather than inspecting `design/prototype/src/routes/purchases.tsx` and extracting the exact HTML tags, Tailwind classes, and layout scaffolding, the prior implementation wrote custom React components (`posted-purchase-review.tsx`, `purchase-adjustment-workflow.tsx`, `purchase-return-workflow.tsx`) with bespoke JSX and CSS.
2. **Double Totals Rendering**: `purchase-row-entry.tsx` rendered `<section className="purchase-review">`, while `purchasing-screen.tsx` rendered `<footer className="purchase-footer">`. Both components output competing totals summaries in the same visual area without layout isolation, causing severe visual collisions.
3. **Misinterpreting Architectural Invariants as License to Redesign**: The requirements that adjustments post only deltas and returns track physical disposition evidence were treated as permission to invent new screens, rather than housing those facts within the prototype's visual container hierarchy.
4. **Vague Audit Notes in Previous Gallery**: The previous `comparison-notes.md` dismissed visible discrepancies with generic rationalizations ("compact review", "640px summary") instead of measuring differences against the prototype.

---

## Time Budget & Remediation Plan

Per `phase-2-time-budget.md`, the budget allocation is 270 minutes (4.5 hours).

| Remediation Workstream | Estimated Time | Feasibility in Remaining Budget |
|---|---:|:---:|
| **1. Fix Review/Totals Text Collision** (DOM cleanup in `purchasing-screen.tsx` and `purchase-row-entry.tsx`) | 30 min | Highly Feasible |
| **2. Fix Adjustment Totals Font Blowup** (line-height and container styling in `purchase-adjustment-workflow.tsx`) | 20 min | Highly Feasible |
| **3. Transplant Return Workspace** (replace custom card with prototype return invoice workspace in `purchase-return-workflow.tsx`) | 60 min | Feasible |
| **4. Align Suppliers Workspace** (restore 3-card layout proportions, persistent rail, and missing fields in `suppliers-workspace.tsx`) | 45 min | Feasible |
| **5. Align Saved Drafts Register** (transplant `SavedInvoicesGrid` 13 columns and remove extraneous dropdowns) | 35 min | Feasible |
| **6. Rail Layout & Responsive Fixes** (restore 3 tiles, remove `[X]`, fix 1280×800 horizontal band and 200% text scaling) | 40 min | Feasible |
| **7. Recapture & Verification** (rerun matrix screenshots and check suites) | 40 min | Feasible |
| **Total Estimated Remediation Time** | **270 min** | **Fits Budget Boundary** |

---

## 10–15 Minute Manual Walkthrough Script (Post-Remediation Target)

When visual remediation is executed, the human reviewer should execute this 10–15 minute verification script:

1. **Populated Invoice Workspace (3 minutes)**:
   - Navigate to `#/purchases`. Verify the 320px persistent rail is on the start side with **3 balance tiles** (`STRIP`, `STRIP`, `PACK`).
   - Check that the header metadata bar includes the `Barcode / Item Search` input.
   - Inspect the bottom review/totals area: verify that labels and figures (`Gross`, `Allowance`, `Net`, `Grand Total`) are cleanly aligned with **zero text collisions or overlapping lines**.
2. **Saved Drafts Register (2 minutes)**:
   - Click `Saved Invoices / Saved Drafts`.
   - Verify the 13-column layout matches `SavedInvoicesGrid`. Verify there is no unprompted `Close` button or extra date/payment filter dropdowns.
   - Double-click a draft and verify it loads directly into the main invoice workspace.
3. **Adjustment Edit & Delta Summary (3 minutes)**:
   - In Posted Purchases, select an invoice and click `Edit Invoice` (`تعديل الفاتورة`).
   - Verify the in-place adjustment mode activates with the orange adjustment badge and blue link badge in the top bar.
   - Verify totals bar text is cleanly formatted without overlapping text.
   - Click `Save and review Delta` (`حفظ ومراجعة الفرق`). Verify the Delta Summary modal is 640px wide with a single 7-column comparison table.
4. **Purchase Return Workflow (3 minutes)**:
   - In Posted Purchases, click `Purchase Return` (`إرجاع الفاتورة`).
   - Verify it opens the invoice workspace with negative quantities, red `Purchase Return` badge, and blue linked original badge.
   - Verify it does NOT render the unstyled dark-red card.
5. **Suppliers Workspace (2 minutes)**:
   - Click `Suppliers` (`المذاخر`).
   - Verify the 3-card layout proportions are preserved, the persistent rail is visible, and the form is not stretched across the entire screen.
6. **Accessibility & Viewports (2 minutes)**:
   - Test at 1280×800: verify the rail does not push bottom action buttons offscreen.
   - Test at 200% zoom: verify modal header titles remain fully visible without clipping.

---

## Conclusion & Recommendation

Phase 2 **cannot be certified as PASS** in its current visual state. The implementation exhibits severe visual defects, broken text layouts, and unauthorized departures from the prototype truth.

Per the user's explicit directive:
> *"you do not edit anything yourself, you give me report of findings comprehonve report /goal /unlazy md reports and add screenshots of evidence if possible/needed"*

No production code edits have been made. This comprehensive findings report provides the exact visual evidence, defect inventory, root cause analysis, and required remediation path. Awaiting user direction on next steps.
