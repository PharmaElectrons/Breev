# G-01 — Accounting and Iraqi tax, milestone-2 portion: working defaults for accountant approval

**STATUS: OPEN — milestone-2 portion awaiting accountant approval; schedule paused under scope §13.5 (docs/requirements/breev-phase1-mvp-scope.md). Nothing below is approved.**

Build under review: `e73b541` (milestone 2 — Items, Purchases, and Inventory).
Audience: the Iraqi accountant named as G-01's owner in `docs/open-decisions.md`.
Purpose: every figure the milestone-2 build produces today, with the file an engineer changes if the approved value differs.

Nothing in this document is an approved rule. Each value below is a **working default** — Breev engineering's current implementation, chosen to be defensible and to be replaceable in one named place. Where this document says "pending G-01", that is the state of the decision, not a recommendation you are asked to ratify.

---

## 1. What the gate requires

`docs/open-decisions.md`, §"Client decisions required before final implementation", opening sentence:

> These are the client's own open approvals (scope §19 plus items the requirements leave to approval). **Never present a proposed default as an approved rule.**

`docs/open-decisions.md`, §"Engineering and professional release gates", row **G-01 Accounting and Iraqi tax** — decision/evidence required:

> Accountant/legal golden postings for every purchase/purchase adjustment/sale/Return/Reversal/count/write-off/destruction/allowance/allowance difference/debt/mixed tender/cash difference; chart, periods, tax, final printed number/correction presentation; exact decimal precision, rounding, remainder allocation, manual-journal thresholds. The mandatory client test (5,000 primary cost / 4,650 after discount / 4,500 paid / 500 actual allowance / 150 allowance difference / zero balance) must pass unchanged.

Same row — confirmed boundary while open (these are **not** up for approval; they are settled policy):

> Integer fils, exact intermediates, balanced immutable journals, WAC on pre-discount Primary Supplier Cost, FEFO separate, linked corrections, Delta-only adjustments, and the expiry/damage account and P&L treatment in `domain.md` (its write-off date rule is an engineering default this gate confirms).

Owner and blocking scope, same row: _"Iraqi accountant + legal + product; milestones 1-3 and release"_.

`docs/delivery.md`, §"Milestone 2: Items, Purchases, and Inventory", gates line:

> **Gates.** Accountant approval for WAC-on-primary-cost, allowance, and adjustment golden examples. Pharmacist approval for product-class lot/expiry requirements (G-02).

`docs/README.md`, §"Requirement language":

> No document may turn a release gate into a guessed default.

`docs/requirements/breev-phase1-mvp-scope.md` §13.5 "Schedule protection":

> Days spent waiting for client approval, accounting decisions, current-system access, OCR samples, service accounts, or provider responses do not count as developer implementation delay.

Until this approval arrives, the milestone-2 schedule is paused under that clause. Applying an approved value that differs from the build is a **defect of milestone 2**, fixed and retested inside this same issue — never carried into later work.

---

## 2. Every G-01 working default in the milestone-2 build

Nine items. Money is exact integer fils throughout: **1 IQD = 1,000 fils** (`apps/local-api/src/posting/money.ts:42`, `FILS_PER_IQD`).

