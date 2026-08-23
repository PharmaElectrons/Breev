// Add New Material — inline toggleable panel (previously a modal).
// The pharmacist fills flexible fields; the "Full Display Name" (trade_name)
// is generated in real time by concatenating non-empty fields with a single
// space. The dedicated Arabic Name is stored on scientific_name so it flows
// into the global fuzzy-search index alongside trade_name and barcode.
import { useMemo, useState } from "react";
import { X, Sparkles } from "lucide-react";

export type AddMaterialSeed = {
  trade_name: string;      // full concatenated display name
  scientific_name: string; // Arabic name (indexed for search)
  company: string;
  category: string;
  dosage_form: string;
  strength: string;        // size / volume
};

type Fields = {
  company: string;
  english: string;   // English name OR uses / attributes
  arabic: string;    // Arabic name OR use / action
  size: string;      // size / volume / specifications
  form: string;      // material / form / type
  color: string;
  category: string;
};

const empty: Fields = { company: "", english: "", arabic: "", size: "", form: "", color: "", category: "" };

/** Concatenate non-empty NON-ARABIC identifying fields with a single space.
 *  Order: company → english → size → color → form.
 *  Arabic name is deliberately excluded — it is a search-only alias. */
function buildFullName(f: Fields): string {
  return [f.company, f.english, f.size, f.color, f.form]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

export function AddMaterialPanel({
  onCancel,
  onConfirm,
  categories,
}: {
  onCancel: () => void;
  onConfirm: (seed: AddMaterialSeed) => void;
  categories: string[];
}) {
  const [f, setF] = useState<Fields>(empty);
  const fullName = useMemo(() => buildFullName(f), [f]);

  const set = <K extends keyof Fields>(k: K, v: string) => setF((s) => ({ ...s, [k]: v }));

  const confirm = () => {
    const name = fullName.trim();
    if (!name) return;
    onConfirm({
      trade_name: name,
      scientific_name: f.arabic.trim() || name,
      company: f.company.trim(),
      category: f.category.trim(),
      dosage_form: f.form.trim(),
      strength: f.size.trim(),
    });
    setF(empty);
  };

  const cancel = () => {
    setF(empty);
    onCancel();
  };

  const inCx =
    "w-full bg-slate-800 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-emerald/40";

  return (
    <div className="rounded-xl border border-emerald/30 bg-slate-950/60" dir="rtl">
      {/* Header */}
      <header className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-emerald" />
          <h2 className="text-sm font-bold">إضافة مادة جديدة — لوحة ذكية</h2>
        </div>
        <button
          onClick={cancel}
          className="size-7 grid place-items-center rounded-md hover:bg-slate-800 text-muted-foreground"
          title="إغلاق اللوحة والعودة"
        >
          <X className="size-4" />
        </button>
      </header>

      {/* Live Full Display Name */}
      <section className="p-3 border-b border-border bg-emerald/5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald mb-1">
          اسم المادة الكامل
        </p>
        <div className="min-h-9 rounded-md bg-slate-900 border border-emerald/40 px-3 py-2 text-sm font-bold text-emerald-200 truncate">
          {fullName || <span className="text-muted-foreground font-normal">— يُبنى تلقائياً أثناء الكتابة —</span>}
        </div>

        {/* Arabic name — indexed for smart fuzzy search */}
        <div className="mt-2">
          <label className="text-[10px] font-bold text-muted-foreground block mb-1">
            الاسم بالعربي أو العمل <span className="text-emerald">(مفهرس للبحث الذكي)</span>
          </label>
          <input
            value={f.arabic}
            onChange={(e) => set("arabic", e.target.value)}
            placeholder="اكتب الاسم العربي أو الاستخدام..."
            className={inCx}
            autoFocus
          />
        </div>
      </section>

      {/* Flexible identifying fields — Color kept strictly BEFORE Form */}
      <section className="p-3 grid grid-cols-2 gap-2.5">
        <Field label="اسم الشركة / الماركة">
          <input value={f.company} onChange={(e) => set("company", e.target.value)} className={inCx} />
        </Field>
        <Field label="الاسم بالإنكليزي أو الاستخدام">
          <input value={f.english} onChange={(e) => set("english", e.target.value)} className={inCx} />
        </Field>
        <Field label="الحجم / المواصفات">
          <input value={f.size} onChange={(e) => set("size", e.target.value)} placeholder="500mg, 100ml..." className={inCx} />
        </Field>
        <Field label="اللون">
          <input value={f.color} onChange={(e) => set("color", e.target.value)} className={inCx} />
        </Field>
        <Field label="الشكل أو المادة المصنعة">
          <input value={f.form} onChange={(e) => set("form", e.target.value)} placeholder="tablet, syrup..." className={inCx} />
        </Field>
        <Field label="التصنيف">
          <select value={f.category} onChange={(e) => set("category", e.target.value)} className={inCx}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </section>

      {/* Footer */}
      <footer className="flex items-center justify-between gap-2 p-3 border-t border-border bg-slate-900/40">
        <p className="text-[10px] text-muted-foreground">
          ستكمل الأسعار والمخزون والباركود من الواجهة الرئيسية بعد المتابعة.
        </p>
        <div className="flex gap-2">
          <button
            onClick={cancel}
            className="px-3 py-1.5 rounded-md bg-slate-800 border border-border text-xs hover:border-destructive/50 hover:text-destructive"
          >
            إلغاء
          </button>
          <button
            onClick={confirm}
            disabled={!fullName.trim()}
            className="px-4 py-1.5 rounded-md bg-emerald text-primary-foreground text-xs font-bold disabled:opacity-40"
          >
            متابعة →
          </button>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-muted-foreground block mb-1">{label}</span>
      {children}
    </label>
  );
}
