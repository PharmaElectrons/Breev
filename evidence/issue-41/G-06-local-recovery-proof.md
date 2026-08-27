# G-06 Local PostgreSQL and Recovery Evidence

Date: 27 August 2026

Issue: GitHub #41 (`10: Create the encrypted local recovery foundation`)

Status: **Milestone 1 stage-proof produced**. This record establishes the service-level local recovery foundation and proves WAL continuity, manifest verification, AES-256-GCM envelope encryption, live cluster isolation, Restore Quarantine, and durable job catch-up. Production off-device destination, 30-day retention automation, and clean-machine quarterly drill evidence close in milestone 4 through plans #60 and #72.

## Implemented seams

- **Base Backup & Atomic WAL Archiver**:
  Continuous WAL archiving uses Breev's atomic archiver (`archiveWalSegment`), which copies WAL files to a unique temporary filename (`<dest>/<file>.<uuid>.tmp`) before an atomic filesystem rename. This prevents partial-write reads on Windows caused by shell invocations or interrupted copies. WAL continuity is tracked via `wal_start_lsn` and `wal_end_lsn` with `pg_switch_wal()` integration.
- **Manifest Verification (pg_verifybackup class)**:
  `verifyBackupManifest` parses `backup_manifest` (version, system identifier, file tree, checksums, WAL ranges) and performs SHA-256 checksum verification on all backed-up files. The recovery point state machine transitions to `verified` strictly as the terminal atomic state after manifest verification passes.
- **AES-256-GCM Envelope Encryption & Machine Key Custody**:
  Each recovery point is encrypted at rest using a single-use 256-bit Data Encryption Key (DEK) with AES-256-GCM authenticated encryption. The DEK is wrapped using a machine-scoped Key Encryption Key (KEK) protected by Windows DPAPI (`CryptProtectData`/`CurrentUser`/`LocalMachine` scope) with a secure software fallback for test environments. If the key is missing or corrupted, restore refuses with explicit `RECOVERY_KEY_UNAVAILABLE` error.
- **Structural Isolation from Live Cluster**:
  `assertStrictRestoreIsolation` enforces hard structural checks comparing target data directory and port against the live PostgreSQL service configuration. Any match triggers a fatal safety block (`RESTORE_SAFETY_VIOLATION`), preventing destructive overwrites of active pharmacy databases.
- **Restore Quarantine & Extensible Verification Hooks**:
  Restored databases enter Restore Quarantine (`system_quarantine_state.is_quarantined = true`), and the Express middleware rejects normal-use REST requests with `503 Service Unavailable` (`code: "RESTORE_QUARANTINE"`). An extensible verification hook registry validates existing record classes before clearing quarantine:
  1. `LicenceTimeVerificationHook`: verifies pharmacy CA presence and detects clock rollback against the high-water mark timestamp.
  2. `DeviceIdentityVerificationHook`: validates registered terminal devices and ensures revoked devices remain revoked.
  3. `MainDeviceSecurityVerificationHook`: validates main device credentials and session integrity.
- **Durable Job Coordination & Missed Run Recovery**:
  `RecoveryJobService` integrates with `DurableJobsService` (`pg-boss` queue). On startup, it inspects the latest verified recovery point timestamp in `recovery_points`. If the last backup is older than 1 hour or missing, it detects a missed scheduled run and enqueues an immediate singleton catch-up job.
- **Content Inspection Proof**:
  Direct inspection of the decrypted recovery point payload proves the pharmacy CA private key (which resides in machine key storage) and plaintext passwords/tokens are excluded from the backup archive.
- **Immutability of Terminal Records**:
  Database trigger `prevent_terminal_recovery_point_mutation` blocks any `UPDATE` or `DELETE` on recovery points once marked `verified`, `failed`, or `corrupted`.

## Automated evidence available now

On Windows, `@breev/local-api` and `@breev/contracts` report:

```text
@breev/contracts: 40 passed
@breev/desktop:   48 passed
@breev/local-api: 40 passed (unit + recovery suite)
Boundary checks: passed (0 violations)
```

The recovery test suite verifies:

1. `validates standard PostgreSQL WAL filenames and history files` (passed)
2. `stages WAL copy to temporary file before atomic rename` (passed)
3. `rejects non-existent source WAL files` (passed)
4. `completes AES-256-GCM envelope encryption and decryption round-trip` (passed)
5. `refuses restore with explicit error if encryption key is unavailable` (passed)
6. `refuses restore with explicit authentication failure if ciphertext is tampered` (passed)
7. `verifies intact backup directory and computes valid manifest checksum` (passed)
8. `detects and rejects corrupted files with checksum mismatch` (passed)
9. `rejects backup directory with missing manifest or missing files` (passed)
10. `strictly refuses restore if target matches live data directory` (passed)
11. `strictly refuses restore if target is located inside live data directory` (passed)
12. `strictly refuses restore if target port matches live port` (passed)
13. `allows restore into isolated directory on distinct port` (passed)
14. `evaluates hooks and clears quarantine only when all checks pass` (passed)
15. `retains quarantine if a verification check detects a violation` (passed)

## Required evidence still open for Milestone 4

- Production off-device destination configuration and daily snapshot rotation (plan #60).
- 30-day rolling retention management and prune automation (plan #60).
- Quarterly clean-machine drill demonstrating full restore within RTO ≤4 hours and RPO ≤1 hour (plan #72).
- Full Restore Quarantine replay engine for Deletion Ledger, legal holds, and post-disaster CA trust domain re-establishment (plan #72).
- Owner-facing backup/restore UI and update-time recovery points (plan #73).
