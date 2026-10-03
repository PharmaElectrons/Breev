# Manual defect — evidence-only Adjustment save after master edits

The stakeholder reported failure at Test 4, check C, step 8 (**Save draft and
leave**). The [original screenshot](manual-save-error.png) shows a generic
quantity/unit/money rejection and preserved unsaved work. This is a product
defect, not stakeholder entry error or professional policy approval.

The preceding manual stage changed current Keyboard Purchase packaging from
Pack/Strip 4:1 to Box/Tablet 6:1. `normalizeDraftRow` ran all copied rows through
current Catalog packaging/pricing even when only Adjustment evidence changed.
The original Pack no longer existed, so unchanged historical rows failed current
unit validation. The targeted regression additionally reproduced a 409
`pricing-mode-conflict` after a master pricing-mode change, proving the same
snapshot-ownership error in the same save path.

The bounded fix reuses saved snapshot facts for an unchanged row after checking
lineage/protected fields and current Product existence/availability. Actual row
quantity/cost/retail changes continue through the existing validator. This does
not approve a new correction policy, recalculate historical units/prices, alter
posted documents, or weaken version, permission, transaction or stock rules.

## Verification

- Reproduction failed as expected before the fix:
  `logs/t05-evidence-save-reproduction.log`.
- Four targeted PostgreSQL cases passed, 18 outside the selected scope:
  `logs/t05-save-fix-postgres.log`. They include saved evidence after master
  changes with unchanged row facts, persistence/reopen, rejected actual edits
  after mode drift, protected fields/unavailable Suppliers, percentage pricing
  Delta, and existing version/hash/retry behavior.
- Four browser cases passed, English/Arabic × light/dark, 40.4 seconds:
  `logs/t05-save-fix-browser.log`. Each now changes Product master units before
  evidence save-and-leave, verifies the saved evidence and old Strip row facts
  through the real API, and restores its task Product master afterward.
- API build/typecheck, Desktop browser-test typecheck, changed-file lint and
  formatting passed. The browser-test typecheck also caught the prior T05
  scaled-layout callbacks using DOM globals in a Node-only TypeScript project;
  these now use the suite's existing browser-evaluated source-string pattern.

## Focused manual retry

The original session on PostgreSQL 5554, open browser on renderer port 53373,
original posted invoice and active Adjustment draft remain preserved. Its old
API process has not been replaced; refreshing that window does not load this
server fix. No note was discarded or manually rewritten there.

A separate disposable retry session on loopback PostgreSQL 5555 is open with
the corrected API at the warning for `MANUAL-T05-SAVE-RETRY`. It reproduces the
same two-row 1,000 − 100 − 50 = 850 IQD invoice and subsequent Product/Supplier
master edits. It prepares `T05 navigation test note` without saving it, then
pauses for the stakeholder's click.

Session root:
`P:\Projects\PharmaElectrons\.scratch\runtime\t05-save-retry-1f68111d38064788a0cc1e756de6af4c`

1. Keep its Inspector paused; click **Save draft and leave** in the new Breev
   window's warning.
2. In Posted invoices, search `MANUAL-T05-SAVE-RETRY` and open it.
3. Click **Edit Invoice**, then **Continue draft** when prompted.
4. Check **Reason evidence** still contains `T05 navigation test note`.

Inspector Resume after that check verifies the API-saved note and historical row
facts and writes `saved-evidence-proof.json`, then pauses again. The proof file
is pending that operator action. The stakeholder then explicitly gave T05 PASS
and requested stop/handoff; see [the checkpoint](manual-checkpoint.md). This
does not establish execution of the optional proof stage. Other completed
checks need not be repeated merely because work resumes. T05 is accepted but
uncommitted; T06 and the full T05 pre-commit gate have not started.

