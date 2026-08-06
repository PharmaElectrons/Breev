# 11 — One-way local-to-cloud synchronization

**What to build:** A Pharmacy can synchronize allowed local records to a Tenant-isolated cloud projection with durable, idempotent, observable delivery, while cloud users cannot overwrite local posted facts.

**Blocked by:** 03 — Subscriptions, entitlements, licences, and Free Core fallback; 05 — Purchasing, batches, expiry, inventory, and valuation; 06 — Accounting ledger and posting engine; 07 — POS sales and continuous Cash Box; 10 — Additional POS Terminal pairing and revocation.

**Status:** ready-for-agent

- [ ] Local operational transactions append versioned, tenant-bound outbox envelopes atomically with their business effects.
- [ ] A sync worker delivers envelopes with idempotency keys, retries safely, records durable acknowledgements, and advances checkpoints.
- [ ] Cloud ingestion enforces Tenant context, deduplication, authorization, projection rules, and cross-tenant isolation.
- [ ] Backlog, failure, retry, outage, resume, and reconciliation states are visible without exposing unnecessary patient data.
- [ ] Initial synchronization is strictly local-to-cloud/view-only; cloud commands cannot mutate local posted sales, inventory, Cash Box, or journal facts.
- [ ] Replay, duplicate delivery, out-of-order delivery, and cloud outage tests prove no duplicate or lost business effects.
