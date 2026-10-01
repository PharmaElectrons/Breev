// Additional analytical reports: peak hours, family profitability, stock-limit
// audits (below min / above max / unpriced / at-cost) and per-patient analytics.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listMedicines, listPatients, type Medicine, type PatientRow } from "@/lib/db";
import { formatIQD } from "@/lib/pharmacy";
import { addToCart } from "@/lib/procurement-cart";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ShoppingCart, Pencil, ArrowUpDown } from "lucide-react";

const TH = "px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground";
const TD = "px-3 py-1.5";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden" dir="rtl">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="max-h-[62vh] overflow-auto">{children}</div>
    </div>
  );
}

type SaleItemJoined = {
  medicine_id: string;
  qty: number;
  unit_price: number;
  line_total: number;
  sales_invoices: { created_at: string; patient_id: string | null; id?: string };
};

/** Shared loader: sale line items in range + medicine map. */
function useSalesLines(from: string, to: string) {
  const [lines, setLines] = useState<SaleItemJoined[]>([]);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [{ data }, m] = await Promise.all([
        supabase
          .from("sales_invoice_items")
          .select("medicine_id,qty,unit_price,line_total,sales_invoices!inner(id,created_at,patient_id)")
          .gte("sales_invoices.created_at", from)
          .lte("sales_invoices.created_at", to + "T23:59:59"),
        listMedicines(),
      ]);
      if (!alive) return;
      setLines((data ?? []) as unknown as SaleItemJoined[]);
      setMeds(m);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [from, to]);
  const costOf = useMemo(() => {
    const map = new Map(meds.map((m) => [m.id, Number(m.small_unit_cost ?? m.purchase_price ?? 0)]));
    return (id: string) => map.get(id) ?? 0;
  }, [meds]);
  return { lines, meds, costOf, loading };
}

