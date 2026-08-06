# ADR-024: Signed, Staged Installer and Update Safety

- Status: **Accepted provisionally — installer technology and final deferral/deadline values require implementation evidence and release revalidation**
- Date: 2026-08-06
- Decision owners: Desktop platform / release / security / operations / database / support
- Related: REQ-NFR-001, REQ-NFR-035–044, Q-022, ADR-004, ADR-011, ADR-013, ADR-017, ADR-023, R-020, R-029

## Context

Breev updates application binaries, a local API, Windows services, and sometimes database schema while a pharmacy must remain able to sell offline. An Electron updater alone cannot coordinate PostgreSQL, migrations, peripheral processes, active transactions, backups, or recovery. A bad update must not corrupt posted records or leave a pharmacy dependent on internet support.

The stakeholder approved the policy baseline now and will revisit exact installer technology and operational values when implementation evidence is available. No MSIX, NSIS, WiX, Forge, Builder, or other packaging tool is selected by this ADR.

## Decision

### Authenticity and release channels

- Sign every installer, update manifest, executable, service binary, and offline bundle with a Breev-controlled trusted code-signing identity. Use SHA-256 digests and trusted timestamps; verify publisher, certificate chain/revocation, hash, target architecture, version, and compatibility metadata before execution.
- Protect release-signing keys with managed/HSM-backed storage and least-privilege release access. They must not be reusable files in source control or ordinary CI secrets.
- Use Internal, opt-in Pilot, and Stable channels. A security Emergency channel may shorten exposure but cannot bypass signature, backup, compatibility, or health gates.
- The signed manifest declares application/API/database compatibility, migration requirements, release channel, minimum supported version, artifact hashes, release notes, and any security deadline.

### Download, maintenance, and entitlement continuity

- Normal updates may download in the background. The owner/administrator receives clear notice and chooses or defers installation; a normal deferral target is no more than 14 days, subject to later operational validation.
- A critical security release carries a signed deadline, initially targeted at 72 hours after validation. Installation occurs at the next safe maintenance window, never in the middle of a sale, purchase, payment, stock movement, backup, restore, or migration.
- Update availability and security repair remain usable for Free Core and do not require an active paid subscription. Offline signed installer bundles are supported.
- If an unpatched vulnerability affects LAN, cloud, or another paid capability, Breev may isolate only that unsafe capability after its deadline. It must not block main-computer Free Core sales, local pharmacy data/history/reports, printing, backup, export, or renewal.

### Preflight and transaction-safe sequence

- Before install, verify supported Windows/architecture, signature/manifest, disk space, local API/database health, compatible terminal/client versions, backup destination, and a fresh encrypted recovery point.
- Drain new work and wait for active posting/payment/stock/accounting, backup, restore, provider, and migration operations to finish. Preserve durable drafts and queues.
- Install signed binaries, run forward-only resumable/idempotent migrations, start services, run health/integrity/permission checks, and reopen only after all required checks pass.
- A main-computer upgrade must not silently leave additional terminals with an incompatible API. Terminal update packages are themselves signed; incompatible terminals receive a clear update-required state while the main Free Core remains available.

### Rollback, repair, uninstall, and recovery

- Before schema migration, application binaries may return to the prior known-good version. After migration, an older binary may run only if its schema compatibility is explicitly proven.
- Never perform a blind reverse database migration. If a migration fails before reopening, restore the complete verified pre-update recovery point. If transactions occurred after release, prefer a forward repair/hotfix; restoring an older point requires explicit owner-authorized recovery and reconciliation because later work could be lost.
- Repair reinstalls signed application/service components while preserving the local database, backups, configuration, pharmacy CA/device state, and audit history. Uninstall preserves customer data by default; destructive removal requires a verified export/backup and explicit owner confirmation.
- Record check, download, verification, deferral, maintenance, install, migration, failure, rollback/restore, repair, uninstall, and final version outcomes with trusted time and actor/device context.

## Alternatives considered

- Electron-only auto-update: rejected because it cannot safely coordinate local PostgreSQL, migrations, services, active transactions, and recovery.
- Silent forced update: rejected because an interruption during posting or payment can corrupt business state and disrupt pharmacy operations.
- Blind downgrade of database schema: rejected because it can lose or reinterpret posted records.
- Manual unsigned zip replacement: rejected because authenticity, repair, service lifecycle, and support evidence are weak.
- Automatic block of all operations after a security deadline: rejected because the pharmacy's Core POS and data-continuity boundary must survive paid/cloud failures and narrow unsafe-capability isolation.

## Consequences

- Positive: signed supply chain, predictable maintenance, recoverable failures, durable drafts, and no accidental transaction replay or database downgrade.
- Negative: release engineering, signing protection, pilot channels, compatibility testing, recovery storage, migration design, and pharmacy maintenance windows require dedicated work.
- Required evidence before final acceptance: clean/offline install, upgrade, interrupted update, signature failure, compromised/expired manifest, disk/service/permission failure, backup failure, migration failure, compatible/incompatible client, rollback/repair, uninstall with preserved data, and security-deadline behavior.

## Official evidence checked during Phase 0

- Microsoft SignTool and SHA-256/timestamp guidance: https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool
- Microsoft Smart App Control signing requirements: https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview
- Electron Windows update behavior: https://www.electronjs.org/docs/latest/api/auto-updater
