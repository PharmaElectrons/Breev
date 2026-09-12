# Issue #56 verification evidence

Branch `issue/25-count-stock-sessions`, recorded on 2026-09-12 on the Linux
host (Docker Testcontainers PostgreSQL 18.6, Playwright Chromium). Every
seam below ran on the host; the implementer sandbox cannot reach Docker or
Playwright.

## Mixed-unit conversion and exact arithmetic

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.unit.config.ts --reporter=verbose src/inventory/inventory-count.unit.test.ts src/accounting/count-variance-posting-template.unit.test.ts
```

Output: `conversion-property.txt`. The verbatim scenario "2 packs + 1 strip"
composes to 9 strips at 1 pack = 4 strips with the entered label preserved;
fast-check properties prove every composition at arbitrary positive ratios and
non-negative counts is a non-negative integer, that signed fils splits across
batches conserve the total exactly, and that WAC valuation of a shortage and a
surplus conserves quantity and value without a fraction. The count journal
template balances debits and credits in both directions and refuses a zero
variance.

## Rollback, idempotency, concurrency, immutability, restart

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/inventory/inventory-count.integration.test.ts
```

Output: `rollback-idempotency.txt`. Eight cases pass against a child-process
local API: the lifecycle (mixed-unit line, single-batch application posting one
`count-variance` movement, one `C` number reused by later applications,
FEFO-ordered movements for a multi-batch shortage, a blocked-stock shortage
refused with 409 `count-blocked-stock`, valuation state equal to the
movement-derived value); rollback-together at six injected fault points
(movements, valuation state, applications, journal lines, outbox, command
results) leaving an audited unissued number that the retry issues; idempotent
replay of success and rejection with a conflicting body refused; a purchase
posted between observation and application detected as 409
`count-balance-changed` and re-applied against the live balance, plus stale
`expectedVersion` refused; completed sessions, lines, applications, count
movements, and journal rows rejecting update and delete with `55000`; API
restart with identical durable lines and version; direct quantity edits refused
at the API boundary with raw inventory facts unchanged across reads; and
reconciliation of raw movements against the review grid and movement history,
with a shortage excluded from consumption.

## Allow/deny matrix

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts --reporter=verbose src/inventory/inventory-count-authorization.integration.test.ts
```

Output: `allow-deny-matrix.txt`. Four cases pass: every count command allowed
and denied per `inventory.counts.record` / `inventory.counts.approve` across
the built-in roles and a custom role; approve-only users read and apply but
cannot record, with reason and evidence required and audited; valuation fields
hidden without `inventory.valuation.view` and an approved Step-Up challenge
granting no count authority; tenant, locked-user, stale-version, and device
boundary denials audited.

## Renderer

Command:

```text
BREEV_REGENERATE_EVIDENCE=1 pnpm --filter @breev/desktop exec playwright test test/browser/count-session.browser.test.ts --config playwright.browser.config.ts
```

Seven scenarios pass against the real local API: the scanner-and-keyboard-only
loop (barcode, Enter, default unit field focused, balance, Enter, focus back on
Barcode/Item; "2 Pack + 1 Strip" recorded as 9 with before 8, after 9, variance
+1); validation keeping value and focus; a manager applying a variance through
the dialog and drilling from Item Movement Details into the session review
with focus restored; a stale balance announced after a purchase lands between
observation and application, then re-applied, and a blocked-stock shortage
refused with the batch-review link; API restart and resume with the lines
intact; record-only and approval boundaries at the renderer and the API; and
Arabic RTL and English LTR in light and dark themes with axe checks.

Screenshots under `after/`:

- `count-session-loop-{ar,en}-{light,dark}.png`
- `count-variance-dialog-{ar,en}-{light,dark}.png`
- `count-movement-history-{ar,en}-{light,dark}.png`

Video: `after/count-loop.webm` (the keyboard loop).
