# Product and scope

## Product promise

Breev is a bilingual, offline-first commercial pharmacy operating system that Breev Company sells to many pharmacies through a free base plan, paid plans, and add-ons. Each installation serves one pharmacy location. Pharmacy staff can purchase, receive, count, sell, return, settle, account for, and report on pharmacy stock without internet access. The Main Pharmacy Computer is the local authority. Additional paid terminals connect to it over the pharmacy LAN and never open or share the raw database.

The built-in roles are owner, manager, pharmacist, sales employee, purchasing employee, inventory employee, accountant, and support, each with configurable permissions for screens, actions, cost prices, exports, edits, reports, and sensitive transactions. Each user holds exactly one role, and permissions are configured on roles, never on individual users: every user assigned to a role carries the same permissions, and there is no per-user grant, deny list, or override. A pharmacy may add custom roles with one pharmacy-entered display name shown verbatim in both languages; Breev localizes the built-in role names and every permission's visible name and description. Account permissions, not device type, determine what an employee can do from any licensed device. Breev Support and cloud operators are exceptional actors who require separate authorization; they are never ordinary pharmacy users.

## Required local product

The local product must provide the following capabilities. [`domain.md`](domain.md) owns the exact rules and [`workflows.md`](workflows.md) the flows.

- Pharmacy setup, mandatory username/password login with no bypass, roles and permissions, plan entitlements, device trust, and step-up where required. Every sale, purchase, purchase adjustment, return, voucher, cash movement, stocktake, and other sensitive change records the user, date, time, and reference document. Optional simple manual employee attendance (check-in/check-out) may be enabled; fingerprint integration and payroll are deferred.
- A main dashboard with permission-filtered operational summaries — sales, low-stock alerts, expiry alerts, and patient follow-ups — plus a sortable item-summary table (item name, quantity sold, profit, profit percentage, expiry, stock level, monthly consumption rate, estimated surplus) and a unified notification center combining item, patient, and invoice/due-date alerts under one icon with separate tabs. Authenticated staff can also see the pharmacy name and ID, local device role and ID, installation ID when available, local server and database status, and API and schema versions. Identifier fields have a one-click copy action.
- Product records in two definition modes (medication and general item) with generated display names, an independent Arabic search name, barcodes (suggest, print, multiple per item), supplier links, product-specific integer package conversions, batches with expiry and lot data, prices, manual and automatic item state colors, per-item external/AI data-sharing controls, item movement history with drill-down, and a daily matching list; sequential or bulk item definition may speed initial data entry (optional in the scope). Archive and merge replace destructive deletion. The Product detail side panel appears only in Sales and Purchasing.
- Purchasing follows a keyboard/scanner-first workflow: Enter moves through the active fields of each row and, from the last field, either opens a new row or returns to the item/barcode field per the user's setting. The default row order — **Item/Barcode → Quantity → Cost → Selling Price → Expiry** — is an engineering default; columns can be shown, hidden, and reordered. Purchasing must support cash and debt, supplier allowance snapshots and dual cost values, batches, delta-only Purchase Invoice Adjustments, purchase returns, and immutable purchase history.
- Inventory derives from movements and is read-only in the review grid. It supports quick stocktaking, FEFO selection, low-stock and reorder views, the reorder basket and Ordered Items list, controlled supplier returns, approved expired/damaged write-offs, and owner-only protected export of sensitive inventory and supplier data. Breev enforces hard blocks for expiry, recall, and quarantine.
- Sales must support durable and suspended drafts, scanning and smart search, quick patient and item creation without leaving the sale, a configurable quick-access grid, miscellaneous item/service lines, approved units and quantities, price and discount controls, and cash, card, or deferred settlement. Card tenders post to the card account with commission recorded separately — recording card sales is core; integrated external payment providers remain deferred. Saved sales invoices are never edited; corrections use linked sales returns (or a full reversal for a wholly wrong posting). Continuous Cash Boxes, immutable receipts, reprints, and exact permissions for profit, cost, and drawer-balance visibility are required.
- Patient capability is a required Phase One deliverable: profiles with contact details, chronic conditions, chronic medications, interests, and important notes; automatic medication purchase history with treatment-continuation indicators; cumulative weight history with BMI; an automatic patient-specific discount; a Do Not Disturb control; due-time-ordered follow-up lists; item reservations; and the paid messaging interface. Exact consent, retention, and Iraqi legal wording remain gated in [`open-decisions.md`](open-decisions.md); the gate constrains wording and data handling, not the existence of these Phase One features.
- Accounting must use double-entry records over an immutable transaction ledger. It covers employee cash drawers with start/end-of-work reconciliation, the chart of accounts, transfer and payment vouchers, supplier settlement with allowances and allowance differences, payables and receivables, debt aging, expenses, capital and owner withdrawals, the journal, trial balance, P&L, source reconciliation, and account statements with document drill-down.
- Reports cover the essential Phase One categories in [`domain.md`](domain.md) with date-time, user, and column filters, plus user activity and the audit trail. Sensitive exports are permission-restricted and may require the owner's password.
- The free plan includes an Excel-like table of approved columns from sales invoices linked to a named patient. Phase One also includes a documented read/export API for those columns and practical Google Sheets connection guidance. There is no write-back to Breev, and Zapier, Telegram, and other external automation are excluded.
- Encrypted local backup and restore, diagnostics, repair, data export, and safe signed updates. Internet or cloud availability must not become a dependency for core POS.

