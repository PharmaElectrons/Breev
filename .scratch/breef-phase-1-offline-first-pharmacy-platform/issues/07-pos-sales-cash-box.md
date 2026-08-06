# 07 — POS sales and continuous Cash Box

**What to build:** A cashier can create, resume, and post a fast offline sale through the local application boundary, with inventory, payment or receivable, journal, Cash Box, audit, and synchronization effects committed atomically.

**Blocked by:** 03 — Subscriptions, entitlements, licences, and Free Core fallback; 05 — Purchasing, batches, expiry, inventory, and valuation; 06 — Accounting ledger and posting engine.

**Status:** ready-for-agent

- [ ] A durable sale Draft Invoice survives navigation, interruption, restart, and recoverable validation errors.
- [ ] Barcode and keyboard-first entry supports product, unit, quantity, price, discount, and optional Patient Profile attachment.
- [ ] Posting revalidates permissions, entitlement, stock, expiry, price, money, and safety rules before one atomic transaction.
- [ ] Posted sales preserve transaction-time product, unit, price, discount, batch, customer, payment, journal, Cash Box, audit, and outbox snapshots.
- [ ] Printer, scanner, and cash-drawer failures report physical outcomes without replaying or reversing the posted sale.
- [ ] Core sale performance, Arabic/English focus order, keyboard operation, and accessible status feedback meet the approved provisional targets on certified hardware.
