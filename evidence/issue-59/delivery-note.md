# Breev — Milestone 2 delivery note: Items, Purchases, and Inventory

**For:** the pharmacy owner and the pharmacy's accountant and pharmacist
**Build:** milestone 2 testable build, source commit `1d229d4`
**Recorded:** 19 September 2026
**Prepared by:** Breev engineering

> English is authoritative; the Arabic text is a courtesy rendering.
> النص الإنجليزي هو المرجع المعتمد، والنص العربي ترجمة مجاملة.

---

## 1. What this delivery is

This is the testable build for milestone 2, **Items, Purchases, and Inventory**, delivered for your review under the acceptance process in `docs/delivery.md`. Everything in this note was produced from one exact version of the software, source commit **`1d229d4`** — the assembled milestone (`e73b541`) plus the corrections described in section 6, every one of which this acceptance run itself found.

The build was checked in two ways. First, the whole milestone was run as the packaged Windows application on a Windows 11 Pro machine against a real database: the program file `Breev.exe` (fingerprint `da6d335bc983eb9fb5970e92d059f61fae9b7918183108de42e9844fde6bd35a`, application version 0.0.0) driving the local Breev service, over PostgreSQL 18.6. Every screen was operated by keyboard only. That single run was **40 tests across four passes**, producing **44 records with 344 recorded steps — 288 checks and 56 written measurements and notes — and no failure at all**, together with **80 screenshots**. The full record is `evidence/issue-59/acceptance/transcript.json`; every record carries the same run identifier and the same source commit, and each pass lists the flows it expects, none missing. Second, the automated safety and behaviour checks were re-run; their output is in `evidence/issue-59/seams/`. The full set of checks that runs on a clean copy of the source — code style, strict type checking, the build itself, and the unit, database and screen tests — is **green for this exact build** in our build service (run 35430669401). An earlier run of the same checks on the same build failed once, on a single server test that is sensitive to timing and has nothing to do with anything we changed; it passed on the re-run, and the detail is in `evidence/issue-59/README.md`.

**One honest point about the copy that was tested.** The program file used for this recorded run was built by our **development packaging route**, and two of its nine Windows protection switches are deliberately off in that route: the check that the application's packed code has not been altered, and the rule that the application may load code only from that packed file. The **setup program you would actually install turns both of them on** — proven by our build service in `evidence/issue-59/ci/windows-candidate-evidence-7dda434/candidates/0.0.0/electron-builder/fuses.json` and `…/0.0.1/electron-builder/fuses.json`, where the expected and actual settings match and the check passes. Those setup programs were built from the previous version of the source, `7dda434`; the equivalent build for this exact version was still running when this note was written, and the correction between the two changes only screen layout, nothing about how the program is packaged or protected. So please do not read this run as a test of a hardened copy: it tests the milestone's behaviour, while the hardening of the shipped copy is evidenced separately, and the complete Windows release evidence is a milestone 4 item.

Our build service also produced the Windows setup programs for two candidate versions (0.0.0 and 0.0.1) from a clean copy of the source. **These setup programs are unsigned: they are evidence that the packaging process works, not a signed release you should install in the pharmacy.** The record is `evidence/issue-59/ci/windows-candidate-evidence/candidates/packaging-results.json`, which shows the source was clean, that signing was not required for this run, and that each setup file is marked "NotSigned". Signing identity is a milestone 4 item.

**How to install and run a build.** The step-by-step instructions for installing the Main Pharmacy Computer, installing each Additional POS Terminal, and pairing them over your local network are in `docs/INSTALLATION_GUIDE.md`. Please follow that guide as written; this note does not repeat or replace it. For a developer-style local run instead of an installation, see `docs/running-locally.md`.

---

## 2. What the build contains

One line per item in the milestone 2 scope sentence in `docs/delivery.md`. Each line says only what the evidence in this bundle shows.

- **Medication and general-item definition, generated naming, and the Arabic search name.** You fill in an item's parts and Breev composes its name for you; the run defined the item whose composed name is exactly "Panadol Extra GSK", with an Arabic search name and a barcode. Editing a field regenerates the current name while the name stored inside an already-posted document stays frozen.
- **Ordered sequential smart search and barcodes.** Typing parts of a name in order finds the item, in Arabic or English, and scanning a barcode opens the item directly.
- **Whole-unit quantities with package conversion, no fractions.** An item has one Inventory Unit and larger packages that convert to it by a whole-number ratio; the run used 1 pack = 4 strips.
- **By Price and By Percentage pricing modes, with field locking and 250 / 500 / 1,000 rounding.** In By Percentage the selling price is calculated and the field is locked; in By Price you type the price. Rounding to 250, 500 or 1,000 IQD is applied only when that setting is switched on.
- **Retail and wholesale pricing.** The retail price is what the pricing mode sets. The wholesale price is stored as its own figure, is shown in the item-information panel during purchasing, and does not enter the margin calculation (`evidence/issue-59/seams/catalog-pricing.unit.txt`, and the panel records described below).
- **Suppliers with historical Allowance snapshots.** A supplier's Allowance percentage is kept as a dated history, and the percentage in force on the invoice date is copied into the invoice and never changes afterwards (`evidence/issue-59/seams/purchasing.integration.txt`).
- **Purchase invoices with an uninterrupted keyboard row flow.** The whole invoice — header, rows, posting — was entered by keyboard in the recorded run; the automated purchasing screen tests additionally cover entry by barcode scanner (`evidence/issue-59/seams/purchasing.browser.txt`).
- **Purchase Invoice Adjustments (Delta) and purchase returns.** A correction to a posted invoice moves only the difference; a separate Purchase Return is an alternative, and both stay linked to the original invoice.
- **Batches and expiry with FEFO and hard blocks.** Stock is held in Batches with their own expiry; the earliest expiry is offered first, and expired, recalled or quarantined stock is refused for sale.
- **The read-only inventory view.** Inventory shows the balance, the number of Batches, and the earliest expiry, and cannot be edited from that screen.
- **Quick stocktaking.** A count session accepts a mixed entry such as "2 packs + 1 strip", shows the conversion live, and compares it with the system balance.
- **Item colours and alerts.** Rows carry a state colour with matching words — the run recorded "Orange — attention needed", "Below minimum" and "At or below reorder point" — so the state is never carried by colour alone.
- **The reorder basket and Ordered Items.** Items can be added to the order basket from inventory and from the sales screen, and confirmed orders become Ordered Items that survive a restart (`evidence/issue-59/seams/inventory-reorder.integration.txt`, `basket.browser.txt`).
- **Purchase-invoice search and the item-information panel during purchasing.** Posted purchases are searched and reviewed by keyboard, and what you read back is the historical snapshot of the document, not today's master data. The panel, headed **"Item information"**, was recorded in its own flow: with all four fields switched on, scanning "Panel Detail Item" into a row showed scientific name **Paracetamol and Caffeine**, category **Analgesic**, packaging **Strip · Pack × 4**, and wholesale price **90000** (printed as the exact fils figure, the same in Arabic and English). The wholesale price appeared **in the panel only** — not in the entry row, not in the committed row, and not in the invoice review — and when the row was committed the panel returned to its empty state, **"No item selected. Pick an item from the invoice to see its details."** The panel was measured on screen inside the application's window in every language and theme. Evidence: `acceptance/transcript.json` records `scope-item-details-panel-en-light`, `-en-dark`, `-ar-light`, `-ar-dark`; screenshots `purchase-item-panel-<en|ar>-<light|dark>.png` with their `purchase-item-panel-full-page-*` companions. See sections 6 and 10.

---

## 3. The acceptance criterion, clause by clause

The contractual criterion for milestone 2, quoted exactly from `docs/delivery.md`:

> A user defines an item and finds it with the approved smart-search behavior, then enters and saves a supplier invoice with cost and price updated per the item's pricing mode. A purchase adjustment records only the difference, or the user creates a separate purchase return. Quantities, batches, and expiry appear correctly in inventory, stocktaking, and the reorder basket.

Each clause was run four times on the packaged build: English and Arabic, light and dark. All four passed in all four combinations.

| Clause                                                                                               | Result                                    | What was observed                                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Defines an item and finds it with the approved smart-search behaviour                             | pass — English and Arabic, light and dark | Composed name exactly "Panadol Extra GSK"; typing "panadol gs" returned "Panadol Extra GSK" as the first result                                                                                                                                                                        | `acceptance/transcript.json` records `clause-1-en-light`, `clause-1-en-dark`, `clause-1-ar-light`, `clause-1-ar-dark`; screenshots `clause-1-define-and-search-<en\|ar>-<light\|dark>.png` |
| 2. Enters and saves a supplier invoice with cost and price updated per the item's pricing mode       | pass — English and Arabic, light and dark | By Percentage row, cost 80,000 fils (80 IQD) at 20 % → locked selling price 100,000 fils (100 IQD). By Price row, typed 123,000 fils → the item's price read back as 123,000 fils. Invoice posted as document series P, sequence 5, year 2026, Primary Supplier Cost 140,000 fils      | `acceptance/transcript.json` records `clause-2-*`; screenshots `clause-2-supplier-invoice-<en\|ar>-<light\|dark>.png`                                                                      |
| 3. A purchase adjustment records only the difference, or the user creates a separate purchase return | pass — English and Arabic, light and dark | Adjustment dialog read "Adjusted Line Item: 4 → 8 (4) · 320000 fils"; the workspace stated "Unchanged lines create no stock or value effects."; the adjustment posted as P1-A01/2026; a separate Purchase Return posted as PR1/2026; both are linked from the original invoice P1/2026 | `acceptance/transcript.json` records `clause-3-*`; screenshots `clause-3-adjustment-difference-*` (with `-full-page` companions) and `clause-3-linked-return-*`                            |
| 4. Quantities, batches and expiry appear correctly in inventory, stocktaking, and the reorder basket | pass — English and Arabic, light and dark | Inventory row: balance 4 · batches 1 · earliest expiry 2029-05-31. Batch panel listed 2027-06-30 before 2029-12-31 (earliest expiry first). Reorder basket showed the item at 4 Strip against a 10 / 60 range, marked "Below minimum" and "At or below reorder point"                  | `acceptance/transcript.json` records `clause-4-*`; screenshots `clause-4-inventory-*`, `clause-4-batches-fefo-*`, `clause-4-basket-*`                                                      |

