# T02 manual checkpoint — reasons, corrections and protected fields

Status: stakeholder **PASS**, 30 September 2026; the stakeholder confirmed they
finished the manual tests. Fixture closed. See [manual results](manual-results.md).
The steps below remain the reproducible test script, not current live-window instructions.

## Setup already prepared

Use the Chromium test window opened by this Codex task. It contains a synthetic
pharmacy with six invoices whose numbers start with `MANUAL-T02-`. This is a
disposable local PostgreSQL environment, separate from live pharmacy data.
The Playwright Inspector is open alongside it. Leave the Inspector paused while
working, except for the one restart step below.

Each test invoice starts with **4 units**, Primary Supplier Cost **80 IQD per
unit**, retail price **120 IQD**, supplier **Al-Nahrain Medical**, and the saved
supplier allowance **2.5%**. Input prices use **fils**: `80000` means 80 IQD.
The correction supplier **Manual T02 Supplier B** has a different current
allowance (25%); choosing it must preserve the original invoice's saved 2.5%.

**Save and review Delta saves the draft and opens its summary. It does not Post.**
**Confirm and post Delta is the final posting action.** Click it only at the
explicit posting steps. Editing evidence in the summary disables Confirm until
you Save/review again. Text entered after opening the summary is unsaved until
you click the **Save and review Delta** button that appears in that dialog.

## How to open each independent case

1. Open **Purchases → Posted invoices**.
2. In **Search posted purchases**, type the exact invoice number listed for the
   case and press **Enter**. Open the matching invoice with its **Open invoice**
   button. Use the exact match when `MANUAL-T02-DUPLICATE` also appears.
3. Choose **Edit Invoice**. In the **Reason** dropdown, select the case's reason.
4. Click **Create adjustment copy**. The header fields and correction rows are
   now editable. The selected reason must remain visible in its dropdown.
5. Click the text input **directly below the Reason dropdown**. Its placeholder
   is **Evidence or note (optional)**; its accessible name is **Reason evidence**.
   Type the case's exact evidence there. Check that the text is still visible
   after you edit the quantity or prices. Selecting a Reason does not fill this
   separate evidence input.

## A — Quantity error and restart

Invoice: `MANUAL-T02-QUANTITY`. Reason: **Quantity error**.

1. Open it using the procedure above. Enter evidence `T02 quantity checked`.
2. Change the row's **Quantity** from `4` to `8`. Keep both price inputs unchanged.
3. Click **Save and review Delta**. Expected: quantity **4 → 8**, quantity Delta
   **+4**, cost **80 IQD → 80 IQD**, value Delta **320 IQD**, reason **Quantity
   error**, and the exact evidence `T02 quantity checked`.
   The summary's text input must contain **T02 quantity checked**, not the
   **Evidence or note (optional)** placeholder. If it is blank, stop before
   Resume: click Cancel, enter the evidence below the Reason dropdown, and
   Save/review again. Report a failure if text you entered disappears.
4. **Do not Confirm yet.** Click **Resume** once in the Playwright Inspector.
   The fixture restarts the real API, reloads Chromium, and pauses again.
5. In Chromium, choose **Continue draft** (open **Edit Invoice** first if needed).
   Verify quantity `8`, reason **Quantity error**, evidence `T02 quantity checked`,
   and the supplier/invoice number survived. Save/review again and verify the
   same +4/320 IQD summary. Only now click **Confirm and post Delta**.
6. Expected: success with one **A01** correction. Click **Back to original
   invoice**. The original must still show quantity **4**, cost **80 IQD**, and
   its original supplier/invoice number.
7. Open its **A01** link. Verify **Quantity error**, exact evidence, **4 → 8 (+4)**,
   and the posted difference. Click **Back to invoice**, then **Back to results**.

## B — Price error

Invoice: `MANUAL-T02-PRICE`. Reason: **Price error**.

1. Open/create its correction and enter evidence `T02 prices checked`.
2. Keep quantity `4`. Change **Primary supplier cost (fils)** from `80000` to
   `100000` and **Retail price (fils)** from `120000` to `125000`.
3. Save/review. Expected: quantity **4 → 4**, quantity Delta **0**, cost **80 IQD
   → 100 IQD**, retail **120 IQD → 125 IQD**, value Delta **80 IQD**, and the exact
   reason/evidence. A price-only correction must not add units.
4. Confirm. Back to the original: quantity **4**, cost **80 IQD**, retail **120
   IQD** remain unchanged. Open **A01**: the corrected cost and retail before/after
   facts and evidence are stored. Back to invoice, then Back to results.

## C — Supplier error

Invoice: `MANUAL-T02-SUPPLIER`. Reason: **Supplier error**.

1. Open/create its correction and enter evidence `T02 correct supplier`.
2. In the header **Supplier** dropdown, choose **Manual T02 Supplier B**.
   Keep quantity, cost, retail price, and supplier invoice number unchanged.
3. Save/review. Expected: Supplier **Al-Nahrain Medical → Manual T02 Supplier B**;
   **no stock or value effects**; the original invoice's payable transfers as
   **Al-Nahrain Medical: −320 IQD**, **Manual T02 Supplier B: 320 IQD**. These are
   changes, not a claim about either supplier's total account balance. Net cost
   Delta is **0 IQD**. The supplier's newer default allowance must not reprice
   this historical invoice.
