# Epic 14: Reconcile read-only reports, controlled exports, and actionable audit evidence

Type: epic
Status: needs-triage
Engineering phase: P10 — Reports
Blocked by: 06, 07, 09, 11
GitHub issue: #16
Parent GitHub specification: #2

## User Story

As an authorized owner, accountant, or support user, I want reports and audit views that reconcile to authoritative records and exports that enforce scope, so that I can operate and investigate without mutating history or exposing unnecessary sensitive data.

## Outcome

Deliver sales, purchases, returns, inventory/expiry/valuation, COGS, Cash Box, AP/AR, Trial Balance, P&L and profit reports; Arabic/English filters/print; permissioned export jobs; patient/bulk/high-risk approvals; and linked audit timelines for business, authorization, sync, provider, recovery, and retention evidence.

## Expected workflow

1. User chooses a report and authorized Pharmacy/date/source/filter scope; the system records an as-of boundary where needed.
2. Query reads authoritative Posted Invoices/Stock Movements/ledger/Cash Box/projections without executing domain commands.
3. UI shows totals, source drill-down, data freshness, timezone/currency/valuation basis, empty/error/offline state, and reconciliation status.
4. Print/export preview states exact fields/records/format and privacy classification. Server rechecks permission, purpose, Tenant, Entitlement, retention, Step-Up/Dual Control, and newest state.
5. Export is generated durably, encrypted/revocable/time-limited where sensitive, and audited without logging its raw payload.
6. Audit viewer links actor/device/reason/approval/time/source/correction/sync/provider/outcome while applying field-level access/redaction.

## Invariants and failure behavior

- Reports/exports never create journals, rewrite documents, repair balances, or mutate stock.
- Financial reports reconcile to ledger; inventory reports reconcile to movements/valuation snapshots.
- Access to report UI does not imply export, patient, health, bulk, or support authority.
- Stale/partial/unavailable sources are labeled; data is never presented as complete silently.

## Acceptance scenarios

- Given approved golden transactions, when reports run for the same boundary, then Trial Balance balances and operational totals reconcile to their authoritative sources.
- Given an unauthorized direct export request, when executed, then it is rejected server-side and no file/object is produced.
- Given a sensitive authorized export link expires or is revoked, when accessed, then content is unavailable and access/revocation evidence remains audited.

## Planned child slices

- Reporting query/read model; sales/purchase/return; inventory/expiry/valuation; Cash Box/AP/AR; Trial Balance/P&L; filters/drill-down/print; ordinary exports; sensitive export approval/delivery; audit timeline/redaction; reconciliation/accessibility/performance suite.

## Gate and exclusions

- Stable source schemas/posting matrix and ADR-017/025 export rules required. Reports are not a substitute for correcting inconsistent source records.

## Traceability

- US-067–070, US-091, US-096, US-098; report/export/audit requirements; ADR-010, ADR-017, ADR-022, ADR-025–027.
