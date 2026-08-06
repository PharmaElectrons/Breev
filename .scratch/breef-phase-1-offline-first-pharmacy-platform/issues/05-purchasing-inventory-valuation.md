# 05 — Purchasing, batches, expiry, inventory, and valuation

**What to build:** A buyer can post a manual purchase and the Pharmacy can maintain batch-aware inventory through auditable Stock Movements, expiry controls, counts, returns/write-offs, and the configured WAC/FIFO policy.

**Blocked by:** 04 — Catalog, naming, units, and Suppliers.

**Status:** ready-for-agent

- [ ] A durable Draft Invoice supports the confirmed entry order: item/barcode, quantity, cost, selling price, expiry, and next-row entry.
- [ ] Posting creates purchase snapshots, batches, Stock Movements, Supplier payable effects, audit evidence, and an outbox event atomically.
- [ ] Inventory quantities use canonical integer units; conversion and batch facts are snapshotted and historical values are not reinterpreted.
- [ ] Expired, recalled, and quarantined batches are blocked from allocation and daily/monthly review states are visible.
- [ ] Counts, supplier returns, write-offs, and destruction use dedicated reasoned movements rather than direct quantity edits or zero-price sales.
- [ ] WAC is the default and WAC/FIFO/Last Purchase Cost reference behavior, discounts, exact cost, and immutable carrying-cost snapshots have approved golden tests.
