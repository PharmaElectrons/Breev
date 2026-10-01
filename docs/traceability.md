# Source and requirement traceability

## Current requirement sources

The client's business requirements live in `docs/requirements/`. [`README.md`](README.md) defines the authority order. The three sources are:

| Source | Role |
|---|---|
| [`requirements/breev-phase1-mvp-scope.md`](requirements/breev-phase1-mvp-scope.md) | Governing Phase One scope, v1.2 of 9 August 2026. Latest and most specific; its own conflict rule makes the latest approved specific written clarification win. |
| [`requirements/client-chat.md`](requirements/client-chat.md) | Chronological client/developer record. Later entries supersede earlier ones; it also carries commercial terms (maintenance tiers, first-offer right, SLA) reflected in `delivery.md`. |
| [`requirements/project-breif/`](requirements/project-breif/) | The client's detailed draft with 52 interface images. Details are commitments only where the scope incorporates them (scope §Document control); otherwise supporting evidence. |

Stakeholder clarifications to product behavior are recorded chronologically in [`requirements/client-chat.md`](requirements/client-chat.md) and reflected in the owning docs. Decisions about engineering evidence and gate staging do not change these requirement sources; they are recorded where they take effect, in [`open-decisions.md`](open-decisions.md). Reconciliations below name the requirement each engineering decision restages.

The pre-consolidation documentation baseline (the earlier 238-row register and its since-removed sources) is preserved at Git commit `6ddc0431b58a43efdbc3bf2899e3f6251cd69c82` for archaeology only.

## Coverage map

Every business-requirement area of the governing scope maps to one owning document. Acceptance-level detail lives in the owner, not here.