4. Confirm. Back to original: its supplier is still **Al-Nahrain Medical**.
   Open **A01**: verify both supplier names, reason and exact evidence. Both
   directions of navigation must work. Back to results.

## D — Invoice-number error and duplicate warning

Invoice: `MANUAL-T02-INVOICE`. Reason: **Invoice-number error**.

1. Open/create its correction and enter evidence `T02 reference corrected`.
2. Change the editable header **Supplier invoice number** from
   `MANUAL-T02-INVOICE` to `MANUAL-T02-DUPLICATE`. Keep the supplier and rows unchanged.
3. Save/review. Expected: the exact old/new invoice numbers; no stock/value
   effects; **0 IQD** cost Delta. A warning explains that another invoice has
   that number for the same supplier, and explicitly states that the current
   warning rule awaits milestone approval. Confirm remains available under that
   current rule. This checkpoint does not approve a new duplicate-number policy.
4. Confirm. Back to original: its number remains `MANUAL-T02-INVOICE`.
   Open **A01**: old/new supplier invoice numbers, reason and exact evidence are
   stored. The correction has its own A01 identifier, separate from the corrected
   supplier invoice number. Back to results.

## E — Other and a negative Delta

Invoice: `MANUAL-T02-OTHER`. Reason: **Other**.

1. Open/create its correction and enter evidence `T02 documented quantity correction`.
2. Change quantity `4` to `3`, keeping prices and header fields unchanged.
3. Save/review. Expected: **4 → 3**, quantity Delta **−1**, value Delta **−80 IQD**,
   reason **Other**, exact evidence. The negative money value must be a readable
   amount, not a dash. This records a data correction; physical goods leaving
   the pharmacy use the separate Purchase Return workflow.
4. Confirm. Back to original: quantity stays **4**. Open **A01**: verify the
   negative difference, reason and exact evidence. Back to results.

## F — Protected facts and persistence

1. Before leaving any unposted correction, try selecting or typing in **Expiry**.
   It is read-only. The lot (when captured), product and unit are stored facts,
   not editable correction inputs. The nearby guidance explains that expiry/lot
   correction awaits pharmacist approval and names the authorized stock-count,
   return or correction resolution paths. Do not expect an expiry edit to become
   a cost or quantity change.
2. Reload Chromium after the five cases. Reopen the five originals and their
   **A01** links. Each original remains unchanged, each has one correction, and
   each correction retains its exact reason/evidence and before/after facts.
3. If practical, use the application's locale/theme controls to review one
   correction in Arabic and dark theme. Check readable labels, direction,
   protected fields and the return link. Automated tests cover all four combinations.
4. Click Inspector **Resume** to finish and close only the manual fixture.

The broader controls, lower-bar totals, and ordinary raw diagnostic UUID cleanup
belong to **T03**. This checkpoint accepts only T02's reason/field/Delta/snapshot
and audit behavior; G-01 and G-02 remain open.

**Reply PASS to accept T02, or FAIL with the case/step and observed result.**
On a failure or accidental early Post, this fixture can be reset and reseeded.

## Investigation of the case A evidence report

The first manual attempt reported blank evidence after API restart. Read-only
inspection showed evidence was null in the original saved draft and both saved
update audit records; quantity 8 survived. Four strengthened browser cases passed
the header-evidence → quantity edit → Save/review → actual API/renderer restart →
Continue sequence, in both locales/themes. This does not explain why the manual
attempt's input was blank; the exact point of disappearance is still unconfirmed.
The stakeholder subsequently accepted T02 and confirmed completion of the manual
tests. The earlier note-loss report remains open; see [manual results](manual-results.md).

On the next fixture launch, Inspector Resume checks the saved case A before
restarting. If the required quantity, Reason, or evidence is absent, it pauses
again and leaves the page intact. Save/review the exact case A values, then
Resume again. This guard does not apply to the currently open fixture, which
was launched before the guard was added.

For the currently open draft, do not Confirm yet. Click Cancel in the summary,
enter `T02 quantity checked` below Reason, keep quantity 8, then Save/review.
Verify the exact evidence text in the summary. Reload Chromium and Continue draft;
verify it again before proceeding with A5. Do not press Inspector Resume a second
time during this recovery: the fixture already used its API-restart step, and the
next Resume finishes the manual fixture. If the text disappears, report whether
it disappeared before Save, in the summary, or after reload.

## Reopen/reset the disposable fixture

Codex can reopen it; these commands are also recorded for reproducibility. Never
substitute a live database. The test refuses a host/port outside this task's
disposable `127.0.0.1:5549` cluster. Resetting this fixture resets its synthetic
schemas and all six test invoices.

```powershell
Set-Location 'P:\Projects\PharmaElectrons'
if (-not $env:BREEV_TEST_POSTGRES_ADMIN_URL) { throw 'Configure the disposable test URL first' }
$manualDatabase = [uri]$env:BREEV_TEST_POSTGRES_ADMIN_URL
if ($manualDatabase.Host -ne '127.0.0.1' -or $manualDatabase.Port -ne 5549) { throw 'Use the task-owned disposable cluster' }
$env:BREEV_M2_T02_MANUAL = '1'
pnpm --filter @breev/desktop exec playwright test --config playwright.browser.config.ts test/browser/purchasing.browser.test.ts -g 'manual T02 Adjustment reasons' --headed
Remove-Item Env:BREEV_M2_T02_MANUAL
```
