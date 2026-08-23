import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowUpDown } from "lucide-react";

const TYPE_MAP: Record<string, string> = {
  "مورد": "supplier",
  "مريض": "customer",
  "عميل": "customer",
  "راس مال": "capital",
  "صندوق": "cash_bank",
  "مصروف": "expense",
  "إيراد": "income",
};

// Reverse map: db type → arabic label used by the workspace filters.
const TYPE_LABEL: Record<string, string> = {
  supplier: "مورد",
  customer: "مريض",
  capital: "راس مال",
  cash_bank: "صندوق",
  expense: "مصروف",
  income: "إيراد",
};

async function findOrCreateAccount(name: string, typeLabel = "مورد"): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const { data: existing, error: findErr } = await supabase
    .from("accounts")
    .select("id")
    .ilike("name", clean)
    .maybeSingle();
  if (findErr) {
    toast.error(`تعذّر البحث عن الحساب: ${findErr.message}`);
    return null;
  }
  if (existing) return existing.id as string;
  const { data, error } = await supabase
    .from("accounts")
    .insert({ name: clean, type: TYPE_MAP[typeLabel] ?? "supplier" })
    .select("id")
    .single();
  if (error) {
    toast.error(`تعذّر إنشاء الحساب: ${error.message}`);
    return null;
  }
  return data.id as string;
}


export const Route = createFileRoute("/accounts")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الحسابات — Breef Pharmacy" },
      { name: "description", content: "لوحة الحسابات: كشوفات، سندات، وإضافة حسابات جديدة." },
    ],
  }),
  component: AccountsPage,
});

type ToolKey =
  | "workspace"
  | "statement"
  | "voucher"
  | "multi_voucher"
  | "add_account"
  | "quick_add"
  | null;

const TOOLS: { key: Exclude<ToolKey, null>; label: string; icon: string; hint: string }[] = [
  { key: "workspace", label: "تبويب الحسابات", icon: "🗂️", hint: "لوحة مركزية موحدة تجمع الموردين والمرضى والصناديق ورأس المال مع فرز تصاعدي وتنازلي." },
  { key: "statement", label: "كشف حساب", icon: "🧾", hint: "استعراض كشف حساب لمورد / عميل / موظف مع الأرصدة المدينة والدائنة." },
  { key: "voucher", label: "انشاء سند / سند", icon: "🧮", hint: "إنشاء سند قبض أو صرف للحساب المختار." },
  { key: "multi_voucher", label: "سند متعدد العملات", icon: "💱", hint: "إنشاء سند بعملات مختلفة مع تحويل تلقائي حسب سعر الصرف." },
  { key: "add_account", label: "تعريف الحسابات", icon: "➕", hint: "معالج تعريف الحسابات: اختر النوع لعرض الحقول المناسبة (خصم، حد ائتماني، أيام استحقاق...)." },
  { key: "quick_add", label: "اضافة سريعة للحسابات", icon: "⚡", hint: "إضافة سريعة متعددة الأسطر لعدة حسابات دفعة واحدة." },
];