---

## 4. Your four acceptance scenarios

These are your own stated examples, quoted from `docs/quality.md`, re-run on this build. Each ran in English and Arabic, light and dark; each passed in all four.

### Search

> Search: "panadol gs" returns "Panadol Extra GSK"; "extra" returns every item containing "Extra"; Arabic, English, and barcode queries all match instantly.

Observed: "panadol gs" returned **Panadol Extra GSK**. "extra" returned exactly the three items whose names contain "Extra": **Cold Extra Relief, Panadol Extra GSK, Vitamin Extra Daily** — and nothing else. The Arabic search name **بنادول اكسترا** returned Panadol Extra GSK. Scanning barcode **5000167000101** opened the Panadol Extra GSK record.

On the word "instantly": every query matched **functionally**, which is what this run proves. Response time is a **provisional target** in `docs/quality.md` (product search, p95 ≤ 200 ms), confirmed or revised against certified hardware at the milestone 4 performance certification. This run did not measure speed, so we do not claim "instant" as proven. Evidence: `acceptance/transcript.json` records `scenario-search-*`; screenshots `scenario-search-<en|ar>-<light|dark>.png`; `seams/catalog-search.unit.txt`, `seams/catalog.integration.txt`.

### Margin

> Margin: cost 80 with a 20% margin yields a selling price of 100 before rounding (margin on selling price, not markup); rounding to 250/500/1,000 IQD applies only when enabled.

Observed, with rounding switched off: cost **80 IQD** at a **20 %** margin produced a locked selling price of **100 IQD** (80,000 fils → 100,000 fils). With rounding switched on, four cases were entered:

- cost **250 IQD** with rounding to the nearest **250** produced **250 IQD**;
- cost **300 IQD** with rounding to the nearest **250** produced **500 IQD**;
- cost **200 IQD** with rounding to the nearest **500** produced **500 IQD**;
- cost **400 IQD** with rounding to the nearest **1,000** produced **1,000 IQD**.

The first of those four is the one that carries your scenario cleanly. Cost 250 IQD at a 20 % margin is exactly **312.500 IQD** — a quarter of the way up a 250 step — so it rounds **down** to 250, and no rounding convention could move it. The other three land **exactly halfway** between two steps, so they also exercise the tie-breaking convention the build uses today (round half away from zero). **That tie convention is an engineering working default awaiting your accountant's approval under G-01; it is not an approved rule**, and it is one of the nine items listed in section 9.1. In By Percentage the price field stayed locked; in By Price the typed price was kept and became the item's price. Evidence: `acceptance/transcript.json` records `scenario-margin-*` and `clause-2-*`; screenshots `scenario-margin-<en|ar>-<light|dark>.png`; `seams/catalog-pricing.unit.txt`, `seams/purchase-price-capture.unit.txt`.

### Units

> Units: 1 pack = 4 strips — purchasing 1 pack records 4 strips in the base unit; a stocktake entry of "2 packs + 1 strip" converts to 9 strips at that ratio; no fractional base-unit balance ever posts.

Observed: purchasing **1 pack** recorded **4 Strip** in the Inventory Unit, and inventory then showed a balance of **4**. A stocktake entry of 2 packs and 1 strip showed the live caption **"2 Pack + 1 Strip = 9 Strip"** and committed as **9** against a system balance of **4**, a difference of **+5** pending application. Fractions were refused at both places they can be typed: a quantity of 1.5 packs on the purchase row was refused with **"Enter a positive whole quantity."**, and a count of 1.5 strips was refused with **"Use whole, non-negative numbers."** (in Arabic, «أدخل كمية صحيحة موجبة.» and «استخدم أعداداً صحيحة غير سالبة.»). The wider claim that no fraction can ever reach the balance is held by the automated conversion tests and by the whole-number columns in the database; this run proves the two places a person can type. The column that carries this scenario — the invoice row’s "Inventory Units" cell reading **4 Strip** — was also measured on screen: it sits at horizontal 890 to 1034 in English and 17 to 161 in Arabic, wholly inside the application’s window, on the row being typed and on the committed row alike, with nothing around it that scrolls. That is what section 6’s third correction was about. Evidence: `acceptance/transcript.json` records `scenario-units-*`; screenshots `scenario-units-<en|ar>-<light|dark>.png` with their `-full-page` companions; `seams/catalog-packaging.unit.txt`, `seams/inventory-count.integration.txt`.

### Purchase adjustment

> Purchase adjustment: changing a posted line quantity from 4 to 8 posts exactly +4; unchanged lines create no movements; an adjustment whose delta would break the balance or batch state is blocked.

Observed: after adjusting a posted line from 4 to 8, the adjusted item's movement history held **exactly one purchase-adjustment movement, of quantity 4**, and the unchanged line on the same invoice held **zero** adjustment movements. Read back through the application itself, the adjusted item's history showed the adjustment row "P1/2026-1 · Al-Nahrain Medical · Purchase adjustment · 4 · IQD 320.000", while the unchanged line's history showed only its original receipt, "P1/2026 · Al-Nahrain Medical · Purchase receipt · 2 · IQD 160.000" — no adjustment row at all. An invalid adjustment was then blocked: after a linked Purchase Return consumed 3 of 4 units, leaving 1 on the batch, an attempt to reduce that line from 4 to 1 was refused with **"This Delta is not valid against current stock. Resolve it through a stock count, a Purchase Return, or another correction, then retry."** The refusal was measured on screen inside the application's window in every pass (see section 6). That blocked state was reached entirely through the ordinary screens — no shortcut into the database. Evidence: `acceptance/transcript.json` records `scenario-adjustment-*` and `clause-3-*`; screenshots `scenario-adjustment-movements-*`, `scenario-adjustment-blocked-*` and their `-full-page` companions; `seams/purchase-adjustment-delta.unit.txt`, `seams/purchase-posting.integration.txt`.

---

## 5. Adding an item to the order basket from the sales screen

A Sale Draft was opened from the sales screen by keyboard, "panadol gs" was typed into its search, and **Panadol Extra GSK** was added to the order basket directly from the sales surface. The draft itself was then read back and was **unchanged — the same draft at Version 1**, exactly as before the basket action. This completes the scope line "adding items to the basket from inventory and sales". Evidence: `acceptance/transcript.json` records `reorder-from-sales-en-light`, `-en-dark`, `-ar-light`, `-ar-dark`; screenshots `reorder-from-sales-<en|ar>-<light|dark>.png`; `seams/sale-draft.integration.txt`, `seams/sales.browser.txt`.

---

## 6. Defects found by this acceptance run and fixed inside this milestone

The point of running the milestone on the packaged application, at the window size you would actually use, is to find what a test on a developer's wide screen would miss. It found three faults, all on the purchasing screen, and two more that our own first correction introduced. We are reporting all of them, because two of them meant an acceptance run genuinely failed: the run on the assembled build `e73b541` failed the scope item "the item-details panel in purchasing", and the next run, on `7dda434`, failed the subject of your own Units scenario.

**D1 — the item-information panel was off screen.** The panel that shows a selected item's details was being drawn beside the invoice row table, inside a workspace that was wider than the application's window and that never scrolled. At the application's default window size (1066 × 658), the populated panel sat at horizontal position **1459 in English and −656 in Arabic** — past the right edge one way, past the left edge the other — so in practice it was never visible. What you did see in the side area was a fixed **"No item selected"** placeholder that no part of the program ever filled. The scope line asks for the item-details side panel to appear in purchasing, and it did not.

**D2 — the refusal message for an invalid correction was not brought into view.** When a Delta adjustment was rightly refused, the refusal text was rendered but left outside the visible part of the dialog (vertical position −99, inside two nested scrolling areas) and did not take keyboard focus. The correction was correctly blocked; the person making it could simply not see why.

**D3 — the column showing "4 Strip" was behind the table's sideways scrollbar.** Your Units scenario says that purchasing 1 pack must record 4 strips in the base unit. The invoice row carries exactly that figure in its "Inventory Units" column — and at the application's default window size that column sat **entirely outside the window**, horizontal position 1389 to 1524 in English and −459 to −338 in Arabic, because the row table was 1507 pixels wide inside a 1018-pixel frame. The arithmetic was right; the cell that proves it to you was off screen unless you scrolled the table sideways, on the row being typed and on rows already committed. This was found only after we tightened our own check from "part of it is visible" to "all of it is visible" — and it was the honest result: that run **failed**.

**Two more faults that our first correction had introduced.** On wider windows the invoice row table collapsed to nothing, and then, after a first attempt at repairing that, it spilled over the sections below it. **Neither was caught by the automated tests, nor by the independent review — both were found by a person opening the screenshots the run had just produced.** We are telling you this rather than quietly fixing it, because it is the honest account of how the work went, and because the guard we added is now part of the build: an automated test that requires the sections of the purchasing screen never to overlap each other.

**All of these are defects of this milestone, not change requests.** `docs/delivery.md` defines a defect as "an implemented function that does not meet the approved written requirement or agreed acceptance outcome", and says that "corrections to reach compliance are included". Every one was fixed and re-run **inside milestone 2, at no change-request cost to you**, rather than being carried forward.

