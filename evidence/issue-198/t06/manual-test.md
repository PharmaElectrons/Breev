# T06 manual acceptance — presented test script

The stakeholder explicitly accepted T06 with PASS on 1 October 2026. See
[the acceptance record](manual-checkpoint.md). The original instructions below
are retained as the presented script; no repeat acceptance is requested.

Use the opened **Chromium** fixture and its **Playwright Inspector**. The page
is Purchases, invoice **MANUAL-T06-ENTRY**. Synthetic database **5556** is new;
older manual databases and test sessions remain retained. Do not Post this
entry invoice. The fixture's two stock invoices are already posted.

The Inspector's **Resume** button (▶) advances fixture stages. Resume is not
acceptance. Leave the final window open and report **T06 PASS** or **T06 FAIL**
in chat, describing the failing step. T06 will not be committed before PASS.

1. **Zero and missing values.** The initial selection is **T06 Zero**. Its
   barcode is **T060**. In Product Info, check **Total: 0 Strip**, **0 Pack /
   0 Strip**, **Current retail price: IQD 0.000**, and minimum **0**. Scientific
   name, category, wholesale and current average cost say **Not available**;
   maximum is unavailable. Consumption, days-of-supply and estimated surplus
   say **Not available in M2**. No Treatment day card appears. Scroll inside
   Product Info: **No on-hand batches** and **No posted Purchase cost reference**.
2. **Positive stock.** Click **Item / Barcode** in the empty entry row, replace
   the text with **T061**, and press **Enter**. Focus moves to **Quantity**.
   Product Info switches to **T06 Batches**, **2 Pack + 3 Strip**, **Total: 11
   Strip**, **1 Pack = 4 Strip**, minimum **2** and maximum **20 Strip**.
   Wholesale is a real **IQD 0.000**; retail **IQD 100.000**; current average
   cost **IQD 12.727 / Strip**. Scroll within the panel to read the rest.
3. **Batches and saved costs.** Find **T06-EXPIRED**: balance **8 Strip**, expiry
   **2026-09-29**, **−2 days remaining**, **Expired**. Find **T06-NEAR**: balance
   **3 Strip**, expiry **2026-10-15**, **14 days remaining**, **Near expiry**.
   The pharmacy business date is **2026-10-01**. Stock remains **11**, including
   the expired batch. **Last posted Purchase · saved row totals** shows **3
   Strip**, primary **IQD 60.000**, discounted **IQD 58.500**. These are saved
   row totals, distinct from current average cost.
4. **Keyboard and unchanged stock.** In the entry row, enter Quantity **2** →
   **Enter**; Primary cost **40000** → **Enter**; Selling price **100000** →
   **Enter**; Expiry **2029-06-30** → **Enter**. One row saves, and focus
   returns to Item / Barcode. Select **T061** again. Stock still totals **11**:
   a saved draft row has not posted inventory.
5. **Collapse, scrolling and Quick Product.** Collapse Product Info with its
   **×**, reopen using **Product Info**, and verify facts return. Use keyboard
   Tab to focus the panel body and scroll its facts with arrow/Page Down keys.
   In Item / Barcode, enter **T06 Unlisted** and press Enter. The existing
   **Quick Product creation** dialog opens. Click **Cancel**; no new Product
   should be created. Resize the window narrower: wholesale stays reachable
   in the panel band, entry/actions remain usable, and the page does not gain
   unintended horizontal overflow. Browser checks cover all four themes/locales.
6. **Actual hidden permissions.** Click Inspector **Resume** once. The fixture
   removes the synthetic owner's two cost-reading grants on the server,
   reloads the entry invoice and selects **T061**. Stock still reads **11**;
   **Current average cost** and **Last posted Purchase** say **Hidden by
   permission or setting**. Wholesale zero remains a Catalog price. The saved
   server proof contains null costs. Scroll the panel to verify both hidden
   fields, then Resume once to restore those grants.
7. **Slow panel and stale selections.** You are back at **T060**. Select
   **T061**. The panel says **Loading current item facts… Row entry remains
   available.** Quantity can still be edited immediately. Enter another row
   using the same values as step 4, at a normal pace. After five seconds the
   panel may show an unavailable/retry message; saving stays independent.
   Select **T060** again: its zero/missing facts appear, without the old stock
   or costs. Resume once to release the stale response and advance.
8. **Unavailable connection.** T061 is selected with its panel connection
   intentionally failed. This fault is injected only at the item-details read
   seam so Catalog/draft actions remain available. Read the localized
   **Item facts unavailable…** message. There must be no balance falsely
   displayed as zero. Click **Retry**: it remains unavailable while the fixture
   fault is active. Resume once to restore the healthy connection.
9. **Arabic/dark recovery.** The fixture reloads in Arabic and dark theme with
   T061 selected. Check RTL placement, readable Arabic unavailable/status text,
   real wholesale **٠٫٠٠٠ د.ع**, balance **١١**, physical units, and both batches.
   Scroll the panel, collapse/reopen it, and confirm row entry still works.
   Leave this final browser/Inspector open. Real Windows Narrator remains a
   separate physical-profile gate; automated axe is not its substitute.

Answer in chat: **T06 PASS** or **T06 FAIL — step N and what you saw**.
