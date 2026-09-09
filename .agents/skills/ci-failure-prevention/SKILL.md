---
name: ci-failure-prevention
description: Prevent recurring GitHub Actions CI failures across Breev workflows by enforcing strict local pre-flight gates, domain revision counters, cross-platform Windows/Linux invariants, Electron ASAR bundling checks, and headless Playwright layout rules.
---

# CI Failure Prevention & Pre-Flight Verification

Use this skill whenever authoring code, modifying database migrations or schemas, adding packages, changing Electron packaging or IPC bridges, modifying desktop styles, or preparing a branch for pull request and merge in Breev.

This skill synthesizes empirical forensics from 164 repository CI runs and 66 audited failures to guarantee that CI stays green on the first push.

---

## 1. Prerequisites & Mandatory Local Pre-Flight Verification Chain

Before pushing ANY commit to remote or opening a Pull Request, an agent MUST execute the following mandatory verification sequence locally. Skipping any step in this sequence is a violation of repository engineering agreements.

### The Non-Negotiable Local Command Chain

```powershell
# 1. Code Style & Lint (Fails ~15% of all CI runs if skipped)
pnpm format:write
pnpm format:check
pnpm lint

# 2. Typecheck Across All Monorepo Workspaces
pnpm typecheck

# 3. Monorepo Build & Unit Seams
pnpm build
pnpm test:unit

# 4. PostgreSQL Integration Seam (Real local Postgres service or disposable DB)
pnpm test:integration

# 5. Browser Renderer Seam (Playwright Chromium)
pnpm test:browser

# 6. Desktop Packaging & ASAR Import Integrity Check (MANDATORY if desktop or contracts touched)
pnpm package:desktop
pnpm --filter @breev/desktop exec playwright test --config playwright.config.ts
```

> [!IMPORTANT]
> **Never push unformatted code.**
> CI executes `pnpm format:check` as its first active verification step. Always run `pnpm format:write` prior to `git commit`.

---

## 2. Known Pitfalls & Golden Rules Catalog

### Pitfall 1: Role and Entity Revision Counter Increments in Migrations
- **Context:** Breev enforces monotonic integer `revision` tracking on entities, roles, and pharmacy tables.
- **Trap:** Adding a migration that grants permissions to `owner` or `manager` roles (e.g., in `0011`, `0012`, `0018`) advances the role revision in PostgreSQL. Regression tests asserting hardcoded revision numbers (`toBe("3")`) will fail with `AssertionError: owner: expected '4' to be '3'`.
- **Do This:**
  ```typescript
  // DO: Account for every permission grant migration in the regression snapshot
  expect(after?.revision, before.role_key ?? before.id).toBe(
    before.role_key === "owner"
      ? String(BigInt(before.revision) + 3n) // bumped by migration 0011, 0012, and 0018
      : before.role_key === "manager"
        ? String(BigInt(before.revision) + 2n)
        : before.revision,
  );
  ```
- **Don't Do This:**
  ```typescript
  // DON'T: Hardcode legacy revision sums without calculating new migration statements
  expect(after?.revision).toBe(String(BigInt(before.revision) + 2n));
  ```

---

### Pitfall 2: Packaging Excludes `node_modules` (ASAR Unbundled Bare Imports)
- **Context:** In `apps/desktop`, `electron-builder` packages the application with ASAR enabled and intentionally excludes `node_modules` to stay within the 180 MiB payload budget.
- **Trap:** Using external libraries (like `zod`) in `apps/desktop/src/main` or `src/preload` causes `electron-vite` to externalize them by default. When packaged, the app crashes immediately on launch with `ERR_MODULE_NOT_FOUND: Cannot find package 'zod'`.
- **Do This:**
  ```typescript
  // apps/desktop/electron.vite.config.ts
  export default defineConfig({
    main: {
      build: {
        externalizeDeps: {
          exclude: ["zod"], // Force inlining into the bundled output
        },
      },
    },
  });
  ```
