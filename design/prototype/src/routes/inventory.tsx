import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  deleteMedicine,
  getConsumptionByMedicine,
  listExpiring,
  listLowStock,
  listMedicines,
  updateMedicine,
  type Medicine,
} from "@/lib/db";
import { computeFlags } from "@/lib/flags";
import { useSettings, type Settings } from "@/lib/settings";
import { useI18n } from "@/lib/i18n";
import {
  RefreshCw,
  Search,
  ChevronsLeft,
  Printer,
  LogOut,
  X,
  ShoppingBasket,
  ArrowUpDown,
  FileSpreadsheet,
  Download,
  ArrowLeftRight,
  Trash2,
  Eye,
  EyeOff,
  ClipboardCheck,
} from "lucide-react";
import { addToCart } from "@/lib/procurement-cart";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { InitialStockAuditDialog } from "@/components/initial-stock-audit";


export const Route = createFileRoute("/inventory")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "المخزن — Breef Pharmacy" },
      { name: "description", content: "أرصدة الأدوية، تحليلات القيمة، والجرد السريع." },
    ],
  }),
  component: InventoryPage,
});

type SortKey =
  | "none"
  | "name"
  | "cost"
  | "price"
  | "expiry"
  | "velocity"
  | "qty"
  | "minStock"
  | "maxStock"
  | "risk"
  | "status";

const DAY = 86400000;

/** Days remaining until expiry (Infinity when no expiry recorded). */
function daysToExpiry(m: Medicine): number {
  if (!m.expiry_date) return Infinity;
  return Math.floor((new Date(m.expiry_date).getTime() - Date.now()) / DAY);
}

/** Criticality index 0..100 — higher = more critical (short dated / out of stock / loss). */
function riskScore(m: Medicine, all: Medicine[], settings: Settings): number {
  let score = 0;
  const d = daysToExpiry(m);
  if (d < 0) score += 60;
  else if (d <= 30) score += 45;
  else if (d <= 90) score += 30;
  else if (d <= 180) score += 15;

  const qty = m.quantity_in_stock || 0;
  const min = m.minimum_stock || 0;
  if (qty < 0) score += 30;
  else if (qty === 0) score += 25;
  else if (qty <= min) score += 15;

  if (Number(m.purchase_price) > 0 && Number(m.selling_price) > 0 && Number(m.purchase_price) > Number(m.selling_price)) {
    score += 10;
  }
  if (computeFlags(m, all, settings).length > 0) score += 5;
  return Math.min(100, score);
}

function riskBand(score: number): { key: "high" | "medium" | "low"; label: string; labelEn: string; color: string } {
  if (score >= 45) return { key: "high", label: "خطورة عالية", labelEn: "High risk", color: "#DC2626" };
  if (score >= 20) return { key: "medium", label: "خطورة متوسطة", labelEn: "Medium", color: "#D97706" };
  return { key: "low", label: "آمن", labelEn: "Low", color: "#4A6B82" };
}

type StockStatus = "expired" | "out" | "low" | "in";

function stockStatus(m: Medicine): StockStatus {
  if (daysToExpiry(m) < 0) return "expired";
  const qty = m.quantity_in_stock || 0;
  if (qty <= 0) return "out";
  if (qty <= (m.minimum_stock || 0)) return "low";
  return "in";
}

/** Sort weight for status: critical states first when sorting descending. */
function statusRank(m: Medicine): number {
  const s = stockStatus(m);
  return s === "expired" ? 4 : s === "out" ? 3 : s === "low" ? 2 : 1;
}

const STATUS_META: Record<StockStatus, { ar: string; en: string; color: string }> = {
  expired: { ar: "منتهي الصلاحية", en: "Expired", color: "#DC2626" },
  out: { ar: "نافد", en: "Out of stock", color: "#B91C1C" },
  low: { ar: "رصيد منخفض", en: "Low stock", color: "#D97706" },
  in: { ar: "متوفر", en: "In stock", color: "#15803D" },
};

function InventoryPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [items, setItems] = useState<Medicine[]>([]);
  const [low, setLow] = useState<Medicine[]>([]);
  const [exp, setExp] = useState<Medicine[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("none");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showBranch, setShowBranch] = useState(true);
  const [showTransfer, setShowTransfer] = useState(true);
  const [consumption, setConsumption] = useState<Record<string, number>>({});
  const [view, setView] = useState<"main" | "export">("main");
  const [branches, setBranches] = useState<Array<{ id: string; name: string; is_primary: boolean }>>([]);
  const [transferItem, setTransferItem] = useState<Medicine | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const settings = useSettings();


  const reload = async () => {
    setLoading(true);
    try {
      const [m, l, e] = await Promise.all([listMedicines(), listLowStock(), listExpiring()]);
      setItems(m);
      setLow(l);
      setExp(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    (async () => {
      const { data } = await supabase.from("branches").select("id,name,is_primary").order("is_primary", { ascending: false }).order("name");
      setBranches((data ?? []) as Array<{ id: string; name: string; is_primary: boolean }>);
    })();
    (async () => {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - 30 * 86400000);
        setConsumption(await getConsumptionByMedicine(from.toISOString(), to.toISOString()));
      } catch {
        setConsumption({});
      }
    })();
  }, []);


  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = items;
    if (s) {
      arr = arr.filter(
        (i) =>
          i.trade_name.toLowerCase().includes(s) ||
          i.scientific_name.toLowerCase().includes(s) ||
          (i.barcode ?? "").toLowerCase().includes(s),
      );
    }
    if (sortKey !== "none") {
      const factor = sortDir === "asc" ? 1 : -1;
      const val = (m: Medicine): number | string => {
        switch (sortKey) {
          case "name":
            return (m.trade_name || "").toLowerCase();
          case "cost":
            return Number(m.small_unit_cost) || Number(m.purchase_price) || 0;
          case "price":
            return Number(m.small_unit_price) || Number(m.selling_price) || 0;
          case "expiry":
            return m.expiry_date ? new Date(m.expiry_date).getTime() : Number.MAX_SAFE_INTEGER;
          case "velocity":
            return consumption[m.id] ?? 0;
          case "qty":
            return m.quantity_in_stock || 0;
          case "minStock":
            return m.minimum_stock || 0;
          case "maxStock":
            return m.maximum_stock || 0;
          case "risk":
            return riskScore(m, items, settings);
          default:
            return statusRank(m);
        }
      };
      arr = [...arr].sort((a, b) => {
        const av = val(a);
        const bv = val(b);
        if (typeof av === "string" || typeof bv === "string") {
          return factor * String(av).localeCompare(String(bv), "ar");
        }
        return factor * (av - bv);
      });
    }
    return arr;
  }, [items, q, sortKey, sortDir, consumption, settings]);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId),
    [items, selectedId],
  );

  // Global analytics
  const totalRetail = items.reduce(
    (s, i) => s + (i.quantity_in_stock || 0) * (Number(i.selling_price) || 0),
    0,
  );
  const totalCost = items.reduce(
    (s, i) => s + (i.quantity_in_stock || 0) * (Number(i.purchase_price) || 0),
    0,
  );
  const distinctCount = items.length;
  const activeCount = items.filter((i) => (i.quantity_in_stock || 0) > 0).length;

  const colCount = 11 + (showBranch ? 1 : 0) + (showTransfer ? 1 : 0);

  const toggleSort = (k: Exclude<SortKey, "none">) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" || k === "expiry" ? "asc" : "desc");
    }
  };

  const moveToTrash = async (it: Medicine) => {
    if (!window.confirm(isAr ? `إرسال "${it.trade_name}" إلى السلة؟` : `Move "${it.trade_name}" to trash?`)) return;
    try {
      await deleteMedicine(it.id);
      setItems((prev) => prev.filter((m) => m.id !== it.id));
      toast.success(isAr ? "تم إرسال المادة إلى السلة" : "Item moved to trash");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };


  const quickAddToBasket = (it: Medicine) => {
    const min = it.minimum_stock || 0;
    const max = it.maximum_stock || min * 3 || (it.quantity_in_stock || 0) + 10;
    const suggested = Math.max(1, max - (it.quantity_in_stock || 0));
    addToCart({
      medicineId: it.id,
      barcode: it.barcode ?? null,
      name: it.trade_name,
      currentStock: it.quantity_in_stock || 0,
      minimum: min,
      maximum: max,
      suggestedQty: suggested,
      addedAt: new Date().toISOString(),
      status: "order",
    });
    toast.success(isAr ? `أُضيفت ${it.trade_name} إلى سلة الطلبات` : `Added ${it.trade_name} to basket`);
  };

  const exportCsv = () => {
    const headers = [
      "الباركود","اسم المادة التجاري","العلمي","التركيز","الشكل الصيدلاني","الشركة",
      "الوحدة","الرصيد الوحدة الكبرى","التعبئة","سعر الشراء","سعر البيع الاول","سعر بيع الجملة",
    ];
    const rows = items.map((i) => {
      const packing = Number((i as any).units_per_large) || 1;
      const qtyLarge = packing > 0 ? Math.floor((i.quantity_in_stock || 0) / packing) : 0;
      return [
        i.barcode ?? "",
        i.trade_name ?? "",
        i.scientific_name ?? "",
        (i as any).strength ?? "",
        (i as any).dosage_form ?? "",
        (i as any).company ?? "",
        (i as any).large_unit_name ?? (i as any).small_unit_name ?? "",
        qtyLarge,
        packing,
        Number(i.purchase_price) || 0,
        Number(i.selling_price) || 0,
        Number((i as any).wholesale_price) || Number(i.selling_price) || 0,
      ];
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyStocktake = async (id: string, newQty: number) => {
    await updateMedicine(id, { quantity_in_stock: newQty });
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, quantity_in_stock: newQty } : m)),
    );
    setStocktakeOpen(false);
  };

  return (
    <AppShell title={isAr ? "المخزن والجرد" : "Inventory"} medicine={selected}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Analytics cards */}
        <div className="p-4 border-b border-border bg-slate-950/40 shrink-0 grid grid-cols-4 gap-3">
          <MetricCard
            label={isAr ? "قيمة المخزن بسعر البيع" : "Inventory Value (Retail)"}
            value={`${Math.round(totalRetail).toLocaleString()} ${isAr ? "د.ع" : "IQD"}`}
            tone="emerald"
          />
          <MetricCard
            label={isAr ? "قيمة المخزن بسعر الكلفة" : "Inventory Value (Cost)"}
            value={`${Math.round(totalCost).toLocaleString()} ${isAr ? "د.ع" : "IQD"}`}
            tone="accent"
          />
          <MetricCard
            label={isAr ? "عدد المواد في المخزن" : "Distinct Items"}
            value={distinctCount.toLocaleString()}
            tone="emerald"
          />
          <MetricCard
            label={isAr ? "المواد الفعلية (لها رصيد)" : "Active Items"}
            value={activeCount.toLocaleString()}
            tone="accent"
          />
        </div>

        {/* View tabs */}
        <div className="px-3 pt-2 border-b border-border bg-slate-950/30 shrink-0 flex items-center gap-2">
          <button
            onClick={() => setView("main")}
            className={`px-3 py-1.5 text-xs rounded-t-md border border-b-0 ${view === "main" ? "bg-slate-900 text-emerald border-emerald/40" : "text-muted-foreground border-transparent"}`}
          >
            {isAr ? "المخزن" : "Inventory"}
          </button>
          <button
            onClick={() => setView("export")}
            className={`px-3 py-1.5 text-xs rounded-t-md border border-b-0 flex items-center gap-1.5 ${view === "export" ? "bg-slate-900 text-emerald border-emerald/40" : "text-muted-foreground border-transparent"}`}
          >
            <FileSpreadsheet className="size-3.5" />
            {isAr ? "نافذة التصدير" : "Export View"}
          </button>
        </div>

        {/* Search + sort */}
        <div className="p-3 border-b border-border bg-slate-950/30 shrink-0 flex items-center gap-3 flex-wrap">
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isAr ? "بحث بالباركود أو الاسم..." : "Search by barcode or name..."}
            className="flex-1 min-w-[220px] bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
            dir={isAr ? "rtl" : "ltr"}
          />
          {view === "main" && (
            <div className="flex items-center gap-1">
              <ColToggle on={showBranch} onClick={() => setShowBranch((v) => !v)}>
                {isAr ? "الفرع" : "Branch"}
              </ColToggle>
              <ColToggle on={showTransfer} onClick={() => setShowTransfer((v) => !v)}>
                {isAr ? "تحويل لفرع آخر" : "Transfer"}
              </ColToggle>
              {sortKey !== "none" && (
                <SortBtn active dir={sortDir} onClick={() => setSortKey("none")}>
                  {isAr ? "إلغاء الفرز" : "Clear sort"}
                </SortBtn>
              )}
            </div>
          )}
          <button
            onClick={() => setAuditOpen(true)}
            className="px-3 py-1.5 rounded-md bg-sky-500/15 border border-sky-500/40 text-sky-400 text-xs font-bold flex items-center gap-1.5 hover:bg-sky-500/25"
            title={isAr ? "جرد أولي للمواد" : "Initial stock audit"}
          >
            <ClipboardCheck className="size-3.5" />
            {isAr ? "جرد أولي للمواد" : "Initial Audit"}
          </button>
          {view === "export" && (
            <button
              onClick={exportCsv}
              className="px-3 py-1.5 rounded-md bg-emerald/15 border border-emerald/40 text-emerald text-xs font-bold flex items-center gap-1.5 hover:bg-emerald/25"
            >
              <Download className="size-3.5" />
              {isAr ? "تصدير CSV" : "Export CSV"}
            </button>
          )}
          <span className="text-[11px] text-muted-foreground font-mono">
            {isAr ? "منخفض" : "Low"}: <span className="text-accent font-bold">{low.length}</span>
            <span className="mx-2">•</span>
            {isAr ? "قرب الانتهاء" : "Expiring"}:{" "}
            <span className="text-accent font-bold">{exp.length}</span>
          </span>
        </div>

        {/* Grid */}
        {view === "main" ? (
        <section className="flex-1 overflow-auto">
          <table className="w-full text-right border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-950/80 backdrop-blur-md z-10">
              <tr className="border-b border-border">
                <SortTh sortKey="name" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "اسم المادة / الدواء" : "Item Name"}
                </SortTh>
                <SortTh className="w-32" sortKey="cost" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "سعر الشراء" : "Cost"}
                </SortTh>
                <SortTh className="w-32" sortKey="price" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "سعر البيع" : "Selling"}
                </SortTh>
                <SortTh className="w-24" sortKey="expiry" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "الإكسباير" : "Expiry"}
                </SortTh>
                <ITh className="w-20">{isAr ? "الموقع / الرف" : "Location"}</ITh>
                <SortTh className="w-24" sortKey="velocity" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "الصرف الشهري" : "Monthly"}
                </SortTh>
                <SortTh className="w-28" sortKey="qty" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "الرصيد والوحدات" : "Balance"}
                </SortTh>
                <ITh className="w-28">
                  <span className="flex items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => toggleSort("minStock")}
                      className={`hover:text-foreground ${sortKey === "minStock" ? "text-foreground" : ""}`}
                    >
                      {isAr ? "أدنى" : "Min"}
                      {sortKey === "minStock" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                    <span>/</span>
                    <button
                      type="button"
                      onClick={() => toggleSort("maxStock")}
                      className={`hover:text-foreground ${sortKey === "maxStock" ? "text-foreground" : ""}`}
                    >
                      {isAr ? "أعلى" : "Max"}
                      {sortKey === "maxStock" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </span>
                </ITh>
                <SortTh className="w-24" sortKey="risk" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "درجة الخطورة" : "Risk"}
                </SortTh>
                <SortTh className="w-28" sortKey="status" active={sortKey} dir={sortDir} onSort={toggleSort}>
                  {isAr ? "الحالة" : "Status"}
                </SortTh>
                {showBranch && <ITh className="w-24">{isAr ? "الفرع" : "Branch"}</ITh>}
                {showTransfer && <ITh className="w-16 text-center">{isAr ? "تحويل" : "Transfer"}</ITh>}
                <ITh className="w-24 text-center">{isAr ? "إجراءات" : "Actions"}</ITh>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading && (
                <tr>
                  <td colSpan={colCount} className="text-center py-8 text-muted-foreground text-sm">
                    {isAr ? "جاري التحميل..." : "Loading..."}
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="text-center py-16 text-muted-foreground text-sm">
                    {isAr
                      ? "لا توجد مواد بعد. أضف مواد من صفحة \"قائمة المواد\"."
                      : "No items yet."}
                  </td>
                </tr>
              )}

              {filtered.map((it) => {
                const flags = computeFlags(it, items, settings);
                const tint = flags[0]?.color;
                const active = it.id === selectedId;
                const packing = Math.max(1, Number(it.units_per_large) || 1);
                const smallUnit = it.small_unit_name || (isAr ? "قطعة" : "Unit");
                const largeUnit = it.large_unit_name || (isAr ? "علبة" : "Pack");
                const smallCost = Number(it.small_unit_cost) || Number(it.purchase_price) || 0;
                const largeCost = Number(it.large_unit_cost) || smallCost * packing;
                const smallPrice = Number(it.small_unit_price) || Number(it.selling_price) || 0;
                const largePrice = Number(it.large_unit_price) || smallPrice * packing;
                const qty = it.quantity_in_stock || 0;
                const largeQty = Math.floor(qty / packing);
                const remainder = qty - largeQty * packing;
                const risk = riskScore(it, items, settings);
                const band = riskBand(risk);
                const status = stockStatus(it);
                const meta = STATUS_META[status];
                const dte = daysToExpiry(it);
                return (
                  <tr
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`cursor-pointer hover:bg-slate-800/60 ${
                      active ? "bg-emerald/10" : ""
                    }`}
                    style={
                      tint && !active
                        ? { backgroundColor: `${tint}22`, borderRight: `3px solid ${tint}` }
                        : active
                          ? { borderRight: `3px solid var(--emerald, #10b981)` }
                          : undefined
                    }
                  >
                    {/* 1 — Item name */}
                    <td className="px-3 py-2">
                      <div className="font-medium leading-tight">{it.trade_name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono leading-tight">
                        {it.scientific_name}
                      </div>
                    </td>
                    {/* 2 — Cost (stacked) */}
                    <td className="px-3 py-2 font-mono text-[11px] leading-tight">
                      <div className="font-bold text-foreground">
                        {Math.round(smallCost).toLocaleString()}
                        <span className="text-muted-foreground font-sans"> / {smallUnit}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {Math.round(largeCost).toLocaleString()}
                        <span className="font-sans"> / {largeUnit}</span>
                      </div>
                    </td>
                    {/* 3 — Selling price (stacked) */}
                    <td className="px-3 py-2 font-mono text-[11px] leading-tight">
                      <div className="font-bold text-emerald">
                        {Math.round(smallPrice).toLocaleString()}
                        <span className="text-muted-foreground font-sans"> / {smallUnit}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {Math.round(largePrice).toLocaleString()}
                        <span className="font-sans"> / {largeUnit}</span>
                      </div>
                    </td>
                    {/* 4 — Expiry */}
                    <td className="px-3 py-2 font-mono text-[11px] leading-tight">
                      <div className={dte < 0 ? "text-destructive font-bold" : dte <= 90 ? "text-amber-600 font-bold" : ""}>
                        {it.expiry_date ?? "—"}
                      </div>
                      {Number.isFinite(dte) && (
                        <div className="text-[10px] text-muted-foreground font-sans">
                          {dte < 0
                            ? isAr ? "منتهي" : "expired"
                            : isAr ? `${dte} يوم` : `${dte} d`}
                        </div>
                      )}
                    </td>
                    {/* 5 — Shelf location */}
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">{it.location || "—"}</td>
                    {/* 6 — Monthly consumption */}
                    <td className="px-3 py-2 font-mono text-[11px] font-bold">
                      {(consumption[it.id] ?? 0).toLocaleString()}
                      <span className="font-sans text-[10px] text-muted-foreground"> /{isAr ? "شهر" : "mo"}</span>
                    </td>
                    {/* 7 — Balance (stacked dual units) */}
                    <td className="px-3 py-2 font-mono text-[11px] leading-tight">
                      <div className={`font-bold ${qty <= 0 ? "text-destructive" : "text-emerald"}`}>
                        {qty.toLocaleString()}
                        <span className="text-muted-foreground font-sans"> {smallUnit}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {largeQty.toLocaleString()}
                        <span className="font-sans"> {largeUnit}</span>
                        {remainder > 0 && <span className="font-sans"> + {remainder}</span>}
                      </div>
                    </td>
                    {/* 7b — Min / Max thresholds */}
                    <td className="px-3 py-2 font-mono text-[11px] leading-tight">
                      {(() => {
                        const minL = it.minimum_stock || 0;
                        const maxL = it.maximum_stock || 0;
                        const under = minL > 0 && qty < minL;
                        const over = maxL > 0 && qty > maxL;
                        return (
                          <>
                            <div className={under ? "font-bold text-amber-600" : "text-muted-foreground"}>
                              <span className="font-sans">{isAr ? "أدنى" : "Min"}: </span>
                              {minL.toLocaleString()}
                              {under && (
                                <span className="ml-1 font-sans text-[9px] px-1 rounded bg-amber-500/20 text-amber-600">
                                  {isAr ? "نقص" : "low"}
                                </span>
                              )}
                            </div>
                            <div className={over ? "font-bold text-[#4A6B82]" : "text-muted-foreground"}>
                              <span className="font-sans">{isAr ? "أعلى" : "Max"}: </span>
                              {maxL ? maxL.toLocaleString() : "—"}
                              {over && (
                                <span className="ml-1 font-sans text-[9px] px-1 rounded bg-[#4A6B82]/20 text-[#4A6B82]">
                                  {isAr ? "فائض" : "over"}
                                </span>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                    {/* 8 — Risk level */}
                    <td className="px-3 py-2">
                      <span
                        className="px-2 py-0.5 text-[10px] font-bold rounded"
                        style={{ backgroundColor: `${band.color}22`, color: band.color }}
                        title={`${isAr ? "المؤشر" : "Index"}: ${risk}`}
                      >
                        {isAr ? band.label : band.labelEn} · {risk}
                      </span>
                    </td>
                    {/* 9 — Status badge */}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <span
                          className="px-2 py-0.5 text-[10px] font-bold rounded"
                          style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
                        >
                          {isAr ? meta.ar : meta.en}
                        </span>
                        {flags.map((f) => (
                          <span
                            key={f.key}
                            className="px-1.5 py-0.5 text-[10px] font-bold rounded"
                            style={{ backgroundColor: `${f.color}33`, color: f.color }}
                            title={f.label}
                          >
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    {/* 10 — Branch (toggleable) */}
                    {showBranch && (
                      <td className="px-3 py-2 text-[11px] font-bold">
                        {branches.find((b) => b.is_primary)?.name ?? (isAr ? "الفرع الرئيسي" : "Main")}
                      </td>
                    )}
                    {/* 11 — Transfer (toggleable) */}
                    {showTransfer && (
                      <td className="px-2 py-2 text-center">
                        <button
                          title={isAr ? "تحويل لفرع آخر" : "Transfer to another branch"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTransferItem(it);
                          }}
                          className="p-1.5 rounded-md hover:bg-sky-500/20 text-sky-600"
                        >
                          <ArrowLeftRight className="size-4" />
                        </button>
                      </td>
                    )}
                    {/* 12 — Actions: basket + trash */}
                    <td className="px-2 py-2 text-center whitespace-nowrap">
                      <button
                        title={isAr ? "أضف إلى سلة الطلبات" : "Add to basket"}
                        onClick={(e) => {
                          e.stopPropagation();
                          quickAddToBasket(it);
                        }}
                        className="p-1.5 rounded-md hover:bg-emerald/15 text-emerald"
                      >
                        <ShoppingBasket className="size-4" />
                      </button>
                      <button
                        title={isAr ? "إرسال للسلة" : "Move to trash"}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveToTrash(it);
                        }}
                        className="p-1.5 rounded-md hover:bg-destructive/15 text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>

          </table>
        </section>
        ) : (
          <ExportView items={items} isAr={isAr} />
        )}

        {/* Bottom toolbar */}
        <div className="border-t border-border bg-slate-950/80 backdrop-blur-md p-3 shrink-0 flex items-center justify-center gap-2">
          <ToolBtn icon={<RefreshCw className="size-4" />} onClick={reload}>
            {isAr ? "تحديث" : "Refresh"}
          </ToolBtn>
          <ToolBtn
            icon={<Search className="size-4" />}
            onClick={() => searchRef.current?.focus()}
          >
            {isAr ? "بحث" : "Search"}
          </ToolBtn>
          <ToolBtn
            icon={<ChevronsLeft className="size-4" />}
            onClick={() => setStocktakeOpen(true)}
            emerald
          >
            {isAr ? "جرد سريع" : "Fast Stocktake"}
          </ToolBtn>
          <ToolBtn icon={<Printer className="size-4" />} onClick={() => window.print()}>
            {isAr ? "طباعة" : "Print"}
          </ToolBtn>
          <ToolBtn
            icon={<LogOut className="size-4" />}
            onClick={() => window.history.back()}
            danger
          >
            {isAr ? "خروج" : "Exit"}
          </ToolBtn>
        </div>
      </div>

      {stocktakeOpen && (
        <FastStocktakeModal
          items={items}
          isAr={isAr}
          onClose={() => setStocktakeOpen(false)}
          onApply={applyStocktake}
        />
      )}

      {auditOpen && (
        <InitialStockAuditDialog
          items={items}
          onClose={() => setAuditOpen(false)}
          onSaved={reload}
        />
      )}

      {transferItem && (
        <BranchTransferModal
          item={transferItem}
          branches={branches}
          isAr={isAr}
          onClose={() => setTransferItem(null)}
          onDone={(newQty) => {
            setItems((prev) => prev.map((m) => m.id === transferItem.id ? { ...m, quantity_in_stock: newQty } : m));
            setTransferItem(null);
          }}
        />
      )}
    </AppShell>
  );
}

function BranchTransferModal({
  item, branches, isAr, onClose, onDone,
}: {
  item: Medicine;
  branches: Array<{ id: string; name: string; is_primary: boolean }>;
  isAr: boolean;
  onClose: () => void;
  onDone: (newQty: number) => void;
}) {
  const primary = branches.find((b) => b.is_primary);
  const destinations = branches.filter((b) => !b.is_primary);
  const [qty, setQty] = useState<string>("1");
  const [destId, setDestId] = useState<string>(destinations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const execute = async () => {
    const n = Math.max(1, Math.floor(Number(qty) || 0));
    if (!destId) { toast.error(isAr ? "اختر الفرع المستقبل" : "Pick destination"); return; }
    if (n > (item.quantity_in_stock || 0)) {
      toast.error(isAr ? "الكمية أكبر من الرصيد المتاح" : "Quantity exceeds available stock");
      return;
    }
    setBusy(true);
    try {
      const newQty = (item.quantity_in_stock || 0) - n;
      await updateMedicine(item.id, { quantity_in_stock: newQty });
      // Credit destination branch
      const { data: existing } = await supabase
        .from("medicine_branch_stocks")
        .select("id,quantity")
        .eq("medicine_id", item.id)
        .eq("branch_id", destId)
        .maybeSingle();
      if (existing) {
        await supabase.from("medicine_branch_stocks")
          .update({ quantity: Number((existing as any).quantity || 0) + n, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id);
      } else {
        await supabase.from("medicine_branch_stocks").insert({
          medicine_id: item.id, branch_id: destId, quantity: n,
        });
      }
      await supabase.from("stock_movements").insert({
        medicine_id: item.id, delta: -n, reason: `branch_transfer_out:${destId}`,
      });
      toast.success(isAr ? `تم تحويل ${n} إلى الفرع` : `Transferred ${n}`);
      onDone(newQty);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose} dir={isAr ? "rtl" : "ltr"}>
      <div className="w-full max-w-md bg-white border-2 border-sky-500/40 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 bg-sky-50 flex items-center gap-2">
          <ArrowLeftRight className="size-4 text-sky-600" />
          <h3 className="flex-1 text-sm font-bold text-sky-800">
            {isAr ? "تحويل المادة بين الفروع" : "Transfer between branches"}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-[11px] text-slate-600">{isAr ? "المادة" : "Item"}</p>
            <p className="text-sm font-bold text-slate-900 mt-0.5">{item.trade_name}</p>
            <p className="text-[11px] text-slate-600 mt-1">
              {isAr ? "الرصيد الحالي" : "Current"}:{" "}
              <span className="font-mono font-bold text-emerald-700">{item.quantity_in_stock}</span>
            </p>
          </div>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
              {isAr ? "من الفرع" : "From branch"}
            </span>
            <input
              value={primary?.name ?? "الفرع الرئيسي"}
              disabled
              className="mt-1 w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
              {isAr ? "إلى الفرع المستقبل" : "Destination branch"}
            </span>
            <select
              value={destId}
              onChange={(e) => setDestId(e.target.value)}
              className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400"
            >
              {destinations.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
              {isAr ? "الكمية المطلوب تحويلها" : "Quantity to transfer"}
            </span>
            <input
              type="number"
              min={1}
              max={item.quantity_in_stock}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-sky-400"
            />
          </label>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700">
            {isAr ? "إلغاء" : "Cancel"}
          </button>
          <button
            onClick={execute}
            disabled={busy}
            className="px-5 py-2 rounded-lg bg-sky-600 text-white text-xs font-bold hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "..." : (isAr ? "تنفيذ التحويل" : "Execute transfer")}
          </button>
        </div>
      </div>
    </div>
  );
}


function SortTh({
  children,
  className = "",
  sortKey,
  active,
  dir,
  onSort,
}: {
  children?: React.ReactNode;
  className?: string;
  sortKey: Exclude<SortKey, "none">;
  active: SortKey;
  dir: "asc" | "desc";
  onSort: (k: Exclude<SortKey, "none">) => void;
}) {
  const on = active === sortKey;
  return (
    <th className={`px-3 py-2 text-right ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
          on ? "text-emerald" : "text-muted-foreground hover:text-emerald"
        }`}
      >
        <span>{children}</span>
        <span className="text-[9px] leading-none">{on ? (dir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </button>
    </th>
  );
}

function ColToggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1.5 rounded-md border text-[11px] font-bold flex items-center gap-1 ${
        on
          ? "bg-emerald/15 border-emerald/40 text-emerald"
          : "bg-secondary border-border text-muted-foreground"
      }`}
    >
      {on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      {children}
    </button>
  );
}

function ITh({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-right ${className}`}
    >
      {children}
    </th>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "accent";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald border-emerald/30 bg-emerald/5"
      : "text-accent border-accent/30 bg-accent/5";
  return (
    <div className={`border rounded-lg p-3 ${color}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-2xl font-mono font-bold mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function SortBtn({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md border text-[11px] font-bold flex items-center gap-1 ${
        active ? "bg-emerald/15 border-emerald/40 text-emerald" : "bg-slate-800 border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <ArrowUpDown className="size-3" />
      {children}
      {active && <span className="text-[9px]">{dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function ExportView({ items, isAr }: { items: Medicine[]; isAr: boolean }) {
  return (
    <section className="flex-1 overflow-auto">
      <table className="w-full text-right border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-950/85 backdrop-blur-md z-10 text-emerald">
          <tr className="border-b border-border">
            <ITh className="w-28">{isAr ? "الباركود" : "Barcode"}</ITh>
            <ITh>{isAr ? "الاسم التجاري" : "Trade name"}</ITh>
            <ITh>{isAr ? "العلمي" : "Scientific"}</ITh>
            <ITh className="w-20">{isAr ? "التركيز" : "Strength"}</ITh>
            <ITh className="w-24">{isAr ? "الشكل" : "Form"}</ITh>
            <ITh className="w-28">{isAr ? "الشركة" : "Company"}</ITh>
            <ITh className="w-20">{isAr ? "الوحدة" : "Unit"}</ITh>
            <ITh className="w-24">{isAr ? "الرصيد الكبرى" : "Qty (large)"}</ITh>
            <ITh className="w-20">{isAr ? "التعبئة" : "Pack"}</ITh>
            <ITh className="w-24">{isAr ? "سعر الشراء" : "Cost"}</ITh>
            <ITh className="w-24">{isAr ? "سعر البيع الأول" : "Retail"}</ITh>
            <ITh className="w-24">{isAr ? "سعر الجملة" : "Wholesale"}</ITh>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map((i) => {
            const packing = Number((i as any).units_per_large) || 1;
            const qtyLarge = packing > 0 ? Math.floor((i.quantity_in_stock || 0) / packing) : 0;
            return (
              <tr key={i.id} className="hover:bg-slate-800/50">
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{i.barcode ?? "—"}</td>
                <td className="px-3 py-2 font-medium">{i.trade_name}</td>
                <td className="px-3 py-2 text-muted-foreground">{i.scientific_name || "—"}</td>
                <td className="px-3 py-2">{(i as any).strength ?? "—"}</td>
                <td className="px-3 py-2">{(i as any).dosage_form ?? "—"}</td>
                <td className="px-3 py-2">{(i as any).company ?? "—"}</td>
                <td className="px-3 py-2">{(i as any).large_unit_name ?? (i as any).small_unit_name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-emerald">{qtyLarge}</td>
                <td className="px-3 py-2 font-mono">{packing}</td>
                <td className="px-3 py-2 font-mono">{Number(i.purchase_price).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono">{Number(i.selling_price).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono">{Number((i as any).wholesale_price || i.selling_price).toLocaleString()}</td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={12} className="text-center py-16 text-muted-foreground">
                {isAr ? "لا توجد بيانات." : "No data."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function ToolBtn({
  children,
  icon,
  onClick,
  emerald,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  emerald?: boolean;
  danger?: boolean;
}) {
  const cls = emerald
    ? "bg-emerald text-primary-foreground hover:bg-emerald/90 shadow-[0_0_18px_-4px] shadow-emerald/60"
    : danger
      ? "bg-slate-800 border border-border text-destructive hover:bg-destructive/15"
      : "bg-slate-800 border border-border text-foreground hover:bg-slate-700";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition ${cls}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function FastStocktakeModal({
  items,
  isAr,
  onClose,
  onApply,
}: {
  items: Medicine[];
  isAr: boolean;
  onClose: () => void;
  onApply: (id: string, newQty: number) => void;
}) {
  const [shelf, setShelf] = useState("");
  const [code, setCode] = useState("");
  const [newQty, setNewQty] = useState<string>("");
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const found = useMemo(() => {
    const s = code.trim().toLowerCase();
    if (!s) return undefined;
    return items.find(
      (m) =>
        (m.barcode ?? "").toLowerCase() === s ||
        m.trade_name.toLowerCase().includes(s) ||
        m.scientific_name.toLowerCase().includes(s),
    );
  }, [items, code]);

  const unitLabel = found?.small_unit_name || (isAr ? "قطعة" : "Piece");

  const submit = () => {
    if (!found) return;
    const n = parseInt(newQty, 10);
    if (Number.isNaN(n) || n < 0) return;
    onApply(found.id, n);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir={isAr ? "rtl" : "ltr"}
        className="w-full max-w-lg bg-slate-900 border border-emerald/30 rounded-xl shadow-[0_30px_80px_-20px_rgba(16,185,129,0.35)] overflow-hidden"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-3 bg-emerald/10 border-b border-emerald/30">
          <h3 className="text-sm font-bold text-emerald">
            {isAr
              ? "تعديل سريع لأرصدة المواد الحالية"
              : "Fast Stocktake — Adjust Current Balances"}
          </h3>
          <button
            onClick={onClose}
            className="size-7 grid place-items-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={isAr ? "رقم الرف" : "Shelf No."}>
              <input
                value={shelf}
                onChange={(e) => setShelf(e.target.value)}
                className="w-full bg-slate-800 border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
              />
            </Field>
            <Field label={isAr ? "بحث رمز / باركود" : "Search code / barcode"}>
              <input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full bg-slate-800 border border-emerald/40 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/50 font-mono"
              />
            </Field>
          </div>

          {/* Current status */}
          <div className="border border-border rounded-lg p-4 bg-slate-950/50 min-h-[92px]">
            {found ? (
              <div className="space-y-2">
                <p className="text-sm font-bold text-foreground">{found.trade_name}</p>
                <p className="text-[11px] text-muted-foreground font-mono">
                  {found.scientific_name}
                </p>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {isAr ? "الرصيد الحالي" : "Current balance"}
                  </span>
                  <span className="font-mono text-lg text-emerald font-bold">
                    {found.quantity_in_stock}{" "}
                    <span className="text-xs text-muted-foreground">{unitLabel}</span>
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                {isAr
                  ? "أدخل الرمز أو الباركود لعرض حالة المادة"
                  : "Enter a code or barcode to view the item"}
              </p>
            )}
          </div>

          <Field label={`${isAr ? "الرصيد الجديد للوحدة 1" : "New balance (unit 1)"} — ${unitLabel}`}>
            <input
              type="number"
              min={0}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              disabled={!found}
              className="w-full bg-slate-800 border border-border rounded-md px-3 py-2 text-lg font-mono font-bold text-emerald outline-none focus:ring-2 focus:ring-emerald/40 disabled:opacity-40"
            />
          </Field>

          <div className="text-[11px] leading-relaxed p-3 rounded-md border border-accent/30 bg-accent/5 text-accent">
            {isAr
              ? "ملاحظة هامة: يكون إضافة الرصيد للمنتج = حاصل جمع ( الرصيد الجديد للوحدة 1 + الرصيد الجديد للوحدة 2 )"
              : "Note: The added stock = (new balance unit 1 + new balance unit 2)."}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-slate-950/60">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-xs font-bold bg-slate-800 border border-border text-foreground hover:bg-slate-700"
          >
            {isAr ? "خروج" : "Exit"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-xs font-bold bg-pink-500/15 border border-pink-500/40 text-pink-400 hover:bg-pink-500/25"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>
          <button
            onClick={submit}
            disabled={!found || newQty === ""}
            className="px-4 py-2 rounded-md text-xs font-bold bg-emerald text-primary-foreground hover:bg-emerald/90 disabled:opacity-40 shadow-[0_0_18px_-4px] shadow-emerald/60"
          >
            {isAr ? "تعديل" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
