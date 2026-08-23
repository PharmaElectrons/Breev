import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatIQD } from "@/lib/pharmacy";
import { useI18n } from "@/lib/i18n";
import {
  Plus,
  Trash2,
  FileText,
  Minus,
  AlertTriangle,
  BellRing,
  Search,
} from "lucide-react";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  default_discount_pct: number;
  credit_limit: number;
  payment_terms: string;
  due_period_days: number;
};

type Inv = {
  id: string;
  invoice_no: number;
  supplier_id: string | null;
  total: number;
  paid_amount: number;
  payment_type: string;
  status: string;
  created_at: string;
};

const empty = (name = ""): Partial<Supplier> => ({
  name,
  phone: "",
  address: "",
  default_discount_pct: 0,
  credit_limit: 0,
  payment_terms: "credit",
  due_period_days: 30,
});

export function SuppliersWorkspace() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const T = (ar: string, en: string) => (isAr ? ar : en);

  const [rows, setRows] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Partial<Supplier>>(empty());
  const [statementOpen, setStatementOpen] = useState(false);
  const [dueWindow, setDueWindow] = useState(7);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [s, i] = await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      supabase
        .from("purchase_invoices")
        .select("id, invoice_no, supplier_id, total, paid_amount, payment_type, status, created_at")
        .order("created_at", { ascending: false }),
    ]);
    setRows((s.data ?? []) as Supplier[]);
    setInvoices((i.data ?? []) as Inv[]);
  };

  useEffect(() => {
    load();
  }, []);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  useEffect(() => {
    if (selected) setForm(selected);
    else setForm(empty());
  }, [selected]);

  const supplierInvoices = useMemo(
    () => invoices.filter((v) => v.supplier_id === selectedId),
    [invoices, selectedId],
  );

  const balanceFor = (id: string) =>
    invoices
      .filter((v) => v.supplier_id === id)
      .reduce((sum, v) => sum + (Number(v.total) - Number(v.paid_amount || 0)), 0);

  const liveBalance = selected ? balanceFor(selected.id) : 0;

  const upcomingDue = useMemo(() => {
    if (!selected) return [];
    const days = selected.due_period_days || 30;
    const alertBefore = dueWindow;
    const now = Date.now();
    return supplierInvoices
      .filter((v) => Number(v.total) - Number(v.paid_amount || 0) > 0)
      .map((v) => {
        const created = new Date(v.created_at).getTime();
        const dueTs = created + days * 86400000;
        const remaining = Math.round((dueTs - now) / 86400000);
        return { inv: v, remaining, dueTs };
      })
      .filter((x) => x.remaining <= alertBefore)
      .sort((a, b) => a.remaining - b.remaining);
  }, [supplierInvoices, selected, dueWindow]);

  const overLimit =
    selected && selected.credit_limit > 0 && liveBalance > selected.credit_limit;

  const filtered = rows.filter(
    (r) =>
      !query.trim() ||
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      (r.phone || "").includes(query),
  );

  const save = async () => {
    if (!form.name?.trim()) return;
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      phone: form.phone || null,
      address: form.address || null,
      default_discount_pct: Number(form.default_discount_pct) || 0,
      credit_limit: Number(form.credit_limit) || 0,
      payment_terms: form.payment_terms || "credit",
      due_period_days: Number(form.due_period_days) || 30,
    };
    if (selectedId) {
      await supabase.from("suppliers").update(payload).eq("id", selectedId);
    } else {
      const { data } = await supabase.from("suppliers").insert(payload).select("*").single();
      if (data) setSelectedId((data as Supplier).id);
    }
    await load();
    setBusy(false);
  };

  const addNew = () => {
    setSelectedId(null);
    setForm(empty(T("مذخر جديد", "New supplier")));
  };

  const remove = async () => {
    if (!selectedId) return;
    if (!confirm(T("حذف هذا المذخر نهائياً؟", "Delete this supplier permanently?"))) return;
    await supabase.from("suppliers").delete().eq("id", selectedId);
    setSelectedId(null);
    await load();
  };

  const adjustDiscount = (delta: number) =>
    setForm((f) => ({
      ...f,
      default_discount_pct: Math.min(100, Math.max(0, (Number(f.default_discount_pct) || 0) + delta)),
    }));

  return (
    <div className="flex-1 flex overflow-hidden" dir={isAr ? "rtl" : "ltr"}>
      {/* Left list */}
      <aside className="w-72 shrink-0 border-l border-border bg-slate-950/60 flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute top-1/2 -translate-y-1/2 right-2 size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={T("🔎 ابحث عن مذخر...", "🔎 Search supplier...")}
              className="w-full bg-slate-800 border border-border rounded-lg pr-8 pl-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {filtered.map((s) => {
            const bal = balanceFor(s.id);
            const isSel = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-right px-3 py-2 border-b border-border/50 transition hover:bg-emerald/10 ${
                  isSel ? "bg-emerald/15 border-r-2 border-r-emerald" : ""
                }`}
              >
                <div className="text-sm font-bold text-foreground truncate">{s.name}</div>
                <div className="flex items-center justify-between text-[10px] mt-0.5">
                  <span className="text-muted-foreground font-mono">{s.phone || "—"}</span>
                  <span
                    className={`font-mono font-bold ${
                      bal > 0 ? "text-destructive" : "text-emerald"
                    }`}
                  >
                    {formatIQD(bal)}
                  </span>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {T("لا مذاخر بعد.", "No suppliers yet.")}
            </p>
          )}
        </div>
      </aside>

      {/* Detail */}
      <section className="flex-1 flex flex-col overflow-hidden">
        {/* Action toolbar */}
        <div className="p-3 border-b border-border bg-slate-950/70 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <IconBtn onClick={addNew} tone="emerald" title={T("إضافة مذخر", "Add supplier")}>
              <Plus className="size-4" />
              <span>{T("إضافة", "Add")}</span>
            </IconBtn>
            <IconBtn
              onClick={remove}
              tone="danger"
              disabled={!selectedId}
              title={T("حذف المذخر", "Delete supplier")}
            >
              <Trash2 className="size-4" />
              <span>{T("حذف", "Delete")}</span>
            </IconBtn>
            <IconBtn
              onClick={() => setStatementOpen(true)}
              tone="accent"
              disabled={!selected}
              title={T("كشف حساب", "Account statement")}
            >
              <FileText className="size-4" />
              <span>{T("كشف حساب", "Statement")}</span>
            </IconBtn>
          </div>
          <button
            onClick={save}
            disabled={busy || !form.name?.trim()}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald text-primary-foreground disabled:opacity-40"
          >
            {busy ? "..." : T("💾 حفظ", "💾 Save")}
          </button>
        </div>

        {/* Alerts */}
        {selected && (overLimit || upcomingDue.length > 0) && (
          <div className="px-4 py-2 border-b border-border bg-slate-900/60 flex flex-wrap gap-2 shrink-0">
            {overLimit && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/15 border border-destructive/40 rounded-lg text-[11px] text-destructive font-bold">
                <AlertTriangle className="size-3.5" />
                {T("تجاوز حد الدين:", "Credit limit exceeded:")} {formatIQD(liveBalance)} /{" "}
                {formatIQD(selected.credit_limit)}
              </div>
            )}
            {upcomingDue.slice(0, 3).map((d) => (
              <div
                key={d.inv.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold border ${
                  d.remaining < 0
                    ? "bg-destructive/15 border-destructive/40 text-destructive"
                    : "bg-accent/15 border-accent/40 text-accent"
                }`}
              >
                <BellRing className="size-3.5" />
                {T("فاتورة", "Invoice")} #{d.inv.invoice_no} —{" "}
                {d.remaining < 0
                  ? T(`متأخرة ${-d.remaining} يوم`, `${-d.remaining}d overdue`)
                  : T(`مستحقة خلال ${d.remaining} يوم`, `Due in ${d.remaining}d`)}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 grid grid-cols-3 gap-4">
          {/* Profile */}
          <div className="col-span-2 bg-slate-900/50 border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-emerald mb-2">
              {T("بيانات المذخر", "Supplier profile")}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={T("اسم المذخر", "Supplier name")}>
                <input
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label={T("رقم الهاتف", "Phone")}>
                <input
                  value={form.phone ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label={T("الموقع / العنوان", "Location / address")}>
                <input
                  value={form.address ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label={T("طريقة الدفع الافتراضية", "Default payment terms")}>
                <select
                  value={form.payment_terms ?? "credit"}
                  onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))}
                  className={inputCls}
                >
                  <option value="credit">{T("آجل", "Credit / Deferred")}</option>
                  <option value="cash">{T("نقدي", "Cash")}</option>
                </select>
              </Field>
              <Field label={T("نسبة الخصم الافتراضية %", "Default discount %")}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => adjustDiscount(-0.5)}
                    className="size-8 grid place-items-center bg-slate-800 border border-border rounded-lg hover:bg-destructive/20 hover:text-destructive"
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={form.default_discount_pct ?? 0}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, default_discount_pct: Number(e.target.value) || 0 }))
                    }
                    className={`${inputCls} text-center font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => adjustDiscount(0.5)}
                    className="size-8 grid place-items-center bg-slate-800 border border-border rounded-lg hover:bg-emerald/20 hover:text-emerald"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </Field>
              <Field label={T("حد الدين الأقصى (د.ع)", "Max credit limit (IQD)")}>
                <input
                  type="number"
                  min={0}
                  value={form.credit_limit ?? 0}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, credit_limit: Number(e.target.value) || 0 }))
                  }
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <Field label={T("فترة الاستحقاق (يوم)", "Due period (days)")}>
                <input
                  type="number"
                  min={1}
                  value={form.due_period_days ?? 30}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, due_period_days: Number(e.target.value) || 30 }))
                  }
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <Field label={T("نافذة تنبيه الاستحقاق (يوم)", "Due alert window (days)")}>
                <input
                  type="number"
                  min={0}
                  value={dueWindow}
                  onChange={(e) => setDueWindow(Number(e.target.value) || 0)}
                  className={`${inputCls} font-mono`}
                />
              </Field>
            </div>
          </div>

          {/* Live balance */}
          <div className="bg-slate-900/50 border border-border rounded-xl p-4 flex flex-col justify-between">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-emerald mb-2">
                {T("ديون المذخر (تلقائية)", "Live balance")}
              </h3>
              <p
                className={`text-4xl font-mono font-bold tabular-nums mt-4 ${
                  liveBalance > 0 ? "text-destructive" : "text-emerald"
                }`}
              >
                {formatIQD(liveBalance)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {T("محسوبة من الشراء والتسديد", "Computed from purchases & payments")}
              </p>
            </div>
            {selected && selected.credit_limit > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>{T("حد الدين", "Credit limit")}</span>
                  <span className="font-mono">{formatIQD(selected.credit_limit)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${overLimit ? "bg-destructive" : "bg-emerald"}`}
                    style={{
                      width: `${Math.min(
                        100,
                        (liveBalance / Math.max(1, selected.credit_limit)) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Transaction ledger */}
          <div className="col-span-3 bg-slate-900/50 border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-emerald">
                {T("تفاصيل حركة الفواتير", "Invoice transaction ledger")}
              </h3>
              <span className="text-[10px] text-muted-foreground font-mono">
                {supplierInvoices.length} {T("فاتورة", "invoices")}
              </span>
            </div>
            <div className="overflow-auto max-h-[38vh] border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-muted-foreground bg-slate-950/60 sticky top-0">
                  <tr>
                    <Th>#</Th>
                    <Th>{T("التاريخ", "Date")}</Th>
                    <Th>{T("طريقة الدفع", "Payment")}</Th>
                    <Th>{T("الحالة", "Status")}</Th>
                    <Th>{T("الإجمالي", "Total")}</Th>
                    <Th>{T("المدفوع", "Paid")}</Th>
                    <Th>{T("المتبقي", "Outstanding")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {supplierInvoices.map((v) => {
                    const outstanding = Number(v.total) - Number(v.paid_amount || 0);
                    return (
                      <tr key={v.id} className="hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-mono">{v.invoice_no}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {new Date(v.created_at).toISOString().slice(0, 10)}
                        </td>
                        <td className="px-3 py-2">
                          {v.payment_type === "cash"
                            ? T("نقدي", "Cash")
                            : T("آجل", "Credit")}
                        </td>
                        <td className="px-3 py-2">{v.status}</td>
                        <td className="px-3 py-2 font-mono text-right">{formatIQD(v.total)}</td>
                        <td className="px-3 py-2 font-mono text-right text-emerald">
                          {formatIQD(v.paid_amount || 0)}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono text-right font-bold ${
                            outstanding > 0 ? "text-destructive" : "text-emerald"
                          }`}
                        >
                          {formatIQD(outstanding)}
                        </td>
                      </tr>
                    );
                  })}
                  {supplierInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        {T("لا حركات لهذا المذخر.", "No transactions yet.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {statementOpen && selected && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm grid place-items-center p-6"
            onClick={() => setStatementOpen(false)}
          >
            <div
              className="bg-slate-900 border border-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              dir={isAr ? "rtl" : "ltr"}
            >
              <header className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-emerald font-bold uppercase tracking-widest">
                    {T("كشف حساب", "Account statement")}
                  </p>
                  <h3 className="text-lg font-bold">{selected.name}</h3>
                </div>
                <button
                  onClick={() => setStatementOpen(false)}
                  className="px-4 py-2 bg-slate-800 border border-border rounded-lg text-xs font-bold"
                >
                  {T("إغلاق", "Close")}
                </button>
              </header>
              <div className="flex-1 overflow-auto p-4">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <SummaryCard
                    label={T("إجمالي المشتريات", "Total purchases")}
                    value={formatIQD(supplierInvoices.reduce((s, v) => s + Number(v.total), 0))}
                    tone="foreground"
                  />
                  <SummaryCard
                    label={T("المدفوع", "Paid")}
                    value={formatIQD(
                      supplierInvoices.reduce((s, v) => s + Number(v.paid_amount || 0), 0),
                    )}
                    tone="emerald"
                  />
                  <SummaryCard
                    label={T("الرصيد المتبقي", "Outstanding balance")}
                    value={formatIQD(liveBalance)}
                    tone={liveBalance > 0 ? "danger" : "emerald"}
                  />
                </div>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase text-muted-foreground bg-slate-950/60">
                    <tr>
                      <Th>{T("التاريخ", "Date")}</Th>
                      <Th>#</Th>
                      <Th>{T("مدين", "Debit")}</Th>
                      <Th>{T("دائن", "Credit")}</Th>
                      <Th>{T("الرصيد", "Balance")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {(() => {
                      let running = 0;
                      const ordered = [...supplierInvoices].sort(
                        (a, b) =>
                          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                      );
                      return ordered.map((v) => {
                        const debit = Number(v.total);
                        const credit = Number(v.paid_amount || 0);
                        running += debit - credit;
                        return (
                          <tr key={v.id}>
                            <td className="px-3 py-2 font-mono text-[11px]">
                              {new Date(v.created_at).toISOString().slice(0, 10)}
                            </td>
                            <td className="px-3 py-2 font-mono">{v.invoice_no}</td>
                            <td className="px-3 py-2 font-mono text-right text-destructive">
                              {formatIQD(debit)}
                            </td>
                            <td className="px-3 py-2 font-mono text-right text-emerald">
                              {formatIQD(credit)}
                            </td>
                            <td className="px-3 py-2 font-mono text-right font-bold">
                              {formatIQD(running)}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const inputCls =
  "w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-right">
      {children}
    </th>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  tone,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "emerald" | "danger" | "accent";
  title?: string;
}) {
  const map = {
    emerald: "bg-emerald/15 border-emerald/40 text-emerald hover:bg-emerald/25",
    danger: "bg-destructive/15 border-destructive/40 text-destructive hover:bg-destructive/25",
    accent: "bg-accent/15 border-accent/40 text-accent hover:bg-accent/25",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition disabled:opacity-40 ${map[tone]}`}
    >
      {children}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "foreground" | "emerald" | "danger";
}) {
  const map = {
    foreground: "text-foreground",
    emerald: "text-emerald",
    danger: "text-destructive",
  } as const;
  return (
    <div className="bg-slate-950/60 border border-border rounded-xl p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-mono font-bold text-lg ${map[tone]}`}>{value}</p>
    </div>
  );
}
