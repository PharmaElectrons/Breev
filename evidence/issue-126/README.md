# Issue 126 implementation record

Branch: `codex/issue-126-payload-optimization`, based on `dev` at `961ef11`.

The stakeholder initiated implementation on 4 September 2026 after reviewing the [investigation](performance-investigation.md). Work is limited to the recommended packaging changes. Preserve the unified installer, role selection, service accounts, durability, repair/update preservation and genuine-uninstall deletion semantics. No codec replacement, split installer, cache experiment or skipped synchronization is included.

## Tasks and review checkpoints

Each completed task is separately committed and pushed. The final PR targets `dev` and remains unmerged for review.

| Task | Outcome                                                                                 | Status                  |
| ---- | --------------------------------------------------------------------------------------- | ----------------------- |
| 01   | Explicit PostgreSQL runtime inventory with pruning and missing-file tests               | Component checks passed |
| 02   | Metadata-preserving API bundles, migration/native assets and complete payload integrity | Component checks passed |
| 03   | Arabic/English packaging and selective vendor extraction                                | Pending                 |
| 04   | Rebuilt package measurements, regression evidence and review PR                         | Pending                 |

## Acceptance reconciliation

The original issue's 285 MB / 350-file and API-under-five-file figures are infeasible with its required runtimes and migration assets. The investigation records the measured lower bounds. Track actual byte/file counts and use component regression budgets, not deletion of necessary files to satisfy those original figures. The projected complete application is 480–495 MiB / about 1,100 files before additional prerequisites; these remain estimates until measured. The PR must explicitly present this reconciliation for review and must not claim the original numerical criteria passed.

## Verification record

Task 01: the Windows unit subset passed (2 files / 10 tests), including inventory identity, backup/ICU/PLpgSQL/legal retention, missing-file refusal and invalid/duplicate paths. Copying the actual inspected pinned distribution through the production helper produced exactly 1,022 files / 72,548,645 bytes. This is a component check, not installed-artifact certification.

The host has no Docker executable; WSL reports `REGDB_E_CLASSNOTREG`. Full container-backed suites require CI or another available runtime. Do not close G-05/G-06/G-07 or mark the issue resolved without their applicable evidence.

Task 02: isolated bundled-runtime integration passed (7 tests) against a disposable PostgreSQL cluster using the pruned binaries. This includes no-node_modules Nest DI startup, concurrent/idempotent privileged migrations, runtime DDL denial, UTF-8 Arabic and ICU/PLpgSQL, transaction rollback, owner bootstrap/password hash and verification, API restart/login, logical dump/restore, and physical backup verification. The two bundles total 6,759,696 bytes; 13 SQL migrations and the Windows Argon2 addon are retained. The original TypeScript module build remains the development/test build; Windows deployment uses only the CJS entrypoints and explicit assets.

Integrity checks moved into task 02 so the new bundled deployment is never shipped without file coverage. The actual PowerShell verifier passed clean and tamper scenarios (3 inventory tests); the test harness explicitly imports its built-in Utility module before invoking the AST-extracted function. The full prepared payload was also checked through that verifier without invoking any service lifecycle action. Desktop post-sign configuration tests passed (4 tests). Runtime files are hashed after signing while non-signable SQL/JS must still match the assembled inventory. Final installed lifecycle certification remains pending.
