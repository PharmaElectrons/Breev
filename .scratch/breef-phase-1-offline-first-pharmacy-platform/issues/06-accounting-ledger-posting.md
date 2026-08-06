# 06 — Accounting ledger and posting engine

**What to build:** The Pharmacy has a balanced double-entry ledger that receives controlled postings from operational transactions and supports Chart of Accounts, payables, receivables, Cash Box foundations, COGS, profit, and Trial Balance evidence.

**Blocked by:** 04 — Catalog, naming, units, and Suppliers.

**Status:** ready-for-agent

- [ ] IQD amounts use exact fils representation and centralized, deterministic rounding policies.
- [ ] Chart of Accounts, journal entries, and journal lines preserve source, actor, time, and approval evidence.
- [ ] Posting templates produce balanced debit/credit effects for purchases, inventory, payables, cash, and approved receivables.
- [ ] The ledger can derive inventory valuation, COGS, profit and loss, and Trial Balance without report-side mutation.
- [ ] Manual journals, backdating, and other sensitive accounting actions enforce named permission, re-authentication, approval, open-period, and newest-state rules.
- [ ] Accountant-approved golden examples cover discounts, WAC/FIFO, returns, reversals, allocations, and rounding.