| Scope area | Requirement | Owning documents |
|---|---|---|
| §1–§2 product model, offline-first, devices, units/sync model | Plans/add-ons, offline local authority, four-device testing without a hard-coded limit, integer unit model, one-way sync | `product.md`; `domain.md` (units, sync); `architecture.md` (chosen runtime) |
| §3.1 login, users, permissions, attendance | Mandatory login, role set, configurable permissions, audit of sensitive changes, optional manual attendance; one role per user, role-owned permissions, and pharmacy custom roles per the stakeholder clarification of 3 September 2026 (see reconciliations) | `product.md`; `domain.md` (identity/authorization) |
| §3.2–§3.3 plans, feature control, Super Admin | Per-pharmacy licensing, hidden disabled features, founder grants, device counts, expiry behavior, Super Admin minimum; the owner licence panel is an owner decision (see reconciliations) | `product.md`; expiry rule pending in `open-decisions.md` |
| §3.4 dashboard and alerts | Summaries, sortable item-summary fields, unified notification center; installation and system identifiers per the stakeholder decision of 3 September 2026 | `product.md` |
| §4 item definition, search, packaging, pricing | Two naming modes, Arabic name, ordered sequential search with acceptance example, base/sub units, third unit (days/dosage only), By Price / By Percentage, margin-on-selling-price, rounding, colors, movement history, barcode actions, daily matching | `domain.md` (catalog and pricing rules); `workflows.md` |
| §5 sales and POS | Full POS flow, suspend/preserve/confirm, quick patient and item creation, patient context, controls and calculator, saved-invoice viewing with returns-only correction, panel fields, drawer balance, expired/damaged approval flow, quick access, reorder from sales | `workflows.md` (Sell and settle); `domain.md` (settlement, write-off) |
| §6 purchases, suppliers, OCR | Entry order and keyboard flow, allowance snapshots, dual cost values, Purchase Invoice Adjustment (Delta) with A-numbered identifiers and conflict blocking, purchase returns, no deletion, OCR as reviewed draft | `domain.md`; `workflows.md`; `product.md` (OCR boundary) |
| §7 inventory, stocktaking, reorder | Read-only inventory with approved columns, owner-only export, quick stocktake with unit combinations, reorder basket (max − current) and Ordered Items | `domain.md`; `workflows.md` (Count) |
| Issue #179 Inventory QA review and follow-up | Row selection and responsive/cart/count-search usability; restored Inventory summary cards, sort affordances, cart row tinting and navigation; active-session warning and Apply Difference validation; tested Apply Difference and protected JSON export preserved with additional protected CSV summary. Selecting a row opens the shared item-information panel; branch transfer is not part of Phase One. the old Refresh/Search/Print/Exit controls add no requirement. The grid reloads when shown and when the window regains focus. Recalled and quarantined batches are risk badges and remain in quantity and value. Count completion is refused while a non-zero variance is unapplied. Concurrent stocktake policy remains open. | `workflows.md` (Count; Inventory review, basket, and sensitive export); `domain.md` (inventory review); `open-decisions.md` (concurrent sessions); scope §7 |
| §8 patients, CRM, messaging, AI boundaries | Profile contents, purchase history with continuation indicators, weight/BMI, automatic discount, Do Not Disturb, follow-up/reservations, templates and scheduling, Phase One AI limits | `domain.md` (patients, messaging); `product.md` (AI boundaries); `workflows.md` |
| §9 cash accounts and accounting | Employee drawers without shift locking, start/end reconciliation, chart of accounts, vouchers with editable business date + immutable creation time, statements, Ledger source of truth, main accounts, pre-discount cost basis, settlement allowances and allowance differences, card commissions, debt aging, traceable transaction list | `domain.md` (accounting sections) |
| §10 search lists, reports, audit, export | Per-type search popups, essential report catalogue, From/To and user filters, owner-password exports, Excel-like named-patient table + read API + Sheets guidance | `domain.md` (reports); `product.md` (spreadsheet boundary); `workflows.md` |
| §11 cloud services | One-way upload, read-only remote viewing, page approval before milestone 4, Breev-owned provider accounts and resale, external-integration boundaries | `domain.md` (sync/cloud, providers); `product.md` |
| §12 interface and branding | Breev naming, Arabic/English, themes, fewer clicks, keyboard, preserved unsaved data, clinics excluded, visuals add no scope | `product.md`; `workflows.md` (interaction rules) |
| §13–§15, §18, §20–§21 delivery, acceptance, change control, responsibilities, handover, maintenance | Four funded milestones with acceptance criteria, review process, defect definition, schedule protection, client responsibilities, ownership and handover, maintenance tiers | `delivery.md` |
| §16–§17 deferred and excluded | Phase Two list, AI roadmap as non-binding direction, price exclusions | `product.md` (scope boundaries) |
| §19 open decisions | Client approvals before final implementation | `open-decisions.md` (client-decision table) |
| Milestone 2 current scope/evidence baseline | Funded M2 requirements mapped to issues #45–#59, current code/tests, manual/package evidence, named external gates, exact deferrals, and protected no-touch paths | [`milestone-2-scope-and-evidence-map.md`](milestone-2-scope-and-evidence-map.md) |

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
| Prototype "95% of final appearance", and the client-supplied prototype at `design/prototype/` | The prototype and images supply visual composition evidence only; the written scope defines behavior. On 1 September 2026 the stakeholder selected the checked-in prototype as the production visual design source and its slate/teal light palette and radius as the production brand-token basis. Production adapts that source for the required dark theme, locale-driven direction, the renderer trust boundary, and WCAG 2.2 AA. No prototype code, data authority, browser persistence, arithmetic, or excluded or deferred feature gains authority through that selection. |
| Engineering baseline: milestone 1 needs the TPM-backed CA-key proof and the full Windows mTLS transcript set (G-05) | Restaged by the stakeholder decision of 29 August 2026. Milestone 1 accepts the software-CNG fallback as its key-storage profile and a practical mTLS proof: the pharmacy CA issues server and device certificates, a terminal presenting a valid device certificate reaches the API over TLS 1.3 mTLS, and a client with no certificate or a foreign-CA certificate is refused, offline and across a service restart. The confirmed mTLS rule is unchanged. The platform-TPM proof on release hardware, the non-service-account ACL denial, the non-exported Windows terminal key, and the rejection transcripts are release-gated in [`open-decisions.md`](open-decisions.md) G-05. |
| `architecture.md`: local recovery uses PostgreSQL base backup plus WAL (G-06) | Restaged by the stakeholder decision of 29 August 2026. The proven encrypted recovery-point foundation with Restore Quarantine is the milestone-1 recovery basis. Base backup plus WAL, or an explicitly approved amendment, the off-device destination, the clean-machine RPO/RTO restore proof, and Windows execution of the record are release-gated in [`open-decisions.md`](open-decisions.md) G-06. |
| `architecture.md`: the packager, updater, and installer choices stay open until the runtime-proof comparison completes (G-07) | Settled for the production path by the stakeholder decision of 29 August 2026, on the practical lifecycle proof rather than the certification ceremony. Production builds use `electron-vite` and electron-builder for one offline per-machine NSIS `BreevSetup.exe`. Assisted installs select Main or Additional POS Terminal; unattended installs use `/ROLE=main` or `/ROLE=terminal`; persisted role state drives repair, update, and Electron startup. Main retains the existing service/database lifecycle, while Terminal creates no service, private database, listener, or firewall rule. The later stakeholder decision of 1 September 2026 requires a genuine uninstall to remove all Breev machine data and the installed role so assisted reinstall asks again; electron-builder's `--updated` path remains explicitly data-preserving. Electron Forge with MakerWix stays a comparison harness under `tooling/windows/forge-comparison`. The correlated role proof is `tooling/windows/proof/Invoke-TerminalInstallerProof.ps1` plus the existing Main `Invoke-InstalledRuntimeProof.ps1`, aggregated by `Confirm-Issue34Evidence.ps1`. On 5 September 2026 the stakeholder kept `dev` as the default development branch, selected protected `main` as the stable source, and selected protected stable SemVer tags that create draft GitHub Releases. The 6 September 2026 follow-up limits current automation to unsigned, non-publishable draft prereleases for flow testing without secrets. The tag, root/desktop versions, and dated changelog entry are one release identity; neither a `main` push nor unrestricted manual dispatch publishes. Production signing identity/custody, in-app update/staged-channel policy, and final Windows evidence remain open in [`open-decisions.md`](open-decisions.md) G-07. |
| Evidence baseline: every Windows result comes from the activated certification-candidate guest and the physical-profile gate (`evidence/issue-34/README.md`) | Restaged by the stakeholder decision of 29 August 2026. Milestone-1 evidence may come from the unactivated `breev-issue-34-win11` guest with development/test signing. Activation, the physical-machine pass, and the full #34 sequence through `Confirm-Issue34Evidence.ps1` are release-gated in [`open-decisions.md`](open-decisions.md) G-07. Supported-environment proof in [`quality.md`](quality.md) still defines certification on the licensed Windows 11 Pro candidate. |
| Engineering proposal of 2 September 2026: per-user extra permission grants on top of role permissions | Rejected by the stakeholder clarification of 3 September 2026. Breev stays role-based: each user holds exactly one role, permissions are configured on roles (scope §3.1), and no per-user grant, deny list, or override exists. The same clarification lets a pharmacy add custom roles beyond the eight roles named in scope §3.1, each with a single pharmacy-entered name shown verbatim in both locales, requires localized permission names in place of internal identifiers, and seeds `identity.roles.manage` on the built-in manager role. Custom roles are an owner product decision rather than a client requirement and may be a change request under scope §15. |
| Issue #153 role/permission parity follow-up of 7 September 2026 | The stakeholder directed Breev to derive the complete implemented permission surface from the codebase and authorized the logical least-privilege default where existing documents were silent. The built-in purchasing employee therefore starts with `purchases.drafts.manage`, its core incoming-stock entry workflow, while `suppliers.manage` remains separately delegated because it changes supplier master data. The desktop role editor must represent every implemented/grantable permission and every built-in role with Arabic and English names and descriptions; non-implemented vocabulary remains hidden. |
| Scope §3.2–§3.3 name no in-app plan or licence screen | Owner decision of 3 September 2026: the administration screen carries a small owner licence panel — plan, issue, expiry, and grace dates, days remaining with a warning before disruption, plan features separately from founder grants, and a Renew action that installs a newer licence — because the expiry rule in `workflows.md` requires that the owner sees the expiry and grace dates before disruption. It commits no cloud, billing, or Super Admin scope, and the grace rule it displays remains the unapproved working default in `open-decisions.md`. If the client treats the panel as new scope it is a change request under scope §15. |
| Existing administrative scripts are required to read local installation identifiers | Stakeholder decision of 3 September 2026: the authenticated desktop dashboard shows the pharmacy name and server-owned pharmacy ID, the local Main or terminal role and device ID, the installation ID when available, local server and database connection status, and API and schema versions. IDs have a one-click copy action. This is a support view only: it exposes no credential, endpoint, secret, configuration path, or new identity authority. |
| Issue #142 requests client diagnostics, crash recovery, and support contact while G-08/G-14/G-16 leave external reporting approval open | The local desktop implementation is the settled offline slice: layered localized error containment, closed privacy-safe breadcrumbs, strict allowlisted atomic export through an Electron-owned Save dialog, and a Main-owned configured OS support handoff. Central submission remains disabled by default, appears only after authentication when Main reports the manual capability, and requires an explicit confirmation. This does not approve a provider, region, retention period, notice, or production telemetry activation; those decisions remain in `open-decisions.md`. |
| Stakeholder decision of 23 September 2026, issue #62 | Sale Draft list/read/resume requires `sales.drafts.manage` and is pharmacy-scoped. Creator and device do not restrict access; an authorized user may act from a device that passes authentication and device-trust checks. Automatic selection on Sales entry remains open. See `domain.md` Sales rules, `workflows.md` Sell and settle, `open-decisions.md` Automatic Sale Draft selection, and issues #58 and #62. |
| Issue #62 and the stakeholder's 24 September 2026 Sale screenshot and funding confirmation | The confirmed Milestone 3 funding permits implementation of #62's pre-posting durable Sale Draft and cashier workspace. The screenshot guides layout only. Catalog and permissioned misc lines, exact discounts/totals, suspend/resume, manager quick access, reasoned price override, and inventory-backed item balance/batch/expiry context use local API authority; reorder-basket actions remain separate. Checkout, patient/clinical controls, messaging, and employee drawer data are not implied by the screenshot. The drawer depends on #65; duplicate-scan behavior remains open under G-03. See `today/62-plan.md` and `evidence/issue-62/README.md` for implementation state and test evidence. |

