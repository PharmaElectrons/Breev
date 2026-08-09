# Epic 15: Recover safely from database, service, update, power, LAN, and peripheral failures

Type: epic
Status: needs-triage
Engineering phase: P11 — Production release
Blocked by: 01, 07; Windows/hardware/signing/update gates
GitHub issue: #17
Parent GitHub specification: #2

## User Story

As a pharmacy owner, I want verified backup, restore, repair, update, and hardware recovery that preserves the last recoverable business state, so that an operational failure never causes a silent reset or duplicate transaction.

## Outcome

Deliver product-managed PostgreSQL health/repair, encrypted hourly recovery points, daily verified snapshots, off-device copy, rolling retention, restore quarantine/replay, signed installer/update/offline bundle, maintenance-window drain, forward-only resumable migration, compatibility-safe rollback/restore, diagnostics, Certified Hardware Profiles, and peripheral/power/LAN recovery runbooks/evidence.

## Expected workflow

1. Local service continuously reports backup/DB/disk/version/peripheral health and creates policy-scheduled encrypted recovery points with verification and off-device status.
2. Restore verifies identity/authorization/source/integrity, restores into quarantine, then replays Deletion Ledger, holds, revocations, and later security state before release.
3. Update verifies signer/chain/hash/target/compatibility, owner window, disk/health/terminal compatibility and a fresh verified pre-update backup.
4. System drains active transactions/jobs/backups, installs signed binaries, and runs forward-only resumable migrations.
5. Health failure uses binary rollback only when schema-compatible; otherwise verified recovery/forward repair follows the documented boundary. No blind downgrade/reset.
6. Printer/scanner/drawer/LAN/power failure preserves committed business facts and offers physical recovery without replaying commands.

## Invariants and failure behavior

- Repair/reinstall/uninstall preserves database, backups, config, CA/device state, and audit by default.
- Cloud backup never replaces independent local backup; subscription expiry never blocks security repair/backup/export/restore.
- Restored old data is unavailable until later deletion/security/revocation state is replayed and verified.
- Every certification claim names exact OS/hardware/driver/firmware/connection/profile and limitations.

## Acceptance scenarios

- Given a verified backup and later deletions/revocations, when it is restored, then quarantine prevents use until those later states replay and no deleted/revoked fact reappears.
- Given update/migration failure, when recovery executes, then the last recoverable state is preserved and no unsupported DB downgrade or auto-reset occurs.
- Given printer/scanner/drawer failure after or during a sale, when recovery is used, then business posting occurs at most once and manual/reprint status is explicit.

## Planned child slices

- DB/service health; backup scheduler/encryption/verification; off-device/retention; restore quarantine/replay; signed installer; manifest/channels; maintenance/drain; migration/update recovery; diagnostics/repair/uninstall; hardware adapters/profiles; power/LAN scenarios; quarterly drill/release evidence.

## Gate and exclusions

- Exact supported Windows/hardware, signing key, installer technology, deferral/deadline, backup destination, and certification matrix require P11 approval/evidence. No claim of universal peripheral support.

## Traceability

- US-097–099; REQ-ARCH-010, REQ-NFR-001–002, REQ-NFR-027–049; ADR-004, ADR-011, ADR-015, ADR-017, ADR-023–024, ADR-027.
