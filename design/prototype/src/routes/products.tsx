import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode as BarcodeIcon,
  Calendar,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  History,
  Loader2,
  LogOut,
  Plus,
  Printer,
  Save,
  ScanBarcode,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
      { name: "description", content: "إدارة قاعدة بيانات الأدوية والمواد." },
    ],
  }),
  component: ProductsPage,
});

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

const DEMO_MEDICINES: Medicine[] = [
  {
    id: "med-1",
    trade_name: "Adol Syrup",
    scientific_name: "Paracetamol Syrup",
    quantity_in_stock: 3,
    barcode: "625100120011",
    large_unit_name: "باكيت",
    large_unit_cost: 1500,
    large_unit_price: 2500,
    small_unit_name: "علبة",
    units_per_large: 1,
    small_unit_cost: 1500,
    small_unit_price: 2500,
  } as Medicine,
  {
    id: "med-2",
    trade_name: "Amoxil 500",
    scientific_name: "Amoxicillin",
    quantity_in_stock: 181,
    barcode: "5000129001121",
    large_unit_name: "باكيت",
    large_unit_cost: 3000,
    large_unit_price: 4500,
    small_unit_name: "شريط",
    units_per_large: 2,
    small_unit_cost: 1500,
    small_unit_price: 2250,
  } as Medicine,
  {
    id: "med-3",
    trade_name: "Amoxil Syrup",
    scientific_name: "Amoxicillin Syrup",
    quantity_in_stock: 121,
    barcode: "5000129001138",
    large_unit_name: "باكيت",
    large_unit_cost: 2000,
    large_unit_price: 3000,
    small_unit_name: "علبة",
    units_per_large: 1,
    small_unit_cost: 2000,
    small_unit_price: 3000,
  } as Medicine,
  {
    id: "med-4",
    trade_name: "Augmentin 1g",
    scientific_name: "Amoxicillin+Clav",
    quantity_in_stock: 168,
    barcode: "5000129001145",
    large_unit_name: "باكيت",
    large_unit_cost: 6000,
    large_unit_price: 8500,
    small_unit_name: "شريط",
    units_per_large: 2,
    small_unit_cost: 3000,
    small_unit_price: 4250,
  } as Medicine,
  {
    id: "med-5",
    trade_name: "Avene Sunblock واقي شمس افين Cream ...",
    scientific_name: "واقي شمس افين",
    quantity_in_stock: -2,
    barcode: "3282779001152",
    large_unit_name: "قطعة",
    large_unit_cost: 18000,
    large_unit_price: 25000,
    small_unit_name: "قطعة",
    units_per_large: 1,
    small_unit_cost: 18000,
    small_unit_price: 25000,
  } as Medicine,
  {
    id: "med-6",
    trade_name: "B12 Inj",
    scientific_name: "Vitamin B12 Inj",
    barcode: "5000129002132",
    strength: "",
    dosage_form: "إبرة",
    company: "",
    category: "",
    highlight_color: "#00ffff",
    small_unit_name: "حبة",
    small_unit_cost: 1200,
    small_unit_price: 2000,
    large_unit_name: "شريط",
    units_per_large: 10,
    large_unit_cost: 12000,
    large_unit_price: 20000,
    quantity_in_stock: 234,
    expiry_date: "01 / 08 / 2028",
    batch_number: "",
    minimum_stock: 20,
    maximum_stock: 240,
    location: "A-01",
    daily_frequency: 1,
    meal_timing: "any",
    publish_online: true,
  } as Medicine,
  {
    id: "med-7",
    trade_name: "Cozaar 50",
    scientific_name: "Losartan",
    quantity_in_stock: 234,
    barcode: "5000129001176",
  } as Medicine,
  {
    id: "med-8",
    trade_name: "Diclofen Inj",
    scientific_name: "Diclofenac Inj",
    quantity_in_stock: 0,
    barcode: "5000129001183",
  } as Medicine,
  {
    id: "med-9",
    trade_name: "Enhancin",
    scientific_name: "Amoxicillin",
    quantity_in_stock: 18,
    barcode: "5000129001190",
  } as Medicine,
  {
    id: "med-10",
    trade_name: "Fucidin Cream",
    scientific_name: "Fusidic Acid",
    quantity_in_stock: 140,
    barcode: "5000129001206",
  } as Medicine,
  {
    id: "med-11",
    trade_name: "Glucophage 500",
    scientific_name: "Metformin",
    quantity_in_stock: -6,
    barcode: "5000129001213",
  } as Medicine,
  {
    id: "med-12",
    trade_name: "Lantus 100",
    scientific_name: "Insulin Glargine",
    quantity_in_stock: 93,
    barcode: "5000129001220",
  } as Medicine,
  {
    id: "med-13",
    trade_name: "Lipitor 20",
    scientific_name: "Atorvastatin",
    quantity_in_stock: 152,
    barcode: "5000129001237",
  } as Medicine,
];

