import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { formatIQD } from "@/lib/pharmacy";
import { listMedicines, listPatients, type Medicine, type PatientRow } from "@/lib/db";
import { getClinical } from "@/lib/clinical";
import { addToCart } from "@/lib/procurement-cart";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";
import {
  CLINICAL,
  MarginsReport,
  ForecastReport,
  StockoutPredictReport,
  PerformanceAnalytics,
  ScheduledReports,
} from "@/components/bi-reports";


export const Route = createFileRoute("/reports")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "التقارير — Breef Pharmacy" },
      { name: "description", content: "تقارير شاملة للمبيعات والمشتريات والمواد والأرباح والحسابات والمرضى." },
    ],
  }),
  component: ReportsPage,
});

// ---- Workspace sections, sidebar categories & their button matrices ----
type SectionKey = "ops" | "bi" | "ai";

const SECTIONS: { key: SectionKey; label: string; desc: string }[] = [
  { key: "ops", label: "التقارير التشغيلية اليومية", desc: "المبيعات، المشتريات، المواد، الحسابات، الأرباح والمرضى." },
  { key: "bi", label: "ذكاء الأعمال والتحليلات المتقدمة", desc: "هوامش الربح، تحليلات الفروع والموظفين، ولوحات سحابية مجدولة." },
  { key: "ai", label: "تقارير التنبؤ بالذكاء الاصطناعي", desc: "التنبؤ بالمبيعات والاستهلاك والنواقص قبل حدوثها." },
];

type Category = {
  key: string;
  section: SectionKey;
  label: string;
  color: string;
  buttons: { key: string; label: string; icon: string }[];
};

const CATEGORIES: Category[] = [
  {
    key: "sales",
    section: "ops",

    label: "تقارير المبيعات",
    color: "emerald",
    buttons: [
      { key: "sales_summary", label: "مبيعات فواتير", icon: "🧾" },
      // "sales_detail" removed per spec
      { key: "sales_today", label: "تقرير مبيعات اليوم", icon: "🛒" },
      { key: "sales_customers", label: "مبيعات مرضى", icon: "👥" },
      { key: "sales_reps", label: "مبيعات تواجد", icon: "🕒" },
      { key: "sales_chart", label: "مخطط يومي/شهري للمبيعات", icon: "📈" },
      { key: "sales_unpaid", label: "ديون المرضى (بيع بالآجل)", icon: "💳" },
    ],
  },
  {
    key: "purchases",
    section: "ops",
    label: "تقارير المشتريات",
    color: "amber",
    buttons: [
      { key: "pur_vendor_reports", label: "تقارير الموردين", icon: "🏦" },
      { key: "pur_invoices", label: "مشتريات فواتير", icon: "🧾" },
      { key: "pur_products", label: "مشتريات منتجات", icon: "📦" },
      { key: "pur_items_detail", label: "مشتريات منتجات تفصيلي", icon: "📋" },
      { key: "pur_returns", label: "مرتجع مشتريات تفصيلي", icon: "↩️" },
    ],
  },
  {
    key: "items",
    section: "ops",
    label: "تقارير المواد",
    color: "sky",
    buttons: [
      { key: "items_all", label: "جرد عام", icon: "📊" },
      { key: "items_dead", label: "المواد الراكدة", icon: "💤" },
      { key: "items_negative", label: "الكميات السالبة", icon: "➖" },
      { key: "items_expire", label: "منتجات اكسباير", icon: "⏰" },
      { key: "items_reorder", label: "حد الطلب", icon: "🔔" },
      { key: "items_movement", label: "حركة مادة لفترة معينة", icon: "🔀" },
      { key: "items_hazard", label: "مواد خطرة", icon: "⚠️" },
    ],
  },
  {
    key: "accounts",
    section: "ops",
    label: "تقارير الحسابات",
    color: "violet",
    buttons: [
      { key: "acc_statement", label: "كشف حساب", icon: "🧮" },
      { key: "acc_cashbox", label: "القاصة اليومية", icon: "💵" },
      { key: "acc_fund_movements", label: "حركة الصناديق", icon: "🔄" },
      { key: "acc_reconcile", label: "المطابقة اليومية", icon: "🔁" },
      { key: "acc_debts", label: "تقرير الديون", icon: "💳" },
      { key: "acc_expenses", label: "تقرير المصاريف", icon: "💰" },
    ],

  },
  {
    key: "profits",
    section: "ops",
    label: "تقارير الأرباح",
    color: "emerald",
    buttons: [
      { key: "prof_invoices", label: "أرباح فواتير", icon: "💹" },
      { key: "prof_customers", label: "أرباح عملاء", icon: "👤" },
      { key: "prof_groups", label: "أرباح مجموعات", icon: "🗂️" },
      { key: "prof_items", label: "أرباح مواد", icon: "💊" },
      { key: "prof_balance", label: "تقرير الموازنة", icon: "⚖️" },
    ],
  },
  {
    key: "patients",
    section: "ops",
    label: "تقارير المرضى",
    color: "pink",
    buttons: [
      { key: "patients_comprehensive", label: "تقرير مرضى شامل", icon: "🧬" },
      { key: "patients_interests", label: "مرضى حسب الاهتمامات", icon: "🎯" },
      { key: "patients_chronic_meds", label: "مرضى حسب العلاج المزمن", icon: "💊" },
      { key: "patients_chronic_diseases", label: "مرضى حسب الأمراض المزمنة", icon: "🩺" },
      { key: "patients_lapsed", label: "مرضى حسب فترة الانقطاع", icon: "⏳" },
      { key: "patients_chronic", label: "المرضى المزمنون", icon: "📋" },

    ],
  },
  {
    key: "bi_analytics",
    section: "bi",
    label: "ذكاء الأعمال",
    color: "sky",
    buttons: [
      { key: "bi_margins", label: "تقرير هوامش الربح", icon: "📐" },
      { key: "bi_performance", label: "تحليلات الفروع والموظفين والأصناف", icon: "🏥" },
      { key: "bi_scheduled", label: "Dashboard سحابية وتقارير مجدولة", icon: "☁️" },
    ],
  },
  {
    key: "ai_predictive",
    section: "ai",
    label: "التنبؤ الذكي",
    color: "violet",
    buttons: [
      { key: "ai_forecast", label: "التنبؤ بالمبيعات والاستهلاك", icon: "🔮" },
      { key: "ai_stockout", label: "التنبؤ بالنواقص والطلب", icon: "🚨" },
    ],
  },
];


function ReportsPage() {
  const [sectionKey, setSectionKey] = useState<SectionKey>("ops");
  const [catKey, setCatKey] = useState<string>("sales");
  const [reportKey, setReportKey] = useState<string>("sales_summary");
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(new Date().toISOString().slice(0, 10));

  const visibleCats = CATEGORIES.filter((c) => c.section === sectionKey);
  const cat = visibleCats.find((c) => c.key === catKey) ?? visibleCats[0];
  const section = SECTIONS.find((s) => s.key === sectionKey)!;

  return (
    <AppShell title="التقارير">
      <div className="flex-1 flex flex-col overflow-hidden" dir="rtl">
        {/* Workspace sections */}
        <div className="border-b border-border bg-slate-950/60 px-3 py-2 flex items-center gap-2 flex-wrap">
          {SECTIONS.map((s) => {
            const active = s.key === sectionKey;
            return (
              <button
                key={s.key}
                onClick={() => {
                  setSectionKey(s.key);
                  const first = CATEGORIES.find((c) => c.section === s.key)!;
                  setCatKey(first.key);
                  setReportKey(first.buttons[0]?.key ?? "");
                }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold border transition"
                style={
                  active
                    ? { background: CLINICAL, borderColor: CLINICAL, color: "#fff" }
                    : { borderColor: `${CLINICAL}55`, color: CLINICAL }
                }
              >
                {s.label}
              </button>
            );
          })}
          <span className="text-[10px] text-muted-foreground">{section.desc}</span>
        </div>

        <div className="flex-1 flex overflow-hidden">
        {/* Right vertical sidebar */}
        <aside className="w-36 shrink-0 border-l border-border bg-slate-950/60 overflow-y-auto">
          <div className="px-2 py-2 border-b border-border">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              التصنيفات
            </p>
          </div>
          <nav className="p-1.5 space-y-1">
            {visibleCats.map((c) => {
              const isActive = c.key === cat.key;
              return (
                <button
                  key={c.key}
                  onClick={() => {
                    setCatKey(c.key);
                    setReportKey(c.buttons[0]?.key ?? "");
                  }}
                  className={`w-full text-right px-2 py-1.5 rounded-md text-[11px] font-bold border transition leading-tight ${
                    isActive
                      ? "bg-emerald/15 border-emerald/40 text-emerald"
                      : "bg-slate-800/40 border-border text-muted-foreground hover:text-foreground hover:border-emerald/30"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </nav>
        </aside>



        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Date pickers */}
          <div className="p-4 border-b border-border bg-slate-950/40 flex items-end gap-3 flex-wrap">
            <DateField label="من تاريخ" value={from} onChange={setFrom} />
            <DateField label="الى تاريخ" value={to} onChange={setTo} />
            <div className="flex-1" />
            <div className="text-left">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">التصنيف</p>
              <p className="text-sm font-bold text-emerald mt-1">{cat.label}</p>
            </div>
          </div>

          {/* Action button matrix */}
          <div className="p-4 border-b border-border bg-slate-900/40">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {cat.buttons.map((b) => {
                const isActive = b.key === reportKey;
                return (
                  <button
                    key={b.key}
                    onClick={() => setReportKey(b.key)}
                    className={`flex items-center gap-2 px-3 py-3 rounded-lg text-xs font-bold border transition text-right ${
                      isActive
                        ? "bg-emerald text-primary-foreground border-emerald shadow-[0_0_20px_rgba(52,211,153,0.25)]"
                        : "bg-slate-800/60 border-border text-foreground hover:bg-emerald/10 hover:border-emerald/40 hover:text-emerald"
                    }`}
                  >
                    <span className="text-lg leading-none">{b.icon}</span>
                    <span className="flex-1">{b.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Report content pane */}
          <section className="flex-1 overflow-auto p-5 space-y-4">
            <ReportContent reportKey={reportKey} from={from} to={to} />
          </section>
        </div>
        </div>
      </div>
    </AppShell>

  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-40 bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald/40"
      />
    </label>
  );
}

function ReportContent({ reportKey, from, to }: { reportKey: string; from: string; to: string }) {
  switch (reportKey) {
    case "sales_today":
      return <TodaysSalesReport />;
    case "sales_summary":
    case "sales_detail":
    case "sales_customers":
    case "sales_reps":
    case "sales_chart":
    case "sales_unpaid":
      return <SalesReport variant={reportKey} from={from} to={to} />;
    case "pur_vendor_reports":
      return <VendorReports from={from} to={to} />;
    case "pur_invoices":
    case "pur_products":
    case "pur_items_detail":
    case "pur_returns":
      return <PurchasesReport variant={reportKey} from={from} to={to} />;
    case "items_all":
    case "items_dead":
    case "items_negative":
    case "items_expire":
    case "items_reorder":
    case "items_movement":
    case "items_hazard":
      return <ItemsReport variant={reportKey} from={from} to={to} />;
    case "acc_statement":
    case "acc_cashbox":
    case "acc_fund_movements":
    case "acc_reconcile":
    case "acc_debts":
    case "acc_expenses":
      return <AccountsReport variant={reportKey} from={from} to={to} />;

    case "prof_invoices":
    case "prof_customers":
    case "prof_groups":
    case "prof_items":
    case "prof_balance":
      return <ProfitsReport variant={reportKey} from={from} to={to} />;
    case "patients_chronic":
      return <ChronicPatientsReport />;
    case "patients_comprehensive":
    case "patients_crm":
      return <ComprehensivePatientsReport />;
    case "patients_interests":
      return <PatientsByInterestsReport />;
    case "patients_chronic_meds":
      return <PatientsByChronicMedsReport />;
    case "patients_chronic_diseases":
      return <PatientsByChronicDiseasesReport />;
    case "patients_lapsed":
      return <PatientsLapsedReport />;

    case "bi_margins":
      return <MarginsReport from={from} to={to} />;
    case "bi_performance":
      return <PerformanceAnalytics from={from} to={to} />;
    case "bi_scheduled":
      return <ScheduledReports />;
    case "ai_forecast":
      return <ForecastReport />;
    case "ai_stockout":
      return <StockoutPredictReport />;



    default:
      return <Placeholder label="اختر تقريراً من الأزرار أعلاه." />;
  }
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
      {label}
    </div>
  );
}

function Card({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  const tone = warn
    ? "border-destructive/40 bg-destructive/5 text-destructive"
    : accent
      ? "border-emerald/40 bg-emerald/5 text-emerald"
      : "border-border bg-slate-800/40";
  return (
    <div className={`border rounded-xl p-4 ${tone}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-2xl font-mono font-bold mt-2">{value}</p>
    </div>
  );
}

// ---- Sales -------------------------------------------------------------
type SalesInvoice = {
  id: string;
  invoice_no: number;
  total: number;
  subtotal: number;
  discount: number;
  addon: number;
  payment_type: string;
  status: string;
  patient_id: string | null;
  created_by: string | null;
  created_at: string;
};

function usePharmacyName() {
  const [name, setName] = useState<string>("الصيدلية");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("pharmacy_settings").select("key,value").eq("key", "pharmacy_name").maybeSingle();
      const v = (data as any)?.value;
      if (typeof v === "string") setName(v);
      else if (v?.name) setName(String(v.name));
    })();
  }, []);
  return name;
}

function useUsersMap() {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_users").select("id,username");
      const m: Record<string, string> = {};
      for (const u of (data ?? []) as any[]) m[u.id] = u.username;
      setMap(m);
    })();
  }, []);
  return map;
}

function SalesReport({ variant, from, to }: { variant: string; from: string; to: string }) {
  const [rows, setRows] = useState<SalesInvoice[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  const users = useUsersMap();
  const pharmacyName = usePharmacyName();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [inv, its, pts, meds] = await Promise.all([
        supabase.from("sales_invoices")
          .select("id,invoice_no,total,subtotal,discount,addon,payment_type,status,patient_id,created_by,created_at")
          .gte("created_at", from)
          .lte("created_at", to + "T23:59:59")
          .order("created_at", { ascending: false }),
        supabase.from("sales_invoice_items").select("id,invoice_id,medicine_id,qty,unit_price,line_total"),
        listPatients(),
        listMedicines(),
      ]);
      setRows((inv.data ?? []) as SalesInvoice[]);
      setItems((its.data ?? []) as any[]);
      setPatients(pts);
      setMedicines(meds);
      setLoading(false);
    })();
  }, [from, to]);

  const patientName = (id: string | null) => (id ? (patients.find((p) => p.id === id)?.full_name ?? "زبون نقدي") : "زبون نقدي");
  const userName = (id: string | null) => (id ? (users[id] ?? "—") : "—");
  const medName = (id: string) => medicines.find((m) => m.id === id)?.trade_name ?? "—";
  const medCost = (id: string) => Number(medicines.find((m) => m.id === id)?.small_unit_cost ?? 0);

  if (loading) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;

  const invoiceIds = new Set(rows.map((r) => r.id));
  const scopedItems = items.filter((it) => invoiceIds.has(it.invoice_id));

  if (variant === "sales_summary") return <SalesSummaryTable rows={rows} patientName={patientName} userName={userName} pharmacyName={pharmacyName} />;
  if (variant === "sales_detail") return <SalesDetailTable rows={rows} items={scopedItems} patientName={patientName} medName={medName} />;
  if (variant === "sales_customers") return <PatientSalesTable rows={rows} patientName={patientName} />;
  if (variant === "sales_reps") return <ShiftSalesTable rows={rows} items={scopedItems} userName={userName} medCost={medCost} />;
  if (variant === "sales_unpaid") return <PatientDebtsTable rows={rows.filter((r) => r.payment_type === "credit")} patientName={patientName} userName={userName} />;
  if (variant === "sales_chart") return <SalesRangeChart rows={rows} from={from} to={to} />;
  return null;
}

function fmtDT(s: string) { return new Date(s).toLocaleString("en-GB", { hour12: false }); }

