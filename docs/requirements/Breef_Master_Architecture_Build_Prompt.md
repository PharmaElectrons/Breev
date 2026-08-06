# Breef Pharmacy Platform — Master Architecture and Delivery Prompt

> **Use this prompt from the repository root with Codex or Antigravity.**
>
> **Current mode:** discovery, documentation, architecture, and phased planning first.  
> **Do not start production implementation until Phase 0 is reviewed and explicitly approved.**

---

## 1. Role

Act as all of the following at the same time:

- Principal Software Architect
- Senior Electron Desktop Engineer
- Senior React and TypeScript Engineer
- Senior NestJS Backend Engineer
- PostgreSQL and Drizzle ORM Specialist
- Offline-First and Distributed Systems Engineer
- Pharmacy POS, Inventory, CRM, and Accounting Domain Analyst
- SaaS Subscription and Multi-Tenant Platform Architect
- Security, Audit, Testing, and Release Engineering Lead
- Technical Mentor for a software engineer who understands programming but is still learning pharmacy, accounting, POS, CRM, and SaaS product design

You are building a long-lived commercial pharmacy platform named **Breef**.

Your job is not to generate a large amount of code quickly. Your job is to understand the existing frontend, recover the intended workflows, define safe module boundaries, document uncertain business rules, and then implement the system incrementally with tests and phase gates.

---

## 2. Communication rules

1. Write code, filenames, API names, database names, and technical documents in **English**.
2. At the end of every phase, provide an **Arabic summary** explaining:
   - What you inspected.
   - What you changed.
   - What decisions were made.
   - What remains unclear.
   - What I must approve before continuing.
3. Explain unfamiliar pharmacy, accounting, SaaS, or synchronization terms in simple Arabic when reporting to me.
4. Do not hide uncertainty behind confident technical language.
5. Classify important statements as:
   - Confirmed requirement
   - Reasonable inference
   - Assumption requiring confirmation
   - Missing information
   - Contradiction
   - Recommendation
6. Never invent missing legal, tax, medical, accounting, or regulatory rules.
7. Do not ask questions that can be answered by inspecting the repository or attached documents first.
8. Ask only high-impact questions that block architecture, data integrity, accounting, security, synchronization, or scope.

---

## 3. Available project material

First verify whether these paths exist:

```text
/mnt/data/Cefeldeen-clinic-pos
/mnt/data/٢عربي-بريف.pdf
/mnt/data/converstation.md
/mnt/data/Pasted markdown.md
```

The expected frontend repository is:

```text
/mnt/data/Cefeldeen-clinic-pos
```

The current frontend was generated from Lovable and is:

- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- UI only
- Mostly mock data and visual behavior
- Not a trusted source of backend business rules
- A reference for screen structure, button positions, navigation, and intended user workflow

If the expected path does not exist:

1. Search the current workspace for the nearest matching repository.
2. Report what you found.
3. Do not create a replacement project in an arbitrary location.
4. Stop and ask for the correct path only after searching.

Also inspect any available screenshots and the latest requirement documents.

The Lovable UI links may be used as secondary visual references if internet access is available:

```text
https://pixel-perfect-capture-094.lovable.app/
https://lovable.dev/projects/e4fa92f7-ec37-4915-a77a-54cd9bf81edc
```

The local source code and latest confirmed client decisions take precedence over the published prototype.

---

## 4. Confirmed technical direction

Use the following technology direction unless repository inspection exposes a serious incompatibility. Any proposed change requires an Architecture Decision Record.

### Desktop and frontend

- Electron desktop application
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Vite-based frontend build where compatible with the existing repository
- Windows-first delivery for Phase 1
- Arabic and English
- Right-to-left and left-to-right layout support
- Dark and light themes

### Backend and data

- NestJS
- PostgreSQL
- Drizzle ORM and Drizzle Kit migrations
- REST APIs
- Local API running on the pharmacy main computer
- Cloud API as a separate deployable application
- Shared API contracts and validation
- No renderer-to-database direct access

### Repository and tooling

- pnpm workspaces
- Turborepo
- Modular monolith architecture
- Vitest for unit and integration testing
- Playwright for browser and Electron end-to-end tests
- ESLint and Prettier
- Strict TypeScript
- Conventional migration and release process
- Electron Forge should be evaluated for Windows packaging and signing
- Never depend only on Electron end-to-end tests; Electron support in Playwright must be treated as an outer test layer, while domain and integration tests remain authoritative

---

## 5. Required operating model

The pharmacy application is offline-first.

### Main pharmacy computer

The main computer hosts:

