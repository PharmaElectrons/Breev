# Epic 06: Produce balanced, traceable accounting from operational events

Type: epic
Status: needs-triage
Engineering phase: P6 — Accounting
Blocked by: 04 and approved operational posting contracts; does not require Epic 05 to be complete
GitHub issue: #8
Parent GitHub specification: #2

## User Story

As an accountant, I want every approved pharmacy transaction to create balanced immutable journal effects from reviewed posting rules, so that Trial Balance, profit, payables, receivables, cash, inventory, and COGS reconcile.

## Outcome

Deliver exact IQD Money, Chart of Accounts, versioned posting templates/matrix, journal entries/lines, AP/AR, allocation, continuous Cash Box accounting, manual journals, accounting periods, backdating controls, Trial Balance, and P&L source queries.

## Expected workflow

1. Accountant reviews/activates a Chart of Accounts and signed posting matrix using exact fils and explicit rounding.
2. Operational posting requests carry source ID/type, immutable facts, actor/device/time, and idempotency context.
3. Accounting previews the selected template and verifies debit equals credit before the enclosing business transaction commits.
4. Posted journals are immutable and traceable back to source. Corrections use new linked entries through Return/Reversal/correcting workflows.
5. Supplier payables/customer receivables accept controlled payments/allocations without overwriting original source debt.
6. Manual journals/backdating/period changes require named permission, reason, Step-Up/Dual Control as configured, newest-state checks, and audit.

## Invariants and failure behavior

- Binary floating point is prohibited for money; unbalanced journals never post.
- Reports query ledger facts and never create/repair journal entries as a side effect.
- One source/idempotency reference cannot produce duplicate journal effects.
- A closed period or stale approval rejects before mutation; self-approval is prohibited where Dual Control applies.

## Acceptance scenarios

- Given each accountant-approved golden sale/purchase/return/reversal/cash scenario, when posted, then exact debits equal credits and expected balances/COGS/profit reconcile.
- Given an unbalanced or unknown posting template, when a business command executes, then the entire enclosing transaction fails with no partial operational effect.
- Given a stale/self-approved manual journal request, when execution is attempted, then it remains unposted and the rejection is audited.

## Planned child slices

- Exact Money/rounding; Chart of Accounts; journal core; versioned posting templates; purchase/inventory templates; sale/COGS templates; Cash Box; AP/AR/allocation; periods/backdating; manual journals/approvals; Trial Balance/P&L queries; golden reconciliation suite.

## Gate and exclusions

- Requires a signed accountant/product-owner posting matrix, exact examples, and reviewed purchase/sale fact contracts. The ledger core and templates may start after those contracts stabilize; they do not wait for completed purchase/sale UI. Final purchase and sale posting acceptance then integrates this epic atomically. External payment settlement and official e-invoice accounting remain separately gated.

## Traceability

- US-059–070; accounting/money requirements; ADR-006, ADR-010, ADR-021, ADR-025.
