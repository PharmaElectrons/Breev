# T05 local pre-commit gate — 1 October 2026

T05 already had explicit stakeholder PASS, including the repaired evidence-only
Adjustment save. This gate does not request that acceptance again. It ran once
on `issue/198-m2-purchasing-integrity`, against T04 HEAD
`8b34dc3718556b0140a266631dc11c5225a00149` and the preserved T05 working tree.
No remote publication or professional/phase/release approval is implied.

## Recorded results

The full orchestration and each native exit code are in
`logs/t05-gate-results.json`; individual logs use `m2-p1-t05-gate-*.log`.

| Seam | Result |
| --- | --- |
| Format write/check | Exit 0, with both unrelated dirty files explicitly excluded |
| Lint, typecheck, build | Exit 0 |
| Aggregate unit | Exit 1: API 684 passed / 12 skipped, one CNG setup failure; Contracts log records 216 passed (Turbo cache may replay completed dependencies) |
| Independent Desktop unit | Exit 0: 669 passed, 64 files; aggregate cancellation is not counted as another pass |
| Boundaries / dev launcher / release tooling | Exit 0; deliberate boundary violations rejected; launcher 1 and release tooling 15 passed |
| Strict Turbo integration | Exit 1: 8 passed / 1 failed / 325 skipped, 38 failed files. Strict environment omits the recorded database variable; container-dependent setup cannot run on this host |
| Integration with loose environment | Exit 1: 163 passed / 2 failed / 169 skipped, 21 passed and 18 failed files. The recorded disposable local PostgreSQL seam is available to supported helpers |
| Full browser | Exit 1: 135 passed / 2 failed / 3 skipped / 15 did not run (155 scheduled), 10.8 minutes |
| Affected browser retry | Exit 0: 1 passed, 10.4 seconds. This overlaps the full run; counts are not added |
| Desktop package | Exit 0 |
| Packaged smoke | Exit 0: 3 passed, 34.7 seconds |

All database-backed suites ran sequentially on the recorded disposable regression
cluster on loopback 5551. Retained manual clusters 5553/5554/5555 were not reset.
The passing Purchasing checks and earlier targeted proof are distinct records;
this is not an all-repository or release pass.

## Failure classification and bounded repair

- **Host CNG limitation:** Windows machine key creation reports access denied in
  the pharmacy CA unit setup and Catalog/reorder Additional POS integration
  setup. No cryptography, DPAPI, certificate, ACL or assertion was weakened.
- **Prerequisite limitation:** older integration helpers and Main-pairing browser
  setup require Testcontainers, for which no working container runtime is present.
  The loose integration run still has these setup failures. No Docker installation
  or unrelated harness rewrite was attempted.
- **Windows harness limitation:** the Inventory crash-recovery case expects an
  exit signal of `SIGKILL`; this Windows child reports `null`. This is the
  previously recorded platform limitation, outside T05.
- **T05 test assumption:** the register unavailable-state test expected reopening
  to discard and reload the list. T05 intentionally retains loaded filters and
  results. The test now submits Search explicitly to request a fresh list, then
  verifies the unavailable notice and Retry recovery. Its focused retry passed.
  Production behavior did not change and accepted manual cases were not repeated.

No new migration, permission grant, preload method, Main/Preload runtime import,
global style or shared-shell change was introduced. G-01/G-02 and the older
unconfirmed evidence-note follow-up remain open.

## Preservation

Before the gate, 848 current evidence media files were backed up in addition to
the earlier 1,259-file historical manifest. Changed regression captures are
archived under `pre-commit-regression-captures/` before historical originals are
restored. The restoration logs record the exact checks and changed-file counts.
These are overlapping manifests, not additive evidence counts.

The protected files retain SHA256:

- `use-startup-connection.ts`: `27ACD8E447DEE24964A1137E441FBF7F91F7748F8246010FF5BA5CD7C0EA913B`
- `tooling/dev.mjs`: `73AAF0EE0779D110862F5E9A062DB5F8625AA3075D338FAB6C6622146C1D3E3B`

They remain unstaged and excluded from the focused T05 commit. Existing manual
sessions, fixtures, user screenshots, logs and the ungenerated optional retry
proof retain their handoff state.