| #   | Item                                                                         | File and exported constant                                                                                                                                                                                                                            | Version marker                                                                                                                                                                        | Current value (working default)                                                                                                                                                                                                                                                                                     | Golden figures the build produces                                                                                                                                                                                                                                                                                                                                                                                                          | Pinning test (file + test title)                                                                                                                                                                                                                                                                                                              | Re-run result                                                           |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Costing method for the Primary Supplier Cost                                 | `apps/local-api/src/inventory/inventory-valuation.ts:39` `INVENTORY_VALUATION_METHOD`; `:50` `VALUATION_SCALE`                                                                                                                                        | no template version; behavioural constants                                                                                                                                            | `"weighted-average-cost"`, intermediates kept at scale 10; the average is derived on demand and never fed back into stored value                                                                                                                                                                                    | Receipts 10,000 fils / 10 units then 30,000 fils / 10 units → reported average **2,000 fils per unit**, not the last purchase cost of 3,000 (`inventory-valuation.unit.test.ts:78-85`). Receipts 80 fils / 8 units then 64 fils / 4 units → a 1-unit depletion freezes a Carrying Amount of **12 fils** (`:172-181`)                                                                                                                       | `apps/local-api/src/inventory/inventory-valuation.unit.test.ts` — "reports the weighted average, not the last purchase cost"; "freezes current WAC when it differs from the original purchase cost"                                                                                                                                           | `evidence/issue-59/seams/inventory-valuation.unit.txt`                  |
| 2   | Purchase invoice journal                                                     | `apps/local-api/src/accounting/purchase-posting-template.ts:69` `PURCHASE_POSTING_TEMPLATE_ID`; `:72` `PURCHASE_POSTING_TEMPLATE_VERSION`; `:79` `PURCHASE_POSTING_TEMPLATE_VERSIONS`                                                                 | `purchase.invoice` **v1** (versions `[1]`)                                                                                                                                            | Two lines only. Debit `inventory` and credit `supplier-payable` (debt) or `cash` (cash), both at the **Primary Supplier Cost**. The calculated Allowance posts **nothing** at invoice time                                                                                                                          | Debt invoice, Primary Supplier Cost 160,000 fils: debit `inventory` 160,000, credit `supplier-payable` 160,000. Cash invoice: same debit, credit `cash` 160,000, no supplier line. Allowance 0 / 2.5 / 40 % → Cost After Discount 160,000 / 156,000 / 96,000 fils and an **identical** journal each time                                                                                                                                   | `apps/local-api/src/accounting/purchase-posting-template.unit.test.ts` — "posts the Primary Supplier Cost on both sides of a debt invoice"; "takes the cash or debt effect from the header context alone"; "posts no allowance line, because settlement owns the allowance"; "changes nothing in the journal when only the allowance changes" | `evidence/issue-59/seams/purchase-posting-template.unit.txt`            |
| 3   | Purchase Invoice Adjustment journal                                          | `apps/local-api/src/accounting/purchase-adjustment-posting-template.ts:9` `PURCHASE_ADJUSTMENT_POSTING_TEMPLATE_ID`; `:11` `..._VERSION`; `:12` `..._VERSIONS`                                                                                        | `purchase.adjustment` **v1** (versions `[1]`)                                                                                                                                         | Delta-only. A zero Delta emits no line at all; a debt adjustment must have supplier effects summing exactly to the inventory value Delta; a cash adjustment may not move supplier payables                                                                                                                          | Delta +4,000 fils on debt: debit `inventory` 4,000, credit `supplier-payable` 4,000. Supplier corrected with no value change: debit `supplier-payable` (old supplier) 10,000, credit `supplier-payable` (new supplier) 10,000. Invoice-number-only fix: **no journal lines**                                                                                                                                                               | `apps/local-api/src/accounting/purchase-adjustment-posting-template.unit.test.ts` — "posts a positive debt Delta to inventory and supplier payable"; "moves a corrected debt between supplier accounts without stock value"; "produces no journal lines for a non-financial invoice-number fix"                                               | `evidence/issue-59/seams/purchase-adjustment-posting-template.unit.txt` |
| 4   | Purchase Return: treatment of the inventory-versus-supplier value difference | `apps/local-api/src/accounting/purchase-return-posting-template.ts:6-8` (id/version/versions); `:18` `PURCHASE_RETURN_DIFFERENCE_TREATMENT`, which re-exports `packages/contracts/src/local-rest/index.ts:4088` `PURCHASE_RETURN_G01_WORKING_DEFAULT` | `purchase.return` **v1**; treatment label `"inventory-account-offset-pending-g01"`, carried on the posted snapshot (`index.ts:4098`)                                                  | The inventory credit always states the frozen WAC Carrying Amount; the supplier debit always states the original-Primary-Cost reduction; any difference is an **explicit third line on the existing `inventory` account**. No variance account is invented                                                          | Carrying Amount 12,000 fils, supplier reduction 10,000 fils → debit `supplier-payable` 10,000; credit `inventory` 12,000; debit `inventory` 2,000. Totals 12,000 / 12,000                                                                                                                                                                                                                                                                  | `apps/local-api/src/accounting/purchase-return-posting-template.unit.test.ts` — "states the two differing values and balances without a variance account"                                                                                                                                                                                     | `evidence/issue-59/seams/purchase-return-posting-template.unit.txt`     |
| 5   | Count Session variance treatment                                             | `apps/local-api/src/accounting/count-variance-posting-template.ts:6-8` (id/version/versions); `:9` `COUNT_VARIANCE_DIFFERENCE_TREATMENT` ← `packages/contracts/src/local-rest/index.ts:4090` `COUNT_VARIANCE_G01_WORKING_DEFAULT`                     | `inventory.count` **v1**; treatment label `"count-variance-account-pending-g01"`                                                                                                      | Shortage debits `inventory-count-variance` and credits `inventory`; surplus reverses it. A zero variance is refused. Wired into posting at `apps/local-api/src/accounting/accounting-persistence.ts:332`                                                                                                            | Shortage of 2 units worth 2,000 fils → debit `inventory-count-variance` 2,000, credit `inventory` 2,000. Surplus of 3 units worth 3,000 fils → debit `inventory` 3,000, credit `inventory-count-variance` 3,000                                                                                                                                                                                                                            | `apps/local-api/src/accounting/count-variance-posting-template.unit.test.ts` — "debits the variance account for a shortage and balances"; "debits inventory for a surplus and balances"; "rejects a zero variance"                                                                                                                            | `evidence/issue-59/seams/count-variance-posting-template.unit.txt`      |
| 6   | Allowance snapshot and how the calculated Allowance is split across lines    | `apps/local-api/src/purchasing/purchasing-domain.ts:6` `AllowanceSnapshot`, `:16` `copyAllowanceSnapshot`; `apps/local-api/src/purchasing/purchase-costs.ts:91` `calculatePurchaseCosts` (`:127-128`)                                                 | no version constant; the closed set of account codes at `packages/contracts/src/local-rest/index.ts:3487` has **no allowance account**, so booking one at invoice time is unspellable | The supplier's percentage valid on the invoice date is copied into the invoice as a snapshot (percentage + basis) and never recalculated. The Allowance is taken **once on the invoice total**, then split back across the lines; per-line rounding is not used                                                     | Client five-invoice example: Primary Supplier Cost **5,000**, allowance at 7 % **350**, Cost After Discount **4,650** (fils in the test; the same numerals as the client statement). Rounding once, not per line: three lines of 1 fils at 50 % → invoice allowance **2 fils**, line shares **1 / 1 / 0**, Cost After Discount **1 fils**                                                                                                  | `apps/local-api/src/purchasing/purchase-costs.unit.test.ts` — "reproduces the client's five-invoice allowance example"; "rounds the invoice allowance once instead of once per line"; "reconciles the line shares with the invoice totals exactly"                                                                                            | `evidence/issue-59/seams/purchase-costs.unit.txt`                       |
| 7   | Delta extraction for a Purchase Invoice Adjustment                           | `apps/local-api/src/purchasing/purchase-adjustment-delta.ts:98` `extractPurchaseAdjustmentDelta`                                                                                                                                                      | no version constant; the Delta feeds template `purchase.adjustment` v1 (item 3)                                                                                                       | The Delta is taken against the immutable original, then prior adjustment effects for the same row lineage are subtracted, so each adjustment stands alone. Unchanged lines produce no row Delta and no movement                                                                                                     | Verbatim 4 → 8 case at unit cost 1,000 fils and a 10 % snapshot allowance: quantity Delta **+4**, Primary Supplier Cost Delta **+4,000 fils**, Cost After Discount Delta **+3,600 fils**, exactly one row Delta. Ten rows with one changed: exactly **one** row Delta                                                                                                                                                                      | `apps/local-api/src/purchasing/purchase-adjustment-delta.unit.test.ts` — "posts exactly +4 for the verbatim 4 to 8 case"; "creates no movement or value effect for nine unchanged lines"; "subtracts prior effects so successive adjustments stand alone"                                                                                     | `evidence/issue-59/seams/purchase-adjustment-delta.unit.txt`            |
| 8   | Rounding rule and remainder allocation for posted fils                       | `apps/local-api/src/posting/money.ts:237` `ROUNDING_RULE`; `:250` `REMAINDER_ALLOCATION_RULE`; algorithms at `:371` `divideExactRounded` and `:320` `allocateFilsProportionally`                                                                      | no template version; the constants are the policy labels                                                                                                                              | `ROUNDING_RULE = "half-away-from-zero"` (2.5 fils → 3; −2.5 → −3). `REMAINDER_ALLOCATION_RULE = "largest-remainder-then-line-order"` (exact floor per line, then the remaining fils one at a time to the largest dropped fraction, ties by line order). Rates are exact decimal at six places (`:211` `RATE_SCALE`) | See item 6's 1/1/0 split, which is this rule in action. Cash rounding is off, as `docs/domain.md` states                                                                                                                                                                                                                                                                                                                                   | `apps/local-api/src/posting/money.unit.test.ts` — "labels the two engineering defaults its behaviour implements" (`:657`), plus the behavioural suites in the same file                                                                                                                                                                       | `evidence/issue-59/seams/money.unit.txt`                                |
| 9   | Calculated selling price: margin basis and price rounding steps              | `apps/local-api/src/catalog/catalog-pricing.ts:124` `roundingMultiple`, `:129` the single rounding call; `apps/local-api/src/catalog/catalog-exact.ts:32` `HALFWAY_RULE`, `:88` `roundQuotientToMultiple`                                             | no version constant; rounding settings are the closed set `off` / `nearest-250-iqd` / `nearest-500-iqd` / `nearest-1000-iqd`                                                          | Margin is **on the selling price**, not markup on cost: price = cost ÷ (1 − margin). The configured step is applied to the **exact rational** price in one rounding, never to an already-rounded fils figure                                                                                                        | Cost 80,000 fils at 20 % margin, rounding off → **100,000 fils** (80 IQD → 100 IQD). With rounding enabled: cost 300,000 @ 20 % → 500,000 fils under the 250-IQD step; cost 200,000 → 500,000 under the 500-IQD step; cost 400,000 → 1,000,000 under the 1,000-IQD step; cost 375,000 with rounding off → 468,750 fils. Single-rounding proof: cost 300,000 at 19.999936 % → **250,000 fils** under the 250-IQD step (375,000 under "off") | `apps/local-api/src/catalog/catalog-pricing.unit.test.ts` — "treats percentage as margin on the selling price"; "applies each optional rounding setting after calculating the margin price"; "applies the rounding step to the exact price rather than to an already-rounded one"                                                             | `evidence/issue-59/seams/catalog-pricing.unit.txt`                      |