**The fixes.** Commit **`7dda434`**, "fix(purchasing): keep the item-details panel and correction refusals in view": the side panel is now the one item panel and is fed from the selected row; the purchase workspace no longer grows wider than the window; on narrower windows the panel becomes a band that stays in view as a long invoice scrolls; refusals in the adjustment and return workflows now scroll into view and take focus. Then commit **`1d229d4`**, "fix(purchasing): fit every invoice column in the window and keep sections stacked": the row table now gives each column a fixed share of the width, so all seven default columns fit at 1024, 1066 and 1280 pixels with no sideways scrolling at all, and the sections of the screen stack properly again. The table keeps a sideways scrollbar only as a safety net for people running Windows at very large text sizes. **Only screen files changed** — nothing in the server, the database, the accounting templates, or the saved data.

**How we proved it.** Automated screen tests now assert that the item panel is **visible and inside the window** at **1024 × 768, 1066 × 658, 1280 × 800 and 1366 × 768**, in Arabic and English, in both themes, with the accessibility scan clean; that the wholesale price still appears in the panel and nowhere else; that the panel stays in view on a twelve-row invoice; that a blocked Delta refusal and a refused Purchase Return are focused and in view while the draft is kept; that the "Inventory Units" cell is **wholly inside the window with the table having nowhere to scroll sideways**, at three window sizes in both languages and themes; and that the sections never overlap. The whole acceptance run was then repeated on the repackaged application at `1d229d4`: **all 40 tests passed in all four passes**, and the measurements are recorded rather than asserted in prose — the item panel at horizontal 0 to 1051, the refusal message at vertical 226, and the "Inventory Units" cell at horizontal **890 to 1034 in English and 17 to 161 in Arabic**, every one of them fully inside the 1066 × 658 window in **every** pass, with nothing around them that scrolls. Evidence: the `scope-item-details-panel-*`, `scenario-adjustment-*` and `scenario-units-*` records in `evidence/issue-59/acceptance/transcript.json`, their screenshots including the full-page companions, and `evidence/issue-59/seams/INDEX.md`. The **before** figures quoted above are kept in `evidence/issue-59/defects/D1-D3-pre-fix.md`, because repeating the run on each corrected build replaced the record that first showed them.

---

## 7. Safety checks re-run on this build

**Everything in a purchase saves together, or nothing saves.** When a failure was forced in the middle of posting a purchase — after the document number had already been taken, and again at the very last step — every earlier write was undone with it, leaving no half-finished document, no stray stock, and no unbalanced accounting entry; the taken number was recorded as a gap and reused by the retry. The same holds for a count session. Evidence: `evidence/issue-59/seams/purchase-posting.integration.txt`, `evidence/issue-59/seams/inventory-count.integration.txt`.

**A repeated attempt posts once, not twice.** When the same posting was sent again — the ordinary case of an unclear result or a timeout — it replayed the original outcome instead of creating a second document, a request that had changed was refused rather than quietly accepted, and when two attempts raced, exactly one of them posted. The reorder basket behaves the same way. Evidence: `evidence/issue-59/seams/purchase-posting.integration.txt`, `evidence/issue-59/seams/inventory-reorder.integration.txt`.

**A posted document cannot be changed afterwards.** Attempts to edit or delete a posted record were refused at the server, including attempts that bypassed the screens: posted product snapshots reject updates and deletes, completed count sessions and their movements and accounting entries are protected from change, posted purchase details read back as the historical snapshot rather than today's master data, and a Sale Draft cannot be deleted or have its fixed facts rewritten. Correction is always a new linked document. Evidence: `evidence/issue-59/seams/catalog.integration.txt`, `evidence/issue-59/seams/inventory-count.integration.txt`, `evidence/issue-59/seams/purchase-posting.integration.txt`, `evidence/issue-59/seams/sale-draft.integration.txt`.

**Stock cannot be pushed below what is actually there.** A correction whose difference would take a Batch below the stock left on it is refused: the acceptance run reproduced this through the ordinary screens (a Purchase Return consumed 3 of 4 units, then a reduction from 4 to 1 was blocked with the message quoted in section 4), and the automated purchase-posting checks pin the same refusal. Evidence: `evidence/issue-59/seams/purchase-posting.integration.txt`, `evidence/issue-59/acceptance/transcript.json`.

**Expired, recalled, or quarantined stock cannot be sold, and nobody can override it.** The refusal was tested across every role and every Step-Up Authorization state — a full matrix of role and state combinations — and the stock stayed refused in every one of them. There is no permission, no manager approval, and no setting that lets it through; the safety records themselves are append-only and cannot be edited or deleted. Evidence: `evidence/issue-59/seams/inventory-safety-no-override.integration.txt` (3 of 3 checks passed, including the full refusal matrix).

**One screen-level suite could only be run once the test machine was idle.** The batch-safety screen suite (`batch-safety.browser`) failed to start four times while a second automated run was using the same workstation: its test database service did not report itself ready inside the harness's fifteen-second allowance. Once the other run finished and the machine was free, the identical command **passed, 5 checks of 5, in 61 seconds**. This is a limit of the test workstation under load, not of the software; a control experiment with a second suite behaved the same way. Evidence: `evidence/issue-59/seams/INDEX.md`, `evidence/issue-59/seams/batch-safety.browser.txt` (the passing run), `batch-safety.browser-attempt1.txt` to `-attempt4.txt` (the loaded-host attempts), `host-load-control-inventory.browser-idle.txt`.

---

## 8. Arabic and English, both themes, keyboard only

Every flow above was run four times: in English with left-to-right layout and in Arabic with right-to-left layout, each in the light and the dark theme, on the packaged Windows application — 44 recorded flow results across the four passes, all passing, with no failed step anywhere. The language and theme were switched from the application's own header buttons using the keyboard, and the application reported the expected language, direction and theme each time. **Every step was performed by keyboard alone, without exception**: all date entries in each pass accepted a typed key sequence, so even the Windows date controls were reached and filled from the keyboard. An automated accessibility scan ran on every screen in every language and theme and reported **zero violations** each time. Evidence: `evidence/issue-59/acceptance/transcript.json` (the `bilingual-*` records and the accessibility step of every other record), and the 80 screenshots in `evidence/issue-59/acceptance/`.

---

## 9. What is NOT approved, and what we need from you

**Please read this section first if you read nothing else.** Three decisions belong to you and your professionals, not to us. None of them has been supplied. Until they arrive, the build runs on **working defaults** — our engineering choices, chosen so they can be changed in one named place. **No working default in this build is an approved rule, and we do not present any of them as one.**

### 9.1 Accountant approval — gate G-01, milestone 2 portion — OPEN

Your accountant is asked to look at nine items and either confirm each figure or give us the correct one. In plain words:

1. How inventory value is averaged, and on which cost figure — today it averages on the Primary Supplier Cost, the full cost before the Allowance.
2. The accounting entry a purchase invoice creates.
3. The accounting entry a Purchase Invoice Adjustment creates.
4. How a Purchase Return is recorded when the value coming out of inventory differs from the value credited by the supplier.
5. How a stocktake difference is recorded.
6. How the supplier Allowance is snapshotted onto an invoice and spread across its lines.
7. How the "difference only" of an adjustment is worked out.
8. The rounding rule — including the tie-breaking convention seen in section 4's margin cases — and how a leftover fil is allocated.
9. Whether the margin is taken on the selling price (as the build does) and the 250 / 500 / 1,000 price-rounding steps.

Every item, with the exact figures the build produces today, worked examples as journal lines, and the file an engineer changes if your accountant's answer differs, is in **`evidence/issue-59/gates/G-01-working-defaults.md`**. Its status line reads: OPEN — awaiting accountant approval.

### 9.2 Pharmacist approval — gate G-02, milestone 2 portion — OPEN

Your pharmacist is asked to confirm or correct nine items. In plain words:

1. The four product classes the build sorts stock into: medication, cold-chain medication, cold-chain general item, plain general item.
2. Which of those must have a complete expiry date recorded when goods are received — today, all except the plain general item.
3. Which must have a lot number recorded — today, only cold-chain medication.
4. The near-expiry warning period — today, 90 days for all four classes; it can be set per class between 1 and 730 days.
5. Whether each pharmacy may hold its own copy of these rules.
6. What should happen when required receipt information is missing.
7. The kinds of hold that can be placed on a Batch (expired, recalled, quarantined) and who may place them — today, the owner, manager and pharmacist may set recall and quarantine, and only the daily automatic check marks stock expired.
8. The rule for correcting an expiry date entered in error — today it needs the permission, immediate reauthentication, a written reason and written evidence, and it keeps the original date.
9. The daily re-check and the monthly review of expired and held stock.

Every item, with the exact rules and thresholds the build applies today and what an engineer changes for each answer, is in **`evidence/issue-59/gates/G-02-working-defaults.md`**. Its status line reads: OPEN — awaiting pharmacist approval.

### 9.3 Your decision on a duplicate supplier invoice number — OPEN

When the same supplier invoice number is entered twice for the same supplier, the recorded decision asks you to choose one of two outcomes: **block** the second document, or **allow it after a warning that requires a specific permission to pass**.

**The build today does neither.** It shows a warning and lets the user continue — at draft save and again at posting — with no permission required and nothing refused. This is a working default and it is **not approved**; the application says so in both languages on screen ("Current rule: warn. The duplicate-number rule still awaits milestone approval."). The full record, including what changes under each of your two options, is **`evidence/issue-59/gates/duplicate-supplier-invoice-number.md`**. This decision is re-verified again before the release candidate.

### 9.4 What this means for the schedule and for this milestone

