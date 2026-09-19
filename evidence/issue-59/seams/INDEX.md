# Milestone 2 seam and invariant re-runs (wave W2)

Source commits, three of them, all on `issue/28-accept-milestone-2`:

- **e73b541** (`Merge pull request #169 from PharmaElectrons/issue/27-start-sale-draft-reorder`) — the milestone-2 build under acceptance. Everything in "Results" is this commit, and files with no suffix belong to it.
- **7dda434** (`fix(purchasing): keep the item-details panel and correction refusals in view`) — first renderer fix. Files suffixed `.fix-7dda434`. **Superseded by 1d229d4**; kept as history.
- **1d229d4** (`fix(purchasing): fit every invoice column in the window and keep sections stacked`) — second renderer fix and the **current head**. Files suffixed `.fix-1d229d4`; this is the renderer evidence that stands.

Run dates, all 19 September 2026: 00:31–01:47 for the e73b541 sweep, 09:04–09:11 for the 7dda434 re-run, and 10:45–10:52 for the 1d229d4 re-run. In the first sweep the runs up to 01:07 shared the workstation with a second agent's packaged-desktop Playwright harness and the runs from 01:43 had the host to themselves; both fix re-runs had an idle host throughout.
Worktree for the e73b541 sweep: `D:\Cefeldeen-clinic-pos\breef-lanes\lane-m2-seams`, detached at e73b541 (since removed). Both fix re-runs (7dda434 and 1d229d4) ran from the main worktree `D:\Cefeldeen-clinic-pos\breef`, as did the forced typecheck re-capture. **No source, test, config or migration file was modified in any of them.** The suites did dirty 39 tracked files under `evidence/` even though `BREEV_REGENERATE_EVIDENCE` was never set; that is finding 4 below, not a side note. They were restored with `git checkout -- evidence`, the single git write command this wave ran, scoped to the lane worktree. Every file this wave deliberately produced lives in `evidence/issue-59/seams/` in the **main** worktree.

Setup: `pnpm install --frozen-lockfile` (9 m 49 s) then `pnpm build` (3 tasks, all cached/green). Playwright Chromium was already installed for this host (`chromium-1243` in the shared `ms-playwright` cache), so no browser install was needed.

Every suite ran **alone**; nothing in this wave ran in parallel, because a second agent drove a packaged-desktop Playwright harness on the same workstation for most of it.

## Host

| item                            | value                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| OS                              | Microsoft Windows 11 Pro 10.0.26200                                                                                |
| Elevation                       | **unelevated** (`IsInRole(Administrator)` = False)                                                                 |
| Node                            | v24.19.0                                                                                                           |
| pnpm                            | 11.23.0                                                                                                            |
| Docker                          | 29.7.2, build a7dcaa6                                                                                              |
| PostgreSQL under test           | Testcontainers image `postgres:18.6-bookworm`                                                                      |
| `BREEV_TEST_POSTGRES_ADMIN_URL` | not set, so every integration suite took the Testcontainers path                                                   |
| Foreign processes left alone    | a dev local API from another checkout on 127.0.0.1:31310/31311; a `postgres:18-bookworm` container on 0.0.0.0:5432 |
| Concurrent load                 | a second agent's packaged-desktop Playwright harness ran on this host until ~01:40, then the host was idle         |

## Results

`tests` counts are as the runner reported them. Classification words are the Breev Windows-execution vocabulary: passed / product-test failure / prerequisite missing / host-limited / sandbox-tool failure / policy denied / intentionally skipped by workflow policy.

### Integration — real PostgreSQL (Testcontainers)