Account identifiers used above are the template's own stable codes, not pharmacy-facing names. The closed set is `cash`, `inventory`, `inventory-count-variance`, `supplier-payable` (`packages/contracts/src/local-rest/index.ts:3487-3492`). Final account **names**, classifications, and viewing permissions are a separate open client decision in `docs/open-decisions.md` ("Final account names").

---

## 3. Worked golden examples, as journal lines

Amounts are given in fils and in IQD (1 IQD = 1,000 fils). Ordinals are the order the template emits. Please tick each line or write the correction beside it.

### GE-1 — Purchase invoice on credit (Primary Supplier Cost basis)

Facts: two units at a Primary Supplier Cost of 80,000 fils each; supplier Allowance snapshot 2.5 %.
Derived: Primary Supplier Cost **160,000 fils (160.000 IQD)**; calculated Allowance **4,000 fils (4.000 IQD)**; Cost After Discount **156,000 fils (156.000 IQD)**.
Source: `purchase-costs.unit.test.ts:23-35`, `purchase-posting-template.unit.test.ts:48-65`.

| Ordinal | Account identifier | Debit (fils) | Credit (fils) | Debit (IQD) | Credit (IQD) | Supplier on the line   |
| ------- | ------------------ | ------------ | ------------- | ----------- | ------------ | ---------------------- |
| 1       | `inventory`        | 160,000      | —             | 160.000     | —            | none                   |
| 2       | `supplier-payable` | —            | 160,000       | —           | 160.000      | the invoice's supplier |

