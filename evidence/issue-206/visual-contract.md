# Phase 2 visual contract and inventory

Issue: [#206](https://github.com/PharmaElectrons/Breev/issues/206), part of #190.
Base: `dev` at `ad1d4928416eb9acaab4cb9bb1cdcede409f4082`.
Branch: `issue/206-m2-prototype-ui`. T01–T05 are one authorized batch; final
human acceptance is pending. No commit, push, PR or merge is authorized yet.

## Authority and provenance

The complete 1 October time-budget override supersedes individual checkpoint
stops and repeated whole-repository suites. Product/domain/architecture,
quality, source authority and prototype rules remain binding.

Reference sources are `design/prototype/src/routes/purchases.tsx`,
`components/suppliers-workspace.tsx`, `components/app-shell.tsx` and
`styles.css`. The Phase 0 reference collection is
`evidence/issue-191/phase-0-baseline`. Phase 1 accepted work is PR #205,
merge `67403d2`; its final-candidate Linux Verify passed. Historical local
limits and Sales #204 remain open. Phase 1 approval does not prove new edits.

The fresh source-rendering harness `.scratch/runtime/p2-prototype.cjs` renders
the actual prototype JSX with deterministic local state. React effects are not
executed; Supabase is never called. It extracts the original Tailwind candidates,
uses checked-in CSS and local font assets, and emits `reference/metrics.json`.
Reference screenshots are light only because the prototype has no dark tokens.
No dark or authoritative-state reference is invented. The source hard-codes RTL;
Breev LTR is an approved locale adaptation.

Current captures use the production renderer build, narrow desktop bridge fake
and real API/PostgreSQL contracts. The isolated browser harness redirects every
historical evidence path to this issue and guards its fresh loopback database
port 5557. Stable invoice date: 2026-09-08; expiry: 2029-05-31; supplier:
Al-Nahrain Medical; fixture product: Keyboard Purchase 500 mg tablet GSK,
barcode 5012345678949, Strip with Pack=4. Random transaction IDs are authoritative
fixture keys; displayed state/text/dates are deterministic. Dynamic capture
times are not a fidelity difference.

## Complete surface/state inventory

| Surface | Prototype source / geometry | Production owner / states |
| --- | --- | --- |
| Shell and tabs | PurchasesPage + AppShell; header 64px, compact bordered tab strip | purchasing-screen.tsx; invoice/drafts/posted/suppliers, permission-only entry |
| Invoice metadata | PurchasesPage; compact date, invoice, supplier, debt/search labels | purchasing-screen.tsx; empty, selected Supplier, duplicate, validation, loading, unavailable |
| Entry and committed rows | PurchasesPage; dense table, thin dividers, small uppercase labels | purchase-row-entry.tsx; empty, selected, committed, editing, invalid, optional controls, receipt denial, configurable columns |
| Item rail | ProductInfoPanel; 320px rail, logical end, three balance tiles and bordered fact groups | purchasing-item-details.tsx; empty/loading/slow/populated/error/unavailable/redacted, expiry indicators |
| Totals and authoritative review | PurchasesPage; six footer cells and two action rows | purchasing-screen.tsx + PurchaseReview; exact gross, allowance, independent offer, net, settlement, batches, warnings, pending/post refusal/success |
| Saved Drafts | SavedInvoicesGrid; compact search and table | purchasing-screen.tsx; filters, invalid date, empty/populated/selected, retained row facts, switch/resume/restart/discard |
| Posted list/detail | SavedInvoicesGrid + original invoice visual hierarchy | posted-purchase-review.tsx; all filters/order, snapshot, navigation, linked corrections, expandable facts, current Supplier/item drill-down, redacted/denied/offline |
| Adjustment | PurchasesPage edit mode; original badge, metadata/table/footer, 640px Delta modal | purchase-adjustment-workflow.tsx; start/unfinished/edit/dirty/summary/changed/stale/conflict/denied/unavailable/retry/success; protected fields and exact before/after authority |
| Return | PurchasesPage return mode; physical return distinction | purchase-return-workflow.tsx; start/unsaved/unfinished/edit/dirty/validation/summary/Step-Up denial/posting/success and immutable linked Return |
| Supplier M2 | SuppliersWorkspace; list, profile fields and allowance/terms controls | suppliers-workspace.tsx; selected/new/edit/validation/save/archive-native-confirm/archived/merge/version conflict, basic terms; M3 ledger/debt deliberately absent |
| Generic confirmations | Prototype warning/action hierarchy, compact bordered modal | native invoice discard, PurchasingModal Adjustment/Return warnings and summaries; focused inline refusals and status announcements |

Quick Product/Product record nested dialogs and Purchase field handlers are
protected regression surfaces. Their JSX/keyboard code is not edited. Existing
optional row controls remain a details popover; their key/focus behavior is
unchanged. Posted list/detail and drill-down remain inline, not modalized.

## Dimensions and visual details

Reference metrics: header 64px; rail 320px; main invoice table 1046px at
1366×768 with 12 prototype columns, 14px body; saved table 13 columns with
12px body; Delta modal outer width 640px, table 638px. Prototype compact
controls use 8px radii, 1px slate dividers, approximately 12px body/10px uppercase
labels, 12–16px gutters, logical padding, local IBM Plex Sans Arabic and
JetBrains Mono for numbers. Reference captures retain the actual JSX geometry,
including its inconsistent English RTL. No screenshots are hand-recreated.

Breev uses the existing approved slate/teal palette and semantic
card/surface/foreground/muted/control-border/focus/state tokens. Feature CSS is
confined to `.purchasing-workspace` or uniquely named Purchasing components.
No shared shell/global stylesheet is edited. Modal background is 55% black with
4px blur, radius 12px, width min(640px, viewport−32px), 16px outer clearance;
content scrolls while critical actions remain reachable. Narrow viewports retain
the accepted item rail band/collapse treatment. Headers wrap, rows scroll within
their own workspace, and 200% text may increase page height.

## Difference and allowed-deviation register

| Difference | Classification and decision |
| --- | --- |
| Breef prototype branding, placeholders and obsolete nav labels | Required Breev deviation: current name and current scope only |
| English prototype remains RTL; prototype ships light only | Required locale/theme deviation: logical direction and existing dark tokens |
| Prototype faint control boundaries and tiny targets | Required WCAG deviation: stronger boundaries/focus, reachable control targets |
| Prototype 12-column entry order vs accepted five-field loop | Required protected behavior: preserve item→quantity→primary cost→selling price→expiry; no shortcut/focus redesign |
| Client-calculated debt, taxes/expenses/special-price guesses | Required authority/scope deviation: show only merged authoritative M2 facts; no invented zero, fake debt or deferred accounting |
| Full prototype Supplier balance/ledger/statement | Out of M2 scope: no #63/#75, settlement/aging/reporting |
| Prototype mutation of original invoice | Required immutable deviation: Adjustment copy/Delta and separate physical Return, explicit post and evidence/Step-Up |
| Compact Delta contains more tables than prototype | Required authority deviation: saved before/after/header/stock/Supplier facts, scrollable inside 640px summary |
| Return has no authoritative summary/Step-Up counterpart | Required Breev deviation: compact 640px modal using same tokens, exact carrying/Supplier amounts, password and explicit post |
| Oversized review/stat tiles and Return visual islands | Required transplant: compact prototype density, semantic tokens, no duplicate speculative facts |
| Serif control/table text, blue legacy links and badge islands | Required transplant: existing local fonts and semantic Purchasing palette |
| Return inline pseudo-dialog, background active, Escape fall-through | Required accessibility fix: actual top-layer modal, safe initial focus, trap, restore, no click-away discard, composition-aware Escape |
| Closed Supplier combobox points to removed option | Required accessibility fix: omit active-descendant when list is closed |
| Earlier packaged preview cell 79.8% visible | Open historical packaged finding: final browser candidate proves strict 100% visibility at 1024/1066/1280/1366; this does not close packaged Electron proof, no quantity conversion change |
| Fixture quantities/linked document counts differ across screenshots | Data-dependent: compare hierarchy/spacing/columns, preserve authoritative values; no masking material layout |
| Sales scrollable-region-focusable #204 | Out-of-scope retained finding; sentinel checks record findings without suppression or Sales edits |

The established Business Central pattern separates a posted original from its
correcting document. That fits immutable Breev review, but its cancellation and
accounting policies do not decide G-01/G-02/G-16. See
[Microsoft precedent](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-correct-cancel-unpaid-purchase-invoices).
Modal keyboard behavior follows the
[WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
Native HTML dialog supplies whole-page inertness and nesting; Purchasing adds
explicit safe focus, bounded tab cycles and composition handling locally.

## Acceptance limits

T01 inventory is frozen. T02–T05 verification/comparison is recorded in the final
index, tied to the tested source. Physical Windows Narrator and professional
gates remain unperformed/open. Automated Axe/focus/markup checks are not a
physical screen-reader test. One final stakeholder Phase 2 PASS/FAIL is required.
