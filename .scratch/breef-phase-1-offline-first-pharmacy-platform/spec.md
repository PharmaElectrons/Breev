# Breev Commercial Stage 1 — Offline-first pharmacy platform

Status: ready-for-agent

This is the client-facing first commercial delivery described in the interview. It spans multiple engineering phases in the delivery plan; it is not limited to the engineering `Phase 1 — Foundation`.

## Problem Statement

Pharmacies need a dependable operating system for sales, inventory, purchasing, patients, and accounting that continues to work when the internet is unavailable. The current product is primarily a visual prototype and does not yet provide trusted business logic, durable local records, accounting integrity, subscription enforcement, or a safe path to cloud synchronization.

The product must be suitable for one Pharmacy first while being structured as a multi-Tenant SaaS product from the beginning. It must preserve pharmacy-owned data and core sales capability during subscription or cloud problems, while allowing paid features and Additional POS Terminals to be controlled by plan. The initial release also needs practical WhatsApp messaging and OCR-assisted purchase entry without allowing either external service to become an authority over pharmacy, patient, inventory, or accounting records.

The client has confirmed that the first operational scope includes a complete accounting system with journal entries, payables/receivables, profit and loss, and trial balance; configurable inventory valuation using WAC, FIFO, or Last Purchase Cost reference; local-to-cloud synchronization; WhatsApp as the first messaging channel; manually maintained medicine data; no usable legacy-data export; and an ongoing support arrangement after delivery. Future feature additions and pharmacy-specific customizations are separate, explicitly approved work.

## Solution

Build Breev as a Windows-first, Arabic/English, RTL/LTR, offline-first pharmacy desktop platform. The Main Pharmacy Computer runs the Electron application, local API, authoritative local PostgreSQL database, synchronization worker, backup worker, and local licensing/device services. Additional POS Terminals connect to the Main Pharmacy Computer over the pharmacy LAN and never connect directly to PostgreSQL.

The local application is the authority for ordinary pharmacy operations. A sale, purchase, stock movement, payment or receivable/payable effect, journal posting, audit entry, and synchronization outbox record are created atomically through the local application boundary. Cloud services provide Tenant administration, Subscription and entitlement management, synchronization ingestion, remote projections, and controlled operations; initial synchronization is one-way from the Pharmacy's local system to the cloud.

The release provides a complete core workflow for catalog setup, purchasing, batch and expiry-aware inventory, POS sales and returns, continuous Cash Box management, optional Patient Profiles and consent, accounting, reports, backups/restore foundations, subscriptions and Free Core POS fallback, WhatsApp workflows, and OCR Drafts. OCR and WhatsApp are gated by entitlement, privacy, provider, and jurisdiction checks and always retain manual/offline fallback paths.

## User Stories

