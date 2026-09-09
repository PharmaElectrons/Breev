# Failure Classification & Diagnostic Seam

Before modifying application code during a PR review or remediation loop, you must classify any test or build failure.

Never rewrite application code to "fix" an issue caused by local service availability, missing environment variables, or sandbox security boundaries.

---

## 1. The Six Failure Classes

| Class | Type | Examples | Correct Action |
|---|---|---|---|
| **Class 1** | **Product / Code Defect** | Syntax error, broken TypeScript types, broken module imports, null pointer exceptions, incorrect SQL query logic, regression in domain calculations. | **Proceed to Remediation**: Fix code in the branch following project rules. |
| **Class 2** | **Test Drift / Outdated Assertion** | A requirement deliberately changed the API shape or return code, but a unit test still asserts the old contract. | **Update Test**: Reconcile test assertion to match the approved new requirement. |
| **Class 3** | **Environment / Missing Prerequisite** | Local PostgreSQL service stopped, `BREEV_TEST_POSTGRES_ADMIN_URL` unset, port already bound by another process, local disk full. | **Diagnose Environment**: Start service or configure env. **DO NOT** edit application code. |
| **Class 4** | **Host / Sandbox Limitation** | Windows `CryptUnprotectData` (DPAPI) failures inside sandbox, symlink creation denied without developer mode, hardware TPM unavailable. | **State Limitation**: Rely on Windows CI or physical profile evidence. **DO NOT** disable encryption or bypass security checks. |
| **Class 5** | **Policy / Security Denial** | Auto-review tool denial, restricted directory access, unsigned binary execution blocked. | **Stop & Escalate**: Seek explicit direction. Never attempt to bypass security policies. |
| **Class 6** | **Shell / Pipeline Mistake** | PowerShell variable collision (`$PID`, `$HOME`), unquoted spaces in paths, exit code swallowed by piping into `grep`/`findstr`. | **Fix Invocation**: Re-run command using native exit code inspection (`$LASTEXITCODE`). |

---

## 2. Workspace Specifics (Breev on Windows)

### Local PostgreSQL Seam
- Breev uses a local PostgreSQL Windows service on maintained workstations, **not Docker**.
- If persistence tests fail with connection refused (`ECONNREFUSED` on port 5432):
  1. Check if the Windows service is running:
     ```powershell
     Get-Service -Name postgresql*
     ```
  2. Verify if `BREEV_TEST_POSTGRES_ADMIN_URL` is set in the environment (without printing secret credentials):
     ```powershell
     Test-Path Env:BREEV_TEST_POSTGRES_ADMIN_URL
     ```
  3. Never mock repositories to make tests pass. Real PostgreSQL is mandatory per `docs/quality.md`.

### Windows Cryptography (CNG & DPAPI)
- If an encryption or licensing test fails with `CryptUnprotectData`:
  - Check whether the command was run in an agent sandbox where DPAPI user-state is restricted.
  - Never replace CNG/DPAPI with unencrypted plaintext or mock key stores to force a test to pass.
  - Escalate to Windows CI (`gh workflow run Verify`) for certified execution.

### Electron & Headless Displays
- Packaged smoke tests (`pnpm test:smoke`) or browser Playwright tests (`pnpm test:browser`) may require a desktop display context.
- If Electron fails to initialize a graphical window due to running headless without a virtual display, classify as **Class 4 (Host limitation)** rather than a product defect.