The Allowance of 4,000 fils and the Cost After Discount of 156,000 fils are **stored on the invoice and shown**, and post nothing here. ☐ correct ☐ change to: ______

### GE-2 — The same invoice settled in cash

Source: `purchase-posting-template.unit.test.ts:67-84`.

| Ordinal | Account identifier | Debit (fils) | Credit (fils) | Debit (IQD) | Credit (IQD) | Supplier on the line |
| ------- | ------------------ | ------------ | ------------- | ----------- | ------------ | -------------------- |
| 1       | `inventory`        | 160,000      | —             | 160.000     | —            | none                 |
| 2       | `cash`             | —            | 160,000       | —           | 160.000      | none                 |

The valuation debit is identical to GE-1: how the invoice is settled never changes what the stock is worth. ☐ correct ☐ change to: ______

### GE-3 — Changing only the Allowance changes no journal line

Source: `purchase-posting-template.unit.test.ts:98-128`.

| Snapshot Allowance | Primary Supplier Cost (fils) | Cost After Discount (fils) | Journal produced                                              |
| ------------------ | ---------------------------- | -------------------------- | ------------------------------------------------------------- |
| 0 %                | 160,000                      | 160,000                    | debit `inventory` 160,000 / credit `supplier-payable` 160,000 |
| 2.5 %              | 160,000                      | 156,000                    | identical                                                     |
| 40 %               | 160,000                      | 96,000                     | identical                                                     |

☐ correct ☐ change to: ______

### GE-4 — Purchase Invoice Adjustment, quantity 4 → 8 (Delta only)

Facts: one row, unit Primary Supplier Cost 1,000 fils, snapshot Allowance 10 %, quantity corrected from 4 to 8.
Derived Delta: quantity **+4**; Primary Supplier Cost Delta **+4,000 fils (4.000 IQD)**; Cost After Discount Delta **+3,600 fils (3.600 IQD)**.
Source: `purchase-adjustment-delta.unit.test.ts:55-65`, `purchase-adjustment-posting-template.unit.test.ts:6-29`.