1. As a pharmacy owner, I want to install Breev on a Windows Main Pharmacy Computer, so that the Pharmacy has a dependable local operating system.
2. As a pharmacy owner, I want Breev to initialize a private local API and PostgreSQL database, so that pharmacy data remains available without the internet.
3. As a pharmacy owner, I want the product to identify the Pharmacy as a Tenant, so that cloud billing, synchronization, and isolation are unambiguous.
4. As a pharmacy owner, I want to create the first owner account securely, so that the system has an attributable administrator from first use.
5. As a pharmacy owner, I want to configure the Pharmacy name, contact details, currency, locale, numbering preferences, and operational defaults, so that receipts and reports match the business.
6. As a pharmacy owner, I want to use Arabic and English independently, so that each staff member can work in a familiar language.
7. As a pharmacy owner, I want to switch between RTL and LTR layouts correctly, so that dense pharmacy workflows remain understandable.
8. As a cashier, I want POS to be the primary workspace after login, so that I can begin a sale quickly.
9. As a pharmacist, I want all core local workflows to remain available during an internet outage, so that the Pharmacy can continue serving customers.
10. As a cashier, I want to search products by name, scientific name, alias, SKU, registration identifier, or barcode, so that I can find an item even when a barcode is unavailable.
11. As a pharmacy administrator, I want to enter and maintain products manually, so that the catalog reflects medicines available in my country.
12. As a pharmacy administrator, I want to distinguish structured pharmaceutical names from general item names, so that medicine records are consistent without forcing non-medicine items into a clinical model.
13. As a pharmacy administrator, I want to define packaging units and positive integer conversion ratios, so that boxes, strips, and smallest units are recorded accurately.
14. As a pharmacy administrator, I want to version packaging changes, so that historical stock and invoice quantities are not reinterpreted.
15. As a pharmacy administrator, I want to maintain barcode aliases, so that multiple valid package barcodes can identify one product.
16. As a pharmacy administrator, I want to archive or deactivate products instead of deleting referenced records, so that history remains trustworthy.
17. As a pharmacy administrator, I want to create and maintain Suppliers, so that purchases and payables are attributable.
18. As a buyer, I want to create a durable purchase Draft Invoice with supplier, date, reference, and lines, so that unfinished entry survives interruption.
19. As a buyer, I want purchase entry columns ordered as item/barcode, quantity, cost price, selling price, and expiry date, so that entry follows the confirmed workflow.
20. As a buyer, I want to enter batches, lots, expiry dates, and acquisition facts, so that stock can be allocated and blocked safely.
21. As a buyer, I want to record supplier discounts and purchase totals exactly, so that inventory cost and payables reconcile.
22. As a buyer, I want manual purchase entry to work offline, so that receiving stock does not depend on a cloud service.
23. As a buyer, I want OCR to extract a supplier invoice into an OCR Draft, so that repetitive entry is faster.
24. As a buyer, I want every critical OCR field highlighted against its source location, so that I can verify quantities, prices, discounts, taxes, totals, dates, batches, and expiry values.
25. As a buyer, I want to correct OCR results before posting, so that provider mistakes cannot silently affect stock or accounting.
26. As a buyer, I want unknown products, Suppliers, units, or batches to require explicit mapping, so that OCR cannot create unsafe duplicates.
27. As a pharmacy owner, I want OCR provider, model, region, privacy, entitlement, and page-allowance checks to run before external processing, so that commercial documents are not sent under unsafe conditions.
28. As a pharmacy owner, I want OCR usage warnings at 80% and a visible stop at 100%, so that external charges are predictable.
29. As a buyer, I want manual entry to remain available when OCR is offline, unavailable, rejected, expired, or over quota, so that purchasing is never blocked by OCR.
30. As a pharmacy owner, I want the original supplier invoice retained as Supplier Invoice Evidence only after a posted purchase links it, so that commercial evidence is available without retaining provider working copies indefinitely.
31. As a stock controller, I want stock to be represented by append-only Stock Movements, so that quantity changes have a reason and actor.
32. As a stock controller, I want on-hand quantity stored in a canonical Inventory Unit, so that package conversions do not create fractional or drifting stock.
33. As a stock controller, I want stock to be tracked by batch and expiry, so that unsafe stock cannot be sold.
34. As a pharmacist, I want expired, recalled, and quarantined batches blocked from allocation immediately, so that the POS cannot sell unsafe stock.
35. As a stock controller, I want a daily expiry evaluation and a monthly unresolved review, so that expiry controls do not depend on someone opening a particular screen.
36. As a stock controller, I want to perform a counted stock correction with reason and evidence, so that discrepancies are explicit movements rather than hidden quantity edits.
37. As a stock controller, I want supplier returns, write-offs, and destruction to be dedicated movements, so that they are not disguised as zero-price sales.
38. As a pharmacy owner, I want to select WAC, FIFO, or Last Purchase Cost reference in settings, so that the valuation policy fits the Pharmacy's operating model.
39. As an accountant, I want WAC to be the preferred default, so that the initial release has a practical standard valuation policy.
40. As an accountant, I want posted movement and loss records to snapshot the valuation method and carrying cost used at posting, so that later purchases or recalculation cannot rewrite history.
41. As a cashier, I want to create and resume a durable sale Draft Invoice, so that an interruption does not discard the current basket.
42. As a cashier, I want barcode scanning and keyboard-first product entry, so that checkout is fast in a busy Pharmacy.
43. As a cashier, I want an unknown barcode to offer a safe product-creation flow, so that I can continue without silently creating an incomplete sale line.
44. As a cashier, I want to change unit, quantity, and permitted line discounts, so that the sale reflects the customer's request within policy.
45. As a cashier, I want product details available in a side panel during sales, so that I can confirm relevant information without losing the basket.
46. As a cashier, I want to attach an optional Patient Profile, so that ordinary anonymous sales remain possible while approved CRM use is available.
47. As a cashier, I want to post an anonymous sale when identity is not necessary, so that ordinary purchases do not force unnecessary patient data collection.
48. As a cashier, I want the system to validate permissions, entitlements, stock, prices, units, money, expiry, and safety rules before posting, so that an invalid sale remains a recoverable draft.
49. As a cashier, I want posting to atomically create the Pharmacy Sales Invoice, inventory effects, payment or receivable effect, journal entries, audit evidence, and sync outbox event, so that all business views agree.
50. As a cashier, I want the posted receipt to preserve transaction-time product, unit, price, discount, batch, and customer snapshots, so that later catalog edits do not alter history.
51. As a cashier, I want printing or cash-drawer failure after posting to preserve the invoice, so that hardware failure cannot duplicate or erase a sale.
52. As a cashier, I want an authorized audited reprint of an immutable receipt, so that I can recover from printer failure safely.
53. As a cashier, I want an existing sale draft to show when its saved selling price differs from the current price, so that repricing is visible before checkout.
54. As an authorized user, I want to keep an old draft price only with named permission and reason, so that price overrides are attributable.
55. As a cashier, I want posting to revalidate current stock, batch status, safety, tax, cost, and price versions, so that stale drafts cannot force obsolete facts into a posted invoice.
56. As a supervisor, I want sales returns to link to the original invoice and create their own stock, payment/debt, journal, audit, and printable evidence, so that returns are traceable.
57. As an owner, I want reversals to create linked accounting-safe offsets while preserving the original invoice, so that corrections do not destructively overwrite history.
58. As a supervisor, I want no-invoice returns to require elevated permission and evidence, so that the highest-risk correction is controlled.
59. As an accountant, I want a continuous Cash Box ledger for receipts, refunds, expenses, withdrawals, deposits, and reconciliation snapshots, so that staff do not depend on forced shift opening and closing.
60. As an accountant, I want cash variances to require a reason, approval where needed, and an adjustment posting, so that physical discrepancies remain visible.
61. As an accountant, I want to define a Chart of Accounts, so that pharmacy transactions map to a complete accounting model.
62. As an accountant, I want every posted sale, purchase, return, reversal, cash movement, inventory valuation, payable, and receivable effect to create balanced journal entries, so that the ledger is authoritative.
63. As an accountant, I want to record Supplier payables and approved customer or patient receivables, so that outstanding balances are measurable.
64. As an accountant, I want journal entries and lines to preserve source references and posting actors, so that every ledger fact can be traced.
65. As an accountant, I want manual journals to require named permission and, where policy requires, a different approver, so that financial adjustments are controlled.
66. As an accountant, I want closed-period and backdated posting rules, previews, reasons, and audit evidence, so that historical reports are not silently changed.
67. As an owner, I want profit and loss reports derived from the accounting ledger, so that reports do not invent or mutate financial facts.
68. As an accountant, I want a Trial Balance, so that debit and credit integrity can be reviewed.
69. As an owner, I want inventory valuation, COGS, sales, purchases, returns, cash, payables, receivables, and profit reports, so that the Pharmacy can operate from one consistent financial picture.
70. As a report user, I want reports and exports to be read-only, so that viewing financial data cannot mutate the ledger.
71. As a patient, I want an optional Patient Profile separate from immutable sale snapshots, so that CRM and health context can evolve without rewriting financial history.
72. As a pharmacy user, I want patient contact and health information collected only for an explicit purpose or necessary basis, so that the Pharmacy minimizes sensitive data.
73. As a pharmacy user, I want consent represented as immutable Consent Events with purpose, policy version, destination, and provider context, so that consent history is auditable.
74. As a patient, I want withdrawal of optional consent to stop future use and queued work, so that my choice is respected.
75. As a pharmacy owner, I want patient access controlled independently from consent, so that consent does not grant staff permissions.
76. As a pharmacist, I want any initial clinical alerts to be deterministic, advisory, and based only on approved user-entered data, so that Breev does not diagnose, prescribe, or determine dosage.
77. As a pharmacist, I want a missing, stale, invalid, or disabled clinical data bundle to result in Not Evaluated rather than an unsafe claim, so that Core POS remains safe.
78. As a pharmacy owner, I want a Pharmacy WhatsApp Identity owned by the Pharmacy and never shared across Tenants, so that messaging ownership and provider migration remain clear.
79. As a pharmacy user, I want WhatsApp messages to require an approved purpose, consent or other validated basis, current template, destination, provider, jurisdiction, entitlement, and policy checks, so that health-related messaging is not sent casually.
80. As a pharmacy owner, I want Arabic and English WhatsApp Template Versions to be versioned and approved, so that message content is controlled.
81. As a pharmacy user, I want queued WhatsApp messages to revalidate all gates at send time, so that a later withdrawal or policy change blocks stale work.
82. As a pharmacy owner, I want WhatsApp usage and actual charges attributed to the Tenant, so that provider costs are visible.
83. As a pharmacy user, I want delivery status, retry, cancellation, dead-letter, and provider deletion outcomes recorded, so that messaging failures are recoverable and auditable.
84. As a pharmacy owner, I want Subscription Plans to grant explicit feature and device entitlements, so that each Pharmacy receives the capabilities it has purchased.
85. As a pharmacy owner, I want disabled features hidden from navigation and blocked again in APIs, application services, jobs, exports, and sync, so that UI changes cannot bypass commercial or security rules.
86. As an owner, I want the base licence to include one POS device and additional POS Terminals to consume paid seats, so that device access is understandable.
87. As an owner, I want an Additional POS Terminal paired by a one-use owner-authorized flow, so that unknown devices cannot join the LAN.
88. As an owner, I want to revoke a Paired Terminal locally, so that a lost or retired device cannot continue making requests while offline.
89. As a cashier, I want a Paired Terminal to continue working over the LAN when the internet is unavailable, so that the Pharmacy can keep selling.
90. As an owner, I want the Main Pharmacy Computer to remain the local authority, so that multiple terminals do not create conflicting stock, invoice, cash, or accounting databases.
91. As an owner, I want the free or lowest plan to preserve Free Core POS, pharmacy-owned data, history, reports, print, backup, export, and renewal access after paid expiry, so that the Pharmacy is never held hostage by subscription state.
92. As an owner, I want paid expiry, grace, tamper detection, fallback, renewal, and restoration audited, so that access state is explainable.
93. As an owner, I want one-way cloud synchronization from the local system to a Tenant-isolated cloud projection, so that I can view allowed data remotely without cloud edits overwriting local facts.
94. As a synchronization operator, I want local transactions to enqueue versioned idempotent envelopes atomically with the local transaction, so that a crash cannot create an untracked or duplicate sync event.
95. As a synchronization operator, I want cloud ingestion to deduplicate by idempotency key and acknowledge durable checkpoints, so that retries are safe.
96. As an owner, I want synchronization backlog, failure, and recovery status visible, so that an outage is distinguishable from lost data.
97. As a pharmacy owner, I want local backups to be encrypted, verified, retained according to policy, and restorable without deleting the data directory, so that hardware and update failures are recoverable.
98. As a support operator, I want health checks, repair guidance, logs, and recovery states that do not expose unnecessary patient data, so that support can diagnose failures safely.
99. As a pharmacy owner, I want installation, update, repair, and migration flows to preserve the last recoverable database state, so that a failed release does not reset the Pharmacy.
100. As a pharmacy owner, I want the delivered system to include source code, operating configuration, database and migration documentation, installation/activation procedures, and support training material, so that the company can operate and support its own product.
101. As a support team member, I want documentation for creating Pharmacy versions, managing Tenants and Subscriptions, pairing devices, restoring backups, diagnosing sync, and handling common operational failures, so that support is not dependent on undocumented knowledge.
102. As a product owner, I want future pharmacy-specific features and plan variations isolated behind explicit modules and entitlements, so that customization does not destabilize the core platform.