| file                                                | command                                                                                                                                           | result          | tests passed/failed/skipped | duration | classification                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------- | -------- | ------------------------------------- |
| `purchase-posting.integration.txt`                  | `pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/purchasing/purchase-posting.integration.test.ts` | passed          | 13 / 0 / 0                  | 71 s     | passed                                |
| `purchase-posting.integration-attempt1-timeout.txt` | same command                                                                                                                                      | failed to start | 0 / 1 suite / 13            | 206 s    | host-limited                          |
| `purchase-posting.integration-attempt2-timeout.txt` | same command                                                                                                                                      | failed to start | 0 / 1 suite / 13            | 87 s     | host-limited                          |
| `inventory-safety-no-override.integration.txt`      | `… src/inventory/inventory-safety-no-override.integration.test.ts`                                                                                | passed          | 3 / 0 / 0                   | 67 s     | passed                                |
| `inventory-safety.integration.txt`                  | `… src/inventory/inventory-safety.integration.test.ts`                                                                                            | 1 test failed   | 3 / 1 / 0                   | 35 s     | host-limited (win32 signal reporting) |
| `inventory-safety.integration-rerun.txt`            | same command                                                                                                                                      | 1 test failed   | 3 / 1 / 0                   | 12 s     | host-limited (win32 signal reporting) |
| `inventory-count.integration.txt`                   | `… src/inventory/inventory-count.integration.test.ts`                                                                                             | passed          | 8 / 0 / 0                   | 49 s     | passed                                |
| `inventory-reorder.integration.txt`                 | `… src/inventory/inventory-reorder.integration.test.ts`                                                                                           | passed          | 7 / 0 / 0                   | 80 s     | passed                                |
| `sale-draft.integration.txt`                        | `… src/sales/sale-draft.integration.test.ts`                                                                                                      | passed          | 7 / 0 / 0                   | 34 s     | passed                                |
| `sale-draft-authorization.integration.txt`          | `… src/sales/sale-draft-authorization.integration.test.ts`                                                                                        | passed          | 4 / 0 / 0                   | 13 s     | passed                                |
| `catalog.integration.txt`                           | `… src/catalog/catalog.integration.test.ts`                                                                                                       | passed          | 17 / 0 / 0                  | 18 s     | passed                                |
| `purchasing.integration.txt`                        | `… src/purchasing/purchasing.integration.test.ts`                                                                                                 | passed          | 9 / 0 / 0                   | 14 s     | passed                                |

### Unit

Combined run plus one file per test file, because the gate pack cites them individually. All used `--config vitest.unit.config.ts`.

| file                                            | command                                                                                               | result | tests passed/failed/skipped | duration | classification |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ | --------------------------- | -------- | -------------- |
| `milestone-2-unit.txt`                          | all fourteen unit files in one `vitest run`                                                           | passed | 295 / 0 / 0                 | 4 s      | passed         |
| `catalog-search.unit.txt`                       | `… src/catalog/catalog-search.unit.test.ts`                                                           | passed | 8 / 0 / 0                   | 2 s      | passed         |
| `catalog-pricing.unit.txt`                      | `… src/catalog/catalog-pricing.unit.test.ts`                                                          | passed | 12 / 0 / 0                  | 2 s      | passed         |
| `catalog-packaging.unit.txt`                    | `… src/catalog/catalog-packaging.unit.test.ts`                                                        | passed | 14 / 0 / 0                  | 2 s      | passed         |
| `purchase-adjustment-delta.unit.txt`            | `… src/purchasing/purchase-adjustment-delta.unit.test.ts`                                             | passed | 9 / 0 / 0                   | 2 s      | passed         |
| `purchase-costs.unit.txt`                       | `… src/purchasing/purchase-costs.unit.test.ts`                                                        | passed | 10 / 0 / 0                  | 1 s      | passed         |
| `purchase-price-capture.unit.txt`               | `… src/purchasing/purchase-price-capture.unit.test.ts`                                                | passed | 8 / 0 / 0                   | 2 s      | passed         |
| `inventory-count.unit.txt`                      | `… src/inventory/inventory-count.unit.test.ts`                                                        | passed | 5 / 0 / 0                   | 2 s      | passed         |
| `inventory-valuation.unit.txt`                  | `… src/inventory/inventory-valuation.unit.test.ts`                                                    | passed | 12 / 0 / 0                  | 2 s      | passed         |
| `inventory-receipt-rules.unit.txt`              | `… src/inventory/inventory-receipt-rules.unit.test.ts`                                                | passed | 11 / 0 / 0                  | 2 s      | passed         |
| `inventory-eligibility.unit.txt`                | `… src/inventory/inventory-eligibility.unit.test.ts`                                                  | passed | 3 / 0 / 0                   | 1 s      | passed         |
| `money.unit.txt`                                | `… src/posting/money.unit.test.ts`                                                                    | passed | 187 / 0 / 0                 | 2 s      | passed         |
| `purchase-posting-template.unit.txt`            | `… src/accounting/purchase-posting-template.unit.test.ts`                                             | passed | 12 / 0 / 0                  | 2 s      | passed         |
| `purchase-adjustment-posting-template.unit.txt` | `… src/accounting/purchase-adjustment-posting-template.unit.test.ts`                                  | passed | 3 / 0 / 0                   | 2 s      | passed         |
| `purchase-return-posting-template.unit.txt`     | `… src/accounting/purchase-return-posting-template.unit.test.ts`                                      | passed | 1 / 0 / 0                   | 2 s      | passed         |
| `count-variance-posting-template.unit.txt`      | `… src/accounting/count-variance-posting-template.unit.test.ts`                                       | passed | 3 / 0 / 0                   | 3 s      | passed         |
| `purchasing.contracts.txt`                      | `pnpm --filter @breev/contracts exec vitest run --reporter=verbose src/local-rest/purchasing.test.ts` | passed | 25 / 0 / 0                  | 2 s      | passed         |

