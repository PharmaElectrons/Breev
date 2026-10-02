# T05 manual acceptance steps

Use the **new T05 browser window**, showing `MANUAL-T05-REVIEW`. It runs the
production Desktop renderer against the real local API and a fresh disposable
PostgreSQL cluster on loopback port 5554. It is not a packaged Electron test.
The separate T04 fixture/database remains retained.

Keep the Playwright Inspector paused while using Breev. **Resume** is a fixture
stage control, not acceptance. Report acceptance in this chat.

Before starting, refresh the T05 Breev page once (Ctrl+R) to load the final
candidate renderer. Save or cancel any active row edit before refreshing.

## 1. Review and Post the prepared invoice

1. Confirm the invoice name is `MANUAL-T05-REVIEW`, Supplier is `Manual T05
   Supplier 10 percent`, date is `2026-10-01`, and offer is 5%.
2. Inspect both saved rows. Their notes contain English and Arabic text. Use
   the row's Edit and optional-controls button to read the notes, then Cancel.
   The saved version/values must stay unchanged.
3. Confirm the following exact facts. Costs below are IQD; stored money is
   integer fils. Retail is per Inventory Unit.

| Row | Entry and conversion | Primary cost per entered unit | Line gross | Allowance share | Offer share | Discounted line cost | Retail |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Keyboard Purchase | 2 Pack × 4 = 8 Strip | 400 | 800 | 80 | 40 | 680 | 120 |
| Percentage Purchase | 2 Strip × 1 = 2 Strip | 100 | 200 | 20 | 10 | 170 | 125 (20% margin) |
| Total | 10 Inventory Units across two Products | — | 1,000 | 100 | 50 | 850 | — |

4. Click **Post purchase** explicitly. Open **Posted invoices**, search
   `MANUAL-T05-REVIEW`, and open that invoice.
5. Check both costs, original names, notes, lot `MANUAL-T05-A/B`, expiry
   `2029-06-30`, retail values and totals. Open **Saved row facts and references**.
   Check entered quantity/unit, 4:1 and 1:1 conversions, pricing modes, row
   allowance/offer, saved user identity and distinct batch/movement references.
6. There must be no direct posted-row edit/delete control. **Edit Invoice**
   opens a linked Adjustment; Purchase Return opens a separate linked document.

## 2. Test intentional correction on the separate draft

7. Open **Saved drafts → MANUAL-T05-CORRECTION**. This is independent of the
   posted invoice above.
8. **Test Cancel: try changing the first row, then throw away that change.**

   1. Find the first saved row, named **Keyboard Purchase**. Click its pencil
      icon (**Edit item**). Work on this saved row, not the empty new-item row.
   2. In that row's action buttons, click the **gear ⚙**. This opens
      **Optional row controls**.
   3. In **Correct saved row Product**, type `Percentage Purchase`. Wait for
      the result, then click the Product whose name starts with that text.
   4. In the **Unit** dropdown in the same popup, choose **Strip**.
   5. Click **Done** at the bottom of the popup. Done closes the popup; it
      does not save the row. Then click the row's **× Cancel** button, beside
      its **✓ Save** button. Do not use the popup's close button as Cancel.
   6. Check the saved first row: it must still say **Keyboard Purchase**,
      quantity **2 Pack**, converted quantity **8 Strip**. The totals remain
      **1,000 − 100 − 50 = 850 IQD**. Keyboard focus returns to its pencil
      button; there may be a visible focus outline.

9. **Test Save: change that same first row and keep the change.**

   1. Click the first row's **pencil**, then **gear ⚙** again.
   2. Search for and select **Percentage Purchase**, then choose **Strip** in
      **Unit**, exactly as above.
   3. While this popup is still open, set **Profit %** to `20`. Leave Lot and
      Notes unchanged. Click **Done** to close the popup.
   4. Back in the first row, replace **Quantity** with `3` and **Primary cost**
      with `100000`. This edit field currently takes fils: **100000 fils =
      100 IQD per Strip**. Type `100000`, without commas.
   5. Leave the locked selling-price field alone. It should show
      **Calculated on Save row** while the change is pending.
   6. Click that row's **✓ Save** button. This saves the row; do not click
      **Post purchase** for this test.
   7. Check the first row now says **Percentage Purchase**, quantity **3
      Strip**, converted quantity **3 Strip**, and retail **125 IQD per
      Strip**. There must still be two saved rows, and the second row must be
      unchanged. The first row's notes, lot and expiry must remain saved.
      Keyboard focus returns to its pencil button.
   8. Check this draft's totals: **500 IQD gross − 50 allowance − 25 offer =
      425 IQD discounted cost**. These changes affect only
      `MANUAL-T05-CORRECTION`; the posted `MANUAL-T05-REVIEW` stays unchanged.

## 3. Deliberately change masters and restart

10. Return to the posted `MANUAL-T05-REVIEW`, then click the Inspector's
    **Resume once**. The fixture first verifies that this invoice was posted.
    If not, it leaves the page/input intact and pauses again.
