# T06 / Phase 1 consolidated automated gate — 1 October 2026

The stakeholder initiated this full automated gate after explicitly accepting
T06. T01–T06 manual PASS records remain accepted. **The repository-wide gate
is not fully green.** The stakeholder subsequently gave explicit
[Phase 1 PASS](../../phase-1-checkpoint.md), retaining the open findings. T06 remains unstaged
and uncommitted on `issue/198-m2-purchasing-integrity`, based on accepted T05
commit `73620cd1c1d79591fc96d7f716750dd4a2a310a7`.

The complete outer chain ran once. Independent static/build/unit checks ran in
parallel where possible. Database-backed integration, browser, packaged smoke
and acceptance suites ran sequentially against the recorded disposable local
PostgreSQL seam on port 5551. Affected retries followed identified failures;
they do not replace the original full-run results or add to their pass counts.
No retained manual database was reset. No production behavior changed during
this gate.

## Full chain and affected verification

| Check | Observed result | Evidence |
| --- | --- | --- |
| Scoped protected exclusions, format write/check | Exit 0; unrelated protected files excluded | `logs/format-write.log`, `logs/format-check.log` |
| Lint, typecheck, build | Exit 0 | `logs/lint.log`, `logs/typecheck.log`, `logs/build.log` |
| Boundary enforcement proof | Exit 0; deliberate forbidden imports rejected | `logs/boundaries-proof.log` |
| Full unit command | Exit 1: Contracts 219 passed; API 685 passed, 12 skipped, one timeout and one CNG setup suite failure | `logs/unit.log` |
| Payload verifier affected retry | 3 passed, without changing timeout/security behavior | `logs/payload-unit-affected-retry.log` |
| Desktop unit completion after aggregate cancellation | 676 passed in 65 files | `logs/desktop-unit.log` |
| Development/release tooling tests | 16 passed | `logs/tooling-tests.log` |
| Full integration command | Exit 1: 163 passed, 5 failed, 169 skipped; 20 passed and 19 failed files | `logs/integration.log` |
| Purchase-posting owning file after T06 fixture isolation | All 25 passed, including the three T06 tests and Purchase/Adjustment/Return invariants | `logs/postgres-affected-file-retry.log` |
| Full browser command | Exit 1: 150 passed, 1 failed, 4 skipped, 5 not run, 160 scheduled; all executed Purchasing cases passed | `logs/browser.log` |
| Desktop package | Exit 0 | `logs/package.log` |
| Packaged smoke | All 3 passed | `logs/smoke.log` |
| Packaged correction sequence after selector repair | 8 passed: linked Return and exact +4/negative-stock scenario in four variants; 4 subsequent navigation failures and 4 not run retained | `logs/packaged-correction-panel-units-retry.log` |
| Packaged item-details isolated retry | All 4 panel cases passed; 4 later units cases failed (English clipping, Arabic stale label) | `logs/packaged-panel-units-copy-retry.log` |
| Packaged units after localized label correction | All 4 cases failed the same full-viewport preview-cell assertion; exact `4 Strip`/`4 أشرطة` conversion passed before that failure | `logs/packaged-units-visibility-final.log` |
| Final changed test file format/type/lint checks | Exit 0 | `logs/acceptance-source-format-check-final.log`, `logs/acceptance-source-types-final.log`, `logs/acceptance-source-lint-final.log` |

The 25 PostgreSQL tests overlap the original integration run. The standalone
payload tests overlap the unit run. Do not sum those counts. Earlier focused
T06/reference-volume results remain separately recorded in
[verification](../verification.md); no new performance certification is claimed.

## Return and final Purchasing proof

The full browser run passed Purchase Return creation, review, Post, reopen and
refusal/focus coverage. Real PostgreSQL passed independent Return values,
conservation, idempotency, contention safety, immutable proof, bidirectional
Purchase links, and remaining payable/corrected Supplier behavior.

Packaged `Breev.exe` passed the linked Return scenario in English/Arabic and
light/dark. Its later correction scenario also passed in all four combinations:
quantity 4→8 posts exactly +4, unchanged lines have zero Adjustment movements,
a Return of 3 leaves one unit on the blocked batch, and a further -3 Delta is
refused with the localized error visible and focused. The approved T04 offer
restart/correction/immutable-history scenario passed in PostgreSQL and in the
full Purchasing browser suite.

These are automated results. No new manual Return PASS or phase-level approval
is inferred.

## Failure classification and bounded repairs

- **CNG host limitation:** pharmacy CA machine-key access fails with
  `AccessDenied`; unit and entitlement integration setup cannot prove those
  requirements in this profile. No cryptography, permissions or key protections
  were weakened.
- **Missing Docker prerequisite:** remaining Testcontainers integration/Windows
  boot seams and the Main device pairing browser scenario cannot start a
  compatible container runtime. The supported local PostgreSQL seam ran; the
  retained manual databases were excluded.
- **Windows harness limitation:** the Inventory crash battery expects
  `SIGKILL`, but Windows reports a null signal. The assertion was retained.
- **Load-sensitive verifier attempt:** the PowerShell payload verifier timed
  out at 30 seconds during the initial parallel unit run; all three tests passed
  alone. The cause is not proven solely by the retry.
- **T06 fixture defects, repaired:** whole-file execution exposed cost settings
  inherited from earlier tests and shared Product stock. Scoped hooks save and
  restore the cost preference through public REST; the permission case now owns
  its Product and stock. Assertions are unchanged in substance. All 25 tests in
  the owning PostgreSQL file passed afterward.
