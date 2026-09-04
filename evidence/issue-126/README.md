# Issue 126 implementation record

Branch: `codex/issue-126-payload-optimization`, based on `dev` at `961ef11`.

The stakeholder initiated implementation on 4 September 2026 after reviewing the [investigation](performance-investigation.md). Work is limited to the recommended packaging changes. Preserve the unified installer, role selection, service accounts, durability, repair/update preservation and genuine-uninstall deletion semantics. No codec replacement, split installer, cache experiment or skipped synchronization is included.

## Tasks and review checkpoints

Each completed task is separately committed and pushed. The final PR targets `dev` and remains unmerged for review.

| Task | Outcome                                                                     | Status                  |
| ---- | --------------------------------------------------------------------------- | ----------------------- |
| 01   | Explicit PostgreSQL runtime inventory with pruning and missing-file tests   | Component checks passed |
| 02   | Metadata-preserving API bundles, migration assets and native Argon2 runtime | Pending                 |
| 03   | Arabic/English packaging and complete payload integrity verification        | Pending                 |
| 04   | Rebuilt package measurements, regression evidence and review PR             | Pending                 |

## Acceptance reconciliation

The original issue's 285 MB / 350-file and API-under-five-file figures are infeasible with its required runtimes and migration assets. The investigation records the measured lower bounds. Track actual byte/file counts and use component regression budgets, not deletion of necessary files to satisfy those original figures. The projected complete application is 480–495 MiB / about 1,100 files before additional prerequisites; these remain estimates until measured. The PR must explicitly present this reconciliation for review and must not claim the original numerical criteria passed.

## Verification record

Task 01: the Windows unit subset passed (2 files / 10 tests), including inventory identity, backup/ICU/PLpgSQL/legal retention, missing-file refusal and invalid/duplicate paths. Copying the actual inspected pinned distribution through the production helper produced exactly 1,022 files / 72,548,645 bytes. This is a component check, not installed-artifact certification.

The host has no Docker executable; WSL reports `REGDB_E_CLASSNOTREG`. Full container-backed suites require CI or another available runtime. Do not close G-05/G-06/G-07 or mark the issue resolved without their applicable evidence.
