# ADR-008: Tenant Isolation

- Status: **Proposed — Phase 0 review**
- Date: 2026-08-05
- Decision owners: Cloud / security / identity
- Related: REQ-SYN-003, R-011

## Context

The cloud serves multiple subscribing pharmacies and may hold operational, accounting, patient, message, and subscription data. The prototype's “any authenticated staff” policies and missing tenant keys are not safe. Background jobs, object storage, logs, cache, and sync are as important as HTTP queries.

## Proposed decision

- Tenant context is established only from verified identity/device/service credentials, never accepted from an untrusted body/query field.
- Every tenant-owned cloud record carries an immutable `tenant_id` with database constraints and tenant-scoped uniqueness/indexes.
- Application repositories require tenant context; raw cross-tenant queries are isolated to explicit audited Super Admin/support capabilities.
- PostgreSQL row-level security or equivalent DB enforcement provides defense in depth in addition to NestJS guards/repository filters.
- Jobs, inbox/outbox, caches, rate limits, object keys, exports, logs, metrics, backups, and AI/provider calls preserve tenant context.
- Cross-tenant automated tests attempt read/write/list/export/sync leakage for every new module.
- Local databases initially hold one tenant but retain tenant identity on sync/audit envelopes to prevent misrouting.

## Alternatives considered

- Application filters only: easy to omit and insufficient defense for jobs/admin queries.
- Separate database per tenant: stronger physical isolation, but higher provisioning/migration/operations cost at the expected initial scale.
- Schema per tenant: similar operational complexity and poorer shared migration ergonomics.

## Consequences

- Positive: shared cloud infrastructure with multiple independent enforcement layers.
- Negative: every key/query/job/contract requires tenant-aware design; privileged support tooling must be deliberately narrow.

## Future review trigger

Regulatory, large-enterprise, or scale requirements may justify database-per-tenant tiers in a new ADR; this proposal does not preclude them.