function AccountsPage() {
  const [active, setActive] = useState<ToolKey>("workspace");
  const navigate = useNavigate();
  const tool = TOOLS.find((t) => t.key === active);

  return (
    <AppShell title="الحسابات">
      <div className="flex-1 overflow-auto p-6" dir="rtl">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Tool matrix */}
          <div className="border border-border rounded-2xl bg-slate-950/40 p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
              أدوات الحسابات
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {TOOLS.map((b) => {
                const isActive = b.key === active;
                return (
                  <button
                    key={b.key}
                    onClick={() => setActive(b.key)}
                    className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border text-xs font-bold transition active:scale-95 ${
                      isActive
                        ? "bg-emerald text-primary-foreground border-emerald shadow-[0_0_20px_rgba(52,211,153,0.3)]"
                        : "bg-slate-800/70 border-border text-foreground hover:border-emerald/40 hover:bg-emerald/10 hover:text-emerald"
                    }`}
                  >
                    <span className="text-2xl leading-none">{b.icon}</span>
                    <span className="text-center leading-tight">{b.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active tool panel */}
          <div className="border border-emerald/30 rounded-2xl bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-slate-950/60 flex items-center gap-3">
              <span className="text-xl">{tool?.icon}</span>
              <div className="flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald">أداة نشطة</p>
                <h2 className="text-sm font-bold">{tool?.label}</h2>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">{tool?.hint}</p>
              {active === "workspace" && <WorkspacePanel />}
              {active === "statement" && <StatementPanel />}
              {active === "voucher" && <VoucherPanel />}
              {active === "multi_voucher" && <MultiVoucherPanel />}
              {active === "add_account" && <AddAccountPanel />}
              {active === "quick_add" && <QuickAddPanel />}
            </div>
            <div className="px-5 py-4 border-t border-border bg-slate-950/60 flex justify-end">
              <button
                onClick={() => navigate({ to: "/" })}
                className="px-6 py-2.5 rounded-lg bg-slate-800 border border-destructive/40 text-destructive text-xs font-bold hover:bg-destructive/10 active:scale-95 transition"
              >
                خروج
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald/40 focus:border-emerald";

function StatementPanel() {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!name.trim()) return toast.error("أدخل اسم الحساب");
    setBusy(true);
    try {
      const { data: acc, error: accErr } = await supabase
        .from("accounts")
        .select("id,name,type,opening_balance")
        .ilike("name", name.trim())
        .maybeSingle();
      if (accErr) throw accErr;
      if (!acc) return toast.error("لا يوجد حساب بهذا الاسم");
      let q = supabase
        .from("account_entries")
        .select("id,entry_type,amount,currency,iqd_equivalent,entry_date,description")
        .eq("account_id", acc.id as string)
        .order("entry_date", { ascending: true });
      if (from) q = q.gte("entry_date", from);
      if (to) q = q.lte("entry_date", to);
      const { data: rows, error } = await q;
      if (error) throw error;
      const total = (rows ?? []).reduce(
        (s, r) => s + (r.entry_type === "receipt" ? 1 : -1) * Number(r.iqd_equivalent || 0),
        0,
      );
      toast.success(
        `${acc.name}: ${rows?.length ?? 0} حركة — صافي ${total.toLocaleString()} د.ع`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="الحساب">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="اسم الحساب أو الرقم" />
      </Field>
      <Field label="من تاريخ"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
      <Field label="إلى تاريخ"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
      <div className="sm:col-span-3 flex justify-end">
        <button
          onClick={run}
          disabled={busy}
          className="px-5 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "..." : "عرض الكشف"}
        </button>
      </div>
    </div>
  );
}

function VoucherPanel() {
  const [type, setType] = useState("سند قبض");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setType("سند قبض"); setAccount(""); setAmount(""); setDate(""); setDesc("");
  };
  const save = async () => {
    if (!account.trim()) return toast.error("أدخل اسم الحساب");
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    setBusy(true);
    try {
      const accountId = await findOrCreateAccount(account);
      if (!accountId) return;
      const { error } = await supabase.from("account_entries").insert({
        account_id: accountId,
        entry_type: type === "سند قبض" ? "receipt" : "payment",
        amount: amt,
        currency: "IQD",
        exchange_rate: 1,
        iqd_equivalent: amt,
        entry_date: date || new Date().toISOString().slice(0, 10),
        description: desc || null,
      });
      if (error) throw error;
      toast.success("تم حفظ السند");
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="نوع السند">
        <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
          <option>سند قبض</option>
          <option>سند صرف</option>
        </select>
      </Field>
      <Field label="الحساب"><input value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} placeholder="اختر حساباً" /></Field>
      <Field label="المبلغ"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="0" /></Field>
      <Field label="التاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
      <Field label="البيان"><input value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} placeholder="وصف مختصر" /></Field>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button onClick={reset} className="px-4 py-2 rounded-lg bg-slate-800 border border-border text-xs font-bold">إلغاء</button>
        <button onClick={save} disabled={busy} className="px-5 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
          {busy ? "..." : "حفظ السند"}
        </button>
      </div>
    </div>
  );
}

function MultiVoucherPanel() {
  const [account, setAccount] = useState("");
  const [currency, setCurrency] = useState("IQD");
  const [rate, setRate] = useState("1");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const iqd = (Number(amount) || 0) * (Number(rate) || 0);
  const save = async () => {
    if (!account.trim()) return toast.error("أدخل اسم الحساب");
    if (!amount) return toast.error("أدخل المبلغ");
    setBusy(true);
    try {
      const accountId = await findOrCreateAccount(account);
      if (!accountId) return;
      const { error } = await supabase.from("account_entries").insert({
        account_id: accountId,
        entry_type: "receipt",
        amount: Number(amount),
        currency,
        exchange_rate: Number(rate) || 1,
        iqd_equivalent: iqd,
        entry_date: date || new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      toast.success("تم حفظ السند بالعملة");
      setAmount(""); setDate("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="الحساب"><input value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} placeholder="اختر حساباً" /></Field>
      <Field label="العملة">
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
          <option value="IQD">د.ع IQD</option>
          <option value="USD">USD $</option>
          <option value="EUR">EUR €</option>
        </select>
      </Field>
      <Field label="سعر الصرف"><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls} placeholder="1300" /></Field>
      <Field label="المبلغ بالعملة"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="0" /></Field>
      <Field label="المكافئ د.ع"><input type="number" value={String(iqd)} className={inputCls} placeholder="0" disabled /></Field>
      <Field label="التاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
      <div className="sm:col-span-3 flex justify-end">
        <button onClick={save} disabled={busy} className="px-5 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
          {busy ? "..." : "حفظ السند"}
        </button>
      </div>
    </div>
  );
}

function AddAccountPanel() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [typeLabel, setTypeLabel] = useState<"مورد" | "مريض" | "راس مال" | "صندوق">("مورد");
  const [opening, setOpening] = useState("");
  const [notes, setNotes] = useState("");
  // Supplier-only controls
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [creditLimit, setCreditLimit] = useState<string>("");
  const [duePeriod, setDuePeriod] = useState<string>("30");
  const [terms, setTerms] = useState<"credit" | "cash">("credit");
  const [busy, setBusy] = useState(false);

  const showDiscount = typeLabel === "مورد";
  const showDueDate = typeLabel === "مورد"; // hidden for صندوق & مريض per spec

  const save = async () => {
    if (!name.trim()) return toast.error("أدخل اسم الحساب");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type: TYPE_MAP[typeLabel] ?? "supplier",
        opening_balance: Number(opening) || 0,
        notes: notes || null,
        phone: phone || null,
        location: location || null,
      };
      if (showDiscount) payload.default_discount_pct = discountPct;
      if (typeLabel === "مورد") {
        payload.credit_limit = Number(creditLimit) || 0;
        payload.payment_terms = terms;
      }
      if (showDueDate) payload.due_period_days = Number(duePeriod) || 30;
      const { error } = await supabase.from("accounts").insert(payload as never);
      if (error) throw error;
      toast.success("تمت إضافة الحساب");
      setName(""); setOpening(""); setNotes(""); setPhone(""); setLocation("");
      setDiscountPct(0); setCreditLimit(""); setDuePeriod("30");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="الاسم"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
      <Field label="نوع الحساب">
        <select value={typeLabel} onChange={(e) => setTypeLabel(e.target.value as typeof typeLabel)} className={inputCls}>
          <option value="مورد">مورد</option>
          <option value="مريض">مريض</option>
          <option value="راس مال">راس مال</option>
          <option value="صندوق">صندوق</option>
        </select>
      </Field>
      <Field label="الرقم / الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="9647..." /></Field>
      <Field label="الموقع"><input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} /></Field>

      {showDiscount && (
        <Field label="نسبة الخصم الافتراضية %">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDiscountPct((v) => Math.max(0, +(v - 0.5).toFixed(2)))} className="size-9 rounded-lg bg-slate-800 border border-border text-sm font-bold hover:border-emerald/40">−</button>
            <input type="number" step="0.5" value={discountPct} onChange={(e) => setDiscountPct(Number(e.target.value) || 0)} className={`${inputCls} text-center`} />
            <button type="button" onClick={() => setDiscountPct((v) => +(v + 0.5).toFixed(2))} className="size-9 rounded-lg bg-slate-800 border border-border text-sm font-bold hover:border-emerald/40">+</button>
          </div>
        </Field>
      )}

      {typeLabel === "مورد" && (
        <>
          <Field label="حد الائتمان (د.ع)"><input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} className={inputCls} placeholder="0" /></Field>
          <Field label="نوع السداد الافتراضي">
            <select value={terms} onChange={(e) => setTerms(e.target.value as "credit" | "cash")} className={inputCls}>
              <option value="credit">آجل</option>
              <option value="cash">نقدي</option>
            </select>
          </Field>
        </>
      )}
      {showDueDate && (
        <Field label="فترة التنبيه لاستحقاق الدفع (يوم)">
          <input type="number" value={duePeriod} onChange={(e) => setDuePeriod(e.target.value)} className={inputCls} placeholder="30" />
        </Field>
      )}

      <Field label="الرصيد الافتتاحي"><input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} className={inputCls} placeholder="0" /></Field>
      <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
      <div className="sm:col-span-2 flex justify-end">
        <button onClick={save} disabled={busy} className="px-5 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
          {busy ? "..." : "إضافة الحساب"}
        </button>
      </div>
    </div>
  );
}

// Central unified workspace: lists suppliers / patients / cash funds / capital with per-column sorting.
type WsRow = {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  location: string | null;
  opening_balance: number;
  credit_limit: number | null;
  default_discount_pct: number | null;
};
type SortKey = "name" | "phone" | "opening_balance" | "credit_limit";

function WorkspacePanel() {
  const [rows, setRows] = useState<WsRow[]>([]);
  const [filter, setFilter] = useState<"all" | "supplier" | "customer" | "capital" | "cash_bank">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,name,type,phone,location,opening_balance,credit_limit,default_discount_pct");
      if (error) return toast.error(`تعذّر تحميل الحسابات: ${error.message}`);
      setRows(((data ?? []) as WsRow[]));
    })();
  }, []);

  const filtered = useMemo(() => {
    const src = filter === "all" ? rows : rows.filter((r) => r.type === filter);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...src].sort((a, b) => {
      const av = (a[sortKey] ?? "") as string | number;
      const bv = (b[sortKey] ?? "") as string | number;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ar") * dir;
    });
  }, [rows, filter, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const chips: { key: typeof filter; label: string }[] = [
    { key: "all", label: `الكل (${rows.length})` },
    { key: "supplier", label: `الموردون (${rows.filter((r) => r.type === "supplier").length})` },
    { key: "customer", label: `المرضى / العملاء (${rows.filter((r) => r.type === "customer").length})` },
    { key: "capital", label: `رأس المال (${rows.filter((r) => r.type === "capital").length})` },
    { key: "cash_bank", label: `الصناديق (${rows.filter((r) => r.type === "cash_bank").length})` },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition ${
              filter === c.key
                ? "bg-emerald text-primary-foreground border-emerald"
                : "bg-slate-800 border-border text-muted-foreground hover:text-foreground hover:border-emerald/40"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="border border-border rounded-xl overflow-hidden bg-slate-950/40">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <SortHeader onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>الاسم</SortHeader>
                <th className="px-2 py-2">النوع</th>
                <SortHeader onClick={() => toggleSort("phone")} active={sortKey === "phone"} dir={sortDir}>الهاتف</SortHeader>
                <th className="px-2 py-2">الموقع</th>
                <SortHeader onClick={() => toggleSort("opening_balance")} active={sortKey === "opening_balance"} dir={sortDir}>الرصيد الافتتاحي</SortHeader>
                <SortHeader onClick={() => toggleSort("credit_limit")} active={sortKey === "credit_limit"} dir={sortDir}>حد الائتمان</SortHeader>
                <th className="px-2 py-2">خصم %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-emerald/5">
                  <td className="px-2 py-2 font-medium">{r.name}</td>
                  <td className="px-2 py-2">
                    <span className="px-2 py-0.5 rounded-full bg-emerald/10 text-emerald text-[10px] font-bold border border-emerald/30">
                      {TYPE_LABEL[r.type] ?? r.type}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono">{r.phone || "—"}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.location || "—"}</td>
                  <td className="px-2 py-2 font-mono">{Number(r.opening_balance ?? 0).toLocaleString()}</td>
                  <td className="px-2 py-2 font-mono">{r.credit_limit ? Number(r.credit_limit).toLocaleString() : "—"}</td>
                  <td className="px-2 py-2 font-mono">{r.default_discount_pct ?? "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-xs">لا توجد حسابات ضمن هذا التصنيف.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        اضغط على عنوان العمود للفرز تصاعدياً/تنازلياً. أضف حسابات جديدة من تبويب "تعريف الحسابات".
      </p>
    </div>
  );
}

function SortHeader({
  children,
  onClick,
  active,
  dir,
}: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <th className="px-2 py-2">
      <button onClick={onClick} className={`inline-flex items-center gap-1 font-bold ${active ? "text-emerald" : ""}`}>
        {children}
        <ArrowUpDown className={`size-3 transition ${active ? (dir === "asc" ? "" : "rotate-180") : "opacity-40"}`} />
      </button>
    </th>
  );
}

function QuickAddPanel() {
  const [rows, setRows] = useState<{ name: string; type: string; balance: string }[]>(
    Array.from({ length: 5 }, () => ({ name: "", type: "مورد", balance: "" })),
  );
  const [busy, setBusy] = useState(false);
  const saveAll = async () => {
    const payload = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        type: TYPE_MAP[r.type] ?? "supplier",
        opening_balance: Number(r.balance) || 0,
      }));
    if (!payload.length) return toast.error("لا توجد صفوف صالحة");
    setBusy(true);
    try {
      const { error } = await supabase.from("accounts").insert(payload);
      if (error) throw error;
      toast.success(`تمت إضافة ${payload.length} حساباً`);
      setRows(Array.from({ length: 5 }, () => ({ name: "", type: "مورد", balance: "" })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_140px_140px] gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">
        <span>اسم الحساب</span>
        <span>النوع</span>
        <span>الرصيد الافتتاحي</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_140px_140px] gap-2">
          <input
            value={r.name}
            onChange={(e) => setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))}
            className={inputCls}
            placeholder={`حساب ${i + 1}`}
          />
          <select
            value={r.type}
            onChange={(e) => setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, type: e.target.value } : x)))}
            className={inputCls}
          >
            <option>مورد</option>
            <option>عميل</option>
            <option>مصروف</option>
            <option>إيراد</option>
          </select>
          <input
            type="number"
            value={r.balance}
            onChange={(e) => setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, balance: e.target.value } : x)))}
            className={inputCls}
            placeholder="0"
          />
        </div>
      ))}
      <div className="flex justify-between pt-2">
        <button
          onClick={() => setRows((rs) => [...rs, { name: "", type: "مورد", balance: "" }])}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-border text-xs font-bold hover:border-emerald/40 hover:text-emerald"
        >
          + سطر جديد
        </button>
        <button onClick={saveAll} disabled={busy} className="px-5 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
          {busy ? "..." : "حفظ جميع الحسابات"}
        </button>
      </div>
    </div>
  );
}

