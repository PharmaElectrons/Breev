# G-02 — Pharmacy inventory policy, milestone-2 portion: working defaults for pharmacist approval

**STATUS: OPEN — milestone-2 portion awaiting pharmacist approval; schedule paused under scope §13.5 (docs/requirements/breev-phase1-mvp-scope.md). Nothing below is approved.**

Build under review: `e73b541` (milestone 2 — Items, Purchases, and Inventory).
Audience: the pharmacist named as G-02's owner in `docs/open-decisions.md`.
Purpose: every product-class rule, threshold, and disposition rule the milestone-2 build applies today, with the file an engineer changes if the approved value differs.

Nothing below is an approved policy. Each value is a **working default** — Breev engineering's current implementation, chosen to be defensible for an Iraqi pharmacy rather than to anticipate your answer. The build says so on the wire: the thresholds payload the desktop reads carries `pendingGate: "G-02"` (`apps/local-api/src/inventory/inventory-safety.service.ts:1007-1015`).

---

## 1. What the gate requires

`docs/open-decisions.md`, §"Client decisions required before final implementation", opening sentence:

> These are the client's own open approvals (scope §19 plus items the requirements leave to approval). **Never present a proposed default as an approved rule.**

`docs/open-decisions.md`, §"Engineering and professional release gates", row **G-02 Pharmacy inventory policy** — decision/evidence required:

> Product classes requiring lot/expiry, whether any product needs a smaller integer base unit for partial-package sales (fractional quantities remain excluded by the scope), near-expiry thresholds, return/restock/disposition/no-invoice return evidence, controlled-medicine and expiry-correction rules.

Same row — confirmed boundary while open:

> Negative stock and expired/recalled/quarantined sale are absolute blocks; movements and snapshots are mandatory.

Owner and blocking scope, same row: _"Pharmacist + legal + product; milestones 2-3"_.

`docs/delivery.md`, §"Milestone 2: Items, Purchases, and Inventory", gates line:

> **Gates.** Accountant approval for WAC-on-primary-cost, allowance, and adjustment golden examples. Pharmacist approval for product-class lot/expiry requirements (G-02).

`docs/domain.md` §"Catalog, purchasing, and inventory" sets the constraint the classes must respect:

> Batch carries product, lot where required, acquisition/receipt evidence, expiry, status, and physical quantity. FEFO selects eligible batches. **The legal/pharmacist gate decides which product classes require lot and complete expiry at receipt. That decision cannot break the uninterrupted keyboard row flow of purchase entry.**

And the safety behaviour the build implements:

> Expired, recalled, and quarantined stock creates a non-overridable sale block. Near-expiry stock remains sellable with a visible warning and FEFO selection. A daily idempotent local job re-evaluates dated batches; missed runs are observable and recover on restart. A monthly review lists expired and unresolved blocked stock. (The sale block, recall/quarantine states, and monthly review are pharmacy-safety engineering defaults beyond the written scope; **G-02 confirms the exact classes and thresholds**.)

`docs/README.md`, §"Requirement language": _"No document may turn a release gate into a guessed default."_

`docs/requirements/breev-phase1-mvp-scope.md` §13.5 "Schedule protection": days spent waiting for client approval do not count as developer implementation delay. Until this approval arrives, the milestone-2 schedule is paused under that clause. An approved value that differs from the build is a **defect of milestone 2**, fixed and retested inside this same issue — never carried into later work.

---

## 2. Not up for approval — the confirmed boundaries

These are settled policy, restated so the approval request is unambiguous about its own edges. They are **absolute** and are not among the items below.