Breev must provide every local capability in Arabic with RTL layout and English with LTR layout. Every capability must support light and dark themes with shared approved brand tokens, keyboard-only operation, and its relevant loading, empty, error, offline, denied, disabled, and recovery states. Core requirements are fewer clicks, keyboard support, and preservation of unsaved screen data across navigation. Appearance is marketing-critical. The confirmed renderer stack is React + TypeScript + Tailwind CSS + shadcn/ui with Vite-compatible tooling. Visual primitives never act as business authority.

## Plans, entitlements, and administration

**Free Base Plan** includes one device (the Main Pharmacy Computer) acting as POS, data-entry device, local server, and database host; core local sales, purchases, inventory, and the approved basic accounting; the Excel-like named-patient table; reports; printing; backup; complete export; supported restore; and renewal. It has no cloud connection, remote monitoring, or outside-pharmacy access. Plan expiry, tamper, or commercial disagreement must never delete, encrypt, hide, or hold pharmacy-owned data or these Free Core capabilities hostage.

Paid add-ons, sellable individually or in plans: **Additional Device/POS** (another device on the local network), **One-Way Cloud Sync** (upload for external read-only viewing), **Purchase-Invoice OCR**, **AI Services** within the Phase One boundaries, **WhatsApp and Messaging** (provider costs are outside the development price), and **CRM and Advanced Reports** per the final plan matrix. Licensing supports monthly and annual plans. Each pharmacy has its own independent license, settings, users, and permitted device count. Menus and functions not enabled for a pharmacy are hidden completely, not shown as disabled buttons — and UI hiding is never the enforcement boundary.

Devices: Phase One installation and acceptance testing cover four simultaneous devices (one main plus up to three terminals). The permitted device count is licensing data, never a hard-coded software limit; the Super Admin can raise a pharmacy's count per its plan. Architectural and licensing support beyond four is included, but Phase One does not guarantee unlimited devices on the same hardware.

Minimum Phase One Super Admin functionality (delivered through the protected cloud operations UI): create and register a new pharmacy installation; assign or change its plan and add-ons; grant any paid feature free to a specific pharmacy or group without changing the global plan definition (founder override); set the permitted device/POS count; enable or disable OCR, AI, messaging, cloud viewing, and other prepared features; and view basic license and synchronization status. A complete external web dashboard for editing operational pharmacy data is Phase Two.

When a subscription expires, paid functions become unavailable or read-only according to the approved rule, without deleting data. The proposed default — seven inclusive grace days, then Free Core fallback at 00:00 on day eight under Trusted Breev Time — remains pending client approval in [`open-decisions.md`](open-decisions.md). New paid work stops at the boundary; history, drafts, safe reconciliation, renewal, and Free Core remain usable. Basic offline license protection deters circumvention through device date/clock changes. The local API implements that default today by honouring the licence's signed grace end — paid capabilities continue during grace, new terminal pairing is refused, and Free Core follows at the grace end — and the administration screen shows the owner the plan, issue, expiry, and grace dates, the days remaining with a warning before disruption, plan features separately from founder grants, and a Renew action that installs a newer licence; the rule stays unapproved until the client decides.

