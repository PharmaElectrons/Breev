# Accepted T02 slice — local exit gate

Date: 30 September 2026. Stakeholder manual PASS and completion confirmed.
The saved note report remains open; acceptance is not a claimed persistence fix.

| Gate | Result | Classification |
| --- | --- | --- |
| `pnpm format:write`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | Exit 0 | Passed, including module boundaries |
| `pnpm test:unit` | Exit 1; Contracts 216 passed, Local API 663 passed / 12 skipped | Machine-scoped Microsoft CNG creation raises Access denied before assertions. No security/test weakening. |
| Independent Desktop unit suite | 650 passed in 61 files | Passed |
| Independent boundary, development-launcher, release-tooling checks | Passed; 1 launcher and 15 release tests | Passed |
| `pnpm test:integration` | Exit 1 | Turbo strict environment filters the configured disposable database setting; fixtures seek unavailable Docker. Corrected loose-environment run recorded below. |
| `pnpm test:browser` | 134 passed, 2 opt-in manual cases skipped, 5 not run, 1 failed | Pairing fixture requires unavailable Docker before product interaction. All Purchasing cases passed. |
| `pnpm package:desktop` | Exit 0 | Passed |
| `pnpm run test:integration --env-mode=loose` | 150 passed, 169 skipped; 20 files passed / 18 failed | Seventeen files require unavailable Docker. The other failure is the unchanged Inventory crash harness expecting `SIGKILL`; Windows reports null. Purchasing passed. |
| Packaged smoke via `playwright.config.ts` | 3 passed, exit 0 | Security/health, real offline commit/API restart, bundled Main/Preload imports |

Two verification invocations initially grouped their arguments incorrectly in
PowerShell. Their non-results are shell errors, not product failures; both were
rerun with explicit arguments. The regression database uses the verified
task-owned PostgreSQL 18 loopback cluster on port 5551. The stopped manual
database, normal Windows service and live pharmacy data are untouched.

Historical tracked evidence overwritten by the broad browser suite was restored
from pre-gate copies. The two unrelated dirty user files retain their original
hashes and are excluded from staging. Only T02's bounded source/docs/evidence
are committed. Ignored diagnostic logs: `.scratch/runtime/m2-p1-t02-gate-*.log`.

This is accepted-slice proof, not an all-green repository or release claim.
Supported CNG/container/crash-harness evidence remains required at the phase gate.
No push, PR, merge or issue closure is performed at this checkpoint.
