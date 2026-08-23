# Product and scope

## Product promise

Breev is a bilingual, offline-first commercial pharmacy operating system for one pharmacy location. Pharmacy staff can purchase, receive, count, sell, return, settle, account for, and report on pharmacy stock without internet access. The Main Pharmacy Computer is the local authority. Additional paid terminals connect to it over the pharmacy LAN.

The primary users are the owner, pharmacist, cashier, staff responsible for inventory or purchasing, and accountant. Breev Support and cloud operators are exceptional actors who require separate authorization. They are never ordinary pharmacy users.

## Required local product

The local product must provide the following capabilities.

- Breev must support pharmacy setup, individual user authentication, roles and permissions, plan entitlements, device trust, step-up, and dual control where required. Every high-risk action must be auditable.
- Product records must support pharmaceutical and general product names, an independent Arabic search name, barcodes, suppliers, product-specific package conversions, batches, expiry and lot data, and prices. Breev must provide archive and merge instead of destructive deletion. The Product detail side panel appears only in Sales and Purchasing.
- Purchasing follows a keyboard/scanner-first workflow. Each repeated row uses this exact order: **Item/Barcode → Quantity → Cost → Selling Price → Expiry → Enter (next row)**. Purchasing must support cash and debt, supplier discounts, batches, returns, and immutable purchase history.
- Inventory must derive from movements. It must support counts and adjustments, FEFO selection, low-stock and reorder views, controlled supplier returns, write-offs, and destruction. WAC is the default costing method. A pharmacy may instead choose FIFO during setup after accountant review. Breev must enforce hard blocks for expiry, recall, and quarantine.
- Sales must support durable drafts, scanning and search, approved units and quantities, price and discount controls, and cash, credit, or mixed settlement. It must also support continuous Cash Boxes, immutable receipts, returns, reversals and replacements, reprints, and exact permissions for profit and cost visibility.
- Accounting must use double-entry records. It must cover payables and receivables, Cash Box and bank or cash movements, expenses and income, the journal, trial balance, P&L, source reconciliation, and read-only reports and exports.
- Sales are anonymous by default. Breev may offer optional Patient Profiles and capture necessary transaction identity when justified. It must require purpose-specific consent and accept typed health facts only after their release gates close.
- Breev must provide encrypted local backup and restore, diagnostics, repair, data export, and safe signed updates. Internet or cloud availability must not become a dependency for core POS.

Breev must provide every local capability in Arabic with RTL layout and English with LTR layout. Every capability must support light and dark themes with shared approved brand tokens, keyboard-only operation, and its relevant loading, empty, error, offline, denied, disabled, and recovery states. Appearance is marketing-critical. The confirmed renderer stack is React + TypeScript + Tailwind CSS + shadcn/ui with Vite-compatible tooling. Visual primitives never act as business authority.

## Plans and conditional capabilities

**Free Core** includes one Main Pharmacy Computer, core local operations, all existing pharmacy-owned history, reports, printing, backup, complete export, supported restore and inspection, and renewal. It has no cloud dependency. Plan expiry, tamper, or commercial disagreement must never delete, encrypt, hide, or hold these capabilities or the pharmacy's data hostage.

Paid entitlements may add additional LAN terminals, supplier-invoice OCR, WhatsApp messaging, and cloud capabilities. Paid expiry has seven inclusive grace days, counted from the day after expiry: with expiry on 31 August, paid capabilities run through 7 September and Free Core fallback starts 8 September at 00:00 under Trusted Breev Time. New paid work stops at the relevant boundary. History, drafts, safe reconciliation, renewal, and Free Core remain visible and usable.

The first cloud tier is One-Way Sync for read-only remote views and reporting. A higher future tier may accept narrowly allowlisted Cloud Commands under the ownership and conflict rules in [`domain.md`](domain.md). That higher tier is not part of the first cloud implementation.

Breev intends to collect paid subscription fees automatically in the cloud and keep a separate cloud billing series. The payment gateway and collection and reconciliation details remain G-04-gated. They cannot affect Free Core continuity.

The following capabilities have confirmed safety boundaries. Breev must keep each one disabled until its matching gate in [`open-decisions.md`](open-decisions.md) closes.

- OCR may assist only with reviewed purchase drafts. It must never post a purchase.
- Breev must not process Patient Profile or health data beyond anonymous and strictly necessary transaction data.
- Breev must keep deterministic drug-drug, allergy, or duplicate-therapy alerts disabled. If released, they must use licensed content and pharmacist-approved mappings.
- WhatsApp remains disabled, especially for any medicine, marketing, or health-detail template.
- External electronic payments remain disabled, including provider refund and reconciliation.
- Breev must not make any claim or submission as an official Iraqi electronic tax invoice.

## Scope boundaries

### Deferred

The following capabilities are deferred.

- Multi-location or branch operation and multi-currency.
- Delivery, e-commerce, and broad marketing automation.
- Supplier comparison and automatic ordering.
- Inter-pharmacy need exchange.
- Biometric attendance and payroll.
- Telegram, SMS, and Zapier or general public APIs.
- Two-way cloud editing.
- External payment.
- Official e-invoicing.
- Broad generative or operational AI.

Do not create packages, routes, schemas, settings, or extension frameworks for deferred capabilities.

### Excluded

Breev excludes clinic, examination, lab, diagnosis, prescribing, dosing, treatment, and prescription-template workflows. It prohibits full AI medical advice and unlicensed heuristic substitutions. If Breev releases clinical support, that support may advise on medicine safety only. Regulatory Hard Blocks remain separate and always use validated regulatory data.

## Product success

A usable release must prove all of the following.

- A pharmacy can recover from installation through purchase, stock, sale, correction, accounting, report, backup, and restore on supported Windows hardware without internet.
- An added terminal cannot bypass the main authority.
- A failed print, provider, or cloud action cannot duplicate or erase a posted transaction.
- Every core flow is usable and testable in both language directions.
