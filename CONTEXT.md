# Domain Context

| Term | Canonical meaning |
|---|---|
| Breev | Confirmed company and public product name. Phase 1 normalizes new technical identifiers to `breev`/`@breev/*`; legacy source artifacts remain unchanged for traceability. |
| Tenant | One subscribing pharmacy organization and the security/billing boundary for its cloud data. |
| Pharmacy | The operating business represented by a tenant; initially one operational location. Do not use `Branch` as its synonym. |
| Main Pharmacy Computer | The Windows machine that hosts the authoritative local API and local PostgreSQL for a pharmacy. |
| Additional POS Terminal | A paid LAN client that uses the Main Pharmacy Computer's local API and does not own an independent authoritative database. |
| Pairing Session | One-use, short-lived, pharmacy/main-bound authorization ceremony through which an owner or trusted `devices.pair` user admits one proposed terminal. |
| Paired Terminal | A named additional POS device whose locally generated public key was human-confirmed and certified for one pharmacy; its device identity never replaces individual user authorization. |
| Terminal Seat | Licensed capacity allocated to one paired additional terminal. |
| Device Revocation | Local-authoritative withdrawal of a terminal's access; it works offline and older cloud state cannot silently reverse it. |
| Installation Identity | Opaque stable identity of one initialized Main Pharmacy Computer service; it is not an IP address, Windows computer name, or discovery result. |
| Pharmacy Local CA | Pharmacy-scoped trust anchor created during secure first initialization for the Main Pharmacy Computer and its paired terminals; a new one represents a new trust domain. |
| Device Certificate | Certificate binding a terminal-held key to one pharmacy/device identity; it never replaces the signed-in user's authorization. |
| Local API | The pharmacy-side NestJS service that owns local business transactions and local PostgreSQL access. |
| Cloud API | The multi-tenant NestJS service for subscriptions, permitted cloud views, synchronization, and cloud-authoritative features. |
| Cloud Data Location Matrix | Versioned map of every cloud data class/service to provider, region/country, backup, support path, subprocessors, and approved transfer boundary. |
| Restore Quarantine | Cloud or local restored state kept unavailable for ordinary use until deletion, legal-hold, revocation, and later security state is replayed and verified. |
| Certified Hardware Profile | Exact supported Windows and peripheral model/driver/firmware/connection combination verified for Breev production use; anything outside it is explicitly best-effort. |
| Update Package | Signed, versioned Breev application/service bundle with compatibility, integrity, release-channel, and migration metadata. |
| Maintenance Window | Owner-approved period in which new work is drained and a signed update, repair, or migration may safely run. |
| Binary Rollback | Return to a prior application/service version only when its database schema compatibility is proven; it is not a database downgrade. |
| Cash Box | A continuous cash ledger/container. It is not a mandatory work shift and does not require forced open/close boundaries. |
| Reconciliation Snapshot | An optional point-in-time count and comparison for a Cash Box; it does not end the continuous box. |
| Merchant Account | Pharmacy-owned contractual account with a licensed payment provider through which customer funds settle directly to the pharmacy; Breev never owns or holds those funds. |
| Payment Attempt | One idempotent request to collect an exact amount through an external provider, with its own lifecycle and provider reference; it is not an invoice or proof of settlement. |
| Unknown Payment Outcome | Payment Attempt state in which Breev cannot prove success or failure after interruption; the same provider reference must be queried/reconciled before retry or replacement. |
| Payment Settlement | Provider-confirmed transfer record separating gross customer payment, provider fee, net bank deposit, settlement date/reference, and discrepancy. |
| Provider Refund | External-money return linked to a pharmacy Return or Reversal but tracked separately; neither record overwrites the original Payment Attempt or invoice. |
| Chargeback | Provider-initiated payment dispute/reversal recorded as a separate financial event rather than as deletion of the sale or payment. |
| Official Electronic Tax Invoice | Jurisdiction-defined invoice accepted through an approved government process; a Breev receipt, PDF, or email is not one merely because it is electronic. |
| Tax Submission Snapshot | Immutable evidence of the exact posted invoice version/payload, authority, credential identity, submission attempts, responses, status, and correction chain. |
| Draft Invoice | An editable, non-posted sales or purchase document with no final stock/accounting effect. |
| Draft Price Snapshot | Draft-line selling price, version, pricing source, and capture time preserved until an explicit refresh or authorized override; all safety, stock, tax, and accounting facts revalidate at posting. |
| Posted Invoice | An immutable historical transaction whose facts are preserved; corrections use an amendment or reversal workflow. |
| Invoice Snapshot | Transaction-time copies of names, units, quantities, prices, costs, discounts, tax, and party facts retained even if master data later changes. |
| Amendment | An auditable correction linked to a posted document; exact legal and numbering semantics are pending approval. |
| Reversal | The accounting-safe cancellation of a wrongly posted transaction: a new linked document offsets its stock, payment/receivable, and journal effects without deleting the original. |
| Return | A linked document for goods actually returned by a customer or to a supplier; partial or full, with its own posting and printable slip. It is not a synonym for correcting a wrongly entered invoice. |
| Stock Movement | The authoritative append-only reason and quantity change for inventory. An on-hand balance is derived from movements. |
| Anonymous Sale | Core sale with no Patient Profile attached because identity is not required. |
| Patient Profile | Optional longitudinal patient identity/contact/CRM and approved health context, distinct from immutable transaction snapshots. |
| Required Transaction Identity | Minimum party/debtor/dispensing identity retained with a posted record under a documented Necessary Processing Basis. |
| Optional Profile Link | Removable association between a Patient Profile and a posted transaction; it is not part of the posted financial, stock, tax, or accounting facts. |
| Necessary Processing Basis | Documented legal, professional, contractual, credit, or business reason that genuinely requires minimum patient data; it is not optional consent. |
| Consent Purpose | One specific optional use of patient data or one communication category/channel; approval never transfers to another purpose. |
| Consent Event | Immutable grant, denial, or withdrawal evidence for one Patient, purpose, policy version, and destination/provider context. |
| Verified Destination | Patient-associated phone/channel endpoint verified for the approved consent scope; shared or changed numbers do not inherit consent. |
| Authorized Representative | Verified guardian/proxy or other legally accepted person acting for a Patient within a recorded scope. |
| Provider/Jurisdiction Gate | Current permission boundary for a provider, geography, message category, or external processing use beyond patient consent. |
| Pharmacy WhatsApp Identity | Pharmacy-owned WhatsApp Business account, verified business identity, and dedicated phone number through which that pharmacy communicates; it is never shared with another tenant or owned as Breev's customer-contact asset. |
| WhatsApp Template Version | Immutable pharmacy-approved Arabic or English message content bound to a purpose, Meta category, consent scope, provider-policy version, and platform approval state. |
| Messaging Usage Charge | Tenant-attributable Meta/provider delivery cost shown transparently by recipient market, category, quantity, allowance, and any explicit overage; it is not a hidden Breev fee. |
| Retention Policy Version | Approved record-class rule defining its starting event, provisional/legal period, holds, and end action. |
| Irreversible Anonymization | State in which no reasonably available retained key, map, identifier, or attribute combination can reconnect data to a Patient. |
| Pseudonymization | Replacement of direct identity while a retained or reasonably available link still permits reconnection; it is not anonymization. |
| Legal Hold | Scoped, reviewed suspension of disposal for named records due to a documented legal, dispute, or investigation need. |
| Deletion Outcome | Explicit per-record-class result of a verified, authorized deletion request. |
| Deletion Ledger | Protected minimum tombstone evidence preventing deleted/anonymized data or permissions from reappearing after restore or synchronization. |
| Support Access Grant | Ticket-bound, owner-authorized, named, least-privilege, time-limited authority for Breev Support. |
| Break-Glass Support Access | Exceptional short-lived support elevation with stronger authorization, owner notification, detailed audit, and mandatory review. |
| Batch | A quantity of one product sharing acquisition/lot and expiry facts; it is not a single expiry field on the product. |
| Near-Expiry Batch | A batch still legally sellable but within the configured warning window; Breev warns and selects by FEFO. |
| Quarantined Stock | Stock immediately blocked from sale/dispensing pending investigation or owner decision; quarantine alone does not recognize a financial loss. |
| Recalled Stock | Supplier/manufacturer/regulator-recalled stock immediately blocked from sale; final loss is limited to carrying amount not recovered from the supplier. |
| Inventory Write-off | A dedicated stock/accounting movement that removes unusable inventory at its carrying amount and records a separate loss expense; it is never a zero-price sale. |
| Carrying Cost | The ledger value under the company's selected valuation method at posting time. A batch movement identifies the physical batch but uses current WAC or applicable FIFO layer and freezes quantity, unit cost, total, method, and batch as a permanent snapshot. |
| Inventory Unit | The smallest precisely countable stock unit selected for a product's inventory ledger. |
| Packaging Conversion | An explicit integer ratio between a product's main, sub-, and optional tertiary units. |
| Generated Product Name | Current English display name derived from structured components using a versioned Pharmaceutical or General naming template; it is not product identity and never rewrites posted snapshots. |
| Arabic Search Name | Independent Arabic product name indexed for smart/fuzzy search and shown beneath the English display; it is never appended to the generated English name. |
| Naming Template Version | Immutable identifier for the ordered component template used to generate a product name, allowing later template changes without changing historical documents. |
| IQD Money | An exact signed integer count of fils, where 1 IQD = 1,000 fils. Normal cashier display may remain whole dinars; rounding is a separate policy. |
| Entitlement | A subscription capability grant checked at every execution boundary; it is distinct from a user's permission. |
| Signed Offline Licence | Server-issued signed statement binding tenant/pharmacy, device, plan/features, issue/expiry/grace times, and version; local validation never trusts an editable Windows clock alone. |
| Grace Period | Seven inclusive calendar days after paid expiry during which existing paid capabilities continue; fallback begins at 00:00 on the next day under Trusted Breev Time. |
| Free Core POS | Main-computer local sales and pharmacy-owned data access that remains available without a paid entitlement, including history, reports, print, backup, export, and renewal. |
| Trusted Breev Time | Monotonic last-known signed/server time state used to detect rollback across licences, certificates, devices, and trust windows; editable clock/time-zone/restart/offline changes cannot extend authority. |
| Permission | Authority granted to an authenticated user/role to perform an action within entitled capabilities. |
| Step-Up Authorization | Immediate re-authentication by the already signed-in user before a named sensitive action; it does not grant missing permission or entitlement. |
| Dual Control | One authorized user prepares a sensitive request and a different authorized user approves it; self-approval and shared accounts are prohibited. |
| Local External Link | Permissioned read-only local association between approved pharmacy records, such as a Patient Profile and invoice; it does not itself export or mutate either record. |
| Outbound Integration Contract | Versioned paid agreement defining an external connector's purpose, recipient, region, retention, minimum field allow-list, consent/basis, entitlement, and security rules. |
| POS Performance Target | Measured percentile response target for a local pharmacy interaction on a certified hardware/profile and realistic dataset; it never permits skipping domain validation or atomicity. |
| Accessible Core Flow | A core pharmacy workflow operable by keyboard and assistive technology with correct Arabic/RTL and English/LTR semantics, focus, status, and readable output. |
| One-Way Sync | Local-to-cloud replication for permitted view/report use; cloud edits do not write back to local operational records. |
| Two-Way Sync | A higher-tier mode in which approved cloud-originated changes can return locally under explicit ownership, conflict, permission, and audit rules. |
| Local-Authoritative Record | Posted transaction/inventory/payment/Cash Box/accounting record that cloud may store/view/report/back up but can never directly edit, delete, replace, or overwrite. Corrections are new local business transactions. |
| Cloud Command | Unique, expiring, idempotent request for an approved entity/field change; local API validates and acknowledges it rather than accepting a direct cloud database update. |
| Field Ownership Matrix | Versioned allow-list declaring which entity fields may accept cloud commands; screen- or record-level permission is insufficient. |
| Expected Record Version | Optimistic concurrency value proving the cloud command was based on the current local record; a mismatch rejects or conflicts rather than overwriting. |
| Cloud Command Status | Pending, Applied, Rejected, Conflict, Expired, or Cancelled; only local acknowledgement may produce Applied. |
| Sync Conflict | Expected-version mismatch preserving Base, Current Local, and Requested Cloud values; only owner or a trusted `sync.conflict.resolve` user may resolve it through a newly validated local decision. |
| OCR Draft | Machine-extracted purchase data that has no business effect until reviewed and explicitly posted by an authorized human. |
| OCR Benchmark Corpus | Controlled representative set of Arabic, English, and mixed Iraqi supplier invoices used to qualify a provider/model version before production. |
| OCR Provenance Snapshot | Immutable evidence linking one extraction to the source hash, provider/model/region, field confidences/locations, results, corrections, reviewer, usage cost, and final state. |
| OCR Page Allowance | Explicit tenant entitlement measured in provider-processed pages; reaching it stops new external OCR jobs but never manual purchasing. |
| Supplier Invoice Evidence | Encrypted local copy of a supplier invoice retained with its posted purchase under the commercial-record policy; it is distinct from a temporary provider working copy. |
| Regulatory Medicine Source | Iraqi authority source for medicine registration, recalls, restrictions, and other regulatory sale controls; it is not an interaction database. |
| Licensed Clinical Knowledge Source | Commercially licensed, versioned medicine-safety content approved for Breev's Iraqi pharmacy, offline, bilingual, audit-snapshot, and commercial use. |
| Clinical Product Mapping | Pharmacist-reviewed, versioned link between an Iraqi product and normalized active ingredients in the Licensed Clinical Knowledge Source. |
| Deterministic Clinical Alert | Advisory drug–drug, drug–allergy, or validated duplicate-therapy result produced by traceable rules over entered and licensed structured data; it is not diagnosis, prescribing, or dosing advice. |
| Not Evaluated | Explicit outcome used when mapping, patient input, licence, content freshness, or another prerequisite is insufficient; it never means safe. |
| Regulatory Hard Block | Non-overridable sale prohibition caused by an official recall, expiry, quarantine, or other validated regulatory rule; it is distinct from an advisory Clinical Alert. |
| Clinical Evaluation Snapshot | Immutable evidence of the clinical inputs, mappings, dataset/rule versions, result, displayed guidance, acknowledgement, and pharmacist decision at evaluation time. |
| Clinical Data Bundle | Signed, validated offline package of licensed clinical content and rules with an activation version and freshness state. |
| Clinical Kill Switch | Audited control that disables clinical evaluation when content integrity or safety is doubtful without disabling Core POS or Regulatory Hard Blocks. |
