# ADR-009: Synchronization Model

- Status: **Accepted**
- Date: 2026-08-05
- Decision owners: Synchronization / domain leads / cloud
- Related: REQ-SYN-001–010, REQ-SAL-011–012, Q-011, R-009, R-009A, R-010

## Context

Free local operation has no cloud. Paid basic service uploads data for cloud viewing. Higher tiers may later edit/synchronize in both directions. Network interruption, retry, duplicate delivery, schema evolution, device clock, and tenant routing must not duplicate or overwrite business postings.

## Proposed decision

### Accepted baseline if Phase 0 is approved

- Business transaction and local outbox envelope commit atomically.
- A background worker uploads versioned integration events with event ID, tenant, source device/node, aggregate ID/version, occurred/recorded time, schema version, correlation and idempotency data.
- Cloud inbox deduplicates and applies tenant/entitlement checks before updating read projections, then returns a durable checkpoint.
- Delivery is at-least-once; handlers are idempotent and replay/testable. Ordering is guaranteed only within an explicitly named aggregate/stream where needed.
- Payload schemas are backward-compatible/versioned and avoid secrets or unnecessary health data.
- Backlog, poison/dead-letter events, last checkpoint, lag, and provider/cloud failures are visible and supportable.

### Tier boundary

- Free: sync worker/capability disabled; local operation unaffected.
- Basic paid: local-to-cloud only; cloud is a view/projection and cannot author changes to local operational records.
- Higher/future: two-way editing remains outside Basic and may be implemented only for the approved Q-011 ownership, command, conflict, deletion, authorization, and draft-price boundaries.

### Approved higher-tier ownership/command boundary

- Posted sales, purchases, returns/reversals, stock/batch movements, payments/Cash Boxes, and journals remain local-authoritative. Cloud may store/view/report/back up, never directly edit/delete/replace/overwrite. Correction is a new approved local transaction.
- A versioned Field Ownership Matrix allows only named catalog/pricing, supplier, patient-CRM, reminder/template, or setting fields to receive cloud commands. Stock/carrying cost/batch balances/posted values remain protected.
- Plans, subscriptions, feature entitlements, signed licences, provider/service configuration, and cloud operational metadata remain cloud-authoritative; local cannot elevate cached rights.
- Cloud edits are unique, expiring, idempotent commands. Local validates identity, permission, entitlement, tenant/device licence, entity/field, expected version, and business rules before applying and acknowledging.
- Offline commands remain Pending. Supported terminal states are Applied, Rejected, Conflict, Expired, and Cancelled; cloud never reports Applied before local acknowledgement.
- Price commands affect future transactions only. Posted snapshots/history/accounting remain immutable. Existing drafts follow the approved draft-price policy below.
- Referenced records use locally validated archive/deactivation/controlled deletion, never direct cloud hard delete.
- Audit retains command ID, requester, pharmacy/device, entity/record/field, previous/requested values, request/execution times, local result/reason, and final status.

### Approved conflict-resolution boundary

- An expected-version mismatch creates a conflict when the local record changed after the cloud observed its base version. Breev preserves the Base value/version, Current Local value, and Requested Cloud value; it never resolves by automatic overwrite or timestamp order.
- Only the pharmacy owner or a trusted user with `sync.conflict.resolve` may resolve a conflict.
- The permitted actions are: Keep Local; Apply Requested as a new locally validated change; or Merge only independent fields explicitly marked mergeable by the Field Ownership Matrix. Competing values for the same atomic field, such as selling price, require an explicit selection and cannot be mathematically or automatically merged.
- Applying or merging rechecks identity, permission, entitlement, pharmacy/device, newest record version, business rules, and field editability. If the record changed again during review, the resolution must be revalidated against the newest version and cannot apply a stale decision.
- Posted transactions, stock movements, payments, Cash Boxes, and journals are outside general conflict merging and retain their approved return/reversal/adjustment/correcting-entry workflows.
- Every conflict has a unique conflict ID linked to the original command ID. Idempotency prevents duplicate detection or repeated resolution.
- The conflict audit preserves conflict/command IDs, Base value/version, Current Local value, Requested Cloud value, selected resolution, final value, before/after record versions, resolver, reason, request/detection/resolution times, and validation result.
- Cloud retains status Conflict until local validation and acknowledgement. An unresolved command may expire under an approved retention policy, but its conflict and audit history remains available.

### Approved existing-draft price boundary

- Every draft line preserves its selected selling price, price version, pricing source, and capture time. A later change never silently rewrites the line or draft total.
- On resume and again before checkout, a stale line is marked `Price changed` and shows draft price, current validated price, difference, and current version. Refresh to current price is the default; a multi-line refresh first summarizes affected lines and total change.
- Keeping the draft price is a controlled override requiring a named permission such as `draft.price.override` and mandatory reason. Audit retains draft/line/product IDs, previous/current/final prices, difference, previous/current versions, authorizer, reason, and authorization time.
- Posting revalidates the newest price version. A later price change invalidates stale review/authorization and requires a new decision where applicable.
- Standard, promotional, customer/contract price-list, and manual-override sources/versions remain distinct. Expired promotions or entitlements are revalidated under their own pricing rules.
- Draft preservation applies only to commercial selling price. Posting always revalidates stock, batch, expiry/recall/quarantine/sale blocks, product eligibility, prescription/business restrictions, taxes, and posting rules.
- A remembered proposed/reserved batch cannot force an invalid batch. Breev allocates a valid alternative under the approved stock policy or stops the line for review.
- Inventory carrying cost and COGS use the valid WAC/FIFO/company method at posting; a draft never imposes stale accounting cost.
- Posted invoice price, discount, tax, total, cost, and accounting snapshots remain immutable.

The stakeholder approved the ownership/command, conflict, and existing-draft price boundaries on 2026-08-06.

## Alternatives considered

- Periodic table dumps: simple but poor resumability, deletion semantics, audit, and bandwidth.
- Database replication: couples schemas/infrastructure and does not enforce business entitlements/conflicts.
- Generic last-write-wins: unsafe for offline financial, stock, consent, and identity records.
- Exactly-once claims: unrealistic across network boundaries; idempotent at-least-once is testable.

## Consequences

- Positive: reliable basic cloud views without making cloud part of local transaction availability.
- Negative: integration schemas and projections must be maintained; backlog/storage/observability become product concerns.
- Prohibition: do not use device wall-clock as the sole conflict or subscription authority.
