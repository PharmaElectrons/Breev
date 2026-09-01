# Source and requirement traceability

## Current requirement sources

The client's business requirements live in `docs/requirements/`. [`README.md`](README.md) defines the authority order. The three sources are:

| Source | Role |
|---|---|
| [`requirements/breev-phase1-mvp-scope.md`](requirements/breev-phase1-mvp-scope.md) | Governing Phase One scope, v1.2 of 9 August 2026. Latest and most specific; its own conflict rule makes the latest approved specific written clarification win. |
| [`requirements/client-chat.md`](requirements/client-chat.md) | Chronological client/developer record. Later entries supersede earlier ones; it also carries commercial terms (maintenance tiers, first-offer right, SLA) reflected in `delivery.md`. |
| [`requirements/project-breif/`](requirements/project-breif/) | The client's detailed draft with 52 interface images. Details are commitments only where the scope incorporates them (scope §Document control); otherwise supporting evidence. |

Dated stakeholder decisions about engineering evidence and gate staging change none of these sources. They are recorded where they take effect, in [`open-decisions.md`](open-decisions.md), and the reconciliations below name the requirement each one restages.

The pre-consolidation documentation baseline (the earlier 238-row register and its since-removed sources) is preserved at Git commit `6ddc0431b58a43efdbc3bf2899e3f6251cd69c82` for archaeology only.

## Coverage map

Every business-requirement area of the governing scope maps to one owning document. Acceptance-level detail lives in the owner, not here.

| Scope area | Requirement | Owning documents |
|---|---|---|
| §1–§2 product model, offline-first, devices, units/sync model | Plans/add-ons, offline local authority, four-device testing without a hard-coded limit, integer unit model, one-way sync | `product.md`; `domain.md` (units, sync); `architecture.md` (chosen runtime) |
| §3.1 login, users, permissions, attendance | Mandatory login, role set, configurable permissions, audit of sensitive changes, optional manual attendance | `product.md`; `domain.md` (identity/authorization) |
| §3.2–§3.3 plans, feature control, Super Admin | Per-pharmacy licensing, hidden disabled features, founder grants, device counts, expiry behavior, Super Admin minimum | `product.md`; expiry rule pending in `open-decisions.md` |
| §3.4 dashboard and alerts | Summaries, sortable item-summary fields, unified notification center | `product.md` |
| §4 item definition, search, packaging, pricing | Two naming modes, Arabic name, ordered sequential search with acceptance example, base/sub units, third unit (days/dosage only), By Price / By Percentage, margin-on-selling-price, rounding, colors, movement history, barcode actions, daily matching | `domain.md` (catalog and pricing rules); `workflows.md` |
| §5 sales and POS | Full POS flow, suspend/preserve/confirm, quick patient and item creation, patient context, controls and calculator, saved-invoice viewing with returns-only correction, panel fields, drawer balance, expired/damaged approval flow, quick access, reorder from sales | `workflows.md` (Sell and settle); `domain.md` (settlement, write-off) |
| §6 purchases, suppliers, OCR | Entry order and keyboard flow, allowance snapshots, dual cost values, Purchase Invoice Adjustment (Delta) with A-numbered identifiers and conflict blocking, purchase returns, no deletion, OCR as reviewed draft | `domain.md`; `workflows.md`; `product.md` (OCR boundary) |
| §7 inventory, stocktaking, reorder | Read-only inventory with approved columns, owner-only export, quick stocktake with unit combinations, reorder basket (max − current) and Ordered Items | `domain.md`; `workflows.md` (Count) |
| §8 patients, CRM, messaging, AI boundaries | Profile contents, purchase history with continuation indicators, weight/BMI, automatic discount, Do Not Disturb, follow-up/reservations, templates and scheduling, Phase One AI limits | `domain.md` (patients, messaging); `product.md` (AI boundaries); `workflows.md` |
| §9 cash accounts and accounting | Employee drawers without shift locking, start/end reconciliation, chart of accounts, vouchers with editable business date + immutable creation time, statements, Ledger source of truth, main accounts, pre-discount cost basis, settlement allowances and allowance differences, card commissions, debt aging, traceable transaction list | `domain.md` (accounting sections) |
| §10 search lists, reports, audit, export | Per-type search popups, essential report catalogue, From/To and user filters, owner-password exports, Excel-like named-patient table + read API + Sheets guidance | `domain.md` (reports); `product.md` (spreadsheet boundary); `workflows.md` |
| §11 cloud services | One-way upload, read-only remote viewing, page approval before milestone 4, Breev-owned provider accounts and resale, external-integration boundaries | `domain.md` (sync/cloud, providers); `product.md` |
| §12 interface and branding | Breev naming, Arabic/English, themes, fewer clicks, keyboard, preserved unsaved data, clinics excluded, visuals add no scope | `product.md`; `workflows.md` (interaction rules) |
| §13–§15, §18, §20–§21 delivery, acceptance, change control, responsibilities, handover, maintenance | Four funded milestones with acceptance criteria, review process, defect definition, schedule protection, client responsibilities, ownership and handover, maintenance tiers | `delivery.md` |
| §16–§17 deferred and excluded | Phase Two list, AI roadmap as non-binding direction, price exclusions | `product.md` (scope boundaries) |
| §19 open decisions | Client approvals before final implementation | `open-decisions.md` (client-decision table) |

