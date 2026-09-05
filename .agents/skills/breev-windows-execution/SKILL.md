---
name: breev-windows-execution
description: Run and troubleshoot Breev commands on Windows when PowerShell, local PostgreSQL, CNG or DPAPI, Electron processes, filesystem permissions, sandbox escalation, or auto-review policy affects the result.
---

# Breev Windows Execution

Use this skill for Windows-local execution and diagnosis. It does not change product requirements, authorize broader system access, or turn a host limitation into permission to weaken production code or tests.

## Classify the failure first

Before changing code, identify which class the evidence supports:

1. Product or test defect.
2. Missing test prerequisite or configuration.
3. Windows host, profile, ACL, CNG, DPAPI, or symlink limitation.
4. Codex sandbox/tooling failure.
5. Auto-review policy denial.
6. PowerShell quoting, process, pipeline, or exit-code mistake.

Do not fix application code for a failure that exists only in the agent sandbox. Do not call a missing Docker runtime a product failure when the workstation uses local PostgreSQL.

## Safe operating rules

- Work in the intended Breev checkout or worktree and inspect `git status --short` before editing. Preserve unrelated changes.
- Prefer `apply_patch` for source edits. If it fails with `CryptUnprotectData`, treat that as a sandbox/tool failure and follow the recovery guidance in the reference; do not immediately switch to a large PowerShell string rewrite.
- Use one shell end-to-end for filesystem mutations. Prefer `-LiteralPath`, explicit absolute paths, and task-specific variable names.
- Never assign to PowerShell automatic variables such as `$PID`, `$HOME`, `$PWD`, `$Host`, `$Error`, `$Args`, `$Matches`, or `$Input`.
- Run commands whose exit status matters without piping them through output filters. Capture or inspect logs separately so a pipeline cannot hide the original exit code.
- For native commands, record `$LASTEXITCODE`. For PowerShell failures, use terminating errors or check the returned result rather than assuming silence means success.
- Keep waits bounded. For `Start-Process`, use `-WindowStyle Hidden`, `-PassThru`, exact redirected log paths, and an exact process object for cleanup. Read redirected files explicitly; redirected output will not appear automatically in the command result.
- Never expose Electron or another debugging service beyond loopback. Use `127.0.0.1`, not `0.0.0.0`.

## Breev environment facts

- On the maintained Windows workstation, PostgreSQL is installed locally as a Windows service. Docker is not the default local database path.
- Real persistence tests still require a disposable test database and an approved administrator connection. Check only whether `BREEV_TEST_POSTGRES_ADMIN_URL` is configured; never print its value or invent credentials.
- Use Testcontainers only when a compatible container runtime is actually available or the task explicitly requires it. Otherwise use the repository's supported local-PostgreSQL seam or report the missing safe test configuration.
- Distinguish Codex sandbox `CryptUnprotectData` failures from Breev CNG test failures. Retry an in-scope command outside the sandbox only through a narrowly scoped approval request. Never disable CNG, DPAPI, certificate checks, ACLs, or encryption to make a test pass.
- Windows CNG and installer evidence belongs on the supported Windows CI or physical certification profile when the local agent profile cannot provide it. State that limitation precisely instead of claiming the product passed or failed.
- Auto-review denial is a security decision, not a transient command error. Do not disguise, split, or rephrase the same unsafe action. Choose a materially safer alternative or stop and request explicit direction.

## Evidence and reporting

Report each verification result as one of: passed, product/test failure, prerequisite missing, host-limited, sandbox/tool failure, policy denied, or intentionally skipped by workflow policy. Include the command, relevant exit code, and the narrow reason. Never collapse these categories into “tests failed.”

For command patterns, PostgreSQL discovery, CNG/DPAPI triage, safe process handling, source-edit recovery, and Electron debugging, read [references/windows-diagnostics.md](references/windows-diagnostics.md).
