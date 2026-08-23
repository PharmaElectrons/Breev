# End-to-end delivery plan

Each milestone must end with demonstrable working software. Do not create apps, packages, provider adapters, tables, or generic extension points before a milestone requires them. A milestone's **Gate** names the professional or security approval its own outputs must obtain before the milestone exits; the milestone's bounded research, prototype, or proof tasks produce that evidence. Only a gate item that requires a prior external decision — such as selecting a provider — blocks the start of the dependent production work.

## M0: Runtime and installation proof

Delete the marker scaffold. Pin and configure pnpm, Turborepo, TypeScript, ESLint, Prettier, Vitest, and Playwright. Add the lockfile, `@breev/*` names, boundary checks, and only the `desktop`, `local-api`, and `contracts` projects.

Prove:

- a packaged, sandboxed Electron screen with a narrow, harmless preload method;
- a REST health and version handshake;
- managed loopback PostgreSQL and local API Windows services;
- explicit Main and Terminal states;
- Main loopback device and session defenses, plus browser-request defenses;
- clean install, repair, and uninstall with data preservation; and
- a real-PostgreSQL test harness.

**Exit.** Closing Electron leaves the API healthy. PostgreSQL accepts no LAN connections. A second client can reach only the API. Internet loss does not change local operation. Windows proof identifies every unresolved release-tooling gate. No pharmacy transaction exists yet.

## M1: First complete local pharmacy loop

Implement one owner, one pharmacy, and the installed Main-device identity. Add a built-in Free Core entitlement context, minimum default-deny authorization, and exact IQD and inventory primitives.

Implement one product/package/barcode, one supplier, one batch/expiry purchase, and one cash Sale Draft/Post. Allocate the minimal `S` and `P` human-number sequences; their printed presentation stays provisional until G-01 closes. The transaction must produce FEFO/WAC movement/value, continuous Cash Box records, a balanced journal, an immutable receipt, one read-only reconciliation report, an audit record, and a versioned local outbox row. Add restart and idempotency recovery. Use the exact purchase and scan-first sale focus paths.

**Gate.** Obtain accountant approval for the minimal purchase, sale, COGS, and Cash Box examples and for the precision and remainder rules. Close G-15 for the first local event envelope and its retention decision.

**Exit.** On the Main Pharmacy Computer, a pharmacist can purchase stock, sell it, and inspect stock and the ledger. After a simulated printer failure, the pharmacist can reprint. The system can restart at every failure point and restore the data. All of this works without internet.

## M2: Safe multi-user operation and corrections

Add roles and permissions, Step-Up Authorization, and Dual Control only after approval. Configure sensitive visibility. Support cash, credit, and mixed settlement; AP/AR; suspended drafts; and current-price comparison. Add Sales Return, Purchase Return, Reversal/replacement, non-financial notes, optional Cash Box reconciliation, the remaining number sequences and their controls, and audit and export controls.

**Gates.** Obtain accountant and legal approval for numbering and the complete correction and settlement posting matrices. Approve the permissions and no-invoice-return policy.

**Exit.** Every correction remains linked, immutable, and atomic. Unauthorized, stale, duplicate, and closed-period attempts fail without partial effects.

## M3: Purchasing and inventory depth

Add full product naming and search, multiple package barcodes and conversions, supplier discount and later-rebate behavior, and multi-line purchasing. Add durable counts, batch status, daily and monthly expiry operations, recall, and quarantine. Add supplier return, write-off, destruction, a reorder basket, movement and value history, and stock and purchasing reports. Add import only when the team receives a real source.

**Gates.** Obtain pharmacist approval for product-class and lot requirements. Obtain accountant approval for WAC, FIFO, discount, and write-off examples.

**Exit.** Quantity, value, and journal reconciliation tests pass at realistic volume. Concurrency tests pass with two simultaneous clients.

## M4: Secure additional terminals and offline licensing

Create the minimal `cloud-api` control plane for tenant, subscription, and device-seat authority; signed licence issuance; and protected commercial operations. Do not add sync or remote pharmacy editing.

Implement a pharmacy CA and five-minute pairing with terminal keys and certificates. Require mTLS plus individual login. Support revocation, replacement, and rotation. Add signed offline licences, a seven-day grace period, Trusted Breev Time, paid terminal seats, and fail-open Free Core. Prove LAN-only operation and CA-loss recovery and re-pairing. Routine pharmacy transactions must never call the cloud.

**Gates.** Approve the trusted-time threat model and recovery process, service-account and key storage, certificate rotation, and certified LAN, firewall, and discovery rules. Close the G-14 requirements for licence issuance: provider, region, tenant, key, and recovery.

**Exit.** Device, user, permission, entitlement, tenant-bypass, and time-rollback tests pass. Licence issuance can fail without interrupting transactions. A paid-feature failure never interrupts main-computer Free Core.

## M5: Patient scope

Add Anonymous Sale separation, necessary transaction identity, an optional quick Patient Profile, typed facts, and append-only purpose consent. Add link, detach, and merge operations; access, export, retention, deletion, hold, and support workflows; and patient-safe reports. Do not add clinical evaluation or outbound providers.

**Gate.** Obtain Iraqi legal and pharmacist approval for identity, basis, representative, consent, retention and deletion, controlled-medicine and dispensing, export, and support policies.

**Exit.** Tests pass for withdrawal, deletion outcomes, backup-restore replay, cross-role access, and anonymous-sale behavior.

## M6: One provider-assisted capability at a time

Promote OCR first only if it passes its corpus and contract gate. Implement source-highlighted OCR Draft to ordinary purchase posting.

Promote deterministic clinical alerts, WhatsApp, payment, or official e-invoicing only as separate later slices. Each slice requires its own gate, production adapter, test fake, policy version, quotas and costs, durable job, callback, failure handling, data location, retention, and exit evidence. Never build a generic integration platform.

## M7: One-Way cloud

Extend the M4 `cloud-api` and managed cloud PostgreSQL with an idempotent inbox, read projections, freshness, backlog, and dead-letter views, expanded restore and incident evidence, and the first approved local outbox projection. Keep remote views read-only.

**Gates.** Approve the provider, region, DPA, subprocessors, and data-location matrix. Provide tenancy proof, assign ownership for cloud recovery, monitoring, incidents, and costs, and approve the exact synchronized allowlist and retention.

**Exit.** Local posting and backup continue throughout a cloud outage. Duplicate, reordered, replayed, and cross-tenant sync cannot mutate or leak facts.

## M8: Release hardening

Complete all required local reports and exports. Remediate performance and accessibility with realistic data. Certify Windows, hardware, and peripherals. Deliver a signed staged installer, update, and offline bundle. Prove forward migration, failed-update recovery, backup and restore, and incident drills.

Complete the security review and penetration-test checklist, the privacy-reviewed crash-reporting decision and implementation, support diagnostics and runbooks, admin training documentation, compatibility matrix, release notes, SBOM, licence, secret, and vulnerability checks, and operational ownership.

**Exit.** Every applicable item in [`quality.md`](quality.md) has evidence. Do not waive any release gate without recording the waiver. A clean, supported pharmacy can install, operate offline, update, fail, restore, and export its data.

## Deferred promotion rule

Before work starts on a deferred capability, review current official sources and update the product, domain, workflow, and traceability documents. Close the capability's named gate, then deliver one thin end-to-end milestone. Do not begin by restoring old placeholder packages.
