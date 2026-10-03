# T03 separate manual checkpoint

Status: **stakeholder PASS**, based on agent verification, 30 September 2026.
This is the prepared reference script; do not infer that the stakeholder personally
executed every step. See [acceptance record](manual-results.md). T02's accepted
checkpoint is not repeated.
Use only the headed synthetic T03 fixture. Nothing here targets live pharmacy data.
The initial list contains MANUAL-T03-A/B/C plus one outside invoice excluded by
search. Every original has one Keyboard Purchase row: quantity 4 strips, cost
80,000 fils (80 IQD), retail 120,000 fils, allowance 2.5%, debt context. Originals
remain gross 320 IQD, allowance 8 IQD, Cost After Discount 312 IQD throughout.

Fixture is opt-in `manual T03 Adjustment controls and totals in a disposable pharmacy`
in `apps/desktop/test/browser/purchasing.browser.test.ts`. The task runner is
`.scratch/runtime/t03-start-manual.ps1`. It creates a **new** PostgreSQL 18 cluster
on loopback port 5552; its exact path is saved in
`.scratch/runtime/m2-p1-t03-manual-cluster-path.txt`. The old T02 manual database
is retained and never reset. The Chromium page and Playwright Inspector are
interactive. Use Resume only at the checkpoints below; it is not a PASS button.

## A. Clean filtered navigation and complete controls

1. In Posted invoices, keep search `MANUAL-T03-`. Expect exactly three Purchase
   rows, newest C, then B, then A. The outside invoice must not appear.
2. Open C, then Edit Invoice. Before creating, quantity/cost/retail are read-only.
   Merely focusing a field must not create a draft or lose a first keystroke.
   Gross is 320, allowance percentage 2.5 and amount 8, discounted cost 312.
   Delta, offer, returned-row quantity, absent margin and special price say
   unavailable; none pretends to be numeric zero.
3. Previous is disabled on C. Next opens **B's original review**; open its
   Adjustment. Both directions are available. Next goes to A; Next is disabled
   there. Previous returns to B. Neither direction visits the outside invoice,
   a posted Adjustment or a Return.
4. Search returns to the same query/results and focuses Search. Back and the
   original-invoice badge return to that original invoice. Enter activates a
   focused button; no new shortcuts or row-entry behavior should appear.

## B. Dirty leave, New and protection of other Purchase work

1. Open B's Adjustment, select Quantity error, Create adjustment copy. Change
   quantity to 8 and type evidence `T03 checkpoint saved`. Editable values
   invalidate a previous preview; totals awaiting review say Save and review to
   calculate, not guessed amounts.
2. Exercise Back, original badge, Previous, Next, Search and Return separately.
   Each must offer Continue, Save draft and leave, and explicit Delete. Keep saved
   must be absent while changes are unsaved. Choose Continue each time; the
   quantity and evidence must remain. Escape dismisses the warning and restores
   focus to the action you used. Tab/Shift+Tab stay inside the warning.
3. Choose Search → Save draft and leave. Expect the same query/results and Search
   focus. Reopen B → Edit → Continue draft. Expect quantity 8 and exact evidence.
4. New invoice is available with a pristine Purchase workspace and creation
   permission. Try New → Save draft and leave: a blank Purchase workspace opens,
   and B's saved Adjustment remains available through search/Continue.
5. Type `T03 purchase work preserved` in the blank Purchase invoice-number field.
   Return to Posted invoices and B's Adjustment. New must be absent while that
   Purchase input exists. Return to Purchase invoice; the exact text must remain.
   Clear it deliberately afterward to restore the pristine workspace.
6. On B, leave a clean saved draft using Back → Keep saved draft and leave.
   Reopen/Continue: saved values must remain. Cancel Adjustment must offer explicit
   deletion, with Continue preserving work. Do **not** delete B before restart.

## C. Exact totals, editing, row removal and summary actions

1. Save and review B with quantity 8 and evidence `T03 checkpoint saved`.
   Expect the following authoritative comparison, with signs visible as text:

   | Fact                          | Before  | After   | Delta    |
   | ----------------------------- | ------- | ------- | -------- |
   | Primary Supplier Cost (gross) | 320 IQD | 640 IQD | +320 IQD |
   | Supplier allowance            | 8 IQD   | 16 IQD  | +8 IQD   |
   | Cost After Discount           | 312 IQD | 624 IQD | +312 IQD |

   Inventory: +4 base strips, +320 IQD value. Supplier payable change: +320 IQD,
   explicitly an effect of this invoice, not a Supplier balance. Offer unavailable
   is distinct from allowance and does not authorize a new offer rule.

2. Change only summary evidence. Confirm disables and Save/review guidance appears.
   Save again to bind the exact edited note. Restore and save the checkpoint note
   before proceeding to the restart step.