- Under the schedule protection rule in the approved scope (§13.5), **days spent waiting for these approvals do not count as developer delay: the milestone schedule is paused while they are outstanding.**
- **GitHub issue #59 stays open** until the approvals arrive, are applied to the build, and the affected tests and scenarios are re-run.
- **If an approved value differs from what the build does today, that is a defect of this milestone.** We change it, re-run the affected tests and scenarios, and record both — inside this milestone, at no change-request cost to you, and never carried forward as later work. Section 6 is what that promise looks like in practice.
- Signed approval documents are filed in `evidence/issue-59/gates/approvals/`, which is empty today. The forms inside the two gate files are worksheets for collecting your professionals' answers; filling one in here is not itself an approval.

---

## 10. Observations that are not defects

**Where the wholesale price is shown is still an open choice.** The run confirmed that the wholesale price appears in the item-information panel during purchasing and nowhere else on that screen. That placement follows the working default recorded in `docs/open-decisions.md` under "Wholesale/special price selection"; **how the wholesale price is selected during a sale — by quantity threshold or by permission — is still your decision to make**, and it belongs to the sales work in milestone 3. We record the current placement as a working default, not as a settled rule.

**Arabic digits are shaped differently on two screens.** In Arabic, the purchase entry row prints the converted quantity as "4 Strip", while the inventory view and the stocktake caption print the same quantity with Arabic-Indic digits ("٤", "٢ Pack + ١ Strip = ٩ Strip"). **The quantity is identical either way** — only the shape of the numerals differs between those surfaces. The same split shows in amounts: the item-information panel prints the wholesale price as the plain figure "90000" in both languages, while inventory formats amounts for the language. We have recorded it rather than changed it, because which form you prefer is your call. Please tell us in your consolidated feedback which you want, and we will make the surfaces match.

**The expiry date box shows an English date hint on the Arabic screen.** When you type an expiry date on a purchase row, the empty box shows Windows' own hint for the date format — `mm/dd/yyyy` — and it stays in English even when the rest of the screen is in Arabic, because it comes from the operating system's date control rather than from Breev. It does not change the date you enter or how it is stored. This is not new in this milestone and it is not one of the faults in section 6; we raise it here so you can tell us in your consolidated feedback whether you want it changed.

**The five-invoice Allowance example is pinned only as far as this milestone reaches.** Your mandatory example runs: Primary Supplier Cost 5,000 → Cost After Discount 4,650 → paid 4,500 → actual Allowance 500 → Allowance difference 150 → zero supplier balance. The first two figures, **5,000 and 4,650**, are pinned by this build and reproduced by its automated test. The rest — the payment of 4,500, the actual Allowance of 500, the difference of 150, and the balance reaching zero — belong to supplier settlement, which is **milestone 3** scope and is not present in this build. We record that as scope boundary, not as a gap in milestone 2. Detail: `evidence/issue-59/gates/G-01-working-defaults.md`, section 4.

---

## 11. Your review

Under the acceptance process in `docs/delivery.md`, please review this build within **three business days** and send **one consolidated list** of any deviations from the approved scope.

Two things help most:

1. Your accountant's and pharmacist's answers to sections 9.1 and 9.2, and your own answer to 9.3. They are what this milestone is waiting on.
2. Anything in the build that does not match the approved written scope. A correction needed to bring a function into line with the approved scope is included in this milestone, as section 6 shows. A preference, a flow change, or another screen, report or integration is a change request with its own written approval, price and timeline.

---

## النسخة العربية

> النص الإنجليزي هو المرجع المعتمد، والنص العربي ترجمة مجاملة.
> English is authoritative; the Arabic text is a courtesy rendering.

**إلى:** صاحب الصيدلية ومحاسب الصيدلية والصيدلاني
**النسخة:** النسخة القابلة للاختبار للمرحلة الثانية، إصدار المصدر `1d229d4`
**تاريخ التسجيل:** ١٩ أيلول/سبتمبر ٢٠٢٦

### ١. ما هذا التسليم

هذه هي النسخة القابلة للاختبار للمرحلة الثانية — **الأصناف والمشتريات والمخزون** — مقدَّمة لمراجعتكم وفق آلية القبول في `docs/delivery.md`. وكل ما ورد في هذه المذكرة أُنتج من نسخة واحدة محددة من البرنامج، هي إصدار المصدر **`1d229d4`**: المرحلة المجمَّعة (`e73b541`) مضافاً إليها التصحيحات الموصوفة في القسم ٦، وكلها كشفها تشغيل القبول نفسه.

جرى التحقق بطريقتين. الأولى: تشغيل المرحلة كاملة على **تطبيق ويندوز المحزَّم** على جهاز Windows 11 Pro مقابل قاعدة بيانات حقيقية — الملف التنفيذي `Breev.exe` (بصمة `da6d335bc983eb9fb5970e92d059f61fae9b7918183108de42e9844fde6bd35a`، إصدار التطبيق 0.0.0) مع خدمة Breev المحلية، فوق PostgreSQL 18.6، وبلوحة المفاتيح وحدها. وكان ذلك التشغيل الواحد **٤٠ اختباراً في أربع مرورات** أنتجت **٤٤ سجلاً بـ٣٤٤ خطوة مسجَّلة — ٢٨٨ فحصاً و٥٦ قياساً وملاحظة مكتوبة — دون أي إخفاق**، ومعها **٨٠ صورة شاشة**. والسجل الكامل في `evidence/issue-59/acceptance/transcript.json`، ويحمل كل سجل معرّف التشغيل نفسه وإصدار المصدر نفسه، ويحمل كل مرور قائمة بالتدفقات المتوقعة فيه ولا ينقص منها شيء. والثانية: إعادة تشغيل الفحوص الآلية للسلوك والسلامة، ومخرجاتها في `evidence/issue-59/seams/`. أما مجموعة الفحوص الكاملة التي تعمل على نسخة نظيفة من المصدر — تنسيق الشيفرة، والتحقق الصارم من الأنواع، والبناء نفسه، واختبارات الوحدة وقاعدة البيانات والشاشات — فهي **ناجحة لهذه النسخة بالتحديد** في خدمة البناء لدينا (التشغيل رقم 35430669401). وكان تشغيل سابق للفحوص نفسها على النسخة نفسها قد أخفق مرة واحدة في اختبار خادم واحد حسّاس للتوقيت لا علاقة له بأي شيء غيّرناه، ثم نجح عند إعادة التشغيل، والتفصيل في `evidence/issue-59/README.md`.

**نقطة واحدة تُقال بصراحة عن النسخة التي اختُبرت.** الملف التنفيذي المستخدم في هذا التشغيل بُني عبر **مسار التحزيم التطويري**، واثنان من مفاتيح الحماية التسعة في ويندوز مُطفآن عمداً في ذلك المسار: التحقق من أن شيفرة التطبيق المحزَّمة لم تُعدَّل، وقاعدة ألّا يحمِّل التطبيق شيفرة إلا من ذلك الملف المحزَّم. أما **برنامج التنصيب الذي ستنصّبونه فعلاً فيُشغّل كليهما** — وهذا مثبت من خدمة البناء لدينا في `evidence/issue-59/ci/windows-candidate-evidence-7dda434/candidates/0.0.0/electron-builder/fuses.json` و`…/0.0.1/electron-builder/fuses.json`، حيث تتطابق القيم المتوقعة مع الفعلية ويمرّ الفحص. وقد بُنيت برامج التنصيب تلك من النسخة السابقة من المصدر `7dda434`؛ أما البناء المقابل لهذه النسخة بالتحديد فكان ما يزال قيد التشغيل وقت كتابة هذه المذكرة، والتصحيح بين النسختين لا يغيّر إلا تخطيط الشاشة، ولا يمسّ طريقة تحزيم البرنامج ولا حمايته. فالرجاء ألّا يُقرأ هذا التشغيل على أنه اختبار لنسخة مُصلَّدة: هو اختبار لسلوك المرحلة، بينما تصليد النسخة المُسلَّمة يثبته دليل منفصل، ودليل إصدار ويندوز الكامل بند من بنود المرحلة الرابعة.

كما أنتجت خدمة البناء لدينا **برامج تنصيب ويندوز** لنسختين مرشحتين (0.0.0 و0.0.1) من نسخة مصدر نظيفة. **هذه الملفات غير موقَّعة رقمياً: هي دليل على أن مسار التحزيم يعمل، وليست إصداراً موقَّعاً يُنصَّب في الصيدلية.** السجل في `evidence/issue-59/ci/windows-candidate-evidence/candidates/packaging-results.json`، ويُظهر أن المصدر كان نظيفاً، وأن التوقيع لم يكن مطلوباً في هذا التشغيل، وأن كل ملف تنصيب مُعلَّم «غير موقَّع». هوية التوقيع بند من بنود المرحلة الرابعة.

**كيفية التنصيب والتشغيل:** خطوات تنصيب الحاسوب الرئيسي للصيدلية، وتنصيب كل نقطة بيع إضافية، وإقرانها عبر الشبكة المحلية، موجودة في `docs/INSTALLATION_GUIDE.md`. يُرجى اتباع ذلك الدليل كما هو؛ وهذه المذكرة لا تكرره ولا تحل محله. وللتشغيل المحلي لأغراض التطوير راجع `docs/running-locally.md`.

### ٢. ما تحتويه هذه النسخة

سطر واحد لكل بند من بنود نطاق المرحلة الثانية في `docs/delivery.md`، ولا يذكر كل سطر إلا ما تُظهره الأدلة في هذه الحزمة.

