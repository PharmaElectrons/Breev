# CI Failure Prevention & Pre-Flight Rules

These rules are non-negotiable across all Breev workspaces. Every agent and developer must satisfy these invariants before committing or pushing changes to remote.

## 1. Mandatory Pre-Flight Verification Chain

Before pushing any commit or opening a Pull Request:
1. Run `pnpm format:write` followed by `pnpm format:check`. Unformatted files are rejected immediately by CI.
2. Run `pnpm lint` and resolve all lint errors.
3. Run `pnpm typecheck` across all packages in the monorepo.
4. Run the test seams touched by the change:
   - Modified logic/contracts/components: `pnpm test:unit`
   - Modified database schemas, migrations, or API endpoints: `pnpm test:integration`
   - Modified renderer UI, styles, or keyboard interactions: `pnpm test:browser`
   - Modified packaging, preload bridges, or Main process boot: `pnpm package:desktop && pnpm --filter @breev/desktop exec playwright test --config playwright.config.ts`

## 2. Database Migration & Domain Revision Counters

- Every database migration that grants permissions or updates built-in roles (`owner`, `manager`) advances the role revision counter in PostgreSQL.
- When adding migrations, calculate the revision offset: each distinct SQL statement modifying a role advances its revision by `1`.
- Update `apps/local-api/src/identity-access/custom-roles-migration.integration.test.ts` and related persistence tests whenever new permissions or migrations are introduced. Never commit without running `pnpm test:integration`.

## 3. Desktop Packaging & ASAR Bundling

- Electron packaging excludes `node_modules` from `resources/app.asar`.
- Any package imported in `apps/desktop/src/main` or `src/preload` that is not a Node.js built-in (`node:*`) or `electron` must be explicitly excluded from `externalizeDeps` in `apps/desktop/electron.vite.config.ts` so Vite inlines it into the bundle.
- Every bare specifier in Main and Preload bundles must be resolvable within Electron. Run the ASAR verification test in `apps/desktop/test/desktop.smoke.test.ts`.

## 4. Headless CI Runtime Safety

- Never call synchronous modal dialogs (`dialog.showErrorBox`, `dialog.showMessageBoxSync`) in Electron code paths. In headless CI (`xvfb-run`), synchronous dialogs enter an unserviced modal loop that blocks DevTools WebSocket connections and causes Playwright test timeouts. Always use asynchronous `dialog.showMessageBox()`.
- Do not couple pre-window bootstrap validation (e.g., `localApiOrigin`) to post-window operational configuration schemas that require extra fields.

## 5. Cross-Platform Windows & POSIX Invariants

- File flush operations: When calling `fsyncSync(descriptor)` to flush data durably to stable storage, always open the descriptor with `openSync(filePath, "r+")`. Opening with read-only `"r"` succeeds on Linux but throws `EPERM` on Windows Win32 `FlushFileBuffers()`.
- POSIX file mode assertions: Windows NTFS does not use POSIX permission bits (`st_mode`). Assertions on `mode & 0o077` must be scoped to `if (process.platform !== "win32")`.
- On Windows, cryptographic keys are protected by DPAPI and NTFS ACLs, not POSIX mode bits.

## 6. UI Viewport & Keyboard Accessibility Invariants

- All desktop workspaces and views must be accessible within a 1280x800 viewport.
- Dynamic row containers and canvases must include `overflow: auto` and `min-block-size: 0` (or `min-height: 0`) to ensure action bars and headers remain visible in the viewport and satisfy Playwright `toBeInViewport()` assertions.
- Keyboard navigation flows must ensure that inputs receiving focus are active before subsequent typing or key presses.

## 7. Preload Security Bridge Allowlist

- Any new method exposed on `window.breev` in `apps/desktop/src/preload/api.ts` must be declared in `packages/contracts` and added to the exhaustive key allowlist in `apps/desktop/test/desktop.smoke.test.ts`.