| Boundary                                                                                                                             | How the build enforces it                                                                                                                                                                                                                             | Pinning test                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expired, recalled, and quarantined stock cannot be sold or allocated.** No permission, role, or Step-Up Authorization overrides it | `apps/local-api/src/inventory/inventory-eligibility.ts:17-22` `HARD_BLOCK_STATUSES` = `expired`, `recalled`, `quarantined`, `postponed-blocked`; `isAllocatable` admits only `eligible` and `near-expiry`                                             | `apps/local-api/src/inventory/inventory-safety-no-override.integration.test.ts:202` — "refuses every hard-blocked batch for every role and Step-Up state" (the role × Step-Up-state × blocked-status matrix, driven over HTTP and in process) |
| **Negative stock is refused.** No post may make a balance negative                                                                   | `apps/local-api/src/inventory/inventory-valuation.ts:149-154` refuses a depletion beyond the held quantity; the posting path refuses the movement                                                                                                     | `evidence/issue-59/seams/purchase-posting.integration.txt`, `evidence/issue-59/seams/inventory-safety-no-override.integration.txt`                                                                                                            |
| **Movements and snapshots are mandatory and append-only.** Safety facts cannot be edited or deleted                                  | `apps/local-api/drizzle/0022_batch_safety.sql:63-65` and `:111-113` install `reject_posting_fact_mutation()` triggers on the status-event and expiry-amendment tables; both are `select, insert` only for the application role (`:67-69`, `:115-117`) | `apps/local-api/src/inventory/inventory-safety.integration.test.ts:352` — "rejects direct mutation and preserves the business-date boundary"                                                                                                  |
| **No fractional base-unit balance.** Package units convert to the Inventory Unit by positive integer ratios only                     | `apps/local-api/src/posting/money.ts:66-68` `InventoryQuantity` is an exact integer type; quantity columns are `bigint`                                                                                                                               | `evidence/issue-59/seams/catalog-packaging.unit.txt`, `evidence/issue-59/seams/inventory-count.unit.txt`                                                                                                                                      |

Confirming these is welcome; changing them is out of scope for this gate.

---

## 3. Every G-02 working default in the milestone-2 build

Nine items.

