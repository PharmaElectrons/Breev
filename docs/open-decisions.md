# Open decisions and release gates

This file lists every genuinely open decision: the client approvals the scope itself requires, and the engineering/professional release gates. Do not reopen confirmed policies such as integer fils, human-number architecture, the pre-discount Primary Supplier Cost basis, the negative-stock block, or future Cloud Command semantics. A gate may still require professional or security validation of those policies.

## Client decisions required before final implementation

These are the client's own open approvals (scope §19 plus items the requirements leave to approval). Never present a proposed default as an approved rule.

| Decision | Required approval | Working default while open |
|---|---|---|
| Final account names | Account names, classifications, and viewing permissions within the chart of accounts. | The main-accounts structure in `domain.md`. |
| Duplicate supplier invoice number | Block, or allow after a permission-controlled warning, for the same supplier. | Warn. |
| Wholesale/special price selection | How the wholesale price is selected during a sale — quantity threshold or user permission. | Wholesale price visible in the item panel only; retail price used in the sales table. |
| Paid-plan expiry rule | The exact unavailable/read-only behavior when a subscription expires. | Proposed: seven inclusive grace days, then Free Core fallback at 00:00 on day eight, without deleting data. |
| Dosage calculation and clinical content | The medical source and rules for any dosage or interaction feature. | Feature ships disabled. |
| Cloud viewing pages | Pages, columns, and reports for Phase One external read-only viewing — needed before milestone 4 begins. | Baseline proposal: summary dashboard plus selected inventory, sales, accounts, and report screens. |
| WhatsApp and Meta | Provider, templates, included message types, and message boundaries. | Sending disabled; Breev-administered account model in `domain.md`. |
| Visual reports | Final report images and columns within the approved report categories. | Categories in `domain.md`; any new report outside them is a change request. |
| OCR | Provider, usage budget, and the accepted test-invoice set. | OCR inactive; manual entry complete. |
| Old-data extraction | Separate quotation after reviewing the legacy database/export, volume, and quality. | No migration work. |
| Final interface file | The final unified visual PDF, including the quick-stocktake design, as a visual reference that adds no scope. | Existing prototype/images as visual evidence only. |
| Cashbox workflow confirmation | The client's demonstration video of the cashbox process was promised but is not in the record; confirm the documented reconciliation flow matches it. | The start/end reconciliation flow in `domain.md`/`workflows.md`. |

## Engineering and professional release gates

