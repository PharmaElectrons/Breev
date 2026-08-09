# Epic 07: Complete fast offline POS sales and continuous Cash Box posting

Type: epic
Status: needs-triage
Engineering phase: P5 — Sales/cash
Blocked by: 03, 05, 06
GitHub issue: #9
Parent GitHub specification: #2

## User Story

As a cashier, I want to scan, review, and post a recoverable sale quickly while offline, so that the customer is served once and stock, payment/debt, Cash Box, accounting, audit, and history always agree.

## Outcome

Deliver durable sale Draft Invoices, keyboard/barcode search, unknown-item resolution, unit/quantity/discount/Patient attachment, price snapshots/revalidation, atomic posting, cash/approved receivable capture, immutable receipt/reprint, continuous Cash Box entries, and hardware-safe output.

## Expected workflow

1. After sign-in, POS is primary. Cashier scans/searches; exact barcode adds a line and focus returns for rapid entry.
2. Unknown barcode offers explicit quick product creation or cancellation without losing the basket. Product detail side panel does not replace the sale.
3. The draft saves durably and supports unit, quantity, permitted discount, optional Patient Profile, cash/approved receivable, and remove/undo.
4. Checkout shows totals and revalidates permission, Entitlement, current price/version, stock/allocation, expiry/recall/quarantine, safety, money, and required identity/basis.
5. One idempotent transaction posts invoice snapshots, stock, payment/debt, Cash Box, journal, audit, and outbox exactly once.
6. Only after commit does Breev print/open drawer. Failure shows physical status and allows audited snapshot reprint without replaying sale.

## Invariants and failure behavior

- Ordinary Anonymous Sale remains allowed unless identity is genuinely required.
- Invalid/stale checkout preserves the draft and explains line-specific recovery.
- Draft Price Snapshot can be refreshed; keeping stale price requires named permission/reason.
- No forced shift open/close is a sale prerequisite; Cash Box is continuous.

## Acceptance scenarios

- Given internet is unavailable and valid local stock exists, when a cashier posts a sale, then every required effect commits exactly once within the approved performance boundary.
- Given stock/price/batch changes after draft save, when checkout occurs, then current facts are shown/revalidated and an invalid draft remains editable rather than forcing stale data.
- Given printing or drawer opening fails after commit, when retried, then invoice/journal/stock/cash are not replayed and an audited reprint/manual recovery path is offered.

## Planned child slices

- Draft lifecycle; search/barcode/unknown item; line editing and price snapshots; checkout/payment selection; atomic posting; receipt/reprint; continuous Cash Box movements/reconciliation; accessible keyboard flow; hardware failure adapters; performance/failure suite.

## Gate and exclusions

- Requires stable catalog/inventory/accounting/entitlement and approved numbering/price/discount/action rules. External electronic payments are excluded.

## Traceability

- US-041–055, US-059–060; sales/cash/performance requirements; ADR-005–007, ADR-010, ADR-013, ADR-021, ADR-023, ADR-025, ADR-027.
