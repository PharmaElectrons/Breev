# ADR-010: Accounting Engine and Atomic Posting Boundary

- Status: **Proposed invariant — posting rules require accountant approval**
- Date: 2026-08-05
- Decision owners: Accounting / sales / purchasing / inventory
- Related: REQ-ACC-001–005, Q-004–008, R-005–R-007

## Context

Sales, purchases, returns, stock adjustments, payments, debts, expenses, and cash-box movements have inventory and financial effects. The prototype performs separate browser calls and report components can write account entries. The previous ADR's statement that events “trigger” postings could imply eventual accounting, leaving a posted invoice without its ledger.

## Proposed decision

- Accounting is a domain module with its own chart, journal, lines, posting-template versions, receivable/payable and Cash Box concepts.
- An application transaction orchestrates the source document, stock movements, payment/AR/AP effects, balanced journal, audit, and outbox in **one local database transaction**. Any invariant failure rolls back all effects.
- Source domains supply validated business facts; a versioned accounting policy/template deterministically produces journal lines. UI/report code cannot create ledger effects directly.
- Every journal is immutable after posting and balances debit = credit in the approved currency/scale. Corrections use linked reversals and replacement postings.
- Journal lines retain source document/event, template version, actor/device, dates, currency, and explanation.
- Reports read accounting ledgers/projections and expose discrepancies; they do not “fix” balances through hidden writes.
- Asynchronous integration events occur only after the local accounting transaction is committed, via its atomic outbox.

## Alternatives considered

- Asynchronous eventual journal posting: decoupled, but permits invoices/stock without accounts and complicates offline recovery.
- Hard-code debits/credits in Sales/Purchasing UI/services: fast initially, duplicated and unauditable.
- Single-entry account transactions: cannot produce trustworthy trial balance/P&L or balanced audit.
- Database triggers for all business posting: hides versioned policy and is difficult to test/evolve.

## Consequences

- Positive: one authoritative financial truth and strong failure semantics.
- Negative: cross-module transaction coordination requires a clear unit-of-work/application boundary; posting templates and migrations need rigorous versioning.

## Blocking approval

An accountant/product owner must approve golden examples for sale/payment/credit, purchase/discount, returns, expenses/income, stock count/write-off, price/rounding/tax, receivable/payable settlement, Cash Box variance, backdating, and reversal before production posting rules are accepted.

## Approved inventory valuation boundary

The stakeholder approved pharmacy-level WAC as the default accounting cost formula, with FIFO available at initial setup after accountant review. Last-purchase cost is pricing/reference information only. Changing WAC/FIFO after postings requires owner and accountant authorization, an effective date, preview, balanced revaluation/migration, and audit. Physical FEFO allocation is independent from the accounting cost formula. This policy still requires local accountant golden examples before implementation.

Trade, invoice, volume, and prompt-payment reductions of purchase price reduce inventory acquisition cost. Breev retains gross, discount, and net facts, allocates discounts to eligible lines, and uses net cost in WAC/FIFO. A later purchase-price rebate adjusts remaining inventory and the relevant cost of goods sold; only a genuine separate expense reimbursement or financing component is posted outside inventory. The stakeholder approved this direction on 2026-08-05, subject to accountant examples.

Documents retain immutable actual creation/posting time and a separate source/business date. Effects default to the actual posting date. Effective-date backdating requires owner/accountant authorization, re-authentication, an open accounting period, reason, impact preview, deterministic WAC/FIFO/COGS/journal recalculation, and audit. Closed periods receive current-period corrections rather than rewritten history. The stakeholder approved this on 2026-08-05.

Expired/damaged inventory is removed through a dedicated write-off/disposal movement, never a zero-price sale. The posting debits a separate “Expired and Damaged Inventory Loss” expense and credits inventory at carrying cost, on the expiry date when caught by the daily job or discovery date when identified late. It affects net profit but not sales revenue, sales gross profit/margin, or the Cash Box, and is accumulated separately in monthly/yearly reports. Quarantine alone creates no loss. For recalls, supplier recovery offsets the carrying amount and only the unrecovered remainder becomes loss. Owner-approved full/partial dispositions retain batch, quantity, reason, evidence, actor/device/time, and audit.

The carrying amount is produced by the selected company valuation method at posting: current exact WAC or applicable FIFO layer(s), never original batch price, latest purchase price, or selling price. Physical batch, quantity, unit carrying cost, total loss, and valuation method are frozen in the posted movement so later purchases/recalculation cannot rewrite it. The stakeholder confirmed this treatment on 2026-08-05.

Primary references: [IFRS Foundation — IAS 2 Inventories](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/) and [IFRIC discounts/rebates guidance](https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2004/ias-2-discounts-and-rebates-nov-04.pdf).
