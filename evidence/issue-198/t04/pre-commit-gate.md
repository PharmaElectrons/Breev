# Accepted T04 slice — local exit gate

1 October 2026, Africa/Cairo. The stakeholder explicitly accepted T04 with
“IT IS A PASS”; see [the checkpoint](manual-checkpoint.md). This permits the
focused local commit and subsequent T05 work, not professional or release approval.

The full chain ran once against the accepted production implementation. Its
broader seams exposed omitted offer inputs in older test fixtures. The fixtures
now explicitly send `none` on Purchase creation and the saved input on Adjustment
updates. No production behavior, assertion, crypto policy or permission was
weakened after acceptance. Only affected checks were rerun for these corrections.

| Gate                                                     | Result                                                                    | Classification                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format write/check, lint/boundaries, typecheck and build | All exit 0                                                                | Passed. Both unrelated dirty files were excluded from formatting and retain their original hashes.                                                                                                      |
| Aggregate unit                                           | Exit 1; Contracts 216 passed; API 684 passed / 12 skipped                 | Unchanged Pharmacy CA beforeAll fails machine CNG key creation with Access denied.                                                                                                                      |
| Independent Desktop unit                                 | 669 passed, 64 files; exit 0                                              | Passed; aggregate API failure prevents this downstream seam.                                                                                                                                            |
| Boundary / dev-launcher / release-tooling                | Exit 0; 1 launcher / 15 release tests passed                              | Passed.                                                                                                                                                                                                 |
| Strict integration                                       | Exit 1; 8 passed / 1 failed / 323 skipped; 38 files failed                | Turbo omits the configured database setting; fixtures seek unavailable Docker.                                                                                                                          |
| Loose integration with recorded disposable PostgreSQL    | Exit 1; 120 passed / 28 failed / 184 skipped; 14 files passed / 25 failed | Includes stale offer request fixtures, unavailable Docker, unchanged machine CNG and Windows SIGKILL/null harness limitations. Offer migration and Purchase posting files have no failures.             |
| Sequential affected API fixture rerun                    | 42 passed / 1 skipped; 7 files passed / 1 hook-failed; exit 1             | All corrected request scenarios passed. The remaining POS entitlement hook encounters unchanged machine CNG Access denied.                                                                              |
| Full browser                                             | 82 passed / 6 failed / 63 not run; exit 1                                 | Four old offer fixtures failed validation; unchanged Main pairing needs Docker; Purchase retry was interrupted by the agent's overlapping database-reset run.                                           |
| Sequential affected browser rerun                        | 53 passed / 1 failed / 18 not run; exit 1                                 | All four offer cases and the four corrected external browser fixtures passed. An exact T03 totals expectation omitted the new zero-offer fields.                                                        |
| Final remaining browser group                            | 16 passed / 3 opt-in manual skipped; exit 0, 1.1 minutes                  | Added explicit zero offer to both ordinary and empty-invoice exact expectations. The affected browser set now has 69 unique passed cases and 3 intentional manual skips across the two sequential runs. |
| Desktop package                                          | Exit 0                                                                    | Passed.                                                                                                                                                                                                 |
| Packaged smoke                                           | 3 passed; exit 0, 34.2 seconds                                            | Security/health, real offline commit/API restart, bundled Main/Preload imports.                                                                                                                         |

## Rerun provenance and preservation

The first affected API follow-up mistakenly overlapped the browser gate. Both
fixture helpers reset the same task-only database schemas. This caused missing
tables in two safety cases and interrupted a Purchase browser retry. That run
is retained as diagnostic evidence, not accepted proof. The final rechecks run
sequentially after the full gate; no assertion or production fix hides the
execution error. Counts across overlapping runs must not be added together.
The first remaining-group attempt found the same omitted zero-offer field in
the empty-invoice expectation; it is retained as diagnostic evidence in
`t04-browser-tail-final.log`. All exact totals expectations were then inspected,
and the final selected group passed in `t04-browser-tail-confirmed.log`. Existing
money expectations and production behavior were unchanged.

Regression tests use the recorded task-owned PostgreSQL 18 cluster on loopback 5551. The T02/T03 manual fixtures and T04 manual cluster on 5553 remain preserved.
Before browser runs, 730 existing PNG/WebM files were backed up with hashes.
Changed captures are archived under this slice and originals restored. The
full gate archived 18 changed captures; the first sequential browser group
archived 59. The final group archived 28 captures separately. All 730 original media
hashes and both protected user hashes are checked again before commit. One
PNG restore encountered a temporary Windows mapped-section lock; retry passed
without altering source or deleting evidence.

Full logs remain in `.scratch/runtime/m2-p1-t04-gate-*.log` and
`t04-fixture-{api,browser}-final.log` and `t04-browser-tail-confirmed.log`.
Aggregate exits/durations are retained in `gate-results.json`, `fixture-results.json`
and `browser-remaining-results.json`. The superseded overlapping run
is `.scratch/runtime/t04-fixture-api-recheck.log`.

Migration 0030 modifies no roles or grants (zero role-revision increments),
retains historical money/raw receipts/request hashes, and adds one stored replay
projection. No Main runtime import or preload method was added. Source review
confirms exact calculation, atomic rollback on invalid draft inputs, immutable
offer snapshots, saved-rule correction/hash, gross journal basis and scoped
Purchasing/Adjustment styles. Prototype source and protected row/Quick Product
behavior were unchanged.

This is not an all-green repository, release or remote-CI claim. Supported
CNG/container/crash-harness proof remains required at the phase gate. G-01/G-02,
the complete requirement family and the optional-note follow-up stay open. No
push, PR, merge or issue closure is authorized or performed.