- **تعريف الأدوية والأصناف العامة، وتوليد الاسم، واسم البحث العربي.** تُدخِلون مكوّنات الصنف فيؤلّف Breev اسمه؛ وقد عرّف التشغيل الصنف الذي اسمه المؤلَّف هو تماماً «Panadol Extra GSK»، مع اسم بحث عربي وباركود. وتعديل حقل يعيد توليد الاسم الحالي بينما يبقى الاسم المحفوظ داخل مستند مُرحَّل مجمَّداً.
- **البحث الذكي المتسلسل والباركود.** كتابة أجزاء الاسم بترتيبها تجد الصنف، بالعربية أو الإنجليزية، ومسح الباركود يفتح الصنف مباشرة.
- **كميات بأعداد صحيحة مع تحويل العبوات، دون كسور.** لكل صنف وحدة مخزون واحدة وعبوات أكبر تتحول إليها بنسبة عدد صحيح؛ واستُخدم في التشغيل: ١ علبة = ٤ شرائط.
- **نمطا التسعير «بالسعر» و«بالنسبة»، مع قفل الحقول والتقريب إلى ٢٥٠ و٥٠٠ و١٠٠٠.** في نمط النسبة يُحتسب سعر البيع ويُقفل حقله، وفي نمط السعر تكتبونه أنتم. ولا يُطبَّق التقريب إلى ٢٥٠ أو ٥٠٠ أو ١٠٠٠ دينار إلا عند تفعيله.
- **سعر المفرد وسعر الجملة.** سعر المفرد هو ما يحدده نمط التسعير، أما سعر الجملة فيُخزَّن رقماً مستقلاً ويظهر في لوحة معلومات الصنف أثناء الشراء، ولا يدخل في حساب هامش الربح (`evidence/issue-59/seams/catalog-pricing.unit.txt`، ومعه سجلات اللوحة المذكورة أدناه).
- **الموردون مع لقطات السماح التاريخية.** تُحفظ نسبة السماح للمورد كسجل مؤرَّخ، وتُنسَخ النسبة السارية بتاريخ الفاتورة داخل الفاتورة ولا تتغير بعدها (`evidence/issue-59/seams/purchasing.integration.txt`).
- **فواتير الشراء بتدفق إدخال متصل بلوحة المفاتيح.** أُدخلت الفاتورة كاملة — الترويسة والأسطر والترحيل — بلوحة المفاتيح في التشغيل المسجَّل، وتغطي اختبارات شاشة المشتريات الآلية الإدخال بقارئ الباركود أيضاً (`evidence/issue-59/seams/purchasing.browser.txt`).
- **تعديلات فواتير الشراء (بالفرق) ومردودات الشراء.** التصحيح على فاتورة مُرحَّلة يحرّك الفرق وحده؛ ومردود الشراء المستقل بديل عنه، ويبقى كلاهما مرتبطاً بالفاتورة الأصلية.
- **الدفعات وتواريخ الانتهاء مع الصرف بالأقرب انتهاءً والمنع القاطع.** يُحفظ المخزون في دفعات لكل منها تاريخ انتهاء، ويُقدَّم الأقرب انتهاءً أولاً، ويُرفض بيع المخزون المنتهي أو المسحوب أو المحجوز.
- **شاشة المخزون للقراءة فقط.** تعرض الرصيد وعدد الدفعات وأقرب تاريخ انتهاء، ولا تُعدَّل منها البيانات.
- **الجرد السريع.** تقبل جلسة الجرد إدخالاً مختلط الوحدات مثل «٢ علبة + ١ شريط»، وتعرض التحويل مباشرة، وتقارنه برصيد النظام.
- **ألوان الأصناف والتنبيهات.** تحمل الأسطر لون حالة مصحوباً بنص مطابق — وسجّل التشغيل «برتقالي — يحتاج انتباهاً» و«دون الحد الأدنى» و«عند نقطة إعادة الطلب أو دونها» — فلا تُنقَل الحالة باللون وحده.
- **سلة إعادة الطلب والأصناف المطلوبة.** تُضاف الأصناف إلى السلة من المخزون ومن شاشة المبيعات، وتصبح الطلبات المؤكدة أصنافاً مطلوبة تبقى بعد إعادة التشغيل (`evidence/issue-59/seams/inventory-reorder.integration.txt`، `basket.browser.txt`).
- **البحث في فواتير الشراء ولوحة معلومات الصنف أثناء الشراء.** يجري البحث في المشتريات المُرحَّلة ومراجعتها بلوحة المفاتيح، وما يُقرأ هو اللقطة التاريخية للمستند لا البيانات الرئيسية الحالية. وسُجّلت اللوحة، وعنوانها **«Item information» (معلومات الصنف)**، في تدفق خاص بها: بتفعيل الحقول الأربعة، أظهر مسح الصنف «Panel Detail Item» داخل السطر الاسم العلمي **Paracetamol and Caffeine** والفئة **Analgesic** والتعبئة **Strip · Pack × 4** وسعر الجملة **90000** (مطبوعاً بالرقم الفلسي الدقيق نفسه في العربية والإنجليزية). وظهر سعر الجملة **في اللوحة وحدها** — لا في سطر الإدخال، ولا في السطر المُثبَّت، ولا في مراجعة الفاتورة — وعند تثبيت السطر عادت اللوحة إلى حالتها الفارغة: **«No item selected. Pick an item from the invoice to see its details.»**. وقِيست اللوحة على الشاشة داخل نافذة التطبيق في كل لغة وسمة. الدليل: سجلات `scope-item-details-panel-*` وصور `purchase-item-panel-*.png` ومعها نسخ `purchase-item-panel-full-page-*`. وانظر القسمين ٦ و١٠.

### ٣. معيار القبول، بنداً بنداً

المعيار التعاقدي للمرحلة الثانية، منقولاً حرفياً من `docs/delivery.md`:

> A user defines an item and finds it with the approved smart-search behavior, then enters and saves a supplier invoice with cost and price updated per the item's pricing mode. A purchase adjustment records only the difference, or the user creates a separate purchase return. Quantities, batches, and expiry appear correctly in inventory, stocktaking, and the reorder basket.

نُفِّذ كل بند أربع مرات على النسخة المحزَّمة: بالإنجليزية والعربية، في السمة الفاتحة والداكنة. ونجحت البنود الأربعة في الحالات الأربع كلها.

| البند                                                                        | النتيجة                          | ما لوحظ                                                                                                                                                                                                                                  | الدليل                                                                                                       |
| ---------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ١. تعريف صنف وإيجاده بسلوك البحث الذكي المعتمد                               | ناجح — عربي وإنجليزي، فاتح وداكن | الاسم المؤلَّف «Panadol Extra GSK» تماماً؛ وكتابة «panadol gs» أعادته أول نتيجة                                                                                                                                                          | سجلات `clause-1-*` في `acceptance/transcript.json` وصور `clause-1-define-and-search-*.png`                   |
| ٢. إدخال فاتورة مورد وحفظها مع تحديث الكلفة والسعر حسب نمط تسعير الصنف       | ناجح — عربي وإنجليزي، فاتح وداكن | سطر بالنسبة: كلفة ٨٠٫٠٠٠ فلس (٨٠ ديناراً) بهامش ٢٠٪ ← سعر بيع مقفل ١٠٠٫٠٠٠ فلس. سطر بالسعر: كُتب ١٢٣٫٠٠٠ فلس فصار سعر الصنف ١٢٣٫٠٠٠ فلس. ورُحِّلت الفاتورة بالسلسلة P تسلسل ٥ سنة ٢٠٢٦، كلفة أساسية ١٤٠٫٠٠٠ فلس                          | سجلات `clause-2-*` وصور `clause-2-supplier-invoice-*.png`                                                    |
| ٣. التعديل يسجل الفرق وحده، أو ينشئ المستخدم مردود شراء مستقلاً              | ناجح — عربي وإنجليزي، فاتح وداكن | نافذة التعديل أظهرت «Adjusted Line Item: 4 → 8 (4) · 320000 fils»، ونصّت الشاشة «الأسطر التي لم تتغير لا تنشئ حركة مخزون أو أثر قيمة.»؛ ورُحِّل التعديل برقم P1-A01/2026 والمردود المستقل برقم PR1/2026، وكلاهما مرتبط بالفاتورة P1/2026 | سجلات `clause-3-*` وصور `clause-3-adjustment-difference-*` (مع نسخ `-full-page`) و`clause-3-linked-return-*` |
| ٤. ظهور الكميات والدفعات وتواريخ الانتهاء في المخزون والجرد وسلة إعادة الطلب | ناجح — عربي وإنجليزي، فاتح وداكن | سطر المخزون: رصيد ٤ · دفعات ١ · أقرب انتهاء 2029-05-31. ولوحة الدفعات رتّبت 2027-06-30 قبل 2029-12-31. وأظهرت السلة الصنف بـ٤ شرائط ضمن مدى ١٠/٦٠ مع «دون الحد الأدنى» و«عند نقطة إعادة الطلب أو دونها»                                  | سجلات `clause-4-*` وصور `clause-4-inventory-*` و`clause-4-batches-fefo-*` و`clause-4-basket-*`               |

### ٤. سيناريوهات القبول الأربعة

هذه أمثلتكم أنتم، منقولة من `docs/quality.md`، أُعيد تشغيلها على هذه النسخة. نُفِّذ كل سيناريو بالعربية والإنجليزية في السمتين، ونجح في الحالات الأربع.

