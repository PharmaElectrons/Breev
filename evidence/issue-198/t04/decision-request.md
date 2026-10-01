# T04 decision request — separate invoice offer

Date: 30 September 2026. M2-P1-T04 under [#198](https://github.com/PharmaElectrons/Breev/issues/198).
Status: **blocked before production code — missing G-01 decision**.

## Authority and inspected evidence

The phase prompt requires: “If a material decision is still missing, do not
invent it.” It requires a worked decision request and a stop for the
user/professional decision. [G-01](../../../docs/open-decisions.md) names Iraqi
accountant, legal and product owners. Its approved artifacts directory is empty
apart from its README. The G-01 working-default pack explicitly remains open.
Fresh issue bodies/comments for #59, #50, #198 and #190 contain no approval for
this offer's representation, basis/order, rounding or correction semantics.

[M2-P02](../../../docs/milestone-2-scope-and-evidence-map.md) remains a defect:
the required invoice-specific offer is absent. Existing `purchase-costs.ts`
implements only Supplier allowance. The prototype amount/percentage controls
are visual evidence, not accounting approval. T03 PASS does not approve T04.

Confirmed boundaries stay fixed: Primary Supplier Cost determines WAC/COGS and
the Supplier primary balance; Cost After Discount is informational. Supplier
allowance and the additional offer are separate immutable facts. The mandatory
5,000 / 4,650 / 4,500 / 500 / 150 / zero client criterion remains unchanged.
Supplier settlement, #63/#75 and final printing are outside this slice.

## Three decisions needed

1. **Input and percentage basis.** Approve fixed fils, an exact percentage, or
   both with one active form. For a percentage, approve whether it applies to
   Primary Supplier Cost or the amount after Supplier allowance. Confirm the
   allowable range and treatment of an offer exceeding that basis.

   | Exact input/result      |            Gross basis |  After-allowance basis |
   | ----------------------- | ---------------------: | ---------------------: |
   | Primary Supplier Cost   |         1,000,000 fils |         1,000,000 fils |
   | Supplier allowance, 10% |           100,000 fils |           100,000 fils |
   | Additional offer, 5%    |            50,000 fils |            45,000 fils |
   | Cost After Discount     | 850,000 fils (850 IQD) | 855,000 fils (855 IQD) |

   A fixed 50,000-fils offer gives 850,000 fils under either basis in this example.
   No offer gives 900,000 fils. Primary cost stays 1,000,000 fils throughout.

2. **Exact precision, rounding and row allocation.** The current engineering
   default is six decimal places for rates, half away from zero for the invoice
   result, and largest remainder with original line order as the tie-breaker.
   Approve it for offers or supply the replacement rule; it is not approved merely
   because the existing allowance calculator uses it.

   Exact boundary: three rows of 1 fil each, allowance zero, offer 50%.
   The unrounded offer is 1.5 fils. Under that proposed rule, invoice offer =
   2 fils, Cost After Discount = 1 fil, and offer shares = 1 / 1 / 0 fils in
   original line order. Approve this expected result, the percentage precision,
   and whether row allocation is needed for the informational cost snapshot.

3. **Posting and correction meaning.** Confirm that the offer changes the
   informational Cost After Discount only, with no change to gross WAC or the
   Supplier primary-balance basis. Specify any separately required journal effect
   or approve no additional journal effect. Approve immutable storage of the
   selected form/input, calculation basis, exact amount, applicable row shares
   and rule version, bound to preview/Post and audit.

   Proposed correction behavior for approval: a percentage retains its original
   saved rate/basis and recalculates against corrected facts; a fixed offer retains
   its saved amount unless explicitly corrected. An offer-only correction from
   zero to 50,000 fils on the first example changes Cost After Discount from
   900,000 to 850,000 fils, with primary-cost Delta 0 and stock Delta 0. Store
   offer/discounted-cost Deltas and reason/evidence; never rewrite the original
   or recalculate history after Supplier/master changes. Confirm which offer
   fields may be corrected and the required accountant-approved journal example.

## Pattern research and fit

Microsoft Business Central represents line and invoice discounts separately and
supports document-level invoice percentages; its discount posting policy is
configurable. That supports explicit invoice input and a visible calculated
amount. Its accounting policy cannot decide Breev's confirmed gross WAC/Supplier
basis. This is precedent only, not G-01 approval.
[Microsoft documentation](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-record-purchase-price-discount-payment-agreements).

## Approval record and next checkpoint

Provide the selected rules above and the approving product/accountant/legal
owners or their approval artifact. Record approval in the G-01 evidence pack
before implementation; approval of this bounded offer rule does not close the
whole G-01 gate. Then implement the exact draft → restart → preview/hash → Post →
immutable review → Adjustment slice and present T04's separate PASS/FAIL checkpoint.
No T04 production change or T05 start is authorized by this missing-decision state.
