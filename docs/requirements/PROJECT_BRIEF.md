# Breef Pharmacy Platform — Project Brief

## 1. Project Overview

**Breef** is a commercial pharmacy management platform designed for pharmacies that need to keep working even when the internet is unavailable.

The product combines:

- Desktop point of sale
- Purchasing and supplier management
- Inventory, batches, and expiry tracking
- Patient CRM and medication history
- Accounting and cash management
- Subscription plans and feature access
- Local network support for additional POS devices
- Optional cloud synchronization
- WhatsApp messaging
- OCR-assisted purchase invoice entry
- Reporting, auditing, and exports

The current frontend is a Lovable-generated React interface. It is mainly a visual and workflow reference and does not contain trusted business logic.

---

## 2. Primary Goal

Build a stable, secure, offline-first pharmacy desktop system that can later be sold to multiple pharmacies using subscription plans.

The product must:

1. Continue basic pharmacy operations without internet.
2. Support one main computer as the local system host.
3. Allow additional POS devices through the pharmacy local network.
4. Enable or disable features according to the pharmacy subscription.
5. Preserve accurate inventory, financial, patient, and audit records.
6. Synchronize allowed data with the cloud according to the active plan.
7. Remain modular and extendable for later phases.

---

## 3. Current Source Material

The project should be understood from these sources:

- Existing frontend repository:
  - `/mnt/data/Cefeldeen-clinic-pos`
- Pharmacy requirements PDF
- Client and freelancer conversation
- Lovable prototype and screenshots
- Confirmed client clarifications
- The master architecture and delivery prompt

Source priority when requirements conflict:

1. Latest confirmed client clarification
2. Confirmed meeting summary
3. Latest requirements document
4. Lovable prototype
5. Developer proposals that were not confirmed

---

## 4. Technology Stack

### Desktop and Frontend

- Electron.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Vite where compatible

### Backend

- NestJS
- REST APIs

### Database

- PostgreSQL
- Drizzle ORM
- Drizzle Kit migrations

### Repository and Tooling

- pnpm workspaces
- Turborepo
- Modular monolith
- Vitest
- Playwright
- ESLint
- Prettier
- Strict TypeScript

### Target Platform

- Windows first
- Arabic and English
- Right-to-left and left-to-right layouts
- Light and dark themes

---

## 5. Deployment Model

### Main Pharmacy Computer

The main computer hosts:

- Electron desktop application
- Local NestJS API
- Local PostgreSQL database
- Synchronization worker
- Backup worker
- Local license and device services

### Additional POS Devices

Additional POS devices:

- Run the Electron client.
- Connect to the local API over the pharmacy network.
- Do not connect directly to PostgreSQL.
- Require a paid device entitlement.
- Continue working without internet while the main computer and local network are available.

### Cloud

The cloud side hosts:

- Cloud NestJS API
- Shared PostgreSQL database with tenant isolation
- Subscription and entitlement management
- Device and tenant management
- Synchronization endpoints
- Read-only remote access for one-way synchronization plans
- Controlled cloud editing for two-way synchronization plans
- Minimal Super Admin operations

---

## 6. Confirmed Business Decisions

- **Breef** is the company name.
- The product is a pharmacy platform, not a clinic system.
- The Clinics tab is outside the current scope.
- The basic included license has one POS device.
- Each additional POS device has an additional cost.
- Cash management uses continuous payment boxes, not forced shift opening and closing.
- Subscription fees should be collected automatically.
- Disabled features must be hidden from the UI and blocked in APIs and application services.
- The free or lowest plan may work without cloud synchronization.
- The basic paid synchronization plan is one-way from the pharmacy to the cloud.
- Higher plans support two-way synchronization.
- Two-way synchronization and cloud editing are advanced features.
- The purchase entry column order is:
  1. Item or barcode
  2. Quantity
  3. Cost price
  4. Selling price
  5. Expiry date
- Product details side panels are used in sales and purchases.
- Historical invoices must preserve transaction-time data.
- Completed invoices must not be destructively overwritten.
- Global record identifiers must not depend on auto-increment values.
- Weighted average cost is the preferred default inventory valuation method, but the system should allow configuration.
- WhatsApp is the messaging channel requested for Phase 1.
- OCR purchase invoice import must create a reviewable draft before posting.
- Full AI clinical advice must not be implemented without an approved medical data source.
- Phase 1 clinical alerts should be limited to explicit user-entered data and approved deterministic rules.

---

## 7. Main Product Modules

### Platform

