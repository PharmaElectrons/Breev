import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  useCart,
  updateQty,
  removeFromCart,
  clearCart,
  toggleCartStatus,
  addToCart,
  type CartItem,
} from "@/lib/procurement-cart";
import { getConsumptionByMedicine, listMedicines, type Medicine } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ShoppingCart,
  Trash2,
  Printer,
  FileDown,
  ArrowLeftRight,
  CalendarClock,
  PackageX,
  Sparkles,
  Send,
  X as XIcon,
  Crown,
  Handshake,
} from "lucide-react";
import { formatIQD } from "@/lib/pharmacy";
import { NeedRequests } from "@/components/need-requests";

export const Route = createFileRoute("/cart")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "سلة الطلبات — Breef Pharmacy" },
      { name: "description", content: "سلة الطلبات: تنظيم الطلبيات ومتابعة المواد المقطوعة." },
    ],
  }),
  component: CartPage,
});

const MOCK_ITEMS: CartItem[] = [
  { medicineId: "mock-1", barcode: "6221011234567", name: "Panadol Extra 500mg", currentStock: 42, minimum: 30, maximum: 150, suggestedQty: 60, addedAt: new Date().toISOString(), status: "order" },
  { medicineId: "mock-2", barcode: "6221022345678", name: "Augmentin 625mg", currentStock: 12, minimum: 20, maximum: 80, suggestedQty: 40, addedAt: new Date().toISOString(), status: "order" },
  { medicineId: "mock-3", barcode: "6221033456789", name: "Lipitor 20mg", currentStock: 8, minimum: 15, maximum: 60, suggestedQty: 30, addedAt: new Date().toISOString(), status: "order" },
  { medicineId: "mock-4", barcode: "6221044567890", name: "Concor 5mg", currentStock: 22, minimum: 25, maximum: 100, suggestedQty: 50, addedAt: new Date().toISOString(), status: "order" },
  { medicineId: "mock-5", barcode: "6221055678901", name: "Nexium 40mg", currentStock: 5, minimum: 20, maximum: 70, suggestedQty: 45, addedAt: new Date().toISOString(), status: "order" },
];

const toLocalInput = (d: Date) => {
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
};

/**
 * Smart Procurement Formula:
 * Suggested Qty (large units) = ceil((Maximum Stock - Current Stock) / units_per_large)
 * Always rounds UP so pharmacists never order fractional boxes.
 */
function computeSuggested(item: CartItem, med?: Medicine): number {
  const perLarge = Math.max(1, Number(med?.units_per_large ?? 1));
  const deficit = Math.max(0, item.maximum - item.currentStock);
  return Math.ceil(deficit / perLarge);
}