## Implementation Decisions

- Treat the current React/Lovable frontend as a visual and workflow reference only. Trusted business logic, authorization, persistence, accounting, inventory, sync, and provider behavior belong in the new application/domain boundaries.
- Use a Windows-first Electron desktop client with React, TypeScript, Tailwind, and shadcn/ui. The renderer communicates through the local application contract and does not access PostgreSQL directly.
- Use a modular monolith with deployable boundaries for desktop, local API, cloud API, Super Admin, and migration tools. Domain modules own behavior and persistence; applications compose them.
- Keep dependency direction from deployable applications to domain modules to focused shared packages to a minimal shared kernel. Cross-module collaboration uses explicit application contracts or events; modules do not access one another's tables directly.
- Use the Main Pharmacy Computer as the single local transaction authority. The local API owns transactions, LAN requests, local jobs, and the authoritative local PostgreSQL store.
- Use PostgreSQL with Drizzle ORM and migrations. The product-managed local PostgreSQL service is installed and repaired by the signed Windows installer, with protected credentials, health/readiness checks, encrypted backups, restore verification, and data-preserving upgrade/uninstall behavior.
- Give sync-capable records application-generated UUIDv7 identities. Keep human document numbers separate, pharmacy-scoped, type-scoped, year-scoped, transactionally allocated by the local API, gap-tolerant, and never silently reused.
- Model IQD money as exact integer fils with centralized rounding policies. Do not use binary floating point for money or silently round line/document totals. Accountant-approved golden examples are required before production accounting implementation.
- Model stock as append-only Stock Movements in a canonical Inventory Unit. Preserve entered unit, quantity, conversion ratio, batch, and valuation snapshots on posted lines and movements.
- Make WAC the preferred initial valuation method while supporting pharmacy-level configuration for WAC, FIFO, or Last Purchase Cost reference. Last Purchase Cost is a pricing/reference value and is not silently treated as the accounting valuation method.
- Separate Draft Invoice, Posted Invoice, Return, Reversal, and Replacement states. Completed invoices remain immutable; corrections create linked records and offsets.
- Use one atomic local application transaction for each posted sale, purchase, return, reversal, cash movement, and other approved business command. The transaction includes domain records, accounting effects, audit evidence, and synchronization outbox entries as applicable.
- Implement continuous Cash Box management rather than requiring shift open/close for ordinary sales.
- Implement complete accounting boundaries for Chart of Accounts, journal entries/lines, posting templates, payables, receivables where approved, cash, inventory valuation, COGS, profit and loss, and Trial Balance. The accounting ledger is authoritative for financial reporting.
- Enforce permission and entitlement checks at UI, local/cloud API, application-service, domain-command, job, sync, and export boundaries. Use named step-up authorization and dual control for high-risk actions; do not create a generic bypass.
- Keep Patient Profiles optional and separate from immutable transaction snapshots. Record consent as append-only Consent Events and keep consent independent from role access.
- Limit initial-release clinical behavior to approved deterministic, advisory evaluation over explicit user-entered data. Missing, stale, invalid, or disabled clinical content returns Not Evaluated and cannot block Core POS except for separately approved Regulatory Hard Blocks.
- Make WhatsApp a replaceable official-provider adapter. Each Pharmacy owns a dedicated Pharmacy WhatsApp Identity; messages use approved versioned templates, minimum data, durable queues, send-time revalidation, tenant attribution, authenticated idempotent callbacks, and visible failure/cancellation outcomes.
- Make OCR a replaceable provider adapter. OCR creates only an OCR Draft and OCR Provenance Snapshot; it cannot create or post products, Suppliers, batches, stock, prices, payments, or journals. Critical fields require human source-highlight confirmation and Breev-side exact parsing/recalculation.
- Gate external OCR by provider/model/region approval, privacy and no-training terms, page allowance, entitlement, and absence of unapproved patient data. Retain provider working copies only within the approved temporary limit; retain posted local Supplier Invoice Evidence under the commercial-record policy.
- Start with one-way local-to-cloud synchronization. The local outbox emits versioned tenant-bound envelopes; cloud ingestion is tenant-isolated, idempotent, projection-oriented, and does not send edits back. Two-way synchronization and cloud editing require a later approved decision and ownership matrix.
- Model Subscription Plans and feature entitlements explicitly. Paid expiry must preserve Free Core POS and pharmacy-owned data while disabling only paid capabilities after the approved grace period.
- Pair Additional POS Terminals with per-device key/certificate identity, owner confirmation, seat/entitlement checks, local revocation, and the signed-in user's independent permissions. LAN discovery is not trust; no direct PostgreSQL or certificate bypass is permitted.
- Use local encrypted backup, verified restore, health, repair, signed update, forward-only resumable migration, and data-preserving rollback/recovery workflows as platform capabilities. Cloud backup is not a replacement for the Pharmacy's independent local backup.
- Build Arabic/English, RTL/LTR, keyboard-first, accessible, and performant core workflows. Validate against the provisional ADR-027 percentile targets on certified pharmacy hardware without weakening transaction safety to achieve speed.
- Keep Clinics, multi-branch operation, delivery, e-commerce, marketing automation, inter-pharmacy exchange, supplier auto-order/comparison, biometric payroll, Telegram/SMS, broad API/Zapier integrations, multi-currency, external payment processing, and official e-invoicing outside this release unless separately approved.
- Do not promise data migration from the existing system because the client confirmed that it cannot export usable data. Provide controlled manual setup/import tools only if separately specified and approved.
- Treat framework/library updates, future features, pharmacy-specific customizations, and major upgrades as separately scoped work unless they are small security or patch updates covered by the maintenance agreement.