| #   | Item                                           | File and exported constant                                                                                                                                                                                                                                                                                                                                                         | Version marker                                                        | Current value (working default)                                                                                                                                                                                                                                                                                                                                                                                               | Golden figures the build produces                                                                                                                                                                                                                                                                          | Pinning test (file + test title)                                                                                                                                                                                                                                                                                               | Re-run result                                                                                                                      |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The receipt classes themselves                 | `apps/local-api/src/inventory/inventory-receipt-rules.ts:49-54` `INVENTORY_RECEIPT_CLASSES`; PostgreSQL enum `inventory_receipt_class` and table `inventory_receipt_class_rules` (`apps/local-api/drizzle/0017_post_purchases_atomically.sql:72-78`)                                                                                                                               | schema migration 0017; no separate version constant                   | Four classes, derived from Catalog facts the pharmacy already records (`definitionMode` = medication or general item × `coldStorageRequired`): `general-item`, `general-item-cold-chain`, `medication`, `medication-cold-chain`                                                                                                                                                                                               | `receiptClassOf` maps a medication needing cold storage to `medication-cold-chain`, a medication otherwise to `medication`, and the general item likewise                                                                                                                                                  | `apps/local-api/src/inventory/inventory-receipt-rules.unit.test.ts` — "derives the class from product facts Catalog already stores"; "has a rule for every class it can name"                                                                                                                                                  | `evidence/issue-59/seams/inventory-receipt-rules.unit.txt`                                                                         |
| 2   | Complete **expiry date** required at receipt   | `apps/local-api/src/inventory/inventory-receipt-rules.ts:76-98` `DEFAULT_RECEIPT_CLASS_RULES` (`expiryRequired`)                                                                                                                                                                                                                                                                   | frozen object; migration 0017 column `expiry_required`                | Required for `medication`, `medication-cold-chain`, `general-item-cold-chain`. **Not** required for a plain `general-item`                                                                                                                                                                                                                                                                                                    | See the class-rule table in §4                                                                                                                                                                                                                                                                             | `inventory-receipt-rules.unit.test.ts:76` — "is the current G-02 engineering default, not approved policy"                                                                                                                                                                                                                     | `evidence/issue-59/seams/inventory-receipt-rules.unit.txt`                                                                         |
| 3   | **Lot number** required at receipt             | same constant (`lotRequired`); migration 0017 column `lot_required`                                                                                                                                                                                                                                                                                                                | as above                                                              | Required for `medication-cold-chain` **only**                                                                                                                                                                                                                                                                                                                                                                                 | See §4                                                                                                                                                                                                                                                                                                     | `inventory-receipt-rules.unit.test.ts:76` — same test                                                                                                                                                                                                                                                                          | `evidence/issue-59/seams/inventory-receipt-rules.unit.txt`                                                                         |
| 4   | **Near-expiry threshold**                      | `apps/local-api/src/inventory/inventory-receipt-rules.ts:63` `DEFAULT_NEAR_EXPIRY_DAYS`; column added by `apps/local-api/drizzle/0022_batch_safety.sql:1-4`                                                                                                                                                                                                                        | migration 0022; column default 90, check `between 1 and 730`          | **90 days** for all four classes. A batch expiring in 90 days or fewer (and not yet expired) reads `near-expiry`: still sellable, shown with a warning, and still picked by FEFO                                                                                                                                                                                                                                              | `evaluateBatchEligibility` returns `near-expiry` when `daysBetween(businessDate, expiry) <= nearExpiryDays` and `expired` when that difference is negative (`apps/local-api/src/inventory/inventory-eligibility.ts:36-48`)                                                                                 | `inventory-receipt-rules.unit.test.ts:76` pins `nearExpiryDays: 90` for each class; `apps/local-api/src/inventory/inventory-eligibility.unit.test.ts` pins the boundary behaviour                                                                                                                                              | `evidence/issue-59/seams/inventory-receipt-rules.unit.txt`, `evidence/issue-59/seams/inventory-eligibility.unit.txt`               |
| 5   | How the rules are stored and configured        | `apps/local-api/src/inventory/inventory-persistence.ts:43-62` `resolveReceiptClassRuleSet`; `:186` `readNearExpiryDays`; selection at `inventory-receipt-rules.ts:134` `receiptRuleFor`                                                                                                                                                                                            | rows in `inventory_receipt_class_rules`, keyed `(pharmacy_id, class)` | Every pharmacy is **seeded** with the four default rows on first use and reads its own rows thereafter. There is one policy path: a configured value is data flowing through `receiptRuleFor`, never a second code path. Applying an approved value is therefore a data change plus a change to the seeded default                                                                                                            | Seeding inserts `('general-item', false, false, 90)`, `('general-item-cold-chain', true, false, 90)`, `('medication', true, false, 90)`, `('medication-cold-chain', true, true, 90)`                                                                                                                       | `inventory-receipt-rules.unit.test.ts` — "uses the shipped default when no configuration is supplied"; "uses the pharmacy's configured rule when one is supplied"; "follows a configured override in both directions"                                                                                                          | `evidence/issue-59/seams/inventory-receipt-rules.unit.txt`                                                                         |
| 6   | What happens when receipt evidence is missing  | `apps/local-api/src/inventory/inventory-receipt-rules.ts:152` `checkReceiptEvidence`                                                                                                                                                                                                                                                                                               | —                                                                     | The row is refused with a **named reason** (`expiry-required` or `lot-required`) rather than being silently accepted or rejected without cause. Expiry is reported before lot, so a row missing both names the fact that blocks a sale                                                                                                                                                                                        | A purchase draft row missing required evidence keeps the draft and names the rule; the purchase does not post                                                                                                                                                                                              | `inventory-receipt-rules.unit.test.ts` — "names the missing evidence rather than refusing without a reason"; "reports the sale-blocking gap first when both are missing"; `apps/local-api/src/purchasing/purchase-posting.integration.test.ts:868` — "keeps the draft and names the row rule when receipt evidence is missing" | `evidence/issue-59/seams/inventory-receipt-rules.unit.txt`, `evidence/issue-59/seams/purchase-posting.integration.txt`             |
| 7   | **Disposition kinds and who may set them**     | `apps/local-api/drizzle/0022_batch_safety.sql:9-58` table `inventory_batch_status_events`; `packages/contracts/src/local-rest/index.ts:2465-2470` `BATCH_STATUS_EVENT_KINDS`, `:2593-2598` `inventoryBatchStatusChangeRequestSchema`; `apps/local-api/src/inventory/inventory-safety.service.ts:70` `SAFETY_PERMISSION`, `:73` `STATUS_COMMAND`                                    | migration 0022; append-only with an immutability trigger              | Three kinds: **expired**, **recalled**, **quarantined**. A _user_ may set only `recall` or `quarantine`, and only with a reason (1–500 chars) and evidence (1–1,000 chars), holding `inventory.batch_safety.manage`. **`expired` can be written only by the daily evaluator** — the database check refuses a user-sourced `expired` row, and refuses a daily-evaluator row that carries an actor, device, reason, or evidence | Permission `inventory.batch_safety.manage` is granted at migration time to the `owner`, `manager`, and `pharmacist` roles (`0022_batch_safety.sql:146-190`). Every event freezes batch, product, kind, source, reason, evidence, business date, actor, device, and an ordered sequence                     | `apps/local-api/src/inventory/inventory-safety.integration.test.ts:117` — "enforces FEFO, hard blocks, daily detection, append-only facts, and correction"; `inventory-safety-no-override.integration.test.ts:322` — "lists every expired and unresolved recalled or quarantined batch in the monthly review"                  | `evidence/issue-59/seams/inventory-safety.integration.txt`, `evidence/issue-59/seams/inventory-safety-no-override.integration.txt` |
| 8   | **Expiry correction rule**                     | `apps/local-api/drizzle/0022_batch_safety.sql:71-106` table `inventory_batch_expiry_amendments`, `:150-155` Step-Up action; `apps/local-api/src/inventory/inventory-safety.service.ts:74` `EXPIRY_COMMAND`, `:730-752`; `packages/contracts/src/local-rest/index.ts:2614-2620`                                                                                                     | migration 0022; append-only with an immutability trigger              | Correcting a wrong expiry date requires **Step-Up Authorization** on the named action `inventory.batch_expiry.correct` (backed by permission `inventory.batch_safety.manage`), plus a **reason** and **evidence**, both mandatory. The **original expiry date is kept** on the amendment row; the corrected date must actually differ, and a correction to the same date is refused                                           | The amendment stores `original_expiry_date`, `corrected_expiry_date`, reason, evidence, business date, actor, device, and the consumed Step-Up challenge id (unique, so one challenge cannot authorise two corrections). The batch's effective expiry becomes the latest amendment; nothing is overwritten | `inventory-safety.integration.test.ts:117` (correction half) and `:603` — "reports an unavailable runtime and audits Step-Up correction denials"                                                                                                                                                                               | `evidence/issue-59/seams/inventory-safety.integration.txt`                                                                         |
| 9   | **Daily re-evaluation job and monthly review** | `apps/local-api/src/inventory/inventory-safety.service.ts:69` `INVENTORY_BATCH_SAFETY_QUEUE` = `"inventory.batch-safety.evaluate"`, `:823` `readMonthlyReview`, `:71` `REVIEW_PERMISSION` = `inventory.review`; `apps/local-api/drizzle/0022_batch_safety.sql:119-133` table `inventory_batch_safety_runs`; evaluator `apps/local-api/src/inventory/inventory-safety-evaluator.ts` | migration 0022; runs keyed `(pharmacy_id, business_date)`, immutable  | A daily idempotent job re-evaluates dated batches per pharmacy business date; triggers are `scheduled`, `catch-up`, `manual`, `startup`; a missed day is visible (`never-run` / `behind` / `current`) and recovers on restart. The **monthly review** lists expired and unresolved recalled or quarantined batches with stock, for a chosen month                                                                             | Each run records evaluated, newly-expired, and near-expiry counts once per business date; a second run for the same date cannot duplicate an expiry event                                                                                                                                                  | `inventory-safety.integration.test.ts:117` (daily detection) and `:439` — "recovers the real queue across claim, date-commit, final-commit, and duplicate-delivery crashes"; `inventory-safety-no-override.integration.test.ts:322` (monthly review)                                                                           | `evidence/issue-59/seams/inventory-safety.integration.txt`, `evidence/issue-59/seams/inventory-safety-no-override.integration.txt` |

