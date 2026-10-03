# T03 requested fast checkpoint run

30 September 2026. The stakeholder requested that the agent run the scenarios
and inspect output quickly using browser automation. This authorizes execution,
not a stakeholder PASS or a commit.

Result: **9 passed in 1.7 minutes, exit 0**, no failed or skipped selected cases.
The [actual Playwright output](agent-checkpoint-output.log) is retained.

Command:

```text
pnpm --filter @breev/desktop exec playwright test --config playwright.browser.config.ts test/browser/purchasing.browser.test.ts -g 'Adjustment controls preserve|binds Adjustment confirmation|searches and reviews immutable'
```

Executed on the separate task-owned regression PostgreSQL cluster, port 5551.
The interactive manual fixture on port 5552 and its data remain untouched.

- Four confirmation cases, English/Arabic and light/dark: first-save evidence
  survives real API restart and renderer reload; summary edits invalidate the
  confirmation; stale input is refused; saved reload is explicit; a lost Post
  response retries the same command and creates exactly one Adjustment; posted
  evidence/reason and original-linked review are checked through UI and API.
- Four controls cases, the same locale/theme matrix: filtered navigation,
  dirty-work retention, save/keep/discard, Return routing, protected New invoice,
  unavailable/zero values, exact server totals, malformed input, permission/session
  presentation, offline-save recovery, modal focus, axe, narrow viewport and 200%
  text checks pass. For quantity 4→8, gross 320→640 IQD, allowance 8→16, discounted
  312→624; primary-cost Delta is +320, independent of discounted totals.
- One complete keyboard review/Return case passes.

The fresh English totals capture was inspected. Generated legacy captures were
retained separately and restored to their preserved originals; both unrelated
dirty work files retain their original hashes. No source behavior was changed
for this rerun.

This is browser/API checkpoint evidence. Live Windows Narrator listening and
stakeholder visual acceptance are not claimed. The prior note report remains
open. The stakeholder subsequently accepted agent verification and replied
**PASS**; see [manual-results.md](manual-results.md). The later
[visual verification](prototype-fidelity.md) records another nine passing cases
after visual corrections. No push/PR or phase acceptance is claimed.
