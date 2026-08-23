
This work spans four large modules (~4,000 lines of new/changed UI). I'll break it into three sequenced batches so each is verifiable before moving to the next. All work stays in dark-slate + emerald green RTL styling, high-density, zero-scroll layouts.

## Batch 1 — Main Dashboard (`القائمة الرئيسية`)

New route `src/routes/dashboard.tsx` + register as the first tab in `src/components/app-shell.tsx` header nav (before existing tabs). Set as default landing (`/` redirects to `/dashboard`).

Sections:
1. **Shortcut cards row** — 7 emerald-accented cards (POS, Purchases, Cart, Patients, Messages, Reports, Inventory) using Lucide icons, `<Link>` navigation.
2. **KPI grid** — 10 cards computed live from Supabase:
   - Sales/Costs/Profit/Margin from `sales_invoices` + `sales_invoice_items` joined to `medicines.small_unit_cost`.
   - Today's patients = distinct `patient_id` on today's invoices.
   - SKUs = count `medicines where is_active`.
   - Inventory value = Σ `quantity_in_stock * small_unit_cost`.
   - Debts = Σ `sales_invoices.total where payment_type='credit' and status='saved'`.
   - Near-expiry ratio = count expiring ≤90d / total active.
3. **Expiry Mitigation grid** — client-side computed: monthly rate from last 90d sales; months-to-expiry from `expiry_date`; flag when qty > rate × months; show surplus.
4. **Accordion (shadcn Accordion)** — 4 panels: near-expiry, top-selling (by qty last 30d), top-profit (by margin×qty), stagnant (0 sales 90d + stock>0).

## Batch 2 — Orders Basket (`سلة الطلبات`)

Edit `src/routes/cart.tsx`:
- Add far-right selection column (checkbox per row + header "تحديد الكل") on both الطلبية and مواد مقطوعة grids.
- Bind row click → populate existing "شريط تفاصيل مادة" bar (no new drawer).
- Suggested qty formula: `ceil((maximum_stock - quantity_in_stock) / units_per_large)`, min 1; recompute on load and offer "إعادة حساب مقترح" bulk button on selected rows.

## Batch 3 — Reports + Suppliers seed

Edit `src/routes/reports.tsx` (and purchases where relevant):

**Sales sub-tabs:**
- Rename "صافي الفواتير غير المسددة" → "ديون المرضى / البيع بالاجل للمرضى".
- Rename "مبيعات مناديب" → "مبيعات تواجد": pharmacist name, invoice count, cost, profit, datetime range filter.
- Rename "مبيعات عملاء" → "مبيعات مرضى": patient, cost, sales, profit, datetime range filter.

**Purchasing sub-tabs:**
- Delete "مشتريات موردين" sub-tab entirely.
- Add **"تقارير الموردين"**: ledger grid (name, purchases, returns, paid, outstanding) + per-row "كشف حساب" dialog (date range / since last reconciliation) + **"تسديد دفعة"** dialog:
  - Lists unpaid `purchase_invoices` with checkboxes.
  - Sum → "القيمة المقترحة".
  - Discount inputs: fixed "سماح" + "نسبة خصم %".
  - Confirm → insert `account_transactions` (cash → supplier), mark invoices paid, row turns emerald.
- **"مشتريات فواتير"**: invoice#, supplier, date, cost, paid status badge, edit → navigates to purchases route with invoice id.
- **"مشتريات منتجات"**: item, barcode, supplier, purchase date, "الدخول الى الفاتورة" button.
- **"مرتجع مشتريات"**: supplier dropdown + date range + grid (item, qty, return date, invoice#, original purchase date). Uses `stock_movements` where reason='purchase_reverted' joined to invoice items.

**Supplier seed migration:** insert 10 realistic suppliers with 3-5 historical `purchase_invoices` each, partial payments via `account_transactions`, some outstanding debts.

## Technical details

- All server reads via existing `supabase` browser client (route is under auth gate).
- KPI queries batched with `Promise.all`, cached via TanStack Query (`staleTime: 60_000`).
- Formulas:
  - Monthly rate = qty sold last 90d / 3.
  - Months to expiry = `(expiry - today) / 30`.
  - Suggested surplus = `qty - rate × monthsRemaining` (floor, min 1).
- Payment settlement writes to `purchase_invoices` (add `paid` boolean or use existing `status`) + `account_transactions` (existing table).
- Row highlight for paid: `bg-emerald-500/15 border-emerald-500/40`.
- Checkbox: shadcn `<Checkbox>` in a `w-10` right-most `<th>`.

## Order of execution

1. Batch 1 dashboard (largest, user's headline ask).
2. Batch 2 cart tweaks.
3. Batch 3 reports/suppliers (schema seed migration first, then UI).

Reply "go" (or specify a batch) and I'll implement. If you'd rather I ship it all in one pass without pausing, say "all at once".
