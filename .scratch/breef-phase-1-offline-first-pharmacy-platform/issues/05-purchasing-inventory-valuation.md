# Epic 05: Post purchases into batch-aware inventory and immutable valuation

Type: epic
Status: needs-triage
Engineering phase: P4 — Purchasing/inventory
Blocked by: 04; final end-to-end purchase posting is blocked by the ledger core from 06
GitHub issue: #7
Parent GitHub specification: #2

## User Story

As a buyer and stock controller, I want a durable manual purchase workflow that atomically creates batch-aware stock and reviewed cost effects, so that receiving remains accurate, auditable, and available offline.

## Outcome

Deliver purchase Draft Invoices, confirmed keyboard entry order, supplier/batch/expiry/discount capture, atomic posting, append-only Stock Movements, allocation blocks, counts, supplier returns, write-offs/destruction, and approved WAC/FIFO/Last Purchase Cost reference behavior.

## Expected workflow

1. Buyer selects Supplier/date/reference and enters lines in Item/Barcode → Quantity → Cost → Selling Price → Expiry order; the Draft Invoice saves after meaningful changes and survives restart.
2. Unknown products/units/Suppliers open an explicit resolution flow without losing the draft.
3. Review shows exact unit conversion, discounts, totals, batches/lots/expiry, payable/cash preview, valuation preview, and validation errors.
4. Posting revalidates current permission, unit version, identifiers, duplicates, money/rounding, batch/expiry, and accounting prerequisites.
5. One local transaction creates Posted Purchase snapshots, batches, Stock Movements, payable/cash and journal effects, audit, and outbox exactly once.
6. Daily expiry evaluation and explicit quarantine/recall blocks prevent allocation. Counts/disposition create reasoned movements; no quantity field is edited directly.

## Invariants and failure behavior

- Draft failure remains recoverable; posted purchase failure rolls back every effect.
- Canonical on-hand uses integer Inventory Units and derives from append-only movements.
- Expired/recalled/quarantined stock is never allocated, including through direct API calls.
- Carrying Cost and valuation method are frozen on posted movements; Last Purchase Cost is not silently an accounting valuation method.

## Acceptance scenarios

- Given a valid offline purchase draft, when an authorized buyer posts it twice with the same idempotency key, then one purchase and one complete set of stock/accounting/audit/outbox effects exists.
- Given failure is injected after stock or payable preparation, when posting aborts, then no partial purchase, movement, batch, journal, audit, or outbox effect remains.
- Given a batch is expired, recalled, or quarantined, when allocation is attempted from UI or API, then it is rejected with its blocking reason.

## Planned child slices

- Purchase draft lifecycle/keyboard UI; totals and snapshots; batch model; atomic posting orchestration; inventory projection/allocation; expiry/recall/quarantine; counts; supplier return; write-off/destruction; WAC/FIFO golden cases and valuation policy.

## Gate and exclusions

- Accountant-approved discount/valuation examples and an approved operational-to-accounting posting contract are required. P4 may build/review the purchase draft, batch, movement, valuation, and transaction-orchestration boundaries, but the final Posted Purchase vertical slice cannot be accepted until Epic 06 supplies the balanced ledger core/template. OCR provider extraction belongs to Epic 12; the manual purchase path must be complete first.

## Traceability

- US-018–022, US-030–040; purchase/inventory/valuation requirements; ADR-006–007, ADR-010, ADR-012, ADR-025.