### Browser (plain runs — `BREEV_REGENERATE_EVIDENCE` was **not** set)

Playwright has no `--reporter=verbose`; these runs therefore used the reporter configured in `apps/desktop/playwright.browser.config.ts`, which is `line`. Per-test titles still appear, which is what the gate pack needs.

All used `pnpm --filter @breev/desktop exec playwright test test/browser/<name>.browser.test.ts --config playwright.browser.config.ts`.

| file                                           | command                                                              | result                     | tests passed/failed/skipped | duration | classification |
| ---------------------------------------------- | -------------------------------------------------------------------- | -------------------------- | --------------------------- | -------- | -------------- |
| `catalog.browser.txt`                          | `… catalog.browser.test.ts`                                          | passed                     | 18 / 0 / 0                  | 54 s     | passed         |
| `purchasing.browser.txt`                       | `… purchasing.browser.test.ts`                                       | passed                     | 15 / 0 / 0                  | 70 s     | passed         |
| `count-session.browser.txt`                    | `… count-session.browser.test.ts`                                    | passed                     | 7 / 0 / 0                   | 39 s     | passed         |
| `inventory.browser.txt`                        | `… inventory.browser.test.ts`                                        | passed                     | 5 / 0 / 0                   | 34 s     | passed         |
| `basket.browser.txt`                           | `… basket.browser.test.ts`                                           | passed                     | 7 / 0 / 0                   | 40 s     | passed         |
| `sales.browser.txt`                            | `… sales.browser.test.ts`                                            | passed                     | 7 / 0 / 0                   | 33 s     | passed         |
| `batch-safety.browser.txt`                     | `… batch-safety.browser.test.ts`                                     | passed (idle host)         | 5 / 0 / 0                   | 61 s     | passed         |
| `batch-safety.browser-attempt1.txt`            | same command, host under concurrent load                             | fixture never became ready | 0 / 1 / 4 not run           | 49 s     | host-limited   |
| `batch-safety.browser-attempt2.txt`            | same command, host under concurrent load                             | fixture never became ready | 0 / 1 / 4 not run           | 73 s     | host-limited   |
| `batch-safety.browser-attempt3.txt`            | same command, host under concurrent load                             | fixture never became ready | 0 / 1 / 4 not run           | 36 s     | host-limited   |
| `batch-safety.browser-attempt4.txt`            | same command, host under concurrent load                             | fixture never became ready | 0 / 1 / 4 not run           | 53 s     | host-limited   |
| `host-load-control-inventory.browser-idle.txt` | `… inventory.browser.test.ts` (idle-host control, not a list item)   | passed                     | 5 / 0 / 0                   | 73 s     | passed         |
| `host-load-control-inventory.browser.txt`      | `… inventory.browser.test.ts` (loaded-host control, not a list item) | fixture never became ready | 0 / 1 / 4 not run           | ~40 s    | host-limited   |

### Windows bundled API runtime