| Ordinal | Account identifier | Debit (fils) | Credit (fils) | Debit (IQD) | Credit (IQD) | Supplier on the line   |
| ------- | ------------------ | ------------ | ------------- | ----------- | ------------ | ---------------------- |
| 1       | `inventory`        | 4,000        | —             | 4.000       | —            | none                   |
| 2       | `supplier-payable` | —            | 4,000         | —           | 4.000        | the invoice's supplier |

Unchanged rows on the same invoice produce no line and no Stock Movement. ☐ correct ☐ change to: ______

### GE-5 — Purchase Invoice Adjustment that only moves the debt between suppliers

Facts: no value change; 10,000 fils of payable moves from the originally recorded supplier to the corrected one.
Source: `purchase-adjustment-posting-template.unit.test.ts:31-43`.

| Ordinal | Account identifier | Debit (fils) | Credit (fils) | Debit (IQD) | Credit (IQD) | Supplier on the line           |
| ------- | ------------------ | ------------ | ------------- | ----------- | ------------ | ------------------------------ |
| 1       | `supplier-payable` | 10,000       | —             | 10.000      | —            | the supplier recorded in error |
| 2       | `supplier-payable` | —            | 10,000        | —           | 10.000       | the corrected supplier         |

An adjustment that only corrects the supplier invoice number produces **no journal lines at all** (`:45-53`). ☐ correct ☐ change to: ______

### GE-6 — Purchase Return where inventory value and supplier value differ (the #22 case)

Facts: the returned stock carries a frozen WAC Carrying Amount of **12,000 fils (12.000 IQD)**; the supplier's balance reduces by the original Primary Supplier Cost of **10,000 fils (10.000 IQD)**; the difference is **2,000 fils (2.000 IQD)**.
Source: `purchase-return-posting-template.unit.test.ts:10-40`. Treatment label on the posted document: `inventory-account-offset-pending-g01`.

| Ordinal | Account identifier | Debit (fils) | Credit (fils) | Debit (IQD) | Credit (IQD) | Supplier on the line  |
| ------- | ------------------ | ------------ | ------------- | ----------- | ------------ | --------------------- |
| 1       | `supplier-payable` | 10,000       | —             | 10.000      | —            | the return's supplier |
| 2       | `inventory`        | —            | 12,000        | —           | 12.000       | none                  |
| 3       | `inventory`        | 2,000        | —             | 2.000       | —            | none                  |

Totals 12,000 / 12,000. **This is the item most likely to need correction.** The working default parks the 2,000-fils difference back on `inventory` rather than recognising it. If the approved treatment names a gain/loss or purchase-price-variance account, say which account and on which side. ☐ correct ☐ change to: ______

### GE-7 — Count Session variance

Source: `count-variance-posting-template.unit.test.ts:10-43`.

Shortage of 2 Inventory Units carrying 2,000 fils (2.000 IQD):

| Ordinal | Account identifier         | Debit (fils) | Credit (fils) | Debit (IQD) | Credit (IQD) |
| ------- | -------------------------- | ------------ | ------------- | ----------- | ------------ |
| 1       | `inventory-count-variance` | 2,000        | —             | 2.000       | —            |
| 2       | `inventory`                | —            | 2,000         | —           | 2.000        |

Surplus of 3 Inventory Units carrying 3,000 fils (3.000 IQD):

| Ordinal | Account identifier         | Debit (fils) | Credit (fils) | Debit (IQD) | Credit (IQD) |
| ------- | -------------------------- | ------------ | ------------- | ----------- | ------------ |
| 1       | `inventory`                | 3,000        | —             | 3.000       | —            |
| 2       | `inventory-count-variance` | —            | 3,000         | —           | 3.000        |

A zero variance posts nothing. ☐ correct ☐ change to: ______

### GE-8 — WAC on the Primary Supplier Cost, and what a depletion freezes

Source: `inventory-valuation.unit.test.ts:78-85`, `:172-181`.

| Step      | Quantity | Value added (fils) | Running total value (fils) | Running quantity | Reported average (fils/unit)                    |
| --------- | -------- | ------------------ | -------------------------- | ---------------- | ----------------------------------------------- |
| Receipt 1 | 10       | 10,000             | 10,000                     | 10               | 1,000                                           |
| Receipt 2 | 10       | 30,000             | 40,000                     | 20               | **2,000** — not the last purchase cost of 3,000 |

