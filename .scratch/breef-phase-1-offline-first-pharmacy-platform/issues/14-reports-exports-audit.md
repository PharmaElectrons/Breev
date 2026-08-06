# 14 — Reports, exports, and audit experience

**What to build:** Owners, accountants, and authorized staff can inspect consistent operational and financial reports, export approved data safely, and trace important actions without reports mutating business records.

**Blocked by:** 06 — Accounting ledger and posting engine; 07 — POS sales and continuous Cash Box; 09 — Patient Profiles, consent, and bounded clinical boundary; 11 — One-way local-to-cloud synchronization.

**Status:** ready-for-agent

- [ ] Profit and Loss, Trial Balance, sales, purchases, inventory, COGS, cash, payables, receivables, and expiry reports reconcile to authoritative ledger/movement sources.
- [ ] Reports are read-only and cannot invent journal entries, rewrite posted transactions, or mutate inventory.
- [ ] Filters, date/source snapshots, Arabic/English rendering, print, and approved export formats are complete and accessible.
- [ ] Patient, health, bulk, and sensitive exports verify scope and authority and apply step-up or dual-control policy.
- [ ] Audit views expose actor, device, reason, approval, time, source, correction, sync, provider, and retention evidence without unnecessary sensitive payloads.
