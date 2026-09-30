# Accepted T01 slice — local exit-gate record

Date: 30 September 2026. Manual T01 acceptance: explicit stakeholder PASS.
The interactive fixture completed successfully after its restart checkpoint.

| Gate | Result | Classification |
|---|---|---|
| `pnpm format:write`, `pnpm format:check` | Exit 0 | Passed |
| `pnpm lint` | Exit 0 | Passed, including architecture boundaries |
| `pnpm typecheck` | Exit 0 | Passed across workspaces |
| `pnpm build` | Exit 0 | Passed |
| `pnpm test:unit` | Exit 1 | Host-limited: machine-scoped Microsoft CNG key creation raises Access denied before certificate assertions. Local API reported 657 passed and 12 skipped; the affected suite and security code are untouched by T01. No ACL/key-policy weakening or test skipping was introduced. |
| `pnpm test:integration` | Exit 1 | Runner prerequisite: Turbo strict environment filtered out the configured disposable admin URL, causing fixtures to seek an unavailable container runtime. A rerun with `--env-mode=loose` passes through the existing test setting; its result is recorded below. |
| `pnpm test:browser` | Exit 1 | 129 passed, one opt-in manual case skipped, five cases not run after one pairing fixture failed before product interaction. `devices-pairing.browser.test.ts` unconditionally requires Testcontainers/Docker; this workstation uses local PostgreSQL. All Purchasing cases passed. |
| `pnpm package:desktop` | Exit 0 | Passed |
| Packaged smoke via `playwright.config.ts` | Exit 0 | All three passed: security/health, real offline commit/restart, and bundled Main/Preload import integrity |

The normal PostgreSQL service is unchanged; all real data tests use this task's
disposable loopback cluster. Broad browser-generated historical image/video
changes were restored. Only T01's own evidence is included in this commit.

Local ignored logs: `.scratch/runtime/m2-p1-t01-gate-*.log`. These logs are not
published because unrelated test outputs can include workstation identifiers.

The corrected `pnpm test:integration --env-mode=loose` run completed with
146 passed and 169 skipped: 20 files passed, 18 failed. Seventeen failures
require the unavailable container runtime. The remaining failure is the
unchanged Inventory crash harness expecting the POSIX exit signal `SIGKILL`;
Windows reports a null signal. Purchasing's real-PostgreSQL cases passed.
This is a host portability limitation, not proof that the later crash-recovery
assertions passed. Keep that seam open for supported CI evidence.

No push/PR is authorized at this subtask checkpoint. The final phase gate must
include supported Windows CNG and container-backed pairing evidence before
claiming those broader seams passed. The accepted Purchasing slice's focused
tests, manual PASS, and packaged smoke remain independently valid.