| file                                | command                                                                                                                                | result                | tests passed/failed/skipped | duration | classification       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------- | -------- | -------------------- |
| `package-windows-payload.txt`       | `pnpm package:windows:payload`                                                                                                         | tar failed            | n/a                         | 19 s     | host-limited         |
| `package-windows-payload-rerun.txt` | same command, `C:\Windows\System32` first on PATH                                                                                      | passed                | n/a                         | 225 s    | passed               |
| `api-runtime.integration.txt`       | `pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose windows/api-runtime.integration.test.mjs` | 4 tests could not run | 3 / 0 / 4                   | 31 s     | prerequisite missing |
| `api-runtime.integration-rerun.txt` | same command, after the payload was built                                                                                              | passed                | 7 / 0 / 0                   | 85 s     | passed               |

### Whole tree

| file                                 | command                                                                              | result                                 | tests passed/failed/skipped | duration                  | classification |
| ------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------- | ------------------------- | -------------- |
| `whole-tree-checks.txt`              | `pnpm lint` ; `pnpm format:check` ; `pnpm typecheck` ; `pnpm check:licence-artifact` | all four exited 0                      | n/a                         | 84 s + 89 s + 13 s + 21 s | passed         |
| `whole-tree-checks.txt` (re-capture) | `pnpm exec turbo run typecheck --force`                                              | passed, 4 tasks executed, **0 cached** | n/a                         | 33 s                      | passed         |

The original `pnpm typecheck` capture showed `cache hit, replaying logs` for all three packages, so it proved only that an earlier run had succeeded — not that `tsc` ran on this commit in this checkout. It was re-captured with `--force` later the same day (`Cached: 0 cached, 4 total`); the re-capture is appended to `whole-tree-checks.txt`. The other three checks' original captures were genuine executions and are unchanged.

One caveat, recorded in the file as well: the lane worktree had been removed by then, so the re-capture ran in the **main** worktree, which was not a clean e73b541 tree — the W1 agent's uncommitted acceptance harness was present, and `apps/desktop/tsconfig.node.json` had already been edited to add `playwright.acceptance.config.ts` to its `include`, so those files were in scope. The re-capture therefore proves `tsc` executed and passed over e73b541 **plus** the W1 harness, a superset of the milestone-2 build. A clean-tree typecheck for this commit exists in CI Verify run 34946061944.

## The four findings

Every item on the W2 list now has a passing run on this host except the single `inventory-safety.integration` test described in finding 2. All four findings are host or harness limits. **No product/test failure was found in the milestone-2 build.** Each evidence file carries its own full diagnosis; the summaries follow.

### 1. Local-API readiness deadlines are marginal on this Windows workstation (harness robustness — for W5)

Two different deadlines failed, on two different harnesses, for the same reason: the local API's cold start against a fresh Testcontainers PostgreSQL sometimes exceeds them on this host, while the process is still booting and has not crashed.

- `purchase-posting.integration` has its own 60 s `waitForHealth` (`apps/local-api/src/purchasing/purchase-posting.integration.test.ts:2450`). It timed out twice, then passed 13/13 on the third identical run.
- The shared browser helper `apps/desktop/test/local-api-process.ts:90-115` uses a **15 s** deadline. `batch-safety.browser` hit it four times (00:53, 00:57, 01:04, 01:43), every time with the API reported "still running", i.e. mid-boot and never crashed.

Both suites now have a passing run on this host. `batch-safety.browser` passed **5/5 in 61 s** once the concurrent packaged-desktop harness finished and the workstation went idle, and the idle control `inventory.browser` passed 5/5 as well.

Getting to that answer took one wrong turn, recorded here because the evidence files carry it. When `batch-safety.browser` had failed three times, `inventory.browser` was re-run at 01:06 as a control and failed identically, which was read as proof that the host alone was at fault. The idle runs show that reading was only half right: `inventory.browser` passes on a loaded host often enough to have passed at 00:52, while `batch-safety.browser` needs the host to be idle. The accurate statement is that the 15 s readiness deadline is **marginal** on this workstation — it holds when the host is free and loses the race under concurrent load, with `batch-safety.browser` first to lose it because its `beforeAll` fixture is the heaviest (Testcontainers PostgreSQL, bootstrap, a posted purchase and a second user before the renderer starts). Both control runs are kept: `host-load-control-inventory.browser.txt` (loaded, failed) and `host-load-control-inventory.browser-idle.txt` (idle, passed).

