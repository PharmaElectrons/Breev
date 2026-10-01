// Initial stock audit (جرد أولي للمواد): batch grid to set physical counts and
// small/large unit cost, price and margin for existing items in one pass.
import { useMemo, useState } from "react";
import { X, Plus, Trash2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { updateMedicine, type Medicine } from "@/lib/db";
import { priceFromMarginOnSale, formatIQD } from "@/lib/pharmacy";

type Row = {
  key: string;
  medicineId: string | null;
  barcode: string;
  name: string;
  qty: string;
  smallCost: string;
  smallPrice: string;
  largeCost: string;
  largePrice: string;
};

const emptyRow = (): Row => ({
  key: Math.random().toString(36).slice(2),
  medicineId: null,
  barcode: "",
  name: "",
  qty: "",
  smallCost: "",
  smallPrice: "",
  largeCost: "",
  largePrice: "",
});

const num = (v: string) => Number(String(v).replace(/,/g, "")) || 0;
const marginOf = (cost: number, price: number) => (price > 0 ? ((price - cost) / price) * 100 : 0);

const rowFromMedicine = (m: Medicine): Row => ({
  key: Math.random().toString(36).slice(2),
  medicineId: m.id,
  barcode: m.barcode ?? "",
  name: m.trade_name,
  qty: String(m.quantity_in_stock ?? 0),
  smallCost: String(m.small_unit_cost ?? m.purchase_price ?? 0),
  smallPrice: String(m.small_unit_price ?? m.selling_price ?? 0),
  largeCost: String(m.large_unit_cost ?? 0),
  largePrice: String(m.large_unit_price ?? 0),
});

export function InitialStockAuditDialog({
  items,
  onClose,
  onSaved,
}: {
  items: Medicine[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return items
      .filter(
        (m) =>
          m.trade_name.toLowerCase().includes(s) ||
          (m.scientific_name || "").toLowerCase().includes(s) ||
          (m.barcode || "").includes(s),
      )
      .slice(0, 8);
  }, [q, items]);

  const patch = (key: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const addMedicine = (m: Medicine) => {
    setRows((rs) => {
      if (rs.some((r) => r.medicineId === m.id)) return rs;
      const base = rs.filter((r) => r.medicineId || r.name.trim());
      return [...base, rowFromMedicine(m)];
    });
    setQ("");
  };

  const setMargin = (row: Row, which: "small" | "large", pct: number) => {
    const cost = which === "small" ? num(row.smallCost) : num(row.largeCost);
    const price = priceFromMarginOnSale(cost, pct);
    patch(row.key, which === "small" ? { smallPrice: String(price) } : { largePrice: String(price) });
  };

  const valid = rows.filter((r) => r.medicineId);
  const totalValue = valid.reduce((s, r) => s + num(r.qty) * num(r.smallCost), 0);

  const save = async () => {
    if (valid.length === 0) {
      toast.error("لا توجد مواد صالحة للجرد — اختر مادة من البحث.");
      return;
    }
    setBusy(true);
    try {
      for (const r of valid) {
        await updateMedicine(r.medicineId!, {
          quantity_in_stock: Math.max(0, Math.round(num(r.qty))),
          small_unit_cost: num(r.smallCost),
          small_unit_price: num(r.smallPrice),
          large_unit_cost: num(r.largeCost),
          large_unit_price: num(r.largePrice),
        });
      }
      toast.success(`تم حفظ الجرد الأولي لـ ${valid.length} مادة`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل حفظ الجرد");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-[1180px] max-h-[92vh] rounded-2xl border border-border bg-slate-950 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-emerald">جرد أولي للمواد</h2>
            <p className="text-[11px] text-muted-foreground">
              إدخال العدد الفعلي وأسعار الكلفة والبيع للوحدتين الصغيرة والكبيرة دفعة واحدة.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Item picker */}
        <div className="px-4 py-2 border-b border-border bg-slate-900/40 relative">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالباركود أو اسم المادة لإضافتها إلى شبكة الجرد..."
              className="flex-1 bg-slate-800 border border-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
            />
            <button
              onClick={() => setRows((rs) => [...rs, emptyRow()])}
              className="px-2 py-2 rounded-lg bg-slate-800 border border-border text-[11px] font-bold text-muted-foreground hover:text-emerald"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {matches.length > 0 && (
            <div className="absolute z-10 right-4 left-4 mt-1 rounded-lg border border-border bg-slate-950 shadow-xl divide-y divide-border/50 max-h-56 overflow-auto">
              {matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => addMedicine(m)}
                  className="w-full text-right px-3 py-2 text-xs hover:bg-slate-800/60 flex items-center justify-between"
                >
                  <span className="font-medium">{m.trade_name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{m.barcode ?? "—"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-slate-900/90 backdrop-blur-md">
              <tr className="border-b border-border">
                <Th>الباركود</Th>
                <Th>اسم المادة</Th>
                <Th>العدد</Th>
                <Th>سعر الكلفة (صغيرة)</Th>
                <Th>سعر البيع (صغيرة)</Th>
                <Th>نسبة الربح % (صغيرة)</Th>
                <Th>سعر الكلفة (كبيرة)</Th>
                <Th>سعر البيع (كبيرة)</Th>
                <Th>نسبة الربح % (كبيرة)</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((r) => {
                const sm = marginOf(num(r.smallCost), num(r.smallPrice));
                const lg = marginOf(num(r.largeCost), num(r.largePrice));
                return (
                  <tr key={r.key} className="hover:bg-slate-800/30">
                    <Td>
                      <input
                        value={r.barcode}
                        onChange={(e) => patch(r.key, { barcode: e.target.value })}
                        className="w-28 bg-slate-800/60 border border-border rounded px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-emerald/40"
                      />
                    </Td>
                    <Td>
                      <input
                        value={r.name}
                        onChange={(e) => patch(r.key, { name: e.target.value })}
                        className="w-52 bg-slate-800/60 border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-emerald/40"
                      />
                    </Td>
                    <Td><NumInput value={r.qty} onChange={(v) => patch(r.key, { qty: v })} /></Td>
                    <Td><NumInput value={r.smallCost} onChange={(v) => patch(r.key, { smallCost: v })} /></Td>
                    <Td><NumInput value={r.smallPrice} onChange={(v) => patch(r.key, { smallPrice: v })} /></Td>
                    <Td>
                      <NumInput
                        value={sm ? sm.toFixed(1) : ""}
                        onChange={(v) => setMargin(r, "small", Number(v) || 0)}
                        tone={sm > 0 ? "emerald" : "rose"}
                      />
                    </Td>
                    <Td><NumInput value={r.largeCost} onChange={(v) => patch(r.key, { largeCost: v })} /></Td>
                    <Td><NumInput value={r.largePrice} onChange={(v) => patch(r.key, { largePrice: v })} /></Td>
                    <Td>
                      <NumInput
                        value={lg ? lg.toFixed(1) : ""}
                        onChange={(v) => setMargin(r, "large", Number(v) || 0)}
                        tone={lg > 0 ? "emerald" : "rose"}
                      />
                    </Td>
                    <Td>
                      <button
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-border bg-slate-900/50 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            المواد المرتبطة: <span className="text-emerald font-bold font-mono">{valid.length}</span>
            <span className="mx-2">•</span>
            قيمة الجرد بالكلفة: <span className="text-emerald font-bold font-mono">{formatIQD(totalValue)}</span>
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg bg-slate-800 border border-border text-[11px] font-bold text-muted-foreground">
              إلغاء
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald text-primary-foreground text-[11px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              {busy ? "جاري الحفظ…" : "حفظ الجرد"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 text-[10px] uppercase tracking-widest text-muted-foreground whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1.5 align-middle">{children}</td>;
}
function NumInput({
  value,
  onChange,
  tone,
}: {
  value: string;
  onChange: (v: string) => void;
  tone?: "emerald" | "rose";
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      className={`w-24 bg-slate-800/60 border border-border rounded px-2 py-1 font-mono text-[11px] text-left outline-none focus:ring-1 focus:ring-emerald/40 ${
        tone === "emerald" ? "text-emerald" : tone === "rose" ? "text-destructive" : ""
      }`}
    />
  );
}