- **Don't Do This:**
  ```typescript
  // DON'T: Leave third-party libraries in main or preload without bundling configuration
  export default defineConfig({
    main: {},
  });
  ```

---

### Pitfall 3: Synchronous Dialog Event-Loop Deadlocks in Headless CI
- **Context:** Headless Linux runners (`ubuntu-latest` with `xvfb-run`) have no display or human user to dismiss UI dialogs.
- **Trap:** Invoking `dialog.showErrorBox` or `dialog.showMessageBoxSync` during startup failure enters a synchronous native modal loop. DevTools WebSocket connections accept TCP but never respond to CDP, hanging Playwright until the 90-second timeout expires.
- **Do This:**
  ```typescript
  // DO: Use asynchronous, non-blocking dialogs so the event loop flushes telemetry and exits
  await dialog.showMessageBox({
    type: "error",
    title: "Startup Error",
    message: description,
  });
  app.exit(1);
  ```
- **Don't Do This:**
  ```typescript
  // DON'T: Call synchronous modal dialogs that freeze the Electron main thread
  dialog.showErrorBox("Startup Error", description);
  app.exit(1);
  ```

---

### Pitfall 4: Cross-Platform File Flushes (`fsync` on Read-Only Descriptors)
- **Context:** Crash-safe durability patterns (`durable-file.ts`, WAL archivers).
- **Trap:** Calling `fsyncSync` on a descriptor opened with `"r"` succeeds on Linux POSIX kernels, but throws `EPERM: operation not permitted` on Windows because Win32 `FlushFileBuffers()` requires `GENERIC_WRITE` access.
- **Do This:**
  ```typescript
  // DO: Open with "r+" so FlushFileBuffers succeeds on Windows
  export function syncFile(filePath: string): void {
    const descriptor = openSync(filePath, "r+");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
  ```
- **Don't Do This:**
  ```typescript
  // DON'T: Open read-only for an fsync operation
  const descriptor = openSync(filePath, "r");
  fsyncSync(descriptor); // Throws EPERM on Windows
  ```

---

### Pitfall 5: Windows Mode Masking & POSIX Permission Assertions
- **Context:** Unit tests asserting restrictive file permissions (`0o600` / `0o700`).
- **Trap:** On Windows, Win32 NTFS does not use POSIX permission bits. `fs.statSync().mode & 0o077` returns `54` instead of `0`. Asserting `toBe(0)` fails on Windows CI.
- **Do This:**
  ```typescript
  // DO: Scope POSIX permission assertions to non-Windows platforms
  if (process.platform !== "win32") {
    for (const file of [TERMINAL_BINDING_FILE, TERMINAL_KEY_FILE]) {
      expect(statSync(path.join(directory, file)).mode & 0o077).toBe(0);
    }
    expect(statSync(directory).mode & 0o077).toBe(0);
  }
  ```
- **Don't Do This:**
  ```typescript
  // DON'T: Assert raw POSIX permission masks unconditionally
  expect(statSync(filePath).mode & 0o077).toBe(0); // Fails on Windows runners
  ```

---

### Pitfall 6: Dynamic UI Layouts Clipping Viewport Actions in Playwright
- **Context:** Desktop screens tested in headless Chromium (1280x800).
- **Trap:** Adding dynamic item tables or multiline canvases without `overflow: auto` and `min-block-size: 0` pushes bottom action buttons (e.g., "Save changes", "Save draft") below the viewport, causing `expect(locator).toBeInViewport()` to fail with `viewport ratio 0`.
- **Do This:**
  ```css
  /* DO: Allow container to shrink and scroll internally */
  .purchase-row-workspace {
    display: grid;
    min-block-size: 0;
    min-inline-size: 0;
    flex: 1 1 auto;
    overflow: auto;
    padding: 1rem;
  }
  ```