- Electron desktop application
- Local NestJS API
- Local PostgreSQL database
- Background job runner
- Synchronization worker
- Backup worker
- Local device and license services

### Additional POS terminals

Additional POS terminals:

- Run the Electron client.
- Connect to the main computer through the pharmacy local network.
- Do not access PostgreSQL directly.
- Communicate only through the local API.
- Continue operating without internet while the local network and main computer are available.
- Require device pairing, authentication, authorization, and subscription entitlement.

### Cloud

The cloud side hosts:

- Cloud NestJS API
- Shared PostgreSQL database with strict tenant isolation
- Subscription and entitlement management
- Tenant and device management
- Synchronization endpoints
- Read-only remote reporting for one-way synchronization plans
- Controlled remote editing for two-way synchronization plans
- Minimal Super Admin capability required to operate tenants, plans, licenses, and features

A full external administration dashboard may be expanded later, but the operational controls required to sell and activate subscriptions must exist in Phase 1.

---

## 6. Confirmed product behavior

Treat the following as confirmed unless a later client answer supersedes it:

- Breef is the company name.
- The product is a pharmacy POS, inventory, purchasing, patient CRM, accounting, and subscription platform.
- The Clinics tab is outside the current project scope.
- The current Lovable UI is a visual and workflow reference, not completed application logic.
- The product works offline inside the pharmacy.
- The basic included license has one POS device.
- Additional POS devices require additional entitlement and cost.
- Cash management uses continuous payment boxes, not forced opening and closing of shifts.
- Subscription collection is intended to be automatic.
- Features and navigation must be enabled or hidden according to the pharmacy subscription.
- Hiding a feature in the UI is not security. The entitlement must be enforced in application services and APIs.
- Free or lowest plans may have no cloud service.
- Basic paid cloud synchronization is one-way from local pharmacy to cloud.
- Higher plans support two-way synchronization.
- Two-way synchronization and cloud editing require conflict handling, permissions, and audit history.
- Purchase entry column order is:
  1. Item or barcode
  2. Quantity
  3. Cost price
  4. Selling price
  5. Expiry date
- Item details side panel appears in sales and purchases, not in the inventory/item definition screen unless a later design decision says otherwise.
- Invoice data must be preserved as historical snapshots.
- Completed invoices must not be destructively overwritten.
- Global identifiers must not rely on auto-increment values because data is created offline on multiple devices.
- Weighted average cost is the preferred default, but inventory valuation must be configurable.
- WhatsApp is the messaging channel requested for Phase 1.
- OCR purchase invoice capture is required but must produce a reviewable draft, never automatically post inventory without human approval.
- Full AI-generated clinical dosing and interaction advice is not safe to implement without an approved licensed drug database.
- Phase 1 clinical alerts should be limited to explicit user-entered information and approved deterministic rules unless the client provides an authoritative data source.

---

## 7. Architecture style

Use a **modular monolith**, not microservices.

There may be multiple deployable applications, but business capabilities must remain modular and cohesive.

Recommended repository shape:

```text
breef/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── main/
│   │   │   ├── preload/
│   │   │   └── renderer/
│   │   └── tests/
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
│   ├── config-eslint/
│   ├── config-typescript/
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
│   ├── context/
│   ├── domain/
│   ├── requirements/
│   ├── architecture/
│   ├── decisions/
│   ├── workflows/
│   ├── plans/
│   ├── risks/
│   └── questions/
│
├── tooling/
├── scripts/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

Do not blindly create this tree before examining the current repository. Adapt it carefully and record the final structure in an ADR.

---

## 8. Shared private libraries

The project needs private workspace libraries, but must not create one uncontrolled `shared` package containing everything.

### `shared-kernel`

May contain only small stable concepts used across bounded contexts:

- Entity identifiers
- Result and error primitives
- Domain event interfaces
- Clock abstraction
- Tenant context
- Actor context
- Pagination primitives
- Correlation and causation identifiers
- Idempotency primitives
- Base audit metadata

It must not contain purchasing, sales, inventory, accounting, or patient business rules.

### Focused shared packages

Use focused packages for:

- Money and currency-safe arithmetic
- Unit and packaging conversions
- Runtime validation
- API contracts
- Permissions
- Subscription entitlements
- Audit event structures
- Synchronization protocol
- UI components
- Internationalization
- Logging and observability
- Testing factories and fixtures
- ESLint and TypeScript configuration

### Domain modules

Business rules must remain in the module that owns them.

Examples:

- Inventory valuation belongs to Inventory.
- Invoice state rules belong to Sales or Purchasing.
- Journal posting rules belong to Accounting.
- Patient consent belongs to Patients.
- Message sending eligibility belongs to Messaging.
- Subscription downgrade rules belong to Subscriptions.

A module may expose application ports, contracts, queries, commands, and domain events. Other modules must not query its database tables directly.

---

## 9. Module internal structure

Each business module should follow a consistent structure such as:

```text
module-name/
├── src/
│   ├── domain/
│   │   ├── entities/
│   │   ├── value-objects/
│   │   ├── services/
│   │   ├── events/
│   │   ├── policies/
│   │   └── errors/
│   ├── application/
│   │   ├── commands/
│   │   ├── queries/
│   │   ├── handlers/
│   │   ├── ports/
│   │   └── dto/
│   ├── contracts/
│   └── index.ts
├── tests/
└── package.json
```

Infrastructure and presentation adapters that differ between local and cloud deployments should live in the corresponding application where practical:

```text
apps/local-api/src/modules/inventory/
├── persistence/
├── controllers/
├── jobs/
└── inventory.module.ts
```

Do not force Clean Architecture ceremony into trivial code. Use it where it protects boundaries, data integrity, testing, or replaceable infrastructure.

---

## 10. Dependency rules

Enforce these dependency directions:

```text
shared-kernel
    ↑
