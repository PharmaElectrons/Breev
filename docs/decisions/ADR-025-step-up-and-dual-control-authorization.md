# ADR-025: Step-Up and Dual-Control Authorization

- Status: **Accepted provisionally — exact thresholds and accountant/legal review remain required when affected workflows are implemented**
- Date: 2026-08-06
- Decision owners: Product / identity / security / accounting / pharmacy operations
- Related: REQ-IAM-014–021, Q-023, ADR-005, ADR-006, ADR-009, ADR-013, ADR-017, ADR-024, R-013, R-030

## Context

Breev's pharmacy users need fast ordinary sales, but a few actions can change money, stock, authority, privacy, or historical evidence. A job title alone is too vague: authorization must be named, server-enforced, revalidated, and usable offline without shared accounts. Step-up authentication and dual control reduce mistakes and collusion risk while preserving a practical workflow for a small pharmacy.

## Decision

### Canonical controls

- **Step-up authorization** means the already signed-in user re-authenticates immediately before a sensitive action and holds the named permission. It does not grant a missing permission or bypass an entitlement.
- **Dual control** means one user prepares a request and a different authorized user approves it. The initiator cannot approve their own request; shared credentials are prohibited. Both users may be local and offline.
- Every sensitive request has a unique ID, bounded expiry, reason, evidence where required, current-record/version snapshot, actor/device, Trusted Breev Time, and final outcome. Approval is revalidated against the newest state; stale approval is rejected and must be recreated.
- UI hiding is convenience only. The local API, domain transaction, job, sync, and export boundary enforce the same permission and approval rules.

### Provisional action matrix

- Price below cost or exceptional discount: named step-up permission such as `pricing.below_cost`; threshold values are versioned and accountant/product-owner reviewed.
- Negative stock: remains a hard block. An authorized manager may post a counted adjustment with reason/evidence before the preserved sale continues; approval does not authorize negative stock.
- Backdating: owner/accountant step-up, open-period check, impact preview, reason, deterministic recalculation, and audit. Closed periods remain blocked.
- Posted reversal/correction: named permission, re-authentication, reason, immutable linked correction, and printable evidence. No-invoice returns require additional elevation/evidence; high-risk cases may require dual control.
- Patient or bulk export: verified identity/authority plus step-up; health-data or high-volume export uses dual control by default.
- User, role, licence, or terminal changes: owner/trusted-admin permission and step-up; granting high privileges, changing the last owner, or releasing a seat uses dual control.
- Manual journals: one authorized preparer and a different authorized accountant/owner approver before posting.
- No generic emergency bypass is included. Any exception is a separately approved policy with its own expiry, scope, and review.

## Alternatives considered

- Trust job titles such as “manager”: rejected because titles vary and do not define a precise permission.
- Use one owner password for everything: rejected because it creates shared-secret, attribution, and collusion risk.
- Require dual control for every ordinary sale: rejected because it would make fast offline POS impractical; ordinary sales still use normal permissions and atomic rules.
- Approve once and apply later: rejected because stock, price, record version, entitlement, and accounting context can change.
- Let UI-only approval protect actions: rejected because API/jobs/imports/sync/export can bypass screens.

## Consequences

- Positive: high-impact actions remain attributable and reviewable, offline pharmacies can use two local accounts, and ordinary cashier flow stays fast.
- Negative: owner/accountant role design, approval inboxes, re-authentication, expiry, audit storage, and offline two-person coordination add workflow and support complexity.
- Phase gates: implement the permission vocabulary and negative tests in Phase 2; apply financial controls in Phases 4–6, privacy/export controls in Phases 7/10, and certify all cross-boundary behavior before production release.
