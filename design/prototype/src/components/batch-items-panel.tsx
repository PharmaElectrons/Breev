// Batch (multi-item) product definition grid — RTL, keyboard-friendly.
// Pharmaceutical mode shows clinical columns (scientific name, strength, form);
// General items mode hides them and keeps retail columns only.
import { useState } from "react";
import { Plus, Save, X, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createMedicine } from "@/lib/db";
import { priceFromMarginOnSale, roundToNearest500 } from "@/lib/pharmacy";

type Mode = "drug" | "general";

type BatchRow = {
  key: number;
  barcode: string;
  trade_name: string;
  scientific_name: string;
  strength: string;
  dosage_form: string;
  company: string;
  category: string;
  cost: number;
  priceMode: "amount" | "pct";
  priceOrPct: number;
  packing: number;
  secondPrice: number;
  expiry: string;
};

const blankRow = (): BatchRow => ({
  key: Date.now() + Math.random(),
  barcode: "",
  trade_name: "",
  scientific_name: "",
  strength: "",
  dosage_form: "",
  company: "",
  category: "",
  cost: 0,
  priceMode: "amount",
  priceOrPct: 0,
  packing: 1,
  secondPrice: 0,
  expiry: "",
});

/** Resolve the effective base selling price for a batch row. */
function rowPrice(r: BatchRow): number {
  return r.priceMode === "pct" ? priceFromMarginOnSale(r.cost, r.priceOrPct) : Math.round(r.priceOrPct);
}