---

## 4. The per-class rule table, as the build applies it

This is the single table the approval turns on. Source: `apps/local-api/src/inventory/inventory-receipt-rules.ts:76-98`, seeded per pharmacy at `apps/local-api/src/inventory/inventory-persistence.ts:47-62`, pinned by `inventory-receipt-rules.unit.test.ts:76` ("is the current G-02 engineering default, not approved policy").

| Receipt class             | Which products fall in it                          | Complete expiry required at receipt | Lot number required at receipt | Near-expiry threshold | Tick or correct               |
| ------------------------- | -------------------------------------------------- | ----------------------------------- | ------------------------------ | --------------------- | ----------------------------- |
| `medication`              | A product defined as a medication, no cold storage | **yes**                             | no                             | **90 days**           | ☐ correct ☐ change to: ______ |
| `medication-cold-chain`   | A medication flagged as needing cold storage       | **yes**                             | **yes**                        | **90 days**           | ☐ correct ☐ change to: ______ |
| `general-item-cold-chain` | A general item flagged as needing cold storage     | **yes**                             | no                             | **90 days**           | ☐ correct ☐ change to: ______ |
| `general-item`            | A general item, no cold storage                    | **no**                              | no                             | **90 days**           | ☐ correct ☐ change to: ______ |

Why each cell is what it is, stated so you can disagree with the reasoning and not only the value (`inventory-receipt-rules.ts:30-40`):

