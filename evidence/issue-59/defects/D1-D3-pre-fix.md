# D1, D2 and D3 — the pre-fix measurements, and why they have no transcript

**Builds the figures describe:** `e73b541` (`Merge pull request #169 from PharmaElectrons/issue/27-start-sale-draft-reorder`) for D1 and D2, and `7dda434` (`fix(purchasing): keep the item-details panel and correction refusals in view`) for D3 — each the build under acceptance at the time, packaged by `apps/desktop/scripts/package.mjs` and driven by the milestone-2 acceptance harness.
**Build the bundle now records:** `1d229d4` (`fix(purchasing): fit every invoice column in the window and keep sections stacked`).
**Why this file exists:** each time a defect was fixed, the transcript that carried its failing measurements was **regenerated in place** on the new commit, so no artifact in `evidence/issue-59/acceptance/` shows any pre-fix geometry any more. This file preserves those figures and names where each one comes from, so the claim in `README.md` §5 and `delivery-note.md` §6 — that the acceptance runs failed before they passed — can be checked rather than taken on trust.

Nothing here is a measurement taken by this file's author. Every number below is quoted from a source that still exists in the repository or its history, and the source is named beside it.

## Sources, all still reachable

| source                                                                                      | how to read it                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The two fix commits' own messages                                                           | `git show 7dda434` (D1, D2) and `git show 1d229d4` (D3 and the two layout regressions) — each message states what the build did before it                     |
| `docs/ai/IMPLEMENTATION_PLAN.md` §8, the D1/D2/D3 table and the WF-1 / WF-1-R / WF-2 record | in the working tree (gitignored planning file)                                                                                                                |
| W1's in-window measurement at `e73b541` (D1, D2) and at `7dda434` (D3)                      | the source of the coordinates quoted in both of the above; the D3 run was executed with `--allow-recorded-failures` so the failing measurements were captured |
| W5's second-pass CSS reading (H-1, H-2, H-3) and third-pass M-1/M-2                         | quoted in `docs/ai/IMPLEMENTATION_PLAN.md` §8                                                                                                                 |
| The post-fix measurements, for comparison                                                   | `evidence/issue-59/acceptance/transcript.json`, the `note` steps of the `scope-item-details-panel-*`, `scenario-adjustment-*` and `scenario-units-*` records  |

The packaged window's inner size for every measurement, before and after, is **1066 × 658**.

## D1 — the item-details panel was off-screen

Quoted from `docs/ai/IMPLEMENTATION_PLAN.md` §8:

> The item-details panel (`aside.purchase-item-panel`, purchase-row-entry.tsx) is off-screen at the packaged window size: LTR rect x 1459 / right 1747, RTL x −656 / right −368; the purchase workspace overflows horizontally (scrollWidth 1763 vs clientWidth 1051, never scrolled). The fixed `aside.purchase-item-sidebar` (purchasing-screen.tsx ~783-793) is a permanent "No item selected" placeholder with no code path that fills it, and reserves 20rem above 80rem.

Quoted from the fix commit message (`git show 7dda434`):

> The populated item-details panel sat beside the row table inside a workspace that overflowed horizontally at the packaged window size, so it was never on screen (LTR x 1459, RTL x -656 at 1066x658), while a fixed sidebar showed a permanent "No item selected" placeholder that nothing ever filled.

