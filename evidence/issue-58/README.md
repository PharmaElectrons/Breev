# Issue #58 verification evidence

Branch `issue/27-start-sale-draft-reorder`, recorded on 2026-09-13 on the
maintained Windows workstation against Docker Testcontainers PostgreSQL 18.6
and Playwright Chromium.

## Draft lifecycle, durability, and the undisturbed draft

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/sales/sale-draft.integration.test.ts
```

Output: `sale-draft-integration.txt`. The run proves the durable Sale Draft
lifecycle against real PostgreSQL: create, list, and read; resume advancing the
version while creation facts stay put; **case 3** kills the local API with
`SIGKILL` and resumes the identical draft after restart; **case 4** issues two
concurrent resumes at the same expected version and lets exactly one advance
the version while the other is refused; case 5 replays an idempotent resume and
rejects the same key with a changed payload; case 6 shows the row resisting
direct deletion and immutable-fact mutation; and **case 7** proves a successful
add, a permission denial, and a rule denial each leave the draft byte-identical
with no audit fact and no sale-draft command result written against it.

## Server-boundary allow and deny matrix

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/sales/sale-draft-authorization.integration.test.ts
```

Output: `allow-deny-matrix.txt`. The run proves the built-in sales employee and
a custom role carrying the exact grant are allowed; a custom role without the
sales grant is denied and the draft stays byte-identical; and tenant,
revoked-session, wrong-device, and absent-device denials all fall outside the
draft.

## Migration 0025

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/identity-access/sale-draft-migration.integration.test.ts
```

Output: `migration.txt`. The run proves the exact minimal table, the
`sale_draft_status` enum, the permission definition, the default grants per
built-in role, and the change guard that refuses deletion and any edit to an
immutable fact.

## Desktop browser renderer

Command:

```text
BREEV_REGENERATE_EVIDENCE=1 pnpm --filter @breev/desktop exec playwright test test/browser/sales.browser.test.ts --config playwright.browser.config.ts
```

Output: `after/sale-draft-index-{ar,en}-{light,dark}.png`,
`after/sale-draft-search-results-{ar,en}-{light,dark}.png`, and
`after/sale-draft-keyboard.webm` collected from
`test-results/issue-58-video/`. The run drives the real local API and proves the
keyboard-only path from the draft index through search to the basket row
action; that the draft stays byte-identical in the API and on screen; that the
draft resumes after a renderer restart with an empty search box and after a
local-API restart; that an unreachable basket keeps the query, the rows, and the
draft and retries into exactly one basket row; that an item archived after the
search is explained and resolved (see the note below); that the row action is
absent without the basket permission while the server still refuses the same
command; and
Arabic RTL with English LTR in both themes, with axe clean and the result row's
logical order unchanged by the visual direction.

## Note on the archived-item case

The issue asks that "an archived item in the row list renders a resolvable
state". `CatalogService.search` filters on `status = 'active'`
(`apps/local-api/src/catalog/catalog.service.ts`), so an archived or merged
product can never appear in a #17 search result and therefore can never be a
row in this list. The reachable case is an item archived _between_ the search
and the press: the server refuses the basket command with
`reorder-product-inactive`, the surface shows #26's existing denial copy and a
**Search again** control, and re-running the query drops the stale row. That is
the resolvable state the browser suite proves. No preventive "archived row"
affordance ships, because it would be unreachable UI.