## Testing Decisions

- Test external behavior at the highest practical seam: drive representative workflows through the local application boundary and desktop UI, then verify persisted records, visible outcomes, audit evidence, and synchronization-facing projections. Do not assert internal implementation details, table layout, React component structure, or provider SDK calls.
- Use the single local end-to-end seam for the primary acceptance suite. It should cover offline POS, durable drafts, purchase posting, OCR review handoff, inventory/expiry blocking, returns/reversals, accounting postings, Cash Box, permissions/entitlements, subscription fallback, WhatsApp queue gating, backup/recovery outcomes, and one-way sync acknowledgements.
- Add focused contract tests at boundaries where behavior cannot be observed reliably through the end-to-end flow: money/rounding, units/conversions, permission and entitlement evaluation, sync envelopes/idempotency, provider callback authentication, and validation error contracts.
- Add negative authorization tests for every sensitive action through both the UI and direct local/cloud application requests. A feature is not accepted because navigation is hidden; API, jobs, exports, and sync must reject unauthorized access.
- Add tenant-isolation tests for cloud reads, writes, list endpoints, background jobs, object keys, logs/exports where relevant, and sync ingestion. Attempt cross-Tenant access rather than testing only the happy path.
- Add invariant tests for atomic posting: a failed sale or purchase must leave no partial stock, cash, payable/receivable, journal, audit, or outbox effect; a successful posting must produce all required effects exactly once.
- Add inventory/accounting golden cases approved by an accountant for WAC, FIFO, cost allocation, discounts, returns, reversals, COGS, profit, Trial Balance, IQD fils precision, and explicit cash-settlement rounding.
- Add sync retry, duplicate delivery, out-of-order delivery, checkpoint recovery, offline backlog, cloud outage, and reauthentication tests. Initial sync must prove that cloud projections cannot edit local posted facts.
- Add OCR tests using a controlled Arabic, English, and mixed Iraqi supplier-invoice corpus. Verify source-highlight review, exact local recalculation, unknown mapping handling, idempotent retry, page allowance warnings/stops, provider deletion evidence, patient-data blocking, and manual fallback.
- Add WhatsApp tests for consent/purpose/template/provider/jurisdiction/entitlement gates, send-time revalidation, tenant binding, callback replay/mismatch rejection, cancellation, dead-letter handling, delivery status, and cost attribution. Telegram and SMS are not required for this release.
- Add hardware and recovery tests for Windows install, reboot/start order, non-admin operation, PostgreSQL service failure, port conflict, backup/restore, repair, update migration failure, printer/scanner/drawer failure, and Additional POS Terminal loss/revocation.
- Add accessibility and performance tests on the minimum certified hardware profile in Arabic/RTL and English/LTR, including keyboard-only operation, visible focus, screen-reader names/status, contrast, resizing, reduced motion, offline feedback, and provisional p95/p99 targets.
- Existing executable test prior art was not found in the current scaffold. The existing UI workflow map, domain glossary, architecture map, requirements register, and ADRs are the behavioral and architectural prior art for the new test suite; test fixtures and shared test infrastructure should be centralized in the dedicated testing package.
- Release evidence must record environment, hardware profile, dataset, locale/direction, network state, build, timing percentiles, accessibility findings, provider/model/region, migration result, backup/restore result, and any approved exception.

