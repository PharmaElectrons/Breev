# T05 targeted verification — candidate checkpoint

Recorded 2026-10-01 on `issue/198-m2-purchasing-integrity`, based on accepted
T04 commit `8b34dc3718556b0140a266631dc11c5225a00149`. T05 received explicit
stakeholder PASS after repair on 1 October 2026. The subsequent
[full local pre-commit gate](pre-commit-gate.md) records independent results,
bounded test remediation and outstanding host limitations.

After this candidate's first manual review, the stakeholder reported an
evidence-only Adjustment save defect. See [the repair and newer affected-scope
verification](evidence-save-defect.md); it supersedes the earlier browser proof
for the master-edit → evidence-save sequence. Stakeholder PASS is recorded in
[the checkpoint](manual-checkpoint.md); the optional fixture proof is not generated.

| Targeted seam | Result | Proof |
| --- | --- | --- |
| Contracts | 216 tests passed, 9 files | `logs/t05-contracts-final.log` |
| Desktop focused units | 35 tests passed, 4 files | `logs/t05-desktop-units-confirmed.log` |
| Snapshot-only query boundary | 1 passed | `logs/t05-query-unit.log` |
| Real PostgreSQL T05 correction/history/redaction | 3 passed; 29 cases outside the selected scope | `logs/t05-postgres-final.log` |
| Final T05 browser workflows | 4 passed, 41.3 seconds | `logs/t05-browser-verified.log` |
| API typecheck and build | Exit 0 | `logs/t05-api-type-final.log`, `logs/t05-api-build-current.log` |
| Contracts build | Exit 0 before API/browser verification | `.scratch/runtime/t05-build-accepted-candidate.log` |
| Final renderer typecheck and Desktop build | Exit 0 | `logs/t05-renderer-type-confirmed.log`, `logs/t05-desktop-build-confirmed.log` |
| Changed source/test lint and formatting | Exit 0 | `logs/t05-lint-current.log`, `logs/t05-last-lint.log`, `logs/t05-format.log`, `logs/t05-last-format.log`, `logs/t05-format-confirmed.log` |
| Historical media preservation | All 1,259 original SHA256 hashes verified | `logs/t05-media-restoration.log` |

The final browser run covers English/Arabic × light/dark, optional Product/unit
correction with Cancel and Save focus restoration, authoritative percentage
retail after Save, saved multiline notes and facts, filtered Previous/Next,
item drill-down/back, dirty Adjustment Escape and save-and-leave, retained
query/date/sort/direction/selection/scroll/focus, and the saved-facts disclosure.
It exercises 1280×800, 1366×768, 1024×768 and 200% root text. Axe reports zero
violations in the reviewed detail and scaled list surfaces; this is not a claim
about every application screen or native Electron accessibility.

PostgreSQL cases prove historical response equality after changes to Product
names, unit names/ratios, pricing and Supplier names/rates; numeric ordering
across 9/10 and differing cost magnitudes; same-row correction, version/retry
and conflicting-payload rejection, stale version, invalid package rollback and
API restart; settings/permission cost redaction including saved margin; foreign
device denial; and absence of posted header/row mutation routes. These tests
run sequentially against the recorded disposable PostgreSQL 18 cluster on
loopback 5551. The manual fixture uses a separate disposable cluster on 5554.

The final price-editor change is covered by the final browser assertions and
fresh renderer typecheck/build/lint. It removes a client approximation from the
optional saved-row editor: percentage retail is explicitly calculated on Save.
The new-row keyboard loop and Quick Product code are unchanged.

## Diagnostic provenance

Earlier attempts are retained in `.scratch/runtime/t05-*.log`. Initial API/UI
attempts used stale build output; a test also expected the wrong existing
idempotency denial code. Selector failures led to explicit select labels and
hidden decorative icons; existing Adjustment selectors were aligned with the
accepted workflow. Numeric ordering was a real defect exposed by the fixtures
and corrected with numeric SQL ordering. The additional whole-page Axe check
found duplicate history-region names; distinct localized names fixed it, and
all four final cases passed without disabled rules. Earlier failed runs are
diagnostic evidence and are not added to final passing counts.

## Preservation and limits

`use-startup-connection.ts` and `tooling/dev.mjs` retain their initial SHA256
hashes respectively:

- `27ACD8E447DEE24964A1137E441FBF7F91F7748F8246010FF5BA5CD7C0EA913B`
- `73AAF0EE0779D110862F5E9A062DB5F8625AA3075D338FAB6C6622146C1D3E3B`

Prototype source, global styles and shell are unchanged. Historical evidence,
T02/T03/T04 manual fixtures and databases are retained. No schema migration,
grant/role revision or preload method/runtime import is introduced by T05.

No full repository, packaged release or remote-CI pass is claimed. The prior
[T04 gate](../t04/pre-commit-gate.md) retains the CNG, unavailable-container and
Windows crash-harness limitations; these targeted T05 seams do not resolve
them. The original fixture's master-edit/restart comparison ran and is retained
in `master-before-after.json`; the separate retry proof file remains ungenerated.
G-01/G-02 and accountant/pharmacist/legal decisions remain
open. This targeted record precedes the local T05 commit; the later gate is
linked above. No push, PR, merge or issue closure is authorized.

