# Epic 11: Synchronize local facts into Tenant-isolated cloud views exactly once

Type: epic
Status: needs-triage
Engineering phase: P9 — Cloud/subscriptions/sync
Blocked by: 03, 05, 06, 07, 10; cloud operations gate
GitHub issue: #13
Parent GitHub specification: #2

## User Story

As a pharmacy owner, I want allowed local records copied durably into Tenant-isolated cloud views, so that I can inspect remote information without cloud edits overwriting authoritative pharmacy facts.

## Outcome

Deliver transactional local outbox envelopes, checkpointed/retrying sync worker, authenticated Tenant-bound ingestion/inbox deduplication, versioned projections, acknowledgement/reconciliation, backlog/health visibility, privacy minimization, and strict one-way/view-only behavior.

## Expected workflow

1. An approved local business transaction appends a versioned Tenant-bound envelope in the same commit as its business effects.
2. Worker reads after durable checkpoint, checks current Entitlement/privacy rules, and sends an idempotency key plus versioned payload.
3. Cloud authenticates installation/service, derives Tenant context, validates schema/authorization, deduplicates inbox key, and applies only the permitted projection.
4. Cloud returns durable acknowledgement; local worker advances checkpoint and retains diagnostic state under policy.
5. Offline/cloud outage creates visible backlog with safe exponential retry. Resume delivers from the last durable checkpoint.
6. Reconciliation detects missing/poisoned/stuck envelopes without fabricating or directly editing local business facts.

## Invariants and failure behavior

- Initial Basic sync is local-to-cloud and view-only; cloud cannot mutate Posted Invoice, Stock Movement, payment/Cash Box, or journal facts.
- Duplicate, replayed, late, or out-of-order delivery cannot duplicate business/projection effects.
- Cross-Tenant keys/records/jobs/logs/exports are rejected under verified context.
- Patient/health fields are absent unless explicitly approved and minimum necessary.

## Acceptance scenarios

- Given a local posting rolls back, when outbox is inspected, then neither business effect nor sync envelope exists.
- Given the same envelope is delivered repeatedly and out of order around an outage, when cloud processes it, then one correct projection and durable acknowledgement results.
- Given a forged Tenant or cloud edit attempt, when processed, then it is rejected and no local or other-Tenant state changes.

## Planned child slices

- Envelope/version contracts; transactional outbox adapter; worker/checkpoints/retry; cloud inbox/auth/dedup; projections; acknowledgement/reconciliation; status UI/operations; tenant isolation/privacy suite; outage/replay/performance tests.

## Gate and exclusions

- Requires Phase 2 provider/location/DPA/support decision revalidated before P9. Two-way commands/conflict resolution are future higher-tier work, not hidden in this epic.

## Traceability

- US-093–096; synchronization/cloud/NFR requirements; ADR-008–009, ADR-013, ADR-017, ADR-022.