## Visual evidence register

All 52 brief images (49 unique) and the client-supplied prototype at `design/prototype/` were inspected and classified against the written rules. Written requirements win; visual evidence adds no scope.

**Accepted from the checked-in prototype:** the compact shell header and horizontally scrolling module bar; the pure-white and slate/teal light palette; the radius, spacing, label rhythm, and typography intent; and the Catalog master-detail workspace with its product rail, generated-name banner, dense form canvas, and Arabic search name on its own line. Production derives the required dark theme from the same hue, drives direction from the locale, uses locally resolvable fonts only, and strengthens control boundaries and motion treatment where accessibility requires it.

The stakeholder's 6 September 2026 clarification identifies `design/prototype/src/routes/purchases.tsx` and the [shared Lovable preview](https://lovable.dev/preview/r8S5RJqjSSfjeBoD0WXOB98BoDBH3Udw) as the Purchasing appearance reference, with a request to inspect the running UI and reproduce its composition. The renderer uses the full-height item sidebar, compact invoice metadata, item-column canvas, totals area, and two-row bottom toolbar. Saved drafts open in a modal register; they do not replace invoice items. The prototype's IBM Plex Sans Arabic and JetBrains Mono fonts are bundled locally with their OFL notices. The Ready card is accessible from a compact header disclosure in Purchasing, while non-ready recovery screens remain unchanged. The M2 Suppliers tab retains the profile canvas, top action toolbar, search sidebar, soft-archiving, merge support, and full-width layout without the invoice item sidebar. Prototype live debt, credit-limit utilization, invoice-ledger, and account-statement surfaces are hidden until the complete Supplier accounting owned by M3 issue #75 exists; Purchase invoices are not presented as a substitute ledger. Item entry, populated item details, calculated totals, posting, adjustments, and returns remain in M2. OCR, settlement, report, and durable final/legal-print surfaces retain their later delivery dependencies and release gates and are not advertised as current capability. The layout does not reinstate hard deletion, negative-stock operations, or excluded navigation. See [Purchasing layout evidence](../evidence/purchases-prototype-alignment/README.md).