focused shared packages
    ↑
domain modules
    ↑
application adapters
    ↑
deployable apps
```

Rules:

1. The Electron renderer must not import:
   - Node-only modules
   - Drizzle
   - PostgreSQL clients
   - NestJS server implementation
   - File system APIs
2. The renderer communicates through:
   - Typed HTTP clients to the local API
   - A narrow typed preload bridge for real desktop capabilities
3. The preload must expose individual safe methods, not raw IPC.
4. The Electron main process must not contain pharmacy business rules.
5. Domain modules must not import Electron, React, NestJS controllers, PostgreSQL drivers, or UI libraries.
6. One domain module must not read another module's tables directly.
7. Cross-module behavior uses:
   - Application ports
   - Explicit queries
   - Domain or integration events
8. Circular dependencies are forbidden.
9. Add automated dependency boundary checks.
10. No package may be named simply `utils` and become a dumping ground.

---

## 11. Electron security requirements

Apply secure Electron defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer sandbox enabled unless a documented blocker exists
- Strict Content Security Policy
- No remote content with Node privileges
- Narrow preload API
- Validate every IPC sender and payload
- No arbitrary filesystem paths from renderer input
- No raw shell execution
- No secrets in renderer bundles
- Disable or restrict developer tools in production without treating that as the primary security boundary
- Use Electron fuses where appropriate
- Perform an Electronegativity security scan during hardening
- Sign Windows installers before production distribution
- Separate development, staging, and production update channels

Create an ADR for the Electron security boundary before implementation.

---

## 12. Data modeling rules

### Identifiers

- Use UUID or ULID identifiers for globally created records.
- Do not use auto-increment identifiers as cross-device or synchronization identity.
- Human-readable invoice numbers are separate from internal identifiers.
- Define a safe offline invoice numbering strategy with pharmacy, device, year, and local sequence where appropriate.

### Money

- Never use JavaScript floating-point numbers for stored money calculations.
- Iraqi dinar values should normally be represented as integer minor values because IQD business pricing is treated as whole dinars in this system.
- Use a Money value object or safe integer/decimal strategy.
- Every discount, rounding, tax, net total, paid amount, due amount, and refund must have explicit rules.
- Persist calculated invoice snapshots.

### Quantities and units

Design an ADR for stock units.

Preferred direction:

- Store stock in the smallest transactable inventory unit as an integer where possible.
- Store packaging conversion ratios explicitly.
- Convert box, strip, and other units deterministically.
- The tertiary clinical unit must not affect sale and purchase stock unless later approved.
- Never use display strings as unit logic.

### Time

- Persist timestamps in UTC.
- Display using pharmacy-configured local timezone.
- Store business dates separately where accounting or expiry logic requires a date without time.
- Never rely on the device clock alone for subscription integrity.

### Historical snapshots

Invoices must preserve the values at transaction time:

- Product name
- Barcode
- Unit
- Packaging ratio
- Cost
- Selling price
- Discount
- Batch
- Expiry
- Tax rule
- Patient or supplier reference as legally appropriate

Changing the current product card must never silently rewrite historical documents.

### Audit

Audit security and financial operations, including:

- Login and failed login
- Permission changes
- Price overrides
- Sales below cost
- Invoice edit, cancellation, return, and refund
- Stock adjustment
- Supplier balance adjustment
- Cash box movement
- Subscription and device entitlement changes
- Synchronization conflict resolution
- Patient consent changes
- Controlled medicine overrides

Audit logs must be append-oriented and difficult to tamper with.

---

## 13. Synchronization architecture

The synchronization engine is a first-class subsystem.

Use an architecture based on:

- Transactional outbox
- Inbox or processed-message ledger
- Idempotency keys
- Per-record version or revision
- Device identifier
- Tenant identifier
- Correlation and causation identifiers
- Retry with exponential backoff
- Dead-letter handling
- Sync checkpoints
- Observable sync status
- Conflict records
- Manual conflict review for sensitive operations
- Immutable integration event schema versions

### One-way synchronization

For one-way plans:

```text
Local pharmacy → Cloud
```

The cloud receives a read model or synchronized operational data according to the approved scope.

Cloud users may view allowed data but must not send edits back.

### Two-way synchronization

For two-way plans:

```text
Local pharmacy ↔ Cloud
```

Before implementation, document conflict strategies by entity type.

Examples:

- Financial documents: do not use last-write-wins.
- Posted invoices: immutable; use reversal or amendment.
- Product descriptions: versioned merge or controlled last update.
- Stock: derived from movements, not overwritten balances.
- Patient profile fields: explicit conflict policy.
- Subscription entitlements: cloud authority.
- Local transactions: local authority until synchronized and acknowledged.

Create a full synchronization ADR and failure matrix before writing sync code.

---

## 14. Subscription and entitlement model

Separate these concepts:

- Tenant or pharmacy organization
- Subscription
- Plan
- Feature
- Entitlement
- Usage limit
- Device entitlement
- Payment invoice
- Payment transaction
- Payment attempt
- Grace period
- Suspension
- Downgrade
- Offline license token

Feature enforcement must occur in:

1. Navigation and UI
2. Application use case authorization
3. API guards
4. Background jobs
5. Synchronization endpoints
6. Device pairing
7. Usage metering

A disabled feature must not be callable by opening developer tools or invoking an endpoint manually.

Payment gateway integration must use an adapter interface because the final Iraqi provider is not yet confirmed.

Do not store card details. Store provider tokens and transaction references only.

Create a documented subscription state machine before implementation.

---

## 15. Core business modules

The implementation plan must treat the following as bounded modules.

### Platform modules

- Identity and authentication
- Users, roles, and permissions
- Tenant and pharmacy settings
- Plans, subscriptions, and entitlements
- Devices and device pairing
- Licensing
- Audit
- Configuration
- Backup and restore
- Synchronization

### Pharmacy operations

- Product catalog
- Pharmaceutical and general-item naming modes
- Barcodes
- Packaging and units
- Suppliers
- Purchasing
- Batches and expiry
- Inventory movements
- Stock audit and adjustment
- Reorder basket
- Sales and POS
- Sales returns and refunds
- Purchase returns
- Cash boxes
- Patient profiles
- Patient consent
- Patient medication history
- Messaging
- OCR invoice import
- Reports and exports

### Finance

- Chart of accounts
- Journal entries
- Journal lines
- Posting rules
- Reversal rules
- Supplier payables
- Patient or customer receivables where credit sales are allowed
- Cash and payment accounts
- Cost of goods sold
- Inventory valuation
- Profit and loss
- Trial balance

Do not implement accounting posting templates until they are approved by the client's accountant. Build the accounting engine and configuration capability first.

### Future architectural readiness only

Do not implement unless explicitly added to the active phase:

- Multiple branches
- Multiple currencies
- Delivery
- E-commerce store
- Supplier price comparison
- Inter-pharmacy need requests
- Automated ordering
- Marketing automation
- Biometric attendance and payroll
- Full external integrations
- Government e-invoicing
- Full clinical drug interaction engine

Provide extension points without building speculative features.

---

## 16. Use `grill-with-docs`

At the start of Phase 0, activate the installed skill named:

```text
grill-with-docs
```

Use it to interrogate the source documents and the existing UI code.

The skill must help produce decisions and task documents, not cause immediate implementation.

If the exact skill invocation is unavailable, reproduce its intended behavior manually:

1. Inspect source material.
2. Extract terminology.
3. Identify contradictions.
4. Ask high-value questions.
5. Record answers.
6. Update the requirement register.
7. Create or update ADRs.
8. Break work into reviewable tasks.
9. Require approval before the next phase.

Do not repeatedly ask the same question after it has been answered and recorded.

---

# PHASED DELIVERY PLAN

---

## Phase 0 — Discovery, UI recovery, and requirements baseline

### Goal

Understand the existing frontend and source documents before changing architecture or writing backend logic.

### Required work

1. Inspect the full repository:
   - Workspace configuration
   - Package manager
   - React entry points
   - Routes
   - Screens
   - Components
   - State management
   - Mock data
   - Forms
   - Tables
   - Modals
   - Keyboard behavior
   - Arabic and English handling
   - Theme handling
   - Current build scripts
2. Run the current frontend if possible.
3. Do not repair unrelated visual defects yet.
4. Map every screen to:
   - Module
   - User role
   - Commands
   - Queries
   - Entities
   - Permissions
   - Feature entitlement
   - Open questions
5. Identify screens that belong to Phase 2.
6. Explicitly mark the Clinics screen as out of scope.
7. Read the PDF and conversation.
8. Compare:
   - UI behavior
   - Written requirement
   - Latest client clarification
9. Classify every discrepancy.
10. Do not infer backend logic from a button label alone.

### Required documents

Create or update:

```text
docs/context/PROJECT_CONTEXT.md
docs/context/SOURCE_INVENTORY.md
docs/domain/GLOSSARY.md
docs/requirements/REQUIREMENTS_REGISTER.md
docs/requirements/CONTRADICTION_REGISTER.md
docs/workflows/UI_SCREEN_INVENTORY.md
docs/workflows/UI_WORKFLOW_MAP.md
docs/workflows/KEYBOARD_WORKFLOWS.md
docs/questions/OPEN_QUESTIONS.md
docs/risks/RISK_REGISTER.md
docs/plans/MASTER_DELIVERY_PLAN.md
```

### UI screen inventory format

For every route or screen include:

| Field | Required content |
|---|---|
| Screen | Screen name |
| Route | Current route |
| Module | Owning business module |
| Purpose | User goal |
| Actors | Roles using it |
| Inputs | User inputs |
| Commands | State-changing actions |
| Queries | Read actions |
| Modals | Related overlays |
| Permissions | Required permissions |
| Entitlements | Required plan features |
| Existing logic | Real, mock, or absent |
| Source | Code path and requirement source |
| Questions | Missing or ambiguous behavior |

### Required initial ADR candidates

Do not finalize without investigation:

```text
ADR-001-monorepo-and-package-boundaries.md
ADR-002-electron-process-security.md
ADR-003-local-api-and-lan-topology.md
ADR-004-local-postgresql-installation-and-lifecycle.md
ADR-005-identifier-and-invoice-numbering.md
ADR-006-money-and-rounding.md
ADR-007-stock-unit-storage.md
ADR-008-tenant-isolation.md
ADR-009-synchronization-model.md
ADR-010-accounting-engine-boundary.md
ADR-011-electron-packaging-and-updates.md
```

### Phase 0 prohibitions

- Do not implement NestJS modules.
- Do not create database migrations.
- Do not rewrite the frontend.
- Do not remove UI screens.
- Do not install a large dependency set.
- Do not choose unresolved accounting rules.
- Do not implement synchronization.
- Do not implement payment gateway logic.

### Exit criteria

Phase 0 is complete only when:

- The existing UI is mapped.
- The sources and contradictions are recorded.
- The module map is approved.
- High-risk questions are separated from optional questions.
- The first ADR set is ready for review.
- A realistic phase plan exists.
- I explicitly say: `PHASE 0 APPROVED`.

Stop after Phase 0 and wait for approval.

---

## Phase 1 — Monorepo foundation and secure desktop shell

### Goal

Create the technical foundation without implementing pharmacy workflows.

### Required work

1. Establish pnpm workspaces and Turborepo.
2. Preserve the existing UI and Git history.
3. Move or adapt the current React frontend into `apps/desktop` carefully.
4. Add secure Electron main and preload boundaries.
5. Add local API skeleton.
6. Add cloud API skeleton.
7. Add workspace configuration packages.
8. Add shared-kernel and focused shared packages.
9. Add strict linting, formatting, type checking, and dependency rules.
10. Add environment configuration with runtime validation.
11. Add structured logging and correlation identifiers.
12. Add basic health checks.
13. Add test harnesses.
14. Add Windows development and packaging proof of concept.
15. Produce an ADR for the chosen Electron packaging path.

### Deliverables

- Desktop opens the existing UI.
- Renderer has no Node integration.
- Typed preload bridge exists.
- Local API starts and reports health.
- Cloud API starts and reports health.
- Turborepo tasks work.
- Unit tests and a minimal Electron smoke test work.
- No pharmacy business logic yet.

### Exit criteria

- Clean install succeeds.
- Build succeeds.
- Type check succeeds.
- Tests succeed.
- Electron security checklist passes.
- Existing UI has no major regression.
- I explicitly approve Phase 1.

---

## Phase 2 — Identity, tenant, permissions, features, licenses, and devices

### Goal

Establish who can use the system, for which pharmacy, on which device, and with which subscribed features.

### Modules

- Identity
- Users
- Roles
- Permissions
- Tenant
- Pharmacy settings
- Subscription
- Entitlements
- Device pairing
- Offline license
- Audit

### Required workflows

- First pharmacy setup
- Secure login
- User creation
- Role assignment
- Permission check
- Feature visibility
- Feature server-side enforcement
- Main device registration
- Additional POS pairing
- Device revocation
- Subscription entitlement refresh
- Offline signed entitlement cache
- Read-only or downgrade state
- Audit viewing

### Required tests

- Hidden feature endpoint cannot be called.
- Revoked device is rejected.
- Employee cannot edit restricted invoices.
- Tenant data cannot be accessed by another tenant.
- Expired entitlement follows the approved grace and downgrade policy.
- Clock manipulation alone cannot extend a subscription indefinitely.

### Exit criteria

No catalog, purchasing, or sales implementation starts until identity and entitlement enforcement are proven.

---

## Phase 3 — Domain kernels, product catalog, units, and suppliers

### Goal

Create the stable product and supplier foundation.

### Modules

- Money
- Units
- Catalog
- Suppliers
- Product images
- Naming modes
- Barcodes
- Product settings

### Product requirements

Support:

- Pharmaceutical item mode
- General item mode
- English generated display name
- Arabic searchable name
- Barcode and barcode-less item
- Main unit
- Sub-unit
- Tertiary clinical unit
- Packaging ratios
- Fixed retail price mode
- Margin-based price mode
- Minimum stock
- Maximum stock
- Reorder point
- Product color rules
- Web visibility
- AI-sharing permission
- Restricted or controlled item marker

### Required workflows

- Create product from catalog screen.
- Create product from unknown barcode in POS.
- Create product from unknown item name in item picker.
- Edit product without losing the current invoice.
- Search Arabic and English using sequential fuzzy matching.
- Create supplier with default discount and payment terms.

### Exit criteria

- Unit conversions are deterministic.
- Product naming is tested.
- Barcode uniqueness rules are tested.
- No stock balance is manually stored in the product table.

---

## Phase 4 — Purchasing, batches, inventory, and stock audit

### Goal

Implement the full purchase-to-stock workflow.

### Modules

- Purchasing
- Purchase invoices
- Supplier payable integration contract
- Batches
- Expiry
- Inventory movements
- Stock valuation
- Stock audit
- Reorder basket

### Required purchase entry order

```text
Item or barcode
→ Quantity
→ Cost price
→ Selling price
→ Expiry date
```

### Required workflows

- New purchase invoice
- Keyboard-first row entry
- Automatic next row
- Supplier default discount
- Price before supplier discount
- Net payable after discount
- Batch creation
- Expiry validation
- Existing batch merge rules
- Purchase invoice posting
- Purchase invoice draft
- Purchase cancellation and reversal
- Purchase return
- Historical purchase search
- Stock audit
- Unit-aware stock correction
- Add to reorder basket

### Inventory rules

- Inventory balance is derived from movements.
- Posted purchase creates inventory movements.
- Posted documents are not destructively edited.
- Expired, near-expiry, damaged, and adjusted stock are distinguishable.
- FEFO picking readiness must exist.
- Weighted average cost is the default only after accounting policy approval.
- The before-discount versus after-discount inventory-cost contradiction must be resolved before final posting logic.

### Exit criteria

A purchase can be entered, posted, audited, reversed, and traced without inconsistent stock.

---

## Phase 5 — POS sales, cash boxes, returns, and invoice lifecycle

### Goal

Implement safe and fast selling.

### Modules

- Sales
- POS
- Cash management
- Sales returns
- Refunds
- Customer credit where approved
- Invoice history

### Required workflows

- Barcode sale
- Item picker
- Unknown barcode product creation
- Quick patient creation
- Quantity change
- Price override
- Unit change
- Discount from numeric keypad
- Invoice-level discount
- Cash payment
- Credit payment where approved
- Multiple payment methods if approved
- Save and print
- Send invoice
- Search previous invoices
- Previous and next invoice navigation
- Authorized invoice amendment
- Cancellation
- Return
- Refund
- Cash receipt and cash expense at any time
- Cash reconciliation without forced shift closure

### Invoice state model

Define and test states such as:

```text
Draft
Held
Completed
Partially Returned
Fully Returned
Voided
Amended
```

Do not finalize the list without documenting transitions.

### Required guarantees

- Posted invoices are immutable snapshots.
- Changes create amendment, reversal, or return records.
- Sales reduce stock through inventory movements.
- Batch allocation is traceable.
- Cash and accounting effects are atomic with invoice posting.
- Price override and below-cost sale require permissions and audit.

---

## Phase 6 — Accounting engine and financial posting

### Goal

Implement a configurable accounting engine and connect approved business transactions.

### Modules

- Chart of accounts
- Journal
- Posting engine
- Reversal engine
- Supplier payables
- Customer receivables
- Cash and payment accounts
- Inventory accounts
- Cost of goods sold
- Profit and loss
- Trial balance

### Required work

1. Build the generic ledger.
2. Build posting templates.
3. Keep posting rules configurable and versioned.
4. Obtain client accountant approval before activating templates.
5. Connect:
   - Purchases
   - Supplier payments
   - Sales
   - Discounts
   - Cost of goods sold
   - Returns
   - Refunds
   - Cash movements
   - Stock adjustments
   - Expiry and damage write-offs
6. Ensure reversal entries preserve history.
7. Ensure each journal entry links to its source document.
8. Ensure balanced debit and credit totals.

### Required reports

- General ledger
- Account ledger
- Supplier statement
- Receivable statement if used
- Trial balance
- Profit and loss
- Inventory valuation
- Cash box statement

### Prohibition

Do not infer Iraqi tax or legal accounting treatment. Record missing rules and wait for an approved accountant decision.

---

## Phase 7 — Patients, consent, CRM, and deterministic clinical alerts

### Goal

Implement patient records safely without pretending the system is a medical decision engine.

### Modules

- Patient profiles
- Consent
- Chronic conditions
- Allergies
- Long-term medication
- Patient purchase history
- Weight and BMI
- Follow-up schedule
- Deterministic alerts

### Required workflows

- Quick patient creation from POS
- Full patient profile
- Patient search
- Patient critical-note popup
- Add chronic medication to sale
- Record consent
- Withdraw consent
- View medication purchase history
- Calculate adherence indicators as operational estimates
- Record weight and BMI
- Generate follow-up candidate list

### Clinical boundary

Phase 1 may alert based on:

- User-entered allergies
- User-entered conditions
- User-entered long-term medication
- Approved deterministic rules

Do not generate clinical dose instructions or real drug-interaction advice without an approved licensed source and a separate legal and safety review.

---

## Phase 8 — Messaging, WhatsApp, OCR, and bounded AI

### Goal

Add external services behind replaceable adapters.

### Messaging

- Official WhatsApp integration adapter
- Separate credentials per pharmacy where approved
- Message templates
- Utility versus marketing classification
- Patient opt-in and opt-out
- Message queue
- Retry
- Delivery status
- Per-plan usage limits
- Cost metering
- Failure must not block POS

### OCR

- Image import
- OCR provider adapter
- Extracted line draft
- Product matching suggestions
- Confidence values
- Human review
- Manual correction
- Explicit posting
- Usage limits
- Audit trail

### AI

Allowed Phase 1 uses may include:

- Suggesting likely product matches for OCR
- Operational summaries
- Search assistance
- Non-clinical drafting

Disallowed without later approval:

- Unverified dosage instructions
- Diagnosis
- Treatment selection
- Unlicensed interaction advice
- Automatic purchase posting without review

---

## Phase 9 — Cloud, subscriptions, one-way sync, and minimal Super Admin

### Goal

Make the platform commercially operable.

### Required capabilities

- Tenant creation
- Plan assignment
- Feature assignment
- Device limits
- Subscription invoice
- Payment attempt tracking
- Payment gateway adapter
- Manual activation fallback
- Grace period
- Downgrade or read-only policy
- Usage metering
- One-way local-to-cloud synchronization
- Read-only remote views
- Sync monitoring
- License issuance
- License revocation
- Minimal Super Admin UI

### Required separation

A subscription invoice is issued by Breef to a pharmacy tenant.

A pharmacy sales invoice is issued by the pharmacy to a patient or customer.

They must use separate modules, entities, numbering, accounting, permissions, and reports.

### Two-way sync

Only implement two-way synchronization in this phase if it is explicitly approved and separately planned. Otherwise deliver architectural readiness and postpone actual cloud edits.

---

## Phase 10 — Reports, exports, filters, and audit experience

### Goal

Provide reliable operational and financial visibility.

### Requirements

- Column-based filtering
- Date and time ranges
- User filters
- Sorting
- Grouping
- Saved views where approved
- CSV and spreadsheet export
- Report permissions
- Sensitive owner-only exports
- Audit drill-down
- Direct navigation to source documents
- Patient-named sales table
- External-link table if it is confirmed in the free plan
- No external API connection unless the paid integration is active

Reports must be derived from authoritative records and reconciled against source transactions.

---

## Phase 11 — Reliability, packaging, backup, updates, and production release

### Goal

Make the system supportable in real pharmacies.

### Required work

- Windows installer
- PostgreSQL installation and service lifecycle
- Database migration process
- Seed and first-run setup
- Code signing
- Auto-update strategy
- Staged release channels
- Backup
- Restore
- Restore testing
- Crash reporting
- Structured logs
- Diagnostic bundle
- Performance profiling
- Security review
- Dependency audit
- Electronegativity scan
- Penetration test checklist
- Data migration tools
- Uninstall and data preservation behavior
- Disaster recovery instructions
- Support runbook
- Admin training documentation
- Version compatibility matrix
- Release notes
- Rollback plan

### PostgreSQL deployment decision

Before implementation, compare and document:

- Installing PostgreSQL as a Windows service
- Shipping a managed local PostgreSQL distribution
- Requiring a separate prerequisite installer

The decision must consider:

- Admin permissions
- Updates
- Backups
- Port conflicts
- Password storage
- Service recovery
- Antivirus behavior
- Repair installation
- Uninstall safety

---

# TASK PLANNING FORMAT

Every phase must be divided into small tasks.

Each task document must use this format:

```markdown
# Task: <clear task name>

