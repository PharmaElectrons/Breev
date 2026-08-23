import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useSettings, updateSettings, updateFlag, updateBranch, updateInvoiceRounding, type FlagKey } from "@/lib/settings";
import { useBranding, setBranding, BRANDING_ADMIN_PASSWORD } from "@/lib/branding";
import { useQuickAccess, addQuickAccess, removeQuickAccess } from "@/lib/quick-access";
import { listMedicines, type Medicine } from "@/lib/db";
import { fuzzyFilter } from "@/lib/fuzzy";



export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات — Breef Pharmacy" },
      { name: "description", content: "الإعدادات العامة للنظام: الألوان الذكية، التنبيهات، الطباعة." },
    ],
  }),
  component: SettingsPage,
});

const LEGACY_PRESETS = [
  { label: "عنبر دافئ", value: "#FDE68A" },
  { label: "برتقالي", value: "#FDBA74" },
  { label: "وردي", value: "#FBCFE8" },
  { label: "أخضر ليموني", value: "#BEF264" },
  { label: "أحمر ناعم", value: "#FCA5A5" },
];

const FLAG_META: { key: FlagKey; title: string; desc: string }[] = [
  { key: "loss", title: "خسارة سعرية (أحمر)", desc: "يُفعّل عندما يكون سعر الشراء أعلى من سعر البيع." },
  { key: "needsBarcode", title: "تحتاج طباعة باركود (برتقالي)", desc: "المواد بدون باركود أو المُعلَّمة #needs-barcode في الملاحظات." },
  { key: "expired", title: "منتهية الصلاحية (أخضر)", desc: "مادة تجاوز تاريخ صلاحيتها اليوم الحالي." },
  { key: "frozen", title: "مجمدة لصالح الأقرب انتهاءً (بنفسجي)", desc: "يوجد بديل بنفس الاسم العلمي بصلاحية أقرب — يُنصح تجميد هذه." },
  { key: "cold", title: "تُخزَّن في البراد (رصاصي)", desc: "المواد التي تحتوي ملاحظتها كلمة “براد” أو #cold." },
];