**Superseded from the checked-in prototype:** Supabase and TanStack Start as business or schema authorities; browser-storage business persistence; hard-coded credentials; client-side money, price, stock, expiry, consumption, and days-of-supply calculation; hard deletion; writable Product stock, batch, and expiry fields; mock pharmacy data; remote content; the Clinics tab; and every excluded or deferred route. The item-details side panel remains restricted to Sales and Purchasing, and the prototype's client-side product search is superseded by the approved server-authoritative ordered search.

**Accepted (visuals matching written requirements):** dashboard cards and item-summary grid (p4); POS layout with patient search, chronic-med insertion, suspend/save/return (p5); quick-access grid with categories (p6, p8); per-item discount and batch column (p9); purchase screen with left panel, OCR import, pricing columns (p10); saved-purchase list with dual costs and Adjusted/Return tags (p12); quick-stocktake dialog with dual-unit entry (p15); Item Master Card fields and movement history (p16); patient profile with weight/BMI, chronic facts, discount (p19); message templates, scheduling, and reservations (p20–23); reorder basket with proposed quantity and risk columns (p24–25); the report screens for sales, purchases/suppliers, items/inventory, patients, and profit (p26–39 within scope §10.2 categories); the Accounts screen with chart-of-accounts types (p42); supplier-settlement voucher allowance fields (p43/p56).

