# Breev Windows diagnostics reference

Read the section matching the current failure. These commands are diagnostic examples; keep paths, ports, and authorization scoped to the active task.

## PowerShell reliability

Prefer the tool's `workdir` option over embedding `Set-Location`. Use task-specific names such as `$breevProcess`, `$breevProfile`, and `$breevLogPath`.

Do not assume `python` or `py` resolves to an installed interpreter; Windows may expose only the Microsoft Store alias. When a repository or skill script requires Python, locate the configured Codex runtime with the workspace-dependency lookup first. If the chosen runtime lacks a module, do not install packages or modify the machine unless the user authorized it; use an existing repository-native validator or report the missing validation dependency precisely.

Before a destructive operation, resolve and compare the exact path. Do not use unresolved variables, broad roots, cross-shell path enumeration, or recursive wildcards.

PowerShell automatic variables are case-insensitive. In particular, `$pid` and `$PID` are the same protected variable. Avoid:

```powershell
$pid = 123
```

Use:

```powershell
$breevProcessId = 123
```

Single-quoted PowerShell strings do not expand escape sequences. The text `` `n`` in a single-quoted replacement is literal source text, not a newline. For an actual newline use `[Environment]::NewLine`, or avoid shell-based source rewriting entirely.

Do not insert PowerShell comments into another language. `#` is not a TypeScript comment. After any mechanical edit, immediately run:

```powershell
git diff --check
git diff -- <exact-file>
pnpm format:check
pnpm typecheck
```

If an exact string replacement is the only approved fallback, first prove that the target occurs exactly once, abort otherwise, make the smallest replacement, then inspect the diff. Never use an unchecked multi-line `Replace` as a substitute for `apply_patch`.

When a native command's result matters, avoid filtering it in the same pipeline. Run it first, save its exit code, then inspect its output:

```powershell
pnpm typecheck
$breevExitCode = $LASTEXITCODE
Write-Output "typecheck-exit=$breevExitCode"
```

## Local PostgreSQL

The maintained Windows workstation uses local PostgreSQL rather than Docker by default. Check the service without exposing configuration:

```powershell
Get-Service | Where-Object Name -Like 'postgresql*' |
  Select-Object Name, Status, StartType

Write-Output (
  'test-admin-url-configured=' +
  [bool]$env:BREEV_TEST_POSTGRES_ADMIN_URL
)
```

Optionally inspect the expected loopback listener without assuming a service name:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object LocalPort -Eq 5432 |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Interpretation:

- Local service running and approved test administrator URL present: use the repository's direct disposable PostgreSQL fixture.
- Local service running but URL absent: do not guess the username or password. Report the missing test configuration or ask for it.
- No local service but a compatible container runtime is available: Testcontainers may be used by the repository's existing test path.
- Neither seam available: database-backed tests are locally blocked; use authoritative CI evidence while clearly reporting the local limitation.

Never point destructive, migration, restore, or isolation tests at a live pharmacy or shared development database.

## Windows filesystem and platform evidence

A symlink `EPERM` can mean the current Windows profile lacks symbolic-link privilege or Developer Mode support. Confirm the failure occurs at symlink creation before treating it as a product assertion. Do not rewrite production paths or weaken filesystem tests only to accommodate the agent profile; use the supported Windows CI or certification profile when that privilege is required.

Keep platform claims separate. A Windows package launch does not prove the Linux Xvfb Electron seam, and a Linux CI pass does not prove Windows CNG, installer, ACL, service, or physical-profile behavior. A Windows job skipped because the workflow requires manual dispatch is “intentionally skipped by policy,” not passed.
## CNG, DPAPI, and the Codex sandbox

Treat these as separate failures:

- `CryptUnprotectData failed` emitted before a command or patch reads the repository usually indicates the Codex Windows sandbox could not decrypt its own protected state.
- An access-denied failure from a Breev crypto test may indicate that the current Windows account, profile, key container, or sandbox lacks the required CNG capability.
- A failing product assertion after the crypto operation ran is an application/test failure.

For a sandbox/tool failure:

1. Confirm the repository file was not partially changed.
2. Retry only the necessary command with `require_escalated` and a narrow, user-facing justification.
3. Do not request a broad executable prefix for a scripting language or destructive operation.
4. If the approved run still fails, use the Windows CI/physical-profile seam or report the environment blocker.

Do not work around CNG or DPAPI by writing plaintext keys, exporting private keys, disabling certificate validation, broadening ACLs, or changing production fallback behavior.

## Auto-review denials

Auto-review evaluates the real effect of a command, not just its wording. A denial is expected for actions such as:

- Binding Electron DevTools to `0.0.0.0`.
- Broad or destructive filesystem operations.
- Unsafe credential or key access.
- Overly broad reusable command approvals.

After a denial, do not attempt an equivalent command through another shell, a helper script, command splitting, or encoded arguments. Use a safer alternative, such as loopback-only binding, static artifact inspection, an existing test seam, or a narrowly scoped read-only check. If no safe alternative proves the requirement, stop and ask the user.

## Background processes and Electron

Launch background processes with bounded evidence and hidden windows:

```powershell
$breevProcess = Start-Process `
  -FilePath $breevExecutable `
  -ArgumentList $breevArguments `
  -WindowStyle Hidden `
  -RedirectStandardError $breevErrorLog `
  -RedirectStandardOutput $breevOutputLog `
  -PassThru

Start-Sleep -Seconds 3
Write-Output ('alive=' + (-not $breevProcess.HasExited))
Get-Content -Raw -LiteralPath $breevErrorLog
```

Stop only the exact process created for the task, after confirming its executable and PID. Child processes may outlive a launcher, so inspect the process tree before cleanup.

For packaged Electron CDP diagnosis:

1. Keep the endpoint on `127.0.0.1` and prefer an OS-assigned ephemeral port.
2. Confirm the process is alive and collect its exit code.
3. Confirm the announced port is listening.
4. Query `/json/version` with a bounded timeout.
5. Attempt the websocket handshake and retain the actual connection error.
6. Capture sanitized `preload-error`, `render-process-gone`, startup rejection, and fatal-dialog evidence.

“DevTools listening” proves only that Chromium announced an endpoint. It does not prove that its HTTP or websocket server is responsive. A synchronous modal dialog or blocked Electron main event loop can leave the TCP listener present while CDP requests hang.

Do not change the smoke harness until the production process lifetime and startup path have been independently checked. Never expose DevTools beyond loopback to simplify diagnosis.