function CartPage() {
  const items = useCart();
  const [supplierNote, setSupplierNote] = useState("");
  const [activeTab, setActiveTab] = useState<"order" | "ai" | "need" | "out">("order");

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [fromLocal, setFromLocal] = useState(toLocalInput(dayStart));
  const [toLocalStr, setToLocalStr] = useState(toLocalInput(now));

  const [consumption, setConsumption] = useState<Record<string, number>>({});
  const [medIndex, setMedIndex] = useState<Record<string, Medicine>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  useEffect(() => {
    if (items.length === 0) MOCK_ITEMS.forEach((m) => addToCart(m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listMedicines()
      .then((meds) => {
        const idx: Record<string, Medicine> = {};
        for (const m of meds) idx[m.id] = m;
        setMedIndex(idx);
      })
      .catch(() => setMedIndex({}));
  }, [items.length]);

  useEffect(() => {
    let cancelled = false;
    const fromIso = new Date(fromLocal).toISOString();
    const toIso = new Date(toLocalStr).toISOString();
    getConsumptionByMedicine(fromIso, toIso)
      .then((agg) => { if (!cancelled) setConsumption(agg); })
      .catch(() => { if (!cancelled) setConsumption({}); });
    return () => { cancelled = true; };
  }, [fromLocal, toLocalStr, items.length]);

  const ordered = useMemo(() => items.filter((i) => (i.status ?? "order") === "order"), [items]);
  const out = useMemo(() => items.filter((i) => i.status === "out"), [items]);
  const shown = activeTab === "order" ? ordered : out;

  const totals = useMemo(() => ({
    count: shown.length,
    units: shown.reduce((s, i) => s + i.suggestedQty, 0),
  }), [shown]);

  const activeMedicine = activeRowId ? medIndex[activeRowId] : undefined;

  const toggleSel = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };
  const allShownSelected = shown.length > 0 && shown.every((i) => selectedIds.has(i.medicineId));
  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allShownSelected) shown.forEach((i) => next.delete(i.medicineId));
    else shown.forEach((i) => next.add(i.medicineId));
    setSelectedIds(next);
  };

  const applySmartQty = () => {
    let changed = 0;
    shown.forEach((i) => {
      const sug = computeSuggested(i, medIndex[i.medicineId]);
      if (sug !== i.suggestedQty) { updateQty(i.medicineId, sug); changed++; }
    });
    toast.success(`تم حساب ${changed} كمية تلقائياً`);
  };

  const exportText = () => {
    if (ordered.length === 0) return toast.error("لا توجد طلبية للتصدير");
    const lines = [
      "طلب مشتريات — صيدلية Breef",
      `التاريخ: ${new Date().toLocaleDateString("ar-EG")}`,
      supplierNote ? `المورد: ${supplierNote}` : "",
      "",
      ...ordered.map((i, idx) => `${idx + 1}. ${i.name}${i.barcode ? ` [${i.barcode}]` : ""} — الكمية المطلوبة: ${i.suggestedQty}`),
      "",
      `عدد المواد: ${ordered.length}`,
    ].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(lines).catch(() => {});
    toast.success("تم نسخ الطلبية إلى الحافظة");
  };

  return (
    <AppShell title="سلة الطلبات" medicine={activeMedicine}>
      <div className="flex-1 flex flex-col overflow-hidden" dir="rtl">
        <div className="p-3 border-b border-border bg-slate-950/40 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald" />
            <h2 className="text-sm font-bold">سلة الطلبات — Orders Basket</h2>
          </div>
          <div className="flex-1" />
          <div className="flex gap-2">
            <span className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-border text-[11px]">
              الطلبية: <span className="font-bold text-emerald font-mono">{ordered.length}</span>
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-border text-[11px]">
              مقطوعة: <span className="font-bold text-rose-400 font-mono">{out.length}</span>
            </span>
            {selectedIds.size > 0 && (
              <span className="px-3 py-1.5 rounded-lg bg-emerald/15 border border-emerald/40 text-[11px] text-emerald">
                محدد: <span className="font-bold font-mono">{selectedIds.size}</span>
              </span>
            )}
          </div>
        </div>

        <div className="px-3 py-2 border-b border-border bg-slate-900/40 flex items-center gap-2 flex-wrap text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock className="w-4 h-4 text-emerald" />
            <span>الفترة الزمنية:</span>
          </div>
          <label className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">من</span>
            <input type="datetime-local" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)}
              className="bg-slate-800 border border-border rounded px-2 py-1 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald/40" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">إلى</span>
            <input type="datetime-local" value={toLocalStr} onChange={(e) => setToLocalStr(e.target.value)}
              className="bg-slate-800 border border-border rounded px-2 py-1 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald/40" />
          </label>

          <div className="flex-1" />

          <button onClick={applySmartQty}
            className="px-2 py-1 rounded bg-emerald/15 border border-emerald/40 text-emerald text-[11px] font-bold hover:bg-emerald/25">
            حساب الكمية الذكي
          </button>
          <input value={supplierNote} onChange={(e) => setSupplierNote(e.target.value)}
            placeholder="اسم المورد (اختياري)..."
            className="min-w-[180px] bg-slate-800 border border-border rounded px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald/40" />
          <button onClick={exportText}
            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald text-primary-foreground text-[11px] font-bold hover:brightness-110">
            <FileDown className="w-3.5 h-3.5" /> نسخ الطلب
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1 px-2 py-1 rounded bg-sky-600 text-white text-[11px] font-bold hover:brightness-110">
            <Printer className="w-3.5 h-3.5" /> طباعة
          </button>
          <button onClick={() => { if (confirm("تفريغ السلة بالكامل؟")) clearCart(); }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/20 border border-destructive/40 text-destructive text-[11px] font-bold">
            <Trash2 className="w-3.5 h-3.5" /> تفريغ
          </button>
        </div>

        <div className="px-3 pt-2 border-b border-border bg-slate-950/30 flex items-center gap-1">
          <TabBtn active={activeTab === "order"} onClick={() => setActiveTab("order")}
            icon={<ShoppingCart className="w-4 h-4" />} label={`الطلبية (${ordered.length})`} tone="emerald" />
          <TabBtn active={activeTab === "ai"} onClick={() => setActiveTab("ai")}
            icon={<Sparkles className="w-4 h-4" />} label={`تحليل ومقارنة ارخص الموردين (AI)`} tone="violet" />
          <TabBtn active={activeTab === "need"} onClick={() => setActiveTab("need")}
            icon={<Handshake className="w-4 h-4" />} label="طلب احتياج" tone="teal" />
          <TabBtn active={activeTab === "out"} onClick={() => setActiveTab("out")}
            icon={<PackageX className="w-4 h-4" />} label={`مواد مقطوعة (${out.length})`} tone="rose" />
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground pb-1 font-mono">
            {activeTab === "ai"
              ? `${ordered.length} صف للمقارنة`
              : activeTab === "need"
              ? "تبادل بين الصيدليات"
              : `${totals.count} صف · ${totals.units} وحدة`}
          </span>
        </div>


        {activeTab === "need" ? (
          <NeedRequests medIndex={medIndex} />
        ) : activeTab === "ai" ? (
          <AiComparison items={ordered} medIndex={medIndex} />
        ) : (
        <div className="flex-1 overflow-auto p-3">
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  {/* In RTL, first column IS the far-right column */}
                  <th className="px-2 py-2 w-10">
                    <input type="checkbox" checked={allShownSelected} onChange={toggleAll}
                      className="size-4 accent-emerald cursor-pointer" title="تحديد الكل" />
                  </th>
                  <th className="px-2 py-2 w-8">#</th>
                  <th className="px-2 py-2">الباركود</th>
                  <th className="px-2 py-2">المادة</th>
                  <th className="px-2 py-2">الرصيد</th>
                  <th className="px-2 py-2">الأدنى</th>
                  <th className="px-2 py-2">الأعلى</th>
                  <th className="px-2 py-2">المصروف اليومي / <br />حسب المدة</th>
                  {activeTab === "order" && <th className="px-2 py-2">الكمية المطلوبة</th>}
                  <th className="px-2 py-2 w-24">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {shown.map((i, idx) => {
                  const isActive = i.medicineId === activeRowId;
                  const isSelected = selectedIds.has(i.medicineId);
                  return (
                    <tr key={i.medicineId}
                      onClick={() => setActiveRowId(i.medicineId)}
                      className={`cursor-pointer transition ${isActive ? "bg-emerald/10" : "hover:bg-slate-800/30"}`}>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected}
                          onChange={() => toggleSel(i.medicineId)}
                          className="size-4 accent-emerald cursor-pointer" />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{idx + 1}</td>
                      <td className="px-2 py-2 font-mono text-xs">{i.barcode ?? "—"}</td>
                      <td className="px-2 py-2 font-medium">{i.name}</td>
                      <td className="px-2 py-2 font-mono text-accent">{i.currentStock}</td>
                      <td className="px-2 py-2 font-mono text-muted-foreground">{i.minimum}</td>
                      <td className="px-2 py-2 font-mono text-muted-foreground">{i.maximum}</td>
                      <td className="px-2 py-2 font-mono text-emerald">{consumption[i.medicineId] ?? 0}</td>
                      {activeTab === "order" && (
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <input type="number" min={0} value={i.suggestedQty}
                            onChange={(e) => updateQty(i.medicineId, Number(e.target.value) || 0)}
                            className="w-20 bg-slate-800 border border-border rounded px-2 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-emerald/40" />
                        </td>
                      )}
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => toggleCartStatus(i.medicineId)}
                            className={`size-7 grid place-items-center rounded-md border ${activeTab === "order"
                              ? "bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25"
                              : "bg-emerald/15 border-emerald/40 text-emerald hover:bg-emerald/25"}`}
                            title={activeTab === "order" ? "نقل إلى: مواد مقطوعة" : "إرجاع إلى: الطلبية"}>
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => removeFromCart(i.medicineId)}
                            className="size-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="حذف">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={activeTab === "order" ? 10 : 9}
                      className="px-4 py-10 text-center text-muted-foreground text-xs">
                      {activeTab === "order"
                        ? "لا توجد مواد في الطلبية — أضف من شاشة البيع أو من تقرير مبيعات اليوم."
                        : "لا توجد مواد مقطوعة بعد."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    </AppShell>
  );
}

function TabBtn({ active, onClick, icon, label, tone }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; tone: "emerald" | "rose" | "violet" | "teal";
}) {
  const activeCls = tone === "emerald"
    ? "bg-emerald/15 border-emerald/50 text-emerald"
    : tone === "rose"
    ? "bg-rose-500/15 border-rose-500/50 text-rose-300"
    : tone === "teal"
    ? "bg-teal-500/15 border-teal-500/50 text-teal-300"
    : "bg-violet-500/15 border-violet-500/50 text-violet-300";
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg border-b-0 text-xs font-bold transition ${
        active ? `${activeCls} border` : "text-muted-foreground hover:text-foreground border border-transparent"
      }`}>
      {icon}
      {label}
    </button>
  );
}

// ---------------- AI Cheapest Supplier Comparison ---------------------------

type SupplierRow = {
  id: string;
  name: string;
  default_discount_pct: number | null;
};

type Quote = {
  supplierId: string;
  supplierName: string;
  base: number;
  discountPct: number;
  net: number;
};

// Deterministic hash so quoted prices stay stable per (medicine, supplier).
function hash2(a: string, b: string): number {
  let h = 2166136261;
  const s = `${a}::${b}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

function buildQuotes(
  med: Medicine | undefined,
  fallbackName: string,
  suppliers: SupplierRow[],
): Quote[] {
  const anchor = Math.max(
    500,
    Math.round((med?.purchase_price ?? med?.large_unit_cost ?? 5000)),
  );
  return suppliers.map((s) => {
    // ±18% variation, deterministic per (medicine, supplier)
    const h = hash2(med?.id ?? fallbackName, s.id);
    const variance = ((h % 3600) / 10000) - 0.18; // -0.18 .. +0.18
    const base = Math.max(250, Math.round(anchor * (1 + variance) / 250) * 250);
    const discountPct = Math.max(0, Math.min(50, Number(s.default_discount_pct ?? 0)));
    const net = Math.round((base * (1 - discountPct / 100)) / 50) * 50;
    return { supplierId: s.id, supplierName: s.name, base, discountPct, net };
  });
}

function AiComparison({
  items,
  medIndex,
}: {
  items: CartItem[];
  medIndex: Record<string, Medicine>;
}) {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Record<string, string>>({}); // medicineId -> supplierId

  useEffect(() => {
    supabase
      .from("suppliers")
      .select("id, name, default_discount_pct")
      .order("name")
      .limit(20)
      .then(({ data }) => setSuppliers((data ?? []) as SupplierRow[]));
  }, []);

  // Pre-select cheapest supplier per item once suppliers load
  const perItemQuotes = useMemo(() => {
    const map: Record<string, Quote[]> = {};
    for (const it of items) {
      const med = medIndex[it.medicineId];
      const quotes = buildQuotes(med, it.name, suppliers).sort((a, b) => a.net - b.net);
      map[it.medicineId] = quotes;
    }
    return map;
  }, [items, medIndex, suppliers]);

  useEffect(() => {
    if (suppliers.length === 0) return;
    setChosen((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const it of items) {
        if (!next[it.medicineId]) {
          const top = perItemQuotes[it.medicineId]?.[0];
          if (top) { next[it.medicineId] = top.supplierId; changed = true; }
        }
      }
      return changed ? next : prev;
    });
    setSelected((prev) => {
      if (prev.size > 0) return prev;
      return new Set(items.map((i) => i.medicineId));
    });
  }, [suppliers, items, perItemQuotes]);

  const describe = (it: CartItem): string => {
    const m = medIndex[it.medicineId];
    if (!m) return it.name;
    return [m.trade_name, m.strength, m.dosage_form, m.company].filter(Boolean).join(" - ");
  };

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const qtyOf = (it: CartItem) => qtyOverride[it.medicineId] ?? it.suggestedQty;

  // Group selected items by chosen supplier
  const groups = useMemo(() => {
    const g: Record<string, { supplier: SupplierRow; lines: Array<{ item: CartItem; quote: Quote; qty: number }> }> = {};
    for (const it of items) {
      if (!selected.has(it.medicineId)) continue;
      const supId = chosen[it.medicineId];
      const quote = perItemQuotes[it.medicineId]?.find((q) => q.supplierId === supId);
      const sup = suppliers.find((s) => s.id === supId);
      if (!supId || !quote || !sup) continue;
      if (!g[supId]) g[supId] = { supplier: sup, lines: [] };
      g[supId].lines.push({ item: it, quote, qty: qtyOf(it) });
    }
    return Object.values(g);
  }, [items, selected, chosen, perItemQuotes, suppliers]);

  const sendBatch = (supName: string, lineCount: number) => {
    toast.success(`تم إرسال طلبية ${supName} (${lineCount} مادة) إلى خط أوامر الشراء`);
  };

  if (items.length === 0) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6">
        لا توجد مواد في الطلبية لمقارنة الأسعار — أضف مواد من تبويب "الطلبية".
      </div>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6">
        لا يوجد موردون مسجلون — أضف موردين من نافذة "المذاخر" أولاً.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-3 space-y-3" dir="rtl">
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-violet-300 mt-0.5" />
        <div className="text-[11px] leading-relaxed text-violet-100/90">
          محرك التوصية الذكية يقيّم <b>{suppliers.length}</b> مورد ويعرض أرخص 3 مذاخر لكل مادة بعد تطبيق نسبة الخصم الافتراضية.
          يتم اختيار الأرخص تلقائياً — يمكنك التبديل يدوياً من القائمة، ثم إرسال كل مجموعة إلى مذخرها بضغطة واحدة.
        </div>
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-2 py-2 w-8">✓</th>
              <th className="px-2 py-2">اسم المادة (اسم - تركيز - شكل - شركة)</th>
              <th className="px-2 py-2 w-20">الكمية</th>
              <th className="px-2 py-2">المذخر الأول (الأرخص)</th>
              <th className="px-2 py-2">المذخر الثاني</th>
              <th className="px-2 py-2">المذخر الثالث</th>
              <th className="px-2 py-2">المذخر المختار</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {items.map((it) => {
              const quotes = perItemQuotes[it.medicineId] ?? [];
              const top3 = quotes.slice(0, 3);
              const cheapestId = top3[0]?.supplierId;
              const isSel = selected.has(it.medicineId);
              return (
                <tr key={it.medicineId} className={isSel ? "bg-slate-800/20" : "opacity-60"}>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={isSel} onChange={() => toggleSel(it.medicineId)}
                      className="size-4 accent-violet-400 cursor-pointer" />
                  </td>
                  <td className="px-2 py-2 font-medium">{describe(it)}</td>
                  <td className="px-2 py-2">
                    <input type="number" min={0} value={qtyOf(it)}
                      onChange={(e) => setQtyOverride((p) => ({ ...p, [it.medicineId]: Number(e.target.value) || 0 }))}
                      className="w-16 bg-slate-800 border border-border rounded px-1.5 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-violet-400/40" />
                  </td>
                  {[0, 1, 2].map((idx) => {
                    const q = top3[idx];
                    if (!q) return <td key={idx} className="px-2 py-2 text-muted-foreground">—</td>;
                    const isBest = q.supplierId === cheapestId;
                    return (
                      <td key={idx} className={`px-2 py-2 ${isBest ? "bg-emerald/10" : ""}`}>
                        <div className="flex items-center gap-1 text-[11px] font-medium">
                          {isBest && <Crown className="w-3 h-3 text-amber-400" />}
                          <span className="truncate max-w-[110px]" title={q.supplierName}>{q.supplierName}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          الأساسي: {formatIQD(q.base)}
                        </div>
                        <div className={`text-[10px] font-mono font-bold ${isBest ? "text-emerald" : "text-foreground"}`}>
                          الصافي: {formatIQD(q.net)} <span className="text-muted-foreground">({q.discountPct}%)</span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">
                    <select
                      value={chosen[it.medicineId] ?? cheapestId ?? ""}
                      onChange={(e) => setChosen((p) => ({ ...p, [it.medicineId]: e.target.value }))}
                      className="bg-slate-800 border border-border rounded px-1.5 py-1 text-[11px] font-medium outline-none focus:ring-1 focus:ring-violet-400/40 max-w-[140px]"
                    >
                      {quotes.map((q) => (
                        <option key={q.supplierId} value={q.supplierId}>
                          {q.supplierName} — {formatIQD(q.net)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Grouped supplier batches */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map(({ supplier, lines }) => {
          const total = lines.reduce((s, l) => s + l.quote.net * l.qty, 0);
          return (
            <div key={supplier.id} className="rounded-xl border border-emerald/30 bg-emerald/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-emerald">{supplier.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {lines.length} مادة · إجمالي {formatIQD(total)}
                  </div>
                </div>
                <button
                  onClick={() => sendBatch(supplier.name, lines.length)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald text-primary-foreground text-[11px] font-bold hover:brightness-110"
                >
                  <Send className="w-3.5 h-3.5" /> إرسال المجموعة
                </button>
              </div>
              <ul className="divide-y divide-border/40 rounded-md border border-border/60 bg-slate-950/30">
                {lines.map(({ item, quote, qty }) => (
                  <li key={item.medicineId} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                    <span className="flex-1 truncate">{describe(item)}</span>
                    <span className="font-mono text-muted-foreground">×{qty}</span>
                    <span className="font-mono text-emerald">{formatIQD(quote.net * qty)}</span>
                    <button
                      onClick={() => toggleSel(item.medicineId)}
                      className="size-5 grid place-items-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="استبعاد من هذه المجموعة"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {groups.length === 0 && (
          <div className="col-span-full text-center text-xs text-muted-foreground py-6 border border-dashed border-border rounded-xl">
            لا يوجد أي عنصر محدد لإنشاء مجاميع طلبية.
          </div>
        )}
      </div>
    </div>
  );
}