| Gate | Decision/evidence required | Confirmed boundary while open | Owner / blocks |
|---|---|---|---|
| G-01 Accounting and Iraqi tax | Accountant/legal golden postings for every purchase/purchase adjustment/sale/Return/Reversal/count/write-off/destruction/allowance/allowance difference/debt/mixed tender/cash difference; chart, periods, tax, final printed number/correction presentation; exact decimal precision, rounding, remainder allocation, manual-journal thresholds. The mandatory client test (5,000 primary cost / 4,650 after discount / 4,500 paid / 500 actual allowance / 150 allowance difference / zero balance) must pass unchanged. | Integer fils, exact intermediates, balanced immutable journals, WAC on pre-discount Primary Supplier Cost, FEFO separate, linked corrections, Delta-only adjustments, and the expiry/damage account and P&L treatment in `domain.md` (its write-off date rule is an engineering default this gate confirms). | Iraqi accountant + legal + product; milestones 1-3 and release |
| G-02 Pharmacy inventory policy | Product classes requiring lot/expiry, whether any product needs a smaller integer base unit for partial-package sales (fractional quantities remain excluded by the scope), near-expiry thresholds, return/restock/disposition/no-invoice return evidence, controlled-medicine and expiry-correction rules. | Negative stock and expired/recalled/quarantined sale are absolute blocks; movements and snapshots are mandatory. | Pharmacist + legal + product; milestones 2-3 |
| G-03 POS observation | Duplicate-scan behavior, tested shortcuts/payment/reprint keys, below-cost/discount thresholds, mappings for still-unassigned actions, any additional Dual Control, and the approved brand token set and replacement visual design source (the old prototype is unavailable). | Scan/keyboard first; old F-key scaffold rejected; server remains authoritative. `sales.return.post` and `sales.invoice.reverse` already default to owner/delegated trusted manager plus Step-Up and are not reopened. | Product + pharmacists + security/accountant; milestones 1-3 |
| G-04 Trusted time/licensing and subscription collection | Attacker model; high-water/signed time sources; OS/TPM/DPAPI storage; clock rollback limits; licence/certificate key rotation/revocation, recovery/reissue, and grace-boundary evidence. The minimum trusted-time design: signed absolute paid-through/grace-end instants, installation-key binding, signed time receipts with a monotonic issuance sequence, in-boot monotonic time, defined behavior when the clock falls behind the stored lower bound, and recovery for reinstall, image restore, and TPM clearing; the model must state and accept that offline revocation before signed expiry is impossible. The gate also decides the documented subscription state machine, the manual activation fallback, and the automatic Breev subscription billing gateway with its authorization, retry/reconciliation/refund, notice, and commercial accounting. | Grace duration follows the client's paid-expiry decision above (proposed seven inclusive days); paid work fails closed; Free Core and data fail open; no symmetric signing secret in clients. Subscription collection uses its separate cloud billing series and never holds pharmacy data or core operation hostage. | Security + product/accounting/commercial; milestone 4 |
| G-05 Local/LAN device security | Implementation proof for Main loopback device/session binding and exact Origin/CORS/CSRF/DNS-rebinding defenses before state-changing REST; a Windows proof that the Node service can issue certificates with the non-exportable CNG/TPM-backed CA key; manual-fallback and pairing UX, supported cipher/certificate configuration, firewall, service accounts/ACLs, key-store recovery, and rotation/compromise operations. If the CA-key proof fails or its recovery burden proves unacceptable, present a pinned-server-TLS plus machine-protected per-device-credential alternative to the stakeholder before changing the confirmed mTLS rule. | Every request must have a verified device/session plus user authority; terminal-to-main uses mTLS. Do not reopen the confirmed TLS, CA, QR, renewal, rotation, discovery, audit, five-minute pairing, and no-backup rules in `domain.md`/`architecture.md`. | Security + Windows engineering; milestones 1 and 4 |
| G-06 Local PostgreSQL and recovery | Pinned versions/port/service wrapper/account, coexistence and upgrade/repair path; WAL/base-backup tool; encryption/key custody; off-device destination; restore automation and clean-machine RPO/RTO proof. | Private loopback product-managed service; hourly recovery, daily verification, 30 days, quarterly restore, RPO ≤1h/RTO ≤4h, Restore Quarantine. | Windows/data/security; milestone 1 and release |
| G-07 Windows release | Main versus terminal installer UX, code-signing identity/key backend, release host, update manifest/channel/deadline policy, maintenance/drain, forward migration/failure recovery, offline installer, diagnostics, uninstall; revalidate OS/hardware/peripheral matrix. | Sign all artifacts; Internal/Pilot/Stable/Emergency staged channels; initial normal deferral 14 days and critical target 72h; Free Core receives security/repair; preserve data. | Release/security/support; milestones 1 and 4 |
| G-08 Patient/privacy/retention | Iraqi bases and notices; minimum identity; minor/guardian/proxy; consent wording; controlled/dispensing/health classes; retention starts/periods; deletion/anonymization/hold/outcomes; export identity; support/break-glass/media sanitization; stakeholder confirmation of the single-user Free Core export exception to Dual Control in `domain.md`. | Anonymous core; necessary/optional/health/link separation; append-only purpose consent; no consent-as-staff-access; no provider disclosure until approved. | Iraqi legal + pharmacist + privacy/security; milestone 3 |
| G-09 Clinical knowledge | Licensed provider/contract for Iraq, commercial/offline/multi-tenant/bilingual/snapshot use; pharmacist mappings/rules/severity actions; translations/disclaimer; regulatory feeds; update/freshness/kill-switch proof. | Only advisory DDI/allergy and validated duplicate therapy; no diagnosis/prescribing/dosing; Not Evaluated on missing/stale data; hard blocks separate. | Pharmacist + legal + security/product; clinical slice |
| G-10 OCR | Client approval of the OCR/AI provider, usage budget, and representative computer-printed test-invoice set; DPA, subprocessors, no training, deletion, incident/security, data-location, page cost/quota/overage, material-change requalification. Accuracy on the approved test set is measured and reported (provider, dataset, scoring method) as a regression baseline — no universal numeric accuracy threshold is an acceptance or release condition, matching the scope's no-accuracy-guarantee rule. | Every result is a human-reviewed OCR Draft; warn at 80% quota, stop at 100%, no automatic overage; manual entry always works. | Product + privacy/security + purchasing; OCR slice (milestone 4) |
| G-11 WhatsApp | Official provider/partner relationship, onboarding and cost model under Breev Company's administration, each template/category, current Meta status, opt-in/out wording, Iraqi basis, pharmacist approval, DPA/region/retention/callback proof; the client must approve provider, templates, and included message types. | Breev-administered accounts with segregated per-pharmacy identity/number/templates/opt-ins and no cross-pharmacy pooling; Breev keeps medicine/health content disabled in Iraq until per-template approval. | Legal + pharmacist + privacy/product; messaging slice (milestone 4) |
| G-12 Payment | Current CBI licence for exact role, pharmacy merchant/settlement contract, security/tokenization, fees/accounting, unknown/reconcile/refund/chargeback/support fallback, callback and outage proof. | The team has not selected a provider; Breev never holds funds or card secrets; cash continuity; Breev never guesses an unknown state or retries it blindly. | CBI/legal + accountant + security/product; deferred payment slice |
| G-13 Official e-invoice | Applicable federal/Kurdistan retail-pharmacy authority/mandate/spec, taxpayer scope, credentials/certification, number/fields/tax/signature/QR, issue/submission/outage/correction/retention rules. | Do not call Breev output official; local posted facts remain immutable; do not invent an offline-compliance mode. | Iraqi tax/legal + accountant; deferred tax slice |
| G-14 Cloud | Before milestone 4: provider/region, tenant/RLS, encryption/key/access separation, DPA/subprocessors, minimum licence-service recovery/support/cost and data-location entries. Before sync/release: primary+DR, managed multi-zone HA, full matrix, monitoring/incidents/runbooks, a provider contract with 24/7 critical escalation, restore and availability evidence. | The team has not selected a provider; local never depends on cloud. Keep production and test separate; use synthetic or irreversibly anonymized data in non-production by default. Provisional: RPO ≤15m, RTO ≤4h, ≥30d PITR, daily protected snapshots that a compromised ordinary application identity cannot delete, monthly restore, quarterly drill, 99.9% monthly, defined incident targets. | Security/ops/legal/product; milestone 4 foundation and release proof |
| G-15 Sync/outbox promotion | Before milestone 1's first local loop: first local event's exact versioned identity/pharmacy/type/occurrence/correlation/payload envelope, transaction binding, retention, and safe schema-change rule. Before One-Way Sync: entity/field/projection allowlist, redaction, wire retention, batch/backoff/dead-letter/support, maximum offline/in-flight version horizon, deletion/restore behavior, the commit-ordering rule (an auto-increment outbox ID is not commit order), the exact guarantee each checkpoint proves, and resnapshot/rebuild for a pharmacy offline beyond the horizon. Later: per-field Cloud Command promotion and UX. | At-least-once outbox/inbox; posted facts local-only; expected-version commands and human conflicts; no LWW/CRDT. | Product + domain/security/ops; milestone 1 local, milestone 4 wire, later two-way |
| G-16 Final evidence | Actual certified performance/accessibility results and approved exceptions/remediation; dependency/security/SBOM/licence scan and penetration-test checklist; privacy/provider/retention decision for any external crash reporting; restore/incident/peripheral/update drills; admin training, compatibility matrix, release notes, support runbooks, and operational staffing. | Provisional targets in `quality.md` cannot be silently weakened; crash data cannot expose secrets or unnecessary patient data. | Product + QA/security/privacy/ops; milestone 4 release |