Depletion at the average that exists when the movement posts: receipts of 80 fils / 8 units and 64 fils / 4 units give 144 fils over 12 units; removing 1 unit freezes a Carrying Amount of **12 fils** and leaves 11 units. A final depletion takes the entire remaining value and leaves no phantom quantity or value. ☐ correct ☐ change to: ______

### GE-9 — Allowance rounded once, then split

Source: `purchase-costs.unit.test.ts:96-104`.

Three lines of 1 fils each at a 50 % Allowance. Half of 3 fils is 1.5, which rounds away from zero to **2 fils**. The 2 fils are split by largest remainder, ties by line order: **1 / 1 / 0**. Cost After Discount **1 fils**. Per-line rounding would have produced a 3-fils allowance and a nil net. ☐ correct ☐ change to: ______

### GE-10 — Calculated selling price, margin on the selling price

Source: `catalog-pricing.unit.test.ts:55-80`, `:124-188`.

| Cost (fils) | Margin      | Rounding setting  | Retail price (fils) | Retail price (IQD) |
| ----------- | ----------- | ----------------- | ------------------- | ------------------ |
| 80,000      | 20 %        | off               | 100,000             | 100.000            |
| 375,000     | 20 %        | off               | 468,750             | 468.750            |
| 300,000     | 20 %        | nearest 250 IQD   | 500,000             | 500.000            |
| 200,000     | 20 %        | nearest 500 IQD   | 500,000             | 500.000            |
| 400,000     | 20 %        | nearest 1,000 IQD | 1,000,000           | 1,000.000          |
| 300,000     | 19.999936 % | nearest 250 IQD   | 250,000             | 250.000            |

☐ correct ☐ change to: ______

---

## 4. The mandatory client test — what this build actually pins

`docs/open-decisions.md` requires that _"the mandatory client test (5,000 primary cost / 4,650 after discount / 4,500 paid / 500 actual allowance / 150 allowance difference / zero balance) must pass unchanged."_

**Verified against the build, not assumed.** The test `apps/local-api/src/purchasing/purchase-costs.unit.test.ts:37-45`, "reproduces the client's five-invoice allowance example", pins the **first three** figures only:

| Figure in the mandatory test                                       | Pinned in the milestone-2 build? | Where                                   |
| ------------------------------------------------------------------ | -------------------------------- | --------------------------------------- |
| Primary Supplier Cost **5,000**                                    | yes                              | `purchase-costs.unit.test.ts:42`        |
| Cost After Discount **4,650** (calculated Allowance 350, i.e. 7 %) | yes                              | `purchase-costs.unit.test.ts:43-44`     |
| Paid **4,500**                                                     | **no**                           | no settlement path exists in this build |
| Actual Allowance **500**                                           | **no**                           | —                                       |
| Allowance Difference **150**                                       | **no**                           | —                                       |
| Supplier balance reaches exactly **zero**                          | **no**                           | —                                       |

Reason, stated plainly rather than as a gap: the last four figures belong to the supplier **payment voucher** and the **Allowance Difference** transaction, which `docs/domain.md` defines as settlement-time transactions. Settlement is milestone 3 (`docs/delivery.md` §"Milestone 3"). A repository-wide search of `apps/` and `packages/` finds no Allowance Difference implementation, no `4,500` settlement figure, and no payment-voucher posting in this build. The milestone-2 half of the mandatory test passes unchanged; the settlement half is pinned at the **milestone-3 G-01 portion**, not here.

The invoice side that milestone 2 does own is already consistent with the client statement: every original invoice keeps its own historical percentage and Cost After Discount, and no later change can alter them (`purchase-costs.unit.test.ts:47-59`, `purchase-posting-template.unit.test.ts:98-128`).

---

## 5. Not in this build: the write-off business-date default

`docs/domain.md` §"Exact quantities, money, and accounting" records:

> An approved write-off debits `Expired and Damaged Inventory Loss` and credits Inventory at the exact carrying amount; **as an engineering default pending G-01, its business date is the expiry date when the daily job detected the expiry and the discovery date otherwise.**

That default has **no milestone-2 implementation**. Approval-based expired/damaged write-offs are milestone 3 (`docs/delivery.md` §"Milestone 3"), delivered by plan #47; the milestone-2 build contains no write-off posting, no `Expired and Damaged Inventory Loss` account code (the closed set at `packages/contracts/src/local-rest/index.ts:3487` has four codes and none is a loss account), and no write-off business-date logic. The only occurrence of the word in the source tree is a prose reference in `apps/local-api/src/inventory/inventory-valuation.ts:59`.

This is recorded as **not in this build**, not as a gap in milestone 2. The write-off business-date rule belongs to the **milestone-3 G-01 portion** and is not part of the approval requested here. Milestone 2's expiry handling stops at detection, blocking, and review (see the G-02 pack).

