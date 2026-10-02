# T03 candidate — Adjustment controls, totals and denials

Date: 30 September 2026. Issue [#198](https://github.com/PharmaElectrons/Breev/issues/198),
Part of [#190](https://github.com/PharmaElectrons/Breev/issues/190).
Status: **stakeholder PASS**, 30 September 2026, based on agent-executed automated
and visual verification; [local commit gate recorded](pre-commit-gate.md). No claim that the
stakeholder personally repeated the manual script or that Narrator was run.
T02 is accepted and committed in `7d407fe`; its [local gate](../t02/pre-commit-gate.md)
records the actual broader verification limits. See [acceptance](manual-results.md)
for the explicit user decision and the bounded proof it accepts.

## Behavior and ownership

Scope §6.3, #52, M2-P04 and M2-P1-T03 govern this slice. Previous/Next now use
the loaded, active filtered immutable Purchase result set in its displayed order;
Adjustment/Return rows cannot become Purchase navigation targets. Search retains
the query and focuses it. Superseded list responses cannot replace newer results.
Direct document entry loads the corresponding current list rather than borrowing
the API's unfiltered navigation. Broader row snapshots, date/sort/scroll workflow
coverage and item details remain T05/T06 work.

Leaving an active Adjustment requires an explicit choice. Continue/Escape returns
to editing and restores the action's focus. Keep is available only for a clean
saved draft. Save and leave saves through the typed update command, preserving
every supported header, row, reason and evidence field before navigation. Failed
saves retain the current view and input. Delete uses the versioned discard command
after explicit confirmation. Cancel Adjustment selects deletion; summary Cancel
only returns to editing. Busy or uncertain Post blocks leaving and editing while
the existing same-request recovery remains available.

New invoice invokes the existing Purchase creation operation after the Adjustment
leave choice. It is available only with draft-management authority and a pristine
Purchase workspace; otherwise it is omitted so existing Purchase work cannot be
overwritten. The sole `purchasing-screen.tsx` change passes that guarded callback.
The existing creation function, row editor, Quick Product, focus sequence and
shortcuts are unchanged. Return opens the original invoice's physical Return
workflow after preserving/discarding the Adjustment, with focus returning to the
original Return action. The permanently disabled Edit duplicate is removed.

The server preview now supplies required `totalsComparison` and `rowTotals`.
Before totals are the immutable original plus prior posted Adjustment Deltas;
after totals add the current exact Delta. The existing calculation and working
allowance rules are unchanged. Canonical confirmation binds these facts, and Post
recalculates them. No schema migration or historical receipt rewrite is required.
Renderer multiplication and false gross-as-net labels are removed. Before draft
creation, immutable server detail facts are shown; unreviewed edits show Save and
review to calculate. Valid zero totals are formatted as zero. Offer, returned-row
quantity, absent margin and special price remain localized unavailable rather
than fabricated zero. Supplier effects are exact invoice-family contributions,
never a Supplier account balance. Posted Adjustment labels distinguish primary,
allowance and Cost After Discount Deltas.

Ordinary messages give bilingual explanation and recovery. Request references
remain internal and are accessible only in closed Support details with a copy
action. A changed reference closes that disclosure again. API-unavailable,
input/stock refusal, stale/conflict, session-ended and access-denied paths retain
work. Busy/saved/dirty states and refusals are announced; signed quantities and
amounts do not rely on color. Dialog focus is contained and Escape targets the
topmost surface. Adjustment and support copy live in the Purchasing catalogues.

## Control inventory

| Surface/control                                                               | Operation and gate                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Original-invoice badge / Back / Escape in editor                              | Choose Continue, Keep saved, Save and leave, or Delete; then open the original. No dirty input silently leaves.   |
| Create adjustment copy                                                        | Typed creation with saved selected reason/evidence; explicit transition from read-only original to editable copy. |
| Unfinished Continue                                                           | Load the exact existing server draft and its saved fields.                                                        |
| Unfinished Delete                                                             | Explicit confirmation, then versioned discard; no immediate deletion.                                             |
| Unfinished Back                                                               | Keep or explicitly discard existing saved work before returning.                                                  |
| Reason dropdown                                                               | Five localized enums, typed update and preview invalidation.                                                      |
| Evidence in banner and summary                                                | Same evidence state, saved before preview; any edit disables Confirm.                                             |
| Supplier / invoice number                                                     | Validated typed header correction; hash/Delta/audit and protected original retained.                              |
| Quantity / cost / ByPrice retail                                              | Typed row updates, authoritative validation/calculation, preview invalidation.                                    |
| Expiry, lot, Product, unit, pricing mode, margin, notes / ByPercentage retail | Protected snapshots/derived retail; no unauthorized edit or dead add-item control.                                |
| Row remove icon                                                               | Remove that draft row, focus Save, then server stock/Delta validation; absent from read-only original.            |
| Previous / Next                                                               | Move within current filtered Purchase results after leave choice; disabled at the actual boundary.                |
| Search                                                                        | Return to the same query/results with search focus after leave choice.                                            |
| New invoice                                                                   | Existing creation operation after leave choice, only where it cannot overwrite Purchase work.                     |
| Purchase return                                                               | Open physical Return for the original after leave choice; disabled if server `canReturn` is false.                |
| Cancel Adjustment                                                             | Explicit Delete confirmation; Continue cancels the deletion.                                                      |
| Save and review                                                               | Save all bound facts, request authoritative preview; no transaction held across review.                           |
| Summary Cancel / Escape                                                       | Close summary, keep edits/saved draft, return focus to Save.                                                      |
| Summary Confirm                                                               | Existing expected-version/hash/idempotent atomic Post; disabled for invalidated preview.                          |
| Reload saved adjustment                                                       | Resolve stale/version conflict by explicit server reload; deliberately replaces local edits.                      |
| Retry Confirm after uncertain Post                                            | Recover the same command/key; editing and leaving stay blocked.                                                   |
| Leave Continue / Escape                                                       | Retain local changes and return focus to the initiating action.                                                   |
| Leave Keep / Save / Delete                                                    | Distinct durable keep, typed save, or explicitly confirmed versioned discard.                                     |
| Support disclosure / Copy                                                     | Secondary reference only; localized success/unavailable guidance.                                                 |
| Posted Back                                                                   | Original immutable review; no draft discard prompt after acknowledged Post.                                       |
| Enter / Tab / Shift+Tab                                                       | Native focused action; topmost dialog contains focus, with no new Purchase shortcuts.                             |
| Server-denied direct Adjustment route                                         | Read-only explanation and Back; no editable inputs or Save.                                                       |

## Pattern comparison and presentation

Microsoft Business Central documents [filtered list views](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-enter-criteria-filters)
and [record navigation/save-and-close](https://learn.microsoft.com/en-gb/dynamics365/business-central/keyboard-shortcuts).
Those list/context and explicit close patterns fit Breev's local authority.
Breev retains explicit versioned saves and a reviewed hash for posting; it does
not adopt another product's automatic field saving or regulated accounting rules.
The [linked correction precedent](../t02/README.md#pattern-comparison) remains
evidence, not approval of G-01/G-02.

Prototype anchors: `design/prototype/src/routes/purchases.tsx`, Adjustment banner,
metadata, 12-column table, totals groups, toolbar and Delta dialog. Those containers
and scoped styles are retained. Required before/after monetary rows and impact
explanations occupy the existing scrolling comparison surface. Removed placeholders,
truthful unavailable text, conditional actions and extra required facts are
explained functional differences, not claims of unchanged pixels. New CSS selectors
are all under `.purchase-adjustment`; shared/global styles and other modules are
unchanged. Captures cover English/Arabic, light/dark, 1280×800 and 1366×768;
focused tests check narrow scrolling, 200% text, focus and axe. The follow-up
[visual source/capture review](prototype-fidelity.md) found and corrected inherited
Delta dialog geometry and styling differences. The stakeholder accepted this
evidence; Windows Narrator and release certification are not claimed.

## Automated proof

Changed files are bounded to these seams:

- Desktop: `posted-purchase-review.tsx`, `purchase-adjustment-workflow.tsx`,
  `purchase-return-workflow.tsx` (denial presentation only),
  `purchasing-messages.ts`, new `purchasing-support-details.tsx`, new
  `purchase-result-navigation.ts`, the guarded callback in `purchasing-screen.tsx`,
  and Adjustment-scoped additions in `styles.css`, all under
  `apps/desktop/src/renderer/src/`.
- Desktop proof: workflow/catalogue unit files, new navigation and action-inventory
  unit files, and `apps/desktop/test/browser/purchasing.browser.test.ts`.
- API: `apps/local-api/src/purchasing/purchase-adjustments.service.ts`,
  `purchase-adjustment-confirmation.unit.test.ts` and
  `purchase-posting.integration.test.ts`.
- Contracts: `packages/contracts/src/local-rest/index.ts` and `purchasing.test.ts`.
- Documentation/evidence: traceability, the milestone scope/evidence map, and
  `evidence/issue-198/t03/`. No unrelated user file is staged.
- The copied FilePen icon notice ships in
  `apps/desktop/src/renderer/public/icon-licenses/Lucide-FilePen.txt`.

Targeted commands used the owning workspace's Vitest/Playwright config:
`pnpm --filter @breev/contracts test:unit`; API `exec vitest run` for the three
confirmation/Delta/journal unit files and two Purchasing integration files;
Desktop `exec vitest run` for the seven listed unit seams;
`pnpm --filter @breev/desktop exec tsc -p tsconfig.renderer.json --noEmit`;
API typecheck/build and Desktop build; modified-file `exec eslint` and
`exec prettier --write/--check`; and Desktop
`exec playwright test --config playwright.browser.config.ts test/browser/purchasing.browser.test.ts -g <targeted titles>`.
The title groups and actual results are recorded below and in the named logs.

| Seam                                                                                                  | Result                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts unit suite                                                                                  | 216 passed                                                                                                                                                                                      |
| API canonical confirmation, Delta and journal-template unit files                                     | 52 passed; exact totals alter the confirmation hash                                                                                                                                             |
| Desktop workflow, action/source inventory, navigation, catalogues, signed money, Return and API files | 32 passed                                                                                                                                                                                       |
| Purchasing/Post real-PostgreSQL integration files                                                     | 29 passed; exact A01/A02 totals, immutable originals, races/retries/rollback and authority boundaries retained                                                                                  |
| New controls matrix                                                                                   | Four passed with all controls including New, clean/dirty/filter, offline save, malformed quantity, permission/session presentation, unavailable/zero/negative totals, focus/axe, locales/themes |
| Confirmation/restart/stale/uncertain retry browser matrix                                             | Four passed                                                                                                                                                                                     |
| Header corrections / percentage-price browser regressions                                             | Four plus one passed                                                                                                                                                                            |
| Keyboard/Return, register refusal and review-only role cases                                          | Passed                                                                                                                                                                                          |
| Real stock/Return refusal focus cases                                                                 | Two passed, localized text and hidden reference verified                                                                                                                                        |
| Renderer/API types, API/Desktop builds, modified-file lint/format                                     | Passed                                                                                                                                                                                          |

Commands/logs: `.scratch/runtime/m2-p1-t03-*.log`; browser config is
`playwright.browser.config.ts`. Database fixtures run sequentially on the verified
task-owned PostgreSQL 18 regression cluster, port 5551. The manual checkpoint uses
a separate task-owned cluster, port 5552. No full repository/release certification
is claimed. The T03 outer commit gate followed stakeholder PASS and is recorded
in [pre-commit-gate.md](pre-commit-gate.md).

Some first runs caught obsolete test expectations for an icon's accessible name,
the prior leave text, a paragraph selector and a raw refusal code. These test
assumptions were corrected; assertions for actual saved facts, safety and focus
were retained. Accepted historical captures were copied/restored rather than
committing regenerated files under old issues.

## Acceptance and open work

The [headed manual session](manual-session.md) and [manual-test.md](manual-test.md)
are retained as prepared fixtures. The stakeholder explicitly accepted
agent verification and replied PASS; see [manual-results.md](manual-results.md).
The T03 [local commit gate](pre-commit-gate.md) is complete with precise
host/prerequisite limitations. No push/PR or phase acceptance is claimed.
The earlier optional-note report is still [open](../followups.md); current passing
restart reproductions do not establish its root cause or a production fix.
G-01/G-02, row/item-detail completion, performance/package/current phase proof,
M3 #63/#75 and final/legal printing remain at their owning gates. No migration,
role grant, preload method or Main dependency is added. Unrelated startup and
development-runner work remains byte-for-byte preserved and unstaged.