- Identity and authentication
- Users
- Roles and permissions
- Pharmacy settings
- Tenant management
- Subscription plans
- Feature entitlements
- Device pairing and licensing
- Audit logs
- Backup and restore
- Synchronization

### Pharmacy Operations

- Product catalog
- Pharmaceutical naming
- General item naming
- Barcodes
- Packaging and units
- Suppliers
- Purchasing
- Purchase invoices
- Batches
- Expiry dates
- Inventory movements
- Stock audit and correction
- Reorder basket
- Sales and POS
- Sales returns
- Purchase returns
- Refunds
- Cash boxes
- Patient profiles
- Patient medication history
- Patient consent
- Messaging
- OCR purchase invoice import
- Reports and exports

### Finance

- Chart of accounts
- Journal entries
- Journal lines
- Posting rules
- Reversal rules
- Supplier payables
- Customer or patient receivables where approved
- Cash and payment accounts
- Inventory valuation
- Cost of goods sold
- Profit and loss
- Trial balance

---

## 8. Shared Private Libraries

Shared logic must be divided into focused private workspace packages.

Recommended packages:

- `shared-kernel`
- `contracts`
- `validation`
- `money`
- `units`
- `permissions`
- `entitlements`
- `audit`
- `sync-protocol`
- `ui`
- `i18n`
- `observability`
- `testing`

The project must not create one uncontrolled shared package containing unrelated code.

Business rules stay inside the module that owns them.

Examples:

- Inventory valuation belongs to Inventory.
- Invoice state rules belong to Sales or Purchasing.
- Accounting posting belongs to Accounting.
- Patient consent belongs to Patients.
- Message eligibility belongs to Messaging.
- Subscription downgrade rules belong to Subscriptions.

---

## 9. Proposed Repository Shape

