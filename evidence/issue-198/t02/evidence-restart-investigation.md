# Manual A evidence investigation

Date: 30 September 2026. Status: note report unresolved; T02 separately accepted
by the stakeholder after their confirmation that manual tests were finished.

The stakeholder reported quantity 8 restored by Continue draft after A4's API
restart, with an empty evidence input. Read-only inspection of the task-owned
disposable cluster found the active draft at version 3 with evidence null and
quantity 8. Its create audit and both committed update audits contained null
evidence; no saved non-empty evidence was subsequently replaced by null in that
record. This locates the missing value before the first update, rather than
proving a restart/load failure. The exact manual input sequence is unconfirmed.

The stakeholder repeated the report after reopening the fixture and clarified
that the missing value is the optional evidence text shared by the header input
and Delta dialog, not the Reason dropdown. The second attempt's active draft
`01a0f29a-3f33-74ba-86be-eb6f3716d861` is version 2, reason `quantity error`,
quantity 8, and evidence null. Its creation and update audits also contain null
evidence. A GET through the running fixture's normal HTTP proxy independently
confirmed those saved facts. No manual data was changed during diagnosis.

The four existing confirmation browser regressions now enter evidence in the
header with keyboard events before editing quantity, verify the input still
contains that text after quantity editing, and assert the first server preview
contains it. They then restart the real API immediately after that first Save,
reload the renderer, and verify Continue draft restores the exact evidence and
Reason. They also change and save summary evidence and repeat the restart/load
check. Existing stale/conflict/retry/audit checks continue afterwards.

Command:

```powershell
pnpm --filter @breev/desktop exec playwright test --config playwright.browser.config.ts test/browser/purchasing.browser.test.ts -g 'binds Adjustment confirmation to saved evidence'
```

Result: **4 passed**, 1.0 minute, English/Arabic × light/dark; log
`.scratch/runtime/m2-p1-t02-first-save-restart.log`. The earlier single-restart
version also passed all four cases in 45.1 seconds. ESLint and modified-file
formatting passed. These tests used a separate temporary loopback PostgreSQL
cluster on port 5551 to preserve the running manual fixture on port 5549; no live
pharmacy data or manual draft was reset. The separate cluster was stopped after
verification. The manual fixture subsequently finished and closed. Its final
synthetic state is retained in [manual-stop-state.json](manual-stop-state.json).

No production persistence change was justified by this evidence. The manual
script now identifies the placeholder and the input below Reason explicitly,
requires verifying saved summary evidence before Inspector Resume, and provides
recovery steps for the current draft without a second API-restart Resume.
The next manual fixture launch checks the saved case A through the API before
restarting. Resume only advances when quantity 8, `quantity error`, and the exact
note `T02 quantity checked` are saved. Otherwise it pauses again without clearing
the input or restarting. This is a test-harness guard, not a production fix or a
new mandatory-evidence rule. The already running fixture predates this guard.

There is no demonstrated stock, journal, or posted-snapshot corruption in this
report. The stakeholder first authorized proceeding with other T02 cases if the
issue is noncritical, then explicitly requested T02 PASS and confirmed they had
finished the manual tests. That later decision accepts the checkpoint; it does
not prove this report was fixed. Keep it as a follow-up during subsequent work. A note
edited after opening the summary requires another Save/review before restart;
the report does not establish whether that was its cause. Do not treat the
passing reproduction as manual acceptance or conclude that the stakeholder
omitted the input without their confirmation.
