# T04 working defaults and later-change boundary

30 September 2026. After requesting a source review, the stakeholder explicitly
authorized proceeding with defaults when they can be changed later, and asked
that the report record what was done and why. This later instruction replaces
the T04 pre-code stop for these working defaults. It does not close G-01 or
represent accountant/legal sign-off. The separate stakeholder checkpoint was
accepted on 1 October 2026 with “IT IS A PASS”. Its full pre-commit gate and
focused commit are now authorized before T05; professional approval remains open.

[Source review](source-review.md) establishes the confirmed boundaries and the
remaining gaps. The earlier decision request is retained as historical context,
not a current request to reapprove settled WAC, history or correction policy.

Changing a rule for future invoices is manageable. Changing a posted invoice's
historical calculation is deliberately prohibited; it needs a linked correction.
Persist the selected input and an explicit rule version together with exact
calculated results. Future policy changes must introduce a new rule version,
retain interpretation of existing snapshots, and run the affected tests. Never
reinterpret old invoices with a new default or changed Supplier master data.

## Selected version 1 defaults

| Rule             | Working choice                                                                                                                        | Why                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forms            | None, fixed integer fils, or exact percentage; one active form                                                                        | Preserves prototype amount/percentage alternatives without adding them together. Zero is explicit.                                                                                                      |
| Percentage basis | Gross Primary Supplier Cost, independently of Supplier allowance                                                                      | Follows the prototype's gross-subtotal percentage calculation and the brief's existing gross discount engine; composition is a documented engineering choice, not an explicit two-discount client rule. |
| Net              | Gross minus the separate Supplier allowance minus invoice offer                                                                       | Keeps the required facts separate and explainable. No expenses or settlement feature is added.                                                                                                          |
| Limits           | Nonnegative input, percentage at most 100%, combined reductions cannot exceed gross                                                   | Refuse invalid combinations rather than clamp away the requested amount.                                                                                                                                |
| Precision        | At most six decimal places for percentages; integer fils for fixed amounts                                                            | Matches existing exact rate contracts and storage.                                                                                                                                                      |
| Rounding         | Round the invoice offer once, half away from zero to integer fils                                                                     | Uses the current exact money working default; never binary floating point or per-row accumulated rounding.                                                                                              |
| Row shares       | Largest remainder, ties by original line order, weighted by row cost remaining after Supplier allowance                               | Shares reconcile exactly without creating negative row net costs; the offer percentage basis and inventory valuation remain gross.                                                                      |
| Accounting       | No change to gross WAC, COGS, Supplier primary-balance basis or existing gross cash/payable posting                                   | These boundaries are already confirmed. The offer changes the informational discounted-cost snapshot. No M3 settlement or new allowance journal policy is invented.                                     |
| Corrections      | Percentage retains its saved rate/basis/rule and recalculates corrected gross; fixed amount remains fixed unless explicitly corrected | Preserves the meaning of the selected input form. Record offer and discounted-cost Deltas; original snapshots remain unchanged.                                                                         |
| Future changes   | Explicit per-document version and immutable exact results                                                                             | A new default can apply to new invoices without silently changing previous invoices. Unsupported versions fail explicitly; no compatibility adapter for obsolete application paths.                     |

Worked examples, all exact:

- Gross 1,000,000 fils, Supplier allowance 10% = 100,000, extra offer 5% =
  50,000: discounted cost **850,000 fils (850 IQD)**; gross valuation/liability
  basis stays 1,000,000.
- Same gross/allowance, fixed offer 50,000: also 850,000. No offer: 900,000.
- Three 1-fil rows, no allowance, offer 50%: invoice offer 2 fils, discounted
  total 1 fil, shares 1/1/0 in line order.
- Correct gross 1,000,000→2,000,000: 5% offer becomes 100,000; a fixed 50,000
  offer stays 50,000 unless explicitly corrected. Neither rewrites the original.

## Completion record

1 October 2026: implemented the independent typed input, explicit rule 1 and
exact immutable snapshots in Contracts, PostgreSQL migration 0030, Purchasing,
Adjustment and Desktop. The API calculates and validates all financial results;
the renderer only converts an entered IQD amount exactly to integer fils.

Drafts persist input and rule through restart. Post stores exact header and row
offer results. Review and print use saved facts. Adjustments inherit the current
saved input, compare before/after offer facts, bind them into the confirmation
hash, record the Delta/audit and preserve the original. Offer-only corrections
create no Inventory or Supplier payable effect. Gross cash/debt journal amounts
and mapping/template version 1 remain unchanged; their reconciliation now
includes the informational offer.

The additive migration retains historical costs, role revisions, original
idempotency payloads and request hashes. It derives a single stored current
receipt projection in PostgreSQL; runtime replay reads that column. No old
application input, optional-field fallback or dual-read adapter is retained.
New receipts preserve their current payload exactly. Draft rule changes and
offer changes while closing a draft are blocked.

The production Purchasing footer and Adjustment use the prototype's adjacent
percentage/amount alternatives and existing totals/review geometry. The
prototype source remains visual evidence. Styles are scoped to offer controls
inside Purchasing/Adjustment. No global rule, shell, accepted row loop or Quick
Product handler was changed. Unsaved offer edits are retained and cannot Post;
Post is blocked while the header save is in progress. Invalid combinations show
localized recovery without silently clamping or losing the entered value.

See [verification record](README.md), [separate checkpoint](manual-checkpoint.md)
and [brief Arabic report](report-ar.md). This candidate is not G-01 professional
approval or all-repository/release proof. The separate checkpoint records T04
PASS; its local commit and T05 follow the full verification gate. No push, PR
or merge is authorized.