**Superseded (visuals overridden by written rules):** the Clinics tab appearing in nearly every navigation bar (excluded); the inventory grid's item-delete icon and branch column/transfer control (p14 — read-only, no delete, no branch in Phase One); AI predictive/forecast screens and the persistent AI-forecast/BI navigation buttons (p40–41 and report headers — advanced AI is deferred); AI supplier-price comparison buttons in the basket (p24–25 — Phase Two); Doctor/Lab EMR tabs (p19 — Phase Two readiness only); AI-drafted message wording (p20 — future roadmap); multi-currency USD/exchange-rate fields and the Delete action on the legacy voucher reference (p42/p43 — single currency, no deletion of approved movements); the thrice-repeated "4 configurable fields" settings screen (p8/p18/p20 — explicitly non-committed).

**Unresolved (visual evidence only, no written basis):** patient CRM metric cards (LTV, average invoice, visit count) on p18; a configurable commission-percentage field on the sales-analysis report (p27); column show/hide/reorder in the sales grid (written scope grants column configuration to purchasing only); add-to-basket from report rows (p26 — written scope names sales and inventory only); report grouping taxonomies such as "by family" (p39). None of these is a requirement; implementing one needs client confirmation or a change request.

The final unified visual PDF (including the quick-stocktake design) remains a pending client delivery in [`open-decisions.md`](open-decisions.md). When received it may refine appearance, but it adds no scope and cannot override written requirements.

## M2 Adjustment confirmation remediation evidence

