// BI, predictive analytics and loyalty widgets for the Reports ecosystem.
// Clinical slate-blue palette (#4A6B82) with full RTL support.
import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { formatIQD } from "@/lib/pharmacy";
import { listMedicines, type Medicine } from "@/lib/db";
import { toast } from "sonner";

export const CLINICAL = "#4A6B82";
export const CLINICAL_SOFT = "#7FA0B8";
export const CLINICAL_WARN = "#C06B5A";

// ---------- shared shells -------------------------------------------------
export function BiCard({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: warn ? `${CLINICAL_WARN}66` : `${CLINICAL}55`,
        background: warn ? `${CLINICAL_WARN}12` : `${CLINICAL}12`,
      }}
    >
      <p className="text-[10px] font-bold tracking-widest opacity-70">{label}</p>
      <p className="text-xl font-mono font-bold mt-1" style={{ color: warn ? CLINICAL_WARN : CLINICAL }}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{hint}</p>}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-slate-950/40 p-4" dir="rtl">
      <div className="mb-3">
        <h3 className="text-sm font-bold" style={{ color: CLINICAL }}>
          {title}
        </h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

const th = "px-2 py-1.5 text-[10px] font-bold tracking-wider text-muted-foreground text-right whitespace-nowrap";
const td = "px-2 py-1.5 text-[11px] text-right whitespace-nowrap";

function exportCsv(name: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return toast.error("لا توجد بيانات للتصدير");
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportBtn({ name, rows }: { name: string; rows: Array<Record<string, unknown>> }) {
  return (
    <button
      onClick={() => exportCsv(name, rows)}
      className="px-2.5 py-1 rounded-md border text-[10px] font-bold"
      style={{ borderColor: `${CLINICAL}66`, color: CLINICAL }}
    >
      تصدير CSV
    </button>
  );
}

// ---------- shared data hook ---------------------------------------------
type SaleLine = {
  medicine_id: string;
  qty: number;
  unit_price: number;
  line_total: number;
  invoice_id: string;
  created_at: string;
  employee_id: string | null;
  patient_id: string | null;
};

function useSalesData(from: string, to: string) {
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [{ data: items }, m] = await Promise.all([
        supabase
          .from("sales_invoice_items")
          .select(
            "medicine_id, qty, unit_price, line_total, invoice_id, sales_invoices!inner(created_at, employee_id, patient_id)",
          )
          .gte("sales_invoices.created_at", `${from}T00:00:00`)
          .lte("sales_invoices.created_at", `${to}T23:59:59`),
        listMedicines(),
      ]);
      if (!alive) return;
      const rows: SaleLine[] = ((items ?? []) as any[]).map((r) => ({
        medicine_id: r.medicine_id,
        qty: Number(r.qty || 0),
        unit_price: Number(r.unit_price || 0),
        line_total: Number(r.line_total || 0),
        invoice_id: r.invoice_id,
        created_at: r.sales_invoices?.created_at ?? "",
        employee_id: r.sales_invoices?.employee_id ?? null,
        patient_id: r.sales_invoices?.patient_id ?? null,
      }));
      setLines(rows);
      setMeds(m);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [from, to]);

  const medMap = useMemo(() => new Map(meds.map((m) => [m.id, m])), [meds]);
  return { lines, meds, medMap, loading };
}

