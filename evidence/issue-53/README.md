# Issue #53 verification evidence

## Purchase-return invariant seam

Command:

```text
pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts src/purchasing/purchase-posting.integration.test.ts
```

Recorded result on 2026-09-10:

```text
Test Files  1 passed (1)
Tests       13 passed (13)
```

The return test covers independently stored and computed values (8,000 fils
inventory carrying amount versus 4,000 fils supplier reduction), full
transaction rollback at an injected final-outbox failure, retry/replay once,
over-return draft survival, Step-Up denial and approval, exact outbound movement,
original-invoice byte immutability, bidirectional links, concurrent remaining-stock
contention, final batch depletion, conservation, and posted-return update/delete
rejection.

## Unit and contract seams

```text
@breev/contracts                 175 passed
@breev/desktop                   472 passed
Focused @breev/local-api seams    39 passed
```

The focused server run includes return arithmetic, WAC depletion, the versioned
G-01 working-default journal template, authorization, and the durable outbox
event.

## Renderer seam

Command:

```text
pnpm --filter @breev/desktop exec playwright test test/browser/purchasing.browser.test.ts --config playwright.browser.config.ts
```

Recorded result on 2026-09-10:

```text
15 passed
```

The run exercises the real local API and captures keyboard operation, Arabic RTL
and English LTR, light and dark themes, the two-value confirmation summary, and
invoice-to-return/return-to-invoice navigation.

## UI artifacts

- `after/purchase-return-ar-dark.png`
- `after/purchase-return-ar-light.png`
- `after/purchase-return-en-dark.png`
- `after/purchase-return-en-light.png`
- `after/purchase-return-summary-en-light.png`
- `after/purchase-return-keyboard.webm`

## Aggregate workstation limitations

The complete `pnpm verify` aggregate reaches two pre-existing Windows host/ACL
limitations outside this issue: machine-scope CNG key creation is denied for the
current profile, and directory symlink creation is denied. The full browser
aggregate also requires a container runtime for its existing device-pairing seam;
when forced onto one shared local database, independent suites collide on their
fixed test-role names. No cryptography, ACL, recovery, or test-isolation behavior
was weakened. The issue-specific unit, PostgreSQL, contract, desktop, packaging,
smoke, and renderer seams are green.