- **Don't Do This:**
  ```css
  /* DON'T: Let grid expand unchecked without scrollable constraints */
  .purchase-row-workspace {
    display: grid;
    margin-top: 1rem;
  }
  ```

---

### Pitfall 7: Preload Security Bridge Contract Desynchronization
- **Context:** Exposing new capabilities from Main to Renderer.
- **Trap:** Adding a method to `apps/desktop/src/preload/api.ts` (e.g., `printBarcodeLabel`) without updating the strict allowlist in `apps/desktop/test/desktop.smoke.test.ts` fails the packaged smoke test with `toMatchObject: Received +1 printBarcodeLabel`.
- **Do This:**
  1. Define the method signature in `packages/contracts/src/desktop-preload`.
  2. Implement the bridge in `apps/desktop/src/preload/api.ts`.
  3. Add the exact method name to the expected keys array in `apps/desktop/test/desktop.smoke.test.ts`.
  4. Run `pnpm package:desktop && pnpm test:smoke`.

---

## 3. Diagnostics & Triage Flowchart for CI Failures

When diagnosing a failed GitHub Actions run, do not guess. Follow this exact forensic procedure:

```text
[CI Failure Detected]
         │
         ▼
[Query Failed Step & Run ID]
  gh run view <RUN_ID> --json jobs
  gh run view <RUN_ID> --log-failed
         │
         ├──────────────────────────────────────────────┐
         ▼                                              ▼
[Category 1: Source & Unit Seams]            [Category 2: PostgreSQL Integration Seam]
  • Did `format:check` fail?                   • Did an entity or role revision fail?
    → Run `pnpm format:write`                    → Check migration files and revision math
  • Did `typecheck` fail?                      • Did a query fail with SQL syntax error?
    → Run `pnpm typecheck`                       → Verify raw SQL / parameters in PostgreSQL
  • Did unit tests fail on Windows?            • Did previous test mutate shared table state?
    → Check POSIX mode `0o077` or `fsync`        → Ensure tests use unique IDs or isolate fixtures
         │                                              │
         ├──────────────────────────────────────────────┘
         ▼
[Category 3: Renderer Browser Seam]
  • Did `toBeInViewport()` fail?
    → Check CSS flex/grid overflow in 1280x800 viewport
  • Did `toBeFocused()` or `click()` timeout?
    → Check modal dialog state or keyboard Enter navigation
         │
         ▼
[Category 4: Packaged Electron Seam]
  • Did it fail with `ERR_MODULE_NOT_FOUND`?
    → Add bare import to `externalizeDeps.exclude` in `electron.vite.config.ts`
  • Did it time out waiting for DevTools WebSocket?
    → Check for synchronous `dialog.showErrorBox` blocking main loop
  • Did it fail with `toMatchObject` on preload methods?
    → Synchronize preload allowlist in `desktop.smoke.test.ts`
```

---

## 4. Verification Rules for Repository Guidelines

The following rules must be maintained in repository engineering agreements:

- **Pre-flight Enforcement:** Never push a commit to remote without running `pnpm format:write`, `pnpm format:check`, `pnpm typecheck`, and the affected test seams (`test:unit`, `test:integration`, `test:browser`).
- **Revision Arithmetic Invariant:** Any migration modifying `roles`, `pharmacy`, or permission grants must update the expected revision numbers in all migration integration tests. Never leave legacy revision assertions in place.
- **Cross-Platform File Operations:** File flush operations (`fsyncSync`) must open descriptors with `"r+"` for Win32 compatibility. Assertions on POSIX file mode bits (`mode & 0o077`) must be guarded by `process.platform !== "win32"`.
- **Electron Bundling Safety:** Every runtime dependency imported in Main or Preload must be bundled into `app.asar`. Preload and Main bundles must satisfy `desktop.smoke.test.ts` ASAR import validation.
- **Non-Blocking Headless UI:** All desktop error handling must use asynchronous dialogs. Synchronous native dialogs are strictly prohibited in the Main process.
