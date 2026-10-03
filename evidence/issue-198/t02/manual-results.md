# T02 stakeholder manual acceptance

Date: 30 September 2026 (Africa/Cairo).

Status: **PASS — accepted by the stakeholder.**

The stakeholder instructed: “i need you to mark this as PASS and stop it”. They
then clarified: “i didn't stop that run for manual tests i finsied them so mark
them ok”. Record the manual checkpoint, including E/F, as completed and PASS on
that authority. Do not represent E/F as fully executed by Codex: computer use
began E, selected Other, created its draft, and focused the note; the stakeholder
completed the remaining manual work.

The manual process finished with exit code 0 and the proxy/worker closed. The
Playwright log's `1 passed (1.0h)` records the interactive fixture lifecycle; the
stakeholder's statement is the acceptance evidence.

Read-only inspection after closure saved the synthetic document facts in
[manual-stop-state.json](manual-stop-state.json):

- A: active Quantity error draft, quantity 8, evidence null, version 2; it is not
  posted in the retained database. This describes saved state, without overruling
  the stakeholder's completion/acceptance statement.
- B: A01, quantity Delta 0, cost Delta 80000 fils (80 IQD), stored reason Quantity
  error and evidence null. The browser/API inspection verified costs 80 → 100
  IQD, retail 120 → 125 IQD, original gross 320 IQD, allowance 8 IQD, original
  Cost After Discount 312 IQD. Financial facts are correct; the stored reason
  differs from the script's Price error, and the expected note is absent.
- C: A01, Supplier error, corrected Supplier Manual T02 Supplier B, quantity/cost
  Delta 0, evidence `the money is deducted and added successfully`.
- D: A01, Invoice-number error, corrected number MANUAL-T02-DUPLICATE,
  quantity/cost Delta 0, evidence null.
- E: A01, Other, quantity after 3, quantity Delta −1, cost Delta −80000 fils
  (−80 IQD), exact evidence `T02 documented quantity correction`.
- F: stakeholder-reported completion/PASS. No complete independent computer-use
  F execution was recorded in this chat. Existing focused automated evidence
  covers protected expiry and immutable navigation/reload behavior.

The [earlier evidence-note report](evidence-restart-investigation.md) remains
unresolved. Neither the manual acceptance nor the passing automated restart
tests establish its cause or a production fix. No immutable posted document was
rewritten to repair a reason or note. Keep the concern visible in follow-up work.

T02 source and evidence are still uncommitted. No push/PR/merge occurred here.
Before the accepted T02 commit, run the final verification gate and preserve the
unrelated startup/development-runner changes. T03 may follow that commit under
the original Phase 1 initiation, with its own separate manual checkpoint.