The stakeholder initiated Phase 1 on 30 September 2026 through the Purchasing
integrity prompt. Its first bounded task binds saved Adjustment facts to preview
and Post. The [T01 candidate record](../evidence/issue-198/t01/README.md) traces
scope §6.3 and M2-P04's version/hash, exact evidence, atomic retry, and audit proof.
The [M2 evidence map](milestone-2-scope-and-evidence-map.md) retains the full
Adjustment family's defect status and pending manual/later-task gates; this
record does not approve G-01/G-02 or expand the funded milestone. T01 received
explicit manual PASS on 30 September 2026. The stakeholder's same-day
[follow-up](../evidence/issue-198/followups.md) requires diagnostic request/audit
references to be hidden by default in ordinary errors, with clear localized
recovery and retained internal audit/support evidence. Purchasing remediation
and later owning module tasks must carry that presentation requirement forward;
the enduring presentation rule is in [quality](quality.md#usability-and-accessibility).

The [T02 candidate record](../evidence/issue-198/t02/README.md) traces the next
bounded scope §6.3/M2-P04 slice: readable immutable header comparisons, stable-ID
Supplier/invoice corrections, protected facts, exact Delta/audit paths and linked
Return payable integrity. Its separate manual checkpoint received stakeholder
PASS on 30 September 2026, followed by explicit confirmation that the manual
tests were finished; see [manual results](../evidence/issue-198/t02/manual-results.md).
The earlier evidence-note report remains an unresolved follow-up. The
[T02 local exit gate](../evidence/issue-198/t02/pre-commit-gate.md) records the
accepted commit's proof and precise host/prerequisite limitations. Existing
duplicate-number and Return accounting defaults retain their unapproved status;
this implementation does not close G-01/G-02 or the remaining Adjustment family.

The [accepted T03 slice](../evidence/issue-198/t03/README.md) continues M2-P04 with
filtered immutable Purchase navigation, explicit save/keep/discard controls,
server-owned gross/allowance/discounted comparisons, truthful unavailable values,
and the stakeholder's localized diagnostic presentation rule. Its separate
[checkpoint](../evidence/issue-198/t03/manual-results.md) received stakeholder PASS
on 30 September 2026 based on agent verification. It does not promote this
requirement family to proven or close G-01/G-02. Purchase row/Quick Product behavior and later milestone exclusions
remain unchanged.

The T03 [visual verification](../evidence/issue-198/t03/prototype-fidelity.md)
compares a source-rendered prototype modal with current captures and records
scoped corrections to its geometry, typography and icon. This accepted bounded
evidence does not replace broader phase gates.

The stakeholder subsequently authorized #198 T04 to use documented defaults
that can change later. The [source review](../evidence/issue-198/t04/source-review.md)
traces the brief's independent invoice offer, prototype amount/percentage forms,
gross valuation/liability boundaries, and missing two-discount approval.
[Working defaults](../evidence/issue-198/t04/working-defaults.md) record exact
version 1 arithmetic and correction behavior. The candidate implements M2-P02
through draft, restart, Post, immutable review and linked Adjustment with a
forward migration that preserves retained facts and original command payloads.
This instruction permits implementation under recorded defaults; it does not
approve accountant/legal policy, close G-01, promote M2-P02 to proven, or accept
the separate T04 checkpoint. The stakeholder subsequently accepted T04 on
1 October 2026 with “IT IS A PASS”; the [checkpoint](../evidence/issue-198/t04/manual-checkpoint.md)
records that later decision. The [full local gate](../evidence/issue-198/t04/pre-commit-gate.md)
ran once and records bounded request/expectation fixture maintenance, final
affected proof and CNG/Docker/Windows harness limits. G-01 and the complete
requirement family remain open. T05 follows the focused T04 commit.

The accepted #198 T05 implementation addresses M2-P03's omitted saved row facts
and document navigation, with its [ownership/source matrix](../evidence/issue-198/t05/source-review.md),
[targeted verification](../evidence/issue-198/t05/verification.md) and
[separate stakeholder PASS](../evidence/issue-198/t05/manual-checkpoint.md).
The continuation completed the [T05 local pre-commit gate](../evidence/issue-198/t05/pre-commit-gate.md)
with explicitly classified host limitations before its focused local commit.
The reported evidence-only save
failure after master edits was repaired with affected-scope API/browser proof.
It exposes already-retained notes, pricing and stock references, preserves
cost/margin redaction, and validates intentional draft Product/unit correction.
Wholesale remains a current Product-panel fact under #49 and scope §4.4.
No historical master-data backfill or professional policy approval is implied.

## Windows payload optimization evidence

The stakeholder initiated issue #126 implementation on 4 September 2026 after reviewing its size/performance investigation. The work preserves the existing G-05/G-06/G-07 authority, security and lifecycle requirements; it does not authorize a new installer architecture or relaxed durability. The [issue-126 implementation record](../evidence/issue-126/README.md) traces task evidence and the original issue's infeasible size/file-count assumptions. Measured budgets and any unresolved verification gaps must be presented explicitly in the review PR; the investigation does not close release gates or silently replace requirement acceptance criteria.

## Commercial terms traced

The four milestones with durations, payments, and acceptance criteria; the three-business-day review with one consolidated feedback list; the defect definition; schedule protection; change control; client responsibilities; ownership and handover; and the $10/$30/$50 maintenance tiers with the developer's first-opportunity right on future work are carried in [`delivery.md`](delivery.md) from scope §13–§15, §18, §20–§21 and the client record's maintenance/SLA agreement of 31 July 2026.