- Medicines need an expiry date because expiry drives a non-overridable sale block and FEFO picking; a Batch with no expiry could take part in neither.
- Cold-chain stock additionally needs a lot number, because a cold-chain recall has to reach an identified lot rather than a whole product.
- A plain general item needs neither by default. Requiring an expiry there would stop the uninterrupted keyboard row flow of purchase entry for evidence the supplier may not print at all — which `docs/domain.md` forbids this decision from doing.

**The near-expiry threshold is per class**, not global: the column is `near_expiry_days` on each `inventory_receipt_class_rules` row, constrained to **1–730 days** (`apps/local-api/drizzle/0022_batch_safety.sql:1-4`). The build sets all four to 90. If you want, say, 180 days for cold-chain medication and 90 for the rest, that is a data change within the existing constraint and needs no new capability.

**Near-expiry means warned, not blocked.** A batch at or within its threshold reads `near-expiry`: it remains sellable, FEFO still picks it first when it expires first, and the interface shows the warning. Only `expired`, `recalled`, `quarantined`, and `postponed-blocked` block (`apps/local-api/src/inventory/inventory-eligibility.ts:17-22, 36-48`).

---

## 5. Dispositions, corrections, and reviews, in detail

### 5.1 Disposition kinds and the authority for each

Source: `apps/local-api/drizzle/0022_batch_safety.sql:9-58`, `packages/contracts/src/local-rest/index.ts:2465-2470` and `:2593-2598`, `apps/local-api/src/inventory/inventory-safety.service.ts:430-530`.

| Kind          | Who may set it                                                                                              | What is required                                                                          | Effect on sale and FEFO                | Reversible?                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `expired`     | **The daily evaluator only.** No user route exists; the database check rejects a user-sourced `expired` row | nothing from a user; the evaluator writes no actor, device, reason, or evidence           | Absolute block (Regulatory Hard Block) | Only by an expiry correction (§5.2), never by an override                                |
| `recalled`    | A user holding `inventory.batch_safety.manage` — seeded to **owner, manager, pharmacist**                   | reason (1–500 chars) **and** evidence (1–1,000 chars), both mandatory; an idempotency key | Absolute block                         | A recalled batch cannot be recalled again; the event is append-only and is never deleted |
| `quarantined` | Same permission and same mandatory reason and evidence                                                      | reason and evidence, mandatory                                                            | Absolute block                         | Append-only; resolution is recorded as a further event, never an edit                    |

