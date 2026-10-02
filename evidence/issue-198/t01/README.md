# M2-P1-T01 — Adjustment confirmation integrity

Issue [#198](https://github.com/PharmaElectrons/Breev/issues/198), part of
[#190](https://github.com/PharmaElectrons/Breev/issues/190). Candidate date:
30 September 2026. Branch: `issue/198-m2-purchasing-integrity`; base:
`ac1916c`. **Manual acceptance: PASS**, explicitly supplied by the stakeholder
on 30 September 2026 and followed by authorization to continue. Commit of this
accepted slice is authorized; push/PR remains behind the final phase gate.

## Bounded change

The server uses one canonical payload for preview and Post: pharmacy and draft
identity/version, immutable original, current correction revision/header/rows,
saved reason/evidence/header/all rows (including unchanged rows), exact preview
effects, affected batch identity/status/movement balance/count, and required
permissions. Permission and device/session authority are revalidated, never
delegated by the digest. The preview locks its draft, corrected original, and
affected batches for its short transaction; it holds no transaction while the
human reviews it. Post compares the saved version and digest before effects and
again after acquiring the batch locks.

The renderer saves before requesting the preview, invalidates Confirm on edits,
reloads authoritative drafts after conflicts, and keeps the same Post body/key
after a lost response. Editors are locked during that uncertain attempt. A
successful commit followed by a failed detail refresh remains a successful
commit. Typed authority denials remain denials. Posted review now displays the
saved evidence; the audit includes posted reason/evidence/version/hash.

No migration, dependency, preload, shell, shared style, Quick Product, or Purchase
row keyboard implementation changed. T02–T06, #63/#75, durable printing/OCR, and
G-01/G-02 decisions remain outside this checkpoint. The complete Adjustment
requirement family remains a defect until its later tasks are accepted.

## Precedent and fit

[commercetools optimistic concurrency](https://docs.commercetools.com/api/general-concepts#optimistic-concurrency-control)
uses versioned updates to reject conflicting edits;
[Stripe idempotency](https://docs.stripe.com/api/idempotent_requests) checks the
request parameters for retries with a stable key. These patterns fit Breev's
single local authority and uncertain local transport. This change uses the
existing version checks and durable PostgreSQL command ledger; it adds no cloud
dependency, key-expiry policy, or new business authority.

## Automated evidence

Changed implementation/test files:

- Local API: `purchasing/purchase-adjustment-confirmation.ts` and its unit test,
  `purchasing/purchase-adjustments.service.ts`, `inventory/inventory-persistence.ts`,
  `purchasing/purchase-posting.integration.test.ts`, and
  `purchasing/purchasing.integration.test.ts` under `apps/local-api/src/`.
- Desktop: `purchase-adjustment-workflow.tsx`, `purchasing-messages.ts`, and
  `posted-purchase-review.tsx` under `apps/desktop/src/renderer/src/`, plus
  `apps/desktop/test/browser/purchasing.browser.test.ts`.
- Contracts: `packages/contracts/src/local-rest/index.ts` and `purchasing.test.ts`.
  Documentation: `docs/traceability.md`, `docs/milestone-2-scope-and-evidence-map.md`,
  and this candidate evidence bundle.

Run from the repository root, using only a disposable PostgreSQL administrator
URL in `BREEV_TEST_POSTGRES_ADMIN_URL`. Database files run sequentially because
the fixture resets application schemas. Production data must never be targeted.

| Seam | Command | Result |
|---|---|---|
| Canonical hash, Delta, journal arithmetic | `pnpm --filter @breev/local-api exec vitest run --config vitest.unit.config.ts src/purchasing/purchase-adjustment-confirmation.unit.test.ts src/purchasing/purchase-adjustment-delta.unit.test.ts src/accounting/purchase-adjustment-posting-template.unit.test.ts` | 45 passed, including 33 hash cases |
| Runtime contracts | `pnpm --filter @breev/contracts test:unit` | 210 passed |
| Real PostgreSQL | `pnpm --filter @breev/local-api exec vitest run --config vitest.config.ts src/purchasing/purchasing.integration.test.ts src/purchasing/purchase-posting.integration.test.ts` | 25 passed; latest expanded posting file also passed all 16 |
| Renderer/client/messages | `pnpm --filter @breev/desktop exec vitest run --config vitest.config.ts src/renderer/src/purchase-adjustment-workflow.unit.test.ts src/renderer/src/purchasing-api.unit.test.ts src/renderer/src/purchasing-messages.unit.test.ts` | 18 passed |
| Confirmation/browser plus existing keyboard review | `pnpm --filter @breev/desktop exec playwright test --config playwright.browser.config.ts test/browser/purchasing.browser.test.ts -g "binds Adjustment confirmation\|searches and reviews immutable purchases entirely by keyboard"` | 5 passed |
| Type checks | Local API `tsconfig.json`; desktop `tsconfig.renderer.json` and `tsconfig.node.json`, each with `tsc --noEmit` | Passed |
| Source format/lint | Prettier and ESLint on the changed files; `git diff --check` | Passed |
| Current builds | Contracts, local API, desktop | Passed |

PostgreSQL covers concurrent evidence edits; stale version/hash; conflicting
idempotency payload; restart after preview and after Post; duplicate retry;
current stock changes; unchanged rows producing no effects; immutable originals;
posted audit facts; permission/cost denial at preview/Post; invalid device/session;
and rollback at 13 write stages. Failure injection covers journals/lines,
Supplier balances, posted header/rows, movements, value effects, Catalog price,
valuation, draft completion, outbox, audit, and final command result. Each
rollback preserves the active draft and accepts a later retry of the same
attempt. Number reservations are intentionally durable and are reused.

Browser cases cover English/Arabic and light/dark; 1280×800 and 1366×768;
narrow 640px and 200% text; evidence invalidation; saved-draft renderer restart;
stale-session reload; identical retry bodies after an intercepted committed Post
loses its response; exact immutable evidence; and focused dialog denials. Axe
checks the summary dialog. Eight summary PNGs are under `screenshots/`.
The final four-case confirmation-only rerun passed all four after adding narrow,
200% text, and focused-denial assertions. The existing keyboard review case also
exercised Adjustment and Return; its historical image/video artifacts were
restored afterward so this candidate adds only its own evidence bundle.

Verification used PostgreSQL 18 in a new task-owned cluster bound only to
`127.0.0.1:5549`. The workstation's normal PostgreSQL service was untouched.
The initial connection refusal was a stopped disposable-cluster prerequisite.
Subsequent test failures exposed the draft-creation/input race (fixed), incorrect
conflict-text assertions, and an older Return test's global count/fixed-number
assumptions (changed to exact before/after effects and reserved-number reuse).
One attempted desktop unit command named a nonexistent config; the corrected
`vitest.config.ts` command passed. These are not unresolved product failures.
The first 200% text probe was refused by the production CSP's inline-style
restriction. Its corrected probe serves a same-origin test stylesheet; CSP is
unchanged.

Full repository pre-flight and fresh packaged acceptance remain the Phase 1
exit gate after all six manual checkpoints. This browser fixture uses the built
renderer and a test desktop bridge, with real REST and PostgreSQL; it does not
claim installer or physical workstation certification.

## Exact manual checkpoint

The opt-in test prepares a synthetic pharmacy through public APIs, posts
`MANUAL-T01-4-TO-8` (4 units at 80 IQD each), opens two renderer tabs, then pauses
for human interaction. Resume restarts the real API and reloads the first tab,
then pauses again. It does not automatically accept the manual outcome.

### Setup

The Codex task has opened the fixture at its first pause. Use the two Chromium
tabs and Playwright Inspector already open. The commands below are for reopening
the fixture if it has been closed.

Use this task's disposable cluster. Its exact local path is recorded in the
ignored `.scratch/runtime/m2-p1-t01-cluster-path.txt`. The configured test admin
URL must be available in the terminal environment; do not print it or replace it
with a live pharmacy URL. The manual fixture refuses any host/port other than
`127.0.0.1:5549`. It resets the disposable schemas.

```powershell
Set-Location 'P:\Projects\PharmaElectrons'
if (-not $env:BREEV_TEST_POSTGRES_ADMIN_URL) { throw 'Configure the disposable test administrator URL first' }
$manualDatabase = [uri]$env:BREEV_TEST_POSTGRES_ADMIN_URL
if ($manualDatabase.Host -ne '127.0.0.1' -or $manualDatabase.Port -ne 5549) { throw 'Use the task-owned disposable cluster' }
$env:BREEV_M2_T01_MANUAL = '1'
pnpm --filter @breev/desktop exec playwright test --config playwright.browser.config.ts test/browser/purchasing.browser.test.ts -g 'manual T01 Adjustment checkpoint' --headed
Remove-Item Env:BREEV_M2_T01_MANUAL
```

### First pause: edits and stale session

1. In the first tab, open **Posted invoices**, search `MANUAL-T01-4-TO-8`, open
   it, choose **Edit Invoice → Create adjustment copy**. Change quantity **4 to
   8**, then **Save and review Delta**. Expected: quantity Delta **+4**, value
   Delta **320 IQD**, Confirm enabled.
2. Change only the summary evidence to `T01 evidence after preview`. Expected:
   Confirm immediately disables and asks for Save/review. A stale Post cannot be
   submitted. Click the summary's **Save and review Delta**. Expected: Confirm
   enables and the exact saved evidence remains displayed.
3. In the second tab, open the same invoice and **Edit Invoice → Continue
   draft**. Change the draft's evidence field to `T01 concurrent saved evidence`
   and Save/review. Do not Post from this tab.
4. Return to the first tab and Confirm its older preview. Expected: a focused,
   localized conflict inside the summary, Confirm disabled, and **Reload saved
   adjustment** offered. Reload, verify the concurrent evidence, change it to
   `T01 final evidence`, then Save/review again. Keep this preview unposted.
5. Click **Resume** in the Playwright Inspector. The fixture restarts the API,
   reloads the first renderer tab, and pauses again.

### Second pause: restart and immutable result

6. In the first tab, choose **Edit Invoice → Continue draft** if needed. Verify
   quantity **8** and exact evidence `T01 final evidence` survived. No previous
   in-memory preview is usable after the reload. Save/review again, then Confirm.
7. Expected: one Adjustment, quantity Delta **+4**, value Delta **320 IQD**. Return
   to the original invoice and open its **A01** link. Its immutable detail must
   contain exactly `T01 final evidence`; the original still shows quantity **4**.
8. Reload the renderer and re-open both documents. Expected: one correction,
   unchanged original, and the same final evidence. Check the behavior in the
   alternate locale/theme if desired. Record any failure with its step number.
9. Click Inspector **Resume** to finish and close the test processes/tabs.

### Cleanup and decision

The stakeholder accepted T01 and reported a separate presentation issue: raw
request/audit UUIDs appear in ordinary errors. This does not revoke the integrity
PASS. The Phase 1 follow-up record tracks hiding diagnostic references by
default while retaining audit/support evidence for T03 and later affected tasks.

The manual harness stops its API/renderer servers on completion. Stop only this
task's cluster after the manual run; retain its directory for investigation:

```powershell
$manualCluster = (Get-Content -LiteralPath '.scratch/runtime/m2-p1-t01-cluster-path.txt' -Raw).Trim()
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D $manualCluster -m fast -w stop
```

**Reply PASS to accept this subtask, or FAIL with the observed result.**
T02, commit, push, and PR work remain stopped until explicit PASS.