| figure                                        | pre-fix (`e73b541`)                                                                                                                 | post-fix, from the transcript at `1d229d4` (unchanged since `7dda434`)                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aside.purchase-item-panel` x / right, LTR    | **1459 / 1747** — right of the 1066 px window                                                                                       | **0 / 1051**, `fullyInsideViewport: true`                                                                                                         |
| `aside.purchase-item-panel` x / right, RTL    | **−656 / −368** — left of the window                                                                                                | **0 / 1051**, `fullyInsideViewport: true`                                                                                                         |
| purchase workspace scrollWidth vs clientWidth | **1763 vs 1051**, never scrolled                                                                                                    | the workspace no longer exceeds the client width                                                                                                  |
| what the user saw in the side area            | `aside.purchase-item-sidebar`, a permanent "No item selected" placeholder with no code path filling it, reserving 20rem above 80rem | one panel headed "Item information", fed from the selected row; empty state "No item selected. Pick an item from the invoice to see its details." |

Requirement missed: scope §13.2 and plan #18, "the item-details side panel appears in purchasing".

## D2 — the blocked-Delta refusal was not brought into view or focused

Quoted from `docs/ai/IMPLEMENTATION_PLAN.md` §8:

> The blocked-Delta refusal `section.purchase-adjustment p.form-error` is not scrolled into view / focused (rect y −99 inside two scrollers).

Quoted from the fix commit message:

> A blocked Delta refusal (and the return workflow's errors) rendered outside the dialog's scroller without focus. Refusals now scroll into view and take focus through the committed-focus pattern.

| figure                                            | pre-fix (`e73b541`)                             | post-fix, from the transcript at `1d229d4` (unchanged since `7dda434`)               |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `section.purchase-adjustment p.form-error` rect y | **−99**, inside two nested scrollers, unfocused | **226** (bottom 274 in English, 250 in Arabic), `fullyInsideViewport: true`, focused |

The Delta itself was correctly refused before the fix; what failed was the person's ability to see the refusal. The refusal string is unchanged by the fix.

## D3 — the base-unit preview column was behind the row table's scrollbar

Found on the **`7dda434`** build, after W5's third pass (M-1/M-2) tightened the harness helper `expectOnScreen` from "intersects the viewport" to **full containment**. The acceptance run was then repeated with `--allow-recorded-failures` so the failing geometry would be captured rather than aborting the run: all four `scenario-units-*` records failed with measurements.

Quoted from `docs/ai/IMPLEMENTATION_PLAN.md` §8:

> The purchase row table's base-unit preview column ("Inventory Units", e.g. `4 Strip`) — the cell carrying the client scenario "purchasing 1 pack records 4 strips in the base unit" — is entirely outside the viewport at 1066×658 in all four passes (LTR x 1389→1524, RTL x −459→−338; `div.purchase-row-table-wrap` clientWidth 1018 vs scrollWidth 1507/1494, scrollLeft 0; viewport ratio 0), on the entry row and on committed rows.

Quoted from the fix commit message (`git show 1d229d4`):

> the base-unit preview column ("Inventory Units", the cell that shows that 1 pack records 4 strips) sat behind the row table's horizontal scrollbar at the default window size in both directions, on the entry row and on committed rows.

| figure                                                      | pre-fix (`7dda434`)                                     | post-fix (`1d229d4`), from the transcript                               |
| ----------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `[data-column-field="inventory-units"]` cell x → right, LTR | **1389 → 1524** — beyond the 1066 px window             | **890 → 1034**, `fullyInsideViewport: true`, `scrollingAncestors: []`   |
| the same cell x → right, RTL                                | **−459 → −338** — beyond the window's left edge         | **17 → 161**, `fullyInsideViewport: true`, `scrollingAncestors: []`     |
| `div.purchase-row-table-wrap` clientWidth vs scrollWidth    | **1018 vs 1507** (LTR) / **1494** (RTL), `scrollLeft 0` | the wrapper no longer exceeds its client width with the default columns |
| viewport intersection ratio of the cell                     | **0** — wholly off screen                               | fully contained, on the entry row and on the committed row alike        |

Requirement missed: `docs/quality.md`'s Units scenario, "purchasing 1 pack records 4 strips in the base unit" — the figure was computed correctly but the person could not see it without scrolling the table sideways.

### Two layout faults the D1/D2 fix had introduced, repaired in the same commit

Neither was caught by the test suites or by the independent review; both were found by **opening the regenerated screenshots**. Quoted from `docs/ai/IMPLEMENTATION_PLAN.md` §8:

> It also repaired two layout faults WF-1 had introduced and neither the tests nor WF-1-R caught (both found only by opening screenshots): the table wrapper collapsed to `clientHeight 0` above 80rem, then (after a `min-block-size: max-content` band-aid) overflowed into the sections below; the root fix is `grid-auto-rows: max-content` on `.purchase-row-workspace`.

The lesson recorded alongside it, verbatim: _"per-element geometry assertions miss collapsed or overlapping containers; someone must open the screenshots."_ The guard added for it is `expectWorkspaceSectionsStacked` — consecutive workspace children must never overlap — in `apps/desktop/test/browser/purchasing.browser.test.ts:1970`.

## What the acceptance run recorded at the time

`docs/ai/IMPLEMENTATION_PLAN.md` §8 cites the evidence for D1 as "`evidence/issue-59/acceptance` scope records **(fail)** with measurements" — that is, the scope flow's verdict on `e73b541` was fail for the scope item "the item-details panel in purchasing", and the adjustment flow's refusal step carried the out-of-view measurement. Both were found on 19 September 2026 by the Fable audit of the scope-flow screenshots, confirmed by W5's CSS reading (H-1, H-2 for D1; H-3 for D2) and by W1's in-window measurement. D3 was found on the next build for the same reason in a different place: the four `scenario-units-*` records failed on `7dda434` once the harness demanded full containment.

Because the harness regenerates `evidence/issue-59/acceptance/` as a whole — by design, so a partially-updated bundle can never be committed (see `apps/desktop/scripts/regenerate-m2-acceptance.mjs`) — each failing transcript was replaced by the next passing one. That is the trade this file compensates for: one coherent bundle for the build under acceptance, plus this record of what the earlier runs showed.

## Where the fixes are proved

- `apps/desktop/test/browser/purchasing.browser.test.ts`, +264 lines in `7dda434` (D1, D2): the panel visible and `toBeInViewport()` at 1024 × 768, 1066 × 658, 1280 × 800 and 1366 × 768, in Arabic and English, both themes, axe clean; the wholesale price only in the panel; "keeps the item panel in view on an invoice longer than the window" (twelve rows); "brings a blocked Delta refusal into view and gives it focus", with the draft kept.
- The same file, +328 lines in `1d229d4` (D3 and the two regressions): `expectBaseUnitColumnOnScreen` (`:2018`) requires `wrap.scrollWidth <= wrap.clientWidth`, `wrap.scrollLeft === 0`, document `scrollLeft === 0`, the cell's rect inside the viewport and `toBeInViewport({ ratio: 1 })`, at 1024 × 768, 1066 × 658 and 1280 × 800 in both locales and themes; `expectWorkspaceSectionsStacked` (`:1970`); "brings a refused Purchase Return into view and gives it focus" (`:1764`); and each bilingual pass on its own REST-created draft so the four purchasing screenshots stay like-for-like.
- `evidence/issue-59/seams/purchasing.browser.fix-7dda434.txt` — 17/17 at `7dda434` — and the `*.fix-1d229d4.txt` re-runs indexed in `evidence/issue-59/seams/INDEX.md`.
- `evidence/issue-59/acceptance/transcript.json` — 44/44 records pass at `1d229d4`, with every measurement above recorded as a `note` step in all four passes.
- `README.md` §5 and `delivery-note.md` §6 in this bundle.