These deadlines are not exercised the same way on Linux CI: Ubuntu CI run **34946061944**, verify job **104305613667**, ran `pnpm test:browser` and the browser suites were green there on this commit.

For W5: these are test-harness robustness limits on Windows, not product behaviour. Raising or making configurable the 15 s readiness deadline (and the 60 s one) would make this workstation's runs reproducible under load. Nothing was changed here.

### 2. `inventory-safety.integration` asserts a POSIX-only exit signal (test-harness portability defect candidate — for W5)

- Failing test: `inventory batch safety PostgreSQL seam > recovers the real queue across claim, date-commit, final-commit, and duplicate-delivery crashes`
- Assertion, `apps/local-api/src/inventory/inventory-safety.integration.test.ts:531`: `expect((await child.waitForExit()).signal).toBe("SIGKILL")` → `AssertionError: expected null to be 'SIGKILL'`
- The crash worker self-terminates with `process.kill(process.pid, "SIGKILL")` (`apps/local-api/src/inventory/test-helpers/inventory-safety-crash-child.test.ts:37-40`). Windows has no POSIX signals: Node maps SIGKILL to `TerminateProcess`, and the parent sees `code 1, signal null`. Probed on this host: `{"platform":"win32","code":1,"signal":null}`.
- The same kill pattern passes here when the test does not assert on the signal: `apps/local-api/src/sales/sale-draft.integration.test.ts:154` case 3, "3. survives a killed local API and resumes exactly", kills the API with SIGKILL and asserts only that the durable state is identical after restart. It passed (7/7, `sale-draft.integration.txt`) and `evidence/issue-58/README.md` records it passing on this same workstation.
- Classification: **host-limited (win32 signal reporting); passes on Ubuntu CI run 34946061944**. A test-harness portability defect candidate for W5, not a product defect.
- Recorded honestly: because the assertion aborts at line 531, the crash-recovery assertions after it (`durableJobs.supervise`, the seven-business-date catch-up) were never reached on this host, so local proof of that specific recovery path is absent. Ubuntu CI covers it, and the neighbouring batch-safety invariants passed here (`inventory-safety-no-override.integration.txt`, 3/3, including the 96-cell refusal matrix).
- The identical POSIX-only assertion also sits in `apps/local-api/src/identity-access/settings-crash.integration.test.ts:243,274,309` (outside the W2 list) and would fail here for the same reason.

### 3. `pnpm package:windows:payload` picks up GNU tar instead of Windows bsdtar

- `tar.exe failed with exit code 128`, with GNU tar's message `tar: Cannot connect to D: resolve failed`, from `apps/local-api/windows/prepare-payload.mjs:241` via `run()` at `:260`. GNU tar parses `D:\path` as `host:path`.
- This workstation's PATH puts Git for Windows' GNU tar 1.35 ahead of `C:\Windows\System32\tar.exe` (bsdtar 3.8.8) in **every** shell, PowerShell included — it is a machine-profile issue, not this agent's shell.
- Where CI actually runs `package:windows:payload`, checked rather than assumed: `.github/workflows/release.yml:151`, inside the `build-windows` job (`release.yml:95`, `runs-on: windows-2025`), which fires for a release tag and not for ordinary pushes; and `.github/workflows/verify.yml:127-129`, whose `windows-candidates` job is gated `if: ${{ github.event_name == 'workflow_dispatch' }}` and is therefore dispatch-only — it was **skipped** in push run 34946061944, the clean-checkout Verify run cited for this commit, and ran only in dispatch run 35395379466, job 105762911820. So CI does **not** build this payload on this commit's push run, and the only proof it builds at e73b541 in this wave is the local PATH-corrected rerun below.
- Re-running the identical command with `C:\Windows\System32` prepended to PATH, changing nothing else, succeeded in 225 s (`Bundled API runtime: {"bundleBytes":7383107,"migrations":26,"nativeFiles":["argon2.glibc.node"]}`), and `windows/api-runtime.integration.test.mjs` then passed **7/7** including all four "bundled runtime on real PostgreSQL" tests.
- The first `api-runtime.integration` run is therefore **prerequisite missing** (`spawn …\payload\postgresql\bin\initdb.exe ENOENT`), downstream of the payload failure — 3 of 7 passed, 4 were skipped rather than failed.