**البحث.** «panadol gs» أعادت **Panadol Extra GSK**. و«extra» أعادت الأصناف الثلاثة التي تحتوي «Extra» وحدها: **Cold Extra Relief، Panadol Extra GSK، Vitamin Extra Daily**. واسم البحث العربي **بنادول اكسترا** أعاد Panadol Extra GSK. ومسح الباركود **5000167000101** فتح سجل Panadol Extra GSK. أما كلمة «فوراً» في نص السيناريو فما يثبته هذا التشغيل هو **المطابقة الوظيفية**؛ وزمن الاستجابة **هدف مبدئي** في `docs/quality.md` (بحث الأصناف، p95 ≤ ٢٠٠ مللي ثانية) يُثبَّت أو يُعدَّل عند اعتماد الأداء في المرحلة الرابعة، ولم يقِس هذا التشغيل السرعة فلا ندّعيها مثبتة.

**هامش الربح.** بلا تقريب: كلفة **٨٠ ديناراً** بهامش **٢٠٪** أعطت سعر بيع مقفلاً **١٠٠ دينار**. ومع تفعيل التقريب أُدخلت أربع حالات: كلفة **٢٥٠** بتقريب إلى **٢٥٠** أعطت **٢٥٠**؛ وكلفة **٣٠٠** بتقريب إلى **٢٥٠** أعطت **٥٠٠**؛ وكلفة **٢٠٠** بتقريب إلى **٥٠٠** أعطت **٥٠٠**؛ وكلفة **٤٠٠** بتقريب إلى **١٠٠٠** أعطت **١٠٠٠**. والحالة الأولى هي التي تحمل سيناريوكم بوضوح: كلفة ٢٥٠ ديناراً بهامش ٢٠٪ تساوي بالضبط **٣١٢٫٥٠٠ دينار** — أي ربع المسافة في خطوة الـ٢٥٠ — فتُقرَّب **نزولاً** إلى ٢٥٠، ولا يمكن لأي قاعدة تعادل أن تغيّرها. أما الحالات الثلاث الأخرى فتقع **في منتصف المسافة تماماً** بين خطوتين، فتُظهر معها قاعدة حسم التعادل التي تستعملها النسخة اليوم (التقريب لنصف بعيداً عن الصفر). **وهذه القاعدة قاعدة عمل هندسية بانتظار اعتماد محاسبكم ضمن البوابة G-01، وليست قاعدة معتمدة**، وهي أحد البنود التسعة في القسم ٩٫١. وفي نمط النسبة بقي حقل السعر مقفلاً، وفي نمط السعر حُفظ السعر المكتوب وصار سعر الصنف.

**الوحدات.** شراء **علبة واحدة** سجّل **٤ شرائط** في وحدة المخزون، وأظهر المخزون رصيداً **٤**. وإدخال جرد «٢ علبة + ١ شريط» أظهر التسمية الحية **«٢ Pack + ١ Strip = ٩ Strip»** وسُجّل **٩** مقابل رصيد نظام **٤**، بفارق **+٥** بانتظار التطبيق. ورُفضت الكسور عند مدخلَي الإدخال كليهما: كمية ١٫٥ علبة في سطر الشراء رُفضت برسالة «أدخل كمية صحيحة موجبة.»، وعدّ ١٫٥ شريط رُفض برسالة «استخدم أعداداً صحيحة غير سالبة.». أما الادعاء الأشمل بأن أي كسر لا يصل إلى الرصيد أبداً فتحمله اختبارات التحويل الآلية وأعمدة الأعداد الصحيحة في قاعدة البيانات؛ وهذا التشغيل يثبت المدخلين اللذين يكتب فيهما الإنسان. كما قِيس على الشاشة العمود الذي يحمل هذا السيناريو — خانة «Inventory Units» في سطر الفاتورة التي تقرأ **4 Strip** — فوُجد عند الموضع الأفقي من ٨٩٠ إلى ١٠٣٤ بالإنجليزية ومن ١٧ إلى ١٦١ بالعربية، داخل نافذة التطبيق بكامله، في السطر قيد الكتابة وفي السطر المُثبَّت معاً، ولا شيء حوله يُمرَّر. وهذا موضوع التصحيح الثالث في القسم ٦.

**تعديل الشراء.** بعد تعديل سطر مُرحَّل من ٤ إلى ٨، حمل سجل حركات الصنف **حركة تعديل شراء واحدة بكمية ٤**، بينما حمل السطر غير المتغيّر **صفر** حركات تعديل. وبقراءة السجل من التطبيق نفسه، أظهر تاريخ الصنف المعدَّل سطر التعديل «P1/2026-1 · Al-Nahrain Medical · تعديل شراء · ٤ · ٣٢٠٫٠٠٠ دينار»، بينما أظهر تاريخ السطر غير المتغيّر استلامه الأصلي وحده «P1/2026 · Al-Nahrain Medical · استلام شراء · ٢ · ١٦٠٫٠٠٠ دينار» دون أي سطر تعديل. ثم مُنِع تعديل غير صالح: بعد أن استهلك مردود شراء مرتبط ٣ من ٤ وحدات وبقيت وحدة واحدة في الدفعة، رُفضت محاولة تخفيض السطر من ٤ إلى ١ برسالة **«هذا الفرق غير صالح مقابل المخزون الحالي. عالجه بجرد المخزون أو مردود شراء أو تصحيح آخر، ثم أعد المحاولة.»**. وقِيس موضع الرسالة على الشاشة داخل نافذة التطبيق في كل مرور (انظر القسم ٦). وقد بُلغت تلك الحالة عبر الشاشات الاعتيادية بالكامل، دون أي التفاف على قاعدة البيانات.

### ٥. إضافة صنف إلى سلة الطلب من شاشة المبيعات

فُتحت مسودة بيع من شاشة المبيعات بلوحة المفاتيح، وكُتب «panadol gs» في بحثها، وأُضيف **Panadol Extra GSK** إلى سلة الطلب من شاشة المبيعات نفسها. ثم أُعيدت قراءة المسودة فكانت **كما هي دون تغيير، عند «الإصدار ١»** تماماً كما قبل الإضافة. وبهذا يكتمل بند النطاق «إضافة الأصناف إلى السلة من المخزون والمبيعات».

### ٦. أعطال كشفها تشغيل القبول وأُصلحت داخل هذه المرحلة

الغاية من تشغيل المرحلة على التطبيق المحزَّم، وبحجم النافذة الذي ستستعملونه فعلاً، هي كشف ما يفوت اختباراً يجري على شاشة مطوِّر عريضة. وقد كشف ثلاثة أعطال، كلها في شاشة المشتريات، وعطلين آخرين أحدثهما تصحيحنا الأول. ونُبلغ بها جميعاً لأن اثنين منها أخفق بهما تشغيل قبول فعلاً: فالتشغيل على النسخة المجمَّعة `e73b541` أخفق في بند النطاق «لوحة تفاصيل الصنف أثناء الشراء»، والتشغيل التالي على `7dda434` أخفق في موضوع سيناريو الوحدات الذي وضعتموه أنتم.

**العطل الأول — لوحة معلومات الصنف كانت خارج الشاشة.** كانت اللوحة التي تعرض تفاصيل الصنف المحدَّد تُرسم بجانب جدول أسطر الفاتورة، داخل مساحة عمل أعرض من نافذة التطبيق ولا تُمرَّر أفقياً. وعند حجم النافذة الافتراضي (١٠٦٦ × ٦٥٨) كانت اللوحة الممتلئة عند الموضع الأفقي **١٤٥٩ بالإنجليزية و−٦٥٦ بالعربية** — خارج الحافة اليمنى في حالة وخارج اليسرى في الأخرى — فلم تكن عملياً مرئية أبداً. وما كان يُرى في المساحة الجانبية هو عنصر نائب ثابت نصه **«No item selected»** لا يملؤه أي مسار في البرنامج. وبند النطاق يطلب ظهور لوحة تفاصيل الصنف الجانبية في الشراء، ولم تكن تظهر.

**العطل الثاني — رسالة رفض التصحيح غير الصالح لم تُجلب إلى مجال الرؤية.** عند رفض تعديل بالفرق رفضاً صحيحاً، كان نص الرفض يُرسم لكنه يبقى خارج الجزء المرئي من النافذة الحوارية (الموضع الرأسي −٩٩ داخل منطقتَي تمرير متداخلتين) ولا يأخذ تركيز لوحة المفاتيح. فالتصحيح كان يُمنع منعاً صحيحاً، لكن من يجريه لا يرى السبب.

**العطل الثالث — العمود الذي يُظهر «4 Strip» كان خلف شريط التمرير الأفقي للجدول.** ينص سيناريو الوحدات لديكم على أن شراء علبة واحدة يجب أن يسجّل ٤ شرائط في وحدة المخزون. وسطر الفاتورة يحمل هذا الرقم بالضبط في عمود «Inventory Units» — وعند حجم النافذة الافتراضي كان ذلك العمود **خارج النافذة بالكامل**: الموضع الأفقي من ١٣٨٩ إلى ١٥٢٤ بالإنجليزية ومن −٤٥٩ إلى −٣٣٨ بالعربية، لأن عرض جدول الأسطر كان ١٥٠٧ بكسل داخل إطار عرضه ١٠١٨. فالحساب كان صحيحاً، لكن الخانة التي تُثبته لكم كانت خارج الشاشة ما لم تُمرَّر الجدول أفقياً، في السطر قيد الكتابة وفي الأسطر المُثبَّتة معاً. ولم يُكتشف هذا إلا بعد أن شدّدنا فحصنا من «جزء منه ظاهر» إلى «كله ظاهر» — وكانت النتيجة الصادقة أن ذلك التشغيل **أخفق**.

**وعطلان آخران أحدثهما تصحيحنا الأول.** في النوافذ الأعرض انكمش جدول أسطر الفاتورة حتى اختفى، ثم — بعد محاولة أولى لإصلاح ذلك — تجاوز حدوده وطفح على الأقسام التي تحته. **ولم يكشفهما أي اختبار آلي ولا المراجعة المستقلة، بل كشفهما شخص فتح الصور التي أنتجها التشغيل للتو.** ونقول لكم ذلك بدل إصلاحه بصمت، لأنه الوصف الصادق لسير العمل، ولأن الحارس الذي أضفناه صار جزءاً من النسخة: اختبار آلي يشترط ألّا تتداخل أقسام شاشة المشتريات بعضها مع بعض.