// =========================================================================
// 1. Profit Margins report — margin-on-sales per item / category / supplier
// =========================================================================
export function MarginsReport({ from, to }: { from: string; to: string }) {
  const { lines, meds, medMap, loading } = useSalesData(from, to);
  const [dim, setDim] = useState<"item" | "category" | "company" | "invoice">("item");

  const rows = useMemo(() => {
    const agg = new Map<string, { label: string; qty: number; sales: number; cost: number }>();
    for (const l of lines) {
      const m = medMap.get(l.medicine_id);
      const key =
        dim === "item"
          ? l.medicine_id
          : dim === "category"
            ? m?.category || "غير مصنف"
            : dim === "company"
              ? m?.company || "غير محدد"
              : l.invoice_id;
      const label =
        dim === "item"
          ? m?.trade_name || "—"
          : dim === "invoice"
            ? `فاتورة ${l.invoice_id.slice(0, 6)}`
            : key;
      const cur = agg.get(key) ?? { label, qty: 0, sales: 0, cost: 0 };
      cur.qty += l.qty;
      cur.sales += l.line_total;
      cur.cost += l.qty * Number(m?.small_unit_cost || 0);
      agg.set(key, cur);
    }
    return [...agg.values()]
      .map((r) => ({
        ...r,
        profit: r.sales - r.cost,
        margin: r.sales > 0 ? ((r.sales - r.cost) / r.sales) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [lines, medMap, dim]);

  const totals = rows.reduce(
    (a, r) => ({ sales: a.sales + r.sales, cost: a.cost + r.cost, profit: a.profit + r.profit }),
    { sales: 0, cost: 0, profit: 0 },
  );
  const totalMargin = totals.sales > 0 ? (totals.profit / totals.sales) * 100 : 0;

  const chart = rows.slice(0, 10).map((r) => ({ name: r.label.slice(0, 18), margin: +r.margin.toFixed(1) }));

  if (loading) return <Panel title="تقرير هوامش الربح">جارِ التحميل…</Panel>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <BiCard label="إجمالي المبيعات" value={formatIQD(totals.sales)} />
        <BiCard label="إجمالي الكلفة" value={formatIQD(totals.cost)} />
        <BiCard label="صافي الربح" value={formatIQD(totals.profit)} />
        <BiCard
          label="هامش الربح من المبيعات"
          value={`${totalMargin.toFixed(1)}%`}
          hint="الهامش = (المبيعات − الكلفة) ÷ المبيعات"
          warn={totalMargin < 15}
        />
      </div>

      <Panel title="تقرير هوامش الربح" subtitle="تحليل الهامش الصافي لكل مادة ومجموعة وشركة وفاتورة (منطق الهامش على سعر البيع).">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {(
            [
              ["item", "حسب المادة"],
              ["category", "حسب المجموعة"],
              ["company", "حسب الشركة/المورد"],
              ["invoice", "حسب الفاتورة"],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setDim(k)}
              className="px-2.5 py-1 rounded-md border text-[10px] font-bold transition"
              style={
                dim === k
                  ? { background: CLINICAL, borderColor: CLINICAL, color: "#fff" }
                  : { borderColor: `${CLINICAL}55`, color: CLINICAL }
              }
            >
              {lbl}
            </button>
          ))}
          <div className="flex-1" />
          <ExportBtn name={`margins_${dim}`} rows={rows} />
        </div>

        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8" }} interval={0} angle={-20} height={44} />
              <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} unit="%" />
              <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ fontSize: 11, direction: "rtl" }} />
              <Bar dataKey="margin" radius={[4, 4, 0, 0]}>
                {chart.map((c, i) => (
                  <Cell key={i} fill={c.margin < 10 ? CLINICAL_WARN : CLINICAL} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-auto mt-3 max-h-[320px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-950">
              <tr className="border-b border-border">
                <th className={th}>#</th>
                <th className={th}>الاسم</th>
                <th className={th}>الكمية</th>
                <th className={th}>المبيعات</th>
                <th className={th}>الكلفة</th>
                <th className={th}>الربح</th>
                <th className={th}>الهامش %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className={td}>{i + 1}</td>
                  <td className={`${td} font-bold`}>{r.label}</td>
                  <td className={`${td} font-mono`}>{r.qty}</td>
                  <td className={`${td} font-mono`}>{formatIQD(r.sales)}</td>
                  <td className={`${td} font-mono`}>{formatIQD(r.cost)}</td>
                  <td className={`${td} font-mono`}>{formatIQD(r.profit)}</td>
                  <td className={`${td} font-mono font-bold`} style={{ color: r.margin < 10 ? CLINICAL_WARN : CLINICAL }}>
                    {r.margin.toFixed(1)}%
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-center text-muted-foreground`} colSpan={7}>
                    لا توجد مبيعات ضمن الفترة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">عدد المواد النشطة: {meds.length}</p>
      </Panel>
    </div>
  );
}

// =========================================================================
// 2. Sales & consumption forecasting
// =========================================================================
export function ForecastReport() {
  const [rows, setRows] = useState<Array<{ month: string; sales: number; qty: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState(3);

  useEffect(() => {
    let alive = true;
    (async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data } = await supabase
        .from("sales_invoice_items")
        .select("qty, line_total, sales_invoices!inner(created_at)")
        .gte("sales_invoices.created_at", since.toISOString());
      if (!alive) return;
      const agg = new Map<string, { sales: number; qty: number }>();
      for (const r of (data ?? []) as any[]) {
        const key = String(r.sales_invoices?.created_at ?? "").slice(0, 7);
        if (!key) continue;
        const cur = agg.get(key) ?? { sales: 0, qty: 0 };
        cur.sales += Number(r.line_total || 0);
        cur.qty += Number(r.qty || 0);
        agg.set(key, cur);
      }
      setRows([...agg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v })));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Linear-trend forecast with seasonal index over historical months.
  const chart = useMemo(() => {
    const hist = rows.map((r, i) => ({ ...r, i }));
    const n = hist.length;
    const base = hist.map((h) => ({ month: h.month, actual: Math.round(h.sales), forecast: null as number | null }));
    if (n < 2) return base;
    const sx = hist.reduce((a, h) => a + h.i, 0);
    const sy = hist.reduce((a, h) => a + h.sales, 0);
    const sxy = hist.reduce((a, h) => a + h.i * h.sales, 0);
    const sxx = hist.reduce((a, h) => a + h.i * h.i, 0);
    const slope = (n * sxy - sx * sy) / Math.max(1, n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    const avg = sy / n;
    const out = [...base];
    // stitch the forecast line to the last actual point
    out[out.length - 1] = { ...out[out.length - 1], forecast: out[out.length - 1].actual };
    const last = new Date(`${hist[n - 1].month}-01T00:00:00`);
    for (let k = 1; k <= horizon; k++) {
      const d = new Date(last);
      d.setMonth(d.getMonth() + k);
      const month = d.toISOString().slice(0, 7);
      const seasonalSame = hist.filter((h) => h.month.slice(5) === month.slice(5));
      const seasonIdx =
        seasonalSame.length && avg > 0 ? seasonalSame.reduce((a, h) => a + h.sales, 0) / seasonalSame.length / avg : 1;
      const trend = intercept + slope * (n - 1 + k);
      out.push({ month, actual: null as any, forecast: Math.max(0, Math.round(trend * seasonIdx)) });
    }
    return out;
  }, [rows, horizon]);

  const nextMonth = chart.find((c) => c.actual === null && c.forecast !== null);
  const lastActual = [...chart].reverse().find((c) => c.actual !== null);
  const growth =
    nextMonth && lastActual && lastActual.actual
      ? ((nextMonth.forecast! - lastActual.actual) / lastActual.actual) * 100
      : 0;

  if (loading) return <Panel title="التنبؤ بالمبيعات والاستهلاك">جارِ التحميل…</Panel>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <BiCard label="أشهر البيانات التاريخية" value={String(rows.length)} />
        <BiCard label="متوسط المبيعات الشهرية" value={formatIQD(rows.reduce((a, r) => a + r.sales, 0) / Math.max(1, rows.length))} />
        <BiCard label="توقع الشهر القادم" value={nextMonth ? formatIQD(nextMonth.forecast!) : "—"} />
        <BiCard label="نسبة النمو المتوقعة" value={`${growth.toFixed(1)}%`} warn={growth < 0} />
      </div>

      <Panel
        title="التنبؤ بالمبيعات والاستهلاك (AI)"
        subtitle="نموذج انحدار خطي مع معامل موسمي مبني على مبيعات آخر 12 شهراً."
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-muted-foreground">مدى التنبؤ:</span>
          {[1, 3, 6].map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className="px-2.5 py-1 rounded-md border text-[10px] font-bold"
              style={
                horizon === h
                  ? { background: CLINICAL, borderColor: CLINICAL, color: "#fff" }
                  : { borderColor: `${CLINICAL}55`, color: CLINICAL }
              }
            >
              {h} أشهر
            </button>
          ))}
          <div className="flex-1" />
          <ExportBtn name="forecast" rows={chart as any} />
        </div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatIQD(v)} contentStyle={{ fontSize: 11, direction: "rtl" }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line name="فعلي" type="monotone" dataKey="actual" stroke={CLINICAL} strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line
                name="متوقع"
                type="monotone"
                dataKey="forecast"
                stroke={CLINICAL_SOFT}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}

// =========================================================================
// 3. Stock-out & shortage predictive alerts
// =========================================================================
export function StockoutPredictReport() {
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [rate, setRate] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState(14);

  useEffect(() => {
    let alive = true;
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const [m, { data }] = await Promise.all([
        listMedicines(),
        supabase
          .from("sales_invoice_items")
          .select("medicine_id, qty, sales_invoices!inner(created_at)")
          .gte("sales_invoices.created_at", since.toISOString()),
      ]);
      if (!alive) return;
      const agg: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) agg[r.medicine_id] = (agg[r.medicine_id] ?? 0) + Number(r.qty || 0);
      setMeds(m);
      setRate(agg);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    return meds
      .filter((m) => m.is_active)
      .map((m) => {
        const daily = (rate[m.id] ?? 0) / 90;
        const days = daily > 0 ? m.quantity_in_stock / daily : Infinity;
        const target = Math.max(m.minimum_stock, Math.ceil(daily * (lead + 30)));
        return {
          id: m.id,
          name: m.trade_name,
          stock: m.quantity_in_stock,
          daily: +daily.toFixed(2),
          days: Number.isFinite(days) ? Math.floor(days) : null,
          suggest: Math.max(0, target - m.quantity_in_stock),
        };
      })
      .filter((r) => r.daily > 0 && r.days !== null && r.days! <= lead + 30)
      .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
  }, [meds, rate, lead]);

  const critical = rows.filter((r) => (r.days ?? 999) <= lead);

  if (loading) return <Panel title="التنبؤ بالنواقص">جارِ التحميل…</Panel>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <BiCard label="مواد مهددة بالنفاد" value={String(rows.length)} />
        <BiCard label="حرِجة خلال فترة التجهيز" value={String(critical.length)} warn={critical.length > 0} />
        <BiCard label="إجمالي الكميات المقترحة" value={String(rows.reduce((a, r) => a + r.suggest, 0))} />
        <BiCard label="فترة التجهيز (يوم)" value={String(lead)} />
      </div>

      <Panel
        title="التنبؤ بالنواقص والطلب"
        subtitle="يحسب معدل الاستهلاك اليومي من مبيعات آخر 90 يوماً وينبّه قبل نفاد المادة مع اقتراح كمية الطلب."
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-muted-foreground">فترة التجهيز:</span>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setLead(d)}
              className="px-2.5 py-1 rounded-md border text-[10px] font-bold"
              style={
                lead === d
                  ? { background: CLINICAL, borderColor: CLINICAL, color: "#fff" }
                  : { borderColor: `${CLINICAL}55`, color: CLINICAL }
              }
            >
              {d} يوم
            </button>
          ))}
          <div className="flex-1" />
          <ExportBtn name="stockout_forecast" rows={rows} />
        </div>
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-950">
              <tr className="border-b border-border">
                <th className={th}>#</th>
                <th className={th}>المادة</th>
                <th className={th}>الرصيد</th>
                <th className={th}>معدل الاستهلاك اليومي</th>
                <th className={th}>أيام حتى النفاد</th>
                <th className={th}>الكمية المقترحة</th>
                <th className={th}>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const crit = (r.days ?? 999) <= lead;
                return (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className={td}>{i + 1}</td>
                    <td className={`${td} font-bold`}>{r.name}</td>
                    <td className={`${td} font-mono`}>{r.stock}</td>
                    <td className={`${td} font-mono`}>{r.daily}</td>
                    <td className={`${td} font-mono font-bold`} style={{ color: crit ? CLINICAL_WARN : CLINICAL }}>
                      {r.days}
                    </td>
                    <td className={`${td} font-mono`}>{r.suggest}</td>
                    <td className={td}>
                      <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                        style={{
                          background: crit ? `${CLINICAL_WARN}22` : `${CLINICAL}22`,
                          color: crit ? CLINICAL_WARN : CLINICAL,
                        }}
                      >
                        {crit ? "طلب عاجل" : "مراقبة"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-center text-muted-foreground`} colSpan={7}>
                    لا توجد مواد مهددة بالنفاد حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// =========================================================================
// 4. Multi-level performance analytics (branch / employee / category)
// =========================================================================
export function PerformanceAnalytics({ from, to }: { from: string; to: string }) {
  const { lines, medMap, loading } = useSalesData(from, to);
  const [level, setLevel] = useState<"employee" | "category" | "branch">("employee");
  const [employees, setEmployees] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchStock, setBranchStock] = useState<Array<{ branch_id: string; medicine_id: string; quantity: number }>>([]);

  useEffect(() => {
    (async () => {
      const [{ data: emp }, { data: br }, { data: bs }] = await Promise.all([
        supabase.from("employees").select("id,name"),
        supabase.from("branches").select("id,name"),
        supabase.from("medicine_branch_stocks").select("branch_id,medicine_id,quantity"),
      ]);
      setEmployees(Object.fromEntries(((emp ?? []) as any[]).map((e) => [e.id, e.name])));
      setBranches((br ?? []) as any[]);
      setBranchStock((bs ?? []) as any[]);
    })();
  }, []);

  const rows = useMemo(() => {
    if (level === "branch") {
      const costMap = new Map<string, number>();
      for (const bs of branchStock) {
        const m = medMap.get(bs.medicine_id);
        costMap.set(bs.branch_id, (costMap.get(bs.branch_id) ?? 0) + bs.quantity * Number(m?.small_unit_cost || 0));
      }
      return branches.map((b) => ({
        label: b.name,
        qty: branchStock.filter((s) => s.branch_id === b.id).reduce((a, s) => a + s.quantity, 0),
        sales: costMap.get(b.id) ?? 0,
        profit: 0,
      }));
    }
    const agg = new Map<string, { label: string; qty: number; sales: number; cost: number }>();
    for (const l of lines) {
      const m = medMap.get(l.medicine_id);
      const key =
        level === "employee" ? l.employee_id || "unassigned" : m?.category || "غير مصنف";
      const label = level === "employee" ? employees[key] || "غير محدد" : key;
      const cur = agg.get(key) ?? { label, qty: 0, sales: 0, cost: 0 };
      cur.qty += l.qty;
      cur.sales += l.line_total;
      cur.cost += l.qty * Number(m?.small_unit_cost || 0);
      agg.set(key, cur);
    }
    return [...agg.values()]
      .map((r) => ({ label: r.label, qty: r.qty, sales: r.sales, profit: r.sales - r.cost }))
      .sort((a, b) => b.sales - a.sales);
  }, [lines, medMap, level, employees, branches, branchStock]);

  if (loading) return <Panel title="تحليلات الأداء">جارِ التحميل…</Panel>;

  const chart = rows.slice(0, 12).map((r) => ({
    name: r.label.slice(0, 16),
    sales: Math.round(r.sales),
    profit: Math.round(r.profit),
  }));

  return (
    <div className="space-y-3" dir="rtl">
      <Panel
        title="تحليلات الفروع والموظفين والأصناف"
        subtitle="مقارنة تفاعلية لأداء المبيعات والأرباح حسب الفرع، الصيدلاني/الوردية، ومجاميع المواد."
      >
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {(
            [
              ["employee", "حسب الصيدلاني/الوردية"],
              ["category", "حسب مجموعة المواد"],
              ["branch", "حسب الفرع"],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setLevel(k)}
              className="px-2.5 py-1 rounded-md border text-[10px] font-bold"
              style={
                level === k
                  ? { background: CLINICAL, borderColor: CLINICAL, color: "#fff" }
                  : { borderColor: `${CLINICAL}55`, color: CLINICAL }
              }
            >
              {lbl}
            </button>
          ))}
          <div className="flex-1" />
          <ExportBtn name={`performance_${level}`} rows={rows} />
        </div>

        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8" }} interval={0} angle={-20} height={48} />
              <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatIQD(v)} contentStyle={{ fontSize: 11, direction: "rtl" }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar name={level === "branch" ? "قيمة المخزون" : "المبيعات"} dataKey="sales" fill={CLINICAL} radius={[4, 4, 0, 0]} />
              {level !== "branch" && (
                <Bar name="الربح" dataKey="profit" fill={CLINICAL_SOFT} radius={[4, 4, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-auto mt-3 max-h-[300px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-950">
              <tr className="border-b border-border">
                <th className={th}>#</th>
                <th className={th}>{level === "branch" ? "الفرع" : level === "employee" ? "الصيدلاني" : "المجموعة"}</th>
                <th className={th}>الكمية</th>
                <th className={th}>{level === "branch" ? "قيمة المخزون" : "المبيعات"}</th>
                {level !== "branch" && <th className={th}>الربح</th>}
                {level !== "branch" && <th className={th}>الهامش %</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className={td}>{i + 1}</td>
                  <td className={`${td} font-bold`}>{r.label}</td>
                  <td className={`${td} font-mono`}>{r.qty}</td>
                  <td className={`${td} font-mono`}>{formatIQD(r.sales)}</td>
                  {level !== "branch" && <td className={`${td} font-mono`}>{formatIQD(r.profit)}</td>}
                  {level !== "branch" && (
                    <td className={`${td} font-mono`} style={{ color: CLINICAL }}>
                      {r.sales > 0 ? ((r.profit / r.sales) * 100).toFixed(1) : "0.0"}%
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-center text-muted-foreground`} colSpan={6}>
                    لا توجد بيانات ضمن الفترة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// =========================================================================
// 5. Cloud dashboard & scheduled reports
// =========================================================================
type Schedule = {
  id: string;
  report: string;
  frequency: "daily" | "weekly" | "monthly";
  time: string;
  channel: "whatsapp" | "telegram" | "email";
  target: string;
  format: "pdf" | "excel";
  enabled: boolean;
  last_sent?: string | null;
};

const REPORT_OPTIONS = [
  "مبيعات فواتير",
  "تقرير هوامش الربح",
  "التنبؤ بالنواقص والطلب",
  "القاصة اليومية",
  "تقرير الديون",
  "تحليلات الأداء",
];

export function ScheduledReports() {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Omit<Schedule, "id">>({
    report: REPORT_OPTIONS[0],
    frequency: "daily",
    time: "08:00",
    channel: "whatsapp",
    target: "",
    format: "pdf",
    enabled: true,
    last_sent: null,
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("pharmacy_settings")
        .select("value")
        .eq("key", "report_schedules")
        .maybeSingle();
      setRows(((data?.value as any) ?? []) as Schedule[]);
      setLoading(false);
    })();
  }, []);

  async function persist(next: Schedule[]) {
    setRows(next);
    const { error } = await supabase
      .from("pharmacy_settings")
      .upsert({ key: "report_schedules", value: next as any }, { onConflict: "key" });
    if (error) toast.error(error.message);
  }

  function add() {
    if (!draft.target.trim()) return toast.error("أدخل رقم/معرّف المستلم");
    persist([...rows, { ...draft, id: crypto.randomUUID() }]);
    setDraft({ ...draft, target: "" });
    toast.success("تمت إضافة الجدولة");
  }

  function sendNow(s: Schedule) {
    const text = encodeURIComponent(`تقرير ${s.report} — Breef Pharmacy (${new Date().toLocaleDateString("ar-IQ")})`);
    const url =
      s.channel === "whatsapp"
        ? `https://wa.me/${s.target.replace(/\D/g, "")}?text=${text}`
        : s.channel === "telegram"
          ? `https://t.me/${s.target.replace(/^@/, "")}`
          : `mailto:${s.target}?subject=${text}`;
    window.open(url, "_blank", "noopener");
    persist(rows.map((r) => (r.id === s.id ? { ...r, last_sent: new Date().toISOString() } : r)));
  }

  const sel = "bg-slate-800 border border-border rounded-md px-2 py-1 text-[11px]";

  if (loading) return <Panel title="Dashboard سحابية وتقارير مجدولة">جارِ التحميل…</Panel>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <BiCard label="جدولات مفعّلة" value={String(rows.filter((r) => r.enabled).length)} />
        <BiCard label="إجمالي الجدولات" value={String(rows.length)} />
        <BiCard label="قنوات الإرسال" value="WhatsApp / Telegram / Email" />
        <BiCard label="صيغ التصدير" value="PDF / Excel" />
      </div>

      <Panel
        title="Dashboard سحابية وتقارير مخصصة"
        subtitle="جدولة إرسال التقارير تلقائياً عبر واتساب أو تيليجرام بصيغة PDF/Excel يومياً أو أسبوعياً."
      >
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <select value={draft.report} onChange={(e) => setDraft({ ...draft, report: e.target.value })} className={sel}>
            {REPORT_OPTIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select
            value={draft.frequency}
            onChange={(e) => setDraft({ ...draft, frequency: e.target.value as Schedule["frequency"] })}
            className={sel}
          >
            <option value="daily">يومي</option>
            <option value="weekly">أسبوعي</option>
            <option value="monthly">شهري</option>
          </select>
          <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className={sel} />
          <select
            value={draft.channel}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value as Schedule["channel"] })}
            className={sel}
          >
            <option value="whatsapp">واتساب</option>
            <option value="telegram">تيليجرام</option>
            <option value="email">بريد إلكتروني</option>
          </select>
          <input
            value={draft.target}
            onChange={(e) => setDraft({ ...draft, target: e.target.value })}
            placeholder="رقم الهاتف / المعرّف"
            className={`${sel} w-40`}
          />
          <select
            value={draft.format}
            onChange={(e) => setDraft({ ...draft, format: e.target.value as Schedule["format"] })}
            className={sel}
          >
            <option value="pdf">PDF</option>
            <option value="excel">Excel</option>
          </select>
          <button
            onClick={add}
            className="px-3 py-1.5 rounded-md text-[11px] font-bold text-white"
            style={{ background: CLINICAL }}
          >
            + إضافة جدولة
          </button>
        </div>

        <div className="overflow-auto max-h-[340px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-950">
              <tr className="border-b border-border">
                <th className={th}>#</th>
                <th className={th}>التقرير</th>
                <th className={th}>التكرار</th>
                <th className={th}>الوقت</th>
                <th className={th}>القناة</th>
                <th className={th}>المستلم</th>
                <th className={th}>الصيغة</th>
                <th className={th}>آخر إرسال</th>
                <th className={th}>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className={td}>{i + 1}</td>
                  <td className={`${td} font-bold`}>{r.report}</td>
                  <td className={td}>{r.frequency === "daily" ? "يومي" : r.frequency === "weekly" ? "أسبوعي" : "شهري"}</td>
                  <td className={`${td} font-mono`}>{r.time}</td>
                  <td className={td}>{r.channel === "whatsapp" ? "واتساب" : r.channel === "telegram" ? "تيليجرام" : "بريد"}</td>
                  <td className={`${td} font-mono`}>{r.target}</td>
                  <td className={td}>{r.format.toUpperCase()}</td>
                  <td className={`${td} font-mono text-muted-foreground`}>
                    {r.last_sent ? new Date(r.last_sent).toLocaleString("ar-IQ") : "—"}
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => sendNow(r)}
                        className="px-2 py-0.5 rounded-md border text-[10px] font-bold"
                        style={{ borderColor: `${CLINICAL}66`, color: CLINICAL }}
                      >
                        إرسال الآن
                      </button>
                      <button
                        onClick={() => persist(rows.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))}
                        className="px-2 py-0.5 rounded-md border border-border text-[10px] font-bold"
                      >
                        {r.enabled ? "إيقاف" : "تفعيل"}
                      </button>
                      <button
                        onClick={() => persist(rows.filter((x) => x.id !== r.id))}
                        className="px-2 py-0.5 rounded-md border border-destructive/40 text-destructive text-[10px] font-bold"
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-center text-muted-foreground`} colSpan={9}>
                    لا توجد جدولات — أضف واحدة من الأعلى.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// =========================================================================
// 6. Patient loyalty & retention KPI card (patient profile)
// =========================================================================
export function PatientLoyaltyCard({ patientId }: { patientId: string | null }) {
  const [stats, setStats] = useState<{
    invoices: number;
    ltv: number;
    avg: number;
    firstAt: string | null;
    lastAt: string | null;
    gapDays: number | null;
    repeatRate: number;
    compliance: number;
    chronicCount: number;
  } | null>(null);

  useEffect(() => {
    if (!patientId) return setStats(null);
    let alive = true;
    (async () => {
      const [{ data: inv }, { data: pat }] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select("id,total,created_at")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: true }),
        supabase.from("patients").select("chronic_meds").eq("id", patientId).maybeSingle(),
      ]);
      if (!alive) return;
      const rows = (inv ?? []) as Array<{ total: number; created_at: string }>;
      const ltv = rows.reduce((a, r) => a + Number(r.total || 0), 0);
      const firstAt = rows[0]?.created_at ?? null;
      const lastAt = rows[rows.length - 1]?.created_at ?? null;
      const gapDays = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000) : null;
      const spanMonths =
        firstAt && lastAt
          ? Math.max(1, (new Date(lastAt).getTime() - new Date(firstAt).getTime()) / (86400000 * 30))
          : 1;
      const repeatRate = rows.length > 1 ? Math.min(100, (rows.length / spanMonths) * 100) : 0;
      const chronicCount = ((pat?.chronic_meds as string[]) ?? []).length;
      // compliance: chronic patient expected to refill every 30 days
      const compliance = chronicCount > 0 && gapDays !== null ? Math.max(0, Math.min(100, 100 - ((gapDays - 30) / 30) * 50)) : 0;
      setStats({
        invoices: rows.length,
        ltv,
        avg: rows.length ? ltv / rows.length : 0,
        firstAt,
        lastAt,
        gapDays,
        repeatRate,
        compliance,
        chronicCount,
      });
    })();
    return () => {
      alive = false;
    };
  }, [patientId]);

  if (!patientId) return null;

  const tier =
    !stats || stats.invoices === 0
      ? "جديد"
      : stats.ltv > 500000 || stats.invoices >= 10
        ? "مريض ذهبي"
        : stats.invoices >= 4
          ? "مريض فضي"
          : "مريض نشط";

  return (
    <div className="rounded-xl border border-border bg-slate-950/40 p-3" dir="rtl">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold" style={{ color: CLINICAL }}>
          مؤشرات ولاء المريض والاحتفاظ
        </h3>
        <span
          className="px-2 py-0.5 rounded-md text-[10px] font-bold"
          style={{ background: `${CLINICAL}22`, color: CLINICAL }}
        >
          {tier}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <BiCard label="عدد الزيارات/الفواتير" value={String(stats?.invoices ?? 0)} />
        <BiCard label="القيمة العمرية (LTV)" value={formatIQD(stats?.ltv ?? 0)} />
        <BiCard label="متوسط الفاتورة" value={formatIQD(stats?.avg ?? 0)} />
        <BiCard
          label="معدل تكرار الصرف"
          value={`${(stats?.repeatRate ?? 0).toFixed(0)}%`}
          hint="زيارات لكل شهر ضمن فترة التعامل"
        />
        <BiCard
          label="التزام العلاج المزمن"
          value={stats?.chronicCount ? `${(stats?.compliance ?? 0).toFixed(0)}%` : "—"}
          hint={
            stats?.gapDays !== null && stats?.gapDays !== undefined
              ? `آخر صرف قبل ${stats.gapDays} يوم`
              : "لا توجد مشتريات"
          }
          warn={(stats?.chronicCount ?? 0) > 0 && (stats?.compliance ?? 0) < 60}
        />
      </div>
    </div>
  );
}
