# Duplicate supplier invoice number — client decision record

**STATUS: client decision still open — working default is warn, UNAPPROVED; re-verified before the release candidate (plan #81).**

Build under review: `e73b541` (milestone 2 — Items, Purchases, and Inventory).
Audience: the client, as the owner of this decision.
Purpose: state exactly what the build does today when the same supplier invoice number is entered twice for the same supplier, so the decision can be made against real behaviour rather than a description.

The current behaviour — **warn, never block** — is a working default. It is not approved, and the build says so on the wire rather than only in this document: every warning carries `operationalRule: "warn-open-decision"`.

---

## 1. What the decision requires

`docs/open-decisions.md`, §"Client decisions required before final implementation", opening sentence:

> These are the client's own open approvals (scope §19 plus items the requirements leave to approval). **Never present a proposed default as an approved rule.**

Same section, the row itself:

| Decision                          | Required approval                                                             | Working default while open |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| Duplicate supplier invoice number | Block, or allow after a permission-controlled warning, for the same supplier. | Warn.                      |

So the client is asked to choose between exactly two approved outcomes:

- **Block** — the second document with the same number for the same supplier is refused.
- **Allow after a permission-controlled warning** — the warning stands, and passing it requires a named permission.

The build implements **neither** of those. It implements a third thing, deliberately labelled as unsettled: an **unconditional warning that is not permission-controlled and never blocks**. That is the gap this record exists to make visible.

`docs/delivery.md`, §"Milestone 2: Items, Purchases, and Inventory", gates line, for context on what milestone 2's gates are:

> **Gates.** Accountant approval for WAC-on-primary-cost, allowance, and adjustment golden examples. Pharmacist approval for product-class lot/expiry requirements (G-02).

The duplicate-number decision is a **client decision**, not one of those two professional gates. It does not block milestone-2 acceptance on its own; its status simply has to be recorded, with the working default labelled unapproved.

`docs/README.md`, §"Requirement language": _"No document may turn a release gate into a guessed default."_

`docs/requirements/breev-phase1-mvp-scope.md` §13.5 "Schedule protection": days spent waiting for client approval or accounting decisions do not count as developer implementation delay.

Final closure of every still-open decision is re-verified again before the release candidate: plan #81 re-checks the duplicate-supplier-invoice-number decision and every scope §19 client decision at that point. If the approved choice changes this working default, issues #15 and #19 are updated and retested before the release candidate.

---

## 2. What the build does today

Three working defaults. Money, permissions, and supplier identity behave the same on both the draft side and the posting side.

| #   | Item                                                                                 | File and exported constant                                                                                                                                                                                                                                                                           | Version marker                                                                                | Current value (working default)                                                                                                                                                                                                                                                                                                                                                                                                                   | Golden figures the build produces                                                                                                                                                                                                                                                                            | Pinning test (file + test title)                                                                                                                                                                | Re-run result                                              |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | Draft-side warning when a supplier invoice number is already on another active draft | `apps/local-api/src/purchasing/purchasing.service.ts:472` `draftResult` (query `:477-501`, warning `:505-515`); wire shape `packages/contracts/src/local-rest/index.ts:3373-3377` `purchaseDraftWarningSchema`, carried by `purchaseDraftResultSchema` `:3378-3381`                                  | schema constant, no version number; the literal `operationalRule` value is the version marker | The draft **saves**. The result carries one warning: `code: "duplicate-supplier-invoice-number"`, `existingDraftIds: [...]` (at least one, ordered by creation), `operationalRule: "warn-open-decision"`. No permission is consulted. The check follows supplier merges: a merged-away supplier and its survivor count as the same supplier                                                                                                       | Creating a second active draft with number `INV-100` for the same supplier returns **201** with that warning; a draft with the same number for a _different_ supplier returns no warning. After a supplier merge, saving `MERGED-DUP` against the pre-merge supplier warns and names the survivor's draft id | `apps/local-api/src/purchasing/purchasing.integration.test.ts:194` — "warns for the same supplier number, allows saving, and ignores another supplier"; `:396-418` — the post-merge alias case  | `evidence/issue-59/seams/purchasing.integration.txt`       |
| 2   | Posting-side warning when the number is already on a posted purchase                 | `apps/local-api/src/purchasing/purchasing.service.ts:2310-2315` (call) and `:1028-1060` `postedPurchaseWarnings`; warning emitted `:2561-2571`; wire shape `packages/contracts/src/local-rest/index.ts:3605-3609` `purchasePostingWarningSchema`, carried by `purchasePostResultSchema` `:3611-3614` | as above                                                                                      | The purchase **posts**. The result carries one warning: `code: "duplicate-supplier-invoice-number"`, `existingPostingIds: [...]`, `operationalRule: "warn-open-decision"`. No permission is consulted, and no Step-Up Authorization is required. Supplier-merge aliases are followed the same way                                                                                                                                                 | Posting a second invoice numbered `INV-DUPLICATE-POSTED` for the same supplier returns **201** with `existingPostingIds` equal to the first posted purchase's id and `operationalRule: "warn-open-decision"`                                                                                                 | `apps/local-api/src/purchasing/purchase-posting.integration.test.ts:831` — "warns but still posts a duplicate supplier invoice number"                                                          | `evidence/issue-59/seams/purchase-posting.integration.txt` |
| 3   | The unapproved status is part of the contract, not only of the documentation         | `packages/contracts/src/local-rest/index.ts:3599-3604` (the doc comment above `purchasePostingWarningSchema`), `:3376` and `:3608` (`operationalRule: z.literal("warn-open-decision")`)                                                                                                              | the literal `"warn-open-decision"`                                                            | The wire field exists so that no caller — renderer, report, or future integration — can mistake the current behaviour for a settled one. The contract comment reads: _"A duplicate supplier invoice number never blocks a post. The working default recorded in docs/open-decisions.md is **warn**, and it is not an approved decision: `operationalRule` says so on the wire so no caller can mistake the current behaviour for a settled one."_ | The contract suite asserts the warning type is non-blocking and that `operationalRule` is exactly `"warn-open-decision"`                                                                                                                                                                                     | `packages/contracts/src/local-rest/purchasing.test.ts:142` — "models the duplicate as a non-blocking typed warning"; `:404` — "warns rather than blocks on a duplicate supplier invoice number" | `evidence/issue-59/seams/purchasing.contracts.txt`         |

Note on the last row's re-run reference: `packages/contracts/src/local-rest/purchasing.test.ts` is a contract suite. It runs inside the workspace unit run, and W2 records it as `evidence/issue-59/seams/purchasing.contracts.txt`.

### What the pharmacy user sees

Renderer strings, English authoritative, Arabic shipped beside it (`apps/desktop/src/renderer/src/purchasing-messages.ts`):

| Where                    | English (`:97-100`, `:210-211`)                                                                                                     | Arabic (`:359-362`, `:470-471`)                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Draft warning            | "This supplier invoice number is already recorded for the same supplier. Saving remains allowed while the client decision is open." | «رقم فاتورة المورد مسجل بالفعل لنفس المورد. يظل الحفظ مسموحاً حتى حسم قرار العميل.» |
| Draft warning, rule line | "Current rule: warn. The duplicate-number rule still awaits milestone approval."                                                    | «القاعدة الحالية: تحذير. ما زالت قاعدة الرقم المكرر بانتظار اعتماد نهاية المرحلة.»  |
| After posting            | "Duplicate supplier invoice warning: posting remained allowed under the current open decision."                                     | «تحذير تكرار فاتورة المورد: ظل الترحيل مسموحاً وفق القرار المفتوح الحالي.»          |

Both languages name the decision as open. Neither presents the behaviour as a rule the client has accepted.

---

## 3. Worked example, end to end

Facts: supplier _Al-Nahrain_; supplier invoice number `INV-DUPLICATE-POSTED`; both invoices settled on credit.
Source: `apps/local-api/src/purchasing/purchase-posting.integration.test.ts:831-866`.

| Step | Request                                                                                           | Result                           | Warning                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Post the first purchase, one row at 900 fils (0.900 IQD)                                          | **201 Created**, purchase posted | none                                                                                                                                 |
| 2    | Create a second draft for the same supplier with the same number, one row at 950 fils (0.950 IQD) | draft saved                      | `duplicate-supplier-invoice-number`, `existingDraftIds` naming any other active draft, `operationalRule: "warn-open-decision"`       |
| 3    | Post the second purchase                                                                          | **201 Created**, purchase posted | `duplicate-supplier-invoice-number`, `existingPostingIds: [id of the purchase from step 1]`, `operationalRule: "warn-open-decision"` |

Both purchases exist, both are immutable posted facts, and both carry their own document number in the `P` series. Nothing in the flow asks for a permission or a Step-Up Authorization, and nothing refuses the second post.

A third invoice with the same number against a **different** supplier produces no warning at all: the check is per supplier, as `docs/open-decisions.md` words it ("for the same supplier"), and it treats a merged supplier and its survivor as one party (`purchasing.service.ts:477-501`, `:1034-1056`).

---

## 4. What changes under each approved outcome

Recorded now so the engineering cost of each option is visible at decision time, not after.

| If the client approves                          | What the build must become                                                                                                                                                                 | Files an engineer changes                                                                                                                                                                                                                                                  | Tests that must be re-run                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Block**                                       | The second draft save and the second post are **refused** for the same supplier, with a named denial rather than a warning                                                                 | `apps/local-api/src/purchasing/purchasing.service.ts` (`draftResult` and the posting path), `packages/contracts/src/local-rest/index.ts` (the two warning schemas become, or gain, a denial code), `apps/desktop/src/renderer/src/purchasing-messages.ts` (both languages) | `purchasing.integration`, `purchase-posting.integration`, contract suite `packages/contracts/src/local-rest/purchasing.test.ts`, browser suite `purchasing`, plus the milestone-2 acceptance clause 2 run |
| **Allow after a permission-controlled warning** | The warning stays, and passing it requires a named permission, so an unprivileged user cannot post through it                                                                              | the same three files, plus a permission definition and role grants in a new forward migration (the pattern is `apps/local-api/drizzle/0022_batch_safety.sql:146-190`)                                                                                                      | as above, plus the permission/authorization suites                                                                                                                                                        |
| **Keep warn as it is**                          | nothing changes in the build; the row in `docs/open-decisions.md` is updated from _working default_ to an approved rule, and `operationalRule` is renamed away from `"warn-open-decision"` | `packages/contracts/src/local-rest/index.ts` (the literal and its doc comment), `apps/local-api/src/purchasing/purchasing.service.ts` (two occurrences), `apps/desktop/src/renderer/src/purchasing-messages.ts` (both languages stop saying the decision is open)          | `purchasing.integration`, `purchase-posting.integration`, contract suite `purchasing.test.ts`, browser suite `purchasing`                                                                                 |

Under `docs/delivery.md`'s definition, a difference between an approved behaviour and the build is a **defect fixed and retested inside this milestone**, never later work. Plan #81 re-verifies final closure before the release candidate; if the approved choice changes the working default, issues #15 and #19 are updated and retested there.

---

## 5. Signature block

**STATUS: client decision still open — working default is warn, UNAPPROVED; re-verified before the release candidate (plan #81).**

**TEMPLATE — UNSIGNED. A block completed inside this repository is not an approval record; the approval is the accountant's / pharmacist's / client's own signed artifact, recorded here by reference (file name, date, who signed).**

### How an approval is recorded

The client's own written decision — message, letter, or countersigned copy of §4 — is stored under `evidence/issue-59/gates/approvals/` (empty now) and referenced from the block below by file name, date, and who signed. Only then does an engineer change the named constant, re-run the named tests, and record both the change and the re-run. Filling in the block here without that artifact records nothing; it is a worksheet for collecting the answer, not the answer.

> **Differs from build? yes / no** → if **yes**, the change is a defect fixed and retested under milestone 2 (never later work).
>
> **Approval artifact:** `evidence/issue-59/gates/approvals/____________` — signed by ____________ on ____________.

### Item 1 — Duplicate supplier invoice number, for the same supplier

Approved value (tick one): ☐ **Block** ☐ **Allow after a permission-controlled warning** ☐ other: ______________________
Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: `apps/local-api/src/purchasing/purchasing.service.ts` (the draft-side warning at `:472-516` and the posting-side warning at `:2310-2315`, `:2561-2571`), `packages/contracts/src/local-rest/index.ts` (`purchaseDraftWarningSchema` at `:3373`, `purchasePostingWarningSchema` at `:3605`, and the `"warn-open-decision"` literal in both), `apps/desktop/src/renderer/src/purchasing-messages.ts` (English at `:97-100` and `:210-211`, Arabic at `:359-362` and `:470-471`).
Re-run: `purchasing.integration` ("warns for the same supplier number, allows saving, and ignores another supplier"), `purchase-posting.integration` ("warns but still posts a duplicate supplier invoice number"), the contract suite `packages/contracts/src/local-rest/purchasing.test.ts` ("models the duplicate as a non-blocking typed warning"; "warns rather than blocks on a duplicate supplier invoice number"), and the browser suite `purchasing`.

### Item 2 — Whether the check stays per supplier and follows supplier merges

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: the two supplier-alias queries in `apps/local-api/src/purchasing/purchasing.service.ts:477-501` and `:1034-1056`.
Re-run: `purchasing.integration` (the post-merge alias case at `:396-418`), `purchase-posting.integration`.

### Item 3 — The wire marker that says the rule is unapproved

Approved value: ______________________ Approved by: ______________________ Date: ____________ Differs from build? yes / no
Engineer changes: the literal `"warn-open-decision"` and its doc comment in `packages/contracts/src/local-rest/index.ts:3376`, `:3599-3608`, and its two producers in `purchasing.service.ts:512` and `:2568`. This marker must be removed or renamed **only** once a decision is recorded; while it is open, removing it would present a working default as approved.
Re-run: contract suite `packages/contracts/src/local-rest/purchasing.test.ts`, `purchasing.integration`, `purchase-posting.integration`.

---

## 6. العربية — ملخص القرار المطلوب

> ترجمة مجاملة. **النص الإنجليزي أعلاه هو المرجع المعتمد**، وعند أي اختلاف يُعتد بالإنجليزي.

**الحالة: قرار العميل ما زال مفتوحاً — القاعدة الحالية «تحذير» وهي غير معتمدة، ويُعاد التحقق من إغلاقها النهائي قبل النسخة المرشحة للإصدار (الخطة رقم 81).**

**السؤال المطروح على العميل:** ماذا يفعل النظام عند إدخال **رقم فاتورة مورد مكرر لنفس المورد**؟ الخياران المطروحان في `docs/open-decisions.md` هما:

1. **المنع** — رفض المستند الثاني الذي يحمل الرقم نفسه للمورد نفسه.
2. **السماح بعد تحذير مرتبط بصلاحية** — يبقى التحذير، ولا يتجاوزه إلا مستخدم يملك صلاحية محددة.

**ما تفعله النسخة الحالية ليس أياً منهما، وهو غير معتمد:** تحذير **غير مشروط**، لا يرتبط بأي صلاحية، ولا يمنع الحفظ ولا الترحيل — لا عند حفظ المسودة ولا عند ترحيل الفاتورة. ويحمل كل تحذير على مستوى الواجهة البرمجية الوسم `operationalRule: "warn-open-decision"` الذي يصرّح بأن القاعدة لم تُحسم بعد.

التحقق يتم **لكل مورد على حدة**، ويُعامل المورد المدموج والمورد الباقي بعد الدمج كمورد واحد. أما الرقم نفسه لدى **مورد مختلف** فلا يُنتج أي تحذير.

إذا اعتمد العميل قاعدة تختلف عمّا تنتجه النسخة الحالية، يُعد ذلك **خللاً يُصلَح ويُعاد اختباره ضمن المرحلة الثانية نفسها**، لا عملاً لاحقاً. وتُراجَع الخطتان رقم 15 ورقم 19 ويُعاد اختبارهما قبل النسخة المرشحة للإصدار.
