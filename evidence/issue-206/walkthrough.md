# One Phase 2 walkthrough — 10–15 minutes

Use the already-running [synthetic fixture](http://127.0.0.1:51892/#/purchases)
and [comparison gallery](http://127.0.0.1:51892/p2-comparison.html). Ports and
synthetic login details are recorded in [manual manifest](manual/manifest.json).
Every action below affects only disposable Phase 2 data. Keep the fixture running
for review; earlier manual databases remain intact.

1. **2 minutes — compare.** Review invoice/rail, Saved Drafts, Delta Summary,
   Return and Supplier pairs in the gallery. Note the written five-field order,
   320px rail, bounded 640px summaries and intentional authority/M3 exclusions.
2. **2 minutes — invoice.** Click **Saved drafts**, open **P2-MANUAL-DRAFT**.
   The saved row is **2 Pack = 8 Strip**. Its actions and Inventory units are
   reachable. Type barcode **5012345678949** in the entry row and press Enter:
   Quantity gets focus and the current item rail loads. On the saved row click
   Edit, the gear, then Done and Cancel; its saved values remain unchanged.
3. **3 minutes — Adjustment.** Click **Posted invoices**, search
   **P2-MANUAL-ADJUST**, press Enter and open it. Click **Edit Invoice**, keep
   **Quantity error**, then **Create adjustment copy**. Change the saved row quantity **4 → 8**.
   Click **Suppliers**: the warning opens with **Continue draft** focused. Press
   Enter to continue, then **Save and review Delta**. Delta Summary has Cancel focused;
   use Tab/Shift+Tab to cycle and Escape to return to Save and review Delta. Reopen,
   inspect **+4 Strip**, gross/allowance/net before/after and stock/Supplier facts.
   Explicitly click **Confirm and post Delta**. The original remains 4, with a linked
   correcting document. Return to the original, open that document, then Escape:
   focus returns to its link. (All money remains server-authoritative.)
4. **3 minutes — physical Return.** Open **P2-MANUAL-RETURN**, click **Purchase return**.
   Enter reason **Supplier accepted damaged goods**, evidence **P2 manual evidence**,
   and click **Create Purchase Return**. Enter return quantity **1**, then **Save and review physical return**.
   The bounded Summary focuses Cancel and shows carrying value **80 IQD**, Supplier
   adjustment **80 IQD**, and the difference pending G-01. Escape returns to Save
   and review; reopening clears the password. Enter the synthetic password from
   the manifest and click **Approve and post return**. Verify
   success and the immutable linked Return; Back/Escape restores the original.
5. **2 minutes — RTL/dark and nested focus.** Open Menu, select **العربية**;
   reopen **القائمة** and switch to dark theme. Open a new Adjustment/Return
   summary and use Tab/Shift+Tab: focus stays inside it. Escape returns to its
   opener in the correction. Click Back to original invoice to open the leave
   warning, then Enter on the focused Continue action to resume. The correction
   remains intact; only the current dialog is dismissed.
   Use the gallery's Arabic dark Return and nested-warning pair for comparison.
   Automated coverage already exercises every repeatable locale/theme variant.

If physical Narrator judgment is desired, read the dialog title, focused safe
action, error/status and direction; this walkthrough does not claim a completed
Narrator test. Record that separately. Give **one Phase 2 PASS/FAIL**, with any
failure's exact surface/state. No commit, push, PR, merge or Phase 3 precedes PASS.
