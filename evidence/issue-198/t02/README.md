# T02 accepted — Adjustment reasons and editable facts

Date: 30 September 2026. Issue: [#198](https://github.com/PharmaElectrons/Breev/issues/198),
Part of [#190](https://github.com/PharmaElectrons/Breev/issues/190).
Status: stakeholder manual **PASS** on 30 September 2026. The stakeholder
explicitly requested marking the checkpoint PASS and confirmed they finished
the manual tests. T01 is accepted in `11e4683`; T02's accepted slice is committed
with the [final local gate](pre-commit-gate.md). See [manual results](manual-results.md).

## Requirements and implementation

Scope §6.3, issue #52 and M2-P04 require a complete corrected copy, exact Delta-only
posting, the five written reasons, before/after confirmation, immutable originals,
and validated Inventory/Accounting effects. T02 completes the Supplier and supplier
invoice-number correction paths and protects facts without an approved correction
path. The existing Purchase keyboard loop and Quick Product remain untouched.

| Editable fact           | Server path, preview and immutable/audit result                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reason                  | Typed five-value enum; separate saved dropdown; preview/hash and immutable reason/audit                                                                           |
| Evidence                | Separate saved input; exact preview/hash, immutable evidence and audit; T01 invalidation/retry retained                                                           |
| Supplier                | Stable ID and active validation; saved names before/after; exact payable transfer; hash, immutable header chain and journal/audit                                 |
| Supplier invoice number | Typed bounded input; saved before/after; canonical Supplier-identity duplicate lookup; current unapproved warning default; hash, immutable header chain and audit |
| Quantity                | Exact unit conversion and Inventory Delta validation; before/after quantities, money/movements, immutable row snapshots and audit                                 |
| Primary Supplier Cost   | Exact fils; Inventory value/payable Delta; stored before/after cost and audit                                                                                     |
| ByPrice retail          | Validated pricing mode; price-only Delta has no stock effect; saved before/after retail and audit                                                                 |
| ByPercentage retail     | Derived by the server from corrected cost and saved margin; read-only input; saved before/after retail and audit                                                  |

Expiry, lot, Product, unit/conversion, pricing method, margin and existing row notes
are protected. Unsupported date, settlement and allowance inputs are rejected by
the strict contract. Expiry/lot correction remains G-02-gated. The inactive item-add
control is replaced by localized guidance to the separate Return or authorized
stock-count/correction paths. No new physical-stock or refund policy is approved.

Before/after header facts are required in the preview and the immutable detail GET.
The GET projects the previous header from the immutable original/Adjustment suffix
chain, preserving historical names after master edits. The durable Post receipt is
unchanged; detail projection and command receipt serve different purposes.
Post audit now includes the full saved header/row facts and the exact posted
Delta, movement/batch references, payable effects, reason, evidence, version/hash.

## Supplier correction and linked Returns

An original debt Purchase's gross amount is insufficient to transfer its remaining
payable after Returns. Purchasing supplies the bounded immutable journal IDs of
that Purchase, its Adjustments and Returns to an Accounting-owned projection.
Accounting sums exact Supplier payable contributions from those journals. A
Supplier correction reverses the contributions for the other Supplier IDs and
assigns their total plus the current cost Delta to the selected Supplier. This
does not read or infer a Supplier's global account balance or rewrite history.
Names come from document snapshots. Cash corrections retain their existing rule.

Return draft/preview/Post uses the latest immutable corrected Supplier and locks
the same original before number, batch and valuation stages. The Return summary
shows the authoritative Supplier name and binds that identity, reason/evidence and
original identity into its hash. A correction racing a Return preview requires a
new preview. The original-row refund and WAC calculation remain unchanged;
G-01/G-02 and later Supplier Statements/payment/report work remain open.

## Pattern comparison

[Microsoft Business Central's correction workflow](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-correct-cancel-unpaid-purchase-invoices)
uses linked credit memos and replacement documents for posted invoices. Its
immutable correction trail and inspectable differences fit Breev's offline local
authority. Breev retains its funded Delta-only Adjustment and separate Return;
the precedent does not authorize adopting Business Central's payment restrictions
or changing accountant/pharmacist decisions.

## Focused automated proof

Commands run from the repository root; database tests and browser fixtures run
sequentially against the task-owned disposable PostgreSQL cluster.

| Check                                                                                                                                                                        | Result                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm --filter @breev/contracts test:unit`                                                                                                                                   | 216 passed                                                                                            |
| Local API canonical Adjustment hash, Delta table and finite journal template unit files (`vitest.unit.config.ts`)                                                            | 51 passed                                                                                             |
| Desktop Adjustment workflow/API, signed-fils formatter and Return workflow unit files                                                                                        | 21 passed                                                                                             |
| `pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts src/purchasing/purchase-posting.integration.test.ts src/purchasing/purchasing.integration.test.ts` | 29 passed                                                                                             |
| Focused Purchasing browser confirmation/header/percentage-price/keyboard cases                                                                                               | All 10 distinct scenarios passed; four header cases also passed in the final five-case navigation run |
| Modified source formatting, ESLint, API/renderer typechecks, Contracts/API/Desktop builds                                                                                    | Passed; Contracts rebuilt before consuming the new Return summary type                                |

Real PostgreSQL proof includes immutable original bytes and historical names,
same-name distinct Supplier IDs, exact transfer/journal/movement facts, duplicate
warning, protected-field and pricing-mode denials, unavailable Supplier denial,
permission/cost visibility and device/session checks, pharmacy-qualified foreign
keys, and T01 stale/atomic retry/rollback regressions. The linked Return case checks
partial Return → net Supplier transfer → Return against corrected Supplier →
Supplier change after Return preview → stale refusal/re-preview, with exact final
balances and unchanged original. It also replays the Supplier Post exactly once.
The strengthened final linked-Return case passed independently and also proves
that a Return posted after Supplier-correction preview invalidates that preview.

Browser proof uses production renderer assets and real API/database commands,
English/Arabic and light/dark, 1280×800, 1366×768, narrow scrolling, 200% text,
accessible names and axe, immutable A01/A02 navigation and saved exact evidence.
Screenshots are under `screenshots/` and `confirmation-screenshots/`; the current
keyboard/Return regression captures are copied into this candidate rather than
overwriting previously accepted issue #52/#53 evidence. The keyboard test reads
the server's traversal total instead of assuming at most ten invoices and checks
the selected invoice's current Supplier record instead of a fixed fixture name.
It waits for Previous to change the current invoice heading before drill-down;
the old comparison with the initially opened invoice could pass before navigation
finished. These are test corrections; filtered navigation remains T03 scope.

The [T01 outer-gate record](../t01/pre-commit-gate.md) distinguishes this Windows
profile's CNG/container/harness limitations. T02 focused tests do not claim a full
repository, packaged-release or Windows Narrator gate. The final outer gate
completed after acceptance: three packaged smoke tests passed; CNG, Docker and
Windows crash-harness limitations remain explicitly recorded in the local gate.

## Manual acceptance and remaining scope

Use [the detailed manual script](manual-test.md), with independent quantity,
price, Supplier, invoice-number and Other invoices, exact inputs/expected amounts,
an API restart, immutable review and protected expiry checks. The optional manual
fixture has finished and closed. Manual PASS comes from the stakeholder's
explicit acceptance and completion statement; automation does not award it.

The [case A evidence investigation](evidence-restart-investigation.md) records
the stakeholder's restart report, saved null evidence in the manual attempt, and
four strengthened real-API-restart browser cases, including a restart immediately
after the first Save/review and another after saving changed summary evidence.
All four locale/theme cases passed. The next manual fixture launch checks saved
case A evidence before restarting. The exact cause of both manual attempts'
blank input is unconfirmed. The stakeholder accepted T02 after completing the
manual tests; the note report remains an open follow-up rather than a claimed fix.

T03 still owns controls, filtered navigation, totals and denial presentation.
The [stakeholder diagnostic-ID rule](../followups.md) is now durable in
`docs/quality.md`; ordinary raw correlation IDs are not yet cleaned up by T02.
G-01/G-02 and the offer, complete row/item-detail, package/performance and full
phase checkpoints are pending. M2-P04 remains a defect family until those owning
checks and separate manual acceptances are complete. No migrations, role grants,
preload methods, Main dependencies, Quick Product or Purchase shortcut/focus-order
changes are included. Unrelated startup and development-runner edits are preserved.
