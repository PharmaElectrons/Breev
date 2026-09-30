# Accepted T03 slice — local exit gate

Date: 30 September 2026. Stakeholder PASS based on agent-executed automated and
visual verification; see [acceptance](manual-results.md). No personal completion
of all prepared manual cases or Windows Narrator test is inferred.

| Gate                                                                                  | Result                                                                          | Classification                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:write`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | Exit 0                                                                          | Passed, including module boundaries                                                                                                                                                                                                                   |
| `pnpm test:unit`                                                                      | Exit 1; Contracts 216 passed, API 664 passed / 12 skipped                       | One unchanged Pharmacy CA suite fails machine-scoped Microsoft CNG creation with Access denied before assertions. No crypto or assertion weakening.                                                                                                   |
| Independent Desktop unit suite                                                        | 657 passed in 63 files, exit 0                                                  | Passed                                                                                                                                                                                                                                                |
| Independent boundary, development-launcher and release-tooling checks                 | Exit 0; 1 launcher and 15 release tests                                         | Passed                                                                                                                                                                                                                                                |
| `pnpm test:integration`                                                               | Exit 1; 8 passed / 312 skipped, 37 files failed                                 | Turbo strict environment omits the configured disposable database setting; fixtures seek unavailable Docker. Loose run follows.                                                                                                                       |
| `pnpm run test:integration --env-mode=loose`                                          | 150 passed / 169 skipped; 20 files passed / 18 failed                           | Fifteen files encounter unavailable Docker (including one failed boot test); two authorization suites encounter machine CNG Access denied; one unchanged Inventory crash test expects SIGKILL but Windows reports null. Purchasing/Post cases passed. |
| `pnpm test:browser`                                                                   | 138 passed / 3 opt-in manual cases skipped / 5 not run / 1 failed, 11.7 minutes | The unchanged Main pairing fixture requires unavailable Docker before product interaction. All Purchasing cases passed.                                                                                                                               |
| `pnpm package:desktop`                                                                | Exit 0                                                                          | Passed                                                                                                                                                                                                                                                |
| Packaged smoke via `playwright.config.ts`                                             | 3 passed, exit 0, 41.2 seconds                                                  | Security/health, real offline commit/API restart, and bundled Main/Preload imports                                                                                                                                                                    |

The full chain runs once after T03 acceptance. Independent Desktop/unit-tooling
checks run because the earlier aggregate unit failure prevents downstream tasks.
Loose integration preserves the intended configured PostgreSQL seam rather than
guessing credentials or substituting a live database. Regression fixtures use
the verified task-owned PostgreSQL 18 cluster on loopback port 5551. The retained
T02 manual database and separate T03 manual fixture on port 5552 are untouched.

The complete contract/server/renderer changes and final prototype corrections
were built before this gate. Targeted proof and the source-rendered visual
comparison are in [README](README.md) and [prototype fidelity](prototype-fidelity.md).
The Lucide FilePen notice is present in renderer output with a matching source
hash. No migration, role grant, Main dependency or preload method was added.

All 67 generated historical media files were copied into this slice's
`pre-commit-regression-captures/` and restored from verified pre-gate copies.
Both unrelated dirty user files retain their pre-gate hashes and remain unstaged.
Only accepted T03 files belong in the focused local commit. Detailed logs are retained as
`.scratch/runtime/m2-p1-t03-gate-*.log`; aggregate exits/durations are in
[gate-results.json](gate-results.json). Final modified-document formatting and
`git diff --check` passed; no source behavior changed after the full gate.

This accepted-slice checkpoint is not all-green repository, release or current
remote-CI proof. Supported CNG/container/crash-harness evidence remains required
at the phase gate. No push, PR, merge or issue closure is performed. The earlier
optional-note report and G-01/G-02 remain open.
