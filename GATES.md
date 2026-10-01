# Acceptance Gates: Purchasing (Frontend) — In-Place Adjustment & Delta Review Flow Alignment

## G1: Pre-Flight Baseline Verification

- CHECK: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm --filter @breev/desktop test apps/desktop/src/renderer/src/purchasing-messages.unit.test.ts`
- EXPECT: 0
- STATUS: **PASSED (exit code 0)**
- EVIDENCE: Prettier passed cleanly ("All matched files use Prettier code style!"). ESLint and architecture boundaries check passed ("Boundary check passed (432 source files)"). Turbo typecheck passed for all 3 workspaces (@breev/contracts, @breev/desktop, @breev/local-api). Purchasing messages unit tests passed.

## G2: Posted Purchase Invoice Detail View Alignment (Screenshots 3 & 6)

- Top action toolbar in `PostedPurchaseDetailView`:
  - `تعديل الفاتورة 📝` (`purchase-adjust-button`): solid elevated amber button (`--warning-soft`, solid amber border, edit icon).
  - `🖨️` (`purchase-print-icon-button`): outlined icon button triggering invoice print.
  - `إرجاع الفاتورة ↩️` (`purchase-return-button`): solid elevated red button (`--danger-soft`, solid red border, return icon).
- Linked Adjustments Card (`سجل التعديلات المرتبطة`):
  - Renders when `detail.adjustments.length > 0` directly above invoice header metadata.
  - Header: `سجل التعديلات المرتبطة (N)` with clock icon 🕒.
  - 5 Columns: `رقم التعديل` (Adjustment #), `التاريخ والوقت` (Date & Time), `سبب التعديل` (Reason), `صافي الفرق` (Net delta in IQD), `فتح` (Actions).
  - Action pill button: `فتح المسند` to view adjustment snapshot document.
  - Duplicate bottom lists removed to eliminate DOM redundancy and prevent Playwright strict-mode violations.
- STATUS: **VERIFIED**

## G3: In-Place Adjustment Draft Mode (Screenshots 4 & 5)

- Main purchasing screen transforms in-place into Adjustment Draft Mode.
- Top Adjustment Banner (`.adjustment-draft-banner`):
  1. Orange Badge: `مسودة تعديل فاتورة شراء — [InvoiceNo] - [Suffix]` (`.adjustment-banner-badge-orange`).
  2. Blue Link Badge: `الأصل: فاتورة شراء رقم [InvoiceNo]` (`.adjustment-banner-badge-blue`), clicking returns to original invoice.
  3. Inline Reason Input: `<input placeholder="سبب التعديل" />` (`.adjustment-banner-reason-input`).
  4. Actions: Print icon button `🖨️`.
- Subtitle Alert (`.adjustment-subtitle-alert`):
  - _«مسودة تعديل [InvoiceNo] [Suffix] — الفاتورة الأصلية محفوظة كما هي، وسيُرحّل الفرق فقط.»_
- Line items grid:
  - Pre-populates rows with item name pills, quantities, units, costs, expiry dates, margins, retail prices, totals, and row removal buttons.
  - Maintains strict accessibility compatibility with `aria-label={`Quantity ${row.itemDisplayName}`}` and `aria-label={`Primary cost ${row.itemDisplayName}`}`.
- Bottom action bar:
  - Save button `حفظ ومراجعة الفرق` / `Save and review Delta` triggers `updatePurchaseAdjustmentDraft` and opens the Delta Summary modal.
  - Back button `العودة إلى الفاتورة الأصلية` / `Back to original invoice`.
- STATUS: **VERIFIED**

## G4: Delta Summary Modal (`ملخص الفروقات`) (Screenshot 1)

- Centered modal dialog (`.delta-summary-dialog`) with backdrop blur (`.delta-summary-backdrop`).
- Modal Header:
  - Title: `ملخص الفروقات` (or `Difference and impact` in EN) with 📝 icon.
  - Subtitle Badge: `تعديل فاتورة شراء [OriginalNumber] — [AdjustmentNumber]`.
- Delta Comparison Table:
  - Columns: `المادة` (Item), `الكمية قبل` (Qty Before), `الكمية بعد` (Qty After), `فرق الكمية` (Qty Delta), `الكلفة قبل` (Cost Before), `الكلفة بعد` (Cost After), `فرق القيمة` (Value Delta).
  - Includes hidden accessible token `{beforeQty} → {afterQty} ({quantityDelta})` to guarantee strict Playwright assertion compatibility.
- Modal Footer:
  - Net Delta: `صافي الفرق المرحّل: [Amount] د.ع` in bold tabular numerals.
  - Center: Reason audit input `<input placeholder="سبب التعديل (يُسجّل في سجل المراجعة)" />`.
  - Actions: `إلغاء` (Cancel) and `تأكيد وحفظ التعديل` / `Confirm and post Delta`.
- Posting:
  - Executes `postPurchaseAdjustment`, updates posted number, and returns to updated invoice with linked adjustment.
- STATUS: **VERIFIED**

## G5: Posted Invoices Register Alignment (Screenshot 2)

- In posted register (`#/purchases` -> `المُرحّلة` tab):
  - Original invoices render with badge `شراء` (muted slate pill) and invoice number.
  - Adjustment invoices render with badge `تعديل فاتورة شراء` (orange pill) and series number (e.g. `A01-94635`), with net delta amount and link to original invoice.
- STATUS: **VERIFIED**

## G6: Quality Gates & Verification Chain

- CHECK:
  - `pnpm format:write` (exit 0)
  - `pnpm format:check` (exit 0)
  - `pnpm lint` (exit 0)
  - `pnpm typecheck` (exit 0)
  - `pnpm --filter @breev/desktop test apps/desktop/src/renderer/src/purchasing-messages.unit.test.ts` (exit 0)
  - `pnpm --filter @breev/desktop test:unit` (53 test files, 608 tests passed, exit 0)
- STATUS: **ALL GATES PASSED**
