import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Printer, Barcode as BarcodeIcon, ScanBarcode, Save, Trash2, Plus, LogOut, FileSpreadsheet, History, PackageSearch, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  createMedicine,
  deleteMedicine,
  listMedicines,
  updateMedicine,
  type Medicine,
} from "@/lib/db";
import { BarcodePrintPanel } from "@/components/barcode-print";
import { roundUpTo250, priceFromMarginOnSale } from "@/lib/pharmacy";
import { setMedicineColor } from "@/lib/highlight-colors";
import { AddMaterialPanel, type AddMaterialSeed } from "@/components/add-material-modal";
import { getBarcodeAliases, setBarcodeAliases } from "@/lib/barcode-aliases";


export const Route = createFileRoute("/products")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "بيانات المواد — Breef Pharmacy" },
      { name: "description", content: "إدارة قاعدة بيانات الأدوية." },
    ],
  }),
  component: ProductsPage,
});

const emptyForm: Partial<Medicine> = {
  barcode: "",
  scientific_name: "",
  trade_name: "",
  strength: "",
  dosage_form: "",
  company: "",
  category: "",
  purchase_price: 0,
  selling_price: 0,
  quantity_in_stock: 0,
  minimum_stock: 0,
  maximum_stock: 0,
  expiry_date: "",
  batch_number: "",
  location: "",
  notes: "",
  is_active: true,
  large_unit_name: "باكيت",
  large_unit_price: 0,
  large_unit_cost: 0,
  small_unit_name: "شريط",
  small_unit_price: 0,
  small_unit_cost: 0,
  units_per_large: 1,
  daily_frequency: 1,
  meal_timing: "any",
  publish_online: false,
  highlight_color: "",
};

function errMsg(e: unknown): string {
  if (!e) return "خطأ غير معروف";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e === "object") {
    const a = e as { message?: unknown; details?: unknown; hint?: unknown };
    if (typeof a.message === "string") return a.message;
    if (typeof a.details === "string") return a.details;
    if (typeof a.hint === "string") return a.hint;
    try { return JSON.stringify(e); } catch { return "خطأ غير معروف"; }
  }
  return String(e);
}

// Wholesale / agent prices + "حبة و أيام" cycle length now live on the medicine row.
type Extras = { wholesale_large: number; wholesale_small: number; days_per_cycle: number };
const emptyExtras: Extras = { wholesale_large: 0, wholesale_small: 0, days_per_cycle: 0 };
function extrasFromMedicine(m: Medicine | null | undefined): Extras {
  if (!m) return emptyExtras;
  return {
    wholesale_large: Number(m.wholesale_large_price ?? 0),
    wholesale_small: Number(m.wholesale_small_price ?? 0),
    days_per_cycle: Number(m.days_per_cycle ?? 0),
  };
}
function extrasToPatch(ex: Extras): Partial<Medicine> {
  return {
    wholesale_large_price: ex.wholesale_large,
    wholesale_small_price: ex.wholesale_small,
    days_per_cycle: ex.days_per_cycle,
  };
}


type Movement = {
  id: string;
  created_at: string;
  delta: number;
  reason: string;
};