### 4. A browser suite rewrites tracked `evidence/` files on a plain run (harness defect candidate — for follow-up)

Running the browser sweep left **39 tracked files dirty** under `evidence/`, although `BREEV_REGENERATE_EVIDENCE` was never set. That is exactly the failure mode the repository already designed against, which is why it is worth reporting rather than tidying away.

The intended mechanism works: `apps/desktop/test/browser/evidence-path.ts` routes screenshots to the git-ignored `test-results/evidence` tree unless `BREEV_REGENERATE_EVIDENCE=1`, and its own comment explains that a plain `test:browser` run "silently overwrote committed PNGs" before that helper existed. Suites that call `evidencePath(...)` — `batch-safety` (`issue-55`), `catalog`, `count-session`, `inventory`, `sales`, `basket`, `shell` — behave correctly.

**`apps/desktop/test/browser/purchasing.browser.test.ts` does not use the helper.** At lines 66-90 it resolves six tracked directories directly:

| line | directory                                                  |
| ---- | ---------------------------------------------------------- |
| 68   | `../../../../evidence/purchases-prototype-alignment/after` |
| 72   | `../../../../evidence/issue-18/after`                      |
| 76   | `../../../../evidence/issue-50/after`                      |
| 80   | `../../../../evidence/issue-51/after`                      |
| 84   | `../../../../evidence/issue-52/after`                      |
| 88   | `../../../../evidence/issue-53/after`                      |

Because those paths bypass `evidencePath()`, they ignore `BREEV_REGENERATE_EVIDENCE` entirely and write into the committed audit record on every plain run. It is the only file in `apps/desktop` that does this (`grep -rn '\.\./\.\./\.\./\.\./evidence' apps/desktop --include=*.ts --include=*.mjs` returns these six lines and nothing else).

Scope of what was directly observed, stated exactly: the truncated `git status --short` I captured showed `evidence/issue-18/after/keyboard-row-loop.webm`, `evidence/issue-50/after/posted-purchase-ar-dark.png`, `evidence/issue-50/after/posted-purchase-en-light.png`, `evidence/issue-51/after/posted-purchase-detail-ar-dark.png` and `evidence/issue-51/after/posted-purchase-detail-ar-light.png`, with a total count of 39 changed paths, all under `evidence/`. The remaining 34 filenames were not recorded before the worktree was removed, so the directory list above comes from the source, not from the status output. An earlier draft of this index guessed that `issue-55` was among them; the code shows it is not, because `batch-safety` goes through the helper.

Cleanup and the one git write: `git checkout -- evidence` was run in the lane worktree `D:\Cefeldeen-clinic-pos\breef-lanes\lane-m2-seams` and nowhere else. The verification captured immediately afterwards, kept here because that worktree has since been removed and the check can no longer be repeated:

```console
$ git -C D:\Cefeldeen-clinic-pos\breef-lanes\lane-m2-seams status --short
$ git -C D:\Cefeldeen-clinic-pos\breef-lanes\lane-m2-seams status --short | wc -l
0
$ git -C D:\Cefeldeen-clinic-pos\breef-lanes\lane-m2-seams log --oneline -1
e73b541 Merge pull request #169 from PharmaElectrons/issue/27-start-sale-draft-reorder
```

`status --short` printed nothing at all — the empty line above is the real output — and the worktree was still detached at the build commit.

For follow-up: make `purchasing.browser.test.ts` use `evidencePath()` like every other suite. This is a test-harness defect, not product behaviour, and it was not fixed here because this wave changes nothing outside `evidence/issue-59/seams/`.

## Re-run on the fix commit 7dda434 — SUPERSEDED by 1d229d4

> **Superseded.** `1d229d4` builds on this commit and is the current head; the section after this one carries the renderer evidence that stands. This section is kept as history because the runs were real and passed — it is not a record of a failure, just of an intermediate commit.

