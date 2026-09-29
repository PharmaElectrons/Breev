// Item movement ledger drawer (RTL) — full stock history for a single medicine
// with direct links / inline inspection of each movement's source document.
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatIQD } from "@/lib/pharmacy";
import { X, FileText, ExternalLink } from "lucide-react";

type Movement = {
  id: string;
  delta: number;
  reason: string;
  ref_id: string | null;
  created_at: string;
};

type SourceLine = { name: string; qty: number; price: number };

const MOVEMENT_LABEL: Record<string, { label: string; cls: string }> = {
  purchase: { label: "إدخال شراء", cls: "bg-emerald/15 border-emerald/40 text-emerald" },
  purchase_reverted: { label: "مرتجع مشتريات", cls: "bg-amber-500/15 border-amber-500/45 text-amber-600" },
  sale: { label: "بيع", cls: "bg-sky-500/15 border-sky-500/40 text-sky-600" },
  sale_reverted: { label: "مرتجع بيع", cls: "bg-amber-500/15 border-amber-500/45 text-amber-600" },
};

function labelFor(reason: string) {
  return MOVEMENT_LABEL[reason] ?? { label: "تعديل مخزني", cls: "bg-slate-500/15 border-border text-muted-foreground" };
}

function isPurchase(reason: string) {
  return reason === "purchase" || reason === "purchase_reverted";
}
function isSale(reason: string) {
  return reason === "sale" || reason === "sale_reverted";
}