---

## 6. Signature block

**STATUS: OPEN — milestone-2 portion awaiting accountant approval; schedule paused under scope §13.5 (docs/requirements/breev-phase1-mvp-scope.md). Nothing below is approved.**

**TEMPLATE — UNSIGNED. A block completed inside this repository is not an approval record; the approval is the accountant's / pharmacist's / client's own signed artifact, recorded here by reference (file name, date, who signed).**

### How an approval is recorded

The accountant's signed document — letter, marked-up copy of §3, or countersigned schedule — is stored under `evidence/issue-59/gates/approvals/` (empty now) and referenced from the table below by file name, date, and who signed. Only then does an engineer change the named constant, re-run the named tests, and record both the change and the re-run. Filling in a block here without that artifact records nothing; it is a worksheet for collecting the answer, not the answer.

Final closure of every still-open decision is re-verified again before the release candidate: plan #81 re-checks the duplicate-supplier-invoice-number decision and every scope §19 client decision at that point.

One block per item. "Differs from build?" is the only question that creates work: a **yes** makes the divergence a defect of milestone 2, fixed and retested under this same issue, never recorded as later work.

Standard clause for every item below:

> **Differs from build? yes / no** → if **yes**, the change is a defect fixed and retested under milestone 2 (never later work).
>
> **Approval artifact:** `evidence/issue-59/gates/approvals/____________` — signed by ____________ on ____________.

### Item 1 — WAC on the Primary Supplier Cost, and the scale of intermediates

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/inventory/inventory-valuation.ts` (`INVENTORY_VALUATION_METHOD`, `VALUATION_SCALE`, and the arithmetic in `applyWeightedAverageReceipt` / `applyWeightedAverageDepletion`).
Re-run: `inventory-valuation.unit`, `purchase-posting.integration`, `inventory-count.integration`, `inventory-safety.integration`.

### Item 2 — Purchase invoice journal (`purchase.invoice` v1)

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/accounting/purchase-posting-template.ts` as a **new template revision** (bump `PURCHASE_POSTING_TEMPLATE_VERSION`, add it to `PURCHASE_POSTING_TEMPLATE_VERSIONS`; documents already posted keep v1).
Re-run: `purchase-posting-template.unit`, `purchase-posting.integration`, `purchasing.integration`, contract suite `packages/contracts/src/local-rest/purchasing.test.ts`, browser suite `purchasing`.

### Item 3 — Purchase Invoice Adjustment journal (`purchase.adjustment` v1)

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/accounting/purchase-adjustment-posting-template.ts` as a new revision.
Re-run: `purchase-adjustment-posting-template.unit`, `purchase-adjustment-delta.unit`, `purchase-posting.integration`, browser suite `purchasing`.

### Item 4 — Purchase Return difference treatment (`purchase.return` v1)

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/accounting/purchase-return-posting-template.ts` and the label `PURCHASE_RETURN_G01_WORKING_DEFAULT` in `packages/contracts/src/local-rest/index.ts:4088`; a new account code must be added to `PURCHASE_POSTING_ACCOUNT_CODES` (`index.ts:3487`) if the approved treatment names one.
Re-run: `purchase-return-posting-template.unit`, `purchase-posting.integration`, contract suite `purchasing.test.ts`, browser suite `purchasing`.

### Item 5 — Count Session variance treatment (`inventory.count` v1)

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/accounting/count-variance-posting-template.ts`, the label `COUNT_VARIANCE_G01_WORKING_DEFAULT` (`index.ts:4090`), and `apps/local-api/src/accounting/accounting-persistence.ts:332` if the facts change shape.
Re-run: `count-variance-posting-template.unit`, `inventory-count.integration`, browser suite `count-session`.

### Item 6 — Allowance snapshot and invoice-level allowance allocation

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/purchasing/purchase-costs.ts` (`calculatePurchaseCosts`) and `apps/local-api/src/purchasing/purchasing-domain.ts` (`copyAllowanceSnapshot`).
Re-run: `purchase-costs.unit`, `purchase-posting-template.unit`, `inventory-valuation.unit`, `purchasing.integration`, `purchase-posting.integration`.

### Item 7 — Delta extraction for Purchase Invoice Adjustments

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/purchasing/purchase-adjustment-delta.ts`.
Re-run: `purchase-adjustment-delta.unit`, `purchase-posting.integration`, browser suite `purchasing`, and acceptance scenario 4 (`4 → 8 (4)`).

### Item 8 — Rounding rule and remainder allocation

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/posting/money.ts` — `divideExactRounded`, `allocateFilsProportionally`, and the labels `ROUNDING_RULE` / `REMAINDER_ALLOCATION_RULE`. Changing a label alone would only mislabel the algorithm.
Re-run: `money.unit`, `purchase-costs.unit`, `inventory-valuation.unit`, `catalog-pricing.unit`, and every integration suite that posts money.