function SettingsPage() {
  const settings = useSettings();
  const branding = useBranding();
  return (
    <AppShell title="الإعدادات">
      <div className="flex-1 overflow-auto p-8 animate-reveal">
        <div className="max-w-4xl mx-auto space-y-8">
          <header>
            <p className="text-[10px] text-emerald font-bold uppercase tracking-widest">إعدادات النظام</p>
            <h2 className="text-2xl font-bold mt-1">تخصيص {branding.name}</h2>
          </header>


          <section className="bg-card border border-border rounded-2xl p-6 space-y-5">
            <div>
              <h3 className="font-bold text-sm">نظام الألوان الذكي</h3>
              <p className="text-xs text-muted-foreground mt-1">
                تُطبَّق هذه الألوان تلقائياً على صفوف المخزن وشاشة البيع لتنبيه الصيدلي بحالات المواد الحرجة.
              </p>
            </div>

            <div className="space-y-3">
              {FLAG_META.map((f) => {
                const rule = settings.flags[f.key];
                return (
                  <div key={f.key} className="border border-border rounded-xl p-4 flex items-center gap-4">
                    <span
                      className="size-10 rounded-lg border border-border shrink-0"
                      style={{ backgroundColor: rule.color }}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-bold">{f.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                    </div>
                    <input
                      type="color"
                      value={rule.color}
                      onChange={(e) => updateFlag(f.key, { color: e.target.value })}
                      className="size-9 rounded-lg border border-border cursor-pointer bg-transparent"
                    />
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => updateFlag(f.key, { enabled: e.target.checked })}
                      />
                      مفعّل
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div>
              <h3 className="font-bold text-sm">لون تمييز مواد الشراء بدون باركود (قديم)</h3>
              <p className="text-xs text-muted-foreground mt-1">يُستخدم في شاشة فاتورة الشراء فقط.</p>
            </div>
            <div className="flex gap-3 items-center flex-wrap">
              {LEGACY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => updateSettings({ missingBarcodeColor: p.value })}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border ${
                    settings.missingBarcodeColor === p.value
                      ? "border-emerald ring-2 ring-emerald/30"
                      : "border-border hover:border-emerald/40"
                  }`}
                >
                  <span className="size-10 rounded-lg border border-border" style={{ backgroundColor: p.value }} />
                  <span className="text-[10px] font-bold">{p.label}</span>
                </button>
              ))}
              <label className="flex flex-col items-center gap-1.5 p-2 rounded-lg border border-dashed border-border cursor-pointer">
                <input
                  type="color"
                  value={settings.missingBarcodeColor}
                  onChange={(e) => updateSettings({ missingBarcodeColor: e.target.value })}
                  className="size-10 rounded-lg border border-border cursor-pointer bg-transparent"
                />
                <span className="text-[10px] font-bold">مخصص</span>
              </label>
            </div>
          </section>

          <BranchSection />
          <InvoiceRoundingSection />
          <QuickAccessSection />
          <BrandingSection />

        </div>
      </div>
    </AppShell>
  );
}

function BrandingSection() {
  const branding = useBranding();
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(branding.name);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tryUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw === BRANDING_ADMIN_PASSWORD) {
      setUnlocked(true);
      setErr(null);
      setPw("");
      setName(branding.name);
    } else {
      setErr("Access Denied");
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 512 * 1024) {
      setMsg("الشعار كبير جداً — الحد الأقصى 512KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBranding({ logoDataUrl: String(reader.result) });
      setMsg("تم تحديث الشعار");
    };
    reader.readAsDataURL(f);
  };

  const save = () => {
    const clean = name.trim();
    if (!clean) {
      setMsg("اسم الصيدلية مطلوب");
      return;
    }
    setBranding({ name: clean });
    setMsg("تم الحفظ");
  };

  if (!unlocked) {
    return (
      <section className="bg-card border border-border rounded-2xl p-6 space-y-3">
        <details>
          <summary className="cursor-pointer text-xs font-bold text-muted-foreground/60 hover:text-muted-foreground select-none">
            ⚙︎ إعدادات إدارية
          </summary>
          <form onSubmit={tryUnlock} className="mt-4 flex items-end gap-2 max-w-md">
            <label className="flex-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                كلمة مرور المسؤول
              </span>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
                dir="ltr"
                autoComplete="off"
              />
            </label>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald text-primary-foreground rounded-lg text-xs font-bold hover:brightness-110"
            >
              دخول
            </button>
          </form>
          {err && <p className="text-xs text-red-400 mt-2 font-bold">{err}</p>}
        </details>
      </section>
    );
  }

  return (
    <section className="bg-card border border-emerald/40 rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-emerald">إعدادات الهوية (Branding)</h3>
          <p className="text-xs text-muted-foreground mt-1">
            تحديث اسم الصيدلية وشعارها يظهر تلقائياً في الشريط العلوي، شاشة الدخول، الفواتير المطبوعة، وعنوان المتصفح.
          </p>
        </div>
        <button
          onClick={() => setUnlocked(false)}
          className="text-[10px] font-bold text-muted-foreground hover:text-foreground"
        >
          قفل ↩
        </button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-6 items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="size-24 rounded-2xl border border-border bg-slate-800 grid place-items-center overflow-hidden">
            {branding.logoDataUrl ? (
              <img src={branding.logoDataUrl} alt="logo" className="size-full object-contain" />
            ) : (
              <span className="text-[10px] text-muted-foreground">لا يوجد شعار</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="text-[10px] font-bold px-3 py-1 rounded-md bg-slate-800 border border-border hover:border-emerald/40"
          >
            رفع شعار
          </button>
          {branding.logoDataUrl && (
            <button
              onClick={() => setBranding({ logoDataUrl: null })}
              className="text-[10px] text-red-400 hover:underline"
            >
              حذف الشعار
            </button>
          )}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              اسم الصيدلية
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
            />
          </label>
          <button
            onClick={save}
            className="px-4 py-2 bg-emerald text-primary-foreground rounded-lg text-xs font-bold hover:brightness-110"
          >
            حفظ الاسم
          </button>
          {msg && <p className="text-xs text-emerald font-bold">{msg}</p>}
        </div>
      </div>
    </section>
  );
}

function QuickAccessSection() {
  const ids = useQuickAccess();
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { listMedicines().then(setMeds).catch(() => setMeds([])); }, []);
  const results = useMemo(
    () =>
      fuzzyFilter(
        q,
        meds.filter((m) => !ids.includes(m.id)),
        (m) => [m.trade_name, m.scientific_name || "", (m as any).company || "", m.barcode || ""],
        { limit: 20 },
      ),
    [q, meds, ids],
  );
  const selected = ids
    .map((id) => meds.find((m) => m.id === id))
    .filter((m): m is Medicine => !!m);
  return (
    <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <div>
        <h3 className="font-bold text-sm">⚡ مواد الوصول السريع</h3>
        <p className="text-xs text-muted-foreground mt-1">
          عرّف المواد الأكثر مبيعاً (بنادول، حقن، لصقات…) لعرضها في لوحة الوصول السريع داخل واجهة البيع بضغطة واحدة.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">إضافة مادة</p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم التجاري / العلمي / الباركود…"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
          <div className="max-h-64 overflow-auto border border-border rounded-lg">
            {results.length === 0 ? (
              <p className="p-3 text-[11px] text-muted-foreground">لا توجد نتائج</p>
            ) : (
              results.map(({ item: m }) => (
                <button
                  key={m.id}
                  onClick={() => addQuickAccess(m.id)}
                  className="w-full text-right px-3 py-2 text-xs hover:bg-yellow-soft border-b border-border/50 last:border-0"
                >
                  {m.trade_name} <span className="text-muted-foreground">— {m.scientific_name}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            المواد المُعرَّفة ({selected.length})
          </p>
          <div className="max-h-72 overflow-auto border border-border rounded-lg">
            {selected.length === 0 ? (
              <p className="p-3 text-[11px] text-muted-foreground">لا توجد مواد مُعرَّفة بعد.</p>
            ) : (
              selected.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between px-3 py-2 text-xs border-b border-border/50 last:border-0"
                >
                  <span>{m.trade_name}</span>
                  <button
                    onClick={() => removeQuickAccess(m.id)}
                    className="text-red-500 hover:text-red-600 text-[11px] font-bold"
                  >
                    حذف
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function BranchSection() {
  const { branch } = useSettings();
  return (
    <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <div>
        <h3 className="font-bold text-sm">🏬 بيانات الفرع</h3>
        <p className="text-xs text-muted-foreground mt-1">
          تظهر في ترويسة الفواتير المطبوعة، رسائل واتساب، والبريد الرسمي.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">اسم الفرع</span>
          <input
            value={branch.name}
            onChange={(e) => updateBranch({ name: e.target.value })}
            className="mt-1 w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">رقم الهاتف</span>
          <input
            value={branch.phone}
            onChange={(e) => updateBranch({ phone: e.target.value })}
            className="mt-1 w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
            dir="ltr"
            placeholder="9647..."
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">العنوان</span>
          <input
            value={branch.address}
            onChange={(e) => updateBranch({ address: e.target.value })}
            className="mt-1 w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
            placeholder="بغداد — ..."
          />
        </label>
      </div>
    </section>
  );
}

function InvoiceRoundingSection() {
  const { invoiceRounding: r } = useSettings();
  const presets = [100, 250, 500, 1000];
  return (
    <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm">🧮 تقريب مجموع الفاتورة</h3>
          <p className="text-xs text-muted-foreground mt-1">
            يُطبَّق تلقائياً على الإجمالي النهائي في فواتير البيع والشراء.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => updateInvoiceRounding({ enabled: e.target.checked })}
          />
          مفعّل
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">التقريب إلى أقرب</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => updateInvoiceRounding({ nearest: p })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  r.nearest === p
                    ? "border-emerald bg-emerald/10 text-emerald"
                    : "border-border bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.toLocaleString()} د.ع
              </button>
            ))}
            <input
              type="number"
              value={r.nearest}
              onChange={(e) => updateInvoiceRounding({ nearest: Number(e.target.value) || 0 })}
              className="w-24 bg-muted border border-border rounded-lg px-2 py-1.5 text-xs text-center font-mono"
            />
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">أسلوب التقريب</p>
          <div className="flex gap-2">
            {(["nearest", "up", "down"] as const).map((m) => (
              <button
                key={m}
                onClick={() => updateInvoiceRounding({ mode: m })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  r.mode === m
                    ? "border-emerald bg-emerald/10 text-emerald"
                    : "border-border bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "nearest" ? "الأقرب" : m === "up" ? "لأعلى" : "لأدنى"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}