## Out of Scope

- Implementing the Clinics tab or clinic/doctor workflows.
- Multi-branch Pharmacy operation, multi-master terminal databases, or operation after the Main Pharmacy Computer is unavailable.
- Two-way synchronization, cloud editing of pharmacy facts, automatic conflict resolution, or a cloud authority over local posted stock, cash, inventory, or journal records.
- Providing or selecting a production medicine knowledge database, full clinical decision support, diagnosis, prescription, dosage determination, or unvalidated interaction advice.
- Telegram, SMS, email messaging, shared WhatsApp senders, or medicine/health WhatsApp templates before current provider, Iraqi legal, pharmacist, and consent gates pass.
- External customer payment processing, payment custody, merchant aggregation, gateway selection, or provider-certified offline electronic payment.
- Official electronic tax invoicing, government submission, authority certification, or claims that a local receipt/PDF/QR is an official tax invoice.
- Automatic migration from the client's existing system; no export is available and no unsupported extraction is promised.
- Delivery, e-commerce, marketing automation, inter-pharmacy need exchange, supplier comparison/auto-order, broad outbound integrations, Zapier-style automation, biometric payroll, multi-currency, and future Tax Compliance modules.
- Continuous 24/7 operations monitoring, cloud-region selection, production vendor procurement, or external-service fees. The product must expose operational state and support safe diagnosis; operational contracts are separate.
- New custom features, plan-specific bespoke workflows, major framework upgrades, large data migrations, and work assigned to another developer. Each requires separate analysis, acceptance criteria, price, and schedule.
- Contractual maintenance pricing, SLA negotiation, warranty terms, and commercial ownership language as product implementation requirements. Delivery must still include source, configuration, documentation, training, and an operable handoff.