const DEMO_MOVEMENTS: Movement[] = [
  { id: "mov-1", created_at: "2026/7/18، 1:30:21 ص", delta: -3, reason: "sale" },
  { id: "mov-2", created_at: "2026/7/18، 1:30:21 ص", delta: -1, reason: "sale" },
  { id: "mov-3", created_at: "2026/7/18، 1:30:21 ص", delta: -2, reason: "sale" },
  { id: "mov-4", created_at: "2026/7/18، 1:27:23 ص", delta: 10, reason: "purchase" },
  { id: "mov-5", created_at: "2026/7/18، 1:27:23 ص", delta: 50, reason: "purchase" },
];

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
  large_unit_name: "شريط",
  large_unit_price: 0,
  large_unit_cost: 0,
  small_unit_name: "حبة",
  small_unit_price: 0,
  small_unit_cost: 0,
  units_per_large: 10,
  daily_frequency: 1,
  meal_timing: "any",
  publish_online: true,
  highlight_color: "#00ffff",
};

function formatArabicDateTime(d: string | Date): string {
  if (typeof d === "string" && (d.includes("ص") || d.includes("م"))) {
    return d;
  }
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return typeof d === "string" ? d : "";
  const year = dt.getFullYear();
  const month = dt.getMonth() + 1;
  const day = dt.getDate();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, "0");
  const seconds = String(dt.getSeconds()).padStart(2, "0");
  const isPM = hours >= 12;
  const ampm = isPM ? "م" : "ص";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${year}/${month}/${day}، ${hours}:${minutes}:${seconds} ${ampm}`;
}

function errMsg(e: unknown): string {
  if (!e) return "خطأ غير معروف";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

function ProductsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Medicine[]>(DEMO_MEDICINES);
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>("med-6");
  const [form, setForm] = useState<Partial<Medicine>>(DEMO_MEDICINES[5]);
  const [extras, setExtrasState] = useState<Extras>(extrasFromMedicine(DEMO_MEDICINES[5]));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [movements, setMovements] = useState<Movement[]>(DEMO_MOVEMENTS);
  const [printOpen, setPrintOpen] = useState(false);
  const [multiOpen, setMultiOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  // Pricing mode: fixed amount or margin %
  const [priceMode, setPriceMode] = useState<"amount" | "pct">("amount");
  const [packagingEnabled, setPackagingEnabled] = useState(true);

  const fileRef = useRef<HTMLInputElement>(null);
  const movementRef = useRef<HTMLElement>(null);
  const colorPickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("medicine_categories").select("name").order("name");
        if (data && data.length > 0) {
          setCategories(data.map((c: { name: string }) => c.name).filter(Boolean));
        }
      } catch {
        // use default
      }
    })();
  }, []);

  const refresh = async () => {
    try {
      const list = await listMedicines();
      if (list && list.length > 0) {
        setItems(list);
      }
    } catch {
      // keep fallback
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMovements([]);
      return;
    }
    if (activeId === "med-6") {
      setMovements(DEMO_MOVEMENTS);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("stock_movements")
          .select("id,created_at,delta,reason")
          .eq("medicine_id", activeId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!cancel && data && data.length > 0) {
          setMovements(data as Movement[]);
        } else if (!cancel) {
          setMovements([]);
        }
      } catch {
        if (!cancel) setMovements([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [activeId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (i) =>
        i.trade_name.toLowerCase().includes(s) ||
        (i.scientific_name && i.scientific_name.toLowerCase().includes(s)) ||
        (i.barcode && i.barcode.includes(s)),
    );
  }, [items, q]);

  const active = items.find((i) => i.id === activeId) ?? null;

  const openBlank = () => {
    setCreating(true);
    setActiveId(null);
    setForm({
      ...emptyForm,
      trade_name: "",
      scientific_name: "",
      barcode: "",
    });
    setExtrasState(emptyExtras);
    setMovements([]);
  };

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
    setAddPanelOpen(false);
  };

  const openExisting = (m: Medicine) => {
    setCreating(false);
    setActiveId(m.id);
    setForm(m);
    setExtrasState(extrasFromMedicine(m));
  };

  const setF = <K extends keyof Medicine>(key: K, value: Medicine[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const autoBarcode = () => {
    const gen = `5000${Date.now().toString().slice(-9)}`;
    setF("barcode", gen);
    toast.success("تم توليد باركود جديد");
  };

  const setLargeWithSplit = <K extends "large_unit_price" | "large_unit_cost" | "units_per_large">(
    key: K,
    val: number,
  ) => {
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
    if (key === "units_per_large") {
      setExtrasState((x) => ({
        ...x,
        wholesale_small: val > 1 ? roundUpTo250((x.wholesale_large || 0) / val) : x.wholesale_small,
      }));
    }
  };

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

  const scrollToLedger = () => {
    movementRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    movementRef.current?.classList.add("ring-2", "ring-[#4A6B82]/50");
    setTimeout(() => movementRef.current?.classList.remove("ring-2", "ring-[#4A6B82]/50"), 1200);
  };

  const submit = async () => {
    const trade = (form.trade_name ?? "").trim();
    const sci = (form.scientific_name ?? "").trim();
    const barcode = (form.barcode ?? "").trim();
    if (!trade) {
      toast.error("الاسم التجاري مطلوب");
      return;
    }
    if (!sci) {
      toast.error("الاسم العلمي مطلوب");
      return;
    }

    const payload: Partial<Medicine> = { ...form };
    setBusy(true);
    try {
      if (creating || !activeId || activeId.startsWith("med-")) {
        const created = await createMedicine({
          ...payload,
          ...extrasToPatch(extras),
          trade_name: trade,
          scientific_name: sci,
          barcode: barcode || null,
        });
        setMedicineColor(created.id, created.highlight_color || null);
        await refresh();
        toast.success(`تم حفظ: ${created.trade_name}`);
        openExisting(created);
      } else {
        const upd = await updateMedicine(activeId, {
          ...payload,
          ...extrasToPatch(extras),
        });
        setMedicineColor(upd.id, upd.highlight_color || null);
        setForm(upd);
        setItems((list) => list.map((it) => (it.id === upd.id ? upd : it)));
        toast.success("تم تحديث المادة");
      }
    } catch (e) {
      toast.error(`فشل الحفظ: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!activeId) return;
    if (!confirm("حذف هذه المادة نهائياً؟")) return;
    setBusy(true);
    try {
      if (!activeId.startsWith("med-")) {
        await deleteMedicine(activeId);
      }
      setItems((prev) => prev.filter((it) => it.id !== activeId));
      setActiveId(null);
      setForm(emptyForm);
      setExtrasState(emptyExtras);
      setCreating(false);
      toast.success("تم الحذف");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const exit = () => {
    navigate({ to: "/" });
  };

  const importExcel = async (file: File) => {
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
          large_unit_name: String(r["large_unit_name"] ?? "شريط"),
          small_unit_name: String(r["small_unit_name"] ?? "حبة"),
          units_per_large: Number(r["units_per_large"] ?? 10) || 10,
        });
        ok++;
      }
      await refresh();
      toast.success(`تم استيراد ${ok} مادة`);
    } catch (e) {
      toast.error(`فشل الاستيراد: ${errMsg(e)}`);
    }
  };

  const barcodeItem =
    active && active.barcode
      ? { id: active.id, barcode: active.barcode, tradeName: active.trade_name, price: active.selling_price }
      : null;

  return (
    <div
      dir="rtl"
      className="flex h-screen w-full bg-white text-[#1E2A33] overflow-hidden select-none font-['IBM_Plex_Sans_Arabic',_'Cairo',_system-ui,_sans-serif]"
    >
      {/* ======================================================== */}
      {/* Materials List Sidebar — FAR RIGHT (16% width)          */}
      {/* ======================================================== */}
      <aside className="w-[268px] shrink-0 h-full border-l border-[#D7DEE4] flex flex-col bg-white">
        {/* Header */}
        <div className="h-[46px] px-3 border-b border-[#D7DEE4] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openBlank}
              className="h-[30px] px-2.5 rounded-[6px] bg-[#4A6B82] hover:bg-[#3C5A6F] text-white text-[12px] font-medium transition-colors"
            >
              + جديد
            </button>
            <button
              type="button"
              onClick={() => setAddPanelOpen(true)}
              className="h-[30px] px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white hover:bg-[#F6F7F9] text-[#1E2A33] text-[12px] font-normal transition-colors"
            >
              تعريف متعدد
            </button>
          </div>
          <span className="text-[13px] font-bold text-[#1E2A33]">
            المواد ({items.length})
          </span>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-[#D7DEE4]">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث..."
            className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[12px] text-[#1E2A33] placeholder-[#5C7385] outline-none focus:border-[#4A6B82]"
          />
        </div>

        {/* List Items */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#EDF0F2]">
          {filtered.map((m) => {
            const isSelected = m.id === activeId;
            const isNegativeStock = (m.quantity_in_stock ?? 0) < 0;
            const stockDisplay = isNegativeStock
              ? `${Math.abs(m.quantity_in_stock ?? 0)}-`
              : `${m.quantity_in_stock ?? 0}`;

            return (
              <button
                key={m.id}
                type="button"
                onClick={() => openExisting(m)}
                className={`w-full text-right px-3 py-2 transition-colors block ${
                  isSelected ? "bg-[#F6F7F9]" : "bg-white hover:bg-[#F6F7F9]"
                }`}
              >
                <p className="text-[13px] font-bold text-[#1E2A33] truncate leading-tight">
                  {m.trade_name}
                </p>
                <p className="text-[11px] text-[#1E4690] truncate leading-tight mt-0.5">
                  {m.scientific_name || "—"}
                </p>
                <p className="text-[11px] text-[#5C7385] leading-tight mt-0.5">
                  مخزون:{" "}
                  <span className={isNegativeStock ? "text-[#DF202E]" : ""}>
                    {stockDisplay}
                  </span>
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ======================================================== */}
      {/* Main Form Panel (84% width)                              */}
      {/* ======================================================== */}
      <main className="flex-1 h-full overflow-y-auto bg-white p-3.5 flex flex-col justify-between gap-3">
        <div className="flex flex-col gap-3">
          {/* Row 1: Identification Row + Top-Left Toolbar */}
          <div className="flex items-end gap-3">
            {/* 4 Icon Buttons (Scan, Barcode, Print, Wand) */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                title="مسح باركود"
                className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] transition-colors"
                onClick={() => setMultiOpen(true)}
              >
                <ScanBarcode className="size-4" />
              </button>
              <button
                type="button"
                title="باركود"
                disabled={!barcodeItem}
                onClick={() => setPrintOpen(true)}
                className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] disabled:opacity-40 transition-colors"
              >
                <BarcodeIcon className="size-4" />
              </button>
              <button
                type="button"
                title="طباعة"
                onClick={() => window.print()}
                className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] transition-colors"
              >
                <Printer className="size-4" />
              </button>
              <button
                type="button"
                title="توليد باركود تلقائي"
                onClick={autoBarcode}
                className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:border-[#4A6B82] hover:text-[#4A6B82] transition-colors"
              >
                <Wand2 className="size-4" />
              </button>
            </div>

            {/* Inputs: Code/Barcode, Scientific Name, Trade Name */}
            <FormField label="الرمز / الباركود" className="w-[220px]">
              <input
                type="text"
                value={form.barcode ?? ""}
                onChange={(e) => setF("barcode", e.target.value)}
                className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
              />
            </FormField>

            <FormField label="الاسم العلمي" required className="flex-1">
              <input
                type="text"
                value={form.scientific_name ?? ""}
                onChange={(e) => setF("scientific_name", e.target.value)}
                className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
              />
            </FormField>

            <FormField label="الاسم التجاري" required className="flex-1">
              <input
                type="text"
                value={form.trade_name ?? ""}
                onChange={(e) => setF("trade_name", e.target.value)}
                className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
              />
            </FormField>
          </div>

          {/* Row 2: Classification / Appearance Row */}
          <div className="flex items-end gap-3">
            {/* Highlight color compound control */}
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-normal text-[#5C7385] text-right">
                لون التمييز
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="مسح اللون"
                  onClick={() => setF("highlight_color", "")}
                  className="h-[34px] w-[28px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:text-[#DF202E] hover:bg-[#FCE8EA] transition-colors"
                >
                  <X className="size-3.5" />
                </button>
                <input
                  type="text"
                  value={form.highlight_color || "#00ffff"}
                  onChange={(e) => setF("highlight_color", e.target.value)}
                  className="h-[34px] w-[88px] text-center font-mono text-[12px] text-[#1E2A33] rounded-[6px] border border-[#D7DEE4] bg-white outline-none focus:border-[#4A6B82] transition-colors"
                />
                <div
                  onClick={() => colorPickerRef.current?.click()}
                  style={{ backgroundColor: form.highlight_color || "#00ffff" }}
                  className="h-[34px] w-[34px] rounded-[6px] border border-[#D7DEE4] cursor-pointer relative"
                  title="انقر لتغيير اللون"
                >
                  <input
                    ref={colorPickerRef}
                    type="color"
                    value={form.highlight_color || "#00ffff"}
                    onChange={(e) => setF("highlight_color", e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => colorPickerRef.current?.click()}
                  className="h-[34px] w-[28px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:bg-[#F6F7F9] transition-colors"
                >
                  <Plus className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => colorPickerRef.current?.click()}
                  className="h-[34px] w-[28px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:bg-[#F6F7F9] transition-colors"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Category dropdown */}
            <FormField label="التصنيف" className="flex-1">
              <div className="relative">
                <select
                  value={form.category ?? ""}
                  onChange={(e) => setF("category", e.target.value)}
                  className="h-[34px] w-full px-2.5 pl-7 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right appearance-none outline-none focus:border-[#4A6B82] transition-colors"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <ChevronDown className="size-3.5 text-[#5C7385] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </FormField>

            {/* Company */}
            <FormField label="الشركة" className="w-[150px]">
              <input
                type="text"
                value={form.company ?? ""}
                onChange={(e) => setF("company", e.target.value)}
                className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
              />
            </FormField>

            {/* Dosage form */}
            <FormField label="الشكل الصيدلاني" className="w-[140px]">
              <input
                type="text"
                value={form.dosage_form ?? ""}
                onChange={(e) => setF("dosage_form", e.target.value)}
                className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
              />
            </FormField>

            {/* Concentration */}
            <FormField label="التركيز" className="w-[100px]">
              <input
                type="text"
                value={form.strength ?? ""}
                onChange={(e) => setF("strength", e.target.value)}
                className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
              />
            </FormField>
          </div>

          {/* Row 3: "الوحدة الأساسية (الصغرى)" Card */}
          <div className="border border-[#D7DEE4] rounded-[6px] bg-white overflow-hidden">
            {/* Header bar */}
            <div className="h-[34px] px-3 bg-[#F6F7F9] border-b border-[#D7DEE4] flex items-center justify-between">
              {/* Left side: Packaging toggle + Pricing method segmented pill */}
              <div className="flex items-center gap-3">
                {/* Enable packaging toggle */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPackagingEnabled((v) => !v)}
                    className={`relative inline-flex h-[20px] w-[36px] cursor-pointer rounded-full transition-colors ${
                      packagingEnabled ? "bg-[#4A6B82]" : "bg-[#D7DEE4]"
                    }`}
                  >
                    <span
                      className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white transition-transform mt-[2px] ${
                        packagingEnabled ? "translate-x-[-18px]" : "translate-x-[-2px]"
                      }`}
                    />
                  </button>
                  <span className="text-[12px] text-[#5C7385]">تفعيل التعبئة</span>
                </div>

                {/* Sell method segmented control */}
                <div className="flex items-center gap-1.5">
                  <div className="inline-flex items-center rounded-full border border-[#D7DEE4] p-0.5 bg-white">
                    <button
                      type="button"
                      onClick={() => setPriceMode("amount")}
                      className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full transition-colors ${
                        priceMode === "amount"
                          ? "bg-[#4A6B82] text-white"
                          : "bg-transparent text-[#1E2A33]"
                      }`}
                    >
                      وفق مبلغ
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriceMode("pct")}
                      className={`px-2.5 py-0.5 text-[11px] font-medium rounded-full transition-colors ${
                        priceMode === "pct"
                          ? "bg-[#4A6B82] text-white"
                          : "bg-transparent text-[#1E2A33]"
                      }`}
                    >
                      وفق نسبة %
                    </button>
                  </div>
                  <span className="text-[12px] text-[#5C7385]">طريقة البيع</span>
                </div>
              </div>

              {/* Right side: Title */}
              <span className="text-[13px] font-semibold text-[#1E2A33]">
                الوحدة الأساسية (الصغرى)
              </span>
            </div>

            {/* Body */}
            <div className="p-3 grid grid-cols-4 gap-3">
              <FormField label="سعر خاص">
                <StepperInput
                  value={extras.wholesale_small}
                  onChange={(v) =>
                    setExtrasState((x) => ({ ...x, wholesale_small: Number(v) || 0 }))
                  }
                />
              </FormField>

              <FormField label="سعر البيع">
                <StepperInput
                  bold
                  value={form.small_unit_price ?? 0}
                  onChange={(v) => setF("small_unit_price", Number(v) || 0)}
                />
              </FormField>

              <FormField label="التكلفة">
                <StepperInput
                  value={form.small_unit_cost ?? 0}
                  onChange={(v) => setF("small_unit_cost", Number(v) || 0)}
                />
              </FormField>

              <FormField label="الاسم">
                <input
                  type="text"
                  value={form.small_unit_name ?? ""}
                  onChange={(e) => setF("small_unit_name", e.target.value)}
                  className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                />
              </FormField>
            </div>
          </div>

          {/* Row 4: "الوحدة الثانوية (الكبرى)" Card */}
          <div className="border border-[#D7DEE4] rounded-[6px] bg-white overflow-hidden">
            {/* Header bar */}
            <div className="h-[34px] px-3 bg-[#F6F7F9] border-b border-[#D7DEE4] flex items-center justify-between">
              <div />
              <span className="text-[13px] font-semibold text-[#1E2A33]">
                الوحدة الثانوية (الكبرى)
              </span>
            </div>

            {/* Body */}
            <div className="p-3 grid grid-cols-5 gap-3">
              <FormField label="السعر الخاص للوحدة الثانوية">
                <StepperInput
                  value={extras.wholesale_large}
                  onChange={(v) => setWholesaleLarge(Number(v) || 0)}
                />
              </FormField>

              <FormField label="سعر بيع الوحدة الثانوية">
                <StepperInput
                  bold
                  value={form.large_unit_price ?? 0}
                  onChange={(v) => setLargeWithSplit("large_unit_price", Number(v) || 0)}
                />
              </FormField>

              <FormField label="كلفة الوحدة الثانوية">
                <StepperInput
                  value={form.large_unit_cost ?? 0}
                  onChange={(v) => setLargeWithSplit("large_unit_cost", Number(v) || 0)}
                />
              </FormField>

              <FormField label="التعبئة">
                <StepperInput
                  value={form.units_per_large ?? 10}
                  onChange={(v) =>
                    setLargeWithSplit("units_per_large", Math.max(1, Number(v) || 1))
                  }
                />
              </FormField>

              <FormField label="اسم الوحدة الثانوية">
                <input
                  type="text"
                  value={form.large_unit_name ?? ""}
                  onChange={(e) => setF("large_unit_name", e.target.value)}
                  className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                />
              </FormField>
            </div>
          </div>

          {/* Row 5: Images + Reminders */}
          <div className="flex items-center justify-between gap-3">
            {/* Left box: Images + Show in store toggle */}
            <div className="border border-[#D7DEE4] rounded-[6px] px-3 py-1.5 flex items-center gap-3 bg-white">
              <div className="flex items-center gap-1.5">
                <ImageSlot
                  side="back"
                  activeId={activeId}
                  label="ظهر"
                />
                <ImageSlot
                  side="front"
                  activeId={activeId}
                  label="وجه"
                />
              </div>

              <div className="flex items-center gap-1.5 mr-1">
                <button
                  type="button"
                  onClick={() => setF("publish_online", !form.publish_online)}
                  className={`relative inline-flex h-[20px] w-[36px] cursor-pointer rounded-full transition-colors ${
                    form.publish_online ? "bg-[#4A6B82]" : "bg-[#D7DEE4]"
                  }`}
                >
                  <span
                    className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white transition-transform mt-[2px] ${
                      form.publish_online ? "translate-x-[-18px]" : "translate-x-[-2px]"
                    }`}
                  />
                </button>
                <span className="text-[12px] text-[#5C7385] whitespace-nowrap">
                  إظهار في المتجر
                </span>
              </div>
            </div>

            {/* Right side: Reminders row */}
            <div className="flex items-end gap-3 flex-1 justify-end">
              <FormField label="التوقيت مع الطعام" className="w-[140px]">
                <div className="relative">
                  <select
                    value={form.meal_timing ?? "any"}
                    onChange={(e) => setF("meal_timing", e.target.value)}
                    className="h-[34px] w-full px-2 pl-7 rounded-[6px] border border-[#D7DEE4] bg-white text-[12px] text-[#1E2A33] text-right appearance-none outline-none focus:border-[#4A6B82] transition-colors"
                  >
                    <option value="any">لا يتأثر بالطعام</option>
                    <option value="before">قبل الطعام</option>
                    <option value="after">بعد الطعام</option>
                  </select>
                  <ChevronDown className="size-3.5 text-[#5C7385] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </FormField>

              <FormField label="عدد المرات باليوم" className="w-[90px]">
                <StepperInput
                  value={form.daily_frequency ?? 1}
                  onChange={(v) => setF("daily_frequency", Math.max(1, Number(v) || 1))}
                />
              </FormField>

              <FormField label="عبوة تكفي – يوماً" className="w-[100px]">
                <StepperInput
                  value={extras.days_per_cycle ?? 0}
                  onChange={(v) =>
                    setExtrasState((x) => ({ ...x, days_per_cycle: Math.max(0, Number(v) || 0) }))
                  }
                />
              </FormField>

              <FormField label="أيام التذكير" className="w-[80px]">
                <input
                  type="text"
                  value={String(extras.days_per_cycle ?? 0)}
                  onChange={(e) =>
                    setExtrasState((x) => ({ ...x, days_per_cycle: Math.max(0, Number(e.target.value) || 0) }))
                  }
                  className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
                />
              </FormField>
            </div>
          </div>

          {/* Row 6: Movement History ("تفاصيل حركة مادة") */}
          <section
            ref={movementRef}
            className="border border-[#D7DEE4] border-l-2 border-l-[#CDCDCD] rounded-[6px] bg-white overflow-hidden flex flex-col h-[185px] transition-shadow"
          >
            <div className="h-[34px] px-3 border-b border-[#EDF0F2] flex items-center justify-between bg-white shrink-0">
              <div />
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-[#1E2A33]">
                  تفاصيل حركة مادة ({movements.length} حركة)
                </span>
                <History className="size-4 text-[#5C7385]" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="border-b border-[#EDF0F2] text-[#5C7385] text-[12px]">
                    <th className="text-right px-3 py-1.5 font-normal">المرجع</th>
                    <th className="text-right px-3 py-1.5 font-normal">التغير</th>
                    <th className="text-right px-3 py-1.5 font-normal">النوع / التعديل</th>
                    <th className="text-right px-3 py-1.5 font-normal">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF0F2]">
                  {movements.map((m) => {
                    const isNeg = m.delta < 0;
                    const changeFormatted = isNeg
                      ? `${Math.abs(m.delta)}-`
                      : `${m.delta}+`;
                    const toneColor = isNeg ? "text-[#DF202E]" : "text-[#4A94CC]";

                    return (
                      <tr key={m.id} className="h-[30px] hover:bg-[#F6F7F9] transition-colors">
                        <td className={`px-3 py-1 font-medium ${toneColor}`}>
                          {m.reason}
                        </td>
                        <td className={`px-3 py-1 font-medium ${toneColor}`}>
                          {changeFormatted}
                        </td>
                        <td className="px-3 py-1 text-[#1E2A33]">
                          {m.reason}
                        </td>
                        <td className="px-3 py-1 text-[#1E2A33] font-mono whitespace-nowrap">
                          {formatArabicDateTime(m.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                  {movements.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-[#5C7385]">
                        لا توجد حركات مسجلة لهذه المادة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Row 7: Stock / Batch Parameters */}
          <div className="grid grid-cols-6 gap-3">
            <FormField label="موقع الرف">
              <StepperInput
                value={form.location ?? "A-01"}
                onChange={(v) => setF("location", v)}
              />
            </FormField>

            <FormField label="الحد الأعلى">
              <StepperInput
                value={form.maximum_stock ?? 240}
                onChange={(v) => setF("maximum_stock", Number(v) || 0)}
              />
            </FormField>

            <FormField label="الحد الأدنى">
              <StepperInput
                value={form.minimum_stock ?? 20}
                onChange={(v) => setF("minimum_stock", Number(v) || 0)}
              />
            </FormField>

            <FormField label="رقم التشغيلة">
              <div className="relative flex items-center bg-white border border-[#D7DEE4] rounded-[6px] h-[34px] px-2.5 focus-within:border-[#4A6B82] transition-colors">
                <input
                  type="text"
                  value={form.batch_number ?? ""}
                  onChange={(e) => setF("batch_number", e.target.value)}
                  className="w-full h-full bg-transparent text-right text-[13px] text-[#1E2A33] outline-none"
                />
                <BarcodeIcon className="size-3.5 text-[#5C7385] shrink-0" />
              </div>
            </FormField>

            <FormField label="الأكسباير – تقويم/كتابة">
              <StepperInput
                value={form.expiry_date ?? "01 / 08 / 2028"}
                onChange={(v) => setF("expiry_date", v)}
                icon={<Calendar className="size-3.5 text-[#5C7385]" />}
              />
            </FormField>

            <FormField label="الكمية في المخزون">
              <input
                type="text"
                value={String(form.quantity_in_stock ?? 234)}
                onChange={(e) => setF("quantity_in_stock", Number(e.target.value) || 0)}
                className="h-[34px] w-full px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] text-right outline-none focus:border-[#4A6B82] transition-colors"
              />
            </FormField>
          </div>
        </div>

        {/* Row 8: Footer Action Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-[#D7DEE4] bg-white mt-1">
          {/* Bottom Left: Import Excel */}
          <div>
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
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-[34px] px-4 rounded-[6px] bg-[#4A6B82] hover:bg-[#3C5A6F] text-white text-[12px] font-medium flex items-center gap-1.5 transition-colors"
            >
              <FileSpreadsheet className="size-4" />
              <span>استيراد اكسل</span>
            </button>
          </div>

          {/* Bottom Right Cluster: Exit, Movement, New, Delete, Save */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exit}
              className="h-[34px] px-4 rounded-[6px] border border-[#D7DEE4] bg-white hover:bg-[#F6F7F9] text-[#1E2A33] text-[12px] font-medium flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="size-4" />
              <span>خروج</span>
            </button>

            <button
              type="button"
              onClick={scrollToLedger}
              className="h-[34px] px-4 rounded-[6px] border border-[#D7DEE4] bg-white hover:bg-[#F6F7F9] text-[#1E2A33] text-[12px] font-medium flex items-center gap-1.5 transition-colors"
            >
              <History className="size-4" />
              <span>حركة مادة</span>
            </button>

            <button
              type="button"
              onClick={openBlank}
              className="h-[34px] px-4 rounded-[6px] border border-[#D7DEE4] bg-white hover:bg-[#F6F7F9] text-[#1E2A33] text-[12px] font-medium flex items-center gap-1.5 transition-colors"
            >
              <Plus className="size-4" />
              <span>جديد</span>
            </button>

            <button
              type="button"
              onClick={remove}
              disabled={busy || !activeId}
              className="h-[34px] px-4 rounded-[6px] bg-[#FCE8EA] hover:bg-[#F8D2D5] text-[#DF202E] text-[12px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
            >
              <Trash2 className="size-4 text-[#DF202E]" />
              <span>حذف</span>
            </button>

            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="h-[34px] px-5 rounded-[6px] bg-[#4A6B82] hover:bg-[#3C5A6F] text-white text-[12px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              <span>حفظ</span>
            </button>
          </div>
        </div>
      </main>

      {/* Auxiliary Modals */}
      {printOpen && barcodeItem && (
        <BarcodePrintPanel
          items={[{ item: barcodeItem, copies: 1 }]}
          onClose={() => setPrintOpen(false)}
        />
      )}

      {multiOpen && activeId && (
        <MultiBarcodeModal medicineId={activeId} onClose={() => setMultiOpen(false)} />
      )}

      {addPanelOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-6">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-4 border border-[#D7DEE4]">
            <AddMaterialPanel
              categories={categories}
              onCancel={() => setAddPanelOpen(false)}
              onConfirm={applyAddSeed}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function FormField({
  label,
  required = false,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[12px] font-normal text-[#5C7385] text-right">
        {label}
        {required && <span className="text-[#DF202E] mr-0.5">*</span>}
      </span>
      {children}
    </div>
  );
}

function StepperInput({
  value,
  onChange,
  onIncrement,
  onDecrement,
  bold = false,
  className = "",
  placeholder,
  disabled = false,
  icon,
}: {
  value: string | number;
  onChange?: (val: string) => void;
  onIncrement?: () => void;
  onDecrement?: () => void;
  bold?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const handleInc = () => {
    if (onIncrement) {
      onIncrement();
    } else if (onChange) {
      const num = Number(value) || 0;
      onChange(String(num + 1));
    }
  };

  const handleDec = () => {
    if (onDecrement) {
      onDecrement();
    } else if (onChange) {
      const num = Number(value) || 0;
      onChange(String(Math.max(0, num - 1)));
    }
  };

  return (
    <div
      className={`relative flex items-center bg-white border border-[#D7DEE4] rounded-[6px] h-[34px] transition-colors focus-within:border-[#4A6B82] ${
        disabled ? "opacity-60 pointer-events-none" : ""
      } ${className}`}
    >
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full h-full bg-transparent px-2.5 text-right text-[13px] text-[#1E2A33] outline-none ${
          bold ? "font-bold" : "font-normal"
        }`}
      />
      {icon && <div className="pl-1 text-[#5C7385] shrink-0">{icon}</div>}
      <div className="w-[1px] h-full bg-[#CDCDCD] shrink-0" />
      <div className="w-[18px] h-full flex flex-col shrink-0 select-none">
        <button
          type="button"
          tabIndex={-1}
          onClick={handleInc}
          className="flex-1 flex items-center justify-center text-[#5C7385] hover:text-[#1E2A33] hover:bg-[#F6F7F9] active:bg-[#EDF0F2]"
        >
          <ChevronUp className="size-3" />
        </button>
        <div className="h-[1px] w-full bg-[#EDF0F2]" />
        <button
          type="button"
          tabIndex={-1}
          onClick={handleDec}
          className="flex-1 flex items-center justify-center text-[#5C7385] hover:text-[#1E2A33] hover:bg-[#F6F7F9] active:bg-[#EDF0F2]"
        >
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  );
}

function ImageSlot({
  side,
  activeId,
  label,
}: {
  side: "front" | "back";
  activeId: string | null;
  label: string;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const storageKey = activeId ? `product-img:${activeId}:${side}` : null;

  useEffect(() => {
    if (!storageKey) {
      setImgUrl(null);
      return;
    }
    try {
      const val = localStorage.getItem(storageKey);
      setImgUrl(val || null);
    } catch {
      setImgUrl(null);
    }
  }, [storageKey]);

  const handlePick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || "");
      setImgUrl(res);
      if (storageKey) localStorage.setItem(storageKey, res);
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    setImgUrl(null);
    if (storageKey) localStorage.removeItem(storageKey);
  };

  return (
    <label className="relative group flex flex-col items-center justify-center gap-0.5 h-[46px] w-[46px] rounded-[6px] border border-dashed border-[#D7DEE4] bg-white hover:border-[#4A6B82] cursor-pointer overflow-hidden transition-colors">
      {imgUrl ? (
        <>
          <img src={imgUrl} alt={label} className="absolute inset-0 w-full h-full object-cover" />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handleClear();
            }}
            className="absolute top-0.5 left-0.5 bg-[#DF202E] text-white text-[9px] size-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </>
      ) : (
        <>
          <span className="text-[11px] font-medium text-[#1E2A33]">{label}</span>
          <span className="text-[9px] text-[#5C7385]">+ صورة</span>
        </>
      )}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handlePick(e.target.files?.[0])}
      />
    </label>
  );
}

