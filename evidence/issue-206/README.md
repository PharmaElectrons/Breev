# M2 Phase 2 — issue #206 review candidate

T01–T05: **automated-verified / manual-pending**. One final stakeholder Phase 2
PASS/FAIL is required. No commit, staging, push, PR, merge or Phase 3 was performed.
Branch: `issue/206-m2-prototype-ui`; current dev base `ad1d492`.

## Compact review

Open [reference/current comparisons](http://127.0.0.1:51892/p2-comparison.html),
then use the [10–15 minute walkthrough](walkthrough.md) in the
[running synthetic fixture](http://127.0.0.1:51892/#/purchases).
The agent opened both prototype and current images and inspected the material
states; [inspection notes](comparison-notes.md) record the differences.
Original images are displayed without masks or raster edits.

## What changed and why

- Purchasing-only semantic colors, local fonts, compact review/Return totals and
  prototype-sized 640px confirmation surfaces replace oversized or inconsistent
  presentation. Global CSS, shell and prototype source are unchanged.
- Native nested dialogs provide whole-page inertness, safe initial focus,
  Tab/Shift+Tab cycling, topmost Escape, IME protection, restoration and busy guards.
- Return start information, unfinished drafts and Purchasing-tab exits use explicit
  preservation/discard choices. Cancellation clears pending exits; reopening a
  correction cannot consume a stale leave request. Linked posted documents focus
  their existing Back action and restore the original link on Escape.
- A closed Supplier combobox no longer references a removed option; Supplier
  allowance labels are localized. Archived searchable tiles retain readable
  contrast. Status badges still identify archived/merged records.
- Narrow/enlarged entry canvases scroll locally instead of reducing an item input
  to 18px. Existing optional controls remain a bounded popover with their original
  handlers. Desktop base-unit preview is fully visible without horizontal scrolling.

## Scope and comparisons

[Visual contract](visual-contract.md) inventories every in-scope surface and
classifies required transplants, authority/locale/accessibility deviations,
data-dependent differences and M3 exclusions. Prototype header 64px and the
protected shared Breev header 60px are documented; the shell was not resized.
The full-width M2 Supplier profile excludes live balance/ledger/statement owned
by M3. Snapshot facts, exact money, evidence and Step-Up replace prototype guesses.

Each locale/theme has **44 core states × two desktop
viewports**, plus **21 narrow/text captures**:
1366×768, 1280×800, 900/560 width and verified 32px root font (200%).
Core and responsive Axe assertions retain every default rule and explicitly
enable WCAG target-size; none are suppressed. Action checks include full viewport
visibility and clickability. See [candidate/source manifest](candidate-manifest.json).
Additional refusal/restart/offline/rail captures use the accepted tests and real
PostgreSQL. Complete file-level evidence is linked below; the gallery is deliberately small.

**48/48 unrelated-module pairs have identical pixels and geometry**, with no
masks: Sales, Catalog, Inventory, Settings, Dashboard and Basket, both locales,
both themes, two desktop sizes. [Exact comparison](sentinel-comparison.json).
Existing Sales #204 and Dashboard findings are retained; final sentinel Axe
findings are identical as well.
The default Sales browser sentinel does not reproduce #204's historical packaged
scrollable-fixture finding; that issue remains open. Dashboard retains
`aria-hidden-focus` and `color-contrast` in both before/current evidence.

## Necessary checks

| Check | Result and evidence |
| --- | --- |
| Changed-file Prettier and ESLint; renderer/Node typechecks; diff whitespace | PASS; final static logs under `.scratch/runtime/p2-206` |
| Desktop build | PASS; `build-final.log`; renderer-only rebuilds after concrete defects, final `build-popover-specificity.log` |
| Focused Purchasing unit seams | 5 files / 30 tests PASS, `unit-candidate.log` |
| Complete four locale/theme workflows | 4 PASS, `matrix-complete.log`; [core/narrow screenshots](matrix-complete/matrix/) |
| Saved-row/filtered navigation, current item facts, denied/recoverable states and correction refusals | 16 PASS, `final-recovery.log`; affected row/rail scenarios rechecked on final source in `exit-targeted-2.log` |
| Adjustment saved evidence, stale version, restart and uncertain post | 4 PASS, `final-legacy.log` first four; unchanged owning workflow source reused |
| Quick Product/scanner/row/header keys, layout, locale/theme, scope, connection and review canaries | 9 PASS, `final-canaries.log`; changed layout/keyboard canaries rechecked in `exit-targeted-2.log` |
| Actual rendered font glyphs | IBM Plex Sans Arabic custom Regular/Bold verified through CDP; [platform-fonts.json](fonts/platform-fonts.json) |
| Unrelated-module sentinels | 48 exact pairs; final capture in `exit-targeted.log` |

Database browser jobs ran sequentially on fresh loopback PostgreSQL **5557**.
The retained walkthrough uses a separate fresh cluster **5558**. Retained
5551 and manual 5553–5556 processes/data were not reset or stopped.
No API/domain/contract/migration/Main/preload/dependency changes required a full
repository suite or repeated persistence/CNG/packaging gates.

## Provenance and failures

Protected startup/launcher hashes match the handoff; row/Quick Product, global
CSS, shell, API and prototype paths match the base. See the manifest and
[preservation record](preservation.json). Screenshots use the production renderer,
tested narrow bridge fake and real local API/database; they are browser proof.
Prototype captures render actual checked-in JSX/CSS/fonts with deterministic
test state, without Supabase calls or running effects. Prototype has no dark peer
and hard-codes English RTL; no matching references are invented.

Diagnostic failures are preserved under this issue/runtime directories. They
identified the actual row overlap, small narrow input, rail layering, stale leave
counter, old upward-position rule precedence and lost linked-document focus.
Capture-only paused-animation failures and temporary diagnostic syntax mistakes
are classified separately.
The first exit run's sentinel passed, then the optional glyph probe lacked a saved
draft and stopped the remaining tests. Its fixture was corrected; all 14 probe,
row/rail and keyboard checks passed in `exit-targeted-2.log`. No assertion was
removed and no failed run is represented as an overall PASS.
Material failed candidates remain in their own directories; final results replace
earlier candidates, and failed runs are not represented as overall PASS.
Accepted Phase 1 PR #205/Linux CI is historical, not proof of these edits.

## Open limits and acceptance

Physical Windows Narrator and physical-profile proof remain **unperformed**.
Automated status/focus/Axe checks do not substitute for them. Historical packaged
Electron preview clipping (79.8%) is **not closed** by the browser's strict 100%
visibility proof; no new packaged/release run was performed. Existing host/CNG,
Docker and crash-test limitations, Sales #204, G-01/G-02/G-16 and optional empty-expiry
confirmation remain open under the accepted handoff. No professional or release
approval is inferred, and the repository-wide gate is not declared green.

Return one Phase 2 **PASS** or **FAIL** after the walkthrough. Work stops at this
acceptance boundary; later commit/push/PR and any merge require their instructions.