**وكلها أعطال من أعطال هذه المرحلة لا طلبات تغيير.** يعرّف `docs/delivery.md` العطل بأنه «وظيفة مُنفَّذة لا تفي بالمتطلب المكتوب المعتمد أو بنتيجة القبول المتفق عليها»، وينص على أن «التصحيحات اللازمة للوصول إلى المطابقة مشمولة». وقد أُصلح كل واحد منها وأُعيد اختباره **داخل المرحلة الثانية نفسها وبلا أي كلفة طلب تغيير عليكم**، لا مؤجَّلاً إلى ما بعدها.

**التصحيحان.** الإصدار **`7dda434`** بعنوان «fix(purchasing): keep the item-details panel and correction refusals in view»: صارت اللوحة الجانبية هي لوحة الصنف الوحيدة وتتغذى من السطر المحدَّد؛ ولم تعد مساحة عمل الشراء تتجاوز عرض النافذة؛ وفي النوافذ الأضيق صارت اللوحة شريطاً يبقى في مجال الرؤية مع تمرير الفاتورة الطويلة؛ وصارت رسائل الرفض في مسارَي التعديل والمردود تُجلب إلى مجال الرؤية وتأخذ التركيز. ثم الإصدار **`1d229d4`** بعنوان «fix(purchasing): fit every invoice column in the window and keep sections stacked»: صار جدول الأسطر يمنح كل عمود حصة ثابتة من العرض، فتتسع الأعمدة الافتراضية السبعة كلها عند ١٠٢٤ و١٠٦٦ و١٢٨٠ بكسل بلا أي تمرير أفقي، وعادت أقسام الشاشة تترتب فوق بعضها كما ينبغي. ويحتفظ الجدول بشريط تمرير أفقي شبكةَ أمان فقط لمن يشغّل ويندوز بأحجام نص كبيرة جداً. **ولم تتغير إلا ملفات الواجهة** — لا شيء في الخادم ولا قاعدة البيانات ولا قوالب القيود ولا البيانات المحفوظة.

**وكيف أثبتنا ذلك.** صارت اختبارات الشاشة الآلية تؤكد أن لوحة الصنف **مرئية وداخل النافذة** عند **١٠٢٤ × ٧٦٨ و١٠٦٦ × ٦٥٨ و١٢٨٠ × ٨٠٠ و١٣٦٦ × ٧٦٨**، بالعربية والإنجليزية، في السمتين، مع فحص إمكانية وصول نظيف؛ وأن سعر الجملة ما زال يظهر في اللوحة وحدها؛ وأن اللوحة تبقى في مجال الرؤية في فاتورة من اثني عشر سطراً؛ وأن رسالة رفض الفرق المحظور ورسالة رفض مردود الشراء تأخذان التركيز وتظهران مع بقاء المسودة؛ وأن خانة «Inventory Units» **داخل النافذة بكاملها وليس أمام الجدول ما يُمرَّر إليه أفقياً**، عند ثلاثة أحجام نوافذ باللغتين والسمتين؛ وألّا تتداخل الأقسام. ثم أُعيد تشغيل القبول كاملاً على التطبيق المعاد تحزيمه عند `1d229d4`: **نجحت الاختبارات الأربعون في المرورات الأربعة كلها**، والقياسات مسجَّلة لا موصوفة — لوحة الصنف عند الموضع الأفقي من ٠ إلى ١٠٥١، ورسالة الرفض عند الرأسي ٢٢٦، وخانة «Inventory Units» عند الموضع الأفقي **من ٨٩٠ إلى ١٠٣٤ بالإنجليزية ومن ١٧ إلى ١٦١ بالعربية**، وكلها داخل نافذة ١٠٦٦ × ٦٥٨ بالكامل في **كل** مرور، ولا شيء حولها يُمرَّر. الأدلة: سجلات `scope-item-details-panel-*` و`scenario-adjustment-*` و`scenario-units-*` في `evidence/issue-59/acceptance/transcript.json` وصورها ومعها نسخ الصفحة الكاملة، و`evidence/issue-59/seams/INDEX.md`. أما أرقام **ما قبل التصحيح** المذكورة أعلاه فمحفوظة في `evidence/issue-59/defects/D1-D3-pre-fix.md`، لأن إعادة التشغيل على كل نسخة مصحَّحة استبدلت السجل الذي أظهرها أولاً.

### ٧. فحوص السلامة المعادة على هذه النسخة

**كل ما في عملية الشراء يُحفظ معاً أو لا يُحفظ شيء.** عند فرض إخفاق في منتصف ترحيل فاتورة — بعد حجز رقم المستند، ثم مرة أخرى عند الخطوة الأخيرة — أُلغيت معه كل الكتابات السابقة، فلم يبقَ مستند ناقص ولا مخزون شارد ولا قيد غير متوازن، وسُجّل الرقم المحجوز فجوةً أعادت المحاولة استخدامها. وينطبق الأمر نفسه على جلسة الجرد.

**إعادة المحاولة تُرحِّل مرة واحدة لا مرتين.** عند إرسال الترحيل ذاته مجدداً — وهي الحالة المعتادة عند انقطاع أو نتيجة غير واضحة — أعاد النظام النتيجة الأصلية بدل إنشاء مستند ثانٍ، ورُفض الطلب الذي تغيّر مضمونه بدل قبوله ضمناً، وعند تسابق محاولتين رُحِّلت واحدة فقط.

**المستند المُرحَّل لا يُعدَّل بعد ترحيله.** رُفضت محاولات التعديل والحذف عند الخادم، بما فيها المحاولات التي تتجاوز الشاشات: لقطات الأصناف المُرحَّلة ترفض التعديل والحذف، وجلسات الجرد المكتملة وحركاتها وقيودها محميّة من التغيير، وتفاصيل الشراء المُرحَّلة تُقرأ كلقطة تاريخية لا كبيانات حالية، ولا تُحذف مسودة البيع ولا تُعاد كتابة حقائقها الثابتة. والتصحيح دائماً مستند جديد مرتبط.

**لا يمكن دفع المخزون تحت الموجود فعلاً.** يُرفض أي تصحيح يهبط بالدفعة دون ما تبقّى فيها؛ وقد أعاد تشغيل القبول إنتاج ذلك عبر الشاشات الاعتيادية (مردود شراء استهلك ٣ من ٤، ثم مُنِع التخفيض من ٤ إلى ١ بالرسالة المذكورة في القسم ٤)، وتثبّت الفحوص الآلية للترحيل الرفض نفسه.

**المخزون المنتهي أو المسحوب أو المحجوز لا يُباع، ولا يستطيع أحد تجاوز ذلك.** اختُبِر الرفض عبر كل دور وكل حالة إعادة مصادقة فورية — مصفوفة كاملة من التوليفات — وبقي المخزون مرفوضاً في كل خلية منها. لا صلاحية ولا موافقة مدير ولا إعداد يسمح بتجاوزه، وسجلات السلامة نفسها تُضاف ولا تُعدَّل ولا تُحذف.

**مجموعة اختبارات شاشة واحدة لم يتيسّر تشغيلها إلا بعد أن خلا جهاز الاختبار.** مجموعة شاشة سلامة الدفعات (`batch-safety.browser`) أخفقت في البدء أربع مرات بينما كان تشغيل آلي آخر يستخدم المحطة نفسها: لم تُبلغ خدمة قاعدة بيانات الاختبار عن جاهزيتها خلال مهلة الخمس عشرة ثانية المقررة في أداة الاختبار. وبعد انتهاء ذلك التشغيل وخلو الجهاز، **نجح الأمر ذاته ٥ فحوص من ٥ في ٦١ ثانية**. وهذا حدٌّ من حدود محطة الاختبار تحت الحِمل لا من البرنامج، وقد سلكت تجربة ضابطة بمجموعة ثانية المسلك نفسه.

### ٨. العربية والإنجليزية، السمتان، بلوحة المفاتيح وحدها

نُفِّذ كل تدفق أعلاه أربع مرات: بالإنجليزية باتجاه من اليسار إلى اليمين، وبالعربية باتجاه من اليمين إلى اليسار، كلٌّ في السمة الفاتحة والداكنة، على تطبيق ويندوز المحزَّم — ٤٤ نتيجة تدفق مسجَّلة عبر المرورات الأربعة، نجحت كلها، دون خطوة مخفقة واحدة. وبُدِّلت اللغة والسمة من أزرار ترويسة التطبيق نفسها بلوحة المفاتيح، وأبلغ التطبيق في كل مرة عن اللغة والاتجاه والسمة المتوقعة. **وأُجريت كل خطوة بلوحة المفاتيح وحدها بلا استثناء**: فجميع إدخالات التاريخ في كل مرور قبلت تسلسل مفاتيح مكتوباً، أي أن حقول التاريخ في ويندوز نفسها بُلغت ومُلئت من لوحة المفاتيح. وفحص إمكانية الوصول الآلي جرى على كل شاشة في كل لغة وسمة وأبلغ عن **صفر مخالفة** في كل مرة. والأدلة: `evidence/issue-59/acceptance/transcript.json` والصور الثمانون في `evidence/issue-59/acceptance/`.

### ٩. ما هو غير معتمد، وما نحتاجه منكم

