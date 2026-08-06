# ADR-005: Identifier and Human Document Numbering

- Status: **Accepted — Iraqi accountant/legal validation pending**
- Date: 2026-08-05
- Decision owners: Architecture / product / accounting
- Related: REQ-ARCH-009, Q-005A, Q-005B, R-008

## Context

Records are created offline and later synchronized. Database auto-increment keys are unsafe as cross-device/global identity. Users and legal/accounting workflows still need readable sales, purchase, return, reversal, amendment, subscription, and journal references. The scaffold prematurely selected a pharmacy/device/year format without evidence for reset, gaps, or correction series.

## Decision

- Every sync-capable entity has an application-generated UUIDv7 identity.
- The global ID is never displayed as the ordinary invoice number and never changes.
- Human document numbers use one sequence per pharmacy, document type, and calendar year, allocated transactionally by the one local API. The approved initial formats are `S-YYYY-NNNNNN`, `P-YYYY-NNNNNN`, `SR-YYYY-NNNNNN`, `PR-YYYY-NNNNNN`, `RV-YYYY-NNNNNN`, and `J-YYYY-NNNNNN`; no device prefix is needed in the current single-local-authority topology.
- A uniqueness constraint covers the approved scope. Sequence allocation occurs transactionally on the local authority.
- Gaps are tolerated and audited; numbers are never silently reused after a failed/voided issue.
- Returns, reversals, and amendments retain their own IDs/numbers and link to the original document.
- Posting a reversal requires re-authentication and the named `sales.invoice.reverse` permission, assigned to the owner by default and delegable only to a trusted manager; actor, approver, reason, device, time, and printable slip are retained.
- Pharmacy-sales and SaaS-subscription invoices use separate numbering domains.

The stakeholder approved this model on 2026-08-05. Final format and retention treatment remain subject to Iraqi accountant/legal validation before production.

## Alternatives considered

- Auto-increment primary key as public number: collisions/leaks implementation and prevents reliable merge.
- Random UUID displayed to cashiers: unique but operationally hostile.
- One global cloud sequence: unavailable offline.
- Hard-coded pharmacy/device/year prefix: plausible, but cannot be accepted before Q-005 and local legal/accounting review.

## Consequences

- Positive: synchronization identity and human/legal numbering can evolve independently.
- Negative: offline numbers may not be globally consecutive; support/receipt UX must show issuing context and correction links.

## Validation details

Before schema/formatter implementation, Iraqi accountant/legal review must validate prefixes, length, reset, gap/void reservation treatment, number timing, reprint wording, and any fiscal rules. The approved correction and permission chain remains mandatory.
