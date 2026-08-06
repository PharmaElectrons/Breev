# Breev Pharmacy Platform — Project Context

## Phase 0 status

This document is the approved Phase 0 discovery baseline as of 2026-08-06. Phase 1 is now eligible to begin, but no implementation has started automatically.

The stakeholder confirmed during Phase 0 that **Breev is both the company name and the public product name**. Phase 1 will normalize new workspace/app/package identifiers to `breev`/`@breev/*`. The governing source documents, PDF, conversation, and prototype remain unchanged historical evidence; their legacy `Breef`/`breef` wording will not be destructively rewritten.

## Source authority

When sources disagree, use this order:

1. Latest explicit client clarification in `converstation.md`.
2. Confirmed meeting summary in `converstation.md`.
3. `PROJECT_BRIEF.md` as the product-requirements source.
4. `Breef_Master_Architecture_Build_Prompt.md` as the governing architecture and delivery process.
5. Arabic brief/PDF for workflow recovery and original intent.
6. `frontend/` as a visual and interaction prototype, not as a production architecture or authoritative business rule.
7. Developer suggestions and existing scaffold defaults.

The master prompt controls how the work is delivered; it does not replace the brief as the product-requirements source.

## Product intent

The product is a commercial, Windows-first pharmacy platform for Iraq. Its core is a fast offline POS plus purchasing, inventory, catalog, continuous cash boxes, accounting, patients/CRM, reporting, permissions, audit, subscriptions, and paid integrations. Arabic/RTL and English/LTR, light and dark themes, keyboard-heavy operation, and reliable offline behavior are product requirements rather than polish.

## Confirmed deployment baseline

- A pharmacy's **Main Pharmacy Computer** runs the Electron desktop, a local NestJS API, and local PostgreSQL.
- Additional paid POS terminals use the local API over the pharmacy LAN; they do not own independent authoritative databases.
- Core pharmacy operations continue without internet while the main computer and LAN are available.
- Cloud services are separate NestJS/PostgreSQL applications.
- No cloud vendor or region is selected in Phase 0. ADR-022 provisionally targets managed multi-zone cloud PostgreSQL, 15-minute RPO, 4-hour RTO, 30-day point-in-time recovery, protected daily snapshots, monthly restore verification, quarterly drills, and 99.9% paid-cloud availability while local Free Core operation remains independent.
- The free plan has no cloud synchronization. Paid basic cloud access is local-to-cloud/view-only. Higher plans may allow two-way synchronization only after conflict, permission, and audit semantics are approved.
- The target codebase is a pnpm/Turborepo modular monolith with explicit application, domain-module, and focused shared-package boundaries.
- The Electron renderer has no Node.js, filesystem, or database access. It uses the local HTTP API for domain work and a narrow typed preload bridge for desktop-only capabilities.
- ADR-023 provisionally targets Windows 11 Pro x64 25H2 and standard ESC/POS/HID/printer-driven-drawer classes, but exact supported Windows releases and peripheral models remain a versioned certification decision revalidated before Phase 11. Printer/scanner/drawer failure cannot reverse or replay posted business work.
- ADR-024 provisionally requires signed staged updates, offline repair bundles, owner-controlled maintenance windows, backup-gated forward migrations, no blind database downgrade, bounded security deadlines, and Free Core continuity; exact installer technology and final timing values remain implementation/release decisions.

## Current repository state

### `frontend/`

The existing UI is a substantial Lovable/TanStack Start prototype. It contains the strongest evidence for layout, screen composition, Arabic text, navigation, and some fast-entry intentions. It currently:

- calls Supabase directly from the browser and auto-creates/signs in a hard-coded administrator;
- mixes server-authoritative data with `localStorage`, mock data, and in-memory state;
- has no tenant isolation, reliable permission/entitlement enforcement, transaction boundary, secure Electron boundary, or offline local API;
- exposes destructive updates/deletes for inventory and posted-looking financial documents;
- includes future or excluded modules and unsafe clinical/AI behavior that must not be carried forward;
- is largely Arabic despite a partial language provider, and lacks a complete light/dark theme implementation.

Its visual hierarchy should be recovered selectively; its backend, schema, authentication, accounting, clinical suggestions, and lifecycle semantics are not reusable production design.

### `breef/`

The newer workspace is a **marker-only scaffold**: five app packages, focused shared packages, and eleven domain-module directories whose TypeScript files only export package names. It has no NestJS, Electron, React, Drizzle, database schema, migrations, tests, or production behavior yet. This is compatible with Phase 0's no-implementation rule, but the structure is not validated merely because the directories exist.

Neither workspace has dependencies installed. Non-installing build checks fail at the missing `vite` and `turbo` executables. Phase 0 intentionally did not install dependencies.

## Confirmed scope and sequencing

### Core path

- Foundation and secure desktop/local-server topology.
- Identity, tenant, role/permission, entitlement, license, and device pairing boundaries.
- Catalog, products, barcodes, units, suppliers, batches, and inventory movements.
- Purchasing and reviewed OCR drafts.
- POS sales, returns, invoice lifecycle, payments, and continuous cash boxes.
- Double-entry accounting and reports, with rules reviewed by the product owner/accountant before finalization.
- Patients, consent, CRM, bounded deterministic alerts, WhatsApp, cloud subscriptions/sync, and Super Admin.

