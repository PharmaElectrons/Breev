# T04 source review — what the project already answers

30 September 2026. Read-only investigation after accepted T03 commit `1256dcd`.
No production code, prototype, requirement authority, approval status, or GitHub
issue was changed during this review.

The project answers the basic accounting and history rules. My earlier explanation
grouped those settled rules too closely with the genuinely missing offer rules.
The remaining T04 decision is narrower than reapproving Purchasing accounting.

## Written answers already present

| Question                                                         | Finding                                                                                                                                                                                                                                                                                                             | Direct evidence                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is the Supplier allowance percentage applied to?            | **Gross purchase total.** This is explicit, not a guess. It answers the existing Supplier allowance; it does not specify the additional offer's basis when both exist.                                                                                                                                              | Project brief, page 11, line 351: [automatic discount engine](../../../docs/requirements/project-breif/project-breif.md). Current exact implementation: [purchase-costs.ts](../../../apps/local-api/src/purchasing/purchase-costs.ts), lines 127–132.                                         |
| Should discounted cost replace inventory cost?                   | **No.** Primary Supplier Cost remains the basis for inventory valuation, WAC/average cost, COGS and the Supplier's primary accounting balance. Discounted cost is informational. No new decision is needed about that boundary.                                                                                     | Brief pages 49/67, lines 1488–1506 and 2016; [scope §6.2](../../../docs/requirements/breev-phase1-mvp-scope.md), lines 364–366; [client clarification](../../../docs/requirements/client-chat.md), lines 343–363; [domain](../../../docs/domain.md), line 22.                                 |
| Is an extra invoice offer required?                              | **Yes in the current M2 requirements.** The brief explicitly requires an additional invoice-specific offer. The earlier scope says “may support”; the governing domain and later M2 completion task make it required and separate from the Supplier allowance snapshot.                                             | Brief page 52, line 1589; scope line 368; domain line 23; [M2-P02](../../../docs/milestone-2-scope-and-evidence-map.md), line 38; [#50](https://github.com/PharmaElectrons/Breev/issues/50), governing requirements; current [#198](https://github.com/PharmaElectrons/Breev/issues/198) T04. |
| Can Supplier/default changes recalculate old invoices?           | **No.** Keep the invoice-date allowance snapshot and historical calculated facts. Posted documents remain immutable.                                                                                                                                                                                                | Brief pages 50–52, lines 1523–1525; scope lines 362/548; domain lines 11–13 and 23.                                                                                                                                                                                                           |
| How should a posted invoice be corrected?                        | **A new linked, reasoned Delta-only Adjustment.** Never rewrite the original or count the whole invoice as another Purchase. The general mechanism is already settled.                                                                                                                                              | Brief pages 12–13 and 59–62; scope §6.3, lines 376–386; [#52](https://github.com/PharmaElectrons/Breev/issues/52). What remains unstated is the additional offer's input behavior inside that mechanism.                                                                                      |
| Does the 5,000 → 4,650 → 4,500 example explain an invoice offer? | **It explains a later settlement offer.** Five invoice allowances total 350; actual allowance at settlement is 500; difference 150; payment 4,500 clears gross liability 5,000. Original invoices, their 4,650 informational total and WAC stay unchanged. It supplies no two-discount invoice composition example. | Brief pages 53–58 and 73–74, especially lines 1593/2208/2234; client-chat lines 348–361; scope §§9.7–9.8; [#75](https://github.com/PharmaElectrons/Breev/issues/75), still open M3 work.                                                                                                      |

## What the prototype actually demonstrates

I read the relevant calculation, Supplier selection, Save, reload and saved-list
paths in [purchases.tsx](../../../design/prototype/src/routes/purchases.tsx), and
visually inspected the brief's [purchase screenshot](../../../docs/requirements/project-breif/assets/page010_img001.png)
and [settlement-voucher screenshot](../../../docs/requirements/project-breif/assets/page056_img001.png).

- Footer inputs are **discount percentage** and **discount amount**, followed by
  After Discount. They are two ways of expressing one discount, not two added
  discounts: entering a percentage sets the amount; entering an amount clears
  the percentage (lines 298–306 and 1400–1419).
- Percentage is computed against the **gross item subtotal**. Net subtracts the
  stored amount from gross (lines 291–305).
- Selecting a Supplier inserts its default percentage into those same controls
  (lines 1158–1162). There is no independently represented Supplier allowance
  plus additional invoice offer in that path.
- This is strong evidence for the existing input geometry and amount/percentage
  workflow. It is insufficient evidence for how two separately saved discounts
  combine. The 0–100 percentage clamp and nonnegative amount behavior belong to
  this single-discount prototype implementation; they do not decide combined
  offer limits.
- The prototype uses `Number` and `Math.round` on displayed IQD, not Breev's exact
  integer fils. Its Save insert supplies `total`, Supplier, notes, payment type
  and paid amount (lines 451–462), without separate allowance/offer input or
  snapshot fields. The reload path does not restore a separate offer form/rate.
  The saved list reads a single `inv.discount` (lines 1802–1814). Those paths
  cannot prove the required exact-money, immutable two-discount semantics.

For example, the prototype supports gross 1,000 with one 5% discount → 950.
It does not answer whether a **10% Supplier allowance plus a separate 5% offer**
must give 850 or 855. Gross-basis additional offer would give 850; applying it
after allowance would give 855. Those are alternatives, not approved results.

## Other project parts and the remaining gaps

The production cost calculator takes only `lines` and `allowancePercentage`.
It calculates allowance once on the invoice total and allocates that amount to
rows. The schema/contracts and posting templates inspected have no separate
invoice-offer input. Existing tests prove this single-allowance implementation,
not a missing offer rule. Sale Draft's separate fixed-fils invoice discount is
another domain's implementation, not approval for Purchase offer composition.

[money.ts](../../../apps/local-api/src/posting/money.ts), lines 211/235–251, defines
six-decimal rates, half-away-from-zero rounding and largest remainder with line
order as tie-breaker. Its comments explicitly call rounding/allocation engineering
defaults pending G-01. The [G-01 working-default pack](../../issue-59/gates/G-01-working-defaults.md)
opens with **OPEN** and says nothing below is approved. The
[approvals directory](../../issue-59/gates/approvals/README.md) contains only its
README. The 250/500/1,000-IQD settings concern selling-price rounding; they do
not settle discount rounding to posted fils.

The old [.scratch Purchasing spec](../../../.scratch/purchasing/spec.md) repeats
the single-allowance formula and settlement example, but adds no independent
invoice-offer calculation. It also retains obsolete selectable-costing-method
and upward-price-rounding wording; it cannot override the current scope/domain.
The completion plan and gap analysis identify the separate offer as missing
and instruct agents not to copy prototype arithmetic. Keyword searches across
the requirements, current docs, related evidence and local task plans revealed
no approved worked example combining the two invoice discounts.

Fresh read-only GitHub checks covered #49, #50, #52, #59, #63, #75, #189, #190
and #198, including available comments. No independent client/accountant approval
for the missing offer rules was found. #59 being closed does not supply the
absent approval artifact or override the explicit OPEN G-01 evidence. A forensic
report referenced in #190 at `docs/audit/18-purchases-lovable-alignment-report.md`
is absent from this checkout; its issue summary was inspected but is not an
offer-rule approval. My own earlier #198 comment is not independent evidence.

The unanswered details are:

1. **Two-discount composition:** additional percentage basis, application order,
   allowed combined range, and which forms the separately stored offer supports.
   Prototype suggests amount/percentage alternatives but models only one discount.
2. **Exact arithmetic policy:** approved percentage precision, tie rounding and
   any required row remainder allocation. Existing algorithms are ready working
   defaults, explicitly unapproved.
3. **Offer-specific Adjustment behavior:** whether an entered percentage keeps
   its saved rate/basis and recalculates against corrected quantity/cost, while
   a fixed amount stays fixed; which offer fields may be corrected. The general
   immutable/linked-Delta rule and gross valuation/liability basis need no
   reapproval. A new-offer golden posting must fit those confirmed boundaries.

## Original pre-code stop (historical)

There is a sequencing distinction worth making explicit. [Delivery](../../../docs/delivery.md),
line 3, and older #50/#52 tasks generally allow building under confirmed boundaries
and recorded defaults, with G-01 validation at milestone exit. They did not make
every unresolved G-01 item a universal implementation-start blocker.

The later, explicitly initiated [T04 prompt](../../../.scratch/milestone-2-phase-prompts/phase-1-purchasing-integrity.md),
lines 118–122, specifically requires sufficient offer rules before code and says
to prepare a decision request and stop if a material rule is missing. #198 repeats
that restriction. That specific instruction controls this continuation. The
remaining stop is for this offer's missing rules, not for reapproval of the basic
accounting policy or for repeating T03 manual tests.

See the narrowed [decision request](decision-request.md). This review has not
selected 850 versus 855, approved the rounding default, closed G-01, started T04
production changes or started T05 at the time of that review.

## Later stakeholder authorization

After this review, the stakeholder authorized proceeding with defaults that can
be changed later and requested a report of what was done and why. The selected
[working defaults](working-defaults.md) record that instruction and the versioned
future-change boundary. T04 implementation follows that authorization; the
earlier decision request is historical. This is engineering authority to proceed,
not accountant/legal approval or closure of G-01. T04's separate checkpoint and
pre-commit gate remain required. T05 has not started.