Every event freezes the batch, product, kind, source, reason, evidence, business date, actor, device, and an ordered sequence, and cannot afterwards be updated or deleted (immutability trigger, `0022_batch_safety.sql:63-65`).

☐ the kinds are right ☐ the authority is right ☐ change to: ______

**Not in this build:** the disposition _outcomes_ that follow a quarantine or recall — owner-approved supplier return, write-off, or destruction, and the postponed quantity — are milestone 3 (`docs/delivery.md` §"Milestone 3": "Approval-based expired/damaged write-offs"). The build already refuses to sell a `postponed-blocked` batch, so the safety boundary is in place ahead of the workflow.

### 5.2 The expiry-correction rule

Source: `apps/local-api/drizzle/0022_batch_safety.sql:71-106`, `:150-155`; `apps/local-api/src/inventory/inventory-safety.service.ts:717-752`; `packages/contracts/src/local-rest/index.ts:2614-2620`.

Correcting an expiry date recorded in error requires **all** of the following, and the build refuses the correction if any is missing:

1. Permission `inventory.batch_safety.manage` (owner, manager, pharmacist by seed).
2. **Step-Up Authorization** on the named action `inventory.batch_expiry.correct` — immediate reauthentication by the same authorized user. The consumed challenge id is stored on the amendment and is **unique**, so one Step-Up cannot authorise two corrections.
3. A **reason** (1–500 characters).
4. **Evidence** (1–1,000 characters).
5. A corrected date that actually differs from the current effective expiry; an unchanged correction is refused (`expiry-correction-unchanged`).

**The original expiry date is kept.** The amendment row stores `original_expiry_date` beside `corrected_expiry_date`, with business date, actor, device, and sequence. Nothing overwrites the Batch's received facts: the effective expiry is the latest amendment, and the receipt record stands (`0022_batch_safety.sql:6-7` records the same principle for status).

☐ correct ☐ change to: ______

### 5.3 The daily job and the monthly review

Source: `apps/local-api/src/inventory/inventory-safety.service.ts:69`, `:823-918`, `:1007-1015`; `apps/local-api/drizzle/0022_batch_safety.sql:119-133`.

- A **daily idempotent job** (`inventory.batch-safety.evaluate`) re-evaluates dated batches once per pharmacy business date. Triggers are `scheduled`, `catch-up`, `manual`, and `startup`. A run records evaluated, newly-expired, and near-expiry counts, keyed by business date so a repeat cannot double-count.
- **Missed runs are observable and recover.** The status payload reports `never-run`, `behind`, or `current`, names the missed business dates, and says whether the job runtime is available.
- The **monthly review** (`inventory.review` permission) lists, for a chosen month, every expired batch and every unresolved recalled or quarantined batch that still holds stock.
- The same status payload carries the whole class-rule table and the literal marker `pendingGate: "G-02"`, so no screen can present these values as settled.

☐ the daily cadence is right ☐ the monthly review contents are right ☐ change to: ______

---

## 6. Signature block

**STATUS: OPEN — milestone-2 portion awaiting pharmacist approval; schedule paused under scope §13.5 (docs/requirements/breev-phase1-mvp-scope.md). Nothing below is approved.**

**TEMPLATE — UNSIGNED. A block completed inside this repository is not an approval record; the approval is the accountant's / pharmacist's / client's own signed artifact, recorded here by reference (file name, date, who signed).**

### How an approval is recorded

The pharmacist's signed document — letter, marked-up copy of the §4 class-rule table, or countersigned schedule — is stored under `evidence/issue-59/gates/approvals/` (empty now) and referenced from the table below by file name, date, and who signed. Only then does an engineer change the named constant, re-run the named tests, and record both the change and the re-run. Filling in a block here without that artifact records nothing; it is a worksheet for collecting the answer, not the answer.