### Deferred or excluded from the first production path

- Clinic/doctor workflow: excluded.
- Multi-branch, multi-currency, delivery, e-commerce, broad marketing, supplier comparison/automatic ordering, inter-pharmacy need network, biometric attendance/payroll, and e-invoicing: future packages unless explicitly promoted later.
- Telegram, SMS, Zapier/API automation, two-way cloud editing, and broad AI remain outside the initial core path. OCR is included in the client's first commercial delivery as an optional, separately entitled, human-reviewed draft capability; its provider and privacy gates remain mandatory.
- Clinical support is limited initially to licensed deterministic drug–drug, drug–allergy, and validated duplicate-therapy alerts. Diagnosis, prescribing, dosage, pregnancy, renal/hepatic adjustment, contraindication, disease-interaction, and therapeutic advice remain prohibited unless separately licensed and pharmacist-validated.

## Domain invariants already supported by the sources

- Posted sales, purchases, returns, stock movements, payments, and journal effects are auditable; history is not destructively rewritten.
- Invoices preserve transaction-time names, units, prices, costs, discounts, tax, and party facts as snapshots.
- Global entity IDs are sync-safe UUID/ULID values; human invoice numbers are a separate concern.
- Stock is changed through explicit movements inside a transaction, not by editing an on-hand total.
- Accounting entries balance debit and credit and are derived from versioned, reviewable posting rules.
- Cash boxes are continuous ledgers. Reconciliation snapshots may be optional; forced shifts are not the core model.
- Entitlements are enforced in navigation/UI, application services, API policies, jobs, sync, and device pairing.
- OCR/AI output is a draft requiring a human review step and cannot post inventory or accounting automatically.
- The product details side panel is allowed in Sales and Purchases, not globally and not in Inventory/Product definition under the current clarification.
- The purchase entry order is Item/Barcode → Quantity → Cost → Selling Price → Expiry, followed by a new row.

## Remaining phase and release gates

The following are gates for the affected engineering phases or production capabilities. They do not block the Phase 1 Foundation unless a specific Phase 1 entry gate names them:

- validated upgrade/recovery procedure for the approved managed PostgreSQL Windows service;
- Iraqi accountant/legal validation of the approved human document-number series and correction records;
- accountant validation examples for the approved exact-money policy and later tax-specific rules;
- accountant golden-example validation of the approved WAC/FIFO and net supplier-discount policies;
- detailed two-way synchronization ownership and conflict semantics;
- subscription expiry/grace behavior while offline;
- Iraqi legal/pharmacist validation of the conditionally approved ADR-016 patient consent/provider and ADR-017 retention/deletion/export/support boundaries;
- commercial licence, pharmacist-reviewed Iraqi-product mapping, bilingual guidance, update/freshness evidence, and pharmacist release validation for ADR-018 clinical support;
- specific WhatsApp provider contract/DPA, technical onboarding and migration feasibility, plus per-template Meta/Iraqi legal/pharmacist approval under ADR-019; account/number/template/cost ownership is settled;
- OCR provider/model/region benchmark on Iraqi invoices and approved DPA/no-training/deletion terms under ADR-020; Azure is only a benchmark candidate;
- current CBI-licensed payment provider/role, pharmacy merchant/settlement contract and security/accounting acceptance under ADR-021; no provider is selected;
- official applicable federal/Kurdistan retail-pharmacy e-invoice mandate/specification plus Iraqi legal/accountant validation under ADR-021; current government/customs digitization is not assumed to be retail tax invoicing;
- Phase 2 evidence review of cloud provider, primary/DR region, Cloud Data Location Matrix, contract/DPA, subprocessors, support plan, cost, operating ownership, and ADR-022 targets; all are revalidated again before Phase 9 deployment;
- Windows signing, installer, and update policy;
- Phase 11 revalidation of ADR-023's exact Microsoft-supported Windows Pro x64 release, hardware minimum/recommendation, BitLocker recovery process, UPS/load, Certified Hardware Profiles, drivers/firmware, peripheral failure behavior, and support commitments.
- Q-022/ADR-024 implementation evidence for signing-key protection, manifest verification, release channels, update deferral/deadline values, migration compatibility, repair/recovery, offline bundles, terminal compatibility, and safe maintenance-window behavior.
- Q-023/ADR-025 implementation evidence for named step-up/dual-control permissions, distinct offline accounts, approval expiry/newest-state checks, thresholds, and accountant/legal acceptance of affected financial/privacy workflows.
- Q-024/ADR-026 implementation evidence for the local read-only external link, each paid connector's field/purpose/provider/region/retention contract, consent/basis, callback security, deletion behavior, and Iraqi legal/pharmacist validation for patient-linked data.
- Q-025/ADR-027 benchmark evidence on the minimum Certified Hardware Profile, final performance thresholds, WCAG2.2 AA/WCAG2ICT interpretation, AR/EN/RTL/LTR/keyboard/screen-reader/print evidence, and documented exceptions before release.

## Phase 0 rule

Phase 0 approval authorizes scheduling the Phase 1 Foundation only. It does not authorize production domain implementation, release of conditionally approved integrations, or bypassing the remaining phase and release gates above. Phase 1 may proceed only with the approved foundation tasks; later phases remain blocked by their own entry gates.