## Provisional retention values for G-08

Do not label these values Iraqi law until validation closes G-08.

| Record or content | Provisional retention |
|---|---|
| Posted commercial/inventory/payment/accounting records and interpretive audit | Seven years after the applicable close/settlement event |
| Consent history | Seven years after the last event/purpose end |
| Optional CRM/health | Eligible for deletion/detachment/anonymization after withdrawal or three years of inactivity, subject to another basis/hold |
| Ordinary message content | 12 months |
| Sensitive health-message content | 90 days |
| Delivery/consent compliance | Three years |
| Inactive drafts/temp uploads | 90 days |
| Provider AI/OCR | Prompt deletion, maximum 30 days, zero/24-hour preferred |
| Ordinary logs | 90 days |
| Security incidents | At least one year and through closure |
| Support artifacts | 30 days |
| Backups | 30 days |

Ten-year commercial retention requires documented advice.

Deletion outcomes use `Deleted`, `Anonymized`, `Retained`, `Pending`, `Failed`, `Not found`, or `Rejected`. Keep provider deletion pending or failed until the provider confirms it. If Breev uses patient export links, it encrypts and audits them, makes them revocable/use-limited, expires them within 24 hours, and scopes them to exclude other people who share the same phone number.

## Provisional clinical and cloud operations

Clinical signed bundles apply critical safety/recall content within 24 hours of receipt and normal content within seven days. Breev checks freshness daily, warns after 30 days stale, and disables clinical evaluation as `Not Evaluated` after 90 days. Core POS and Regulatory Hard Blocks continue.

Cloud incidents have these provisional targets:

| Severity | Target |
|---|---|
| SEV-1 | 24/7 acknowledgement ≤15 minutes, affected-owner notice ≤1 hour when impact is known/reasonably suspected, then hourly updates |
| SEV-2 | Acknowledgement ≤1 hour and four-hourly updates |
| SEV-3 | Next business day |

Preserve forensic evidence/holds. A public status view reports the affected capability and region without tenant or patient details. Issue a written summary within five business days after resolution unless the team records a justified revised date.
