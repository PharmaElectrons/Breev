# Issue #202 presentation remediation candidate

Initial implementation baseline: `8feb88ad4d019b908987c04ec1739facfbb090e6`
(`origin/dev`, checked before implementation on 2 October 2026). During
verification, upstream advanced to `1fec386b80609be8f3a0d8c2cf39dcfcebb779f0`
with migration revision repairs. The isolated `issue/202-localization` branch
in the sibling `Breev-202` worktree was fast-forwarded to that commit before
the final gates, without importing any report work. Final checks on 3 October
apply to this updated base plus the candidate application/test diff.

The staged Desktop patch SHA-256 is
`7f9f6a6bd6fa2e787d29178edf5e69e21558aa33fa18779c0a4fe5226629f11d`
(`git diff --cached --binary -- apps/desktop | sha256sum`). Documentation and
generated evidence are excluded from this fingerprint. The original #201
checkout and immutable audit evidence were preserved.

## Authority and dependencies

[Issue #202](https://github.com/PharmaElectrons/Breev/issues/202) and its supplied
phased plan authorize presentation and entry normalization only. The historical
[audit](https://github.com/PharmaElectrons/Breev/blob/6cad479df140cd102359f90dba556d962e7e6f7b/evidence/project-localization-audit/README.md)
is evidence, not the implementation baseline. ADRs 0001/0002, product/domain,
workflow, architecture and quality rules retain authority.

#201 is still open at `0b0a4f1d472d0d5b99779d534f90e3f5213196af`. Its approved
unit vocabulary was inspected without importing its reports, migrations or
permissions. Reports remain conditional on its merge and final diff review.
Patient Profiles are absent following #203; none were restored. Purchasing
fidelity/dialog clipping belongs to #206; Sales scroll focus belongs to #204.
#178 retains duplicate-barcode behavior. G-01/G-02 and #109 certification remain
open.

The implementation follows Business Central's separation of
[display language and stored application data](https://learn.microsoft.com/en-us/dynamics365/business-central/about-locale-language),
using existing offline `Intl` support. Breev's immediate language switch requires
retaining semantic error state rather than translated messages. Amounts and
identifiers use `bdi` or generated identifier isolation, consistent with
[W3C bidi guidance](https://www.w3.org/International/questions/qa-bidi-unicode-controls).
No runtime dependency, regional preference or account synchronization was added.

## Current occurrence ledger

Paths below are relative to `apps/desktop/src/renderer/src/` unless qualified.
Each integrated occurrence shares its owning unit/browser seam. A finding with
conditional occurrences is not fully resolved by this candidate.

| Finding | Current occurrences and implementation                                                                                                                                                                                                                                                                                   | Verification / remaining owner                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01     | `shared/unit-display.ts` supplies complete-name aliases and Pack/Strip count forms; `panel-unit-label.ts` delegates. Catalog record, Sales selectors/rows/calculator/Quick Links, Purchase entry/details/row correction, Basket and structured count entries use these labels. Editable/custom unit names stay verbatim. | Unit alias/count/custom fixtures; Catalog, Purchasing, Sales, Basket and count browser seams. Report callers conditional on #201.                                                                                                                                                                                                     |
| F02     | `preferences.ts` formats integer strings with BigInt and canonical decimals without Number. Dashboard, Catalog stock/frequency/ratios, Purchase quantities/navigation, Sales quantities/line counts, role and Safety summaries use locale digits/grouping.                                                               | Exact huge/negative/13-place fixtures, owning rendered/browser tests. Report quantities conditional.                                                                                                                                                                                                                                  |
| F03     | `formatPercentage` accepts percentage points; Dashboard preserves one decimal, Purchase/Sales preserve source precision.                                                                                                                                                                                                 | Zero/fractional/negative helper fixtures and Purchase/Sales browser assertions. Report-only callers conditional.                                                                                                                                                                                                                      |
| F04     | `purchase-row-entry.tsx::committedValue` formats integer fils. Headings and input names explicitly say fils.                                                                                                                                                                                                             | Bilingual Purchase test saves Arabic/Persian input as `800000`/`1234567`, then displays grouped fils. No IQD entry conversion.                                                                                                                                                                                                        |
| F05     | Removed Dashboard `formatIQDValue` and Catalog `formatFilsToIqd`; callers use exact `formatCurrencyFromFils`, including Purchase snapshots and signed corrections.                                                                                                                                                       | `IQD 4,570,367.034`, huge/signed/null fixtures and owning rendered tests. Report average-cost precision remains conditional.                                                                                                                                                                                                          |
| F06     | UTC-anchored Gregorian `formatDateOnly`: Dashboard expiry, Catalog matching/batches, Purchase draft/review/correction/item details/print preview, Inventory expiry and Safety business/history dates, Sales batch dates. ISO input values unchanged.                                                                     | Leap/invalid fixtures and Baghdad/Los Angeles/Tokyo workstation comparisons; Purchase payload date remains `2028-02-29`. Report cells conditional.                                                                                                                                                                                    |
| F07     | Localized minute/h23 workstation shell clock with explicit accessible description. Authorized Inventory status read supplies an explicit zone to movement/history/count timestamps; invalid/missing zone renders localized unavailable text.                                                                             | Midnight/DST/invalid-zone helper fixtures and existing Inventory/count permission seams. **Blocked:** general authenticated context exposes no pharmacy zone. Sales/Purchasing/licence/device instants retain their existing display pending separately authorized context exposure. No Baghdad hardcode or workstation substitution. |
| F08     | English report timezone caption is absent on current dev.                                                                                                                                                                                                                                                                | Conditional on #201; inspect its explicit report timezone caption after merge.                                                                                                                                                                                                                                                        |
| F09     | `catalog-error.ts` stores typed denial/action state. Catalog search/load and Product save/print/barcode/archive/merge render the active catalogue; Product action errors have an action-error heading. Raw exception text stays hidden.                                                                                  | Baseline runtime reproduces raw `Failed to fetch`; candidate language-switch transport and delayed-save scenarios. Denial/action unit fixtures.                                                                                                                                                                                       |
| F10     | ProductForm field state stores codes/paths; general state stores semantic failures. Basket validation/feedback, count notices and Safety announcements also render current messages from retained parameters.                                                                                                            | Delayed save switches language before response, keeps Indic draft and field association, switches back with exactly one mutation. Owning form/state tests.                                                                                                                                                                            |
| F11     | `numeric-input.ts` reuses `normalizeIndicDigits`; decimal entry recognizes `٫`. Product payloads/previews/steppers, Purchase row payloads, Sales prices/calculator/quantity/discount normalize at entry boundaries. Invalid nonempty step text stays invalid.                                                            | ASCII/Arabic/Persian equality, huge values and malformed/grouping/exponent/precision/range fixtures; Purchase/Catalog canonical request assertions. Duplicate barcode semantics remain #178.                                                                                                                                          |
| F12     | Dashboard KPI/filter names, Product action dismiss/error names and Supplier allowance +/- names follow locale. Removed ProductForm dismiss remains absent.                                                                                                                                                               | Bilingual role/name and renderer/browser checks. Supplier layout remains #206, Narrator certification #109.                                                                                                                                                                                                                           |
| F13     | Main `serializeInventoryCsv(bundle, locale)` requires captured request locale; Preload passes validated locale. Shared bilingual headings/statuses include UTC and fils basis.                                                                                                                                           | Exact ASCII values, redaction, BOM/CRLF/quoting/formula protection fixtures; JSON path unchanged. Report CSV mapping already belongs to #201, residual basis/source checks conditional.                                                                                                                                               |
| F14     | `shared/generated-reference-display.ts` recognizes only exact count-session server grammars. Inventory and Product movements localize glue/line number/start timestamp using explicit Inventory zone, preserving identifiers/source targets.                                                                             | Numbered/started/fallback/unknown fixtures, movement/count browser seams. Report use conditional.                                                                                                                                                                                                                                     |
| F15     | Dashboard ITEM header uses local logical start alignment.                                                                                                                                                                                                                                                                | Source inspection and bilingual Dashboard renderer checks. Global styles and shell geometry unchanged.                                                                                                                                                                                                                                |
| F16     | Product classification/barcode heading uses catalogue conjunction text.                                                                                                                                                                                                                                                  | Catalog rendered/bilingual coverage.                                                                                                                                                                                                                                                                                                  |
| F17     | Report summary is absent on current dev.                                                                                                                                                                                                                                                                                 | Conditional on #201; add localized Page label after merge.                                                                                                                                                                                                                                                                            |

## Runtime controls and adjacent verification

Untouched baseline `/tmp/breev-202-baseline` was built at the baseline SHA using
the same dependency lockfile. Disposable PostgreSQL 18.6 containers were used;
no live pharmacy database or guessed credentials were used.

- Baseline Catalog `Search failure retains scanner value|Validation failure keeps`:
  2 passed. Candidate transport localization scenario applied as a test-only
  probe to baseline: expected localized unavailable text, received raw
  `Failed to fetch` (confirmed F09 failure).
- Candidate Catalog `-g 'localization:'`: 3 passed. Retained custom text,
  delayed denial, active-locale field errors, dirty Indic input, canonical
  `1234567` fils and exactly one save request are asserted.
- Candidate Purchasing `-g 'localization: Purchase'`: 1 passed, both locales.
  Arabic quantity/cost and Persian retail input produce identical canonical
  payloads, original Pack identity and ISO leap date; visible cells retain fils.
- Targeted renderer TypeScript checks passed after changes. Adjacent helper and
  renderer tests were run; final exit gate results are recorded below.

The first Purchase probe used two competing preference init scripts on one page;
separate pages corrected the test setup. An Arabic medium-date expectation was
corrected to the runtime's numeric `ar-IQ` convention. The Catalog explicit Enter
probe also exercised the existing debounce; using one search trigger isolates
language-switch behavior. These were test setup failures, not suppressions of
product boundary checks.

New bilingual captures are in [captures](captures/). They include Dashboard
fractional money and logical alignment in both themes, Purchase rows explicitly
denominated in fils, and retained Catalog errors after language switching.
Controlled [CSV samples](samples/) retain huge and signed source values,
formula protection, Unicode and custom text; `inventory-source.json` records
the synthetic source bundle.
The sample directory's Git attribute preserves the serializer's BOM and CRLF
bytes when checking out the CSV evidence.

## Exit gate

Database-backed suites run sequentially. Linux, Node 24.19, pnpm 11.23,
Chromium and disposable PostgreSQL 18.6 were used. No supported physical Windows
profile was available for this run.

| Command                                        | Result                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:write` then `pnpm format:check`   | Passed; final modified files formatted individually after bounded follow-ups.                                                                                                                                      |
| `pnpm lint`                                    | Passed.                                                                                                                                                                                                            |
| `pnpm typecheck`                               | Passed. Main/Preload's shared pure modules are included in the existing Node TypeScript project.                                                                                                                   |
| `pnpm build`                                   | Passed.                                                                                                                                                                                                            |
| `pnpm check:licence-artifact`                  | Passed.                                                                                                                                                                                                            |
| `pnpm test:unit`                               | Passed on the updated base: Desktop 735, contracts 221, local API 696 (2 existing platform skips); repository boundary/development/release tooling checks passed.                                                  |
| `pnpm test:integration`                        | Passed on the updated base: 39 files, 340 tests, 2 existing skips. The initial baseline failures and upstream repair are recorded below.                                                                           |
| `pnpm test:browser`                            | Updated-base run: 142 passed, 1 failed, 30 did not run, 1 skipped. Bounded Purchasing follow-ups below resolved the failure and completed coverage: 170 unique required scenarios passed, 4 existing opt-in skips. |
| `pnpm package:desktop` and packaged Playwright | Passed. Packaged checks: 3 passed; security/health, offline posting/API restart, and Main/Preload ASAR runtime-import integrity.                                                                                   |

The initial seven baseline integration failures were `batch-safety-migration`,
`inventory-count-migration`, `inventory-reorder-migration`,
`inventory-review-migration`, `purchasing-role-default-migration`,
`sale-draft-migration` and `purchase-invoice-offer-migration`. Baseline verification
ran those exact `*.integration.test.ts` files with
`pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts`;
7 failed and 11 passed, matching the initial candidate's revision mismatches.
Upstream `1fec386` repaired migration 0035 and its revision assertions; after
advancing the base, the entire integration suite passed. No local API, migration
or permission test changes belong to the localization diff.

Browser follow-ups retain the assertions while updating intended localized
date/unit output and bidirectional identifier isolation. A new Preload check
also holds Save open, changes the caller's locale, and verifies the captured
Arabic CSV locale; JSON remains byte-for-byte identical in either locale.

The initial browser gate found three outdated presentation expectations (ISO
history dates, untranslated Box, and unisolated count identifiers) and a real
Indic acknowledgment mismatch in the Sales row cache. The expectations now
assert localized display; numeric cache acknowledgment compares normalized
representations while preserving unsubmitted text and original unit IDs.
The Sales retention/reopen scenario passed in the owning-file rerun.

An intermittent Delta-dialog Axe contrast failure was investigated on baseline
and candidate. The baseline scenario passed; the candidate exposed the dialog's
existing 200ms opacity entrance animation. The test now waits for final dialog
opacity and an enabled, opaque confirmation button before running the unchanged
Axe assertions. No contrast rule, scan, global style or product animation was
disabled. The final browser coverage and follow-ups are recorded above and below.

Purchasing follow-ups also wait for the sidebar's existing opacity transition
before scanning ready, unavailable and denied states. A resumed draft test waits
for its existing invoice-field focus handoff before entering the next offer;
previously it could type while the asynchronous restore still replaced header
state. These are readiness assertions; offer calculations and application focus
behavior are unchanged. No Axe exclusions or new skips were introduced.

The owning Purchasing rerun used
`pnpm --filter @breev/desktop exec playwright test --config playwright.browser.config.ts test/browser/purchasing.browser.test.ts`:
41 passed, 4 existing opt-in skipped, 1 failed and 6 did not run. Its remaining
failure expected the old ISO expiry caption instead of the localized
`Jun 30, 2029`. After updating that presentation assertion, the remaining seven
scenarios were run with the same command plus
`-g 'allows correcting a missing expiry|allows deleting a draft row|preserves an invalid Supplier header|keeps the item panel in view|brings a refused Purchase Return|brings a blocked Delta|prints the purchase snapshot'`:
7 passed. Together the complete browser run and bounded follow-ups cover all
170 required scenarios. The four opt-in skips are the existing reference-volume
and interactive manual checkpoints. The original full command returned failure;
the resolved assertions and completed scenarios are reported separately.

Packaged verification used
`pnpm --filter @breev/desktop exec playwright test --config playwright.config.ts`:
3 passed. Bilingual A4 print-media captures are included under
`captures/purchase-print-en.png` and `captures/purchase-print-ar.png`.

| Evidence dimension                | Verified seam / artifact                                                                                                                    | Remaining limit                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Locale, theme and exact amounts   | Dashboard captures in both themes; Catalog/Purchase/Sales renderer and browser tests; canonical payload controls                            | Physical bilingual certification remains #109.                                   |
| Retained errors and dirty drafts  | Catalog delayed-response and language-switch browser scenarios; Sales acknowledgment/reopen checks                                          | No live pharmacy data was used.                                                  |
| Date-only and explicit timestamps | UTC-anchored leap-date fixtures across Baghdad/Los Angeles/Tokyo; midnight/DST/invalid-zone helper fixtures and Inventory permission checks | General-context timezone exposure remains F07's blocker.                         |
| Accessibility and sizing          | Localized accessible-name assertions, unchanged Axe scans, Purchase 200% text and Delta captures                                            | Windows Narrator remains unverified. Sales scroll ownership remains #204.        |
| CSV and print                     | Validated synthetic source bundle; bilingual CSV samples; exact serializer/Preload tests; bilingual A4 print-media captures                 | Windows Save and spreadsheet imports, physical printer output remain unverified. |
| Boundaries and offline/restart    | Unit, real PostgreSQL integration, browser and packaged security/offline/restart suites                                                     | Report reconciliation remains conditional on #201.                               |

## Manual and completion limits

Windows Save dialog, Excel/LibreOffice controlled-column import, physical barcode
output, Narrator and physical bilingual certification are not established by
Linux automated checks. They remain pending manual evidence, with #109 retaining
certification ownership. No final/legal printing capability was added.

This candidate does not close #202. Phase 8 report reconciliation and general
pharmacy-timezone exposure remain required. Stored values, wire schemas,
authoritative calculations, permissions/entitlements, UTC instants, transactions,
inventory/accounting effects and immutable source facts are unchanged. Final
staged diff inspection confirmed no changes to local API, contracts, migrations,
prototype sources or global styles. The historical audit and generated evidence
outside this candidate's directory were preserved.