```text
breef/
├── apps/
│   ├── desktop/
│   ├── local-api/
│   ├── cloud-api/
│   ├── super-admin/
│   └── migration-tools/
│
├── packages/
│   ├── shared-kernel/
│   ├── contracts/
│   ├── validation/
│   ├── money/
│   ├── units/
│   ├── permissions/
│   ├── entitlements/
│   ├── audit/
│   ├── sync-protocol/
│   ├── database-local/
│   ├── database-cloud/
│   ├── ui/
│   ├── i18n/
│   ├── observability/
│   ├── testing/
│   └── modules/
│       ├── identity/
│       ├── tenants/
│       ├── subscriptions/
│       ├── catalog/
│       ├── suppliers/
│       ├── purchasing/
│       ├── inventory/
│       ├── sales/
│       ├── returns/
│       ├── cash-management/
│       ├── accounting/
│       ├── patients/
│       ├── messaging/
│       ├── ocr/
│       ├── reporting/
│       └── synchronization/
│
├── docs/
├── tooling/
├── scripts/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

The final structure must be adapted after inspecting the current frontend repository.

---

## 10. Important Architecture Rules

- Use a modular monolith, not microservices.
- The Electron renderer must not access PostgreSQL directly.
- The renderer must not use Node APIs directly.
- Desktop-specific functionality must go through a narrow preload bridge.
- The Electron main process must not contain pharmacy business logic.
- Domain modules must not import React, Electron, NestJS controllers, or database drivers.
- A module must not read another module's tables directly.
- Cross-module behavior should use explicit application interfaces and events.
- Circular dependencies are forbidden.
- No package should become a general-purpose dumping ground.

---

## 11. Data Integrity Rules

### Identifiers

- Use UUID or ULID for globally created records.
- Human-readable invoice numbers are separate from internal identifiers.
- Invoice numbering must work safely when devices operate offline.

### Money

- Do not use JavaScript floating-point numbers for stored money calculations.
- Iraqi dinar values should normally use safe integer values.
- Discounts, rounding, taxes, totals, payments, due amounts, and refunds must have explicit rules.

### Inventory

- Store stock using a consistent smallest transactable unit where practical.
- Packaging conversion ratios must be explicit.
- Inventory balance must be derived from inventory movements.
- Batches and expiry dates are core inventory data.
- Posted documents must affect stock through traceable movements.

### Historical Documents

Sales and purchase invoices must preserve transaction-time snapshots.

Changing the current product card must never alter historical invoice data.

### Audit

Important operations must be audited, including:

- Login attempts
- Permission changes
- Price overrides
- Sales below cost
- Invoice amendment or cancellation
- Returns and refunds
- Stock adjustments
- Supplier balance changes
- Cash movements
- Subscription and device changes
- Sync conflict resolution
- Patient consent changes

---

## 12. Synchronization Principles

Synchronization is a first-class module.

It should use:

- Transactional outbox
- Processed-message tracking
- Idempotency keys
- Device identifiers
- Tenant identifiers
- Record versions
- Retry handling
- Sync checkpoints
- Conflict records
- Observable sync status

### One-Way Sync

```text
Local pharmacy → Cloud
```

Used for remote viewing and cloud reporting.

### Two-Way Sync

```text
Local pharmacy ↔ Cloud
```

Requires conflict rules by data type.

Financial documents must not use simple last-write-wins behavior.

Posted invoices should be amended or reversed, not overwritten.

Stock should be derived from movements, not replaced by a cloud balance.

---

## 13. Subscription Principles

Separate these concepts:

- Pharmacy tenant
- Plan
- Subscription
- Feature
- Entitlement
- Usage limit
- Device entitlement
- Subscription invoice
- Payment attempt
- Payment transaction
- Grace period
- Suspension
- Downgrade
- Offline license

A pharmacy subscription invoice is not the same as a pharmacy sales invoice.

Feature checks must exist in:

- Navigation
- UI actions
- Application services
- APIs
- Background jobs
- Sync endpoints
- Device pairing
- Usage metering

---

## 14. Delivery Phases

### Phase 0 — Discovery

- Inspect the current frontend.
- Map routes, screens, components, workflows, and mock data.
- Read all source documents.
- Record contradictions and missing requirements.
- Create architecture decisions and a delivery plan.
- Do not implement backend or database logic.

### Phase 1 — Foundation

- Monorepo
- Secure Electron shell
- Local API
- Cloud API
- Shared libraries
- Testing and build setup
- Windows packaging proof of concept

### Phase 2 — Platform Security

- Authentication
- Users
- Roles
- Permissions
- Tenant settings
- Subscriptions
- Features
- Devices
- Offline licenses
- Audit

### Phase 3 — Catalog and Suppliers

- Products
- Pharmaceutical and general naming
- Barcodes
- Units
- Packaging
- Suppliers

### Phase 4 — Purchasing and Inventory

- Purchase invoices
- Supplier discounts
- Batches
- Expiry
- Inventory movements
- Stock audit
- Reorder basket

### Phase 5 — POS and Cash

- Sales
- Discounts
- Price and quantity changes
- Cash boxes
- Returns
- Refunds
- Invoice lifecycle

### Phase 6 — Accounting

- Chart of accounts
- Journal entries
- Posting and reversal
- Payables
- Receivables
- Cost of goods sold
- Profit and loss
- Trial balance

### Phase 7 — Patients

- Patient profiles
- Consent
- Chronic conditions
- Allergies
- Medication history
- Limited deterministic alerts

### Phase 8 — External Services

- WhatsApp
- OCR
- Bounded AI
- Usage limits
- External service adapters

### Phase 9 — Cloud and Subscriptions

- Tenant activation
- Subscription billing
- Payment attempts
- One-way synchronization
- Minimal Super Admin
- Remote read-only views

### Phase 10 — Reports

- Filtering
- Sorting
- Grouping
- Exports
- Audit drill-down
- Financial and operational reports

### Phase 11 — Production Release

- Windows installer
- PostgreSQL lifecycle
- Backups
- Restore
- Updates
- Signing
- Diagnostics
- Monitoring
- Support documentation

---

## 15. Current Major Open Questions

The following decisions still require confirmation or professional approval:

- Iraqi tax treatment for pharmacy sales
- Legal invoice numbering and retention rules
- Controlled medicine requirements
- Patient data consent and retention
- Final WhatsApp account model
- Automatic payment gateway
- Grace period and downgrade behavior
- Inventory cost treatment before and after supplier discount
- Final accounting posting rules
- Licensed clinical drug information source
- Cloud data region and backup policy
- Final product name shown to users

These questions must not be silently answered by the implementation team.

---

## 16. First Required Action

The first AI execution must perform **Phase 0 only**.

It must:

1. Inspect the current repository.
2. Read the available requirement sources.
3. Recover the intended workflows from the frontend.
4. Map screens to modules.
5. Identify mock data and missing logic.
6. Propose the final monorepo structure.
7. Create the initial architecture decisions.
8. Produce a realistic phased plan.
9. Stop and wait for approval.

No backend code or database migration should be created before Phase 0 is approved.

The approval phrase is:

```text
PHASE 0 APPROVED
```