- **Older packaged harness assumptions, repaired within the test file:** totals
  comparison rows were mistaken for changed item rows; a stale unchanged-lines
  sentence was replaced with the existing public movement assertion; supplier
  selection now waits for its actual option; Arabic basket units follow the
  accepted localized label; correction controls/error selectors address the
  accepted UI; invoice entry is selected explicitly before creating an invoice.
  Numeric fact and keyboard focus checks remain. No application layout, global
  style, keyboard flow or accessibility rule was changed.
- **Sales accessibility finding outside Phase 1 ownership:** packaged Sales
  draft preservation passed, then Axe reported `scrollable-region-focusable`.
  It remains unresolved. This run does not establish whether it predates Phase
  1. The Sales surface was not changed, and the rule was not suppressed. See
  `logs/packaged-en-light-ready-supplier.log` and the
  [follow-up record](../../followups.md).
- **Packaged Purchase preview visibility:** the units scenario reaches the
  correct `4 Strip` conversion, but the complete base-unit preview cell is not
  inside the default packaged viewport. Its strict ratio-1 assertion fails
  (all four variants observed ratio approximately 0.798 after correcting the
  stale Arabic unit expectation). This is a visibility
  finding, not a failed unit conversion. The later stocktake assertion in that
  scenario is not reached. The protected Purchase entry layout was not changed,
  and the assertion was not relaxed. See
  `logs/packaged-panel-units-copy-retry.log`.

The original full packaged acceptance run was **12 passed, 4 failed, 24 not
run**. A later selective run excluding Sales was **18 passed, 4 failed, 14 not
run**: the bilingual scenario depends on the Sales draft created by the omitted
case; Arabic basket copy was stale. Neither run is a full packaged PASS.
The affected Purchasing/Inventory sequence subsequently passed eight cases
across four variants before an obsolete correction selector blocked later
cases. After correcting those selectors, the Return/negative-stock sequence
passed eight cases across four variants; subsequent panel cases encountered
test navigation left on the posted view. All attempts and native exit metadata
are retained, without accumulating their passing counts.

The isolated panel retry additionally identified two leftover assumptions in
the T06 acceptance test: singular Arabic `شريط` instead of the physical
packaging equation `١ علبة = ٤ أشرطة`, and raw `90000` instead of the accepted
localized wholesale amount. The test now asserts the exact packaging equation
and exact localized price consistently, including negative row/review checks.
The stale transcript note claiming raw fils display was corrected. Production
money formatting and application behavior remain unchanged.

The packaged panel cases passed with Axe scans and full viewport assertions in
all four locale/theme combinations. The final units-only retry remains red:
the localized quantity/unit assertion passes, then the strict viewport check
fails in all four variants. No further broad rerun or out-of-scope layout repair
was undertaken.

## Static integrity and preservation

The cumulative Phase 1 diff was audited from `ac1916c` through this working tree.
AST comparisons show the 13 protected Purchase row/Quick Product functions and
both ProductForm call sites unchanged. Main, preload, Electron dependency
bundling configuration and ProductForm source are unchanged. No new preload
method or runtime Main/preload dependency was introduced; packaged smoke proved
the unresolved-import/security seam.

Phase 1's new `0030_purchase_invoice_offer.sql` contains zero role-modifying SQL
statements, so the required role revision increment is zero. The audit does not
replace runtime migration proof. T06 adds no migration. Internal M2 posting
accounting changes do not introduce M3 accounting/reporting UI.

Protected unrelated files retained exact SHA256 hashes:

- `apps/desktop/src/renderer/src/use-startup-connection.ts`:
  `27ACD8E447DEE24964A1137E441FBF7F91F7748F8246010FF5BA5CD7C0EA913B`
- `tooling/dev.mjs`:
  `73AAF0EE0779D110862F5E9A062DB5F8625AA3075D338FAB6C6622146C1D3E3B`

Preservation manifest, original working-source backup, binary starting diff,
raw failures, repeated packaged screenshots/traces and original package remain
under `.scratch/runtime/t06-phase-gate-1790863047507`. New overwritten evidence
is archived before restoring historical originals. Final restoration and safety
results are recorded beside this report. The restoration logs verify all
1,933 original evidence/test-results files before the authorized acceptance
documentation updates; the 75-file original package remains in the preservation
backup. `packaged-captures/` contains the latest generated panel/Return/Adjustment
images, with hashes and capture file times in `packaged-capture-manifest.json`.
Their case verdicts come from the corresponding logs; they are not an all-pass
transcript. `units-final-transcript.json` contains the four final failed units
records and current executable/source provenance. Earlier logs and failure
traces remain under the runtime archive.

The first restoration completed all 1,933 hash checks and restored 401 changed
files, but its wrapper read a stale native exit code because the scratch helper
did not explicitly exit zero after restoration. The helper was corrected;
independent restoration verification exited zero, rechecked all 1,933 hashes
and required zero further restores. Both logs are retained. This was a shell
wrapper defect, not a failed restoration or product failure.

G-01/G-02, G-16 search performance, Narrator/physical-profile proof, professional
and release gates, and the older unconfirmed evidence-note follow-up remain
open. No #63/#75, OCR/cloud/final printing or subsequent phase was implemented.
No staging, commit, push, PR operation, merge or issue closure occurred.
