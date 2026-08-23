import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { listMedicines, normalizeDate, type Medicine } from "@/lib/db";
import { formatIQD } from "@/lib/pharmacy";
import { useI18n } from "@/lib/i18n";
import { BarcodePrintPanel } from "@/components/barcode-print";
import { Barcode as BarcodeIcon, PackageMinus, IdCard } from "lucide-react";
import { SuppliersWorkspace } from "@/components/suppliers-workspace";
import { useMedicineColors, tintFromHex } from "@/lib/highlight-colors";

export const Route = createFileRoute("/purchases")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "فاتورة الشراء — Breef Pharmacy" },
      { name: "description", content: "تسجيل فواتير الشراء وزيادة المخزون تلقائياً." },
    ],
  }),
  component: PurchasesPage,
});

type Supplier = { id: string; name: string; phone: string | null; notes: string | null; default_discount_pct?: number | null };
type PurchaseInvoice = {
  id: string;
  invoice_no: number;
  supplier_id: string | null;
  notes: string | null;
  total: number;
  created_at: string;
};

type RowUnit = "box" | "strip";
type Row = {
  id: number;
  medicineId: string;
  name: string;
  barcode: string | null;
  qty: number;
  returned: number;
  unit: RowUnit;
  packing: number; // units per box (strips per box, or generic factor)
  unitCost: number; // cost per selected unit (box or strip)
  expiry: string; // yyyy-mm-dd
  profitPct: number; // retail profit %
  boxPrice: number; // retail box price
  wholesaleProfitPct: number;
  wholesalePrice: number; // linked to product card's wholesale_large_price
};