export function BatchItemsPanel({
  categories,
  onClose,
  onSaved,
}: {
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>("drug");
  const [rows, setRows] = useState<BatchRow[]>([blankRow(), blankRow(), blankRow()]);
  const [busy, setBusy] = useState(false);

  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const delRow = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const set = <K extends keyof BatchRow>(key: number, k: K, v: BatchRow[K]) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [k]: v } : r)));

  const saveAll = async () => {
    const valid = rows.filter((r) => r.trade_name.trim());
    if (!valid.length) {
      toast.error("أدخل الاسم التجاري لمادة واحدة على الأقل");
      return;
    }
    setBusy(true);
    let ok = 0;
    try {
      for (const r of valid) {
        const base = rowPrice(r);
        const packing = Math.max(1, Math.round(r.packing) || 1);
        await createMedicine({
          barcode: r.barcode.trim() || null,
          trade_name: r.trade_name.trim(),
          scientific_name: (mode === "drug" ? r.scientific_name.trim() : "") || r.trade_name.trim(),
          strength: mode === "drug" ? r.strength.trim() : "",
          dosage_form: mode === "drug" ? r.dosage_form.trim() : "",
          company: r.company.trim(),
          category: r.category.trim(),
          purchase_price: r.cost,
          selling_price: base,
          small_unit_cost: r.cost,
          small_unit_price: base,
          units_per_large: packing,
          large_unit_cost: roundToNearest500(r.cost * packing),
          large_unit_price: r.secondPrice > 0 ? Math.round(r.secondPrice) : roundToNearest500(base * packing),
          expiry_date: r.expiry || null,
          is_active: true,
        });
        ok++;
      }
      toast.success(`تم حفظ ${ok} مادة بنجاح`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(`فشل الحفظ بعد ${ok} مادة: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const inCx =
    "w-full bg-slate-800 border border-border rounded px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-emerald/40";

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm grid place-items-center p-3" dir="rtl">
      <div className="w-full max-w-[1150px] max-h-[92vh] flex flex-col rounded-xl border border-emerald/30 bg-slate-950">
        <header className="flex items-center justify-between gap-3 p-3 border-b border-border">
          <h2 className="text-sm font-bold">تعريف مواد / دواء متعدد</h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md overflow-hidden border border-emerald/40">
              {(["drug", "general"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1 text-[11px] font-bold ${
                    mode === m ? "bg-emerald text-primary-foreground" : "bg-slate-800 text-emerald"
                  }`}
                >
                  {m === "drug" ? "أدوية" : "مواد عامة"}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="size-7 grid place-items-center rounded-md hover:bg-slate-800 text-muted-foreground">
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-2">
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 bg-slate-900 text-[10px] text-muted-foreground">
              <tr>
                <th className="p-1 w-8">#</th>
                <th className="p-1 min-w-[110px]">باركود</th>
                <th className="p-1 min-w-[150px]">الاسم التجاري</th>
                {mode === "drug" && <th className="p-1 min-w-[130px]">الاسم العلمي</th>}
                {mode === "drug" && <th className="p-1 min-w-[70px]">التركيز</th>}
                {mode === "drug" && <th className="p-1 min-w-[90px]">الشكل الصيدلاني</th>}
                <th className="p-1 min-w-[110px]">الشركة</th>
                <th className="p-1 min-w-[100px]">التصنيف</th>
                <th className="p-1 min-w-[80px]">الكلفة</th>
                <th className="p-1 min-w-[86px]">نمط السعر</th>
                <th className="p-1 min-w-[86px]">السعر / النسبة</th>
                <th className="p-1 min-w-[60px]">التعبئة</th>
                <th className="p-1 min-w-[96px]">سعر الوحدة الثانية</th>
                <th className="p-1 min-w-[110px]">الإكسباير</th>
                <th className="p-1 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r, i) => (
                <tr key={r.key} className="hover:bg-emerald/5">
                  <td className="p-1 text-center font-mono text-muted-foreground">{i + 1}</td>
                  <td className="p-1">
                    <input value={r.barcode} onChange={(e) => set(r.key, "barcode", e.target.value)} className={`${inCx} font-mono`} />
                  </td>
                  <td className="p-1">
                    <input
                      value={r.trade_name}
                      onChange={(e) => set(r.key, "trade_name", e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && i === rows.length - 1) addRow();
                      }}
                      className={inCx}
                    />
                  </td>
                  {mode === "drug" && (
                    <td className="p-1">
                      <input value={r.scientific_name} onChange={(e) => set(r.key, "scientific_name", e.target.value)} className={inCx} />
                    </td>
                  )}
                  {mode === "drug" && (
                    <td className="p-1">
                      <input value={r.strength} onChange={(e) => set(r.key, "strength", e.target.value)} className={inCx} />
                    </td>
                  )}
                  {mode === "drug" && (
                    <td className="p-1">
                      <input value={r.dosage_form} onChange={(e) => set(r.key, "dosage_form", e.target.value)} className={inCx} />
                    </td>
                  )}
                  <td className="p-1">
                    <input value={r.company} onChange={(e) => set(r.key, "company", e.target.value)} className={inCx} />
                  </td>
                  <td className="p-1">
                    <select value={r.category} onChange={(e) => set(r.key, "category", e.target.value)} className={inCx}>
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      value={r.cost || ""}
                      onChange={(e) => set(r.key, "cost", Number(e.target.value) || 0)}
                      className={`${inCx} font-mono text-center`}
                    />
                  </td>
                  <td className="p-1">
                    <select
                      value={r.priceMode}
                      onChange={(e) => set(r.key, "priceMode", e.target.value as "amount" | "pct")}
                      className={inCx}
                    >
                      <option value="amount">وفق مبلغ</option>
                      <option value="pct">وفق نسبة</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      value={r.priceOrPct || ""}
                      onChange={(e) => set(r.key, "priceOrPct", Number(e.target.value) || 0)}
                      className={`${inCx} font-mono text-center`}
                    />
                    {r.priceMode === "pct" && r.cost > 0 && (
                      <span className="block text-center text-[9px] text-emerald font-mono">{rowPrice(r).toLocaleString()}</span>
                    )}
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      value={r.packing || ""}
                      onChange={(e) => set(r.key, "packing", Number(e.target.value) || 0)}
                      className={`${inCx} font-mono text-center`}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      value={r.secondPrice || ""}
                      onChange={(e) => set(r.key, "secondPrice", Number(e.target.value) || 0)}
                      placeholder={String(roundToNearest500(rowPrice(r) * Math.max(1, r.packing)) || "")}
                      className={`${inCx} font-mono text-center`}
                    />
                  </td>
                  <td className="p-1">
                    <input type="date" value={r.expiry} onChange={(e) => set(r.key, "expiry", e.target.value)} className={`${inCx} font-mono`} />
                  </td>
                  <td className="p-1 text-center">
                    <button onClick={() => delRow(r.key)} className="text-muted-foreground hover:text-destructive" title="حذف الصف">
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-between gap-2 p-3 border-t border-border bg-slate-900/40">
          <p className="text-[10px] text-muted-foreground">Enter في آخر صف يضيف صفاً جديداً للإدخال السريع.</p>
          <div className="flex gap-2">
            <button
              onClick={addRow}
              className="px-3 py-1.5 rounded-md bg-slate-800 border border-emerald/40 text-emerald text-xs font-bold flex items-center gap-1"
            >
              <Plus className="size-3.5" /> صف جديد
            </button>
            <button
              onClick={saveAll}
              disabled={busy}
              className="px-4 py-1.5 rounded-md bg-emerald text-primary-foreground text-xs font-bold flex items-center gap-1 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} حفظ كل المواد
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