One block per item. "Differs from build?" is the only question that creates work: a **yes** makes the divergence a defect of milestone 2, fixed and retested under this same issue, never recorded as later work.

Standard clause for every item below:

> **Differs from build? yes / no** → if **yes**, the change is a defect fixed and retested under milestone 2 (never later work).
>
> **Approval artifact:** `evidence/issue-59/gates/approvals/____________` — signed by ____________ on ____________.

### Item 1 — The four receipt classes

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/inventory/inventory-receipt-rules.ts` (`INVENTORY_RECEIPT_CLASSES`, `receiptClassOf`) **and** the PostgreSQL enum `inventory_receipt_class` through a new forward migration (the enum is created in `apps/local-api/drizzle/0017_post_purchases_atomically.sql`). Adding or removing a class is a schema change, not a data change.
Re-run: `inventory-receipt-rules.unit`, `inventory-safety.integration`, `purchase-posting.integration`, browser suite `batch-safety`.

### Item 2 — Which classes require a complete expiry date at receipt

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/inventory/inventory-receipt-rules.ts` `DEFAULT_RECEIPT_CLASS_RULES` (the shipped seed) **and** a forward migration updating existing `inventory_receipt_class_rules.expiry_required` rows, since seeded pharmacies already hold their own copy.
Re-run: `inventory-receipt-rules.unit`, `purchase-posting.integration`, `purchasing.integration`, browser suite `purchasing`.

### Item 3 — Which classes require a lot number at receipt

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: same constant (`lotRequired`) plus the same forward migration on `inventory_receipt_class_rules.lot_required`.
Re-run: `inventory-receipt-rules.unit`, `purchase-posting.integration`, browser suite `purchasing`.

### Item 4 — The near-expiry threshold, per class

Approved value (days, per class): ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/inventory/inventory-receipt-rules.ts` `DEFAULT_NEAR_EXPIRY_DAYS` and the per-class `nearExpiryDays` entries, the seeding literals in `apps/local-api/src/inventory/inventory-persistence.ts:47-62`, and a forward migration for existing rows. A value outside **1–730** additionally needs the check constraint in `apps/local-api/drizzle/0022_batch_safety.sql:1-4` amended.
Re-run: `inventory-receipt-rules.unit`, `inventory-eligibility.unit`, `inventory-safety.integration`, `inventory-safety-no-override.integration`, browser suite `batch-safety`.

### Item 5 — Storage and per-pharmacy configuration of the rules

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/inventory/inventory-persistence.ts` (`resolveReceiptClassRuleSet`, `readNearExpiryDays`) and `inventory-receipt-rules.ts` (`receiptRuleFor`).
Re-run: `inventory-receipt-rules.unit`, `inventory-safety.integration`.

### Item 6 — Behaviour when required receipt evidence is missing

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/inventory/inventory-receipt-rules.ts` (`checkReceiptEvidence`) and the renderer message for the named rule in `apps/desktop/src/renderer/src/purchasing-messages.ts`.
Re-run: `inventory-receipt-rules.unit`, `purchase-posting.integration`, browser suite `purchasing`.

### Item 7 — Disposition kinds and who may set them

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `packages/contracts/src/local-rest/index.ts` (`BATCH_STATUS_EVENT_KINDS`, `inventoryBatchStatusChangeRequestSchema`), `apps/local-api/src/inventory/inventory-safety.service.ts` (`SAFETY_PERMISSION`, the status-change path), and a forward migration for the `kind` and `source_shape` check constraints and the role grants in `apps/local-api/drizzle/0022_batch_safety.sql:15, 40-57, 146-190`.
Re-run: `inventory-safety.integration`, `inventory-safety-no-override.integration`, contract suite `packages/contracts/src/local-rest/inventory.test.ts`, browser suite `batch-safety`.

### Item 8 — The expiry-correction rule (Step-Up, reason, evidence, original date kept)

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `packages/contracts/src/local-rest/index.ts:2614-2620`, `apps/local-api/src/inventory/inventory-safety.service.ts` (`EXPIRY_COMMAND` path), and a forward migration for the amendment table constraints and the Step-Up action definition in `apps/local-api/drizzle/0022_batch_safety.sql:71-106, 150-155`.
Re-run: `inventory-safety.integration`, `inventory-safety-no-override.integration`, browser suite `batch-safety`.

### Item 9 — Daily re-evaluation cadence and the monthly review

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/inventory/inventory-safety-evaluator.ts` and `apps/local-api/src/inventory/inventory-safety.service.ts` (`INVENTORY_BATCH_SAFETY_QUEUE`, `readMonthlyReview`).
Re-run: `inventory-safety.integration`, `inventory-safety-no-override.integration`, browser suite `batch-safety`.

