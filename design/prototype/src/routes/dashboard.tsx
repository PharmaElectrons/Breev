// Main Dashboard (القائمة الرئيسية) — analytical command center.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { formatIQD } from "@/lib/pharmacy";
import { listMedicines, getConsumptionByMedicine, type Medicine } from "@/lib/db";
import {
  TrendingUp, TrendingDown, Warehouse, CreditCard, Coins,
  Sparkles, ChevronUp, ChevronDown, Send, Loader2,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "القائمة الرئيسية — Breef Pharmacy" },
      { name: "description", content: "لوحة القيادة الرئيسية للصيدلية: مؤشرات الأداء والتحليلات الذكية." },
    ],
  }),
  component: DashboardPage,
});

type KPI = {
  totalSales: number; dailySales: number;
  totalExpenses: number; todayExpenses: number;
  totalProfit: number; todayProfit: number;
  warehouseCost: number; warehouseRetail: number;
  totalDebts: number; nearExpiryRatio: number;
};

type SortKey = "sold" | "profit" | "expiry" | "stock" | "monthly" | "surplus" | "margin";
type SortDir = "asc" | "desc";

function DashboardPage() {
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [consumption, setConsumption] = useState<Record<string, number>>({});
  const [kpi, setKpi] = useState<KPI>({
    totalSales: 0, dailySales: 0, totalExpenses: 0, todayExpenses: 0,
    totalProfit: 0, todayProfit: 0, warehouseCost: 0, warehouseRetail: 0,
    totalDebts: 0, nearExpiryRatio: 0,
  });

  // Breef AI state
  const [aiQ, setAiQ] = useState("");
  const [aiA, setAiA] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  // Sort state for consolidated table
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    (async () => {
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const dayStartDate = dayStart.slice(0, 10);
      const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      const medsList = await listMedicines();
      setMeds(medsList);

      const [
        { data: allSales },
        { data: allItems },
        { data: allExpenses },
        { data: debts },
      ] = await Promise.all([
        supabase.from("sales_invoices").select("id,total,created_at"),
        supabase.from("sales_invoice_items")
          .select("qty,line_total,medicine_id,sales_invoices!inner(created_at)"),
        supabase.from("expenses").select("amount,expense_date"),
        supabase.from("sales_invoices").select("total").eq("payment_type", "credit"),
      ]);

      const consAgg = await getConsumptionByMedicine(monthAgo, now.toISOString());
      setConsumption(consAgg);

      const totalSales = (allSales ?? []).reduce((s, r: any) => s + Number(r.total || 0), 0);
      const dailySales = (allSales ?? [])
        .filter((r: any) => r.created_at >= dayStart)
        .reduce((s, r: any) => s + Number(r.total || 0), 0);

      const totalExpenses = (allExpenses ?? []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
      const todayExpenses = (allExpenses ?? [])
        .filter((r: any) => String(r.expense_date).slice(0, 10) === dayStartDate)
        .reduce((s, r: any) => s + Number(r.amount || 0), 0);

      const costByMed = new Map(medsList.map((m) => [m.id, Number(m.purchase_price || m.small_unit_cost || 0)]));
      const profitOf = (it: any) =>
        Number(it.line_total || 0) - Number(it.qty || 0) * (costByMed.get(it.medicine_id) ?? 0);
      const totalProfit = (allItems ?? []).reduce((s, it: any) => s + profitOf(it), 0);
      const todayProfit = (allItems ?? [])
        .filter((it: any) => (it.sales_invoices?.created_at ?? "") >= dayStart)
        .reduce((s, it: any) => s + profitOf(it), 0);

      const warehouseCost = medsList.reduce((s, m) =>
        s + Number(m.quantity_in_stock || 0) * Number(m.small_unit_cost || m.purchase_price || 0), 0);
      const warehouseRetail = medsList.reduce((s, m) =>
        s + Number(m.quantity_in_stock || 0) * Number(m.small_unit_price || m.selling_price || 0), 0);

      const totalDebts = (debts ?? []).reduce((s, r: any) => s + Number(r.total || 0), 0);

      const near = medsList.filter((m) => {
        if (!m.expiry_date) return false;
        const days = (new Date(m.expiry_date).getTime() - now.getTime()) / 86400000;
        return days < 180 && days > -30;
      }).length;
      const nearExpiryRatio = medsList.length ? (near / medsList.length) * 100 : 0;

      setKpi({
        totalSales, dailySales, totalExpenses, todayExpenses,
        totalProfit, todayProfit, warehouseCost, warehouseRetail,
        totalDebts, nearExpiryRatio,
      });
    })().catch((e) => console.error("dashboard fetch", e));
  }, []);

  // Consolidated analytics rows
  const analyticsRows = useMemo(() => {
    const now = Date.now();
    return meds.map((m) => {
      const sold = consumption[m.id] ?? 0;
      const price = Number(m.selling_price || 0);
      const cost = Number(m.purchase_price || 0);
      const profitUnit = price - cost;
      const profit = sold * profitUnit;
      const stock = Number(m.quantity_in_stock || 0);
      const monthly = sold;
      const expiry = m.expiry_date ?? null;
      const monthsLeft = expiry
        ? Math.max(0.1, (new Date(expiry).getTime() - now) / (30 * 86400000))
        : 999;
      const projectedNeed = monthly * monthsLeft;
      const surplus = Math.max(0, Math.ceil(stock - projectedNeed));
      const margin = price > 0 ? (profitUnit / price) * 100 : 0;
      const fullName = [m.trade_name, m.strength, m.dosage_form, m.company]
        .filter((x) => x && String(x).trim()).join(" ");
      return { id: m.id, name: fullName || m.trade_name, sold, profit, expiry, stock, monthly, surplus, margin };
    });
  }, [meds, consumption]);


  const sortedRows = useMemo(() => {
    const rows = [...analyticsRows];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (sortKey === "expiry") {
        const at = a.expiry ? new Date(a.expiry).getTime() : Infinity;
        const bt = b.expiry ? new Date(b.expiry).getTime() : Infinity;
        return (at - bt) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
    return rows.slice(0, 50);
  }, [analyticsRows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const askBreef = async () => {
    const q = aiQ.trim();
    if (!q || aiBusy) return;
    setAiBusy(true); setAiErr(null); setAiA(null);
    try {
      const context = {
        totalSales: kpi.totalSales, dailySales: kpi.dailySales,
        totalProfit: kpi.totalProfit, todayProfit: kpi.todayProfit,
        totalExpenses: kpi.totalExpenses, todayExpenses: kpi.todayExpenses,
        warehouseCost: kpi.warehouseCost, warehouseRetail: kpi.warehouseRetail,
        totalDebts: kpi.totalDebts, nearExpiryRatio: kpi.nearExpiryRatio,
        totalMedicines: meds.length,
        topByProfit: analyticsRows
          .filter((r) => r.profit > 0)
          .sort((a, b) => b.profit - a.profit)
          .slice(0, 5)
          .map((r) => ({ name: r.name, profit: r.profit, sold: r.sold })),
      };
      const res = await fetch("/api/breef-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, context }),
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const data = await res.json();
      setAiA(data.answer ?? "");
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <AppShell title="القائمة الرئيسية">
      <div className="flex-1 overflow-auto p-4 space-y-4" dir="rtl">

        {/* Breef AI bar */}
        <section className="border rounded-xl bg-gradient-to-l from-amber-50 to-white border-amber-300/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-bold text-amber-800">Breef AI — البحث بالذكاء الاصطناعي</span>
          </div>
          <div className="flex gap-2">
            <input
              value={aiQ}
              onChange={(e) => setAiQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") askBreef(); }}
              placeholder="اسأل عن أي مؤشر أو تحليل — مثال: ما هي المواد الأكثر ربحاً؟"
              className="flex-1 px-3 py-2 rounded-lg border border-amber-300 bg-white text-sm text-right"
              disabled={aiBusy}
            />
            <button
              type="button"
              onClick={askBreef}
              disabled={aiBusy || !aiQ.trim()}
              className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50"
            >
              {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              اسأل
            </button>
          </div>
          {aiErr && <p className="mt-2 text-xs text-rose-600">{aiErr}</p>}
          {aiA && (
            <div className="mt-3 p-3 rounded-lg bg-white border border-amber-200 text-sm whitespace-pre-wrap text-right leading-relaxed">
              {aiA}
            </div>
          )}
        </section>

        {/* KPI Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <KpiStackedCard Icon={TrendingUp} tone="emerald"
            topLabel="اجمالي البيع" topValue={formatIQD(kpi.totalSales)}
            subLabel="البيع اليومي" subValue={formatIQD(kpi.dailySales)} />
          <KpiStackedCard Icon={TrendingDown} tone="rose"
            topLabel="اجمالي الصرفيات" topValue={formatIQD(kpi.totalExpenses)}
            subLabel="الصرفيات اليوم" subValue={formatIQD(kpi.todayExpenses)} />
          <KpiStackedCard Icon={Coins} tone={kpi.totalProfit >= 0 ? "emerald" : "rose"}
            topLabel="اجمالي الربح" topValue={formatIQD(kpi.totalProfit)}
            subLabel="ربح اليوم" subValue={formatIQD(kpi.todayProfit)} />
          <KpiStackedCard Icon={Warehouse} tone="amber"
            topLabel="اجمالي كلفة المخزن" topValue={formatIQD(kpi.warehouseCost)}
            subLabel="قيمة المخزن - سعر البيع" subValue={formatIQD(kpi.warehouseRetail)} />
          <KpiStackedCard Icon={CreditCard} tone="cyan"
            topLabel="اجمالي الديون" topValue={formatIQD(kpi.totalDebts)}
            subLabel="نسبة قريب الانتهاء" subValue={`${kpi.nearExpiryRatio.toFixed(1)}%`} />
        </section>

        {/* Consolidated Analytics Table */}
        <section className="border rounded-xl overflow-hidden bg-white shadow-sm">
          <header className="px-4 py-3 border-b bg-amber-50/60 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-800">تحليل الأداء — الأكثر مبيعاً والأكثر ربحاً</h3>
            <span className="mr-auto text-[10px] text-slate-500 font-mono">{sortedRows.length} صف</span>
          </header>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-800 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-right text-slate-800">المادة</th>
                  <SortableTh label="كمية المباع" k="sold" active={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="الربح" k="profit" active={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="نسبة الربح %" k="margin" active={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="الاكسباير" k="expiry" active={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="الكمية الحالية" k="stock" active={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="الصرف الشهري" k="monthly" active={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="مقترح الفائض" k="surplus" active={sortKey} dir={sortDir} onClick={toggleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((r) => (
                  <tr key={r.id} className="hover:bg-amber-50/40">
                    <td className="px-3 py-1.5 font-semibold text-slate-900">{r.name}</td>
                    <td className="px-3 py-1.5 font-mono font-bold text-emerald-700">{r.sold}</td>
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-900">{formatIQD(r.profit)}</td>
                    <td className={`px-3 py-1.5 font-mono font-bold ${r.margin >= 25 ? "text-emerald-700" : r.margin >= 10 ? "text-amber-700" : "text-rose-600"}`}>{r.margin.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 font-mono text-slate-800 text-[11px]">{r.expiry ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-900">{r.stock}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-800">{r.monthly.toFixed(1)}</td>
                    <td className={`px-3 py-1.5 font-mono font-bold ${r.surplus > 0 ? "text-rose-600" : "text-slate-500"}`}>{r.surplus}</td>
                  </tr>
                ))}
                {sortedRows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">لا توجد بيانات.</td></tr>
                )}

              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function SortableTh({
  label, k, active, dir, onClick,
}: {
  label: string; k: SortKey; active: SortKey; dir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const isActive = active === k;
  return (
    <th className="px-3 py-2 select-none">
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-amber-700 transition ${isActive ? "text-amber-700 font-bold" : ""}`}
      >
        {label}
        {isActive && (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

function KpiStackedCard({
  Icon, tone, topLabel, topValue, subLabel, subValue,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "rose" | "amber" | "cyan";
  topLabel: string; topValue: string; subLabel: string; subValue: string;
}) {
  const toneMap: Record<string, string> = {
    emerald: "border-emerald/40 bg-emerald/5 text-emerald",
    rose: "border-rose-500/40 bg-rose-500/5 text-rose-500",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-600",
    cyan: "border-cyan-500/40 bg-cyan-500/5 text-cyan-600",
  };
  return (
    <div className={`border-2 rounded-xl overflow-hidden flex flex-col shadow-sm ${toneMap[tone]}`}>
      <div className="flex items-center gap-3 p-3 border-b border-current/25 bg-white">
        <div className="size-10 shrink-0 grid place-items-center rounded-lg bg-white border border-current/40">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 truncate">{topLabel}</p>
          <p className="text-lg font-mono font-black mt-0.5 truncate text-slate-950">{topValue}</p>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-2 bg-white">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 truncate">{subLabel}</p>
        <p className="text-sm font-mono font-black text-slate-950 truncate">{subValue}</p>
      </div>
    </div>
  );
}