3. Summary Cancel or Escape returns to editing and focuses Save; it does not
   delete the draft. Tab/Shift+Tab contain focus in the summary. Resize to 1280×800
   and 1366×768, a narrow window, and 200% text; scroll the comparison and verify
   Cancel/Confirm remain usable. Confirm's amount label must say primary-cost
   Delta, not ambiguous net cost.
4. On **A**, create a separate copy and remove its row with the × action. Save
   focuses after removal. Review must show after totals **0 / 0 / 0**, gross Delta
   −320, allowance Delta −8, discounted Delta −312 and stock Delta −4. Real zeros
   must look different from unavailable. Cancel summary, then Cancel Adjustment
   → Delete to discard this demonstration. Do not Post it.
5. Optional price example on A: quantity 4, cost 100,000 fils, Price error yields
   gross 400, allowance 10, discounted 390; Deltas +80 / +2 / +78 IQD. The original
   remains 320 / 8 / 312. Discard that demonstration explicitly afterward.
6. Restore B to quantity 8 and exact evidence `T03 checkpoint saved`, then Save
   and review. **Press Inspector Resume once now.** The fixture independently
   checks those saved API facts before restarting the real API and reloading.
   If they are absent it pauses again without clearing the page. Continue B after
   restart and verify both values. This is persistence evidence, not a claimed
   explanation/fix of the earlier T02 note report.

## D. Return routing and bilingual/accessibility checks

1. From B's clean saved Adjustment choose Purchase return → Keep saved draft and
   leave. Expect **Purchase Return · goods physically leave stock** for B, not a
   generic Back operation. Return to original without creating/posting a Return;
   focus should land on its Return action. Reopen/Continue B: Adjustment survives.
2. Exercise five Reason options, editable Supplier/invoice number, quantity,
   cost and ByPrice retail; every change requires Save/review. Expiry, lot,
   Product/unit, pricing mode and unsupported facts remain protected. Do not
   encode an expiry change as a price or quantity change.
3. Change preferences to Arabic/RTL, then both themes. Labels, status, recovery,
   signs and amounts should remain understandable and visible. Restore checkpoint
   values if edited. Use keyboard and Narrator if available; errors and busy/saved/
   dirty states should be announced, and status must not depend only on color.
4. **Press Inspector Resume a second time.** This enables the clearly logged
   permission **presentation simulation** for Adjustment summary. It does not
   change a real account's role; real server authority is covered by integration
   tests.

## E. Denials and recovery

1. In B's Adjustment, Save/review during the permission simulation. Expect a
   localized access explanation, preserved draft/input and recovery guidance.
   Ordinary messages must not show UUIDs or raw codes. Support details starts
   closed; open it, copy the reference and check its success/unavailable message.
2. B's quantity/evidence remain. **Press Inspector Resume a third time** to remove
   the simulation. Save/review now succeeds.
3. Enter quantity `1.5` and Save/review. Expect a readable whole-unit/input
   refusal, no React crash and preserved text. Restore 8 and save.
4. For an optional offline check, use browser DevTools Network → Offline while
   editing B. Change evidence, Search → Save draft and leave. Expect an unavailable
   message, no navigation and retained input. Restore Online, Continue and save.
   Do not close the fixture or alter a service to simulate offline.
5. A stale/version refusal offers explicit Reload saved adjustment. Reload is
   deliberately destructive to **local unsaved edits**: use it only when accepting
   the saved authoritative version. A changed support reference must begin closed
   again. Session-ended guidance requests sign-in, rather than showing a code.

## F. Post, immutable review and completion

1. Confirm B's current quantity 8, exact evidence and totals from case C, then
   Post. Expect A01, exactly +4 stock units and +320 IQD primary/payable Delta;
   the 624 IQD informational discounted total must not become the posting basis.
2. Posted Back returns directly to the original; it must not demand discarding
   an already acknowledged Post. Original remains quantity 4 and 320 / 8 / 312.
   Open A01 and verify exact reason/evidence, before/after header and distinctly
   labelled primary-cost, allowance and discounted Deltas. Back returns focus to
   its linked document action.
3. Check any remaining visible control against the [inventory](README.md#control-inventory).
   No button should route to an unrelated operation or be permanently dead.
4. **Press Inspector Resume a fourth/final time** after finishing. This closes
   the interactive fixture; its lifecycle result alone does not award acceptance.
   Retain the task database and captures until results are recorded. Do not delete
   schemas/data or change original/posting facts to hide a failure.

Record any deviation with case, locale/theme, exact action and observed result.
The stakeholder replied **PASS** after accepting agent verification. The local
T03 commit gate follows that acceptance; T04 keeps its separate decision/checkpoint.
