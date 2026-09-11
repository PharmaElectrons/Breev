# Issue #55 verification evidence

Branch `issue/24-enforce-batch-safety`, recorded on 2026-09-11 on the Linux
host (Docker Testcontainers PostgreSQL 18.6, Playwright Chromium).

## Catch-up, idempotency, and crash safety

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/inventory/inventory-safety.integration.test.ts
```

Output: `catch-up-idempotency.txt`. Four cases pass: FEFO order and hard
blocks, append-only facts and the business-date boundary, real pg-boss
recovery after SIGKILL at before-claim, after-claim, after-date-commit, and
after-final-commit with a seven-missed-date catch-up and duplicate-delivery
hash check, and the job-runtime outage plus Step-Up denial audits.

## No-override matrix

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/inventory/inventory-safety-no-override.integration.test.ts
```

Output: `no-override-matrix.txt`. The tab-separated table lists 96 cells:
8 actors (seven built-in roles plus a custom role holding every implemented
permission) × 4 Step-Up states × 3 hard-blocked batches. Every named
allocation attempt is refused (409 `regulatory-hard-block`, or 403 for roles
without `inventory.review`), every unnamed preview omits the blocked batch,
and the in-process allocation and validation operations refuse as well. An
approved correction challenge stays unconsumed.

## Renderer

Command:

```text
BREEV_REGENERATE_EVIDENCE=1 pnpm --filter @breev/desktop exec playwright test test/browser/batch-safety.browser.test.ts --config playwright.browser.config.ts
```

Five scenarios pass against the real local API: FEFO preview with the
near-expiry warning (icon, text, and announced sentence) and the expired
block; "Run evaluation now", quarantine with reason and evidence, and focus
return; expiry correction through Step-Up with the original date kept in the
history; keyboard month navigation, forced colours, Arabic RTL and English
LTR in light and dark themes with axe checks; and a manager without the
permission seeing no actions and a forged POST answered 403.

Screenshots under `after/`:

- `batch-safety-review-{ar,en}-{light,dark}.png`
- `batch-fefo-preview-{ar,en}-{light,dark}.png`
- `batch-fefo-preview-near-expiry-en-light.png`
- `batch-expiry-correction-{ar,en}-{light,dark}.png`
- `batch-expiry-correction-step-up-en-dark.png`
