# G-06 local PostgreSQL and recovery — milestone 1 stage proof

Date: 28 August 2026

Issue: [#41](https://github.com/PharmaElectrons/PharmaElectrons/issues/41), `Create the encrypted local recovery foundation`

Status: **incomplete**. The recovery point state machine, envelope encryption, manifest verification, restore isolation, and Restore Quarantine are implemented and proved against real PostgreSQL. The recovery mechanism itself is **not** the PostgreSQL base backup plus WAL that [`docs/architecture.md`](../../docs/architecture.md) §Durable work, backup, and cloud requires, and no step of this record has been executed on Windows. G-06 does not close on this record.

29 August 2026: the stakeholder accepted this record as the milestone-1 recovery basis, per [`docs/open-decisions.md`](../../docs/open-decisions.md) G-06. The milestone-1 start gate for dependent work is satisfied. The mechanism gap under "Tool selection", the Windows execution of this record, and the rest of "Open before G-06 closes" are release-gated.

## What this record proves, and where

Every claim below is backed by a test that runs against a real PostgreSQL 18.6 container. No claim in this record was produced on Windows.

`apps/local-api/test/recovery.integration.test.ts` (real PostgreSQL, separated `breev_app` and `breev_schema_owner` roles):

- `registers the recovery queue on startup even though init hooks run concurrently` — the recovery queue and worker register even though Nest runs initialization hooks concurrently.
- `observes a missed backup run and enqueues exactly one catch-up` — a start with no verified recovery point reports a missed run and enqueues exactly one catch-up, no matter how often it restarts.
- `records a verified recovery point only after the stored file verifies` — the recovery point reaches `verified` only after the encrypted file that was written to disk is read back, decrypted, and verified against its manifest, and no staging or temporary file survives.
- `captures every application table and no partial backup reaches verified` — the recovery point content covers every table in the `public` schema; a table that cannot be read fails the whole run.
- `excludes the pharmacy CA private key and refuses a recovery point that would carry one` — the decrypted content carries the pharmacy data and no private key material, and planting private key material in a backed-up table fails the run instead of encrypting it.
- `keeps terminal recovery point outcomes immutable` — a recorded terminal outcome rejects updates and deletes, including from the schema owner, while a non-terminal row still deletes.
- `refuses to restore a recovery point that is not recorded as verified` — a recovery point recorded as `corrupted` can never be restored as verified.
- `restores a verified recovery point into an isolated directory under quarantine` — the restore writes its quarantine marker before any restored byte, verifies the restored manifest against the immutable recorded checksum, and leaves the running pharmacy dataset out of quarantine.
- `persists the quarantine state of a dataset across a service restart` — a quarantined dataset is still quarantined after the service restarts.
- `refuses a restore that targets the live pharmacy cluster` — a restore aimed inside the live data directory is refused.
- `clears the quarantine only after the verification hooks pass` — a dataset that lost its Main device records stays quarantined; the quarantine clears only once every hook passes.
- `records a run interrupted by a killed process as failed, never verified` — a run left in progress by a killed process is recorded as failed on the next start.
- `returns the existing recovery point when a duplicate job run repeats an identity` — a duplicated durable job run returns the existing recovery point instead of producing a second one.

`apps/local-api/src/main-device/main-device-security.integration.test.ts`, `refuses normal use while the dataset is in Restore Quarantine`: over the real transport, with a verified Main device session, a quarantined dataset answers `503` with `code: "restore-quarantine"` on both a protected read and a state-changing route, the proof mutation never reaches its handler, and the health handshake stays reachable.

`apps/local-api/src/recovery/recovery.unit.test.ts`:

- `Recovery envelope encryption` — a single-use data encryption key per recovery point, a wrap bound to the key identifier, and closed failures for a wrong key, a tampered ciphertext, a tampered wrapped key, and a swapped key identifier. `readMachineRecoveryKey` rejects an unsupported key name and has no path outside Windows machine key custody.
- `Manifest verification` — rejects a corrupted file, a missing file, a file present but absent from the manifest, an empty manifest, and a missing manifest.
- `WAL archiver` — publishes durably with no temporary file left behind, accepts an identical retry, refuses to overwrite an archived segment with different content, and refuses a `.partial` segment.
- `Restore isolation boundary` — refuses a target that is, contains, or sits inside the live data directory, one that reaches it through a symbolic link, one that binds the live port, and one that cannot name the live cluster at all.

## Tool selection

Not settled. `docs/architecture.md` requires PostgreSQL-supported base backup, WAL, and PITR tooling, and states that `pg_dump` alone does not prove the RPO. The current implementation writes a per-table JSON export of the `public` schema, encrypts it, and records the write-ahead log position around the export. That is a logical export, not a base backup: it captures no write-ahead log segments, replays nothing, and cannot restore a running cluster.

The intended mechanism, and the work this record does not cover, is:

1. `pg_basebackup --format=tar --wal-method=stream --checkpoint=fast --manifest-checksums=SHA256` run from the pinned `postgresql\bin` directory that `apps/local-api/windows/payload-lock.json` already ships (PostgreSQL 18.6-1).
2. `pg_verifybackup` over the produced backup before the recovery point is encrypted.
3. A replication-capable role and a `replication` line in `pg_hba.conf`. `apps/local-api/windows/bootstrap.sql` currently creates `breev_app` and `breev_schema_owner` as `NOREPLICATION`, and `apps/local-api/windows/lifecycle.ps1` writes a `pg_hba.conf` with no replication entry, so no base backup can be taken from the packaged service today.
4. `archive_command` wired to the archiver in `apps/local-api/src/recovery/wal-archiver.ts`. The archiver is implemented and unit tested, but nothing configures PostgreSQL to call it, so no WAL is archived.

## Encryption and key custody

Each recovery point is sealed with a fresh 256-bit data encryption key under AES-256-GCM. That key is wrapped with a machine key encryption key, and the wrap is bound to the key identifier as additional authenticated data. `readMachineRecoveryKey` obtains the machine key from Windows DPAPI at `DataProtectionScope::LocalMachine` with per-key additional entropy, stores it under `%ProgramData%\Breev\Recovery` with an access control list restricted to the service identity, and refuses on every other platform. There is no software key path reachable from configuration or the environment: the key provider is an injected dependency, and only a test that constructs the coordinator itself can supply a different key.

**Unproved.** The DPAPI path has never been executed. Everything in the table above ran on Linux with an explicit test key.

## Open before G-06 closes

- Replace the logical export with `pg_basebackup` plus streamed WAL, verified by `pg_verifybackup`, including the replication role and `pg_hba.conf` entry the packaged service needs.
- Configure `archive_command` so WAL segments are continuously archived, and prove that a backup taken during active writes restores to a consistent state after replay.
- Bring the restored data directory up as an isolated, non-serving PostgreSQL instance rather than restoring files into a directory, and carry the quarantine marker written by the restore into that instance's `system_quarantine_state` so it serves nothing until the verification hooks pass. Today the marker records the restored dataset's quarantine state, but nothing consumes it.
- Execute the whole cycle on Windows on the packaged service configuration and capture the transcripts: key custody, backup, verification, restore, and quarantine.

## Deferred to later issues, not blockers for this record

- Production off-device destination, daily snapshot rotation, rolling 30-day retention, and owner-facing failure monitoring: [#91](https://github.com/PharmaElectrons/PharmaElectrons/issues/91).
- Clean-machine restore drill within RPO ≤1 hour and RTO ≤4 hours, and the full Restore Quarantine replay of deletions, holds, and revocations: [#103](https://github.com/PharmaElectrons/PharmaElectrons/issues/103).
- Owner-facing backup and restore interface, and update-time recovery points: [#104](https://github.com/PharmaElectrons/PharmaElectrons/issues/104).