---

## 7. العربية — ملخص ما هو مطلوب اعتماده

> ترجمة مجاملة. **النص الإنجليزي أعلاه هو المرجع المعتمد**، وعند أي اختلاف يُعتد بالإنجليزي.

**الحالة: مفتوحة.** الجزء الخاص بالمرحلة الثانية من البوابة G-02 ما زال بانتظار اعتماد الصيدلاني، والجدول الزمني متوقف بموجب البند 13.5 من نطاق العمل. **لا شيء مما ورد أعلاه معتمد.**

**حدود مؤكدة غير مطروحة للاعتماد:** منع الرصيد السالب، ومنع بيع المخزون **منتهي الصلاحية أو المسحوب أو المحجوز** منعاً مطلقاً لا يتجاوزه أي صلاحية أو إعادة توثيق (Step-Up)، وإلزامية الحركات واللقطات. هذه سياسة مستقرة ولا تُعاد مناقشتها هنا.

المطلوب من الصيدلاني مراجعة تسعة إعدادات هندسية حالية (قيم عمل، وليست سياسة معتمدة):

| الفئة                 | تاريخ الصلاحية مطلوب عند الاستلام | رقم التشغيلة (Lot) مطلوب | حد قرب انتهاء الصلاحية |
| --------------------- | --------------------------------- | ------------------------ | ---------------------- |
| دواء                  | **نعم**                           | لا                       | **90 يوماً**           |
| دواء يحتاج تبريداً    | **نعم**                           | **نعم**                  | **90 يوماً**           |
| صنف عام يحتاج تبريداً | **نعم**                           | لا                       | **90 يوماً**           |
| صنف عام               | **لا**                            | لا                       | **90 يوماً**           |

كذلك:

- **حد قرب انتهاء الصلاحية 90 يوماً** لكل فئة على حدة، ومسموح تقنياً بين 1 و730 يوماً. «قرب الانتهاء» يعني **تحذيراً مع استمرار البيع** وأولوية الصرف حسب **FEFO**، وليس منعاً.
- **حالات التصرف بالمخزون**: منتهي الصلاحية يسجّله **المُقيِّم اليومي فقط**؛ أما السحب (Recall) والحجز (Quarantine) فيسجلهما مستخدم يملك صلاحية `inventory.batch_safety.manage` (تُمنح ابتداءً للمالك والمدير والصيدلاني) **مع سبب ودليل إلزاميين**. كل الوقائع تُضاف ولا تُعدَّل ولا تُحذف.
- **تصحيح تاريخ الصلاحية**: يتطلب **إعادة توثيق فورية (Step-Up Authorization)** على الإجراء `inventory.batch_expiry.correct`، مع **سبب ودليل** إلزاميين، و**يُحتفظ بالتاريخ الأصلي** إلى جانب التاريخ المصحَّح.
- **مهمة يومية** تُعيد تقييم الدفعات المؤرخة، وأي يوم فائت يظهر ويُستدرك عند التشغيل، إضافة إلى **مراجعة شهرية** تسرد المنتهي والمسحوب والمحجوز غير المعالج.

إذا اختلفت أي قيمة معتمدة عمّا تنتجه النسخة الحالية، يُعد ذلك **خللاً يُصلَح ويُعاد اختباره ضمن المرحلة الثانية نفسها**، لا عملاً لاحقاً.