## Further Notes

- Source priority is: latest confirmed client clarification, confirmed meeting summary, latest requirements document, prototype, then unconfirmed developer proposals.
- The client's commercial discussion proposed a staged delivery, ongoing maintenance, and separate pricing for future additions. This spec captures the product and acceptance boundaries; the final contract must separately define phase price, schedule, warranty, maintenance tiers, SLA hours and severities, external-service costs, ownership, and change control.
- The proposed maintenance model is compatible with the product boundary only when it preserves responsibility for defects in the delivered implementation, local/cloud synchronization, implemented integrations, runtime environment issues caused by the implementation, security/patch updates, and operational stability. New features remain separately approved work.
- Before implementation of sensitive accounting, privacy, clinical, OCR, messaging, numbering, payment, tax, or legal workflows, the relevant ADR release gates and accountant/legal/pharmacist/provider approvals must be completed. Proposed or provisionally accepted ADRs are not production authorization by themselves.
- The existing prototype contains useful navigation and interaction references but also has known gaps such as in-memory drafts, incomplete identity handling, separate writes for transaction parts, and unsafe heuristic or future-channel affordances. Those gaps must not be carried into the trusted domain behavior.
- The commercial Stage 1 release should be delivered incrementally behind explicit feature/entitlement gates across the engineering phases, with the Core POS and pharmacy-owned data path kept independently recoverable throughout development and subscription lifecycle changes.