The root `README.md` and `running-locally.md` describe the code that is currently runnable and the checks that exercise it. They do not own product requirements. The coverage map above remains the authority for required behavior that has not been implemented yet.

## Governing reconciliations

Where sources conflict or the engineering baseline deliberately differs, this table records the governing result.

| Conflict | Governing result |
|---|---|
| Proposed stack (SQLite, Laravel/PHP, JWT/Sanctum) vs chosen stack (PostgreSQL, NestJS, Drizzle, device certificates) | The scope labels its technologies "planned"; the chosen stack satisfies every stated business constraint (offline-first, local service owning the database, no raw file sharing, one-way sync). `architecture.md` governs implementation. |
| Earlier chat: three selectable costing methods (average default) vs scope v1.2: average cost on pre-discount Primary Supplier Cost | The later scope governs: Phase One uses WAC on Primary Supplier Cost as the single method. Method selection would be a change request. |
| Older engineering baseline: discounts reduce acquisition cost (net cost, IAS 2 style) | Replaced. The client's explicit rule governs: valuation, average cost, and COGS use the pre-discount Primary Supplier Cost; Cost After Discount is informational. |
| Older engineering baseline: tertiary unit as a real quantity unit | Replaced. The scope and brief agree the third unit exists only for days/dosage follow-up with no stock effect. |
| Older engineering baseline: mandatory Step-Up for every below-cost sale | Replaced by the scope's rule: red warning always; approval setting disabled by default. |
| Older engineering baseline: Step-Up-gated effective-date backdating for every document | Narrowed: the business/document date is an ordinary editable field at creation within an open period (the client's routine voucher workflow); creation timestamps stay immutable; closed periods still require a current-period correction. |
| Older engineering baseline: reconciliation "optional" | Clarified: the daily employee-drawer start/end reconciliation workflow is a required feature; what remains true is that reconciliation never locks the sales screen. |
| Older engineering baseline: pharmacy-owned WhatsApp identity | Replaced by the Breev-administered model with segregated per-pharmacy identities (scope §11.3 and chat: Breev owns/manages provider accounts and resells access). Provider-policy titling details settle at the G-11 activation gate. |
| Older engineering baseline: numeric OCR release thresholds (≥99%/≥95%) | Removed. The scope states accuracy is provider-dependent and not an acceptance requirement; the client approves provider/budget/test set, and accuracy is measured and reported, not gated. |
| Brief page 1: "past sales invoice editing under RBAC (under study)" | Superseded by scope §5.5: saved sales invoices are never edited; corrections use linked sales returns (Reversal covers a wholly wrong posting). |
| Scope §6.3: exceptional gated deletion option for purchase invoices | Satisfied more strictly: the requirement makes deletion "unavailable by default" and forbids silently erasing approved history — the docs provide no delete at all. Undoing an entire wrong purchase uses a full-offset Purchase Invoice Adjustment or a full Purchase Return, both preserving the original and its audit trail. |
| Brief-only details not incorporated by the scope | Not promoted to requirements: Free Product checkbox, four configurable custom fields (sales/item/patient), Official Price third price, drag-and-drop column reorder in sales, initial-stocktaking icon, branch column/switching, hide-item-from-sales-search control, the user-facing Replace-Item-with-Another settings screen (the underlying need is met by the archive/merge integrity rule), diagnosis field, dose D/W/M keys as specific UI, Excel import icon. Adding any of them is a change request. |
| Breef vs Breev | Breev is the company and product name. New identifiers use `breev`/`@breev/*`. |
| Prototype "95% of final appearance" | The prototype and images supply visual composition evidence only; the written scope defines behavior. |
| Engineering baseline: milestone 1 needs the TPM-backed CA-key proof and the full Windows mTLS transcript set (G-05) | Restaged by the stakeholder decision of 29 August 2026. Milestone 1 accepts the software-CNG fallback as its key-storage profile and a practical mTLS proof: the pharmacy CA issues server and device certificates, a terminal presenting a valid device certificate reaches the API over TLS 1.3 mTLS, and a client with no certificate or a foreign-CA certificate is refused, offline and across a service restart. The confirmed mTLS rule is unchanged. The platform-TPM proof on release hardware, the non-service-account ACL denial, the non-exported Windows terminal key, and the rejection transcripts are release-gated in [`open-decisions.md`](open-decisions.md) G-05. |
| `architecture.md`: local recovery uses PostgreSQL base backup plus WAL (G-06) | Restaged by the stakeholder decision of 29 August 2026. The proven encrypted recovery-point foundation with Restore Quarantine is the milestone-1 recovery basis. Base backup plus WAL, or an explicitly approved amendment, the off-device destination, the clean-machine RPO/RTO restore proof, and Windows execution of the record are release-gated in [`open-decisions.md`](open-decisions.md) G-06. |
| `architecture.md`: the packager, updater, and installer choices stay open until the runtime-proof comparison completes (G-07) | Settled for the production path by the stakeholder decision of 29 August 2026, on the practical lifecycle proof rather than the certification ceremony. Production builds use `electron-vite` and electron-builder for one offline per-machine NSIS `BreevSetup.exe`. Assisted installs select Main or Additional POS Terminal; unattended installs use `/ROLE=main` or `/ROLE=terminal`; persisted role state drives repair, update, reinstall, and Electron startup. Main retains the existing service/database lifecycle, while Terminal creates no service, private database, listener, or firewall rule. Electron Forge with MakerWix stays a comparison harness under `tooling/windows/forge-comparison`. The correlated role proof is `tooling/windows/proof/Invoke-TerminalInstallerProof.ps1` plus the existing Main `Invoke-InstalledRuntimeProof.ps1`, aggregated by `Confirm-Issue34Evidence.ps1`. Signing identity, release host, update policy, and final Windows evidence remain open in [`open-decisions.md`](open-decisions.md) G-07. |
| Evidence baseline: every Windows result comes from the activated certification-candidate guest and the physical-profile gate (`evidence/issue-34/README.md`) | Restaged by the stakeholder decision of 29 August 2026. Milestone-1 evidence may come from the unactivated `breev-issue-34-win11` guest with development/test signing. Activation, the physical-machine pass, and the full #34 sequence through `Confirm-Issue34Evidence.ps1` are release-gated in [`open-decisions.md`](open-decisions.md) G-07. Supported-environment proof in [`quality.md`](quality.md) still defines certification on the licensed Windows 11 Pro candidate. |

## Visual evidence register

All 52 brief images (49 unique) were inspected and classified against the written rules. Written requirements win; an image adds no scope.

**Accepted (visuals matching written requirements):** dashboard cards and item-summary grid (p4); POS layout with patient search, chronic-med insertion, suspend/save/return (p5); quick-access grid with categories (p6, p8); per-item discount and batch column (p9); purchase screen with left panel, OCR import, pricing columns (p10); saved-purchase list with dual costs and Adjusted/Return tags (p12); quick-stocktake dialog with dual-unit entry (p15); Item Master Card fields and movement history (p16); patient profile with weight/BMI, chronic facts, discount (p19); message templates, scheduling, and reservations (p20–23); reorder basket with proposed quantity and risk columns (p24–25); the report screens for sales, purchases/suppliers, items/inventory, patients, and profit (p26–39 within scope §10.2 categories); the Accounts screen with chart-of-accounts types (p42); supplier-settlement voucher allowance fields (p43/p56).

**Superseded (visuals overridden by written rules):** the Clinics tab appearing in nearly every navigation bar (excluded); the inventory grid's item-delete icon and branch column/transfer control (p14 — read-only, no delete, no branch in Phase One); AI predictive/forecast screens and the persistent AI-forecast/BI navigation buttons (p40–41 and report headers — advanced AI is deferred); AI supplier-price comparison buttons in the basket (p24–25 — Phase Two); Doctor/Lab EMR tabs (p19 — Phase Two readiness only); AI-drafted message wording (p20 — future roadmap); multi-currency USD/exchange-rate fields and the Delete action on the legacy voucher reference (p42/p43 — single currency, no deletion of approved movements); the thrice-repeated "4 configurable fields" settings screen (p8/p18/p20 — explicitly non-committed).

**Unresolved (visual evidence only, no written basis):** patient CRM metric cards (LTV, average invoice, visit count) on p18; a configurable commission-percentage field on the sales-analysis report (p27); column show/hide/reorder in the sales grid (written scope grants column configuration to purchasing only); add-to-basket from report rows (p26 — written scope names sales and inventory only); report grouping taxonomies such as "by family" (p39). None of these is a requirement; implementing one needs client confirmation or a change request.

The final unified visual PDF (including the quick-stocktake design) remains a pending client delivery in [`open-decisions.md`](open-decisions.md) and, when received, is a visual reference that adds no scope.

## Commercial terms traced

The four milestones with durations, payments, and acceptance criteria; the three-business-day review with one consolidated feedback list; the defect definition; schedule protection; change control; client responsibilities; ownership and handover; and the $10/$30/$50 maintenance tiers with the developer's first-opportunity right on future work are carried in [`delivery.md`](delivery.md) from scope §13–§15, §18, §20–§21 and the client record's maintenance/SLA agreement of 31 July 2026.