`7dda434` (`fix(purchasing): keep the item-details panel and correction refusals in view`) changes the renderer only: `purchase-item-details.tsx` (new), `purchase-row-entry.tsx`, `purchasing-screen.tsx`, `purchasing-messages.ts`, `styles.css`, `purchase-adjustment-workflow.tsx`, `purchase-return-workflow.tsx`, and `purchasing.browser.test.ts`. It also refreshes four committed PNGs under `evidence/purchases-prototype-alignment/after/purchase-selected-{ar,en}-{dark,light}.png`, which are part of the commit.

**No server, schema, migration or contract code changed**, so the integration, unit and contracts seams above are not re-run and **stand at e73b541**; re-running them on 7dda434 would exercise byte-identical server code. What is re-run here is everything that renders: the desktop unit suite, the seven W2 browser suites, and `shell.browser` as well, because `styles.css` is shared.

Run from the main worktree `D:\Cefeldeen-clinic-pos\breef` on 19 September 2026, 09:04–09:11, host idle, each suite alone. Every file below carries `SOURCE_COMMIT: 7dda434`.

| file                                    | command                                                                                                                        | result           | tests passed/failed/skipped | duration | classification |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------- | -------- | -------------- |
| `desktop-unit.fix-7dda434.txt`          | `pnpm --filter @breev/desktop test:unit`                                                                                       | passed, 42 files | 496 / 0 / 0                 | 6 s      | passed         |
| `catalog.browser.fix-7dda434.txt`       | `pnpm --filter @breev/desktop exec playwright test test/browser/catalog.browser.test.ts --config playwright.browser.config.ts` | passed           | 18 / 0 / 0                  | 40 s     | passed         |
| `purchasing.browser.fix-7dda434.txt`    | `… purchasing.browser.test.ts`                                                                                                 | passed           | 17 / 0 / 0                  | 69 s     | passed         |
| `count-session.browser.fix-7dda434.txt` | `… count-session.browser.test.ts`                                                                                              | passed           | 7 / 0 / 0                   | 32 s     | passed         |
| `inventory.browser.fix-7dda434.txt`     | `… inventory.browser.test.ts`                                                                                                  | passed           | 5 / 0 / 0                   | 26 s     | passed         |
| `basket.browser.fix-7dda434.txt`        | `… basket.browser.test.ts`                                                                                                     | passed           | 7 / 0 / 0                   | 33 s     | passed         |
| `sales.browser.fix-7dda434.txt`         | `… sales.browser.test.ts`                                                                                                      | passed           | 7 / 0 / 0                   | 25 s     | passed         |
| `batch-safety.browser.fix-7dda434.txt`  | `… batch-safety.browser.test.ts`                                                                                               | passed           | 5 / 0 / 0                   | 25 s     | passed         |
| `shell.browser.fix-7dda434.txt`         | `… shell.browser.test.ts`                                                                                                      | passed           | 24 / 0 / 0                  | 118 s    | passed         |

**Everything passed; nothing needed a rerun.** Two observations worth recording:

- `purchasing.browser` reports **17** tests here against 15 at e73b541. The two added by the fix both pass: `keeps the item panel in view on an invoice longer than the window` (`purchasing.browser.test.ts:1572`) and `brings a blocked Delta refusal into view and gives it focus` (`:1659`).
- `batch-safety.browser` passed in 25 s with no readiness failure, which is consistent with finding 1: on an idle host the 15 s deadline holds.

Evidence hygiene during this re-run: after **each** browser suite, `git checkout -- evidence/purchases-prototype-alignment evidence/issue-18 evidence/issue-50 evidence/issue-51 evidence/issue-52 evidence/issue-53` restored the tracked files that `purchasing.browser.test.ts` rewrites (finding 4). Restoring to HEAD is correct here rather than lossy, because the four refreshed `purchase-selected-*.png` are committed **in** 7dda434, so HEAD already holds the intended new images. Verified afterwards: `git status --short -- evidence` reports nothing outside `evidence/issue-59/`.

## Re-run on the fix commit 1d229d4

`1d229d4` (`fix(purchasing): fit every invoice column in the window and keep sections stacked`) is the **current head** and supersedes 7dda434. Like it, it changes the renderer only: `purchase-row-entry.tsx`, `styles.css` and `purchasing.browser.test.ts`, plus the same four committed PNGs under `evidence/purchases-prototype-alignment/after/purchase-selected-{ar,en}-{dark,light}.png`.