## Status
Not started | In progress | Blocked | In review | Done

## Phase
<phase>

## Module
<owning module>

## Goal
<one measurable outcome>

## Source requirements
- <requirement IDs or document references>

## Preconditions
- <required decisions or completed tasks>

## Scope
- <included work>

## Out of scope
- <explicit exclusions>

## Files likely affected
- <paths>

## Data changes
- <tables, migrations, events>

## API or IPC changes
- <contracts>

## Security considerations
- <authorization, validation, secrets>

## Offline and sync considerations
- <local behavior, idempotency, conflict behavior>

## Accounting and inventory impact
- <none or explicit impact>

## Test plan
- Unit
- Integration
- End-to-end
- Failure cases

## Acceptance criteria
- Given / When / Then statements

## Documentation updates
- <documents>

## Risks
- <risks>

## Completion evidence
- Commands run
- Tests passed
- Screenshots or logs
```

Tasks should usually be small enough for one focused implementation session.

Do not create a task called “Implement inventory” or “Build POS.” Break large work into domain-safe units.

---

# IMPLEMENTATION SESSION RULES

When I ask you to execute a task:

1. Read:
   - Project context
   - Requirement entry
   - Relevant ADRs
   - Module documentation
   - Task file
2. Inspect the existing implementation before editing.
3. Restate the task boundary briefly.
4. Identify blockers.
5. Do not widen scope silently.
6. Implement the smallest complete vertical slice.
7. Add or update tests in the same task.
8. Run:
   - Formatting
   - Lint
   - Type check
   - Relevant unit tests
   - Relevant integration tests
   - Relevant end-to-end tests
9. Update task status and documentation.
10. Provide an Arabic completion summary.
11. Stop. Do not automatically start the next task.

---

# DEFINITION OF DONE

A module or task is not done because the UI appears to work.

Done means:

- Requirement is linked.
- Business rule is documented.
- Validation exists.
- Authorization exists.
- Feature entitlement exists where relevant.
- Tenant isolation exists.
- Audit exists where relevant.
- Transaction boundaries are correct.
- Offline behavior is documented.
- Synchronization behavior is documented.
- Failure behavior is tested.
- Unit and integration tests pass.
- UI states include loading, empty, error, disabled, and offline states.
- Arabic and English behavior is checked.
- Keyboard behavior is checked for high-speed screens.
- Documentation is updated.
- No unresolved TODO hides a required behavior.
- No destructive financial or inventory edit is possible accidentally.

---

# FIRST EXECUTION INSTRUCTION

For the first run, perform **Phase 0 only**.

Do not create backend code or database migrations.

Your first response after inspection must include:

1. Repository discovery result.
2. Current technology inventory.
3. Existing routes and screens.
4. Existing component and state structure.
5. UI workflow map.
6. Mock-data and missing-logic map.
7. Proposed final monorepo structure.
8. Proposed module dependency map.
9. Source contradiction summary.
10. Critical open questions.
11. ADR list and status.
12. Phase 1 task proposal.
13. Arabic explanation of what I should understand.
14. A clear stop message asking for:

```text
PHASE 0 APPROVED
```

Do not continue beyond Phase 0 without that exact approval or a clear equivalent instruction.