11. The fixture changes the original Keyboard Purchase master to
    `T05 Current Master Changed`, Inventory Unit `Tablet`, package `Box` with
    ratio 6:1, retail 250 IQD and wholesale 200 IQD. It changes the Supplier
    master name to `T05 Current Supplier Changed` and default allowance to 33%.
    It then restarts the real API and reloads the renderer.
12. Check the **historical invoice** still shows its saved old names, Pack/Strip,
    4:1 conversion, original quantities, notes, lot/expiry, retail 120/125 IQD
    and costs 1,000 − 100 − 50 = 850 IQD.
13. Use **Open current item record / Open current supplier record**. These
    separate current-record views must show the changed names. Back/Escape
    returns to the invoice and its opening control; historical values remain
    unchanged. The fixture also records a complete before/after API comparison.

## 4. Filters, navigation, dirty work and visibility

Do these small checks one at a time. Keep Inspector paused; no Resume is needed
for this section. The labels below are the English UI labels.

14. **Set up a filtered list.**

    1. Open **Posted invoices**. If an invoice is already open, click
       **Back to results**.
    2. Type `MANUAL-T05-` into the search box. Wait for the list to update.
    3. Click **Filters and order** and set the following:

       | Control | Value to choose/type |
       | --- | --- |
       | Date type | Invoice date |
       | From date | 2026-01-01 |
       | To date | 2026-12-31 |
       | Sort by | Purchase document |
       | Direction | Oldest first |

    4. Confirm the list shows the `MANUAL-T05-` test invoices. Leave those
       controls set while doing the next checks.

15. **Move between invoices.** Scroll down the list, then click an invoice
    whose Supplier invoice number starts `MANUAL-T05-NAV-`. Note its Purchase
    number (for example, `P10/2026`). Click **Next** and check that a different
    invoice from the filtered list opens. Click **Previous** to return. At the
    first or last available invoice, the unavailable direction should be
    disabled. Sorting follows numeric Purchase numbers, so P9 precedes P10.

16. **Check that coming back remembers your place.**

    1. On the open invoice, click **Open current item record** in a row.
    2. Close that current-record view using its Back control or Escape. The
       same historical invoice should return.
    3. Repeat with **Open current supplier record**, then return again.
    4. Click **Back to results**. Check the search text and all five filter
       values from step 14 remain. You should return near the same list scroll
       position, with the last viewed invoice selected and its opening button
       focused. A focus outline may be visible.

17. **Check that an unsaved note is protected when leaving an Adjustment.**

    The reported step-6 save rejection after master edits has been repaired.
    Use the [focused new retry window](evidence-save-defect.md#focused-manual-retry)
    for that failed save check; the original window still uses its older API.

    1. Open `MANUAL-T05-REVIEW` from the list and click **Edit Invoice**.
    2. Click **Create adjustment copy** if that button is shown. If a saved
       Adjustment already opens, continue with it.
    3. In **Reason evidence**, type `T05 navigation test note`. Leave invoice
       amounts and row quantities unchanged.
    4. Click **Search** inside the Adjustment. Expect a warning about leaving
       with unsaved changes.
    5. Press **Escape**. Expect to return to the Adjustment with the exact
       note still present.
    6. Click **Search** again, then **Save draft and leave** in the warning.
       Expect the posted-invoice list with your previous filters retained.
    7. Open the same original invoice and click **Edit Invoice** again. Check
       `T05 navigation test note` is still saved. Leave this Adjustment
       unposted; no T03 retest is required.

18. **Check that hiding costs also hides historical cost details.**

    1. Return from the Adjustment, then open **Saved drafts** and
       `MANUAL-T05-CORRECTION`.
    2. Above its item table, click **Columns and row flow**. Find the Cost
       column, labeled **Primary cost**, and untick its **Visible** checkbox.
       Click **Save entry settings**.
    3. Open **Posted invoices**, search `MANUAL-T05-REVIEW` and open it.
       Expand **Saved row facts and references**.
    4. Expect costs, allowance, offer amounts and Profit % to be hidden, with
       an explanation. Product names, quantities, notes, units and retail
       prices must remain visible.
    5. Return to the correction draft's **Columns and row flow**, tick
       **Primary cost → Visible**, and click **Save entry settings** again
       to restore costs. Permission-denied probes are automated; no role
       changes are needed for this manual check.

19. **Check language and theme readability.** Use the app's existing language
    and theme settings to view the invoice in English/light, English/dark,
    Arabic/light and Arabic/dark. Confirm notes and labels are readable, use
    horizontal table scrolling to reach off-screen columns, and press Tab to
    check that the focused control is visible. The automated checks also
    cover 1366×768, 1280×800, 1024×768 and 200% text.

Leave the final Inspector pause/browser open while reporting the result here.
Final Resume ends this synthetic session; it preserves its database and logs.

**Historical test script: T05 subsequently received explicit stakeholder PASS
after the evidence-save repair on 1 October 2026.** Do not repeat this acceptance
checkpoint merely because work resumes in another chat. T05 is not committed;
its full pre-commit gate and focused commit must precede T06.
G-01/G-02 and accountant/pharmacist/legal approval remain open.

