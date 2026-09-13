# Issue #57 verification evidence

Branch `issue/26-manage-reorder-basket`, recorded on 2026-09-13 on the Linux
host (Docker Testcontainers PostgreSQL 18.6, Playwright Chromium). The
implementer sandbox cannot reach Docker or Playwright; the orchestrator fills
the transcript files referenced below.

## Proposal arithmetic and projection property

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.unit.config.ts --reporter=verbose src/inventory/inventory-reorder.unit.test.ts
```

Output: `proposal-property.txt`. The run proves exact bigint proposal and
projection behavior: missing and already-reached maximum levels produce a
zero proposal with an explicit basis, proposals never become negative or
overshoot the maximum, and surplus warnings occur only when a maximum exists
and the projected balance exceeds it.

## Basket lifecycle, durability, and restart

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/inventory/inventory-reorder.integration.test.ts
```

Output: `basket-integration.txt`. The run proves the durable basket lifecycle,
exact package-to-inventory-unit proposals, live projection facts, idempotent
adds and transitions, version conflicts, inactive-product handling,
immutability, rollback-together behavior, and identical state after an API
restart.

## Allow/deny matrix and audit

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/inventory/inventory-reorder-authorization.integration.test.ts
```

Output: `allow-deny-matrix.txt`. The run proves the manage/confirm permission
split across built-in and custom roles, the read boundary, tenant/user/device
and entitlement denials, expected-version enforcement, and an audited
permission-denied add without changing basket state.

## Desktop browser renderer

Command:

```text
BREEV_REGENERATE_EVIDENCE=1 pnpm --filter @breev/desktop exec playwright test test/browser/basket.browser.test.ts --config playwright.browser.config.ts
```

Output: `after/basket-{ar,en}-{light,dark}.png`,
`after/ordered-items-{ar,en}-{light,dark}.png`,
`after/inventory-grid-basket-action-{ar,en}-{light,dark}.png`, and
`after/basket-keyboard.webm` collected from
`test-results/issue-57-video/basket-keyboard.webm`. The run proves the
keyboard add flow, basket facts and captions, warning and validation states,
confirm/return focus behavior, archived-row actions, recoverable save failure,
API restart survival, renderer/API denials, Arabic RTL and English LTR in both
themes, logical table order, axe checks, and the keyboard video evidence.