**يُرجى قراءة هذا القسم قبل غيره.** ثلاثة قرارات تخصكم وتخص مختصيكم لا نحن، ولم يصلنا أيٌّ منها. وإلى أن تصل، تعمل النسخة على **قواعد عمل مؤقتة** — اختيارات هندسية منّا، صُممت لتُغيَّر من موضع واحد محدد. **ولا شيء من هذه القواعد المؤقتة قاعدة معتمدة، ولا نقدّمها على أنها كذلك.**

**٩٫١ موافقة المحاسب — البوابة G-01، جزء المرحلة الثانية — مفتوحة.** يُطلب من محاسبكم النظر في تسعة بنود وتثبيت كل رقم أو تصحيحه: طريقة حساب متوسط تكلفة المخزون وعلى أي أساس (اليوم: المتوسط المرجّح على الكلفة الأساسية للمورد قبل السماح)؛ وقيد فاتورة الشراء؛ وقيد تعديل فاتورة الشراء؛ ومعالجة مردود الشراء حين تختلف القيمة الخارجة من المخزون عن القيمة التي يعتمدها المورد؛ ومعالجة فرق الجرد؛ ولقطة السماح وتوزيعه على أسطر الفاتورة؛ وطريقة استخراج «الفرق وحده» في التعديل؛ وقاعدة التقريب — بما فيها قاعدة حسم التعادل الظاهرة في حالات الهامش بالقسم ٤ — وتوزيع الفلس المتبقي؛ وأخيراً هل الهامش على سعر البيع (كما تفعل النسخة) وخطوات تقريب السعر ٢٥٠/٥٠٠/١٠٠٠. التفاصيل والأرقام الحالية والأمثلة على هيئة قيود في **`evidence/issue-59/gates/G-01-working-defaults.md`**، وحالته: مفتوحة بانتظار المحاسب.

**٩٫٢ موافقة الصيدلاني — البوابة G-02، جزء المرحلة الثانية — مفتوحة.** يُطلب من صيدلانيكم تثبيت تسعة بنود أو تصحيحها: الفئات الأربع (دواء، دواء يحتاج تبريداً، صنف عام يحتاج تبريداً، صنف عام)؛ وأي الفئات يلزمها تاريخ انتهاء كامل عند الاستلام (اليوم: الجميع عدا الصنف العام)؛ وأيها يلزمها رقم تشغيلة (اليوم: الدواء المبرَّد وحده)؛ ومدة التنبيه قبل الانتهاء (اليوم: ٩٠ يوماً لكل الفئات، وتُضبط لكل فئة بين ١ و٧٣٠ يوماً)؛ وهل تحتفظ كل صيدلية بنسختها من هذه القواعد؛ وماذا يحدث حين تنقص بيانات الاستلام المطلوبة؛ وأنواع الحجز على الدفعة (منتهية، مسحوبة، محجوزة) ومن يملك وضعها (اليوم: المالك والمدير والصيدلاني للسحب والحجز، وإعلان الانتهاء للفحص اليومي الآلي وحده)؛ وقاعدة تصحيح تاريخ انتهاء أُدخل خطأً (اليوم: صلاحية، وإعادة مصادقة فورية، وسبب مكتوب، ودليل مكتوب، مع الاحتفاظ بالتاريخ الأصلي)؛ والفحص اليومي والمراجعة الشهرية. التفاصيل في **`evidence/issue-59/gates/G-02-working-defaults.md`**، وحالته: مفتوحة بانتظار الصيدلاني.

**٩٫٣ قراركم بشأن رقم فاتورة مورد مكرر — مفتوح.** عند إدخال رقم فاتورة المورد نفسه مرتين للمورد نفسه، يطلب القرار المسجَّل اختيار أحد أمرين: **المنع**، أو **السماح بعد تحذير يتطلب صلاحية محددة لتجاوزه**. **والنسخة الحالية لا تفعل أياً منهما:** تُظهر تحذيراً وتدع المستخدم يكمل — عند حفظ المسودة وعند الترحيل — بلا صلاحية مطلوبة وبلا رفض. هذه قاعدة عمل مؤقتة **غير معتمدة**، ويصرّح بذلك التطبيق على الشاشة بالعربية والإنجليزية. السجل الكامل في **`evidence/issue-59/gates/duplicate-supplier-invoice-number.md`**، ويُعاد التحقق من إغلاق هذا القرار قبل النسخة المرشحة للإصدار.

**٩٫٤ أثر ذلك على الجدول الزمني وعلى هذه المرحلة.** بموجب حماية الجدول في النطاق المعتمد (§13.5)، **أيام انتظار هذه الموافقات لا تُحتسب تأخيراً من المطوِّر: جدول المرحلة متوقف مؤقتاً ما دامت معلقة**. وتبقى **المسألة رقم ‎#59 على GitHub مفتوحة** حتى تصل الموافقات وتُطبَّق على النسخة وتُعاد الاختبارات والسيناريوهات المتأثرة. **وإن اختلفت قيمة معتمدة عمّا تفعله النسخة اليوم فذلك خلل في هذه المرحلة**: نغيّره ونعيد اختباره ونسجّل الأمرين، داخل المرحلة نفسها وبلا كلفة طلب تغيير، ولا يُؤجَّل عملاً لاحقاً — والقسم ٦ هو صورة هذا الالتزام مطبَّقاً. وتُحفظ وثائق الموافقة الموقَّعة في `evidence/issue-59/gates/approvals/`، وهو فارغ اليوم؛ والنماذج داخل ملفَّي البوابتين أوراق عمل لجمع إجابات مختصيكم، وملؤها هنا ليس موافقة بحد ذاته.

### ١٠. ملاحظات ليست أعطالاً

**موضع عرض سعر الجملة ما زال خياراً مفتوحاً.** أكّد التشغيل أن سعر الجملة يظهر في لوحة معلومات الصنف أثناء الشراء ولا يظهر في غيرها من تلك الشاشة. وهذا الموضع يتبع قاعدة العمل المؤقتة المسجَّلة في `docs/open-decisions.md` تحت «اختيار سعر الجملة/السعر الخاص»؛ **أما كيفية اختيار سعر الجملة أثناء البيع — بحدّ كمية أو بصلاحية — فما زالت قراركم**، وهي من عمل المبيعات في المرحلة الثالثة. نسجّل الموضع الحالي قاعدة عمل مؤقتة لا قاعدة محسومة.

**اختلاف شكل الأرقام في العربية بين شاشتين.** في العربية يطبع سطر إدخال الشراء الكمية المحوَّلة هكذا «4 Strip»، بينما تطبعها شاشة المخزون وتسمية الجرد بالأرقام الهندية «٤» و«٢ Pack + ١ Strip = ٩ Strip». **والكمية واحدة في الحالتين** ولا يختلف إلا شكل الرقم. ويظهر الانقسام نفسه في المبالغ: تطبع لوحة معلومات الصنف سعر الجملة رقماً مجرداً «90000» في اللغتين، بينما تنسّق شاشة المخزون المبالغ حسب اللغة. سجّلناها ولم نغيّرها لأن تفضيلكم هو الفيصل؛ فأخبرونا في ملاحظاتكم المجمّعة أيّ الشكلين تريدون فنوحّد الشاشات عليه.

**خانة تاريخ الانتهاء تعرض تلميح التاريخ بالإنجليزية على الشاشة العربية.** عند كتابة تاريخ انتهاء في سطر الشراء، تعرض الخانة الفارغة تلميح ويندوز نفسه لصيغة التاريخ — `mm/dd/yyyy` — ويبقى بالإنجليزية حتى حين تكون بقية الشاشة بالعربية، لأنه يأتي من عنصر التاريخ في نظام التشغيل لا من Breev. وهو لا يغيّر التاريخ الذي تُدخلونه ولا طريقة حفظه. وهذا ليس جديداً في هذه المرحلة وليس من الأعطال المذكورة في القسم ٦؛ ونذكره هنا لتخبرونا في ملاحظاتكم المجمّعة إن كنتم تريدون تغييره.

**مثال السماح ذو الفواتير الخمس مثبَّت بقدر ما تبلغه هذه المرحلة.** مثالكم الإلزامي: كلفة أساسية ٥٫٠٠٠ ← كلفة بعد الخصم ٤٫٦٥٠ ← مدفوع ٤٫٥٠٠ ← سماح فعلي ٥٠٠ ← فرق سماح ١٥٠ ← رصيد مورد صفر. الرقمان الأولان، **٥٫٠٠٠ و٤٫٦٥٠**، مثبَّتان في هذه النسخة ويعيد اختبارها الآلي إنتاجهما. أما البقية — الدفع ٤٫٥٠٠ والسماح الفعلي ٥٠٠ والفرق ١٥٠ وبلوغ الرصيد صفراً — فتخص تسوية المورد، وهي من نطاق **المرحلة الثالثة** وغير موجودة في هذه النسخة. نسجّل ذلك حدّاً للنطاق لا نقصاً في المرحلة الثانية.

### ١١. مراجعتكم

وفق آلية القبول في `docs/delivery.md`، يُرجى مراجعة هذه النسخة خلال **ثلاثة أيام عمل** وإرسال **قائمة واحدة مجمّعة** بأي انحراف عن النطاق المعتمد. وأكثر ما يفيدنا أمران: إجابات محاسبكم وصيدلانيكم على ٩٫١ و٩٫٢ وإجابتكم أنتم على ٩٫٣، فهي ما تنتظره هذه المرحلة؛ وأي أمر في النسخة لا يطابق النطاق المكتوب المعتمد. والتصحيح اللازم لمطابقة النطاق المعتمد مشمول بهذه المرحلة كما يبيّن القسم ٦، أما التفضيل أو تغيير التدفق أو شاشة أو تقرير أو تكامل إضافي فهو طلب تغيير له موافقته وسعره وجدوله المكتوب.
