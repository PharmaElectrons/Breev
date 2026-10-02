# T04 independent invoice offer — accepted slice evidence

1 October 2026. Branch `issue/198-m2-purchasing-integrity`; accepted T03 commit
`1256dcdf15e5f8c1b391d799ad5500f1e4403916` remains the baseline.

[Source review](source-review.md) and [working defaults](working-defaults.md)
record the user's later authorization and its limits. Requirement family M2-P02
and G-01 remain open. T04's [separate checkpoint](manual-checkpoint.md) received
explicit stakeholder PASS on 1 October 2026: “IT IS A PASS”. The full pre-commit
gate ran once; [its record](pre-commit-gate.md) preserves fixture remediation,
host limitations and final affected reruns. T05 follows the focused T04 commit
and requires its own checkpoint. Unrelated startup/launcher edits retain
their recorded hashes and remain unstaged.

## Targeted verification

| Seam                                                                            | Result / evidence                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts owning workspace unit suite                                           | 216 passed; `.scratch/runtime/t04-contracts-final.log`.                                                                                                                                                                                                                                                                                    |
| API calculator, existing costs, confirmation hash and purchase journal template | 76 passed, then the additional 200-case allocation property test passed in its 15-test owning file; `.scratch/runtime/t04-api-unit-final.log`, `t04-offer-properties.log`.                                                                                                                                                                 |
| Desktop exact input conversion/API/workflow/filter units                        | 35 passed; `.scratch/runtime/t04-desktop-unit-final.log`.                                                                                                                                                                                                                                                                                  |
| Fresh/forward migration                                                         | 10 passed in `t04-pg-confirmed.log`: historical raw facts/hash/revisions, current replay, malformed inputs/snapshots and protected facts.                                                                                                                                                                                                  |
| Purchase posting integration                                                    | 21 passed; `.scratch/runtime/t04-posting-confirmed.log`. Includes durable offer restart, rejected-input rollback, immutable Post/retry, offer-only fixed correction, fixed quantity correction, percentage input inheritance/recalculation and original preservation, plus existing authorization/atomic-failure/concurrency/Return seams. |
| Browser offer workflow                                                          | **4 passed**, 49.8 seconds; `.scratch/runtime/t04-browser-accepted-candidate.log`. English/Arabic and light/dark, save/restart, fixed/percentage switching, invalid input retained, immutable review/correction, axe and 1280×800 action visibility.                                                                                       |
| Build/types/format/lint                                                         | API and Desktop builds, API and renderer typechecks, targeted ESLint, modified-file Prettier check and `git diff --check` passed. Logs retained under `.scratch/runtime/t04-*.log`. The post-PASS [full gate](pre-commit-gate.md) records broader results separately.                                                                      |

The broader gate found older Purchase/Adjustment regression inputs missing the
required independent offer. API, browser and acceptance seed fixtures now send
explicit no-offer input or the saved Adjustment input. This is test maintenance;
accepted production behavior was unchanged. The initial overlapping follow-up
is diagnostic only; authoritative final affected runs are sequential.

An extra unchanged posting infrastructure fixture requires Docker directly and
failed before its 18 tests in this host. This is a fixture prerequisite limit,
not a passing test. The changed unified idempotency reader is exercised by the
real PostgreSQL migration and Purchasing retry/transaction tests. No assertion
or integrity boundary was weakened. Supported full-suite evidence remains part
of the eventual pre-commit/phase gate.

Early browser attempts exposed test-selector mistakes (decorative icons in
button names, selecting the register rather than opening its invoice, and
expecting Western digits in Arabic). These were corrected. The asynchronous
header-save/Post race found during verification was fixed in production.
Final proof uses the production renderer and real local API/PostgreSQL fixture,
with the desktop preload/identity harness used by the existing browser suite.

## Visual scope

Prototype `design/prototype/src/routes/purchases.tsx:1387` supplies the footer
six-column geometry and neighboring discount percentage/amount fields. The
required independent allowance/offer facts replace excluded expenses/duplicated
totals within that geometry. Existing Adjustment totals and modal geometry are
retained; the offer is a separate comparison row between allowance and net.
See `screenshots/offer-draft-{en,ar}-{light,dark}.png` and
`screenshots/offer-summary-{en,ar}-{light,dark}.png`.

This is bounded visual verification of T04 surfaces, not a claim of whole-module
prototype fidelity, native Narrator validation or packaged-release acceptance.

## Final result

Targeted implementation proof passed. The Arabic light draft and Arabic dark
Delta captures were inspected directly: offer inputs and saved amounts remain
readable, the confirmation is visible, gross/allowance/offer/net comparisons
reconcile and the no-stock/no-payable effect is explicit. English light summary
was also inspected; final captures retain the existing modal geometry.

The other locale/theme scenarios passed with their own captures and axe checks.
This implementation received a separate stakeholder T04 PASS after the review
and prepared manual session. It is not a full repository/release PASS. Full
pre-commit verification ran once and is recorded with its supported-host limits.
The focused commit contains this accepted slice and bounded fixture maintenance.