function ProductsPage() {
  const [items, setItems] = useState<Medicine[]>([]);
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Medicine>>(emptyForm);
  const [extras, setExtrasState] = useState<Extras>(emptyExtras);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondUnit, setSecondUnit] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [printOpen, setPrintOpen] = useState(false);
  const [multiOpen, setMultiOpen] = useState(false);

  const [categories, setCategories] = useState<string[]>([]);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  // Pricing mode: enter selling prices as a fixed IQD amount, or as a margin % of the sale price.
  const [priceMode, setPriceMode] = useState<"amount" | "pct">("amount");
  const [retailPct, setRetailPct] = useState(0);
  const [specialPct, setSpecialPct] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const movementRef = useRef<HTMLElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("medicine_categories").select("name").order("name");
      setCategories(((data ?? []) as Array<{ name: string }>).map((c) => c.name).filter(Boolean));
    })();
  }, []);

  const addCategory = async () => {
    const name = prompt("اسم التصنيف الجديد:");
    if (!name) return;
    const clean = name.trim();
    if (!clean) return;
    try {
      await supabase.from("medicine_categories").insert({ name: clean });
      setCategories((c) => Array.from(new Set([...c, clean])).sort());
      setForm((f) => ({ ...f, category: clean }));
      toast.success("تمت إضافة التصنيف");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const autoBarcode = () => {
    const gen = `BR${Date.now().toString().slice(-10)}`;
    setForm((f) => ({ ...f, barcode: gen }));
  };

  /**
   * Auto-split large-unit price to small-unit price with round-up to nearest 250 IQD.
   * Also mirrors cost split with same rounding-up rule.
   */
  const setLargeWithSplit = <K extends "large_unit_price" | "large_unit_cost" | "units_per_large">(key: K, val: number) => {
    setForm((f) => {
      const next: Partial<Medicine> = { ...f, [key]: val } as Partial<Medicine>;
      const packing = Math.max(1, Number(next.units_per_large ?? 1) || 1);
      if (packing > 1) {
        const price = Number(next.large_unit_price ?? 0) || 0;
        const cost = Number(next.large_unit_cost ?? 0) || 0;
        next.small_unit_price = roundUpTo250(price / packing);
        next.small_unit_cost = roundUpTo250(cost / packing);
      }
      return next;
    });
    // Fractional wholesale price for small unit: wholesale_large / packing, rounded UP to nearest 250 IQD.
    if (key === "units_per_large") {
      setExtrasState((x) => ({
        ...x,
        wholesale_small: val > 1 ? roundUpTo250((x.wholesale_large || 0) / val) : x.wholesale_small,
      }));
    }
    if (key === "units_per_large" && val > 1 && !secondUnit) setSecondUnit(true);
  };

  /** Update the primary-unit wholesale price and auto-split into the secondary-unit wholesale (↑250). */
  const setWholesaleLarge = (val: number) => {
    setExtrasState((x) => {
      const packing = Math.max(1, Number(form.units_per_large ?? 1) || 1);
      return {
        ...x,
        wholesale_large: val,
        wholesale_small: packing > 1 ? roundUpTo250(val / packing) : val,
      };
    });
  };


  /** Percentage pricing: derive the selling price from cost using margin-on-sale. */
  const applyRetailPct = (pct: number) => {
    setRetailPct(pct);
    setLargeWithSplit("large_unit_price", priceFromMarginOnSale(Number(form.large_unit_cost ?? 0) || 0, pct));
  };
  const applySpecialPct = (pct: number) => {
    setSpecialPct(pct);
    setWholesaleLarge(priceFromMarginOnSale(Number(form.large_unit_cost ?? 0) || 0, pct));
  };

  const scrollToLedger = () => {
    movementRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    movementRef.current?.classList.add("ring-2", "ring-emerald/50");
    setTimeout(() => movementRef.current?.classList.remove("ring-2", "ring-emerald/50"), 1200);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listMedicines();
      setItems(list);
    } catch (e) { setErr(errMsg(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!activeId) { setMovements([]); return; }
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("stock_movements")
        .select("id,created_at,delta,reason")
        .eq("medicine_id", activeId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancel) setMovements((data ?? []) as Movement[]);
    })();
    return () => { cancel = true; };
  }, [activeId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (i) =>
        i.trade_name.toLowerCase().includes(s) ||
        i.scientific_name.toLowerCase().includes(s) ||
        (i.barcode ?? "").includes(s),
    );
  }, [items, q]);

  const active = items.find((i) => i.id === activeId) ?? null;

  const openBlank = () => {
    // Launch the dedicated "Add New Material" modal with dynamic name concat.
    setAddPanelOpen(true);
  };

  /** Pre-fill the full editor with the seed values from the Add-Material modal. */
  const applyAddSeed = (seed: AddMaterialSeed) => {
    setCreating(true);
    setActiveId(null);
    setForm({
      ...emptyForm,
      trade_name: seed.trade_name,
      scientific_name: seed.scientific_name,
      company: seed.company,
      category: seed.category,
      dosage_form: seed.dosage_form,
      strength: seed.strength,
    });
    setExtrasState(emptyExtras);
    setSecondUnit(false);
    setErr(null);
    setAddPanelOpen(false);
  };

  const openExisting = (m: Medicine) => {
    setCreating(false);
    setActiveId(m.id);
    setForm(m);
    const ex = extrasFromMedicine(m);
    setExtrasState(ex);
    setSecondUnit(!!(m.small_unit_name && (m.units_per_large ?? 1) > 1));
    setErr(null);
  };

  const setF = <K extends keyof Medicine>(key: K, value: Medicine[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const trade = (form.trade_name ?? "").trim();
    const sci = (form.scientific_name ?? "").trim();
    const barcode = (form.barcode ?? "").trim();
    if (!trade) { toast.error("الاسم التجاري مطلوب"); return; }
    if (!sci) { toast.error("الاسم العلمي مطلوب"); return; }

    // If no second unit, mirror the large unit into small so pricing stays consistent.
    const payload: Partial<Medicine> = { ...form };
    if (!secondUnit) {
      payload.small_unit_name = payload.large_unit_name || "وحدة";
      payload.units_per_large = 1;
      payload.small_unit_cost = payload.large_unit_cost ?? 0;
      payload.small_unit_price = payload.large_unit_price ?? 0;
    }

    setBusy(true);
    setErr(null);
    try {
      if (creating) {
        if (barcode) {
          const { data: dup } = await supabase
            .from("medicines").select("id,trade_name").eq("barcode", barcode).limit(1);
          if (dup && dup.length) {
            toast.error(`يوجد مادة بنفس الباركود: ${dup[0].trade_name}`);
            setBusy(false); return;
          }
        }
        const created = await createMedicine({ ...payload, ...extrasToPatch(extras), trade_name: trade, scientific_name: sci, barcode: barcode || null });
        setMedicineColor(created.id, created.highlight_color || null);
        await refresh();
        toast.success(`تم حفظ: ${created.trade_name}`);
        openExisting(created);
      } else if (activeId) {
        const upd = await updateMedicine(activeId, { ...payload, ...extrasToPatch(extras) });
        setMedicineColor(upd.id, upd.highlight_color || null);
        setForm(upd);
        setItems((list) => list.map((it) => it.id === upd.id ? upd : it));
        toast.success("تم تحديث المادة");
      }
    } catch (e) {
      const m = errMsg(e); setErr(m); toast.error(`فشل الحفظ: ${m}`);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!activeId) return;
    if (!confirm("حذف هذه المادة نهائياً؟")) return;
    setBusy(true);
    try {
      await deleteMedicine(activeId);
      setActiveId(null); setForm(emptyForm); setExtrasState(emptyExtras); setCreating(false);
      await refresh();
      toast.success("تم الحذف");
    } catch (e) { setErr(errMsg(e)); toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const exit = () => {
    setActiveId(null); setCreating(false); setForm(emptyForm); setExtrasState(emptyExtras); setErr(null);
  };

  const importExcel = async (file: File) => {
    // Minimal CSV/XLSX intake: parse first sheet, expect columns trade_name, scientific_name, barcode, cost, price, quantity.
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
      let ok = 0;
      for (const r of rows) {
        const trade = String(r["trade_name"] ?? r["الاسم التجاري"] ?? "").trim();
        if (!trade) continue;
        const sci = String(r["scientific_name"] ?? r["الاسم العلمي"] ?? trade).trim();
        await createMedicine({
          trade_name: trade,
          scientific_name: sci,
          barcode: String(r["barcode"] ?? r["الباركود"] ?? "") || null,
          large_unit_cost: Number(r["cost"] ?? r["الكلفة"] ?? 0) || 0,
          large_unit_price: Number(r["price"] ?? r["البيع"] ?? 0) || 0,
          small_unit_cost: Number(r["cost"] ?? r["الكلفة"] ?? 0) || 0,
          small_unit_price: Number(r["price"] ?? r["البيع"] ?? 0) || 0,
          quantity_in_stock: Number(r["quantity"] ?? r["الكمية"] ?? 0) || 0,
          large_unit_name: String(r["large_unit_name"] ?? "باكيت"),
          small_unit_name: String(r["small_unit_name"] ?? "شريط"),
          units_per_large: Number(r["units_per_large"] ?? 1) || 1,
        });
        ok++;
      }
      await refresh();
      toast.success(`تم استيراد ${ok} مادة`);
    } catch (e) {
      toast.error(`فشل الاستيراد: ${errMsg(e)}`);
    }
  };

  const editing = creating || activeId;
  const barcodeItem = active && active.barcode
    ? { id: active.id, barcode: active.barcode, tradeName: active.trade_name, price: active.selling_price }
    : null;

  return (
    <AppShell title="بيانات المواد">
      <div className="flex-1 flex overflow-hidden text-xs">
        {/* List */}
        <aside className="w-60 border-l border-border flex flex-col bg-slate-950/40 shrink-0">
          <div className="p-2 border-b border-border space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                المواد ({items.length})
              </span>
              <button
                onClick={openBlank}
                className="px-2 py-1 rounded-md bg-emerald text-primary-foreground text-[10px] font-bold"
              >
                + جديد
              </button>
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث..."
              className="w-full bg-slate-800 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-emerald/40"
            />
          </div>
          <div className="flex-1 overflow-auto divide-y divide-border/40">
            {loading && <p className="p-3 text-center text-muted-foreground">جاري التحميل...</p>}
            {!loading && filtered.length === 0 && (
              <p className="p-4 text-center text-muted-foreground leading-relaxed">
                لا توجد مواد. اضغط + جديد.
              </p>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => openExisting(m)}
                className={`w-full text-right px-2 py-1.5 hover:bg-emerald/5 transition ${
                  m.id === activeId ? "bg-emerald/10 border-r-2 border-emerald" : ""
                }`}
              >
                <p className="text-xs font-bold truncate">{m.trade_name}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{m.scientific_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  مخزون: <span className="text-emerald font-mono">{m.quantity_in_stock}</span>
                </p>
              </button>
            ))}
          </div>
        </aside>

        {/* Form */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {addPanelOpen ? (
            <div className="flex-1 overflow-auto p-3">
              <AddMaterialPanel
                categories={categories}
                onCancel={() => setAddPanelOpen(false)}
                onConfirm={applyAddSeed}
              />
            </div>
          ) : !editing ? (
            <div className="flex-1 grid place-items-center p-8 text-center">
              <div className="space-y-3">
                <p className="text-muted-foreground">اختر مادة من القائمة أو أنشئ مادة جديدة.</p>
                <div className="flex gap-2 justify-center">
                  <button onClick={openBlank} className="px-4 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold">
                    + إضافة مادة جديدة
                  </button>
                  <button
                    onClick={() => setAddPanelOpen(true)}
                    className="px-4 py-2 rounded-lg bg-slate-800 border border-emerald/40 text-emerald text-xs font-bold hover:bg-emerald/10"
                  >
                    ✦ لوحة مواد عامة
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden p-3 gap-2.5">
              {err && (
                <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2 py-1">
                  {err}
                </p>
              )}

              {/* Core row: trade / scientific / barcode + print icons */}
              <section className="grid grid-cols-12 gap-2">
                <Field label="الاسم التجاري *" className="col-span-4">
                  <input value={form.trade_name ?? ""} onChange={(e) => setF("trade_name", e.target.value)} className={cxIn} />
                </Field>
                <Field label="الاسم العلمي *" className="col-span-4">
                  <input value={form.scientific_name ?? ""} onChange={(e) => setF("scientific_name", e.target.value)} className={cxIn} />
                </Field>
                <Field label="الرمز / الباركود" className="col-span-4">
                  <div className="flex gap-1">
                    <input value={form.barcode ?? ""} onChange={(e) => setF("barcode", e.target.value)} className={cxIn + " flex-1"} />
                    <button
                      type="button"
                      title="توليد باركود تلقائي"
                      onClick={autoBarcode}
                      className="size-8 grid place-items-center rounded-md bg-emerald/10 border border-emerald/40 text-emerald hover:bg-emerald/20"
                    >
                      <Wand2 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="طباعة"
                      onClick={() => window.print()}
                      className="size-8 grid place-items-center rounded-md bg-slate-800 border border-border hover:border-emerald/40 hover:text-emerald"
                    >
                      <Printer className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="طباعة ملصق باركود"
                      disabled={!barcodeItem}
                      onClick={() => setPrintOpen(true)}
                      className="size-8 grid place-items-center rounded-md bg-slate-800 border border-border hover:border-emerald/40 hover:text-emerald disabled:opacity-40"
                    >
                      <BarcodeIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="باركودات متعددة"
                      disabled={!activeId}
                      onClick={() => setMultiOpen(true)}
                      className="size-8 grid place-items-center rounded-md bg-slate-800 border border-border hover:border-emerald/40 hover:text-emerald disabled:opacity-40"
                    >
                      <ScanBarcode className="size-3.5" />
                    </button>

                  </div>
                </Field>
              </section>

              {/* Condensed metadata row — RTL sequence: Strength → Form → Company → Category */}
              <section className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)] gap-1.5">
                <Field label="التركيز" tiny>
                  <input value={form.strength ?? ""} onChange={(e) => setF("strength", e.target.value)} className={cxInSm + " px-1"} />
                </Field>
                <Field label="الشكل الصيدلاني" tiny>
                  <input value={form.dosage_form ?? ""} onChange={(e) => setF("dosage_form", e.target.value)} placeholder="tablet..." className={cxInSm + " px-1"} />
                </Field>
                <Field label="الشركة" tiny>
                  <input value={form.company ?? ""} onChange={(e) => setF("company", e.target.value)} className={cxInSm + " px-1.5"} />
                </Field>
                <Field label="التصنيف" tiny>
                  <div className="flex gap-1">
                    <select
                      value={form.category ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__general__") {
                          setAddPanelOpen(true);
                          return;
                        }
                        setF("category", v);
                      }}
                      className={cxInSm + " flex-1 px-1.5"}
                    >
                      <option value="">—</option>
                      <option value="__general__" className="text-emerald font-bold">+ مواد عامة (لوحة ذكية)</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      title="إضافة تصنيف"
                      onClick={addCategory}
                      className="size-7 grid place-items-center rounded-md bg-emerald/10 border border-emerald/40 text-emerald hover:bg-emerald/20"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                </Field>
                <Field label="لون التمييز" tiny>
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={form.highlight_color || "#FDE68A"}
                      onChange={(e) => setF("highlight_color", e.target.value)}
                      className="h-7 w-8 rounded-md border border-border bg-slate-800 cursor-pointer p-0.5"
                      title="لون تمييز الصفوف في الفواتير"
                    />
                    <input
                      value={form.highlight_color ?? ""}
                      onChange={(e) => setF("highlight_color", e.target.value)}
                      placeholder="#FDE68A"
                      className={cxInSm + " flex-1 font-mono px-1"}
                    />
                    {form.highlight_color && (
                      <button
                        type="button"
                        title="مسح اللون"
                        onClick={() => setF("highlight_color", "")}
                        className="size-6 grid place-items-center rounded bg-slate-800 border border-border text-[10px] text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </Field>
              </section>



              {/* Basic Unit block */}
              <section className="rounded-lg border border-emerald/25 bg-emerald/5 p-2.5 space-y-2">
                <header className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald">الوحدة الأساسية (الكبرى)</p>
                  <div className="flex items-center gap-1 mr-auto ml-2">
                    <span className="text-[10px] font-bold text-muted-foreground">طريقة البيع</span>
                    <div className="flex rounded-md border border-emerald/30 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setPriceMode("amount")}
                        className={`px-1.5 h-5 text-[10px] font-bold ${priceMode === "amount" ? "bg-emerald text-primary-foreground" : "bg-slate-800 text-muted-foreground"}`}
                      >وفق مبلغ</button>
                      <button
                        type="button"
                        onClick={() => setPriceMode("pct")}
                        className={`px-1.5 h-5 text-[10px] font-bold ${priceMode === "pct" ? "bg-emerald text-primary-foreground" : "bg-slate-800 text-muted-foreground"}`}
                      >وفق نسبة %</button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-[10px] font-bold text-muted-foreground">تفعيل الوحدة التفصيلية (الصغرى)</span>
                    <span className={`relative inline-block w-9 h-5 rounded-full transition ${secondUnit ? "bg-emerald" : "bg-slate-700"}`}
                      onClick={() => setSecondUnit((v) => !v)}>
                      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${secondUnit ? "right-0.5" : "right-[calc(100%-1.125rem)]"}`} />
                    </span>
                  </label>
                </header>
                <div className="grid grid-cols-5 gap-2">
                  <Field label="الاسم" tiny>
                    <input value={form.large_unit_name ?? ""} onChange={(e) => setF("large_unit_name", e.target.value)} placeholder="باكيت" className={cxInSm} />
                  </Field>
                  <Field label="الكلفة" tiny>
                    <input type="number" value={String(form.large_unit_cost ?? 0)} onChange={(e) => setLargeWithSplit("large_unit_cost", Number(e.target.value) || 0)} className={cxInSmMono} />
                  </Field>
                  <Field label={priceMode === "pct" ? "سعر البيع — نسبة %" : "سعر البيع"} tiny>
                    {priceMode === "pct" ? (
                      <div className="flex items-center gap-1">
                        <input type="number" min={0} max={95} value={String(retailPct)} onChange={(e) => applyRetailPct(Number(e.target.value) || 0)} className={cxInSmMono + " text-emerald"} />
                        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{(form.large_unit_price ?? 0).toLocaleString()}</span>
                      </div>
                    ) : (
                      <input type="number" value={String(form.large_unit_price ?? 0)} onChange={(e) => setLargeWithSplit("large_unit_price", Number(e.target.value) || 0)} className={cxInSmMono} />
                    )}
                  </Field>
                  <Field label={priceMode === "pct" ? "سعر خاص — نسبة %" : "سعر خاص"} tiny>
                    {priceMode === "pct" ? (
                      <div className="flex items-center gap-1">
                        <input type="number" min={0} max={95} value={String(specialPct)} onChange={(e) => applySpecialPct(Number(e.target.value) || 0)} className={cxInSmMono + " text-emerald"} />
                        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{extras.wholesale_large.toLocaleString()}</span>
                      </div>
                    ) : (
                      <input type="number" value={String(extras.wholesale_large)} onChange={(e) => setWholesaleLarge(Number(e.target.value) || 0)} className={cxInSmMono} />
                    )}
                  </Field>
                  <Field label="التعبئة" tiny>
                    <input
                      type="number"
                      min={1}
                      value={String(form.units_per_large ?? 1)}
                      onChange={(e) => setLargeWithSplit("units_per_large", Math.max(1, Number(e.target.value) || 1))}
                      className={cxInSmMono + " ring-1 ring-emerald/30"}
                      title="عدد الوحدات الصغيرة داخل الوحدة الأساسية"
                    />
                  </Field>
                </div>
              </section>

              {/* Secondary Unit — conditional (auto-unlocked when packing > 1) */}
              {secondUnit && (
                <section className="rounded-lg border border-emerald/20 bg-slate-900/40 p-2.5 space-y-2 animate-reveal">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald">الوحدة التفصيلية (الصغرى)</p>
                  <div className="grid grid-cols-4 gap-2">
                    <Field label="اسم الوحدة 2" tiny>
                      <input value={form.small_unit_name ?? ""} onChange={(e) => setF("small_unit_name", e.target.value)} placeholder="شريط / كارتون" className={cxInSm} />
                    </Field>
                    <Field label="كلفة الوحدة 2" tiny>
                      <input type="number" value={String(form.small_unit_cost ?? 0)} onChange={(e) => setF("small_unit_cost", Number(e.target.value) || 0)} className={cxInSmMono} />
                    </Field>
                    <Field label="مفرد (تلقائي ↑250)" tiny>
                      <input type="number" value={String(form.small_unit_price ?? 0)} onChange={(e) => setF("small_unit_price", Number(e.target.value) || 0)} className={cxInSmMono + " text-emerald"} />
                    </Field>
                    <Field label="سعر خاص" tiny>
                      <input type="number" value={String(extras.wholesale_small)} onChange={(e) => setExtrasState((x) => ({ ...x, wholesale_small: Number(e.target.value) || 0 }))} className={cxInSmMono} />
                    </Field>
                  </div>
                </section>
              )}

              {/* Merged row: Third unit (left 50%) + Product images (right 50%) */}
              <section className="grid grid-cols-[1fr_auto] gap-2 items-stretch">
                <div className="rounded-md border border-emerald/30 bg-emerald/5 px-2 py-1.5 flex items-center gap-2 flex-nowrap overflow-x-auto">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald shrink-0">
                    أيام التذكير
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">عدد الأيام</span>
                    <input
                      type="number"
                      min={0}
                      value={String(extras.days_per_cycle)}
                      onChange={(e) => setExtrasState((x) => ({ ...x, days_per_cycle: Math.max(0, Number(e.target.value) || 0) }))}
                      placeholder="10"
                      className="w-16 bg-slate-800 border border-border rounded px-1.5 h-6 text-[11px] font-mono outline-none focus:ring-1 focus:ring-emerald/40"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    عبوة تكفي {extras.days_per_cycle || "—"} يوماً.
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">عدد المرات باليوم</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      value={String(form.daily_frequency ?? 1)}
                      onChange={(e) => setF("daily_frequency", Math.max(0, Number(e.target.value) || 0))}
                      className="w-12 bg-slate-800 border border-border rounded px-1.5 h-6 text-[11px] font-mono text-center outline-none focus:ring-1 focus:ring-emerald/40"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">التوقيت مع الطعام</span>
                    <select
                      value={String(form.meal_timing ?? "any")}
                      onChange={(e) => setF("meal_timing", e.target.value)}
                      className="bg-slate-800 border border-border rounded px-1 h-6 text-[11px] outline-none focus:ring-1 focus:ring-emerald/40"
                    >
                      <option value="before">قبل الطعام</option>
                      <option value="after">بعد الطعام</option>
                      <option value="any">لا يتأثر بالطعام</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer rounded-md border border-emerald/30 bg-emerald/5 px-2 py-1.5 whitespace-nowrap">
                    <span className="text-[10px] font-bold text-muted-foreground">إظهار في المتجر</span>
                    <span
                      onClick={() => setF("publish_online", !form.publish_online)}
                      className={`relative inline-block w-9 h-5 rounded-full transition ${form.publish_online ? "bg-emerald" : "bg-slate-700"}`}
                    >
                      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${form.publish_online ? "right-0.5" : "right-[calc(100%-1.125rem)]"}`} />
                    </span>
                  </label>
                  <ProductImagesBlock activeId={activeId} />
                </div>
              </section>



              {/* Movement history — expanded canvas */}
              <section ref={movementRef} className="rounded-lg border border-border bg-slate-950/40 flex flex-col overflow-hidden transition-shadow" style={{ height: 220 }}>
                <header className="px-3 py-2 border-b border-border flex items-center gap-2 bg-slate-900/60">
                  <History className="size-4 text-emerald" />
                  <p className="text-[11px] font-bold uppercase tracking-widest">تفاصيل حركة مادة</p>
                  <span className="text-[10px] text-muted-foreground">({movements.length} حركة)</span>
                </header>
                <div className="flex-1 overflow-auto">
                  {!activeId && <p className="p-6 text-center text-muted-foreground text-[11px]">احفظ المادة لعرض حركتها.</p>}
                  {activeId && movements.length === 0 && <p className="p-6 text-center text-muted-foreground text-[11px]">لا توجد حركات بعد.</p>}
                  {movements.length > 0 && (
                    <table className="w-full text-[12px]">
                      <thead className="bg-slate-900/60 sticky top-0">
                        <tr className="text-[10px] uppercase text-muted-foreground">
                          <th className="text-right px-3 py-2">التاريخ</th>
                          <th className="text-right px-3 py-2">النوع / التعديل</th>
                          <th className="text-right px-3 py-2">التغير</th>
                          <th className="text-right px-3 py-2">المرجع</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m) => (
                          <tr key={m.id} className="border-t border-border/40 hover:bg-emerald/5">
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{new Date(m.created_at).toLocaleString("ar")}</td>
                            <td className="px-3 py-2">{m.reason}</td>
                            <td className={`px-3 py-2 font-mono font-bold ${m.delta >= 0 ? "text-emerald" : "text-destructive"}`}>
                              {m.delta > 0 ? "+" : ""}{m.delta}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>


              {/* Unified bottom parameters row — reordered: stock, expiry, batch, thresholds, then shelf (compressed) */}
              <section className="grid grid-cols-[1fr_1.2fr_1fr_0.8fr_0.8fr_0.9fr] gap-1.5">
                <Field label="الكمية في المخزون" tiny>
                  <input type="number" value={String(form.quantity_in_stock ?? 0)} onChange={(e) => setF("quantity_in_stock", Number(e.target.value) || 0)} className={cxInSmMono + " h-6 px-1.5 text-[10px]"} />
                </Field>
                <Field label="الاكسباير — كتابة/تقويم" tiny>
                  <div className="flex items-center gap-0.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="YYYY-MM-DD"
                      value={String(form.expiry_date ?? "")}
                      onChange={(e) => setF("expiry_date", e.target.value)}
                      className={cxInSmMono + " h-6 px-1 text-[10px] flex-1 min-w-0"}
                      title="اكتب مباشرة أو استخدم التقويم"
                    />
                    <input
                      type="date"
                      value={String(form.expiry_date ?? "")}
                      onChange={(e) => setF("expiry_date", e.target.value)}
                      className={cxInSm + " h-6 w-6 px-0 shrink-0"}
                      aria-label="اختر تاريخ"
                    />
                  </div>
                </Field>
                <Field label="رقم التشغيلة" tiny>
                  <input value={form.batch_number ?? ""} onChange={(e) => setF("batch_number", e.target.value)} className={cxInSm + " h-6 px-1.5 text-[10px]"} />
                </Field>
                <Field label="الحد الأدنى" tiny>
                  <input type="number" value={String(form.minimum_stock ?? 0)} onChange={(e) => setF("minimum_stock", Number(e.target.value) || 0)} className={cxInSmMono + " h-6 px-1.5 text-[10px]"} title="حد الطلب" />
                </Field>
                <Field label="الحد الأعلى" tiny>
                  <input type="number" value={String(form.maximum_stock ?? 0)} onChange={(e) => setF("maximum_stock", Number(e.target.value) || 0)} className={cxInSmMono + " h-6 px-1.5 text-[10px]"} title="سقف المخزن" />
                </Field>
                <Field label="موقع الرف" tiny>
                  <input value={form.location ?? ""} onChange={(e) => setF("location", e.target.value)} className={cxInSm + " h-6 px-1.5 text-[10px]"} placeholder="A-01" />
                </Field>
              </section>



              {/* Action toolbar */}
              <section className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <div className="flex gap-1.5">
                  <ToolBtn onClick={submit} disabled={busy} tone="emerald" icon={busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}>
                    حفظ
                  </ToolBtn>
                  <ToolBtn onClick={remove} disabled={busy || !activeId} tone="destructive" icon={<Trash2 className="size-3.5" />}>
                    حذف
                  </ToolBtn>
                  <ToolBtn onClick={openBlank} icon={<Plus className="size-3.5" />}>جديد</ToolBtn>
                  <ToolBtn onClick={scrollToLedger} disabled={!activeId} icon={<PackageSearch className="size-3.5" />}>حركة مادة</ToolBtn>
                  <ToolBtn onClick={exit} icon={<LogOut className="size-3.5" />}>خروج</ToolBtn>
                </div>
                <div className="flex gap-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importExcel(f);
                      e.target.value = "";
                    }}
                  />
                  <ToolBtn onClick={() => fileRef.current?.click()} tone="emerald" icon={<FileSpreadsheet className="size-3.5" />}>
                    استيراد اكسل
                  </ToolBtn>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {printOpen && barcodeItem && (
        <BarcodePrintPanel items={[{ item: barcodeItem, copies: 1 }]} onClose={() => setPrintOpen(false)} />
      )}

      {multiOpen && activeId && (
        <MultiBarcodeModal medicineId={activeId} onClose={() => setMultiOpen(false)} />
      )}


    </AppShell>
  );
}