function MultiBarcodeModal({
  medicineId,
  onClose,
}: {
  medicineId: string;
  onClose: () => void;
}) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    const cur = getBarcodeAliases(medicineId);
    setList(cur.length ? cur : [""]);
  }, [medicineId]);

  const save = () => {
    setBarcodeAliases(medicineId, list.filter(Boolean));
    toast.success("تم حفظ الباركودات المتعددة");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-6" dir="rtl">
      <div className="bg-white border border-[#D7DEE4] rounded-[8px] w-full max-w-md flex flex-col shadow-2xl">
        <header className="p-4 border-b border-[#D7DEE4] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#1E2A33]">إضافة باركودات بديلة لنفس المادة</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#5C7385] hover:text-[#1E2A33]"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
          {list.map((v, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                value={v}
                onChange={(e) =>
                  setList((l) => l.map((x, j) => (j === i ? e.target.value : x)))
                }
                placeholder="باركود بديل..."
                className="h-[34px] flex-1 px-2.5 rounded-[6px] border border-[#D7DEE4] bg-white text-[13px] text-[#1E2A33] font-mono outline-none focus:border-[#4A6B82]"
              />
              <button
                type="button"
                onClick={() =>
                  setList((l) => (l.length === 1 ? [""] : l.filter((_, j) => j !== i)))
                }
                className="size-[34px] flex items-center justify-center rounded-[6px] border border-[#D7DEE4] bg-white text-[#5C7385] hover:text-[#DF202E]"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setList((l) => [...l, ""])}
            className="px-3 py-1.5 rounded-[6px] border border-[#D7DEE4] bg-white hover:bg-[#F6F7F9] text-[#1E2A33] text-[12px] font-medium"
          >
            + إضافة باركود
          </button>
        </div>
        <footer className="p-4 border-t border-[#D7DEE4] flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[6px] border border-[#D7DEE4] text-[#1E2A33] text-[12px] font-medium hover:bg-[#F6F7F9]"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={save}
            className="px-4 py-2 rounded-[6px] bg-[#4A6B82] text-white text-[12px] font-medium hover:bg-[#3C5A6F]"
          >
            حفظ
          </button>
        </footer>
      </div>
    </div>
  );
}