export function ItemLedgerDrawer({
  medicineId,
  medicineName,
  onClose,
}: {
  medicineId: string;
  medicineName: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refNo, setRefNo] = useState<Record<string, string>>({});
  const [supplierOf, setSupplierOf] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, SourceLine[]>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("stock_movements")
        .select("id,delta,reason,ref_id,created_at")
        .eq("medicine_id", medicineId)
        .order("created_at", { ascending: false })
        .limit(300);
      const list = (data ?? []) as Movement[];
      setRows(list);

      const purchaseIds = [...new Set(list.filter((r) => isPurchase(r.reason) && r.ref_id).map((r) => r.ref_id!))];
      const saleIds = [...new Set(list.filter((r) => isSale(r.reason) && r.ref_id).map((r) => r.ref_id!))];
      const nameMap: Record<string, string> = {};
      const supMap: Record<string, string> = {};
      if (purchaseIds.length) {
        const [{ data: pinv }, { data: sups }] = await Promise.all([
          supabase.from("purchase_invoices").select("id,invoice_no,notes,supplier_id").in("id", purchaseIds),
          supabase.from("suppliers").select("id,name"),
        ]);
        const supNames = new Map(((sups ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
        ((pinv ?? []) as Array<Record<string, any>>).forEach((inv) => {
          nameMap[inv.id] = String(inv.notes ?? "").match(/Ref#(\S+)/)?.[1] ?? String(inv.invoice_no ?? "");
          supMap[inv.id] = (inv.supplier_id && supNames.get(inv.supplier_id)) || "—";
        });
      }
      if (saleIds.length) {
        const { data: sinv } = await supabase.from("sales_invoices").select("id,invoice_no").in("id", saleIds);
        ((sinv ?? []) as Array<Record<string, any>>).forEach((inv) => {
          nameMap[inv.id] = String(inv.invoice_no ?? "");
        });
      }
      setRefNo(nameMap);
      setSupplierOf(supMap);
      setLoading(false);
    })();
  }, [medicineId]);

  const inspect = async (mv: Movement) => {
    if (!mv.ref_id) return;
    if (open === mv.id) {
      setOpen(null);
      return;
    }
    setOpen(mv.id);
    if (lines[mv.id]) return;
    const table = isSale(mv.reason) ? "sales_invoice_items" : "purchase_invoice_items";
    const priceCol = isSale(mv.reason) ? "unit_price" : "unit_cost";
    const { data } = await supabase
      .from(table)
      .select(`medicine_id,qty,${priceCol}`)
      .eq("invoice_id", mv.ref_id);
    const items = (data ?? []) as Array<Record<string, any>>;
    const ids = [...new Set(items.map((i) => i.medicine_id))];
    const { data: meds } = ids.length
      ? await supabase.from("medicines").select("id,trade_name").in("id", ids)
      : { data: [] as Array<{ id: string; trade_name: string }> };
    const medMap = new Map(((meds ?? []) as Array<{ id: string; trade_name: string }>).map((m) => [m.id, m.trade_name]));
    setLines((ls) => ({
      ...ls,
      [mv.id]: items.map((i) => ({
        name: medMap.get(i.medicine_id) ?? "—",
        qty: Number(i.qty) || 0,
        price: Number(i[priceCol]) || 0,
      })),
    }));
  };

  const totals = useMemo(
    () => ({
      in: rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0),
      out: rows.filter((r) => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0),
    }),
    [rows],
  );

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="flex-1 bg-black/50 backdrop-blur-sm" />
      <aside className="w-full max-w-[720px] h-full bg-background border-s border-border shadow-2xl flex flex-col">
        <header className="px-4 py-3 border-b border-border flex items-center gap-3 bg-secondary/40">
          <FileText className="w-4 h-4 text-primary" />
          <div className="flex-1">
            <h2 className="text-sm font-bold">تفاصيل حركة مادة — {medicineName}</h2>
            <p className="text-[10px] text-muted-foreground">
              إدخالات: {totals.in.toLocaleString()} · صادر: {totals.out.toLocaleString()} · {rows.length} حركة
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-800 transition">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 bg-secondary/70 backdrop-blur text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">نوع الحركة</th>
                <th className="px-3 py-2">الكمية</th>
                <th className="px-3 py-2">المستند</th>
                <th className="px-3 py-2">المذخر</th>
                <th className="px-3 py-2">فحص</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">جارِ التحميل...</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">لا توجد حركات مسجلة لهذه المادة.</td></tr>
              )}
              {rows.map((mv) => {
                const lb = labelFor(mv.reason);
                const doc = mv.ref_id ? refNo[mv.ref_id] : "";
                return (
                  <Fragment key={mv.id}>
                    <tr className="hover:bg-slate-800/30">
                      <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap">
                        {String(mv.created_at).slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${lb.cls}`}>{lb.label}</span>
                      </td>
                      <td className={`px-3 py-1.5 font-mono font-bold ${mv.delta < 0 ? "text-destructive" : "text-emerald"}`}>
                        {mv.delta > 0 ? `+${mv.delta}` : mv.delta}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px]">
                        {mv.ref_id ? (
                          isPurchase(mv.reason) ? (
                            <a
                              href={`/purchases?invoice=${mv.ref_id}`}
                              className="inline-flex items-center gap-1 text-sky-500 underline decoration-dotted hover:text-sky-400"
                            >
                              <ExternalLink className="w-3 h-3" /> فاتورة شراء #{doc || "—"}
                            </a>
                          ) : (
                            <span className="text-sky-500">فاتورة بيع #{doc || "—"}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                        {mv.ref_id ? supplierOf[mv.ref_id] ?? "—" : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        {mv.ref_id && (
                          <button
                            type="button"
                            onClick={() => inspect(mv)}
                            className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 transition"
                          >
                            {open === mv.id ? "إخفاء" : "تفاصيل المستند"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === mv.id && (
                      <tr className="bg-slate-900/40">
                        <td colSpan={6} className="px-4 py-2">
                          <p className="text-[10px] font-bold text-muted-foreground mb-1">محتويات المستند</p>
                          <table className="w-full text-right text-[11px]">
                            <tbody className="divide-y divide-border/40">
                              {(lines[mv.id] ?? []).map((l, i) => (
                                <tr key={i}>
                                  <td className="py-1">{l.name}</td>
                                  <td className="py-1 font-mono">{l.qty}</td>
                                  <td className="py-1 font-mono text-muted-foreground">{formatIQD(l.price)}</td>
                                  <td className="py-1 font-mono font-bold">{formatIQD(l.qty * l.price)}</td>
                                </tr>
                              ))}
                              {(lines[mv.id] ?? []).length === 0 && (
                                <tr><td className="py-2 text-muted-foreground">جارِ التحميل...</td></tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}
