# T04 focused manual acceptance script

1 October 2026. The stakeholder accepted T04 with “IT IS A PASS” after this
script and prepared session were supplied. This retained script covers only T04.
T03 remains accepted; no repeat of its manual script is required. Accountant/legal
approval and G-01/G-02 remain separate and open. The authorized full pre-commit
gate and its limitations are recorded in [pre-commit-gate.md](pre-commit-gate.md).

## Prepared environment

The headed browser runs current production renderer assets with the existing
desktop preload/identity test harness, real local API and PostgreSQL. This is
the established manual browser seam, not packaged Electron or release proof.
The fresh task-owned PostgreSQL 18 cluster listens only on 127.0.0.1:5553.
The retained T02/T03 manual fixtures are untouched. Run directory manifest:
`.scratch/runtime/t04-manual-run-path.txt`. Generated test directory manifest:
`.scratch/runtime/t04-manual-test-path.txt`. The initial ready capture is
`manual-ready.png` in the run directory. Production sources were not edited.

Three durable synthetic drafts use Supplier `Manual T04 Supplier 10 percent`,
invoice date 2026-10-01, debt context, ten Inventory Units at 100 IQD each,
lot `MANUAL-T04-LOT`, expiry 2029-06-30 and 10% allowance:

- `MANUAL-T04-NONE`
- `MANUAL-T04-FIXED`
- `MANUAL-T04-PERCENT`

All start with no offer. The app is open on NONE in English/light. The item grid
shows cost in integer fils; its 100000 is 100 IQD. The offer amount field is
explicitly IQD. Do not edit item rows, Supplier or payment context in this script.

The Playwright Inspector is a separate window. Its first Resume is reserved for
the explicit restart below. Do not Resume during cases A-C. The app remains
interactive while the runner is paused. After restart, a second/final Resume
closes the manual session; wait until all checks finish before using it.

## A — No offer

1. On NONE, verify both `Invoice offer %` and `Invoice offer (IQD)` are 0.
2. Click `Save changes` and wait until it is enabled again.
3. Read the fixed footer: Gross 1,000 IQD; Allowance amount 100 IQD; Invoice offer
   0 IQD; Cost After Discount 900 IQD. Allowance snapshot remains 10%.
4. Scroll inside the invoice canvas to `Review purchase`. It may show fils:
   gross 1000000, allowance 100000, offer 0, net 900000. These are the same facts.
5. Do not Post yet.

## B — Fixed offer

1. Click top `Saved drafts`. Find `MANUAL-T04-FIXED` and click its Open button
   (or double-click its row). Other BROWSER-REVIEW fixtures are not these tests.
2. In footer `Invoice offer (IQD)`, enter 50. Percentage must show 0.
3. Click `Save changes`; wait for completion.
4. Verify gross 1,000; allowance 100; invoice offer 50; Cost After Discount 850 IQD.
5. Do not Post yet.

## C — Percentage and unsaved protection

1. Open `MANUAL-T04-PERCENT` through top `Saved drafts`.
2. Enter 5 in `Invoice offer %`. The amount input shows 0 because fixed amount
   and percentage are alternative forms. The calculated Invoice offer total
   after saving will be 50 IQD.
3. Before Save, scroll to `Review purchase` and click `Post purchase`.
4. Expect refusal asking to save the offer. No invoice should Post and the 5
   must remain entered. Saved totals may still reflect the previously saved draft.
5. Click footer `Save changes`; wait for completion.
6. Verify gross 1,000; allowance 100; calculated offer 50; net 850 IQD; percentage
   input 5 and fixed amount input 0.

## D — Real restart

1. Keep PERCENT open and saved. Press the Playwright Inspector Resume once.
2. The fixture independently verifies PERCENT is saved as 5% with 850000 fils
   net before restarting. If not saved correctly, it pauses again and retains
   input; return to C and Save.
3. Wait for the API restart, page reload and automatic reopening of PERCENT.
4. Verify the header still says MANUAL-T04-PERCENT, percentage 5, amount input 0,
   gross 1,000, allowance 100, offer total 50 and discounted cost 850 IQD.
5. Do not press Resume again yet.

## E — Invalid combination and recovery

1. In PERCENT, enter 950 in `Invoice offer (IQD)`. Percentage changes to 0.
2. Click `Save changes`. Expect a localized refusal: allowance and offer cannot
   exceed gross (100 + 950 > 1,000). Entered 950 must remain visible.
3. Attempt `Post purchase`: unsaved/invalid input must prevent posting.
4. Restore 5 in `Invoice offer %` (fixed amount input becomes 0), then click
   `Save changes`. Error clears and calculated offer/net return to 50/850 IQD.

## F — Post and immutable review

1. Scroll to PERCENT's `Review purchase` and click `Post purchase` once.
2. Open top `Posted invoices`, search MANUAL-T04-PERCENT, and open the matching
   Purchase row. Verify gross 1,000, allowance 100, offer 50 and net 850 IQD.
3. Open NONE through `Saved drafts`, Post it, then reopen it through `Posted
invoices`. Verify gross/allowance/offer/net = 1,000/100/0/900 IQD.
4. Open FIXED through `Saved drafts`, Post it, then reopen it through `Posted
invoices`. Verify gross/allowance/offer/net = 1,000/100/50/850 IQD.
5. Check the review identifies the saved offer form/rate and rule facts where
   displayed. No update/delete action may mutate the original posted purchase.
6. Gross remains the Supplier posting basis in all three. No global Supplier
   balance or settlement test is required here; WAC/journal conservation is
   covered by the existing recorded automated real-PostgreSQL proof.

## G — Offer-only linked Adjustment

1. In FIXED's immutable review, click `Edit Invoice`.
2. Select Reason `Other`, enter evidence `T04 invoice offer checked`, then click
   `Create adjustment copy`. If evidence is entered later, save/review it again.
3. Change only `Invoice offer %` to 10. Do not change rows, Supplier or number.
4. Click `Save and review Delta`.
5. Read the comparison: Primary Supplier Cost 1,000 -> 1,000, Delta 0;
   Supplier allowance 100 -> 100, Delta 0; Invoice offer 50 -> 100, Delta +50;
   Cost After Discount 850 -> 800, Delta -50 IQD.
6. Verify `No stock or Inventory value change` and `No Supplier payable change`.
7. Click `Confirm and post Delta` once. Verify the linked A01 shows those saved
   before/after values and the entered evidence.
8. Follow `Back to original invoice`. The original must still show fixed offer
   50 and discounted cost 850. The linked Adjustment remains navigable; it must
   not rewrite the original as offer 100/net 800.

## Finish

Record A-G PASS or the exact failed step, expected value and observed result.
Reply `T04 PASS` to accept this candidate or `T04 FAIL` with the defect. No
acceptance or professional approval is inferred from elapsed time or closing
the fixture. Press Inspector Resume a second/final time only when finished to
close the interactive page/API. Synthetic PostgreSQL data remains retained.