function SalesSummaryTable({ rows, patientName, userName, pharmacyName }: {
  rows: SalesInvoice[]; patientName: (id: string | null) => string; userName: (id: string | null) => string; pharmacyName: string;
}) {
  const totalAmt = rows.reduce((s, r) => s + Number(r.subtotal), 0);
  const totalDisc = rows.reduce((s, r) => s + Number(r.discount), 0);
  const totalNet = rows.reduce((s, r) => s + Number(r.total), 0);
  const uniqCustomers = new Set(rows.map((r) => r.patient_id ?? "cash")).size;
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2">رقم الفاتورة</th>
            <th className="px-3 py-2">تاريخ ووقت</th>
            <th className="px-3 py-2">اسم الزبون / المريض</th>
            <th className="px-3 py-2">نوع الدفع</th>
            <th className="px-3 py-2">الإجمالي</th>
            <th className="px-3 py-2">الخصم</th>
            <th className="px-3 py-2">صافي البيع</th>
            <th className="px-3 py-2">منظم الفاتورة</th>
            <th className="px-3 py-2">اسم الصيدلية</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 font-mono text-emerald">INV-{r.invoice_no}</td>
              <td className="px-3 py-2 text-xs font-mono">{fmtDT(r.created_at)}</td>
              <td className="px-3 py-2">{patientName(r.patient_id)}</td>
              <td className="px-3 py-2 text-xs">{r.payment_type === "cash" ? "نقدي" : "آجل"}</td>
              <td className="px-3 py-2 font-mono">{formatIQD(Number(r.subtotal))}</td>
              <td className="px-3 py-2 font-mono text-accent">{formatIQD(Number(r.discount))}</td>
              <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(Number(r.total))}</td>
              <td className="px-3 py-2 text-xs">{userName(r.created_by)}</td>
              <td className="px-3 py-2 text-xs">{pharmacyName}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد فواتير.</td></tr>
          )}
        </tbody>
        <tfoot className="bg-slate-950/80 text-xs font-bold">
          <tr>
            <td className="px-3 py-3" colSpan={3}>مجموع العملاء: <span className="text-emerald font-mono">{uniqCustomers}</span></td>
            <td className="px-3 py-3">عدد الفواتير: <span className="text-emerald font-mono">{rows.length}</span></td>
            <td className="px-3 py-3 font-mono">{formatIQD(totalAmt)}</td>
            <td className="px-3 py-3 font-mono text-accent">{formatIQD(totalDisc)}</td>
            <td className="px-3 py-3 font-mono text-emerald">{formatIQD(totalNet)}</td>
            <td className="px-3 py-3" colSpan={2}>الإجماليات</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SalesDetailTable({ rows, items, patientName, medName }: {
  rows: SalesInvoice[]; items: any[]; patientName: (id: string | null) => string; medName: (id: string) => string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2 w-8"></th>
            <th className="px-3 py-2">رقم الفاتورة</th>
            <th className="px-3 py-2">التاريخ والوقت</th>
            <th className="px-3 py-2">اسم الزبون</th>
            <th className="px-3 py-2">الخصم</th>
            <th className="px-3 py-2">المبلغ</th>
            <th className="px-3 py-2">صافي البيع</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((r) => {
            const its = items.filter((it) => it.invoice_id === r.id);
            const isOpen = open.has(r.id);
            return (
              <React.Fragment key={r.id}>
                <tr key={r.id} className="cursor-pointer hover:bg-slate-800/40" onClick={() => toggle(r.id)}>
                  <td className="px-3 py-2 text-emerald">{isOpen ? "▾" : "▸"}</td>
                  <td className="px-3 py-2 font-mono text-emerald">INV-{r.invoice_no}</td>
                  <td className="px-3 py-2 text-xs font-mono">{fmtDT(r.created_at)}</td>
                  <td className="px-3 py-2">{patientName(r.patient_id)}</td>
                  <td className="px-3 py-2 font-mono text-accent">{formatIQD(Number(r.discount))}</td>
                  <td className="px-3 py-2 font-mono">{formatIQD(Number(r.subtotal))}</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(Number(r.total))}</td>
                </tr>
                {isOpen && (
                  <tr key={r.id + "-x"} className="bg-slate-900/40">
                    <td></td>
                    <td colSpan={6} className="px-3 py-2">
                      <div className="border border-border/60 rounded-lg overflow-hidden">
                        <table className="w-full text-xs text-right">
                          <thead className="bg-slate-950/50 text-[10px] uppercase text-muted-foreground">
                            <tr>
                              <th className="px-3 py-1.5">المادة</th>
                              <th className="px-3 py-1.5">الكمية</th>
                              <th className="px-3 py-1.5">سعر الوحدة</th>
                              <th className="px-3 py-1.5">الإجمالي</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40">
                            {its.map((it) => (
                              <tr key={it.id}>
                                <td className="px-3 py-1.5">{medName(it.medicine_id)}</td>
                                <td className="px-3 py-1.5 font-mono">{it.qty}</td>
                                <td className="px-3 py-1.5 font-mono">{formatIQD(Number(it.unit_price))}</td>
                                <td className="px-3 py-1.5 font-mono text-emerald">{formatIQD(Number(it.line_total))}</td>
                              </tr>
                            ))}
                            {its.length === 0 && (
                              <tr><td colSpan={4} className="px-3 py-2 text-center text-muted-foreground">لا توجد مواد.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد فواتير.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PatientSalesTable({ rows, patientName }: { rows: SalesInvoice[]; patientName: (id: string | null) => string }) {
  const map = new Map<string, { name: string; amount: number; discount: number; net: number }>();
  for (const r of rows) {
    const key = r.patient_id ?? "cash";
    const cur = map.get(key) ?? { name: patientName(r.patient_id), amount: 0, discount: 0, net: 0 };
    cur.amount += Number(r.subtotal);
    cur.discount += Number(r.discount);
    cur.net += Number(r.total);
    map.set(key, cur);
  }
  const list = Array.from(map.values()).sort((a, b) => b.net - a.net);
  const tot = list.reduce((s, x) => ({ amount: s.amount + x.amount, discount: s.discount + x.discount, net: s.net + x.net }), { amount: 0, discount: 0, net: 0 });
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2">اسم المريض</th>
            <th className="px-3 py-2">المبلغ</th>
            <th className="px-3 py-2">الخصم</th>
            <th className="px-3 py-2">صافي البيع</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {list.map((c) => (
            <tr key={c.name}>
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2 font-mono">{formatIQD(c.amount)}</td>
              <td className="px-3 py-2 font-mono text-accent">{formatIQD(c.discount)}</td>
              <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(c.net)}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد بيانات.</td></tr>
          )}
        </tbody>
        <tfoot className="bg-slate-950/80 text-xs font-bold">
          <tr>
            <td className="px-3 py-3">الإجماليات</td>
            <td className="px-3 py-3 font-mono">{formatIQD(tot.amount)}</td>
            <td className="px-3 py-3 font-mono text-accent">{formatIQD(tot.discount)}</td>
            <td className="px-3 py-3 font-mono text-emerald">{formatIQD(tot.net)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ShiftSalesTable({ rows, items, userName, medCost }: {
  rows: SalesInvoice[]; items: any[]; userName: (id: string | null) => string; medCost: (id: string) => number;
}) {
  const [commissionPct, setCommissionPct] = useState<number>(10);
  type Agg = { name: string; net: number; profit: number };
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const key = r.created_by ?? "unknown";
    const cur = map.get(key) ?? { name: userName(r.created_by), net: 0, profit: 0 };
    const its = items.filter((it) => it.invoice_id === r.id);
    const cost = its.reduce((s, it) => s + Number(it.qty) * medCost(it.medicine_id), 0);
    cur.net += Number(r.total);
    cur.profit += Number(r.total) - cost;
    map.set(key, cur);
  }
  const list = Array.from(map.values()).sort((a, b) => b.net - a.net);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs font-bold text-muted-foreground">نسبة عمولة الصيدلي %</label>
        <input
          type="number" min={0} max={100} value={commissionPct}
          onChange={(e) => setCommissionPct(Number(e.target.value) || 0)}
          className="w-24 bg-slate-800 border border-border rounded-lg px-3 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald/40"
        />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2">اسم منظم الفاتورة</th>
              <th className="px-3 py-2">نسبته ٪</th>
              <th className="px-3 py-2">نسبته مبلغ</th>
              <th className="px-3 py-2">نسبة الربح</th>
              <th className="px-3 py-2">الربح مبلغ</th>
              <th className="px-3 py-2">صافي البيع</th>
              <th className="px-3 py-2">صافي الربح</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {list.map((a) => {
              const commissionAmt = (a.net * commissionPct) / 100;
              const profitPct = a.net > 0 ? (a.profit / a.net) * 100 : 0;
              const netProfit = a.profit - commissionAmt;
              return (
                <tr key={a.name}>
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2 font-mono">{commissionPct.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono text-accent">{formatIQD(commissionAmt)}</td>
                  <td className="px-3 py-2 font-mono">{profitPct.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{formatIQD(a.profit)}</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(a.net)}</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(netProfit)}</td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد بيانات.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PatientDebtsTable({ rows, patientName, userName }: {
  rows: SalesInvoice[]; patientName: (id: string | null) => string; userName: (id: string | null) => string;
}) {
  const totalAmt = rows.reduce((s, r) => s + Number(r.subtotal), 0);
  const totalDisc = rows.reduce((s, r) => s + Number(r.discount), 0);
  const totalNet = rows.reduce((s, r) => s + Number(r.total), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card label="مجموع الإجمالي" value={formatIQD(totalAmt)} />
        <Card label="مجموع الخصم" value={formatIQD(totalDisc)} />
        <Card label="مجموع الصافي" value={formatIQD(totalNet)} warn={totalNet > 0} />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2">رقم الفاتورة</th>
              <th className="px-3 py-2">التاريخ والوقت</th>
              <th className="px-3 py-2">نوع الدفع</th>
              <th className="px-3 py-2">الإجمالي</th>
              <th className="px-3 py-2">اسم المريض</th>
              <th className="px-3 py-2">اسم الصيدلي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-mono text-emerald">INV-{r.invoice_no}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtDT(r.created_at)}</td>
                <td className="px-3 py-2 text-xs"><span className="px-2 py-0.5 rounded bg-destructive/15 text-destructive font-bold">آجل</span></td>
                <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(Number(r.total))}</td>
                <td className="px-3 py-2">{patientName(r.patient_id)}</td>
                <td className="px-3 py-2 text-xs">{userName(r.created_by)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد ديون.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalesRangeChart({ rows, from, to }: { rows: SalesInvoice[]; from: string; to: string }) {
  const [mode, setMode] = useState<"daily" | "monthly">("daily");
  const byBucket = new Map<string, number>();
  for (const r of rows) {
    const k = mode === "daily" ? String(r.created_at).slice(0, 10) : String(r.created_at).slice(0, 7);
    byBucket.set(k, (byBucket.get(k) ?? 0) + Number(r.total));
  }
  const entries = Array.from(byBucket.entries()).sort();
  const maxK = Math.max(1, ...entries.map((e) => e[1] / 1000));
  return (
    <div className="border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          مخطط {mode === "daily" ? "يومي" : "شهري"} للمبيعات — {from} إلى {to}
        </p>
        <div className="flex gap-1 text-xs">
          <button onClick={() => setMode("daily")} className={`px-3 py-1 rounded-lg border ${mode === "daily" ? "bg-emerald text-primary-foreground border-emerald" : "bg-slate-800/60 border-border"}`}>يومي</button>
          <button onClick={() => setMode("monthly")} className={`px-3 py-1 rounded-lg border ${mode === "monthly" ? "bg-emerald text-primary-foreground border-emerald" : "bg-slate-800/60 border-border"}`}>شهري</button>
        </div>
      </div>
      <div className="flex gap-4">
        <div className="flex flex-col justify-between text-[9px] font-mono text-muted-foreground py-1" style={{ height: 220 }}>
          <span>{Math.round(maxK)} ألف</span>
          <span>{Math.round(maxK * 0.75)}</span>
          <span>{Math.round(maxK * 0.5)}</span>
          <span>{Math.round(maxK * 0.25)}</span>
          <span>0</span>
        </div>
        <div className="flex-1 flex items-end gap-1 border-b border-l border-border pr-1" style={{ height: 220 }}>
          {entries.map(([k, v]) => (
            <div key={k} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="text-[8px] font-mono text-emerald opacity-0 group-hover:opacity-100">{Math.round(v / 1000)}</div>
              <div
                className="w-full bg-emerald/60 hover:bg-emerald rounded-t transition-all"
                style={{ height: `${(v / 1000 / maxK) * 100}%` }}
                title={`${k}: ${formatIQD(v)}`}
              />
              <span className="text-[8px] font-mono text-muted-foreground whitespace-nowrap">{mode === "daily" ? k.slice(5) : k}</span>
            </div>
          ))}
          {entries.length === 0 && <p className="text-xs text-muted-foreground m-auto">لا توجد بيانات.</p>}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">المحور الأفقي: اليوم — المحور العمودي: المبلغ بآلاف الدنانير العراقية</p>
    </div>
  );
}

// ---- Purchases ---------------------------------------------------------
type PurInvRow = {
  id: string;
  invoice_no: number;
  supplier_id: string | null;
  total: number;
  notes: string | null;
  created_at: string;
};
type PurItemRow = {
  id: string;
  invoice_id: string;
  medicine_id: string;
  qty: number;
  unit_cost: number;
  line_total: number;
};

function usePurchasesData(from: string, to: string) {
  const [invoices, setInvoices] = useState<PurInvRow[]>([]);
  const [items, setItems] = useState<PurItemRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [inv, sup, m] = await Promise.all([
        supabase.from("purchase_invoices")
          .select("id,invoice_no,supplier_id,total,notes,created_at")
          .gte("created_at", from).lte("created_at", to + "T23:59:59")
          .order("created_at", { ascending: false }),
        supabase.from("suppliers").select("id,name").order("name"),
        listMedicines(),
      ]);
      const invs = (inv.data ?? []) as PurInvRow[];
      setInvoices(invs);
      setSuppliers((sup.data ?? []) as any);
      setMeds(m);
      if (invs.length) {
        const { data: its } = await supabase.from("purchase_invoice_items")
          .select("id,invoice_id,medicine_id,qty,unit_cost,line_total")
          .in("invoice_id", invs.map(i => i.id));
        setItems((its ?? []) as PurItemRow[]);
      } else setItems([]);
      setLoading(false);
    })();
  }, [from, to]);
  return { invoices, items, suppliers, meds, loading };
}

function PurchasesReport({ variant, from, to }: { variant: string; from: string; to: string }) {
  const { invoices, items, suppliers, meds, loading } = usePurchasesData(from, to);
  if (loading) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;
  const supMap = new Map(suppliers.map(s => [s.id, s.name]));
  const medMap = new Map(meds.map(m => [m.id, m]));

  if (variant === "pur_invoices") return <PurInvoicesReport invoices={invoices} items={items} supMap={supMap} medMap={medMap} />;
  if (variant === "pur_products") return <PurProductsReport items={items} medMap={medMap} />;
  if (variant === "pur_items_detail") return <PurItemsDetail invoices={invoices} items={items} supMap={supMap} medMap={medMap} />;
  if (variant === "pur_returns") return <PurReturnsDetail from={from} to={to} suppliers={suppliers} medMap={medMap} invoices={invoices} />;
  return null;
}

function PurInvoicesReport({ invoices, items, supMap, medMap }: {
  invoices: PurInvRow[]; items: PurItemRow[]; supMap: Map<string, string>; medMap: Map<string, Medicine>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const total = invoices.reduce((s, r) => s + Number(r.total), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card label="عدد الفواتير" value={invoices.length.toLocaleString()} />
        <Card label="عدد الموردين" value={new Set(invoices.map(i => i.supplier_id).filter(Boolean)).size.toLocaleString()} />
        <Card label="إجمالي المشتريات" value={formatIQD(total)} accent />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2">رقم الفاتورة</th>
              <th className="px-3 py-2">رقم فاتورة الشراء</th>
              <th className="px-3 py-2">تاريخها</th>
              <th className="px-3 py-2">اسم المورد</th>
              <th className="px-3 py-2">المجموع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {invoices.map((r) => {
              const rows = items.filter(it => it.invoice_id === r.id);
              const isOpen = open.has(r.id);
              return (
                <React.Fragment key={r.id}>
                  <tr className="hover:bg-slate-800/40 cursor-pointer" onClick={() => toggle(r.id)}>
                    <td className="px-3 py-2 text-emerald">{isOpen ? "▾" : "▸"}</td>
                    <td className="px-3 py-2 font-mono text-emerald">PO-{r.invoice_no}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.notes || "—"}</td>
                    <td className="px-3 py-2 text-xs font-mono">{new Date(r.created_at).toLocaleDateString("en-GB")}</td>
                    <td className="px-3 py-2">{supMap.get(r.supplier_id || "") || "—"}</td>
                    <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(Number(r.total))}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-900/40">
                      <td colSpan={6} className="px-4 py-3">
                        <table className="w-full text-xs text-right">
                          <thead className="text-[10px] uppercase text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1">اسم المنتج</th>
                              <th className="px-2 py-1">العدد</th>
                              <th className="px-2 py-1">الوحدة</th>
                              <th className="px-2 py-1">الكلفة</th>
                              <th className="px-2 py-1">الإجمالي</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {rows.map(it => {
                              const m = medMap.get(it.medicine_id);
                              return (
                                <tr key={it.id}>
                                  <td className="px-2 py-1">{m?.trade_name || "—"}</td>
                                  <td className="px-2 py-1 font-mono">{it.qty}</td>
                                  <td className="px-2 py-1 text-muted-foreground">{m?.small_unit_name || "قطعة"}</td>
                                  <td className="px-2 py-1 font-mono">{formatIQD(Number(it.unit_cost))}</td>
                                  <td className="px-2 py-1 font-mono text-emerald">{formatIQD(Number(it.line_total))}</td>
                                </tr>
                              );
                            })}
                            {rows.length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-center text-muted-foreground">لا توجد مواد.</td></tr>}
                          </tbody>
                          <tfoot>
                            <tr className="font-bold text-emerald">
                              <td colSpan={4} className="px-2 py-1 text-left">المجموع</td>
                              <td className="px-2 py-1 font-mono">{formatIQD(Number(r.total))}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {invoices.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد فواتير.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PurProductsReport({ items, medMap }: { items: PurItemRow[]; medMap: Map<string, Medicine> }) {
  const agg = useMemo(() => {
    const map = new Map<string, { qty: number; total: number; costSum: number; costCount: number }>();
    for (const it of items) {
      const e = map.get(it.medicine_id) ?? { qty: 0, total: 0, costSum: 0, costCount: 0 };
      e.qty += Number(it.qty); e.total += Number(it.line_total);
      e.costSum += Number(it.unit_cost); e.costCount += 1;
      map.set(it.medicine_id, e);
    }
    return Array.from(map.entries()).map(([mid, v]) => ({
      med: medMap.get(mid), qty: v.qty, total: v.total, avgCost: v.costCount ? v.costSum / v.costCount : 0,
    })).sort((a, b) => b.total - a.total);
  }, [items, medMap]);
  const grand = agg.reduce((s, r) => s + r.total, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card label="عدد المنتجات" value={agg.length.toLocaleString()} />
        <Card label="إجمالي القطع" value={agg.reduce((s, r) => s + r.qty, 0).toLocaleString()} />
        <Card label="إجمالي الكلفة" value={formatIQD(grand)} accent />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2">اسم المنتج</th>
              <th className="px-3 py-2">عدده</th>
              <th className="px-3 py-2">وحدته</th>
              <th className="px-3 py-2">كلفته</th>
              <th className="px-3 py-2">اجمالي الكلفة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {agg.map((r, i) => (
              <tr key={i} className="hover:bg-slate-800/40">
                <td className="px-3 py-2">{r.med?.trade_name || "—"}</td>
                <td className="px-3 py-2 font-mono">{r.qty.toLocaleString()}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.med?.small_unit_name || "قطعة"}</td>
                <td className="px-3 py-2 font-mono">{formatIQD(r.avgCost)}</td>
                <td className="px-3 py-2 font-mono font-bold text-emerald">{formatIQD(r.total)}</td>
              </tr>
            ))}
            {agg.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد مشتريات.</td></tr>}
          </tbody>
          <tfoot className="bg-slate-950/40 font-bold">
            <tr>
              <td className="px-3 py-2" colSpan={4}>المجموع</td>
              <td className="px-3 py-2 font-mono text-emerald">{formatIQD(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PurItemsDetail({ invoices, items, supMap, medMap }: {
  invoices: PurInvRow[]; items: PurItemRow[]; supMap: Map<string, string>; medMap: Map<string, Medicine>;
}) {
  const invMap = new Map(invoices.map(i => [i.id, i]));
  const rows = items
    .map(it => ({ it, inv: invMap.get(it.invoice_id) }))
    .filter(r => r.inv)
    .sort((a, b) => new Date(b.inv!.created_at).getTime() - new Date(a.inv!.created_at).getTime());
  const total = rows.reduce((s, r) => s + Number(r.it.line_total), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card label="عدد الحركات" value={rows.length.toLocaleString()} />
        <Card label="إجمالي القطع" value={rows.reduce((s, r) => s + Number(r.it.qty), 0).toLocaleString()} />
        <Card label="إجمالي الكلفة" value={formatIQD(total)} accent />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2">وقت و تاريخ</th>
              <th className="px-3 py-2">اسم المنتج</th>
              <th className="px-3 py-2">عدده</th>
              <th className="px-3 py-2">وحدته</th>
              <th className="px-3 py-2">كلفته</th>
              <th className="px-3 py-2">اسم المورد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((r, i) => {
              const m = medMap.get(r.it.medicine_id);
              return (
                <tr key={i} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-xs font-mono">{new Date(r.inv!.created_at).toLocaleString("en-GB", { hour12: false })}</td>
                  <td className="px-3 py-2">{m?.trade_name || "—"}</td>
                  <td className="px-3 py-2 font-mono">{r.it.qty}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m?.small_unit_name || "قطعة"}</td>
                  <td className="px-3 py-2 font-mono text-emerald">{formatIQD(Number(r.it.line_total))}</td>
                  <td className="px-3 py-2">{supMap.get(r.inv!.supplier_id || "") || "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد حركات.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PurReturnsDetail({ from, to, suppliers, medMap, invoices }: {
  from: string; to: string;
  suppliers: { id: string; name: string }[];
  medMap: Map<string, Medicine>;
  invoices: PurInvRow[];
}) {
  const [supFilter, setSupFilter] = useState<string>("all");
  const [moves, setMoves] = useState<Array<{ id: string; medicine_id: string; delta: number; ref_id: string | null; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("stock_movements")
        .select("id,medicine_id,delta,ref_id,created_at")
        .eq("reason", "purchase_reverted")
        .gte("created_at", from).lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false });
      setMoves((data ?? []) as any);
      setLoading(false);
    })();
  }, [from, to]);

  const invMap = new Map(invoices.map(i => [i.id, i]));
  // Group by ref_id (invoice)
  const grouped = useMemo(() => {
    const map = new Map<string, typeof moves>();
    for (const mv of moves) {
      const inv = mv.ref_id ? invMap.get(mv.ref_id) : null;
      if (supFilter !== "all" && inv?.supplier_id !== supFilter) continue;
      const key = mv.ref_id || mv.id;
      const arr = map.get(key) ?? [];
      arr.push(mv);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [moves, invMap, supFilter]);

  // Grand total per supplier
  const perSupplier = useMemo(() => {
    const map = new Map<string, number>();
    for (const [refId, mvs] of grouped) {
      const inv = invMap.get(refId);
      const sid = inv?.supplier_id || "unknown";
      const sum = mvs.reduce((s, mv) => {
        const med = medMap.get(mv.medicine_id);
        const cost = Number(med?.small_unit_cost || med?.purchase_price || 0);
        return s + Math.abs(mv.delta) * cost;
      }, 0);
      map.set(sid, (map.get(sid) ?? 0) + sum);
    }
    return map;
  }, [grouped, invMap, medMap]);

  const supName = (id: string | null) => id ? (suppliers.find(s => s.id === id)?.name || "—") : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-[10px] font-bold text-muted-foreground mb-1">حسب اسم المورد</label>
          <select value={supFilter} onChange={e => setSupFilter(e.target.value)}
            className="bg-slate-800 border border-border rounded px-3 py-2 text-sm min-w-56">
            <option value="all">كل الموردين</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="text-[10px] text-muted-foreground">فرز حسب التاريخ يتحكم به الشريط العلوي للتقارير.</div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
      {!loading && grouped.length === 0 && <Placeholder label="لا توجد مرتجعات مشتريات في هذا النطاق." />}

      <div className="space-y-4">
        {grouped.map(([refId, mvs]) => {
          const inv = invMap.get(refId);
          const panelSum = mvs.reduce((s, mv) => {
            const med = medMap.get(mv.medicine_id);
            const cost = Number(med?.small_unit_cost || med?.purchase_price || 0);
            return s + Math.abs(mv.delta) * cost;
          }, 0);
          return (
            <div key={refId} className="border-2 border-border rounded-xl overflow-hidden bg-slate-950/30">
              <div className="grid grid-cols-4 gap-2 px-4 py-3 bg-slate-900/60 border-b border-border text-xs">
                <div><span className="text-muted-foreground">رقم فاتورة النظام: </span><span className="font-mono text-emerald font-bold">RET-{inv?.invoice_no ?? refId.slice(0, 6)}</span></div>
                <div><span className="text-muted-foreground">اسم المورد: </span><span className="font-medium">{supName(inv?.supplier_id ?? null)}</span></div>
                <div><span className="text-muted-foreground">رقم الفاتورة: </span><span className="font-mono">{inv?.notes || "—"}</span></div>
                <div><span className="text-muted-foreground">تاريخ الفاتورة: </span><span className="font-mono">{inv ? new Date(inv.created_at).toLocaleDateString("en-GB") : "—"}</span></div>
              </div>
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 w-10">ت</th>
                    <th className="px-3 py-2">اسم المنتج</th>
                    <th className="px-3 py-2">الوحدة</th>
                    <th className="px-3 py-2">التعبئة</th>
                    <th className="px-3 py-2">عدد الراجع</th>
                    <th className="px-3 py-2">سعر الشراء</th>
                    <th className="px-3 py-2">اجمالي الراجع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {mvs.map((mv, i) => {
                    const med = medMap.get(mv.medicine_id);
                    const qty = Math.abs(mv.delta);
                    const cost = Number(med?.small_unit_cost || med?.purchase_price || 0);
                    return (
                      <tr key={mv.id} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2 font-mono text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">{med?.trade_name || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{med?.small_unit_name || "قطعة"}</td>
                        <td className="px-3 py-2 font-mono">{med?.units_per_large || 1}</td>
                        <td className="px-3 py-2 font-mono">{qty}</td>
                        <td className="px-3 py-2 font-mono">{formatIQD(cost)}</td>
                        <td className="px-3 py-2 font-mono text-emerald font-bold">{formatIQD(qty * cost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2 bg-slate-900/40 border-t border-border text-right">
                <span className="text-sm font-bold text-destructive">اجمالي الراجع : {formatIQD(panelSum)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && grouped.length > 0 && (
        <div className="border-2 border-emerald/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-emerald/10 text-[10px] font-bold uppercase tracking-widest text-emerald">
            مجموع اجمالي الراجع لكل مورد
          </div>
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/60 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">المورد</th>
                <th className="px-3 py-2">اجمالي الراجع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {Array.from(perSupplier.entries()).sort((a, b) => b[1] - a[1]).map(([sid, sum]) => (
                <tr key={sid}>
                  <td className="px-3 py-2 font-medium">{supName(sid === "unknown" ? null : sid)}</td>
                  <td className="px-3 py-2 font-mono font-bold text-destructive">{formatIQD(sum)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-950/40 font-bold">
              <tr>
                <td className="px-3 py-2">المجموع الكلي</td>
                <td className="px-3 py-2 font-mono text-emerald">{formatIQD(Array.from(perSupplier.values()).reduce((a, b) => a + b, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Items -------------------------------------------------------------
function ItemsReport({ variant, from, to }: { variant: string; from: string; to: string }) {
  const [items, setItems] = useState<Medicine[]>([]);
  const [consumption, setConsumption] = useState<Record<string, number>>({});
  const [rangeDays, setRangeDays] = useState<number>(30);

  useEffect(() => {
    (async () => {
      const meds = await listMedicines();
      setItems(meds);
    })();
  }, []);

  // Consumption within selected date range (from sales_invoice_items joined to sales_invoices)
  useEffect(() => {
    (async () => {
      const fromISO = new Date(from).toISOString();
      const toISO = new Date(to + "T23:59:59").toISOString();
      const days = Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
      setRangeDays(days);
      const { data } = await supabase
        .from("sales_invoice_items")
        .select("qty,medicine_id,sales_invoices!inner(created_at)")
        .gte("sales_invoices.created_at", fromISO)
        .lte("sales_invoices.created_at", toISO);
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) {
        map[r.medicine_id] = (map[r.medicine_id] ?? 0) + Number(r.qty || 0);
      }
      setConsumption(map);
    })();
  }, [from, to]);

  if (variant === "items_movement") return <MovementReport items={items} from={from} to={to} />;
  if (variant === "items_hazard") return <HazardousReport items={items} consumption={consumption} rangeDays={rangeDays} />;
  if (variant === "items_all") return <GeneralInventoryReport items={items} consumption={consumption} rangeDays={rangeDays} />;
  if (variant === "items_dead") return <DeadStockReport items={items} consumption={consumption} />;
  if (variant === "items_negative") return <NegativeStockReport items={items} />;
  if (variant === "items_expire") return <ExpiringItemsReport items={items} />;
  if (variant === "items_reorder") return <ReorderReport items={items} />;
  return null;
}

// Risk projection helper: how many pieces will still be on the shelf at expiry.
// projectedUnsold = balance - (monthlyRate * monthsRemaining).
function projectRisk(m: Medicine, monthlyRate: number) {
  if (!m.expiry_date) return { level: "unknown" as const, projected: 0, monthsLeft: 0 };
  const now = new Date();
  const monthsLeft = Math.max(0, (new Date(m.expiry_date).getTime() - now.getTime()) / (30 * 86400000));
  const projected = Math.max(0, Math.floor(m.quantity_in_stock - monthlyRate * monthsLeft));
  const level = projected > 2 ? "high" : projected >= 1 ? "medium" : "safe";
  return { level, projected, monthsLeft };
}

function RiskBadge({ level }: { level: "high" | "medium" | "safe" | "unknown" }) {
  const map = {
    high: { text: "خطر", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
    medium: { text: "متوسط", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
    safe: { text: "آمن", cls: "bg-emerald/15 text-emerald border-emerald/40" },
    unknown: { text: "—", cls: "bg-slate-800 text-muted-foreground border-border" },
  }[level];
  return <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${map.cls}`}>{map.text}</span>;
}

function GeneralInventoryReport({ items, consumption, rangeDays }: {
  items: Medicine[]; consumption: Record<string, number>; rangeDays: number;
}) {
  const rows = useMemo(() => {
    return items.map((m) => {
      const rate30 = ((consumption[m.id] ?? 0) / Math.max(1, rangeDays)) * 30;
      const risk = projectRisk(m, rate30);
      return { m, risk };
    });
  }, [items, consumption, rangeDays]);

  const tone = (lvl: string) =>
    lvl === "high" ? "bg-rose-500/5" :
    lvl === "medium" ? "bg-amber-500/5" :
    lvl === "safe" ? "bg-emerald/5" : "";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center justify-between">
        <span>جرد عام — مع تصنيف درجة الخطورة الديناميكي</span>
        <span className="text-[10px] font-mono">إجمالي المواد: {items.length}</span>
      </div>
      <div className="max-h-[62vh] overflow-auto">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
            <tr>
              <th className="px-3 py-2">اسم الدواء</th>
              <th className="px-3 py-2">الاسم العلمي</th>
              <th className="px-3 py-2">رصيده</th>
              <th className="px-3 py-2">حده الأعلى</th>
              <th className="px-3 py-2">حده الأدنى</th>
              <th className="px-3 py-2">اكسبايره</th>
              <th className="px-3 py-2">موقعه</th>
              <th className="px-3 py-2">درجة خطورته</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map(({ m, risk }) => (
              <tr key={m.id} className={tone(risk.level)}>
                <td className="px-3 py-1.5 font-medium">{m.trade_name}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground font-mono">{m.scientific_name}</td>
                <td className="px-3 py-1.5 font-mono text-emerald">{m.quantity_in_stock}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.maximum_stock}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.minimum_stock}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-amber-300">{m.expiry_date ?? "—"}</td>
                <td className="px-3 py-1.5 text-xs">{m.location ?? "—"}</td>
                <td className="px-3 py-1.5"><RiskBadge level={risk.level as any} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-xs">لا توجد مواد.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeadStockReport({ items, consumption }: { items: Medicine[]; consumption: Record<string, number> }) {
  const rows = items.filter((m) => (consumption[m.id] ?? 0) === 0);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        المواد الراكدة — معدل الصرف = صفر خلال الفترة المحددة
      </div>
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
          <tr>
            <th className="px-3 py-2">اسم المادة</th>
            <th className="px-3 py-2">حدها الأدنى</th>
            <th className="px-3 py-2">حدها الأعلى</th>
            <th className="px-3 py-2">رصيدها</th>
            <th className="px-3 py-2">معدل الصرف</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((m) => (
            <tr key={m.id} className="hover:bg-slate-800/40">
              <td className="px-3 py-1.5 font-medium">{m.trade_name}</td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.minimum_stock}</td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.maximum_stock}</td>
              <td className="px-3 py-1.5 font-mono text-emerald">{m.quantity_in_stock}</td>
              <td className="px-3 py-1.5 font-mono text-rose-400 font-bold">0</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">لا توجد مواد راكدة — كل المواد لها حركة بيع خلال هذه الفترة.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function NegativeStockReport({ items }: { items: Medicine[] }) {
  const rows = items.filter((m) => m.quantity_in_stock < 0);
  return (
    <div className="border border-rose-500/40 rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-rose-500/10 text-[10px] font-bold uppercase tracking-widest text-rose-300">
        الكميات السالبة — تنبيه لأخطاء الجرد
      </div>
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
          <tr>
            <th className="px-3 py-2">اسم المادة</th>
            <th className="px-3 py-2">رصيدها (سالب)</th>
            <th className="px-3 py-2">حدها الأعلى</th>
            <th className="px-3 py-2">حدها الأدنى</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((m) => (
            <tr key={m.id} className="bg-rose-500/5">
              <td className="px-3 py-1.5 font-medium">{m.trade_name}</td>
              <td className="px-3 py-1.5 font-mono text-rose-400 font-bold">{m.quantity_in_stock}</td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.maximum_stock}</td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.minimum_stock}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-emerald text-xs">لا توجد كميات سالبة ✔</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ExpiringItemsReport({ items }: { items: Medicine[] }) {
  const [history, setHistory] = useState<Record<string, { purchases: any[]; sales: any[] }>>({});
  const today = new Date();
  const rows = useMemo(() =>
    items
      .filter((m) => {
        if (!m.expiry_date) return false;
        const days = (new Date(m.expiry_date).getTime() - today.getTime()) / 86400000;
        return days < 180;
      })
      .sort((a, b) => (a.expiry_date! < b.expiry_date! ? -1 : 1)),
  [items]);

  useEffect(() => {
    (async () => {
      const ids = rows.map((r) => r.id);
      if (!ids.length) return;
      const [purQ, salQ] = await Promise.all([
        supabase.from("purchase_invoice_items")
          .select("medicine_id,qty,purchase_invoices!inner(created_at)")
          .in("medicine_id", ids)
          .order("created_at", { referencedTable: "purchase_invoices", ascending: false }),
        supabase.from("sales_invoice_items")
          .select("medicine_id,qty,sales_invoices!inner(created_at)")
          .in("medicine_id", ids)
          .order("created_at", { referencedTable: "sales_invoices", ascending: false }),
      ]);
      const map: Record<string, { purchases: any[]; sales: any[] }> = {};
      for (const id of ids) map[id] = { purchases: [], sales: [] };
      for (const r of (purQ.data ?? []) as any[]) {
        if (map[r.medicine_id].purchases.length < 3)
          map[r.medicine_id].purchases.push({ qty: r.qty, date: String(r.purchase_invoices.created_at).slice(0, 10) });
      }
      for (const r of (salQ.data ?? []) as any[]) {
        if (map[r.medicine_id].sales.length < 3)
          map[r.medicine_id].sales.push({ qty: r.qty, date: String(r.sales_invoices.created_at).slice(0, 10) });
      }
      setHistory(map);
    })();
  }, [rows.length]);

  return (
    <div className="border border-amber-500/40 rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-amber-500/10 text-[10px] font-bold uppercase tracking-widest text-amber-300">
        منتجات اكسباير — سجل تدقيق مع آخر ٣ عمليات شراء وبيع
      </div>
      <div className="max-h-[62vh] overflow-auto divide-y divide-border/60">
        {rows.map((m) => {
          const h = history[m.id];
          return (
            <div key={m.id} className="p-3 hover:bg-slate-800/30">
              <div className="flex items-center gap-4 mb-2">
                <span className="font-bold text-foreground flex-1">{m.trade_name}</span>
                <span className="text-xs text-muted-foreground">عددها:</span>
                <span className="font-mono text-emerald font-bold">{m.quantity_in_stock}</span>
                <span className="text-xs text-muted-foreground">اكسبايرها:</span>
                <span className="font-mono text-amber-300 text-xs">{m.expiry_date}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniHistoryTable title="آخر ٣ عمليات شراء" rows={h?.purchases ?? []} tone="sky" />
                <MiniHistoryTable title="آخر ٣ عمليات بيع" rows={h?.sales ?? []} tone="emerald" />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-muted-foreground text-xs">لا توجد منتجات قريبة الانتهاء.</div>
        )}
      </div>
    </div>
  );
}

function MiniHistoryTable({ title, rows, tone }: { title: string; rows: { qty: number; date: string }[]; tone: "sky" | "emerald" }) {
  const toneCls = tone === "sky" ? "text-sky-300 border-sky-500/30" : "text-emerald border-emerald/30";
  return (
    <div className={`border rounded-lg ${toneCls} bg-slate-950/40`}>
      <div className={`px-2 py-1 text-[10px] font-bold ${toneCls}`}>{title}</div>
      <table className="w-full text-xs text-right">
        <tbody className="divide-y divide-border/50">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-2 py-1 font-mono">{r.date}</td>
              <td className="px-2 py-1 font-mono font-bold">{r.qty}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="px-2 py-2 text-center text-muted-foreground text-[10px]">—</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReorderReport({ items }: { items: Medicine[] }) {
  const rows = items.filter((m) => m.quantity_in_stock < m.minimum_stock);
  const handleAdd = (m: Medicine) => {
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
  };
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        حد الطلب — المواد تحت الحد الأدنى
      </div>
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
          <tr>
            <th className="px-3 py-2">اسم المادة</th>
            <th className="px-3 py-2">رصيدها في المخزن</th>
            <th className="px-3 py-2">حدها الأعلى</th>
            <th className="px-3 py-2">إجراء</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((m) => (
            <tr key={m.id} className="hover:bg-slate-800/40">
              <td className="px-3 py-1.5 font-medium">{m.trade_name}</td>
              <td className="px-3 py-1.5 font-mono text-rose-400 font-bold">{m.quantity_in_stock}</td>
              <td className="px-3 py-1.5 font-mono text-emerald">{m.maximum_stock}</td>
              <td className="px-3 py-1.5">
                <button
                  onClick={() => handleAdd(m)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald/15 text-emerald border border-emerald/40 text-[11px] font-bold hover:bg-emerald/25"
                >
                  <ShoppingCart className="w-3 h-3" /> إضافة للسلة
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-emerald text-xs">جميع المواد فوق الحد الأدنى ✔</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HazardousReport({ items, consumption, rangeDays }: {
  items: Medicine[]; consumption: Record<string, number>; rangeDays: number;
}) {
  const rows = useMemo(() => {
    const today = new Date();
    return items
      .map((m) => {
        if (!m.expiry_date) return null;
        const daysLeft = (new Date(m.expiry_date).getTime() - today.getTime()) / 86400000;
        const rate30 = ((consumption[m.id] ?? 0) / Math.max(1, rangeDays)) * 30;
        const risk = projectRisk(m, rate30);
        const cost = Number(m.small_unit_cost || m.purchase_price || 0);
        const projectedLoss = risk.projected * cost;
        return { m, daysLeft, rate30, risk, projectedLoss };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.risk.level !== "safe" && x.risk.level !== "unknown")
      .sort((a, b) => b.projectedLoss - a.projectedLoss);
  }, [items, consumption, rangeDays]);

  const totalLoss = rows.reduce((s, r) => s + r.projectedLoss, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card label="عدد المواد الخطرة" value={rows.length.toLocaleString()} warn={rows.length > 0} />
        <Card label="الخسارة المتوقعة" value={formatIQD(totalLoss)} warn={totalLoss > 0} />
        <Card label="الفترة المرجعية للصرف" value={`${rangeDays} يوم`} />
      </div>
      <div className="border border-rose-500/40 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-rose-500/10 text-[10px] font-bold uppercase tracking-widest text-rose-300">
          مواد خطرة — تنبؤ الخسائر بناءً على الاكسبايره ومعدل البيع
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2">اسم المادة</th>
                <th className="px-3 py-2">رصيدها</th>
                <th className="px-3 py-2">حدها الأعلى</th>
                <th className="px-3 py-2">حدها الأدنى</th>
                <th className="px-3 py-2">اكسبايرها</th>
                <th className="px-3 py-2">أيام متبقية</th>
                <th className="px-3 py-2">معدل الصرف/شهر</th>
                <th className="px-3 py-2">قطع ستنتهي</th>
                <th className="px-3 py-2">الخسارة المتوقعة</th>
                <th className="px-3 py-2">درجة الخطورة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map(({ m, daysLeft, rate30, risk, projectedLoss }) => (
                <tr key={m.id} className={risk.level === "high" ? "bg-rose-500/5" : "bg-amber-500/5"}>
                  <td className="px-3 py-1.5 font-medium">{m.trade_name}</td>
                  <td className="px-3 py-1.5 font-mono text-emerald">{m.quantity_in_stock}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.maximum_stock}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{m.minimum_stock}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-amber-300">{m.expiry_date}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{Math.round(daysLeft)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{rate30.toFixed(1)}</td>
                  <td className="px-3 py-1.5 font-mono font-bold text-rose-400">{risk.projected}</td>
                  <td className="px-3 py-1.5 font-mono text-rose-300">{formatIQD(projectedLoss)}</td>
                  <td className="px-3 py-1.5"><RiskBadge level={risk.level as any} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-emerald text-xs">لا توجد مواد خطرة — المخزون آمن ✔</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MovementReport({ items, from, to }: { items: Medicine[]; from: string; to: string }) {
  const [medId, setMedId] = useState<string>("all");
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("stock_movements")
        .select("id,medicine_id,delta,reason,ref_id,created_at")
        .gte("created_at", from)
        .lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false })
        .limit(500);
      if (medId !== "all") q = q.eq("medicine_id", medId);
      const { data } = await q;
      setRows((data ?? []) as any);
    })();
  }, [medId, from, to]);

  const medMap = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);

  const movementType = (reason: string) => {
    if (reason === "sale") return "بيع";
    if (reason === "purchase") return "شراء";
    if (reason === "purchase_reverted" || reason === "sale_reverted") return "مرتجع";
    return "تعديل مخزني";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-[10px] font-bold text-muted-foreground mb-1">فلترة حسب اسم المادة</label>
          <select
            value={medId}
            onChange={(e) => setMedId(e.target.value)}
            className="bg-slate-800 border border-border rounded px-3 py-2 text-sm min-w-64"
          >
            <option value="all">كل المواد</option>
            {items.map((m) => <option key={m.id} value={m.id}>{m.trade_name}</option>)}
          </select>
        </div>
        <div className="text-[10px] text-muted-foreground">التاريخ يتحكم به الشريط العلوي.</div>
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">اسم المادة</th>
                <th className="px-3 py-2">نوع الحركة</th>
                <th className="px-3 py-2">الجهة / المرجع</th>
                <th className="px-3 py-2">التغير في الرصيد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((r) => {
                const med = medMap.get(r.medicine_id);
                const delta = Number(r.delta);
                const increase = delta >= 0;
                return (
                  <tr key={r.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-1.5 text-xs font-mono">{String(r.created_at).slice(0, 10)}</td>
                    <td className="px-3 py-1.5 font-medium">{med?.trade_name ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs">{movementType(r.reason)}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground font-mono">{r.ref_id ? String(r.ref_id).slice(0, 8) : "—"}</td>
                    <td className={`px-3 py-1.5 font-mono font-bold ${increase ? "text-emerald" : "text-rose-400"}`}>
                      {increase ? "▲ زيادة" : "▼ نقص"} {Math.abs(delta)}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">لا توجد حركات ضمن الفترة المحددة.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Accounts ----------------------------------------------------------
function AccountsReport({ variant, from, to }: { variant: string; from: string; to: string }) {
  if (variant === "acc_statement") return <AccountStatementLedger from={from} to={to} />;
  if (variant === "acc_cashbox") return <DailyCashboxReport from={from} to={to} />;
  if (variant === "acc_fund_movements") return <FundMovementsLedger from={from} to={to} />;
  if (variant === "acc_reconcile") return <DailyReconciliationReport from={from} to={to} />;
  if (variant === "acc_debts") return <DebtsReport from={from} to={to} />;
  if (variant === "acc_expenses") return <ExpensesReport from={from} to={to} />;
  return <Placeholder label="اختر تقريراً." />;
}

// ---- حركة الصناديق (Cash Fund Movements) --------------------------------
function FundMovementsLedger({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<Array<{
    reference: string; date: string; opType: string;
    fromName: string; toName: string; amount: number;
    fromBalAfter: number; toBalAfter: number;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ data: accs }, { data: txs }] = await Promise.all([
          supabase.from("accounts").select("id,name,opening_balance"),
          supabase.from("account_transactions")
            .select("id,account_id,entry_type,iqd_equivalent,entry_date,reference,description,created_at")
            .order("entry_date", { ascending: true })
            .order("created_at", { ascending: true }),
        ]);
        const accMap = new Map<string, { name: string }>();
        const balMap = new Map<string, number>();
        for (const a of (accs ?? []) as any[]) {
          accMap.set(a.id, { name: a.name });
          balMap.set(a.id, Number(a.opening_balance || 0));
        }
        // Group by reference; keep running balances per account
        const grouped = new Map<string, any[]>();
        for (const t of (txs ?? []) as any[]) {
          const d = t.entry_type === "receipt" ? Number(t.iqd_equivalent || 0) : -Number(t.iqd_equivalent || 0);
          balMap.set(t.account_id, (balMap.get(t.account_id) || 0) + d);
          const isTransfer = (t.description ?? "").includes("[transfer]") || (t.description ?? "").includes("تحويل");
          if (!isTransfer || !t.reference) continue;
          if (t.entry_date < from || t.entry_date > to) continue;
          const key = String(t.reference);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push({ ...t, _fromBal: balMap.get(t.account_id) });
        }
        const out: typeof rows = [];
        for (const [ref, pair] of grouped.entries()) {
          const src = pair.find((p) => p.entry_type === "payment");
          const dst = pair.find((p) => p.entry_type === "receipt");
          if (!src || !dst) continue;
          out.push({
            reference: ref,
            date: src.entry_date,
            opType: "تحويل بين الصناديق",
            fromName: accMap.get(src.account_id)?.name ?? "—",
            toName: accMap.get(dst.account_id)?.name ?? "—",
            amount: Number(src.iqd_equivalent || 0),
            fromBalAfter: src._fromBal ?? 0,
            toBalAfter: dst._fromBal ?? 0,
          });
        }
        setRows(out.reverse());
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to]);

  const totalTransferred = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="p-3 rounded-xl border-2 border-sky-500/40 bg-sky-50">
          <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">إجمالي التحويلات</p>
          <p className="text-lg font-mono font-black text-slate-950 mt-1">{formatIQD(totalTransferred)}</p>
        </div>
        <div className="p-3 rounded-xl border-2 border-emerald/40 bg-emerald/5">
          <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">عدد الحركات</p>
          <p className="text-lg font-mono font-black text-slate-950 mt-1">{rows.length}</p>
        </div>
        <div className="p-3 rounded-xl border-2 border-amber-500/40 bg-amber-50">
          <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">الفترة</p>
          <p className="text-xs font-mono font-bold text-slate-900 mt-1">{from} → {to}</p>
        </div>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-white">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-800 sticky top-0">
              <tr>
                <th className="px-3 py-2">التاريخ والوقت</th>
                <th className="px-3 py-2">نوع الحركة</th>
                <th className="px-3 py-2">من صندوق</th>
                <th className="px-3 py-2">رصيد المصدر (بعد)</th>
                <th className="px-3 py-2">إلى صندوق</th>
                <th className="px-3 py-2">رصيد الوجهة (بعد)</th>
                <th className="px-3 py-2">المبلغ المحوّل</th>
                <th className="px-3 py-2">رقم الوصل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">جاري التحميل...</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">لا توجد تحويلات في هذه الفترة.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.reference} className="hover:bg-sky-50/40">
                  <td className="px-3 py-1.5 font-mono text-slate-800">{r.date}</td>
                  <td className="px-3 py-1.5 font-bold text-sky-700">{r.opType}</td>
                  <td className="px-3 py-1.5 font-semibold text-rose-700">{r.fromName}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-900">{formatIQD(r.fromBalAfter)}</td>
                  <td className="px-3 py-1.5 font-semibold text-emerald-700">{r.toName}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-900">{formatIQD(r.toBalAfter)}</td>
                  <td className="px-3 py-1.5 font-mono font-black text-slate-950">{formatIQD(r.amount)}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600 text-[11px]">{r.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ---- كشف حساب (Account Statement) --------------------------------------
type Account = { id: string; name: string; type: string; opening_balance: number };
type AccTx = {
  id: string;
  account_id: string;
  entry_type: string;
  amount: number;
  currency: string;
  exchange_rate: number;
  iqd_equivalent: number;
  entry_date: string;
  reference: string | null;
  description: string | null;
  created_by: string | null;
};

function AccountStatementLedger({ from, to }: { from: string; to: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [txs, setTxs] = useState<AccTx[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [reconciledIds, setReconciledIds] = useState<Set<string>>(new Set());
  const [openSingle, setOpenSingle] = useState(false);
  const [openMulti, setOpenMulti] = useState(false);
  const users = useUsersMap();

  const loadAccounts = async () => {
    const { data } = await supabase.from("accounts").select("id,name,type,opening_balance").order("name");
    const list = (data ?? []) as Account[];
    setAccounts(list);
    if (list.length && !accountId) setAccountId(list[0].id);
  };
  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      const { data } = await supabase
        .from("account_transactions")
        .select("*")
        .eq("account_id", accountId)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: true });
      setTxs((data ?? []) as AccTx[]);
    })();
  }, [accountId, from, to, reloadKey]);

  const acc = accounts.find((a) => a.id === accountId);
  let running = Number(acc?.opening_balance ?? 0);
  const rows = txs.map((t, i) => {
    const debitIQD = t.entry_type === "payment" ? Number(t.iqd_equivalent || 0) : 0;
    const creditIQD = t.entry_type === "receipt" ? Number(t.iqd_equivalent || 0) : 0;
    running += creditIQD - debitIQD;
    return { t, i, debitIQD, creditIQD, running };
  });
  const totalDebit = rows.reduce((s, r) => s + r.debitIQD, 0);
  const totalCredit = rows.reduce((s, r) => s + r.creditIQD, 0);

  const opType = (t: string) => {
    if (t === "receipt") return "سند قبض";
    if (t === "payment") return "سند صرف";
    if (t === "transfer") return "تحويل";
    return "تعديل";
  };

  const reconcileAll = () => {
    setReconciledIds(new Set(txs.map((t) => t.id)));
    toast.success("تمت مطابقة جميع الحركات في هذا النطاق");
  };
  const saveLedger = () => {
    toast.success("تم حفظ حالة كشف الحساب");
  };
  const printLedger = () => window.print();
  const refresh = () => setReloadKey((k) => k + 1);

  const Toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setOpenSingle(true)}
        className="px-3 py-2 rounded-lg bg-emerald text-primary-foreground text-[11px] font-bold hover:brightness-110"
      >
        ➕ انشاء سند
      </button>
      <button
        onClick={() => setOpenMulti(true)}
        className="px-3 py-2 rounded-lg bg-sky-600 text-white text-[11px] font-bold hover:brightness-110"
      >
        🧾 انشاء سند متعدد
      </button>
      <button
        onClick={reconcileAll}
        className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-[11px] font-bold hover:brightness-110"
      >
        ✔ مطابقة
      </button>
      <button
        onClick={saveLedger}
        className="px-3 py-2 rounded-lg bg-slate-800 border border-emerald/40 text-emerald text-[11px] font-bold hover:bg-emerald/10"
      >
        💾 حفظ
      </button>
      <button
        onClick={printLedger}
        className="px-3 py-2 rounded-lg bg-slate-800 border border-border text-foreground text-[11px] font-bold hover:border-emerald/40"
      >
        🖨 طباعة
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-xl border border-border bg-slate-950/60 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">فلترة حسب الحساب</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40 min-w-[16rem]"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        {acc && (
          <div className="text-left">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">الرصيد الافتتاحي</p>
            <p className="text-sm font-mono font-bold text-emerald mt-1">{formatIQD(Number(acc.opening_balance || 0))}</p>
          </div>
        )}
        <div className="w-full">{Toolbar}</div>
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="max-h-[54vh] overflow-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-900/80 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr>
                <th className="px-2 py-2">ت</th>
                <th className="px-2 py-2">الرصيد د.ع</th>
                <th className="px-2 py-2">دائن د.ع</th>
                <th className="px-2 py-2">مدين د.ع</th>
                <th className="px-2 py-2">التاريخ</th>
                <th className="px-2 py-2">نوع العملية</th>
                <th className="px-2 py-2">البيان</th>
                <th className="px-2 py-2">المستخدم</th>
                <th className="px-2 py-2">المطابقة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((r) => {
                const reconciled = reconciledIds.has(r.t.id);
                return (
                  <tr key={r.t.id} className="hover:bg-slate-800/40">
                    <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.i + 1}</td>
                    <td className="px-2 py-1.5 font-mono font-bold text-emerald">{formatIQD(r.running)}</td>
                    <td className="px-2 py-1.5 font-mono text-emerald">{r.creditIQD ? formatIQD(r.creditIQD) : "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-rose-400">{r.debitIQD ? formatIQD(r.debitIQD) : "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{r.t.entry_date}</td>
                    <td className="px-2 py-1.5">{opType(r.t.entry_type)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground max-w-[20rem] truncate" title={r.t.description ?? ""}>
                      {r.t.description ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{users[r.t.created_by ?? ""] ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                        reconciled
                          ? "bg-emerald/15 border-emerald/40 text-emerald"
                          : "bg-slate-800 border-border text-muted-foreground"
                      }`}>
                        {reconciled ? "مطابق" : "غير مطابق"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    لا توجد حركات في هذا النطاق.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-950/80 border-t-2 border-emerald/40 sticky bottom-0">
              <tr className="text-xs font-bold">
                <td colSpan={2} className="px-2 py-2 text-left text-emerald uppercase tracking-wider">الاجمالي</td>
                <td className="px-2 py-2 font-mono text-emerald">{formatIQD(totalCredit)}</td>
                <td className="px-2 py-2 font-mono text-rose-400">{formatIQD(totalDebit)}</td>
                <td colSpan={5} className="px-2 py-2 text-right text-muted-foreground">
                  صافي: <span className="font-mono text-emerald">{formatIQD(totalCredit - totalDebit)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="p-3 rounded-xl border border-border bg-slate-950/60">{Toolbar}</div>

      {openSingle && (
        <CreateVoucherSingleModal
          accounts={accounts}
          defaultFromId={accountId}
          onClose={() => setOpenSingle(false)}
          onSaved={() => { setOpenSingle(false); refresh(); }}
        />
      )}
      {openMulti && (
        <CreateVoucherMultiModal
          accounts={accounts}
          defaultFromId={accountId}
          onClose={() => setOpenMulti(false)}
          onSaved={() => { setOpenMulti(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ---- Modal shell -------------------------------------------------------
function ModalShell({ title, onClose, children, maxWidth = "max-w-2xl" }: {
  title: string; onClose: () => void; children: React.ReactNode; maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose} dir="rtl">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} bg-slate-950 border border-emerald/40 rounded-2xl shadow-2xl overflow-hidden`}
      >
        <div className="px-5 py-3 border-b border-border bg-slate-900/60 flex items-center gap-3">
          <h3 className="flex-1 text-sm font-bold text-emerald">{title}</h3>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded bg-slate-800 border border-border text-xs font-bold hover:border-destructive/50 hover:text-destructive"
          >
            ✕
          </button>
        </div>
        <div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ModalField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
const modalInputCls =
  "w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald/40 focus:border-emerald disabled:opacity-60 disabled:cursor-not-allowed";

const autoReceiptNo = () => `V-${Date.now().toString().slice(-8)}`;
const nowStamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// ---- Single Voucher Modal ---------------------------------------------
function CreateVoucherSingleModal({ accounts, defaultFromId, onClose, onSaved }: {
  accounts: Account[]; defaultFromId: string; onClose: () => void; onSaved: () => void;
}) {
  const [fromId, setFromId] = useState(defaultFromId);
  const [toId, setToId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const receiptNo = useMemo(autoReceiptNo, []);
  const createdAt = useMemo(nowStamp, []);
  const today = new Date().toISOString().slice(0, 10);

  const save = async () => {
    const amt = Number(amount);
    if (!fromId || !toId) return toast.error("اختر الحسابين");
    if (fromId === toId) return toast.error("لا يمكن أن يكون الحسابان متطابقين");
    if (!amt || amt <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    setBusy(true);
    try {
      const { error } = await supabase.from("account_transactions").insert([
        {
          account_id: fromId, entry_type: "payment", amount: amt, currency: "IQD",
          exchange_rate: 1, iqd_equivalent: amt, entry_date: today,
          reference: receiptNo, description: desc || null,
        },
        {
          account_id: toId, entry_type: "receipt", amount: amt, currency: "IQD",
          exchange_rate: 1, iqd_equivalent: amt, entry_date: today,
          reference: receiptNo, description: desc || null,
        },
      ]);
      if (error) throw error;
      toast.success(`تم إنشاء السند ${receiptNo}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="انشاء سند" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ModalField label="رقم الوصل (تلقائي)">
          <input value={receiptNo} disabled className={modalInputCls} />
        </ModalField>
        <ModalField label="التاريخ (تلقائي)">
          <input value={today} disabled className={modalInputCls} />
        </ModalField>
        <ModalField label="من حساب (مدين)">
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={modalInputCls}>
            <option value="">— اختر —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </ModalField>
        <ModalField label="الى حساب (دائن)">
          <select value={toId} onChange={(e) => setToId(e.target.value)} className={modalInputCls}>
            <option value="">— اختر —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </ModalField>
        <ModalField label="المبلغ (دينار عراقي)" className="sm:col-span-2">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={modalInputCls} placeholder="0" />
        </ModalField>
        <ModalField label="البيان" className="sm:col-span-2">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className={modalInputCls} placeholder="وصف مفصل للسند" />
        </ModalField>
        <ModalField label="تاريخ الانشاء (لا يمكن تعديله)" className="sm:col-span-2">
          <input value={createdAt} disabled readOnly className={`${modalInputCls} bg-slate-900 text-rose-300`} />
        </ModalField>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 border border-border text-xs font-bold">إلغاء</button>
        <button onClick={save} disabled={busy} className="px-6 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
          {busy ? "..." : "حفظ السند"}
        </button>
      </div>
    </ModalShell>
  );
}

// ---- Multi Voucher Modal ----------------------------------------------
function CreateVoucherMultiModal({ accounts, defaultFromId, onClose, onSaved }: {
  accounts: Account[]; defaultFromId: string; onClose: () => void; onSaved: () => void;
}) {
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [receiptNo, setReceiptNo] = useState(autoReceiptNo());
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState("0");
  const [txType, setTxType] = useState<"payment" | "receipt" | "transfer" | "purchase">("transfer");
  const [fromId, setFromId] = useState(defaultFromId);
  const [toId, setToId] = useState("");
  const [transferAmt, setTransferAmt] = useState("");
  const [fromAllowDir, setFromAllowDir] = useState<"له" | "عليه">("له");
  const [fromAllowAmt, setFromAllowAmt] = useState("0");
  const [toAllowDir, setToAllowDir] = useState<"له" | "عليه">("له");
  const [toAllowAmt, setToAllowAmt] = useState("0");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const createdAt = useMemo(nowStamp, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("account_transactions").select("account_id,entry_type,iqd_equivalent");
      const map: Record<string, number> = {};
      for (const a of accounts) map[a.id] = Number(a.opening_balance || 0);
      for (const t of (data ?? []) as any[]) {
        const d = t.entry_type === "receipt" ? Number(t.iqd_equivalent || 0) : -Number(t.iqd_equivalent || 0);
        map[t.account_id] = (map[t.account_id] || 0) + d;
      }
      setBalances(map);
    })();
  }, [accounts]);

  const fromBal = balances[fromId] ?? 0;
  const toBal = balances[toId] ?? 0;
  const amt = Number(transferAmt) || 0;
  const discPct = Number(discount) || 0;
  const netAmt = Math.max(0, amt * (1 - discPct / 100));

  const save = async () => {
    if (!fromId || !toId) return toast.error("اختر الحسابين");
    if (fromId === toId) return toast.error("لا يمكن أن يكون الحسابان متطابقين");
    if (!amt || amt <= 0) return toast.error("أدخل مبلغ التحويل");
    setBusy(true);
    try {
      const inserts: any[] = [
        {
          account_id: fromId, entry_type: "payment", amount: netAmt, currency: "IQD",
          exchange_rate: 1, iqd_equivalent: netAmt, entry_date: receiptDate,
          reference: receiptNo, description: `[${txType}] ${desc || ""}`.trim(),
        },
        {
          account_id: toId, entry_type: "receipt", amount: netAmt, currency: "IQD",
          exchange_rate: 1, iqd_equivalent: netAmt, entry_date: receiptDate,
          reference: receiptNo, description: `[${txType}] ${desc || ""}`.trim(),
        },
      ];
      const fa = Number(fromAllowAmt) || 0;
      if (fa > 0) {
        inserts.push({
          account_id: fromId,
          entry_type: fromAllowDir === "له" ? "receipt" : "payment",
          amount: fa, currency: "IQD", exchange_rate: 1, iqd_equivalent: fa,
          entry_date: receiptDate, reference: receiptNo,
          description: `سماح ${fromAllowDir} — ${receiptNo}`,
        });
      }
      const ta = Number(toAllowAmt) || 0;
      if (ta > 0) {
        inserts.push({
          account_id: toId,
          entry_type: toAllowDir === "له" ? "receipt" : "payment",
          amount: ta, currency: "IQD", exchange_rate: 1, iqd_equivalent: ta,
          entry_date: receiptDate, reference: receiptNo,
          description: `سماح ${toAllowDir} — ${receiptNo}`,
        });
      }
      const { error } = await supabase.from("account_transactions").insert(inserts);
      if (error) throw error;
      toast.success(`تم إنشاء السند المتعدد ${receiptNo}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="انشاء سند متعدد" onClose={onClose} maxWidth="max-w-4xl">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <ModalField label="رقم الوصل">
          <input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} className={modalInputCls} />
        </ModalField>
        <ModalField label="تاريخه">
          <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className={modalInputCls} />
        </ModalField>
        <ModalField label="نسبة الخصم %">
          <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className={modalInputCls} />
        </ModalField>
        <ModalField label="نوع الحركة">
          <select value={txType} onChange={(e) => setTxType(e.target.value as any)} className={modalInputCls}>
            <option value="payment">صرف</option>
            <option value="purchase">شراء</option>
            <option value="transfer">تحويل</option>
            <option value="receipt">قبض</option>
          </select>
        </ModalField>
      </div>

      {/* From Account */}
      <div className="mt-4 p-3 rounded-xl border border-rose-500/30 bg-rose-950/10">
        <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300 mb-2">من حساب (الصندوق)</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <ModalField label="الحساب">
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={modalInputCls}>
              <option value="">— اختر —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </ModalField>
          <ModalField label="مبلغه (الرصيد)">
            <input value={formatIQD(fromBal)} disabled className={modalInputCls} />
          </ModalField>
          <ModalField label="مبلغ التحويل">
            <input type="number" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} className={modalInputCls} placeholder="0" />
          </ModalField>
          <ModalField label="السماح">
            <div className="flex gap-1">
              <select value={fromAllowDir} onChange={(e) => setFromAllowDir(e.target.value as any)} className={`${modalInputCls} w-24`}>
                <option value="له">سماح له</option>
                <option value="عليه">سماح عليه</option>
              </select>
              <input type="number" value={fromAllowAmt} onChange={(e) => setFromAllowAmt(e.target.value)} className={modalInputCls} placeholder="مبلغ السماح" />
            </div>
          </ModalField>
        </div>
      </div>

      {/* To Account */}
      <div className="mt-3 p-3 rounded-xl border border-emerald/30 bg-emerald/5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald mb-2">الى حساب</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <ModalField label="الحساب">
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={modalInputCls}>
              <option value="">— اختر —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </ModalField>
          <ModalField label="مبلغه (الرصيد)">
            <input value={formatIQD(toBal)} disabled className={modalInputCls} />
          </ModalField>
          <ModalField label="مبلغ التحويل (تلقائي)">
            <input value={String(netAmt)} disabled className={modalInputCls} />
          </ModalField>
          <ModalField label="السماح">
            <div className="flex gap-1">
              <select value={toAllowDir} onChange={(e) => setToAllowDir(e.target.value as any)} className={`${modalInputCls} w-24`}>
                <option value="له">سماح له</option>
                <option value="عليه">سماح عليه</option>
              </select>
              <input type="number" value={toAllowAmt} onChange={(e) => setToAllowAmt(e.target.value)} className={modalInputCls} placeholder="مبلغ السماح" />
            </div>
          </ModalField>
        </div>
      </div>

      <div className="mt-3">
        <ModalField label="البيان">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className={modalInputCls} placeholder="تفاصيل السند" />
        </ModalField>
      </div>

      <div className="mt-3">
        <ModalField label="تاريخ انشاء الوصل (لا يمكن تغييره)">
          <input value={createdAt} disabled readOnly className={`${modalInputCls} bg-slate-900 text-rose-300`} />
        </ModalField>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 border border-border text-xs font-bold">إلغاء</button>
        <button onClick={save} disabled={busy} className="px-6 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
          {busy ? "..." : "حفظ السند المتعدد"}
        </button>
      </div>
    </ModalShell>
  );
}

// ---- Daily Cashbox ------------------------------------------------------
function DailyCashboxReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [medCost, setMedCost] = useState<Map<string, number>>(new Map());
  const users = useUsersMap();
  useEffect(() => {
    (async () => {
      const [invRes, medsRes] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select("id,total,created_by,created_at,sales_invoice_items(medicine_id,qty,unit_price)")
          .gte("created_at", from)
          .lte("created_at", to + "T23:59:59"),
        supabase.from("medicines").select("id,small_unit_cost,purchase_price"),
      ]);
      setRows((invRes.data ?? []) as any[]);
      const map = new Map<string, number>();
      for (const m of (medsRes.data ?? []) as any[]) {
        map.set(m.id, Number(m.small_unit_cost ?? m.purchase_price ?? 0));
      }
      setMedCost(map);
    })();
  }, [from, to]);

  const perUser = useMemo(() => {
    const m = new Map<string, { drawer: number; profit: number; count: number }>();
    for (const inv of rows) {
      const uid = inv.created_by ?? "unknown";
      const total = Number(inv.total || 0);
      const cost = (inv.sales_invoice_items ?? []).reduce(
        (s: number, it: any) => s + Number(it.qty || 0) * (medCost.get(it.medicine_id) ?? 0),
        0,
      );
      const prof = total - cost;
      const cur = m.get(uid) ?? { drawer: 0, profit: 0, count: 0 };
      cur.drawer += total;
      cur.profit += prof;
      cur.count += 1;
      m.set(uid, cur);
    }
    return [...m.entries()].map(([uid, v]) => ({ uid, ...v, margin: v.drawer > 0 ? (v.profit / v.drawer) * 100 : 0 }));
  }, [rows, medCost]);

  const totals = perUser.reduce(
    (a, r) => ({ drawer: a.drawer + r.drawer, profit: a.profit + r.profit, count: a.count + r.count }),
    { drawer: 0, profit: 0, count: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Card label="عدد المستخدمين" value={perUser.length.toLocaleString()} />
        <Card label="مجموع القاصات" value={formatIQD(totals.drawer)} accent />
        <Card label="مجموع الأرباح" value={formatIQD(totals.profit)} accent />
        <Card label="متوسط نسبة الربح" value={`${totals.drawer > 0 ? ((totals.profit / totals.drawer) * 100).toFixed(1) : "0"}%`} />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2">اسم المستخدم</th>
              <th className="px-3 py-2">عدد الفواتير</th>
              <th className="px-3 py-2">المبلغ في قاصته</th>
              <th className="px-3 py-2">ربحه</th>
              <th className="px-3 py-2">نسبة الربح</th>
              <th className="px-3 py-2">المجموع الكلي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {perUser.map((r) => (
              <tr key={r.uid} className="hover:bg-slate-800/40">
                <td className="px-3 py-1.5 font-bold">{users[r.uid] ?? "غير معروف"}</td>
                <td className="px-3 py-1.5 font-mono">{r.count}</td>
                <td className="px-3 py-1.5 font-mono text-emerald font-bold">{formatIQD(r.drawer)}</td>
                <td className="px-3 py-1.5 font-mono text-emerald">{formatIQD(r.profit)}</td>
                <td className="px-3 py-1.5 font-mono">{r.margin.toFixed(1)}%</td>
                <td className="px-3 py-1.5 font-mono font-bold">{formatIQD(r.drawer + r.profit)}</td>
              </tr>
            ))}
            {perUser.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">لا توجد قاصات في هذا النطاق.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Daily Reconciliation ----------------------------------------------
function DailyReconciliationReport({ from, to }: { from: string; to: string }) {
  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [incomes, setIncomes] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [medCost, setMedCost] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    (async () => {
      const [s, p, ex, inc, mv, meds] = await Promise.all([
        supabase.from("sales_invoices").select("id,total,discount,payment_type,created_at,sales_invoice_items(medicine_id,qty,unit_price)").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("purchase_invoices").select("id,total,payment_type,created_at").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("expenses").select("amount,expense_date,category").gte("expense_date", from).lte("expense_date", to),
        supabase.from("income").select("amount,income_date,source").gte("income_date", from).lte("income_date", to),
        supabase.from("stock_movements").select("medicine_id,delta,reason,created_at").in("reason", ["sale_reverted", "purchase_reverted"]).gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("medicines").select("id,small_unit_cost,purchase_price,selling_price"),
      ]);
      setSales((s.data ?? []) as any);
      setPurchases((p.data ?? []) as any);
      setExpenses((ex.data ?? []) as any);
      setIncomes((inc.data ?? []) as any);
      setMovements((mv.data ?? []) as any);
      const map = new Map<string, number>();
      for (const m of (meds.data ?? []) as any[]) {
        map.set(m.id, Number(m.small_unit_cost ?? m.purchase_price ?? 0));
      }
      setMedCost(map);
    })();
  }, [from, to]);

  const salesTotal = sales.reduce((s, r) => s + Number(r.total || 0), 0);
  const salesCash = sales.filter((r) => r.payment_type === "cash").reduce((s, r) => s + Number(r.total || 0), 0);
  const salesCredit = salesTotal - salesCash;
  const salesProfit = sales.reduce((s, r) => {
    const cost = (r.sales_invoice_items ?? []).reduce((a: number, it: any) => a + Number(it.qty || 0) * (medCost.get(it.medicine_id) ?? 0), 0);
    return s + (Number(r.total || 0) - cost);
  }, 0);
  const salesDiscounts = sales.reduce((s, r) => s + Number(r.discount || 0), 0);

  const salesReturnTotal = movements.filter((m) => m.reason === "sale_reverted").reduce((s, m) => s + Math.abs(Number(m.delta || 0)) * (medCost.get(m.medicine_id) ?? 0), 0);

  const purchasesTotal = purchases.reduce((s, r) => s + Number(r.total || 0), 0);
  const purchasesCash = purchases.filter((r) => r.payment_type === "cash").reduce((s, r) => s + Number(r.total || 0), 0);
  const purchasesCredit = purchasesTotal - purchasesCash;

  const purchaseReturnTotal = movements.filter((m) => m.reason === "purchase_reverted").reduce((s, m) => s + Math.abs(Number(m.delta || 0)) * (medCost.get(m.medicine_id) ?? 0), 0);

  const expensesTotal = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const debtSettlements = incomes.filter((r) => r.source === "تحصيل ديون").reduce((s, r) => s + Number(r.amount || 0), 0);
  const externalIncome = incomes.filter((r) => r.source !== "تحصيل ديون").reduce((s, r) => s + Number(r.amount || 0), 0);
  const profitWithdrawals = expenses.filter((r) => r.category === "سحوبات أرباح").reduce((s, r) => s + Number(r.amount || 0), 0);

  const netAllowances = salesDiscounts;
  const drawerBalance = salesCash - purchasesCash - expensesTotal + externalIncome + debtSettlements - salesReturnTotal + purchaseReturnTotal;
  const netProfit = salesProfit - expensesTotal - profitWithdrawals;

  return (
    <div className="grid grid-cols-2 gap-4">
      <ReconSection title="المبيعات" tone="emerald" rows={[
        ["اجمالي المبيعات", salesTotal],
        ["المبيعات النقدية", salesCash],
        ["المبيعات غير النقدية", salesCredit],
        ["ارباح المبيعات", salesProfit],
      ]} />
      <ReconSection title="مرتجع المبيعات" tone="rose" rows={[
        ["اجمالي مرتجع المبيعات", salesReturnTotal],
        ["المرتجعات النقدية", salesReturnTotal],
        ["المرتجعات غير النقدية", 0],
        ["ارباح مرتجع المبيعات", 0],
      ]} />
      <ReconSection title="المشتريات" tone="sky" rows={[
        ["اجمالي المشتريات", purchasesTotal],
        ["المشتريات النقدية", purchasesCash],
        ["المشتريات غير النقدية", purchasesCredit],
      ]} />
      <ReconSection title="مرتجع المشتريات" tone="amber" rows={[
        ["اجمالي مرتجع المشتريات", purchaseReturnTotal],
        ["مرتجع المشتريات النقدية", purchaseReturnTotal],
        ["مرتجع مشتريات غير النقدية", 0],
      ]} />
      <ReconSection title="المصاريف والتسديدات" tone="rose" rows={[
        ["اجمالي المصاريف", expensesTotal],
        ["اجمالي تسديد الديون", 0],
        ["سحوبات ارباح", profitWithdrawals],
      ]} />
      <ReconSection title="الإيرادات الخارجية والتحصيل" tone="emerald" rows={[
        ["اجمالي الايرادات الخارجية", externalIncome],
        ["اجمالي تحصيل الديون", debtSettlements],
      ]} />
      <div className="col-span-2">
        <ReconSection title="الصافي النهائي" tone="emerald" rows={[
          ["صافي السماحات", netAllowances],
          ["اجمالي ارصدة الصناديق", drawerBalance],
          ["صافي الارباح الكلية", netProfit],
        ]} big />
      </div>
    </div>
  );
}

function ReconSection({ title, rows, tone, big }: { title: string; rows: [string, number][]; tone: "emerald" | "rose" | "sky" | "amber"; big?: boolean }) {
  const toneMap: Record<string, string> = {
    emerald: "border-emerald/40 bg-emerald/5 text-emerald",
    rose: "border-rose-500/40 bg-rose-500/5 text-rose-300",
    sky: "border-sky-500/40 bg-sky-500/5 text-sky-300",
    amber: "border-amber-500/40 bg-amber-500/5 text-amber-300",
  };
  return (
    <div className={`border rounded-xl overflow-hidden ${toneMap[tone]}`}>
      <div className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b ${toneMap[tone]}`}>
        {title}
      </div>
      <table className="w-full text-sm text-right bg-slate-950/60">
        <tbody className="divide-y divide-border/50">
          {rows.map(([label, val]) => (
            <tr key={label}>
              <td className="px-3 py-2 text-muted-foreground">{label}</td>
              <td className={`px-3 py-2 font-mono font-bold text-left ${big ? "text-lg text-emerald" : "text-foreground"}`}>
                {formatIQD(val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Debts --------------------------------------------------------------
function DebtsReport({ from, to }: { from: string; to: string }) {
  const [creditSales, setCreditSales] = useState<any[]>([]);
  const [creditPurchases, setCreditPurchases] = useState<any[]>([]);
  const [pats, setPats] = useState<PatientRow[]>([]);
  const [sups, setSups] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [s, p, patRes, supRes] = await Promise.all([
        supabase.from("sales_invoices").select("patient_id,total,created_at").eq("payment_type", "credit").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("purchase_invoices").select("supplier_id,total,created_at").eq("payment_type", "credit").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        listPatients(),
        supabase.from("suppliers").select("id,name"),
      ]);
      setCreditSales((s.data ?? []) as any);
      setCreditPurchases((p.data ?? []) as any);
      setPats(patRes);
      setSups((supRes.data ?? []) as any[]);
    })();
  }, [from, to]);

  const patName = (id: string | null) => pats.find((p) => p.id === id)?.full_name ?? "زبون نقدي";
  const supName = (id: string | null) => sups.find((s) => s.id === id)?.name ?? "—";

  const debtors = new Map<string, number>();
  for (const r of creditSales) {
    const k = patName(r.patient_id);
    debtors.set(k, (debtors.get(k) ?? 0) + Number(r.total || 0));
  }
  const creditors = new Map<string, number>();
  for (const r of creditPurchases) {
    const k = supName(r.supplier_id);
    creditors.set(k, (creditors.get(k) ?? 0) + Number(r.total || 0));
  }

  const totalDebtors = [...debtors.values()].reduce((a, b) => a + b, 0);
  const totalCreditors = [...creditors.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Card label="اجمالي الديون للمرضى (مدينون)" value={formatIQD(totalDebtors)} warn={totalDebtors > 0} />
          <Card label="عدد المدينين" value={debtors.size.toLocaleString()} />
        </div>
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-emerald">اسم المدين (له علينا)</div>
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2">اسم المدين</th>
                <th className="px-3 py-2">المبلغ الكلي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {[...debtors.entries()].sort((a, b) => b[1] - a[1]).map(([name, amt]) => (
                <tr key={name} className="hover:bg-slate-800/40">
                  <td className="px-3 py-1.5 font-medium">{name}</td>
                  <td className="px-3 py-1.5 font-mono font-bold text-rose-400">{formatIQD(amt)}</td>
                </tr>
              ))}
              {debtors.size === 0 && (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">لا يوجد مدينون.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Card label="اجمالي الديون للموردين (دائنون)" value={formatIQD(totalCreditors)} warn={totalCreditors > 0} />
          <Card label="عدد الدائنين" value={creditors.size.toLocaleString()} />
        </div>
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-amber-300">اسم الدائن (علينا له)</div>
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2">اسم الدائن</th>
                <th className="px-3 py-2">المبلغ الكلي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {[...creditors.entries()].sort((a, b) => b[1] - a[1]).map(([name, amt]) => (
                <tr key={name} className="hover:bg-slate-800/40">
                  <td className="px-3 py-1.5 font-medium">{name}</td>
                  <td className="px-3 py-1.5 font-mono font-bold text-amber-300">{formatIQD(amt)}</td>
                </tr>
              ))}
              {creditors.size === 0 && (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">لا يوجد دائنون.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Expenses -----------------------------------------------------------
function ExpensesReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("expenses")
        .select("id,category,amount,description,paid_to,expense_date")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date", { ascending: true });
      setRows((data ?? []) as any[]);
    })();
  }, [from, to]);

  let running = 0;
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card label="عدد العمليات" value={rows.length.toLocaleString()} />
        <Card label="اجمالي المصاريف" value={formatIQD(total)} warn={total > 0} />
        <Card label="متوسط العملية" value={formatIQD(rows.length ? total / rows.length : 0)} />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
            <tr>
              <th className="px-3 py-2">ت</th>
              <th className="px-3 py-2">اسم العملية</th>
              <th className="px-3 py-2">مبلغ العملية</th>
              <th className="px-3 py-2">مجموعها التراكمي</th>
              <th className="px-3 py-2">التاريخ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((r, i) => {
              running += Number(r.amount || 0);
              const label = r.category + (r.description ? ` — ${r.description}` : "");
              return (
                <tr key={r.id} className="hover:bg-slate-800/40">
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium">{label}</td>
                  <td className="px-3 py-1.5 font-mono text-rose-400 font-bold">{formatIQD(Number(r.amount || 0))}</td>
                  <td className="px-3 py-1.5 font-mono text-emerald">{formatIQD(running)}</td>
                  <td className="px-3 py-1.5 font-mono">{r.expense_date}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">لا توجد مصاريف في هذا النطاق.</td></tr>
            )}
          </tbody>
          <tfoot className="bg-slate-950/80 border-t-2 border-rose-500/40">
            <tr className="text-xs font-bold">
              <td colSpan={2} className="px-3 py-2 text-emerald uppercase tracking-wider">الاجمالي</td>
              <td className="px-3 py-2 font-mono text-rose-400">{formatIQD(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function uniqueDays(rows: any[]) {
  return new Set(rows.map((r) => String(r.created_at).slice(0, 10))).size;
}

// ---- Profits -----------------------------------------------------------
function ProfitsReport({ variant, from, to }: { variant: string; from: string; to: string }) {
  const [salesItems, setSalesItems] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const users = useUsersMap();

  useEffect(() => {
    (async () => {
      const [{ data: si }, { data: s }, meds, pats] = await Promise.all([
        supabase
          .from("sales_invoice_items")
          .select("invoice_id,medicine_id,qty,unit_price,line_total,sales_invoices!inner(created_at,patient_id,created_by,total)")
          .gte("sales_invoices.created_at", from)
          .lte("sales_invoices.created_at", to + "T23:59:59"),
        supabase
          .from("sales_invoices")
          .select("id,total,discount,addon,patient_id,created_at,created_by")
          .gte("created_at", from)
          .lte("created_at", to + "T23:59:59")
          .order("created_at", { ascending: false }),
        listMedicines(),
        listPatients(),
      ]);
      setSalesItems((si ?? []) as any);
      setSales((s ?? []) as any);
      setMedicines(meds);
      setPatients(pats);
    })();
  }, [from, to]);

  const costByMed = useMemo(
    () => new Map(medicines.map((m) => [m.id, Number(m.small_unit_cost ?? m.purchase_price ?? 0)])),
    [medicines],
  );
  const medById = useMemo(() => new Map(medicines.map((m) => [m.id, m])), [medicines]);
  const patName = (id: string | null) => patients.find((p) => p.id === id)?.full_name ?? (id ? "—" : "زبون نقدي");

  const invoiceProfit = (invId: string, invTotal: number) => {
    const its = salesItems.filter((it) => it.invoice_id === invId);
    const cost = its.reduce((s, it) => s + Number(it.qty) * (costByMed.get(it.medicine_id) ?? 0), 0);
    return invTotal - cost;
  };

  const revenue = sales.reduce((a, r) => a + Number(r.total), 0);
  const cost = salesItems.reduce((a, it) => a + Number(it.qty) * (costByMed.get(it.medicine_id) ?? 0), 0);
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card label="الإيرادات" value={formatIQD(revenue)} accent />
        <Card label="كلفة البضاعة" value={formatIQD(cost)} />
        <Card label="صافي الربح" value={formatIQD(profit)} accent={profit >= 0} warn={profit < 0} />
        <Card label="هامش الربح" value={`${margin.toFixed(1)}%`} accent={margin >= 0} warn={margin < 0} />
      </div>

      {variant === "prof_items" && <ProfitByItem items={salesItems} medicines={medicines} costByMed={costByMed} />}

      {variant === "prof_invoices" && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-900/80 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
                <tr>
                  <th className="px-3 py-2">الفاتورة</th>
                  <th className="px-3 py-2">المنظم</th>
                  <th className="px-3 py-2">العميل</th>
                  <th className="px-3 py-2">التاريخ</th>
                  <th className="px-3 py-2">سعرها</th>
                  <th className="px-3 py-2">صافي الربح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {sales.map((s) => {
                  const p = invoiceProfit(s.id, Number(s.total));
                  return (
                    <tr key={s.id} className="hover:bg-slate-800/40">
                      <td className="px-3 py-1.5 font-mono text-emerald">{s.id.slice(0, 8)}</td>
                      <td className="px-3 py-1.5">{users[s.created_by ?? ""] ?? "—"}</td>
                      <td className="px-3 py-1.5 font-medium">{patName(s.patient_id)}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px]">{new Date(s.created_at).toLocaleString("en-GB", { hour12: false })}</td>
                      <td className="px-3 py-1.5 font-mono">{formatIQD(Number(s.total))}</td>
                      <td className={`px-3 py-1.5 font-mono font-bold ${p >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(p)}</td>
                    </tr>
                  );
                })}
                {sales.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">لا توجد فواتير.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-slate-950/80 border-t-2 border-emerald/40 sticky bottom-0 text-xs font-bold">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-left text-emerald uppercase tracking-wider">الاجمالي</td>
                  <td className="px-3 py-2 font-mono">{formatIQD(revenue)}</td>
                  <td className="px-3 py-2 font-mono text-emerald">{formatIQD(profit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {variant === "prof_customers" && (
        <ProfitByCustomer sales={sales} patName={patName} invoiceProfit={invoiceProfit} />
      )}

      {variant === "prof_groups" && (
        <ProfitByGroup items={salesItems} medById={medById} costByMed={costByMed} />
      )}

      {variant === "prof_balance" && (
        <TrialBalanceReport from={from} to={to} revenue={revenue} cost={cost} />
      )}
    </div>
  );
}

function ProfitByCustomer({
  sales,
  patName,
  invoiceProfit,
}: {
  sales: any[];
  patName: (id: string | null) => string;
  invoiceProfit: (id: string, total: number) => number;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: any[]; total: number; profit: number }>();
    for (const s of sales) {
      const key = s.patient_id ?? "cash";
      const cur = m.get(key) ?? { name: patName(s.patient_id), rows: [], total: 0, profit: 0 };
      const p = invoiceProfit(s.id, Number(s.total));
      cur.rows.push({ ...s, _profit: p });
      cur.total += Number(s.total);
      cur.profit += p;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.profit - a.profit);
  }, [sales]);

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.name} className="border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-emerald/10 border-b border-emerald/30 flex items-center justify-between">
            <p className="text-sm font-bold text-emerald">{g.name}</p>
            <span className="text-[10px] font-mono text-muted-foreground">{g.rows.length} فاتورة</span>
          </div>
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">الفاتورة</th>
                <th className="px-3 py-1.5">التاريخ</th>
                <th className="px-3 py-1.5">سعر الفاتورة</th>
                <th className="px-3 py-1.5">ربحه</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {g.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 font-mono text-emerald">{r.id.slice(0, 8)}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{new Date(r.created_at).toLocaleString("en-GB", { hour12: false })}</td>
                  <td className="px-3 py-1.5 font-mono">{formatIQD(Number(r.total))}</td>
                  <td className={`px-3 py-1.5 font-mono ${r._profit >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(r._profit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-950/80 border-t-2 border-emerald/40 text-xs font-bold">
              <tr>
                <td colSpan={2} className="px-3 py-2 text-left text-emerald uppercase tracking-wider">مجموع ربح {g.name}</td>
                <td className="px-3 py-2 font-mono">{formatIQD(g.total)}</td>
                <td className="px-3 py-2 font-mono text-emerald">{formatIQD(g.profit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="p-6 text-center text-muted-foreground text-xs">لا توجد فواتير عملاء.</p>
      )}
    </div>
  );
}

function ProfitByGroup({
  items,
  medById,
  costByMed,
}: {
  items: any[];
  medById: Map<string, Medicine>;
  costByMed: Map<string, number>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const m = new Map<string, { qty: number; revenue: number; cost: number; items: Map<string, { name: string; qty: number; revenue: number; cost: number }> }>();
    for (const it of items) {
      const med = medById.get(it.medicine_id);
      const gname = med?.category ?? "بدون مجموعة";
      const revenue = Number(it.line_total);
      const c = Number(it.qty) * (costByMed.get(it.medicine_id) ?? 0);
      const cur = m.get(gname) ?? { qty: 0, revenue: 0, cost: 0, items: new Map() };
      cur.qty += Number(it.qty);
      cur.revenue += revenue;
      cur.cost += c;
      const im = cur.items.get(it.medicine_id) ?? { name: med?.trade_name ?? "—", qty: 0, revenue: 0, cost: 0 };
      im.qty += Number(it.qty);
      im.revenue += revenue;
      im.cost += c;
      cur.items.set(it.medicine_id, im);
      m.set(gname, cur);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v, profit: v.revenue - v.cost }))
      .sort((a, b) => b.profit - a.profit);
  }, [items, medById]);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        أرباح المجموعات — انقر لعرض المحتويات
      </div>
      <div className="divide-y divide-border/50">
        {groups.map((g) => {
          const isOpen = !!open[g.name];
          return (
            <div key={g.name}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [g.name]: !isOpen }))}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-800/40 text-right"
              >
                <span className="text-xs font-mono text-muted-foreground">{isOpen ? "▾" : "◂"}</span>
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm font-bold text-emerald">{g.name}</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-muted-foreground">إيراد: <span className="font-mono text-foreground">{formatIQD(g.revenue)}</span></span>
                    <span className="text-muted-foreground">ربحها: <span className={`font-mono font-bold ${g.profit >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(g.profit)}</span></span>
                  </div>
                </div>
              </button>
              {isOpen && (
                <table className="w-full text-xs text-right bg-slate-900/40">
                  <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-4 py-1.5">المادة</th>
                      <th className="px-4 py-1.5">الكمية المباعة</th>
                      <th className="px-4 py-1.5">إيراد</th>
                      <th className="px-4 py-1.5">كلفة</th>
                      <th className="px-4 py-1.5">ربحها</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {Array.from(g.items.values()).sort((a, b) => b.revenue - a.revenue).map((it, i) => (
                      <tr key={i}>
                        <td className="px-4 py-1.5">{it.name}</td>
                        <td className="px-4 py-1.5 font-mono">{it.qty}</td>
                        <td className="px-4 py-1.5 font-mono">{formatIQD(it.revenue)}</td>
                        <td className="px-4 py-1.5 font-mono text-muted-foreground">{formatIQD(it.cost)}</td>
                        <td className={`px-4 py-1.5 font-mono ${it.revenue - it.cost >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(it.revenue - it.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="p-6 text-center text-muted-foreground text-xs">لا توجد مبيعات في هذه الفترة.</p>
        )}
      </div>
    </div>
  );
}

function TrialBalanceReport({ from, to, revenue, cost }: { from: string; to: string; revenue: number; cost: number }) {
  const [purchases, setPurchases] = useState(0);
  const [openingBalances, setOpeningBalances] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [otherIncome, setOtherIncome] = useState(0);
  const [inventoryValue, setInventoryValue] = useState(0);

  useEffect(() => {
    (async () => {
      const [{ data: pi }, { data: acc }, { data: ex }, { data: inc }, meds] = await Promise.all([
        supabase.from("purchase_invoices").select("total,created_at").gte("created_at", from).lte("created_at", to + "T23:59:59"),
        supabase.from("accounts").select("opening_balance"),
        supabase.from("expenses").select("amount,currency").gte("expense_date", from).lte("expense_date", to),
        supabase.from("income").select("amount,currency").gte("income_date", from).lte("income_date", to),
        listMedicines(),
      ]);
      setPurchases((pi ?? []).reduce((s: number, r: any) => s + Number(r.total || 0), 0));
      setOpeningBalances((acc ?? []).reduce((s: number, r: any) => s + Number(r.opening_balance || 0), 0));
      setExpenses((ex ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));
      setOtherIncome((inc ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));
      setInventoryValue(meds.reduce((s, m) => s + Number(m.quantity_in_stock ?? 0) * Number(m.small_unit_cost ?? m.purchase_price ?? 0), 0));
    })();
  }, [from, to]);

  const rows: { label: string; debit: number; credit: number }[] = [
    { label: "الأصول الثابتة (قيمة المخزون الحالي)", debit: inventoryValue, credit: 0 },
    { label: "الأرصدة الافتتاحية للحسابات", debit: openingBalances, credit: 0 },
    { label: "الإيرادات المتراكمة (المبيعات)", debit: 0, credit: revenue },
    { label: "كلف الشراء (المشتريات خلال الفترة)", debit: purchases, credit: 0 },
    { label: "كلفة البضاعة المباعة", debit: cost, credit: 0 },
    { label: "التسويات والمصاريف", debit: expenses, credit: 0 },
    { label: "الإيرادات الخارجية", debit: 0, credit: otherIncome },
  ];
  let running = 0;
  const withCum = rows.map((r) => {
    running += r.credit - r.debit;
    return { ...r, cum: running };
  });
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const netDiff = totalCredit - totalDebit;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        تقرير الموازنة (ميزان المراجعة) — {from} → {to}
      </div>
      <table className="w-full text-xs text-right">
        <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2 w-10">ت</th>
            <th className="px-3 py-2">التفاصيل</th>
            <th className="px-3 py-2">مدين</th>
            <th className="px-3 py-2">دائن</th>
            <th className="px-3 py-2">الاجمالي</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {withCum.map((r, i) => (
            <tr key={i} className="hover:bg-slate-800/40">
              <td className="px-3 py-2 font-mono text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-2 font-medium">{r.label}</td>
              <td className="px-3 py-2 font-mono text-rose-400">{r.debit ? formatIQD(r.debit) : "—"}</td>
              <td className="px-3 py-2 font-mono text-emerald">{r.credit ? formatIQD(r.credit) : "—"}</td>
              <td className={`px-3 py-2 font-mono font-bold ${r.cum >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(r.cum)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-950/80 border-t-2 border-emerald/40 text-xs font-bold">
          <tr>
            <td colSpan={2} className="px-3 py-2 text-left text-emerald uppercase tracking-wider">صافي فروقات الميزان</td>
            <td className="px-3 py-2 font-mono text-rose-400">{formatIQD(totalDebit)}</td>
            <td className="px-3 py-2 font-mono text-emerald">{formatIQD(totalCredit)}</td>
            <td className={`px-3 py-2 font-mono ${netDiff >= 0 ? "text-emerald" : "text-destructive"}`}>{formatIQD(netDiff)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ProfitByItem({ items, medicines, costByMed }: { items: any[]; medicines: Medicine[]; costByMed: Map<string, number> }) {
  const agg = new Map<string, { qty: number; revenue: number; cost: number }>();
  for (const it of items) {
    const cur = agg.get(it.medicine_id) ?? { qty: 0, revenue: 0, cost: 0 };
    cur.qty += Number(it.qty);
    cur.revenue += Number(it.line_total);
    cur.cost += Number(it.qty) * (costByMed.get(it.medicine_id) ?? 0);
    agg.set(it.medicine_id, cur);
  }
  const list = Array.from(agg.entries())
    .map(([id, v]) => ({ id, ...v, name: medicines.find((m) => m.id === id)?.trade_name ?? "—" }))
    .sort((a, b) => b.revenue - a.revenue);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-4 py-2">المادة</th>
            <th className="px-4 py-2">الكمية</th>
            <th className="px-4 py-2">إيراد</th>
            <th className="px-4 py-2">كلفة</th>
            <th className="px-4 py-2">ربح</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {list.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-4 py-2 font-mono">{r.qty}</td>
              <td className="px-4 py-2 font-mono">{formatIQD(r.revenue)}</td>
              <td className="px-4 py-2 font-mono text-muted-foreground">{formatIQD(r.cost)}</td>
              <td className={`px-4 py-2 font-mono font-bold ${r.revenue - r.cost >= 0 ? "text-emerald" : "text-destructive"}`}>
                {formatIQD(r.revenue - r.cost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ---- Advanced Clinical CRM Patient Report ------------------------------
type PatientStat = {
  patient: PatientRow;
  first: string | null;
  last: string | null;
  count: number;
  diagnoses: string[];
  improvements: string;
  adherence: "on_time" | "late" | "critical" | "none";
  daysSinceLast: number;
};

function AdvancedPatientReport() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pats, { data: inv }] = await Promise.all([
        listPatients(),
        supabase
          .from("sales_invoices")
          .select("id,patient_id,created_at")
          .not("patient_id", "is", null)
          .order("created_at", { ascending: true }),
      ]);
      setPatients(pats);
      setInvoices((inv ?? []) as any);
      setLoading(false);
    })();
  }, []);

  const stats: PatientStat[] = useMemo(() => {
    const byPatient = new Map<string, { first: string; last: string; count: number }>();
    for (const inv of invoices) {
      const cur = byPatient.get(inv.patient_id);
      if (!cur) byPatient.set(inv.patient_id, { first: inv.created_at, last: inv.created_at, count: 1 });
      else {
        cur.last = inv.created_at;
        cur.count += 1;
      }
    }
    const today = Date.now();
    return patients.map((p) => {
      const agg = byPatient.get(p.id);
      const clin = getClinical(p.id);
      const diagnoses = Array.from(new Set(clin.visits.map((v) => v.diagnosis).filter(Boolean)));
      const improvements = clin.visits
        .slice(0, 3)
        .map((v) => `${v.date}: ${v.diagnosis}`)
        .join(" • ");
      const daysSinceLast = agg
        ? Math.floor((today - new Date(agg.last).getTime()) / 86400000)
        : Number.POSITIVE_INFINITY;
      let adherence: PatientStat["adherence"] = "none";
      if ((p.chronic_meds?.length ?? 0) > 0) {
        adherence = daysSinceLast <= 30 ? "on_time" : daysSinceLast <= 45 ? "late" : "critical";
      }
      return {
        patient: p,
        first: agg?.first ?? null,
        last: agg?.last ?? null,
        count: agg?.count ?? 0,
        diagnoses,
        improvements,
        adherence,
        daysSinceLast: isFinite(daysSinceLast) ? daysSinceLast : 0,
      };
    });
  }, [patients, invoices]);

  const filtered = stats.filter((s) => s.count > 0 || (s.patient.chronic_meds?.length ?? 0) > 0);

  if (loading) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card label="إجمالي المرضى" value={patients.length.toLocaleString()} />
        <Card label="مرضى نشطون" value={filtered.length.toLocaleString()} accent />
        <Card
          label="متأخرون عن التجديد"
          value={filtered.filter((s) => s.adherence === "late" || s.adherence === "critical").length.toLocaleString()}
          warn
        />
        <Card
          label="ملتزمون بالخطة"
          value={filtered.filter((s) => s.adherence === "on_time").length.toLocaleString()}
          accent
        />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          تقرير مرضى متقدم — Clinical CRM
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm text-right min-w-[900px]">
            <thead className="bg-slate-900/40 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2">المريض</th>
                <th className="px-3 py-2">أول مرة شراء</th>
                <th className="px-3 py-2">آخر مرة شراء</th>
                <th className="px-3 py-2">عدد التكرار</th>
                <th className="px-3 py-2">تشخيصات الحالة</th>
                <th className="px-3 py-2">تحسنات في الحالة</th>
                <th className="px-3 py-2">الالتزام بالدواء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((s) => (
                <tr key={s.patient.id}>
                  <td className="px-3 py-2 font-medium">
                    <div>{s.patient.full_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{s.patient.phone ?? ""}</div>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">{s.first ? s.first.slice(0, 10) : "—"}</td>
                  <td className="px-3 py-2 text-xs font-mono">{s.last ? s.last.slice(0, 10) : "—"}</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald">{s.count}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap gap-1 justify-end">
                      {s.diagnoses.slice(0, 4).map((d, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold">
                          🩺 {d}
                        </span>
                      ))}
                      {s.diagnoses.length === 0 && <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-muted-foreground max-w-xs truncate" title={s.improvements}>
                    {s.improvements || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <AdherenceBadge score={s.adherence} days={s.daysSinceLast} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد بيانات كافية.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdherenceBadge({ score, days }: { score: PatientStat["adherence"]; days: number }) {
  const map = {
    on_time: { cls: "bg-emerald/15 border-emerald/40 text-emerald", label: "ملتزم" },
    late: { cls: "bg-amber-500/15 border-amber-500/40 text-amber-300", label: "متأخر" },
    critical: { cls: "bg-destructive/15 border-destructive/40 text-destructive", label: "حرج" },
    none: { cls: "bg-slate-800 border-border text-muted-foreground", label: "—" },
  } as const;
  const m = map[score];
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold ${m.cls}`}>
      <span>{m.label}</span>
      {score !== "none" && <span className="font-mono opacity-70">{days}د</span>}
    </div>
  );
}

function ChronicPatientsReport() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  useEffect(() => { listPatients().then(setPatients); }, []);
  const chronic = patients.filter((p) => (p.chronic_meds?.length ?? 0) > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card label="إجمالي المرضى" value={patients.length.toLocaleString()} />
        <Card label="مرضى مزمنون" value={chronic.length.toLocaleString()} accent />
        <Card
          label="متوسط الأدوية/مريض"
          value={(chronic.reduce((s, p) => s + p.chronic_meds.length, 0) / Math.max(1, chronic.length)).toFixed(1)}
        />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-right">
          <tbody className="divide-y divide-border/50">
            {chronic.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium">{p.full_name}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground font-mono">{p.phone ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{p.chronic_meds.join("، ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Today's Sales + Add-to-Cart --------------------------------------
function TodaysSalesReport() {
  const [rows, setRows] = useState<any[]>([]);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [items, allMeds] = await Promise.all([
        supabase
          .from("sales_invoice_items")
          .select("medicine_id,qty,sales_invoices!inner(created_at)")
          .gte("sales_invoices.created_at", startOfDay.toISOString()),
        listMedicines(),
      ]);
      setRows((items.data ?? []) as any);
      setMeds(allMeds);
      setLoading(false);
    })();
  }, []);

  const soldMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.medicine_id, (m.get(r.medicine_id) ?? 0) + Number(r.qty));
    return m;
  }, [rows]);

  const list = useMemo(
    () =>
      meds
        .map((med) => ({ med, sold: soldMap.get(med.id) ?? 0 }))
        .filter((x) => x.sold > 0)
        .sort((a, b) => b.sold - a.sold),
    [meds, soldMap],
  );

  if (loading) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card label="مواد بيعت اليوم" value={list.length.toLocaleString()} accent />
        <Card
          label="إجمالي القطع المباعة"
          value={list.reduce((s, x) => s + x.sold, 0).toLocaleString()}
        />
        <Card
          label="مواد وصلت لحد الطلب"
          value={list.filter((x) => x.med.quantity_in_stock <= x.med.minimum_stock).length.toLocaleString()}
          warn
        />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          تقرير مبيعات اليوم — انقر "إضافة للسلة" لتجهيز طلب المشتريات
        </div>
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-900/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2">الباركود</th>
              <th className="px-3 py-2">المادة</th>
              <th className="px-3 py-2">مبيعات اليوم</th>
              <th className="px-3 py-2">الرصيد الحالي</th>
              <th className="px-3 py-2">الحد الأدنى</th>
              <th className="px-3 py-2">الحد الأعلى</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {list.map(({ med, sold }) => {
              const low = med.quantity_in_stock <= med.minimum_stock;
              const suggested = Math.max(0, (med.maximum_stock || med.minimum_stock * 2) - med.quantity_in_stock);
              return (
                <tr key={med.id} className={low ? "bg-destructive/5" : ""}>
                  <td className="px-3 py-2 font-mono text-xs">{med.barcode ?? "—"}</td>
                  <td className="px-3 py-2 font-medium">
                    <div>{med.trade_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{med.scientific_name}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-emerald font-bold">{sold}</td>
                  <td className={`px-3 py-2 font-mono ${low ? "text-destructive font-bold" : "text-foreground"}`}>
                    {med.quantity_in_stock}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{med.minimum_stock}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{med.maximum_stock}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => {
                        addToCart({
                          medicineId: med.id,
                          barcode: med.barcode,
                          name: med.trade_name,
                          currentStock: med.quantity_in_stock,
                          minimum: med.minimum_stock,
                          maximum: med.maximum_stock,
                          suggestedQty: suggested > 0 ? suggested : sold,
                          addedAt: new Date().toISOString(),
                        });
                        toast.success(`أُضيفت "${med.trade_name}" إلى سلة المشتريات`);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald text-primary-foreground text-[11px] font-bold hover:brightness-110"
                    >
                      <ShoppingCart className="w-3 h-3" /> إضافة للسلة
                    </button>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-xs">
                  لم يتم بيع أي مادة اليوم بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Extended Patient Reports -----------------------------------------
function usePatientPurchaseAgg() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [agg, setAgg] = useState<Map<string, { first: string; last: string; count: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pats, { data: inv }] = await Promise.all([
        listPatients(),
        supabase
          .from("sales_invoices")
          .select("patient_id,created_at")
          .not("patient_id", "is", null)
          .order("created_at", { ascending: true }),
      ]);
      const m = new Map<string, { first: string; last: string; count: number }>();
      for (const r of (inv ?? []) as any[]) {
        const cur = m.get(r.patient_id);
        if (!cur) m.set(r.patient_id, { first: r.created_at, last: r.created_at, count: 1 });
        else {
          cur.last = r.created_at;
          cur.count += 1;
        }
      }
      setPatients(pats);
      setAgg(m);
      setLoading(false);
    })();
  }, []);
  return { patients, agg, loading };
}

function ComprehensivePatientsReport() {
  const { patients, agg, loading } = usePatientPurchaseAgg();
  if (loading) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;
  const today = Date.now();
  const rows = patients.map((p) => {
    const a = agg.get(p.id);
    const clin = getClinical(p.id);
    const diagnoses = Array.from(new Set(clin.visits.map((v) => v.diagnosis).filter(Boolean)));
    const traj = clin.visits.slice(0, 3).map((v) => `${v.date}: ${v.diagnosis}`).join(" ← ");
    const lastDate = a?.last ? new Date(a.last).getTime() : clin.visits[0] ? new Date(clin.visits[0].date).getTime() : 0;
    const daysGap = lastDate ? Math.floor((today - lastDate) / 86400000) : null;
    const active = daysGap !== null && daysGap <= 45;
    return { p, a, clin, diagnoses, traj, daysGap, active };
  }).sort((a, b) => (a.daysGap ?? 9999) - (b.daysGap ?? 9999));

  const activeCount = rows.filter((r) => r.active).length;
  const lapsedCount = rows.filter((r) => !r.active).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card label="إجمالي المرضى" value={String(patients.length)} accent />
        <Card label="نشط (خلال 45 يوم)" value={String(activeCount)} accent />
        <Card label="منقطع" value={String(lapsedCount)} warn={lapsedCount > 0} />
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          تقرير مرضى شامل — CRM موحد
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs text-right min-w-[1100px]">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr>
                <th className="px-2 py-2">المريض</th>
                <th className="px-2 py-2">التواصل</th>
                <th className="px-2 py-2">الاهتمامات / الوسوم</th>
                <th className="px-2 py-2">أمراض مزمنة</th>
                <th className="px-2 py-2">أول شراء</th>
                <th className="px-2 py-2">آخر شراء</th>
                <th className="px-2 py-2">تكرار</th>
                <th className="px-2 py-2">فترة الانقطاع</th>
                <th className="px-2 py-2">حالة النشاط</th>
                <th className="px-2 py-2">التشخيص</th>
                <th className="px-2 py-2">مسار العلاج</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map(({ p, a, diagnoses, traj, daysGap, active }) => (
                <tr key={p.id} className="hover:bg-slate-800/40">
                  <td className="px-2 py-1.5 font-medium">{p.full_name}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{p.phone ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1 justify-end">
                      {(p.interests ?? []).length === 0 && <span className="text-muted-foreground">—</span>}
                      {(p.interests ?? []).slice(0, 4).map((t, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-emerald/10 border border-emerald/30 text-emerald text-[10px] font-bold">🎯 {t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1 justify-end">
                      {(p.chronic_diseases ?? []).length === 0 && <span className="text-muted-foreground">—</span>}
                      {(p.chronic_diseases ?? []).slice(0, 3).map((d, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold">🩺 {d}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{a ? a.first.slice(0, 10) : "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{a ? a.last.slice(0, 10) : "—"}</td>
                  <td className="px-2 py-1.5 font-mono font-bold text-emerald">{a?.count ?? 0}</td>
                  <td className={`px-2 py-1.5 font-mono font-bold ${daysGap === null ? "text-muted-foreground" : daysGap > 45 ? "text-destructive" : "text-emerald"}`}>
                    {daysGap === null ? "—" : `${daysGap} يوم`}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${active ? "bg-emerald/15 border-emerald/40 text-emerald" : "bg-destructive/10 border-destructive/40 text-destructive"}`}>
                      {active ? "● نشط" : "○ منقطع"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap gap-1 justify-end">
                      {diagnoses.length === 0 && <span className="text-muted-foreground">—</span>}
                      {diagnoses.slice(0, 3).map((d, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800/60 border border-border text-[10px]">{d}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-[10px] text-muted-foreground max-w-[16rem] truncate" title={traj}>{traj || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-6 text-center text-muted-foreground text-xs">لا يوجد مرضى.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


function GroupedList({ title, groups }: { title: string; groups: Map<string, PatientRow[]> }) {
  const entries = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="divide-y divide-border/50">
        {entries.map(([key, list]) => (
          <div key={key} className="p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-emerald">{key || "بدون تصنيف"}</p>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald/10 border border-emerald/30 text-emerald">
                {list.length} مريض
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((p) => (
                <span key={p.id} className="text-[11px] px-2 py-0.5 rounded bg-slate-800/60 border border-border">
                  {p.full_name}
                  <span className="text-muted-foreground font-mono ml-1">· {p.phone ?? "—"}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="p-6 text-center text-muted-foreground text-xs">لا توجد بيانات.</p>
        )}
      </div>
    </div>
  );
}

function PatientsByInterestsReport() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  useEffect(() => { listPatients().then(setPatients); }, []);
  const groups = useMemo(() => {
    const m = new Map<string, PatientRow[]>();
    for (const p of patients) {
      for (const tag of p.interests ?? []) {
        const arr = m.get(tag) ?? [];
        arr.push(p);
        m.set(tag, arr);
      }
    }
    return m;
  }, [patients]);
  return <GroupedList title="مرضى حسب الاهتمامات" groups={groups} />;
}

function PatientsByChronicMedsReport() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  useEffect(() => { listPatients().then(setPatients); }, []);
  const groups = useMemo(() => {
    const m = new Map<string, PatientRow[]>();
    for (const p of patients) {
      for (const med of p.chronic_meds ?? []) {
        const arr = m.get(med) ?? [];
        arr.push(p);
        m.set(med, arr);
      }
    }
    return m;
  }, [patients]);
  return <GroupedList title="مرضى حسب العلاج المزمن" groups={groups} />;
}

function PatientsByChronicDiseasesReport() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  useEffect(() => { listPatients().then(setPatients); }, []);
  const groups = useMemo(() => {
    const m = new Map<string, PatientRow[]>();
    for (const p of patients) {
      for (const d of p.chronic_diseases ?? []) {
        const arr = m.get(d) ?? [];
        arr.push(p);
        m.set(d, arr);
      }
    }
    return m;
  }, [patients]);
  return <GroupedList title="مرضى حسب الأمراض المزمنة" groups={groups} />;
}

function PatientsLapsedReport() {
  const { patients, agg, loading } = usePatientPurchaseAgg();
  if (loading) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;
  const today = Date.now();
  const rows = patients
    .map((p) => {
      const a = agg.get(p.id);
      if (!a) return null;
      const firstDays = Math.floor((today - new Date(a.first).getTime()) / 86400000);
      const inactive = Math.floor((today - new Date(a.last).getTime()) / 86400000);
      return { patient: p, first: a.first, last: a.last, count: a.count, firstDays, inactive };
    })
    .filter(Boolean) as Array<{ patient: PatientRow; first: string; last: string; count: number; firstDays: number; inactive: number }>;
  rows.sort((a, b) => b.inactive - a.inactive);

  const bucketOf = (d: number) =>
    d >= 180 ? { label: "منقطع تماماً", cls: "bg-destructive/15 text-destructive border-destructive/40" }
    : d >= 90 ? { label: "خطر انقطاع", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" }
    : d >= 45 ? { label: "متأخر", cls: "bg-sky-500/15 text-sky-300 border-sky-500/40" }
    : { label: "نشط", cls: "bg-emerald/15 text-emerald border-emerald/40" };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        مرضى حسب فترة الانقطاع
      </div>
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-900/40 text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2">المريض</th>
            <th className="px-3 py-2">أول شراء</th>
            <th className="px-3 py-2">آخر شراء</th>
            <th className="px-3 py-2">أيام منذ الأول</th>
            <th className="px-3 py-2">أيام الانقطاع</th>
            <th className="px-3 py-2">الحالة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((r) => {
            const b = bucketOf(r.inactive);
            return (
              <tr key={r.patient.id}>
                <td className="px-3 py-2 font-medium">{r.patient.full_name}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.first.slice(0, 10)}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.last.slice(0, 10)}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{r.firstDays}د</td>
                <td className="px-3 py-2 font-mono font-bold text-destructive">{r.inactive}د</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${b.cls}`}>{b.label}</span>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد مبيعات مسجلة.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- Vendor Reports (تقارير الموردين) ---------------------------------
type Supplier = { id: string; name: string; phone?: string | null };
type PurInv = {
  id: string; invoice_no: number | null; supplier_id: string | null;
  total: number; paid_amount: number | null; status: string | null;
  payment_type: string | null; created_at: string;
};

function VendorReports({ from, to }: { from: string; to: string }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<PurInv[]>([]);
  const [statementFor, setStatementFor] = useState<Supplier | null>(null);
  const [settleFor, setSettleFor] = useState<Supplier | null>(null);

  useEffect(() => {
    (async () => {
      const [sup, inv] = await Promise.all([
        supabase.from("suppliers").select("id,name,phone").order("name"),
        supabase.from("purchase_invoices")
          .select("id,invoice_no,supplier_id,total,paid_amount,status,payment_type,created_at"),
      ]);
      setSuppliers((sup.data ?? []) as Supplier[]);
      setInvoices((inv.data ?? []) as PurInv[]);
    })();
  }, []);

  const ledger = useMemo(() => {
    return suppliers.map((s) => {
      const invs = invoices.filter((i) => i.supplier_id === s.id);
      const totalPur = invs.reduce((a, i) => a + Number(i.total || 0), 0);
      const paid = invs.reduce((a, i) => a + Number(i.paid_amount || 0), 0);
      const returns = 0; // no returns table yet
      const debt = totalPur - paid - returns;
      return { supplier: s, totalPur, paid, returns, debt, count: invs.length };
    }).sort((a, b) => b.debt - a.debt);
  }, [suppliers, invoices]);

  const reloadInvoices = async () => {
    const { data } = await supabase.from("purchase_invoices")
      .select("id,invoice_no,supplier_id,total,paid_amount,status,payment_type,created_at");
    setInvoices((data ?? []) as PurInv[]);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card label="عدد الموردين" value={suppliers.length.toLocaleString()} />
        <Card label="إجمالي المشتريات" value={formatIQD(ledger.reduce((a, l) => a + l.totalPur, 0))} accent />
        <Card label="إجمالي المدفوع" value={formatIQD(ledger.reduce((a, l) => a + l.paid, 0))} />
        <Card label="إجمالي الديون" value={formatIQD(ledger.reduce((a, l) => a + Math.max(0, l.debt), 0))} warn />
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-slate-950/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          دفتر حسابات الموردين
        </div>
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-900/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2">المورد</th>
              <th className="px-3 py-2">عدد الفواتير</th>
              <th className="px-3 py-2">اجمالي الشراء</th>
              <th className="px-3 py-2">اجمالي المرتجع</th>
              <th className="px-3 py-2">اجمالي المدفوع</th>
              <th className="px-3 py-2">الديون الحالية</th>
              <th className="px-3 py-2 w-56">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {ledger.map((l) => (
              <tr key={l.supplier.id} className="hover:bg-slate-800/40">
                <td className="px-3 py-2 font-medium">{l.supplier.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.count}</td>
                <td className="px-3 py-2 font-mono text-emerald">{formatIQD(l.totalPur)}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{formatIQD(l.returns)}</td>
                <td className="px-3 py-2 font-mono">{formatIQD(l.paid)}</td>
                <td className={`px-3 py-2 font-mono font-bold ${l.debt > 0 ? "text-destructive" : "text-emerald"}`}>
                  {formatIQD(Math.max(0, l.debt))}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => setStatementFor(l.supplier)}
                      className="px-2 py-1 rounded bg-sky-500/15 border border-sky-500/40 text-sky-300 text-[10px] font-bold hover:bg-sky-500/25">
                      كشف حساب
                    </button>
                    <button onClick={() => setSettleFor(l.supplier)}
                      className="px-2 py-1 rounded bg-emerald text-primary-foreground text-[10px] font-bold hover:brightness-110">
                      تسديد دفعة
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-xs">لا يوجد موردون مسجلون.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {statementFor && (
        <StatementModal supplier={statementFor} invoices={invoices.filter((i) => i.supplier_id === statementFor.id)}
          onClose={() => setStatementFor(null)} />
      )}
      {settleFor && (
        <SettlementModal supplier={settleFor}
          invoices={invoices.filter((i) => i.supplier_id === settleFor.id && Number(i.total || 0) > Number(i.paid_amount || 0))}
          onClose={() => setSettleFor(null)}
          onSettled={async () => { await reloadInvoices(); }} />
      )}
    </div>
  );
}

function StatementModal({ supplier, invoices, onClose }: { supplier: Supplier; invoices: PurInv[]; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = invoices.filter((i) => {
    if (from && i.created_at < from) return false;
    if (to && i.created_at > to + "T23:59:59") return false;
    return true;
  }).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const total = filtered.reduce((a, i) => a + Number(i.total || 0), 0);
  const paid = filtered.reduce((a, i) => a + Number(i.paid_amount || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-border rounded-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-emerald">كشف حساب — {supplier.name}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="text-[10px] uppercase text-muted-foreground block">من تاريخ</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="bg-slate-800 border border-border rounded px-2 py-1 font-mono" />
          </label>
          <label className="text-xs">
            <span className="text-[10px] uppercase text-muted-foreground block">الى تاريخ</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="bg-slate-800 border border-border rounded px-2 py-1 font-mono" />
          </label>
          <div className="flex-1" />
          <div className="text-xs text-muted-foreground">
            الإجمالي: <span className="font-mono text-emerald font-bold">{formatIQD(total)}</span>
            {" · "}المدفوع: <span className="font-mono text-emerald font-bold">{formatIQD(paid)}</span>
            {" · "}الرصيد: <span className="font-mono text-destructive font-bold">{formatIQD(total - paid)}</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">الفاتورة</th>
                <th className="px-3 py-2">الإجمالي</th>
                <th className="px-3 py-2">المدفوع</th>
                <th className="px-3 py-2">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((i) => {
                const remain = Number(i.total || 0) - Number(i.paid_amount || 0);
                const paidFull = remain <= 0;
                return (
                  <tr key={i.id} className={paidFull ? "bg-emerald/10" : ""}>
                    <td className="px-3 py-2 text-xs font-mono">{i.created_at.slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono text-emerald">PO-{i.invoice_no}</td>
                    <td className="px-3 py-2 font-mono">{formatIQD(Number(i.total || 0))}</td>
                    <td className="px-3 py-2 font-mono">{formatIQD(Number(i.paid_amount || 0))}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                        paidFull
                          ? "bg-emerald/20 border-emerald/40 text-emerald"
                          : "bg-destructive/20 border-destructive/40 text-destructive"}`}>
                        {paidFull ? "مدفوعة" : "غير مسددة"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">لا توجد فواتير للفترة المحددة.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SettlementModal({ supplier, invoices, onClose, onSettled }: {
  supplier: Supplier; invoices: PurInv[]; onClose: () => void; onSettled: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discountAmt, setDiscountAmt] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const [accountId, setAccountId] = useState<string>("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("accounts").select("id,name").eq("type", "cashbox").order("name")
      .then(({ data }) => {
        setAccounts((data ?? []) as { id: string; name: string }[]);
        if (data && data.length && !accountId) setAccountId((data[0] as { id: string }).id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = (i: PurInv) => Number(i.total || 0) - Number(i.paid_amount || 0);
  const gross = invoices.filter((i) => selected.has(i.id)).reduce((a, i) => a + remaining(i), 0);
  const totalDiscount = Number(discountAmt || 0) + gross * (Number(discountPct || 0) / 100);
  const net = Math.max(0, gross - totalDiscount);

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  const confirm = async () => {
    if (selected.size === 0) return toast.error("اختر فاتورة واحدة على الأقل");
    setSaving(true);
    try {
      // Mark invoices as paid (paid_amount = total)
      const targets = invoices.filter((i) => selected.has(i.id));
      for (const inv of targets) {
        await supabase.from("purchase_invoices")
          .update({ paid_amount: Number(inv.total || 0), status: "paid" })
          .eq("id", inv.id);
      }
      // Ledger entry (cash out)
      if (accountId) {
        await supabase.from("account_transactions").insert({
          account_id: accountId,
          entry_type: "expense",
          amount: net,
          iqd_equivalent: net,
          currency: "IQD",
          entry_date: new Date().toISOString().slice(0, 10),
          reference: `SETTLE-${supplier.name}`,
          description: `تسديد ${selected.size} فاتورة للمورد ${supplier.name}`,
        });
      }
      toast.success(`تم تسديد ${selected.size} فاتورة بمبلغ ${formatIQD(net)}`);
      onSettled();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل التسديد");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-border rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-emerald">تسديد دفعة — {supplier.name}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2 w-10"></th>
                <th className="px-3 py-2">الفاتورة</th>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">الإجمالي</th>
                <th className="px-3 py-2">المتبقي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {invoices.map((i) => {
                const sel = selected.has(i.id);
                return (
                  <tr key={i.id} className={sel ? "bg-emerald/15" : "hover:bg-slate-800/40"}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={sel} onChange={() => toggle(i.id)}
                        className="size-4 accent-emerald cursor-pointer" />
                    </td>
                    <td className="px-3 py-2 font-mono text-emerald">PO-{i.invoice_no}</td>
                    <td className="px-3 py-2 text-xs font-mono">{i.created_at.slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono">{formatIQD(Number(i.total || 0))}</td>
                    <td className="px-3 py-2 font-mono text-destructive font-bold">{formatIQD(remaining(i))}</td>
                  </tr>
                );
              })}
              {invoices.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">لا توجد فواتير غير مسددة لهذا المورد.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border p-4 bg-slate-950/50 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="text-xs">
              <span className="text-[10px] uppercase text-muted-foreground block mb-1">سماح (خصم مبلغ)</span>
              <input type="number" min={0} value={discountAmt}
                onChange={(e) => setDiscountAmt(Number(e.target.value) || 0)}
                className="w-full bg-slate-800 border border-border rounded px-2 py-1 font-mono" />
            </label>
            <label className="text-xs">
              <span className="text-[10px] uppercase text-muted-foreground block mb-1">نسبة خصم %</span>
              <input type="number" min={0} max={100} value={discountPct}
                onChange={(e) => setDiscountPct(Number(e.target.value) || 0)}
                className="w-full bg-slate-800 border border-border rounded px-2 py-1 font-mono" />
            </label>
            <label className="text-xs col-span-2">
              <span className="text-[10px] uppercase text-muted-foreground block mb-1">صندوق الصيدلية</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                className="w-full bg-slate-800 border border-border rounded px-2 py-1">
                <option value="">— اختر صندوقاً —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="border border-border rounded-lg p-2 bg-slate-800/40">
              <p className="text-[10px] text-muted-foreground">قيمة الفواتير</p>
              <p className="font-mono font-bold text-emerald text-sm mt-0.5">{formatIQD(gross)}</p>
            </div>
            <div className="border border-border rounded-lg p-2 bg-slate-800/40">
              <p className="text-[10px] text-muted-foreground">إجمالي الخصم</p>
              <p className="font-mono font-bold text-amber-300 text-sm mt-0.5">{formatIQD(totalDiscount)}</p>
            </div>
            <div className="border border-emerald/40 rounded-lg p-2 bg-emerald/10">
              <p className="text-[10px] text-emerald">القيمة المقترحة الكلية للدفعة</p>
              <p className="font-mono font-bold text-emerald text-base mt-0.5">{formatIQD(net)}</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-4 py-2 rounded bg-slate-800 border border-border text-xs">إلغاء</button>
            <button onClick={confirm} disabled={saving || selected.size === 0}
              className="px-6 py-2 rounded bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
              {saving ? "جاري الحفظ…" : "تأكيد التسديد"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