// ---- 1) Peak hours ------------------------------------------------------
export function PeakHoursReport({ from, to }: { from: string; to: string }) {
  const { lines, costOf, loading } = useSalesLines(from, to);
  const rows = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ h, revenue: 0, cost: 0, invoices: new Set<string>() }));
    for (const l of lines) {
      const d = new Date(l.sales_invoices.created_at);
      const b = buckets[d.getHours()];
      b.revenue += Number(l.line_total || 0);
      b.cost += Number(l.qty || 0) * costOf(l.medicine_id);
      if (l.sales_invoices.id) b.invoices.add(l.sales_invoices.id);
    }
    return buckets.map((b) => ({ ...b, profit: b.revenue - b.cost, count: b.invoices.size }));
  }, [lines, costOf]);

  const maxRev = Math.max(1, ...rows.map((r) => r.revenue));
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const peak = rows.reduce((a, b) => (b.revenue > a.revenue ? b : a), rows[0]);

  return (
    <div className="space-y-3" dir="rtl">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="ساعة الذروة" value={peak && peak.revenue > 0 ? `${pad(peak.h)}:00 – ${pad((peak.h + 1) % 24)}:00` : "—"} accent />
        <Kpi label="إجمالي المبيعات" value={formatIQD(totalRev)} />
        <Kpi label="إجمالي الأرباح" value={formatIQD(totalProfit)} accent />
      </div>
      <Panel title="ساعة الذروة — توزيع المبيعات والأرباح على ساعات اليوم">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-900/80 sticky top-0">
            <tr>
              <th className={TH}>الفترة الزمنية</th>
              <th className={TH}>عدد الفواتير</th>
              <th className={TH}>في المبيعات</th>
              <th className={TH}>في الأرباح</th>
              <th className={TH}>الحصة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((r) => (
              <tr key={r.h} className={`hover:bg-slate-800/40 ${peak && r.h === peak.h && r.revenue > 0 ? "bg-emerald/10" : ""}`}>
                <td className={`${TD} font-mono font-bold`}>{pad(r.h)}:00 – {pad((r.h + 1) % 24)}:00</td>
                <td className={`${TD} font-mono`}>{r.count}</td>
                <td className={`${TD} font-mono`}>{formatIQD(r.revenue)}</td>
                <td className={`${TD} font-mono font-bold ${r.profit >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(r.profit)}</td>
                <td className={TD}>
                  <div className="h-2 rounded bg-slate-800 overflow-hidden">
                    <div className="h-full bg-emerald/70" style={{ width: `${(r.revenue / maxRev) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">جاري التحميل…</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`border rounded-xl p-3 ${accent ? "border-emerald/40 bg-emerald/5 text-emerald" : "border-border bg-slate-800/40"}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-lg font-mono font-bold mt-1">{value}</p>
    </div>
  );
}

// ---- 2) Most profitable items within a family/category ------------------
export function ProfitByFamilyReport({ from, to }: { from: string; to: string }) {
  const { lines, meds, costOf, loading } = useSalesLines(from, to);
  const [family, setFamily] = useState<string>("__all");

  const families = useMemo(
    () => Array.from(new Set(meds.map((m) => (m.category || "").trim()).filter(Boolean))).sort(),
    [meds],
  );

  const rows = useMemo(() => {
    const medById = new Map(meds.map((m) => [m.id, m]));
    const agg = new Map<string, { name: string; category: string; qty: number; revenue: number; cost: number }>();
    for (const l of lines) {
      const m = medById.get(l.medicine_id);
      if (!m) continue;
      const cat = (m.category || "بدون عائلة").trim();
      if (family !== "__all" && cat !== family) continue;
      const cur = agg.get(l.medicine_id) ?? { name: m.trade_name, category: cat, qty: 0, revenue: 0, cost: 0 };
      cur.qty += Number(l.qty || 0);
      cur.revenue += Number(l.line_total || 0);
      cur.cost += Number(l.qty || 0) * costOf(l.medicine_id);
      agg.set(l.medicine_id, cur);
    }
    return Array.from(agg.entries())
      .map(([id, v]) => ({
        id,
        ...v,
        unitCost: v.qty > 0 ? v.cost / v.qty : 0,
        unitPrice: v.qty > 0 ? v.revenue / v.qty : 0,
        profit: v.revenue - v.cost,
        margin: v.revenue > 0 ? ((v.revenue - v.cost) / v.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [lines, meds, costOf, family]);

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          العائلة / التصنيف
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            className="block mt-1 bg-slate-800 border border-border rounded-lg px-3 py-2 text-xs text-foreground min-w-[220px]"
          >
            <option value="__all">كل العائلات</option>
            {families.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <Kpi label="صافي الربح للعائلة" value={formatIQD(rows.reduce((s, r) => s + r.profit, 0))} accent />
      </div>
      <Panel title="المواد الأكثر ربحاً ضمن العائلة المحددة">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-900/80 sticky top-0">
            <tr>
              <th className={TH}>#</th>
              <th className={TH}>اسم المادة</th>
              <th className={TH}>العائلة</th>
              <th className={TH}>الكمية المبيعة</th>
              <th className={TH}>سعر الكلفة</th>
              <th className={TH}>سعر البيع</th>
              <th className={TH}>نسبة الربح</th>
              <th className={TH}>صافي الربح</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((r, i) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className={`${TD} font-mono text-muted-foreground`}>{i + 1}</td>
                <td className={`${TD} font-medium`}>{r.name}</td>
                <td className={`${TD} text-muted-foreground`}>{r.category}</td>
                <td className={`${TD} font-mono`}>{r.qty}</td>
                <td className={`${TD} font-mono`}>{formatIQD(r.unitCost)}</td>
                <td className={`${TD} font-mono`}>{formatIQD(r.unitPrice)}</td>
                <td className={`${TD} font-mono ${r.margin > 0 ? "text-emerald" : "text-destructive"}`}>{r.margin.toFixed(1)}%</td>
                <td className={`${TD} font-mono font-bold ${r.profit >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(r.profit)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">لا توجد مبيعات لهذه العائلة خلال الفترة.</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ---- 3) Stock limit / pricing audits -----------------------------------
function AddToCartBtn({ m }: { m: Medicine }) {
  return (
    <button
      onClick={() => {
        const needed = Math.max(1, m.maximum_stock - m.quantity_in_stock);
        addToCart({
          medicineId: m.id,
          barcode: m.barcode ?? null,
          name: m.trade_name,
          currentStock: m.quantity_in_stock,
          minimum: m.minimum_stock,
          maximum: m.maximum_stock,
          suggestedQty: needed,
          addedAt: new Date().toISOString(),
          status: "order",
        });
        toast.success(`أُضيفت ${m.trade_name} إلى سلة الطلبات (${needed})`);
      }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald/15 text-emerald border border-emerald/40 text-[11px] font-bold hover:bg-emerald/25"
    >
      <ShoppingCart className="w-3 h-3" /> إضافة للسلة
    </button>
  );
}

function EditItemBtn({ m }: { m: Medicine }) {
  return (
    <Link
      to="/products"
      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-500/15 text-sky-400 border border-sky-500/40 text-[11px] font-bold hover:bg-sky-500/25"
    >
      <Pencil className="w-3 h-3" /> تعديل المادة
    </Link>
  );
}

export function AboveMaxStockReport({ items }: { items: Medicine[] }) {
  const rows = items.filter((m) => m.maximum_stock > 0 && m.quantity_in_stock > m.maximum_stock);
  return (
    <Panel title="فوق الأعلى — المواد التي تجاوزت حدها الأعلى">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-900/60 sticky top-0">
          <tr>
            <th className={TH}>المادة</th>
            <th className={TH}>رصيدها</th>
            <th className={TH}>حدها الأعلى</th>
            <th className={TH}>حدها الأدنى</th>
            <th className={TH}>إجراء</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((m) => (
            <tr key={m.id} className="hover:bg-slate-800/40">
              <td className={`${TD} font-medium`}>{m.trade_name}</td>
              <td className={`${TD} font-mono font-bold text-amber-400`}>{m.quantity_in_stock}</td>
              <td className={`${TD} font-mono`}>{m.maximum_stock}</td>
              <td className={`${TD} font-mono text-muted-foreground`}>{m.minimum_stock}</td>
              <td className={TD}><EditItemBtn m={m} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-emerald text-xs">لا توجد مواد فوق حدها الأعلى ✔</td></tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}

export function UnpricedItemsReport({ items }: { items: Medicine[] }) {
  const rows = items.filter(
    (m) => !(Number(m.small_unit_price) > 0) && !(Number(m.selling_price) > 0) && !(Number(m.large_unit_price) > 0),
  );
  return (
    <Panel title="مواد بدون سعر بيع">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-900/60 sticky top-0">
          <tr>
            <th className={TH}>المادة</th>
            <th className={TH}>الباركود</th>
            <th className={TH}>رصيدها</th>
            <th className={TH}>سعر الكلفة</th>
            <th className={TH}>إجراء</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((m) => (
            <tr key={m.id} className="hover:bg-slate-800/40">
              <td className={`${TD} font-medium`}>{m.trade_name}</td>
              <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>{m.barcode ?? "—"}</td>
              <td className={`${TD} font-mono`}>{m.quantity_in_stock}</td>
              <td className={`${TD} font-mono`}>{formatIQD(Number(m.small_unit_cost ?? m.purchase_price ?? 0))}</td>
              <td className={TD}><EditItemBtn m={m} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-emerald text-xs">جميع المواد لها سعر بيع ✔</td></tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}

export function AtCostItemsReport({ items }: { items: Medicine[] }) {
  const rows = items
    .map((m) => {
      const cost = Number(m.small_unit_cost ?? m.purchase_price ?? 0);
      const price = Number(m.small_unit_price ?? m.selling_price ?? 0);
      return { m, cost, price, margin: price > 0 ? ((price - cost) / price) * 100 : 0 };
    })
    .filter((r) => r.cost > 0 && r.price > 0 && r.price <= r.cost)
    .sort((a, b) => a.margin - b.margin);
  return (
    <Panel title="مواد تباع بسعر الكلفة أو أقل — تدقيق أخطاء التسعير">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-900/60 sticky top-0">
          <tr>
            <th className={TH}>المادة</th>
            <th className={TH}>سعر الكلفة</th>
            <th className={TH}>سعر البيع</th>
            <th className={TH}>الفرق</th>
            <th className={TH}>نسبة الربح</th>
            <th className={TH}>إجراء</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map(({ m, cost, price, margin }) => (
            <tr key={m.id} className="hover:bg-slate-800/40">
              <td className={`${TD} font-medium`}>{m.trade_name}</td>
              <td className={`${TD} font-mono`}>{formatIQD(cost)}</td>
              <td className={`${TD} font-mono`}>{formatIQD(price)}</td>
              <td className={`${TD} font-mono ${price - cost < 0 ? "text-destructive" : "text-muted-foreground"}`}>{formatIQD(price - cost)}</td>
              <td className={`${TD} font-mono font-bold ${margin < 0 ? "text-destructive" : "text-amber-400"}`}>{margin.toFixed(1)}%</td>
              <td className={TD}><EditItemBtn m={m} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-emerald text-xs">لا توجد مواد تباع بالكلفة أو أقل ✔</td></tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}

export { AddToCartBtn };

// ---- 4) Per-patient detailed analytics ---------------------------------
export function PatientDetailedReport({ from, to }: { from: string; to: string }) {
  const { lines, meds, costOf, loading } = useSalesLines(from, to);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState<string>("");
  const [dir, setDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    (async () => {
      const p = await listPatients();
      setPatients(p);
      setPatientId((cur) => cur || (p[0]?.id ?? ""));
    })();
  }, []);

  const medById = useMemo(() => new Map(meds.map((m) => [m.id, m])), [meds]);
  const mine = useMemo(
    () => lines.filter((l) => l.sales_invoices.patient_id === patientId),
    [lines, patientId],
  );

  // Section 1 — purchased items breakdown
  const breakdownRows = useMemo(() => {
    const agg = new Map<string, { name: string; qty: number; revenue: number; cost: number; dates: string[] }>();
    for (const l of mine) {
      const m = medById.get(l.medicine_id);
      const cur = agg.get(l.medicine_id) ?? { name: m?.trade_name ?? "—", qty: 0, revenue: 0, cost: 0, dates: [] };
      cur.qty += Number(l.qty || 0);
      cur.revenue += Number(l.line_total || 0);
      cur.cost += Number(l.qty || 0) * costOf(l.medicine_id);
      cur.dates.push(l.sales_invoices.created_at);
      agg.set(l.medicine_id, cur);
    }
    const arr = Array.from(agg.entries()).map(([id, v]) => ({ id, ...v, profit: v.revenue - v.cost }));
    arr.sort((a, b) => (dir === "desc" ? b.qty - a.qty : a.qty - b.qty));
    return arr;
  }, [mine, medById, costOf, dir]);

  // Section 2 — purchase history & lapse intervals
  const historyRows = useMemo(() => {
    const today = Date.now();
    return breakdownRows
      .map((r) => {
        const m = medById.get(r.id);
        const dates = [...r.dates].sort();
        const last = dates[dates.length - 1];
        const freq = Math.max(1, Number(m?.daily_frequency || 1));
        const supplyDays = Math.floor(r.qty / freq);
        const daysSince = last ? Math.floor((today - new Date(last).getTime()) / 86400000) : 0;
        const lapse = Math.max(0, daysSince - supplyDays);
        return { ...r, dates, last, supplyDays, daysSince, lapse };
      })
      .sort((a, b) => b.lapse - a.lapse);
  }, [breakdownRows, medById]);

  // Section 3 — category profitability leader
  const leaders = useMemo(() => {
    const best = new Map<string, { name: string; profit: number; qty: number }>();
    for (const r of breakdownRows) {
      const cat = (medById.get(r.id)?.category || "بدون تصنيف").trim();
      const cur = best.get(cat);
      if (!cur || r.profit > cur.profit) best.set(cat, { name: r.name, profit: r.profit, qty: r.qty });
    }
    return Array.from(best.entries()).sort((a, b) => b[1].profit - a[1].profit);
  }, [breakdownRows, medById]);

  const totalProfit = breakdownRows.reduce((s, r) => s + r.profit, 0);
  const totalRevenue = breakdownRows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          حسب اسم المريض
          <select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="block mt-1 bg-slate-800 border border-border rounded-lg px-3 py-2 text-xs text-foreground min-w-[240px]"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </label>
        <Kpi label="إجمالي المشتريات" value={formatIQD(totalRevenue)} />
        <Kpi label="صافي الربح المتحقق" value={formatIQD(totalProfit)} accent />
        <button
          onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-border text-[11px] font-bold text-foreground inline-flex items-center gap-1.5 hover:border-emerald/40"
        >
          <ArrowUpDown className="w-3 h-3" />
          {dir === "desc" ? "الأكثر شراءً أولاً" : "الأقل شراءً أولاً"}
        </button>
      </div>

      <Panel title="١ — تفصيل المواد المشتراة">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-900/80 sticky top-0">
            <tr>
              <th className={TH}>اسم الدواء</th>
              <th className={TH}>الكمية المشتراة</th>
              <th className={TH}>قيمة المشتريات</th>
              <th className={TH}>صافي الربح</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {breakdownRows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className={`${TD} font-medium`}>{r.name}</td>
                <td className={`${TD} font-mono`}>{r.qty}</td>
                <td className={`${TD} font-mono`}>{formatIQD(r.revenue)}</td>
                <td className={`${TD} font-mono font-bold ${r.profit >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(r.profit)}</td>
              </tr>
            ))}
            {!loading && breakdownRows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">لا توجد مشتريات لهذا المريض خلال الفترة.</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel title="٢ — تاريخ الشراء وفترة الانقطاع">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-900/80 sticky top-0">
            <tr>
              <th className={TH}>الدواء</th>
              <th className={TH}>تواريخ الشراء</th>
              <th className={TH}>آخر شراء</th>
              <th className={TH}>الربح المتحقق</th>
              <th className={TH}>فترة الانقطاع عنها</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {historyRows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className={`${TD} font-medium`}>{r.name}</td>
                <td className={`${TD} font-mono text-[10px] text-muted-foreground`}>
                  {r.dates.map((d) => new Date(d).toLocaleDateString("en-GB")).join(" • ")}
                </td>
                <td className={`${TD} font-mono`}>{r.last ? new Date(r.last).toLocaleDateString("en-GB") : "—"}</td>
                <td className={`${TD} font-mono ${r.profit >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(r.profit)}</td>
                <td className={TD}>
                  {r.lapse > 0 ? (
                    <span className="px-2 py-0.5 rounded bg-destructive/15 border border-destructive/40 text-destructive font-mono font-bold text-[11px]">
                      {r.lapse} يوم
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald/15 border border-emerald/40 text-emerald text-[11px] font-bold">منتظم</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && historyRows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">لا يوجد تاريخ شراء.</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel title="٣ — المادة الأكثر ربحاً في كل تصنيف دوائي">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-900/80 sticky top-0">
            <tr>
              <th className={TH}>التصنيف الدوائي</th>
              <th className={TH}>المادة الأعلى ربحاً</th>
              <th className={TH}>الكمية</th>
              <th className={TH}>صافي الربح</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {leaders.map(([cat, v]) => (
              <tr key={cat} className="hover:bg-slate-800/40">
                <td className={`${TD} text-muted-foreground`}>{cat}</td>
                <td className={`${TD} font-medium`}>{v.name}</td>
                <td className={`${TD} font-mono`}>{v.qty}</td>
                <td className={`${TD} font-mono font-bold text-emerald`}>{formatIQD(v.profit)}</td>
              </tr>
            ))}
            {!loading && leaders.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">لا توجد بيانات كافية.</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
