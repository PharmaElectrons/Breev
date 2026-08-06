# ADR-006: Money Representation and Rounding

- Status: **Accepted — accountant validation examples pending**
- Date: 2026-08-05
- Decision owners: Accounting / product / platform
- Related: REQ-SAL-010, Q-004, R-007

## Context

Binary floating point and scattered rounding rules will make invoice totals, inventory cost, journal lines, printed receipts, and synchronized projections disagree. The scaffold says “whole dinars or minor units,” which is not a decision. IQD operational practice, taxes, percentage discounts, supplier discounts, and future currencies require explicit examples.

ISO 4217's maintenance record assigns IQD minor-unit 3 (1 dinar = 1,000 fils), while the Central Bank of Iraq's current circulated-banknote page lists 250 IQD as the smallest circulating banknote. Therefore internal calculation precision and physical cash rounding must be modeled separately.

## Decision

- Use an immutable Money value carrying currency and a signed integer number of fils for IQD (`1 IQD = 1,000 fils`); never use JavaScript/SQL binary float for money. The stakeholder approved this on 2026-08-05.
- Use exact decimal/rational intermediates for percentage allocation and weighted cost, then round only at named policy boundaries.
- Do not round line or invoice totals merely for display. Keep sales, purchases, tax, discounts, payments, and journal amounts exact in fils; weighted-cost and allocation intermediates may retain higher exact precision until a named posting/allocation boundary.
- Cash rounding is disabled by default. If physical tender requires an adjustment, model it as a separate visible cash-settlement amount with an approved ledger account; never hide it inside unit price, inventory cost, COGS, tax, discount, or line revenue.
- Centralize any approved rounding mode and scale per operation: unit price input, discount allocation, tax, cash settlement, inventory acquisition allocation, COGS, and journal posting.
- Preserve source amount/rate and resulting rounded allocation for audit where rounding occurs.
- Allocate remainder deterministically so lines reconcile exactly to document and journal totals.
- Reject cross-currency arithmetic until a separate multi-currency decision exists.

## Alternatives considered

- SQL/JS decimal strings everywhere: exact but easy to misuse without a value type and policy.
- Floating point with display rounding: simple, financially unsafe.
- Whole IQD integer universally: may be correct operationally, but is not confirmed for costs/tax/percentage allocation and would block future currency support.

## Consequences

- Positive: deterministic totals across local, cloud, print, and replay.
- Negative: all boundaries need explicit parsing/formatting and golden test cases; valuation calculations may require higher internal precision than displayed money.

## Blocking details

The stakeholder approved the accuracy-first rounding policy on 2026-08-05. Before accounting implementation, accountant-approved golden examples must validate line/document discounts, tax inclusion, refunds, allocation remainders, weighted cost, and the separate cash-settlement adjustment.

## Primary references

- [ISO 4217 Maintenance Agency amendment 102 — IQD minor unit 3](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/amendments/dl_currency_iso_amendment_102.pdf)
- [Central Bank of Iraq — circulated banknotes](https://cbi.iq/page/89)
