# Gates: Purchasing Frontend Flow Alignment & UI/Localization Defects (Issue #189)

OWNS: apps/desktop/src/renderer/src/purchasing-messages.ts apps/desktop/src/renderer/src/purchasing-messages.unit.test.ts apps/desktop/src/renderer/src/purchase-adjustment-workflow.tsx apps/desktop/src/renderer/src/purchase-return-workflow.tsx apps/desktop/src/renderer/src/posted-purchase-review.tsx apps/desktop/src/renderer/src/styles.css .scratch/issue-189/**

Scope: Resolve GitHub Issue #189 by aligning purchasing review, adjustment, and return flows with prototype design standards and fixing critical UI and localization defects.

- [x] G1: Purchasing messages unit tests pass with Arabic and English key symmetry
      CHECK: pnpm --filter @breev/desktop exec vitest run src/renderer/src/purchasing-messages.unit.test.ts
      EXPECT: Tests 4 passed
      EVIDENCE: 4 passed in 959ms

- [x] G2: Code formatting check passes across repository
      CHECK: pnpm format:check
      EXPECT: All matched files use Prettier code style
      EVIDENCE: All matched files use Prettier code style!

- [x] G3: Monorepo linting passes without errors
      CHECK: pnpm lint
      EXPECT: turbo run lint
      EVIDENCE: ESLint and boundary check passed (432 source files)

- [x] G4: Monorepo typechecking passes across all workspaces
      CHECK: pnpm typecheck
      EXPECT: turbo run typecheck
      EVIDENCE: 4 successful across @breev/contracts, @breev/desktop, @breev/local-api

- [ ] G5: Targeted purchasing browser tests pass
      CHECK: pnpm --filter @breev/desktop test:browser apps/desktop/test/browser/purchasing.browser.test.ts
      EXPECT: passed
      EVIDENCE: Local execution host-limited (missing test prerequisite: BREEV_TEST_POSTGRES_ADMIN_URL points to 127.0.0.1:5549 with ECONNREFUSED; local service is on 5432 without configured credentials; no Docker runtime). CI execution will run against containerized PostgreSQL.