The first cloud tier is One-Way Sync for read-only remote views and reporting; the pharmacy owner signs in remotely to view the approved pages. A higher future tier may accept narrowly allowlisted Cloud Commands under the rules in [`domain.md`](domain.md). Breev Company intends to collect subscription fees automatically in the cloud with a separate billing series; the payment gateway details remain G-04-gated and cannot affect Free Core continuity.

## Phase One AI, OCR, and provider boundaries

Phase One AI is limited to approved uses: OCR, purchase-invoice matching, and selected simple queries or recommendations based on system data. Any AI function must respect permissions and per-item data-sharing controls; sensitive or restricted items can be excluded from AI or external responses. "AI Recommendations" UI sections contain only content within this basic scope.

The following capabilities have confirmed safety boundaries. Breev must keep each one disabled until its matching gate in [`open-decisions.md`](open-decisions.md) closes.

- OCR may assist only with reviewed purchase drafts of computer-printed supplier invoices. It must never post a purchase. Perfect accuracy across all formats is not an acceptance requirement.
- The dosage-calculation field (age/weight) ships disabled until the client supplies or approves the dosage rules and medical source. Advanced drug-interaction, contraindication, and clinical-decision features are not Phase One acceptance requirements; if ever released they must use licensed content and pharmacist-approved mappings.
- WhatsApp message sending remains disabled until the provider, templates, and included message types are approved — especially any medicine, marketing, or health-detail template.
- Integrated external electronic payments remain disabled, including provider refund and reconciliation. Recording card-tender sales and commissions is unaffected.
- Breev must not make any claim or submission as an official Iraqi electronic tax invoice.

## Scope boundaries

### Deferred (Phase Two or later)

- Multi-location or branch operation and multi-currency.
- Two-way synchronization, cloud editing, and the complete external administration web dashboard.
- Live supplier integrations, automated price comparison, automatic ordering, and inter-pharmacy exchange.
- Delivery, e-commerce, promotions, marketing automation, and broad webhooks.
- Fingerprint attendance integration and automated payroll.
- Telegram, SMS, Zapier, and general public APIs beyond the documented spreadsheet read API.
- The advanced AI roadmap: natural-language assistant, predictive stockout/surplus/expiry analytics, supplier comparison, adherence analysis, clinical support, profit explanation, segmentation/campaigns, and learning OCR.
- Laboratory integration, e-prescriptions, and external medical interfaces.
- Frozen Snapshot expansion beyond the data stored with saved Phase One documents, and consumption aggregation by scientific/generic name.
- Integrated external payment and official e-invoicing.

Do not create packages, routes, schemas, settings, or extension frameworks for deferred capabilities. This forbids speculative build-out, not foresight: the requirements state that the data model must not preclude the named future expansions — supplier-price integrations, multi-branch operation, and cloud expansion per the scope, and two-way synchronization per the client record — so avoid modeling decisions that would force rework for them, without building any of their features now.

### Excluded

The clinics tab is outside the project scope. Breev excludes examination, lab, diagnosis, prescribing, and prescription-template workflows, and prohibits full AI medical advice and unlicensed heuristic substitutions. Clinical support, if ever released, may advise on medicine safety only. Regulatory Hard Blocks remain separate and always use validated regulatory data. The developer is not responsible for independently creating medical knowledge; medical data and rules require a client-approved source.

## Product success

A usable release must prove all of the following.

- A pharmacy can recover from installation through purchase, stock, sale, correction, accounting, report, backup, and restore on supported Windows hardware without internet.
- Four devices operate simultaneously over the pharmacy LAN; an authorized user signs in from any licensed device with role-based capability; an added terminal cannot bypass the main authority; the device count can rise without a code change.
- Features disabled for a pharmacy are completely hidden.
- A failed print, provider, or cloud action cannot duplicate or erase a posted transaction.
- Every core flow is usable and testable in both language directions.