function PurchasesPage() {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const colors = useMedicineColors();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);

  // Header state
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierName, setSupplierName] = useState<string>("");
  const [supplierQuery, setSupplierQuery] = useState<string>("");
  const [supplierOpen, setSupplierOpen] = useState(false);

  // Grid state
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [itemOpen, setItemOpen] = useState(false);

  // Footer
  const [extraExpenses, setExtraExpenses] = useState(0);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceDiscountPct, setInvoiceDiscountPctRaw] = useState(0);
  const [paymentType, setPaymentType] = useState<"cash" | "credit" | "partial">("cash");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrResult, setOcrResult] = useState<any>(null);



  // Barcode print
  const [printRow, setPrintRow] = useState<Row | null>(null);

  // Negative stock panel
  const [negOpen, setNegOpen] = useState(false);
  const [negSelected, setNegSelected] = useState<Record<string, boolean>>({});

  // Navigation
  const [cursor, setCursor] = useState<number>(-1); // -1 = new invoice draft

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [view, setView] = useState<"invoice" | "suppliers">("invoice");

  // Focus pipeline: qty → cost → expiry → profit%
  const focusRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const registerField = (lineId: number, field: string) => (el: HTMLInputElement | null) => {
    const key = `${lineId}:${field}`;
    if (el) focusRefs.current.set(key, el);
    else focusRefs.current.delete(key);
  };
  const focusField = (lineId: number, field: string) => {
    requestAnimationFrame(() => {
      const el = focusRefs.current.get(`${lineId}:${field}`);
      if (el) { el.focus(); el.select?.(); }
    });
  };
  const nextField = (current: "qty" | "cost" | "expiry" | "profit"): "cost" | "expiry" | "profit" | null =>
    current === "qty" ? "cost" : current === "cost" ? "expiry" : current === "expiry" ? "profit" : null;


  // Load base data
  useEffect(() => {
    (async () => {
      const [meds, sup, inv] = await Promise.all([
        listMedicines().catch(() => [] as Medicine[]),
        supabase.from("suppliers").select("*").order("name").then((r) => (r.data ?? []) as Supplier[]),
        supabase
          .from("purchase_invoices")
          .select("*")
          .order("created_at", { ascending: false })
          .then((r) => (r.data ?? []) as PurchaseInvoice[]),
      ]);
      setMedicines(meds);
      setSuppliers(sup);
      setInvoices(inv);
    })();
  }, []);

  const selectedMedicine = useMemo(() => {
    if (selectedLine === null) return undefined;
    const r = rows.find((x) => x.id === selectedLine);
    if (!r) return undefined;
    return medicines.find((m) => m.id === r.medicineId);
  }, [selectedLine, rows, medicines]);

  const supplierDebt = useMemo(() => {
    if (!supplierId) return 0;
    // Proxy for outstanding balance: sum of prior invoices for this supplier.
    return invoices.reduce((s, i) => s + (i.supplier_id === supplierId ? Number(i.total) : 0), 0);
  }, [supplierId, invoices]);

  // ---- Row helpers -------------------------------------------------------
  const addMedicineRow = (m: Medicine) => {
    const packing = Math.max(1, m.units_per_large || 1);
    const boxCost = Number(m.large_unit_cost) || 0;
    const stripCost = Number(m.small_unit_cost) || Number(m.purchase_price) || 0;
    const boxPrice = Number(m.large_unit_price) || 0;
    const wholesalePrice = Number(m.wholesale_large_price) || Number(m.wholesale_small_price) * packing || 0;
    const unit: RowUnit = boxCost > 0 ? "box" : "strip";
    const unitCost = unit === "box" ? boxCost || stripCost * packing : stripCost;
    const effectiveBoxCost = boxCost > 0 ? boxCost : stripCost * packing;
    const profitPct = effectiveBoxCost > 0
      ? Math.round(((boxPrice - effectiveBoxCost) / effectiveBoxCost) * 100)
      : 0;
    const wholesaleProfitPct = effectiveBoxCost > 0 && wholesalePrice > 0
      ? Math.round(((wholesalePrice - effectiveBoxCost) / effectiveBoxCost) * 100)
      : 0;
    const line: Row = {
      id: Date.now() + Math.random(),
      medicineId: m.id,
      name: m.trade_name,
      barcode: m.barcode,
      qty: 1,
      returned: 0,
      unit,
      packing,
      unitCost,
      expiry: m.expiry_date ?? "",
      profitPct,
      boxPrice,
      wholesaleProfitPct,
      wholesalePrice,
    };
    setRows((rs) => [...rs, line]);
    setSelectedLine(line.id);
    setItemQuery("");
    setItemOpen(false);
    // Seamless focus traversal: jump straight into Qty for the new row.
    focusField(line.id, "qty");
  };


  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        const boxCost = next.unit === "box"
          ? next.unitCost
          : next.unitCost * Math.max(1, next.packing);
        // Re-derive retail box price when profit % or cost/unit/packing changes
        if (patch.profitPct !== undefined || patch.unitCost !== undefined || patch.unit !== undefined || patch.packing !== undefined) {
          next.boxPrice = Math.round(boxCost * (1 + next.profitPct / 100));
        }
        // Re-derive wholesale price when its profit % (or cost inputs) change
        if (patch.wholesaleProfitPct !== undefined || patch.unitCost !== undefined || patch.unit !== undefined || patch.packing !== undefined) {
          next.wholesalePrice = Math.round(boxCost * (1 + next.wholesaleProfitPct / 100));
        }
        // Manual wholesale price edit → back-calculate wholesale profit %
        if (patch.wholesalePrice !== undefined && patch.wholesaleProfitPct === undefined) {
          next.wholesaleProfitPct = boxCost > 0
            ? Math.round(((next.wholesalePrice - boxCost) / boxCost) * 100)
            : 0;
        }
        // Manual retail box price edit → back-calculate retail profit %
        if (patch.boxPrice !== undefined && patch.profitPct === undefined) {
          next.profitPct = boxCost > 0
            ? Math.round(((next.boxPrice - boxCost) / boxCost) * 100)
            : 0;
        }
        return next;
      }),
    );

  const removeRow = (id: number) =>
    setRows((rs) => {
      const next = rs.filter((r) => r.id !== id);
      if (selectedLine === id) setSelectedLine(next[0]?.id ?? null);
      return next;
    });

  const rowLineTotal = (r: Row) => Math.max(0, r.qty - r.returned) * r.unitCost;
  const rowReturnValue = (r: Row) => Math.max(0, r.returned) * r.unitCost;

  const gridSubtotal = useMemo(() => rows.reduce((s, r) => s + rowLineTotal(r), 0), [rows]);
  const totalReturnValue = useMemo(() => rows.reduce((s, r) => s + rowReturnValue(r), 0), [rows]);
  const afterDiscount = Math.max(0, gridSubtotal - (Number(invoiceDiscount) || 0));
  const grandTotal = afterDiscount + (Number(extraExpenses) || 0);

  const setInvoiceDiscountPct = (pct: number) => {
    const p = Math.max(0, Math.min(100, pct));
    setInvoiceDiscountPctRaw(p);
    setInvoiceDiscount(Math.round((gridSubtotal * p) / 100));
  };
  const setInvoiceDiscountAmt = (amt: number) => {
    setInvoiceDiscount(Math.max(0, amt));
    setInvoiceDiscountPctRaw(0);
  };

  // ---- Actions -----------------------------------------------------------
  const resetDraft = () => {
    setRows([]);
    setSelectedLine(null);
    setExtraExpenses(0);
    setInvoiceDiscount(0);
    setInvoiceDiscountPctRaw(0);
    setInvoiceNo("");
    setSupplierId("");
    setSupplierName("");
    setSupplierQuery("");
    setPaymentType("cash");
    setPaidAmount(0);

    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setCursor(-1);
  };

  const ensureSupplier = async (): Promise<string | null> => {
    if (supplierId) return supplierId;
    const nm = supplierName.trim();
    if (!nm) return null;
    const { data, error } = await supabase.from("suppliers").insert({ name: nm }).select("*").single();
    if (error) throw error;
    const s = data as Supplier;
    setSuppliers((xs) => [...xs, s].sort((a, b) => a.name.localeCompare(b.name)));
    setSupplierId(s.id);
    return s.id;
  };

  const save = async () => {
    if (rows.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const supId = await ensureSupplier();
      const noteBits = [
        invoiceNo ? `Ref#${invoiceNo}` : null,
        `date:${invoiceDate}`,
        `pay:${paymentType}`,
        paymentType === "partial" ? `paid:${paidAmount}` : null,
        extraExpenses ? `expenses:${extraExpenses}` : null,
      ].filter(Boolean);

      const { data: inv, error } = await supabase
        .from("purchase_invoices")
        .insert({
          total: grandTotal,
          supplier_id: supId,
          notes: noteBits.join(" | "),
          payment_type: paymentType,
          paid_amount: paymentType === "cash" ? grandTotal : paymentType === "credit" ? 0 : Math.max(0, Math.min(grandTotal, paidAmount)),
        })
        .select("*")
        .single();
      if (error) throw error;


      const items = rows.map((r) => {
        const effectiveQty = Math.max(0, r.qty - r.returned);
        // Convert to piece-level qty (stock is stored in pieces)
        const pieces = r.unit === "box" ? effectiveQty * Math.max(1, r.packing) : effectiveQty;
        const stripCost = r.unit === "box" ? r.unitCost / Math.max(1, r.packing) : r.unitCost;
        return {
          invoice_id: inv.id,
          medicine_id: r.medicineId,
          qty: pieces,
          unit_cost: stripCost,
          line_total: pieces * stripCost,
        };
      });
      const { error: itemsErr } = await supabase.from("purchase_invoice_items").insert(items);
      if (itemsErr) throw itemsErr;

      // Sync new pricing / expiry back to medicines
      await Promise.all(
        rows.map((r) => {
          const stripCost = r.unit === "box" ? r.unitCost / Math.max(1, r.packing) : r.unitCost;
          const boxCost = stripCost * Math.max(1, r.packing);
          const packing = Math.max(1, r.packing);
          const smallPrice = Math.round(r.boxPrice / packing);
          const wholesaleSmall = Math.round(r.wholesalePrice / packing);
          return supabase
            .from("medicines")
            .update({
              purchase_price: stripCost,
              selling_price: smallPrice,
              small_unit_cost: stripCost,
              small_unit_price: smallPrice,
              large_unit_cost: boxCost,
              large_unit_price: r.boxPrice,
              wholesale_large_price: r.wholesalePrice,
              wholesale_small_price: wholesaleSmall,
              units_per_large: r.packing,
              expiry_date: normalizeDate(r.expiry, "تاريخ الصلاحية"),
            })
            .eq("id", r.medicineId);
        }),
      );

      setMsg({ kind: "ok", text: isAr ? "تم حفظ فاتورة الشراء وتحديث المخزون والأسعار." : "Purchase saved. Stock & prices updated." });
      // refresh
      const [meds, invs] = await Promise.all([
        listMedicines(),
        supabase
          .from("purchase_invoices")
          .select("*")
          .order("created_at", { ascending: false })
          .then((r) => (r.data ?? []) as PurchaseInvoice[]),
      ]);
      setMedicines(meds);
      setInvoices(invs);
      resetDraft();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const loadInvoiceAt = async (index: number) => {
    if (index < 0 || index >= invoices.length) return;
    const inv = invoices[index];
    setCursor(index);
    setInvoiceDate((inv.created_at ?? "").slice(0, 10) || invoiceDate);
    setSupplierId(inv.supplier_id ?? "");
    const sup = suppliers.find((s) => s.id === inv.supplier_id);
    setSupplierName(sup?.name ?? "");
    setSupplierQuery(sup?.name ?? "");
    const refMatch = inv.notes?.match(/Ref#(\S+)/);
    setInvoiceNo(refMatch?.[1] ?? String(inv.invoice_no));
    const payMatch = inv.notes?.match(/pay:(cash|credit|partial)/);
    setPaymentType((payMatch?.[1] as "cash" | "credit" | "partial") ?? "cash");
    const paidMatch = inv.notes?.match(/paid:(\d+(?:\.\d+)?)/);
    setPaidAmount(paidMatch ? Number(paidMatch[1]) : 0);

    const expMatch = inv.notes?.match(/expenses:(\d+(?:\.\d+)?)/);
    setExtraExpenses(expMatch ? Number(expMatch[1]) : 0);
    const { data } = await supabase
      .from("purchase_invoice_items")
      .select("*")
      .eq("invoice_id", inv.id);
    const items = (data ?? []) as Array<{ medicine_id: string; qty: number; unit_cost: number }>;
    const loaded: Row[] = items.map((it) => {
      const m = medicines.find((x) => x.id === it.medicine_id);
      const packing = Math.max(1, m?.units_per_large || 1);
      const boxCost = it.unit_cost * packing;
      const boxPrice = Number(m?.large_unit_price) || (Number(m?.small_unit_price) || 0) * packing;
      const wholesalePrice = Number(m?.wholesale_large_price) || (Number(m?.wholesale_small_price) || 0) * packing;
      const profitPct = boxCost > 0 ? Math.round(((boxPrice - boxCost) / boxCost) * 100) : 0;
      const wholesaleProfitPct = boxCost > 0 && wholesalePrice > 0
        ? Math.round(((wholesalePrice - boxCost) / boxCost) * 100)
        : 0;
      return {
        id: Date.now() + Math.random(),
        medicineId: it.medicine_id,
        name: m?.trade_name ?? "—",
        barcode: m?.barcode ?? null,
        qty: it.qty,
        returned: 0,
        unit: "strip" as RowUnit,
        packing,
        unitCost: it.unit_cost,
        expiry: m?.expiry_date ?? "",
        profitPct,
        boxPrice,
        wholesaleProfitPct,
        wholesalePrice,
      };
    });
    setRows(loaded);
    setSelectedLine(loaded[0]?.id ?? null);
  };

  const deleteInvoice = async () => {
    if (cursor < 0) {
      resetDraft();
      return;
    }
    const inv = invoices[cursor];
    if (!confirm(isAr ? "حذف الفاتورة نهائياً؟" : "Delete this invoice permanently?")) return;
    setBusy(true);
    try {
      await supabase.from("purchase_invoice_items").delete().eq("invoice_id", inv.id);
      await supabase.from("purchase_invoices").delete().eq("id", inv.id);
      const invs = await supabase
        .from("purchase_invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .then((r) => (r.data ?? []) as PurchaseInvoice[]);
      setInvoices(invs);
      setMsg({ kind: "ok", text: isAr ? "تم حذف الفاتورة." : "Invoice deleted." });
      resetDraft();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const printInvoice = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const sup = suppliers.find((s) => s.id === supplierId)?.name ?? supplierName ?? "—";
    const lines = rows
      .map(
        (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="text-align:right;">${r.name}</td>
          <td>${r.qty}</td>
          <td>${r.unitCost.toLocaleString()}</td>
          <td>${rowLineTotal(r).toLocaleString()}</td>
        </tr>`,
      )
      .join("");
    w.document.write(`<html dir="rtl"><head><title>فاتورة شراء</title>
      <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px;text-align:center}h2{margin:0}</style>
      </head><body><h2>فاتورة شراء #${invoiceNo || "—"}</h2>
      <p>المورد: ${sup} — التاريخ: ${invoiceDate}</p>
      <table><thead><tr><th>#</th><th>المادة</th><th>الكمية</th><th>الكلفة</th><th>الإجمالي</th></tr></thead>
      <tbody>${lines}</tbody></table>
      <h3 style="text-align:left;">الإجمالي: ${grandTotal.toLocaleString()} د.ع</h3></body></html>`);
    w.document.close();
    w.print();
  };

  const printReturnInvoice = () => {
    const returned = rows.filter((r) => r.returned > 0);
    if (returned.length === 0) {
      setMsg({ kind: "err", text: isAr ? "لا توجد كميات مُرتجعة في هذه الفاتورة." : "No returned quantities on this invoice." });
      return;
    }
    const w = window.open("", "_blank");
    if (!w) return;
    const sup = suppliers.find((s) => s.id === supplierId)?.name ?? supplierName ?? "—";
    const lines = returned
      .map(
        (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="text-align:right;">${r.name}</td>
          <td>${r.returned}</td>
          <td>${r.unitCost.toLocaleString()}</td>
          <td>${(r.returned * r.unitCost).toLocaleString()}</td>
        </tr>`,
      )
      .join("");
    const totalReturn = returned.reduce((s, r) => s + r.returned * r.unitCost, 0);
    w.document.write(`<html dir="rtl"><head><title>فاتورة مرتجع شراء</title>
      <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #c0392b;padding:6px;text-align:center}h2{margin:0;color:#c0392b}</style>
      </head><body><h2>فاتورة مرتجع شراء #${invoiceNo || "—"}</h2>
      <p>المورد: ${sup} — التاريخ: ${invoiceDate}</p>
      <table><thead><tr><th>#</th><th>المادة</th><th>المرتجع</th><th>الكلفة</th><th>الإجمالي</th></tr></thead>
      <tbody>${lines}</tbody></table>
      <h3 style="text-align:left;color:#c0392b;">إجمالي المرتجع: ${totalReturn.toLocaleString()} د.ع</h3></body></html>`);
    w.document.close();
    w.print();
  };

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(supplierQuery.toLowerCase()),
  );
  const filteredMeds = medicines
    .filter((m) => {
      if (!itemQuery.trim()) return true;
      const q = itemQuery.toLowerCase();
      return (
        m.trade_name.toLowerCase().includes(q) ||
        (m.scientific_name || "").toLowerCase().includes(q) ||
        (m.barcode || "").includes(q)
      );
    })
    .slice(0, 30);

  const negativeStockItems = useMemo(
    () => medicines.filter((m) => (m.quantity_in_stock || 0) < 0),
    [medicines],
  );

  const importSelectedNegatives = () => {
    const ids = Object.entries(negSelected).filter(([, v]) => v).map(([id]) => id);
    if (ids.length === 0) return;
    ids.forEach((id) => {
      const m = medicines.find((x) => x.id === id);
      if (m) addMedicineRow(m);
    });
    setNegSelected({});
    setNegOpen(false);
  };


  return (
    <AppShell title={isAr ? "فاتورة الشراء" : "Purchase Invoice"} medicine={selectedMedicine}>
      <div className="px-4 pt-3 border-b border-border bg-slate-950/70 flex items-center gap-1 shrink-0" dir={isAr ? "rtl" : "ltr"}>
        {(["invoice", "suppliers"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg border-b-2 transition ${
              view === v
                ? "border-emerald text-emerald bg-slate-900"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "invoice"
              ? isAr ? "🧾 فاتورة الشراء" : "🧾 Purchase Invoice"
              : isAr ? "🏬 مذاخر" : "🏬 Suppliers"}
          </button>
        ))}
      </div>
      {view === "suppliers" ? (
        <SuppliersWorkspace />
      ) : (
      <div className="flex-1 flex flex-col overflow-hidden" dir={isAr ? "rtl" : "ltr"}>
        {/* Header metadata — single compact row incl. item search */}
        <div className="px-3 py-2 border-b border-border bg-slate-950/50 flex items-end gap-2 shrink-0">
          <Field label={isAr ? "التاريخ" : "Date"}>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-[130px] bg-slate-800 border border-border rounded-md px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
            />
          </Field>
          <Field label={isAr ? "رقم الفاتورة" : "Invoice #"}>
            <input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder={isAr ? "رقم مرجعي" : "Reference"}
              className="w-[110px] bg-slate-800 border border-border rounded-md px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
            />
          </Field>
          <Field label={isAr ? "اسم المورد" : "Supplier"}>
            <div className="relative w-[160px]">
              <input
                value={supplierQuery}
                onFocus={() => setSupplierOpen(true)}
                onChange={(e) => {
                  setSupplierQuery(e.target.value);
                  setSupplierName(e.target.value);
                  setSupplierId("");
                  setSupplierOpen(true);
                }}
                onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
                placeholder={isAr ? "اختر مورد" : "Pick supplier"}
                className="w-full bg-slate-800 border border-border rounded-md px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
              />
              {supplierOpen && filteredSuppliers.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-52 overflow-auto bg-slate-900 border border-border rounded-lg shadow-xl">
                  {filteredSuppliers.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={() => {
                        setSupplierId(s.id);
                        setSupplierName(s.name);
                        setSupplierQuery(s.name);
                        setSupplierOpen(false);
                        // Auto-inherit the supplier's default discount percentage.
                        const pct = Math.max(0, Math.min(100, Number(s.default_discount_pct ?? 0) || 0));
                        setInvoiceDiscountPct(pct);
                        if (pct > 0) {
                          setMsg({ kind: "ok", text: isAr ? `تم تطبيق خصم المورد الافتراضي ${pct}%` : `Applied supplier default discount ${pct}%` });
                        }
                      }}
                      className="w-full text-right px-3 py-2 text-xs hover:bg-emerald/15"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <Field label={isAr ? "ديون المورد" : "Supplier debt"}>
            <div className="w-[120px] bg-slate-800/60 border border-border rounded-md px-2 py-1 text-xs font-mono text-accent font-bold tabular-nums">
              {supplierDebt.toLocaleString()} {isAr ? "د.ع" : "IQD"}
            </div>
          </Field>
          <div className="flex-1 min-w-[180px]">
            <Field label={isAr ? "بحث باركود / اسم مادة" : "Barcode / item search"}>
              <div className="relative">
                <input
                  value={itemQuery}
                  onFocus={() => setItemOpen(true)}
                  onChange={(e) => {
                    setItemQuery(e.target.value);
                    setItemOpen(true);
                  }}
                  onBlur={() => setTimeout(() => setItemOpen(false), 150)}
                  placeholder={isAr ? "ابحث لإضافة مادة..." : "Search to add..."}
                  className="w-full bg-slate-800 border border-border rounded-md px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
                />
                {itemOpen && filteredMeds.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto bg-slate-900 border border-border rounded-lg shadow-xl">
                    {filteredMeds.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onMouseDown={() => addMedicineRow(m)}
                        className="w-full flex justify-between items-center gap-3 px-3 py-2 text-xs hover:bg-emerald/15 border-b border-border/50 last:border-b-0"
                      >
                        <span className="font-mono text-[10px] text-muted-foreground">{m.barcode ?? "—"}</span>
                        <span className="flex-1 text-right">{m.trade_name}</span>
                        <span className="text-[10px] text-muted-foreground">{m.scientific_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          </div>
        </div>


        {msg && (
          <p
            className={`mx-4 mt-3 text-xs rounded-lg p-2 border ${
              msg.kind === "ok"
                ? "bg-emerald/10 border-emerald/30 text-emerald"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
          >
            {msg.text}
          </p>
        )}

        {/* Grid */}
        <section className="flex-1 overflow-auto" dir="rtl">
          <table className="w-full text-right border-collapse text-sm" dir="rtl">
            <thead className="sticky top-0 bg-slate-950/85 backdrop-blur-md z-10">
              <tr className="border-b border-border">
                <Th className="w-8">#</Th>
                <Th className="min-w-[240px] w-[34%]">{isAr ? "اسم المادة" : "Item Name"}</Th>
                <Th className="w-14">{isAr ? "كمية" : "Qty"}</Th>
                <Th className="w-14">{isAr ? "الراجع" : "Return"}</Th>
                <Th className="w-20">{isAr ? "الوحدة" : "Unit"}</Th>
                <Th className="w-20">{isAr ? "الكلفة" : "Cost"}</Th>
                <Th className="w-28">{isAr ? "الإكسباير" : "Expiry"}</Th>
                <Th className="w-16">{isAr ? "الربح %" : "Profit %"}</Th>
                <Th className="w-24">{isAr ? "سعر البيع" : "Retail"}</Th>
                <Th className="w-24">{isAr ? "سعر خاص" : "Special"}</Th>
                <Th className="w-24">{isAr ? "الإجمالي" : "Total"}</Th>
                <Th className="w-20">{isAr ? "إجراءات" : "Actions"}</Th>

              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((r, i) => {
                const active = selectedLine === r.id;
                const tint = r.medicineId ? colors.get(r.medicineId) : undefined;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedLine(r.id)}
                    className={`cursor-pointer transition ${active ? "bg-emerald/10" : "hover:bg-slate-900/50"}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-3 py-2">
                      <div
                        className="inline-block px-2 py-0.5 rounded-md font-medium"
                        style={tint ? { backgroundColor: tintFromHex(tint, 0.35), boxShadow: `inset 0 0 0 1px ${tint}` } : undefined}
                      >
                        {r.name}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <NumCell
                        value={r.qty}
                        min={1}
                        onChange={(n) => updateRow(r.id, { qty: n })}
                        inputRef={registerField(r.id, "qty")}
                        onEnter={() => focusField(r.id, "cost")}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumCell value={r.returned} min={0} onChange={(n) => updateRow(r.id, { returned: n })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateRow(r.id, { unit: r.unit === "box" ? "strip" : "box" });
                        }}
                        className="px-2 py-1 rounded-md bg-slate-800 border border-emerald/30 text-emerald text-[11px] font-bold hover:bg-emerald/15"
                      >
                        {r.unit === "box" ? (isAr ? "باكيت" : "Box") : isAr ? "شريط" : "Strip"}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <NumCell
                        value={r.unitCost}
                        min={0}
                        onChange={(n) => updateRow(r.id, { unitCost: n })}
                        wide
                        inputRef={registerField(r.id, "cost")}
                        onEnter={() => focusField(r.id, "expiry")}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        ref={registerField(r.id, "expiry")}
                        type="date"
                        value={r.expiry || ""}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusField(r.id, "profit"); } }}
                        onChange={(e) => updateRow(r.id, { expiry: e.target.value })}
                        className="w-full bg-slate-800 border border-border rounded px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumCell
                        value={r.profitPct}
                        min={0}
                        onChange={(n) => updateRow(r.id, { profitPct: n })}
                        inputRef={registerField(r.id, "profit")}
                      />
                    </td>

                    <td className="px-2 py-2 font-mono text-xs text-emerald tabular-nums text-center">
                      {r.boxPrice.toLocaleString()}
                    </td>
                    <td className="px-2 py-2">
                      <NumCell
                        value={r.wholesalePrice}
                        min={0}
                        onChange={(n) => updateRow(r.id, { wholesalePrice: n })}
                        wide
                      />
                    </td>
                    <td className="px-2 py-2 font-mono font-bold text-emerald text-center">
                      {rowLineTotal(r).toLocaleString()}
                    </td>
                    <td className="px-1 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.medicineId) navigate({ to: "/products", search: { focus: r.medicineId } as never });
                            else navigate({ to: "/products" });
                          }}
                          className="size-7 grid place-items-center rounded-md bg-slate-800 border border-sky-500/30 text-sky-300 hover:bg-sky-500/15"
                          title={isAr ? "بطاقة المادة" : "Item card"}
                          aria-label="Open item card"
                        >
                          <IdCard className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrintRow(r);
                          }}
                          className="size-7 grid place-items-center rounded-md bg-slate-800 border border-emerald/30 text-emerald hover:bg-emerald/15"
                          title={isAr ? "طباعة باركود" : "Print barcode"}
                          aria-label="Print barcode"
                        >
                          <BarcodeIcon className="size-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRow(r.id);
                          }}
                          className="size-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title={isAr ? "حذف" : "Delete"}
                          aria-label="Delete row"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-16 text-muted-foreground text-sm">
                    {isAr ? "لم تُضف مواد للفاتورة بعد. ابحث في الأعلى لإضافتها." : "No items yet. Search above to add."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Footer totals */}
        <footer className="p-4 bg-slate-950/70 border-t border-border grid grid-cols-6 gap-3 shrink-0">
          <Stat label={isAr ? "مجموع الكلفة" : "Items cost"} value={formatIQD(gridSubtotal)} />
          <Field label={isAr ? "إضافة مصاريف للفاتورة" : "Invoice expenses"}>
            <input
              type="number"
              min={0}
              value={extraExpenses}
              onChange={(e) => setExtraExpenses(Math.max(0, Number(e.target.value) || 0))}
              className="w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm font-mono text-center outline-none focus:ring-2 focus:ring-emerald/40"
            />
          </Field>
          <Field label={isAr ? "خصم %" : "Disc %"}>
            <input
              type="number"
              min={0}
              max={100}
              value={invoiceDiscountPct}
              onChange={(e) => setInvoiceDiscountPct(Number(e.target.value) || 0)}
              className="w-full bg-slate-800 border border-accent/40 rounded-lg px-3 py-2 text-sm font-mono text-center text-accent outline-none focus:ring-2 focus:ring-accent/40"
            />
          </Field>
          <Field label={isAr ? "خصم مبلغ" : "Disc amount"}>
            <input
              type="number"
              min={0}
              value={invoiceDiscount}
              onChange={(e) => setInvoiceDiscountAmt(Number(e.target.value) || 0)}
              className="w-full bg-slate-800 border border-accent/40 rounded-lg px-3 py-2 text-sm font-mono text-center text-accent outline-none focus:ring-2 focus:ring-accent/40"
            />
          </Field>
          <Stat label={isAr ? "بعد الخصم" : "After discount"} value={formatIQD(afterDiscount)} />
          <Stat
            label={isAr ? "الإجمالي النهائي" : "Grand total"}
            value={formatIQD(grandTotal)}
            emphasis
          />
          <div className="col-span-2">
            <Stat label={isAr ? "إجمالي الراجع" : "Total return value"} value={formatIQD(totalReturnValue)} />
          </div>

        </footer>

        {/* Toolbar */}
        <div className="p-3 border-t border-border bg-slate-950/85 flex items-center gap-2 justify-center flex-wrap shrink-0">
          <BarBtn
            onClick={() => loadInvoiceAt(Math.min(invoices.length - 1, cursor + 1))}
            title={isAr ? "الفاتورة السابقة" : "Previous"}
            disabled={cursor >= invoices.length - 1}
          >
            {isAr ? "‹ السابقة" : "‹ Prev"}
          </BarBtn>
          <BarBtn
            onClick={() => (cursor <= 0 ? resetDraft() : loadInvoiceAt(cursor - 1))}
            title={isAr ? "الفاتورة التالية" : "Next"}
            disabled={cursor < 0}
          >
            {isAr ? "التالية ›" : "Next ›"}
          </BarBtn>
          <BarBtn
            onClick={() => {
              const q = prompt(isAr ? "أدخل رقم مرجعي أو اسم المورد للبحث" : "Enter ref# or supplier to search");
              if (!q) return;
              const idx = invoices.findIndex((i) => {
                const sup = suppliers.find((s) => s.id === i.supplier_id);
                return (i.notes ?? "").includes(q) || String(i.invoice_no) === q || sup?.name.includes(q);
              });
              if (idx >= 0) loadInvoiceAt(idx);
              else setMsg({ kind: "err", text: isAr ? "لم يتم العثور على فاتورة." : "No invoice found." });
            }}
          >
            🔍 {isAr ? "بحث عن فاتورة" : "Search"}
          </BarBtn>
          <BarBtn onClick={resetDraft}>➕ {isAr ? "فاتورة جديدة" : "New"}</BarBtn>
          <label className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold border border-sky-500/40 bg-sky-500/10 text-sky-500 cursor-pointer hover:bg-sky-500/20 transition">
            📷 {ocrBusy ? "..." : isAr ? "استيراد من صورة" : "Import from image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={ocrBusy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                e.target.value = "";
                setOcrBusy(true);
                setMsg(null);
                try {
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(String(r.result));
                    r.onerror = () => reject(r.error);
                    r.readAsDataURL(file);
                  });
                  const res = await fetch("/api/purchase-ocr", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ image: dataUrl, mimeType: file.type }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  const parsed = await res.json();
                  if (parsed.invoice_no) setInvoiceNo(String(parsed.invoice_no));
                  if (parsed.supplier) { setSupplierName(String(parsed.supplier)); setSupplierQuery(String(parsed.supplier)); }
                  if (parsed.date) setInvoiceDate(String(parsed.date));
                  setOcrResult(parsed);
                  setMsg({ kind: "ok", text: isAr ? `تم استخراج ${parsed.items?.length ?? 0} صنف — يرجى مراجعة البيانات وإضافة المواد يدوياً.` : `Extracted ${parsed.items?.length ?? 0} items — please review.` });
                } catch (err) {
                  setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
                } finally {
                  setOcrBusy(false);
                }
              }}
            />
          </label>

          <BarBtn onClick={() => setNegOpen(true)} disabled={negativeStockItems.length === 0}>
            ⚠️ {isAr ? `مواد سالبة (${negativeStockItems.length})` : `Negative stock (${negativeStockItems.length})`}
          </BarBtn>
          <BarBtn onClick={printInvoice} disabled={rows.length === 0}>
            🖨 {isAr ? "طباعة فاتورة" : "Print invoice"}
          </BarBtn>
          <BarBtn onClick={printReturnInvoice} disabled={rows.length === 0}>
            ↩️ {isAr ? "طباعة فاتورة مرتجع" : "Print return invoice"}
          </BarBtn>
          <BarBtn onClick={deleteInvoice} danger>
            🗑 {isAr ? "حذف الفاتورة" : "Delete"}
          </BarBtn>
          <button
            type="button"
            onClick={() => setPaymentType((p) => (p === "cash" ? "credit" : p === "credit" ? "partial" : "cash"))}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${
              paymentType === "cash"
                ? "bg-emerald/15 border-emerald/40 text-emerald"
                : paymentType === "credit"
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-amber-500/15 border-amber-500/40 text-amber-500"
            }`}
          >
            {paymentType === "cash"
              ? isAr ? "➔ نقدي ➔" : "➔ Cash ➔"
              : paymentType === "credit"
                ? isAr ? "➔ أجل ➔" : "➔ Credit ➔"
                : isAr ? "➔ جزئي ➔" : "➔ Partial ➔"}
          </button>
          {paymentType === "partial" && (
            <input
              type="number"
              min={0}
              value={paidAmount || ""}
              onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value) || 0))}
              placeholder={isAr ? "المدفوع" : "Paid"}
              className="w-28 px-2 py-2 rounded-lg bg-slate-800 border border-amber-500/40 text-amber-300 text-xs font-mono text-center"
            />
          )}

          <BarBtn onClick={save} disabled={busy || rows.length === 0} primary>
            {busy ? "..." : isAr ? "💾 حفظ فاتورة" : "💾 Save"}
          </BarBtn>
        </div>
      </div>
      )}



      {ocrResult && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setOcrResult(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()} dir="rtl">
            <header className="p-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">📷 نتيجة استخراج الفاتورة (OCR)</h3>
              <button onClick={() => setOcrResult(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </header>
            <div className="p-4 overflow-auto text-xs">
              <div className="grid grid-cols-2 gap-3 mb-3 text-right">
                <div><span className="text-slate-500">رقم الفاتورة:</span> <span className="font-mono font-bold">{ocrResult.invoice_no ?? "—"}</span></div>
                <div><span className="text-slate-500">المورد:</span> <span className="font-bold">{ocrResult.supplier ?? "—"}</span></div>
                <div><span className="text-slate-500">التاريخ:</span> <span className="font-mono">{ocrResult.date ?? "—"}</span></div>
                <div><span className="text-slate-500">الإجمالي:</span> <span className="font-mono font-bold text-emerald-700">{ocrResult.total ?? "—"}</span></div>
              </div>
              <table className="w-full text-right border">
                <thead className="bg-slate-100 text-[10px] uppercase text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5">المادة</th>
                    <th className="px-2 py-1.5">الكمية</th>
                    <th className="px-2 py-1.5">سعر الكلفة</th>
                    <th className="px-2 py-1.5">الصلاحية</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(ocrResult.items ?? []).map((it: any, i: number) => (
                    <tr key={i}>
                      <td className="px-2 py-1">{it.name ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">{it.qty ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">{it.unit_cost ?? "—"}</td>
                      <td className="px-2 py-1 font-mono text-amber-700">{it.expiry ?? "—"}</td>
                    </tr>
                  ))}
                  {(!ocrResult.items || ocrResult.items.length === 0) && (
                    <tr><td colSpan={4} className="px-2 py-4 text-center text-slate-400">لم يتم استخراج أصناف.</td></tr>
                  )}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-slate-500">تمت مطابقة رقم الفاتورة والمورد والتاريخ تلقائياً. أضف الأصناف يدوياً من الحقل المخصص للمطابقة الدقيقة مع قاعدة البيانات.</p>
            </div>
          </div>
        </div>
      )}

      {printRow && (

        <BarcodePrintPanel
          items={[{
            item: {
              id: printRow.medicineId,
              barcode: printRow.barcode ?? "",
              tradeName: printRow.name,
              price: printRow.boxPrice || printRow.wholesalePrice || printRow.unitCost,
            },
            copies: Math.max(1, printRow.qty),
          }]}
          onClose={() => setPrintRow(null)}
        />
      )}

      {negOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm grid place-items-center p-6" onClick={() => setNegOpen(false)}>
          <div className="bg-slate-900 border border-destructive/40 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()} dir={isAr ? "rtl" : "ltr"}>
            <header className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PackageMinus className="size-5 text-destructive" />
                <div>
                  <p className="text-[10px] text-destructive font-bold uppercase tracking-widest">{isAr ? "أرصدة سالبة" : "Negative stock"}</p>
                  <h3 className="text-lg font-bold">{isAr ? "استيراد إلى الفاتورة" : "Import to invoice"}</h3>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={importSelectedNegatives} className="px-4 py-2 bg-emerald text-primary-foreground rounded-lg text-xs font-bold">
                  {isAr ? "إدراج المحدد" : "Insert selected"}
                </button>
                <button onClick={() => setNegOpen(false)} className="px-4 py-2 bg-slate-800 border border-border rounded-lg text-xs font-bold">
                  {isAr ? "إغلاق" : "Close"}
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-auto p-3">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-muted-foreground">
                  <tr><th className="p-2"><input type="checkbox" onChange={(e) => {
                    const all = e.target.checked;
                    const map: Record<string, boolean> = {};
                    if (all) negativeStockItems.forEach((m) => { map[m.id] = true; });
                    setNegSelected(map);
                  }} /></th><th className="p-2 text-right">{isAr ? "المادة" : "Item"}</th><th className="p-2">{isAr ? "الرصيد" : "Balance"}</th></tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {negativeStockItems.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-800/50">
                      <td className="p-2 text-center">
                        <input type="checkbox" checked={!!negSelected[m.id]} onChange={(e) => setNegSelected((s) => ({ ...s, [m.id]: e.target.checked }))} />
                      </td>
                      <td className="p-2 text-right">{m.trade_name}</td>
                      <td className="p-2 text-center font-mono text-destructive font-bold">{m.quantity_in_stock}</td>
                    </tr>
                  ))}
                  {negativeStockItems.length === 0 && (
                    <tr><td colSpan={3} className="p-8 text-center text-muted-foreground">{isAr ? "لا توجد مواد سالبة." : "No negative stock."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
      <p
        className={`font-mono font-bold tabular-nums ${
          emphasis ? "text-2xl text-emerald" : "text-lg text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-right ${className}`}>
      {children}
    </th>
  );
}

function NumCell({
  value,
  onChange,
  min = 0,
  wide,
  inputRef,
  onEnter,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  wide?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  onEnter?: () => void;
}) {
  return (
    <input
      ref={inputRef}
      type="number"
      min={min}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter?.(); } }}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      className={`bg-slate-800 border border-border rounded px-2 py-1 text-center font-mono text-xs outline-none focus:ring-2 focus:ring-emerald/40 ${
        wide ? "w-24" : "w-16"
      }`}
    />
  );
}


function BarBtn({
  children,
  onClick,
  disabled,
  primary,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  title?: string;
}) {
  const base = "px-3 py-2 rounded-lg text-xs font-bold border transition disabled:opacity-40";
  const style = primary
    ? "bg-emerald text-primary-foreground border-emerald hover:brightness-110"
    : danger
      ? "bg-destructive/15 border-destructive/40 text-destructive hover:bg-destructive/25"
      : "bg-slate-800 border-border hover:bg-slate-700";
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${base} ${style}`}>
      {children}
    </button>
  );
}