### Item 9 — Margin basis and price-rounding steps

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/catalog/catalog-pricing.ts` (`roundingMultiple`, the single rounding call) and `apps/local-api/src/catalog/catalog-exact.ts` (`HALFWAY_RULE`, `roundQuotientToMultiple`).
Re-run: `catalog-pricing.unit`, `purchase-price-capture.unit`, `catalog.integration`, browser suites `catalog` and `purchasing`, and acceptance scenario 2 (cost 80 at 20 % → 100).

---

## 7. العربية — ملخص ما هو مطلوب اعتماده

> ترجمة مجاملة. **النص الإنجليزي أعلاه هو المرجع المعتمد**، وعند أي اختلاف يُعتد بالإنجليزي.

**الحالة: مفتوحة.** الجزء الخاص بالمرحلة الثانية من البوابة G-01 ما زال بانتظار اعتماد المحاسب، والجدول الزمني متوقف بموجب البند 13.5 من نطاق العمل. **لا شيء مما ورد أعلاه معتمد.**

المطلوب من المحاسب مراجعة تسعة إعدادات هندسية حالية (قيم عمل، وليست قواعد معتمدة) واعتمادها أو تصحيحها:

1. طريقة التكلفة: **المتوسط المرجح للتكلفة (WAC)** على **كلفة المورد الأساسية** قبل السماح، مع الاحتفاظ بدقة عشرية عالية بين الترحيلات.
2. قيد فاتورة الشراء (القالب `purchase.invoice` الإصدار 1): مدين المخزون ودائن ذمم الموردين أو الصندوق، بكلفة المورد الأساسية على الطرفين. **السماح لا يُرحَّل مع الفاتورة** بل عند التسوية.
3. قيد **تعديل فاتورة الشراء** (القالب `purchase.adjustment` الإصدار 1): الفرق فقط؛ تصحيح رقم الفاتورة وحده لا ينتج أي قيد.
4. **مرتجع الشراء**: الفرق بين قيمة المخزون المجمدة وتخفيض حساب المورد يُسجَّل حالياً كسطر مقابل على حساب المخزون نفسه (`inventory-account-offset-pending-g01`) دون استحداث حساب فروقات. **هذا البند هو الأرجح أن يحتاج تصحيحاً.**
5. **فروق الجرد**: العجز مدين حساب فروق الجرد ودائن المخزون، والفائض بالعكس.
6. **لقطة السماح**: نسبة المورد السارية بتاريخ الفاتورة تُنسخ داخل الفاتورة ولا تتغير لاحقاً؛ ويُحتسب السماح مرة واحدة على إجمالي الفاتورة ثم يُوزَّع على البنود.
7. استخراج **الفرق (Delta)** في التعديلات: مثال 4 إلى 8 ينتج +4 فقط، والبنود غير المتغيرة لا تنتج أي حركة.
8. قاعدة **التقريب** (نصف بعيداً عن الصفر) وقاعدة **توزيع الباقي** (الأكبر باقياً ثم ترتيب السطور).
9. احتساب سعر البيع: النسبة **هامش على سعر البيع** لا إضافة على الكلفة — كلفة 80 بهامش 20٪ تعطي 100 — مع تقريب اختياري إلى 250 أو 500 أو 1,000 دينار.

**الاختبار الإلزامي للعميل** (5,000 / 4,650 / 4,500 / 500 / 150 / رصيد صفر): الجزء الخاص بالفاتورة (5,000 و4,650 بسماح 350) مثبَّت باختبار آلي في هذه النسخة. أما السداد 4,500 والسماح الفعلي 500 وفرق السماح 150 والرصيد الصفري فتخص **تسوية المورد**، وهي من المرحلة الثالثة وغير مطبقة في هذه النسخة.

كذلك قاعدة **تاريخ الإتلاف/التلف** المذكورة في `docs/domain.md` غير مطبقة في نسخة المرحلة الثانية (الإتلاف من المرحلة الثالثة) وتخص الجزء الثالث من البوابة G-01.

إذا اختلفت أي قيمة معتمدة عمّا تنتجه النسخة الحالية، يُعد ذلك **خللاً يُصلَح ويُعاد اختباره ضمن المرحلة الثانية نفسها**، لا عملاً لاحقاً.