const cxIn = "w-full bg-slate-800 border border-emerald/40 rounded-md px-2 h-8 text-xs outline-none focus:ring-1 focus:ring-emerald/40";
const cxInSm = "w-full bg-slate-800 border border-border rounded-md px-2 h-7 text-[11px] outline-none focus:ring-1 focus:ring-emerald/40";
const cxInSmMono = cxInSm + " font-mono";

/** Attach several barcode aliases to the same product. */
function MultiBarcodeModal({ medicineId, onClose }: { medicineId: string; onClose: () => void }) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    const cur = getBarcodeAliases(medicineId);
    setList(cur.length ? cur : [""]);
  }, [medicineId]);

  const save = () => {
    setBarcodeAliases(medicineId, list);
    toast.success("تم حفظ الباركودات المتعددة");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm grid place-items-center p-6" dir="rtl">
      <div className="bg-slate-900 border border-emerald/30 rounded-2xl w-full max-w-md flex flex-col shadow-2xl">
        <header className="p-4 border-b border-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald">باركودات متعددة</p>
          <h3 className="text-sm font-bold">إضافة باركودات بديلة لنفس المادة</h3>
        </header>
        <div className="p-4 space-y-2 max-h-[50vh] overflow-auto">
          {list.map((v, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                value={v}
                onChange={(e) => setList((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="باركود بديل"
                className={cxIn + " flex-1 font-mono"}
              />
              <button
                type="button"
                onClick={() => setList((l) => (l.length === 1 ? [""] : l.filter((_, j) => j !== i)))}
                className="size-8 grid place-items-center rounded-md bg-slate-800 border border-border text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setList((l) => [...l, ""])}
            className="px-3 py-1.5 rounded-md bg-emerald/10 border border-emerald/40 text-emerald text-[11px] font-bold hover:bg-emerald/20"
          >
            + إضافة باركود
          </button>
        </div>
        <footer className="p-4 border-t border-border flex gap-2 justify-end">
          <button onClick={save} className="px-4 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold">
            حفظ
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 border border-border text-xs font-bold">
            إغلاق
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, tiny, className = "", children }: { label: string; tiny?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>

      <span className={`block font-bold uppercase tracking-widest text-muted-foreground ${tiny ? "text-[9px] mb-0.5" : "text-[10px] mb-1"}`}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ToolBtn({
  onClick, disabled, icon, tone, children,
}: { onClick: () => void; disabled?: boolean; icon?: React.ReactNode; tone?: "emerald" | "destructive"; children: React.ReactNode }) {
  const base = "inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-[11px] font-bold border transition disabled:opacity-40";
  const cls =
    tone === "emerald"
      ? "bg-emerald text-primary-foreground border-emerald hover:brightness-110"
      : tone === "destructive"
      ? "bg-destructive/10 text-destructive border-destructive/40 hover:bg-destructive/20"
      : "bg-slate-800 text-foreground border-border hover:border-emerald/40 hover:text-emerald";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${cls}`}>
      {icon}
      {children}
    </button>
  );
}

function ProductImagesBlock({ activeId }: { activeId: string | null }) {
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const storageKey = activeId ? `product-img:${activeId}` : null;

  useEffect(() => {
    if (!storageKey) { setFront(null); setBack(null); return; }
    try {
      const raw = localStorage.getItem(storageKey);
      const p = raw ? JSON.parse(raw) as { front?: string; back?: string } : {};
      setFront(p.front ?? null); setBack(p.back ?? null);
    } catch { setFront(null); setBack(null); }
  }, [storageKey]);

  const save = (patch: { front?: string | null; back?: string | null }) => {
    if (!storageKey) return;
    const next = { front: patch.front !== undefined ? patch.front : front, back: patch.back !== undefined ? patch.back : back };
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const pick = (file: File | undefined, side: "front" | "back") => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (side === "front") { setFront(url); save({ front: url }); }
      else { setBack(url); save({ back: url }); }
    };
    reader.readAsDataURL(file);
  };

  return (
    <section className="rounded-md border border-emerald/25 bg-emerald/5 px-1.5 py-1 flex items-center gap-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-emerald shrink-0">صورة</p>
      <div className="flex gap-1.5 mr-auto">
        <ImageSlot label="وجه" src={front} onPick={(f) => pick(f, "front")} onClear={() => { setFront(null); save({ front: null }); }} />
        <ImageSlot label="ظهر" src={back} onPick={(f) => pick(f, "back")} onClear={() => { setBack(null); save({ back: null }); }} />
      </div>
    </section>
  );
}

function ImageSlot({ label, src, onPick, onClear }: { label: string; src: string | null; onPick: (f: File | undefined) => void; onClear: () => void }) {
  return (
    <label className="relative group flex flex-col items-center justify-center gap-0.5 h-9 w-11 rounded border border-dashed border-emerald/40 bg-slate-800 hover:border-emerald cursor-pointer overflow-hidden">
      {src ? (
        <>
          <img src={src} alt={label} className="absolute inset-0 w-full h-full object-contain bg-slate-950" />
          <span className="absolute top-0.5 right-0.5 bg-slate-950/80 text-[8px] px-1 rounded font-bold text-emerald">{label}</span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onClear(); }}
            className="absolute top-0.5 left-0.5 bg-destructive/90 text-destructive-foreground text-[8px] px-1 rounded font-bold opacity-0 group-hover:opacity-100 transition"
          >×</button>
        </>
      ) : (
        <>
          <span className="text-[9px] font-bold text-emerald">{label}</span>
          <span className="text-[8px] text-muted-foreground">+ صورة</span>
        </>
      )}
      <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
  );
}