**No server, schema, migration or contract code changed here either**, so the integration, unit and contracts seams still **stand at e73b541** — re-running them would exercise byte-identical server code. Re-run again: the desktop unit suite, the seven W2 browser suites, and `shell.browser` because `styles.css` is shared.

One step beyond the 7dda434 procedure, because it was needed for the result to mean anything: the browser suites serve the **built** renderer from `apps/desktop/out/renderer` (see `startRendererServer` in each suite), so `pnpm build` was run first to make the bundles match this commit. Without it the suites would have exercised stale renderer output and passed for the wrong reason. The build was already current — turbo reported 2 of 3 tasks cached and rebuilt the desktop bundle in 2.29 s.

Run from the main worktree `D:\Cefeldeen-clinic-pos\breef` on 19 September 2026, 10:45–10:52, host idle, each suite alone. Every file below carries `SOURCE_COMMIT: 1d229d4`.

| file                                    | command                                                                                                                        | result           | tests passed/failed/skipped | duration | classification |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------- | -------- | -------------- |
| `desktop-unit.fix-1d229d4.txt`          | `pnpm --filter @breev/desktop test:unit`                                                                                       | passed, 42 files | 496 / 0 / 0                 | 5 s      | passed         |
| `catalog.browser.fix-1d229d4.txt`       | `pnpm --filter @breev/desktop exec playwright test test/browser/catalog.browser.test.ts --config playwright.browser.config.ts` | passed           | 18 / 0 / 0                  | 40 s     | passed         |
| `purchasing.browser.fix-1d229d4.txt`    | `… purchasing.browser.test.ts`                                                                                                 | passed           | 18 / 0 / 0                  | 76 s     | passed         |
| `count-session.browser.fix-1d229d4.txt` | `… count-session.browser.test.ts`                                                                                              | passed           | 7 / 0 / 0                   | 33 s     | passed         |
| `inventory.browser.fix-1d229d4.txt`     | `… inventory.browser.test.ts`                                                                                                  | passed           | 5 / 0 / 0                   | 27 s     | passed         |
| `basket.browser.fix-1d229d4.txt`        | `… basket.browser.test.ts`                                                                                                     | passed           | 7 / 0 / 0                   | 33 s     | passed         |
| `sales.browser.fix-1d229d4.txt`         | `… sales.browser.test.ts`                                                                                                      | passed           | 7 / 0 / 0                   | 25 s     | passed         |
| `batch-safety.browser.fix-1d229d4.txt`  | `… batch-safety.browser.test.ts`                                                                                               | passed           | 5 / 0 / 0                   | 25 s     | passed         |
| `shell.browser.fix-1d229d4.txt`         | `… shell.browser.test.ts`                                                                                                      | passed           | 24 / 0 / 0                  | 119 s    | passed         |

**Everything passed; nothing needed a rerun.** Notes:

- `purchasing.browser` reports **18** tests, against 17 at 7dda434 and 15 at e73b541. The three in-view/focus tests all pass: `keeps the item panel in view on an invoice longer than the window` (`purchasing.browser.test.ts:1675`), `brings a refused Purchase Return into view and gives it focus` (`:1764`, new in this commit) and `brings a blocked Delta refusal into view and gives it focus` (`:1872`).
- `batch-safety.browser` again passed in 25 s with no readiness failure, a third idle-host pass for finding 1.
- Every other suite's count is unchanged from both earlier runs, so the shared `styles.css` edit did not disturb any other screen.

Evidence hygiene: after **each** browser suite, `git checkout -- evidence/purchases-prototype-alignment evidence/issue-18 evidence/issue-50 evidence/issue-51 evidence/issue-52 evidence/issue-53` restored the tracked files that `purchasing.browser.test.ts` rewrites (finding 4). As with 7dda434, restoring to HEAD is correct rather than lossy: `git show --stat 1d229d4` confirms the four refreshed `purchase-selected-*.png` are committed **in** 1d229d4, so HEAD already holds the intended images. Verified afterwards: `git status --short -- evidence` reports nothing outside `evidence/issue-59/`.

## Known host limit that did not surface

The unelevated-Windows CNG machine-key limitation (skips in the `pharmacy-ca` / `devices` suites) is not part of this list and did not appear in any run above.
