# PR #201: remediation after merging dev

Candidate starts at `0b0a4f1d472d0d5b99779d534f90e3f5213196af`, with pending merge from `1fec386b80609be8f3a0d8c2cf39dcfcebb779f0`. This record supersedes earlier readiness claims for that candidate. Measurements use isolated PostgreSQL 18.6 on Linux; they are synthetic development evidence.

The compiler collision is resolved by removing three unused/conflicting imports from the purchase review. Inventory exports now check a conservative scalar byte bound before ordered row serialization. Batch exports can reject through historical membership and minimum row bytes alone. The exact byte boundary and final 24 MiB response guard remain in place: smaller exports are complete.

Product activity counts each matching posting's effects in one grouped scan, then reads bounded candidates using those exact counts. It does not calculate lifetime balances for an unfiltered activity page. Column-filtered activity still evaluates the report row. Forward migration `0040_report_source_pages` adds the source-order index without changing facts, grants, or role revisions. Batch column predicates select matching IDs before aggregation; actor choices still cover the complete attributed period. Sparse status/expiry events are read once, and JIT is disabled within the report's read-only transaction.

## Verification matrix

| Finding                       | October 3 re-audit                                 | Remediated candidate                                                                        |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Oversized export              | HTTP 500 under concurrent load; idle denial 7.47 s | Two concurrent HTTP 413 `export-too-large` responses in 711/717 ms; no rows and under 1 KiB |
| Query performance             | Movement SQL p95 473.7 ms; valuation 247.6 ms      | Movement 195.591 ms; valuation 93.551 ms; 20 EXPLAIN ANALYZE samples each                   |
| Arabic dates                  | PASS after author fix                              | PASS: month ١٠, posting/business ISO dates and language switches                            |
| Parent invoice                | PASS, including revoked permission                 | PASS: original purchase snapshot and permission revocation                                  |
| English navigation            | PASS at 1280×800 in both themes                    | PASS: both themes, direct entry, locale switches and resizing                               |
| CSV sanitation                | PASS for business-only exports                     | PASS: localized business headers; no internal IDs, query JSON or explanations               |
| Merge compiler/lint collision | Duplicate view declarations and unused import      | Imports repaired; final repository gate recorded below                                      |

All 26 reporting tests passed: 20 real PostgreSQL integration tests and six unit tests. The strengthened assertions cover two concurrent oversized exports, subsequent ordinary inventory pagination (261 ms), subsequent 100-row batch pagination (1,687 ms), complete exact byte-boundary exports, equality of filtered/unfiltered movement pages, and preservation of actor choices when no batches match. The 17 source-table hashes remain unchanged. The maintained SQLSTATE 55000 checks and independent nominal Primary Supplier Cost WAC reconciliation pass.

The performance fixture contains 300,016 facts and 50,009 batches. SQL p95 for the unfiltered batch page is 1,601.123 ms; no 300 ms batch-page target is claimed. API p95 is 182.162 ms for activity, 103.596 ms for valuation, and 1,509.868 ms for batch history. The cold concurrent-export/recovery assertions run before benchmark statistics refresh. An additional query-seam run without that refresh measured movement/valuation p95 at 192.945/91.754 ms.

All 36 migration journal entries from dev are preserved exactly, with contiguous indexes 0–40 and corresponding SQL files: 41 migrations in total. The new index contributes zero role-modifying statements.

## Repository verification

| Gate                                                          | Final result                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm format:write`, `pnpm format:check`, `pnpm lint`         | PASS                                                                                                            |
| `pnpm typecheck`, `pnpm build`, `pnpm check:licence-artifact` | PASS                                                                                                            |
| `pnpm test:unit`                                              | PASS: 1,683 workspace tests, two platform skips; 16 launcher/release-tooling tests and boundary proof also pass |
| `pnpm test:integration`                                       | PASS: all 40 files, 352 tests, two platform skips                                                               |
| `pnpm test:browser`                                           | PASS: 183 tests, four opt-in skips; all 30 inventory/report scenarios pass                                      |
| `pnpm package:desktop` and packaged Playwright smoke suite    | PASS: all three tests, including offline/restart and security boundaries                                        |
| Independent UI telemetry                                      | PASS: 56 report roots and eight activity dialogs; 64 axe scans; zero violations or page errors                  |

One `pnpm verify` attempt stopped when a disposable PostgreSQL container failed its health startup; the affected migration file passed on isolated repetition. A subsequent parallel run of integration and browser suites produced two reporting timing failures and two browser assertions. All four cases then passed in isolation. The complete integration and browser gates passed sequentially afterward, without production changes between these repeats or relaxation of the repository's assertions. Their logs, including failed attempts, are retained in `scratch/remediate-pr201-20261003/logs/`. This does not establish the causes of older intermittent incidents documented in the parent README.

The successful final integration gate took 637.84 s; the complete browser gate took 13.6 minutes. Its skips are the opt-in reference-volume measurement and three interactive manual Purchasing checkpoints. The Linux platform skips do not certify Windows behavior. Test-generated Purchasing captures were restored to the staged dev versions; the pending merge and original working edits were preserved.

The independent matrix covers all seven categories in Arabic RTL and English LTR, Light and Dark, at 1280×800 and 1366×768. All 56 report roots have zero navigation clipping and zero horizontal document/body overflow. The English Reports label is 47 pixels wide and fully visible at 1280×800 in both themes. All 64 axe scans and page-error observations pass. Raw measurements are in [post-dev-ui-matrix.json](post-dev-ui-matrix.json).

Raw final measurements and plans are retained with this record. Hosted checks are verified on the pushed commit before approval and merge. Existing professional and Windows release certification gates in the parent README remain separate.
