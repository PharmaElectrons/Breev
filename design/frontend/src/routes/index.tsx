import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ShoppingBasket, ChevronLeft, ChevronRight, Barcode as BarcodeIcon, IdCard } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { formatIQD } from "@/lib/pharmacy";
import { useI18n } from "@/lib/i18n";
import { getBranding } from "@/lib/branding";


import {
  createPatient,
  listMedicines,
  listPatients,
  listSalesInvoices,
  saveSaleInvoice,
  type Medicine,
  type PatientRow,
  type SaleInvoice,
} from "@/lib/db";
import { getClinical, setClinical } from "@/lib/clinical";
import { addChronicSchedule, medicineDaysPerCycle } from "@/lib/patient-extras";
import { addToCart } from "@/lib/procurement-cart";
import { useMedicineColors, tintFromHex } from "@/lib/highlight-colors";
import { fuzzyFilter, nearestSuggestion } from "@/lib/fuzzy";
import { useQuickAccess, addQuickAccess, removeQuickAccess } from "@/lib/quick-access";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "شاشة البيع — Breef Pharmacy" },
      { name: "description", content: "نقطة بيع الصيدلية مع حفظ الفواتير وإدارة الأدوية المزمنة." },
    ],
  }),
  component: SalesPage,
});

type RowUnit = "strip" | "box";

type Row = {
  lineId: number;
  medicineId: string;
  name: string;
  qty: number;
  price: number;
  cost: number;
  unit: RowUnit;
  /** Doses per day — pre-filled from the product card, editable in the grid. */
  freq: number;
  /** Frequency period for the dosage stepper. */
  freqUnit?: "day" | "week" | "month";

  /** Read-only food interaction from the product card: before | after | any. */
  mealTiming: string;
};

const MEAL_LABEL: Record<string, { ar: string; en: string }> = {
  before: { ar: "قبل الطعام", en: "Before meals" },
  after: { ar: "بعد الطعام", en: "After meals" },
  any: { ar: "لا يتأثر", en: "Any time" },
};

type PaymentType = "cash" | "credit" | "partial";

type CartTab = {
  rows: Row[];
  invoiceDiscount: number;
  invoiceAddOn: number;
  paymentType: PaymentType;
  diagnosis: string;
  patientId: string | null;
};

const emptyTab = (): CartTab => ({
  rows: [],
  invoiceDiscount: 0,
  invoiceAddOn: 0,
  paymentType: "cash",
  diagnosis: "",
  patientId: null,
});



const TAB_LABELS_AR = ["فاتورة معلقة واحد", "فاتورة معلقة اثنين", "فاتورة معلقة ثلاثة"];
const TAB_LABELS_EN = ["Suspended Invoice 1", "Suspended Invoice 2", "Suspended Invoice 3"];

const PATIENT_PANEL_KEY = "breef.patientPanel.collapsed";

function SalesPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();

  // Data
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [savedInvoices, setSavedInvoices] = useState<SaleInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 3 persistent suspended-invoice tabs
  const [tabs, setTabs] = useState<CartTab[]>(() => [emptyTab(), emptyTab(), emptyTab()]);
  const [active, setActive] = useState<0 | 1 | 2>(0);
  const colors = useMedicineColors();
  const current = tabs[active];

  const patchTab = (updater: (t: CartTab) => Partial<CartTab>) =>
    setTabs((ts) => ts.map((t, i) => (i === active ? { ...t, ...updater(t) } : t)));

  // Working invoice state (bound to active tab)
  const rows = current.rows;
  const invoiceDiscount = current.invoiceDiscount;
  const invoiceAddOn = current.invoiceAddOn;
  const paymentType = current.paymentType;
  const diagnosis = current.diagnosis;

  const setRows = (u: Row[] | ((prev: Row[]) => Row[])) =>
    patchTab((t) => ({ rows: typeof u === "function" ? (u as (p: Row[]) => Row[])(t.rows) : u }));
  const setInvoiceDiscount = (u: number | ((p: number) => number)) =>
    patchTab((t) => ({ invoiceDiscount: Math.max(0, typeof u === "function" ? (u as (p: number) => number)(t.invoiceDiscount) : u) }));
  const setInvoiceAddOn = (u: number | ((p: number) => number)) =>
    patchTab((t) => ({ invoiceAddOn: Math.max(0, typeof u === "function" ? (u as (p: number) => number)(t.invoiceAddOn) : u) }));
  const setPaymentType = (u: PaymentType | ((p: PaymentType) => PaymentType)) =>
    patchTab((t) => ({ paymentType: typeof u === "function" ? (u as (p: PaymentType) => PaymentType)(t.paymentType) : u }));
  const setDiagnosis = (u: string) => patchTab(() => ({ diagnosis: u }));



  // Patient (derived from active tab's patientId)
  const patient = useMemo(
    () => (current.patientId ? patients.find((p) => p.id === current.patientId) ?? null : null),
    [current.patientId, patients],
  );
  const setPatient = (p: PatientRow | null) => patchTab(() => ({ patientId: p?.id ?? null }));
  const [patientQuery, setPatientQuery] = useState("");
  const [patientOpen, setPatientOpen] = useState(false);
  const [patientCollapsed, setPatientCollapsed] = useState(false);

  // Barcode scan input
  const [barcodeInput, setBarcodeInput] = useState("");
  const scanRef = useRef<HTMLInputElement | null>(null);



  // Selected row + numpad
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [padBuffer, setPadBuffer] = useState("");
  const [paidAmount, setPaidAmount] = useState<number>(0);

  // Historical invoice browser (prev / next arrows)
  const [browseIdx, setBrowseIdx] = useState<number | null>(null);
  const browsedInvoice = browseIdx != null ? savedInvoices[browseIdx] ?? null : null;
  const cycleBrowse = (dir: -1 | 1) => {
    if (savedInvoices.length === 0) return;
    setBrowseIdx((i) => {
      const start = i ?? -1;
      const next = (start + dir + savedInvoices.length) % savedInvoices.length;
      return next;
    });
  };

  // Fuzzy item picker (substring + typo tolerance) & Quick Access drawer
  const [itemQuery, setItemQuery] = useState("");
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const itemPickerRef = useRef<HTMLDivElement | null>(null);
  const quickAccessIds = useQuickAccess();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (itemPickerRef.current && !itemPickerRef.current.contains(e.target as Node)) {
        setItemPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);


  // Restore patient-panel state
  useEffect(() => {
    try {
      const v = localStorage.getItem(PATIENT_PANEL_KEY);
      if (v === "1") setPatientCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  const togglePatientPanel = () => {
    setPatientCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(PATIENT_PANEL_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [m, p, inv] = await Promise.all([listMedicines(), listPatients(), listSalesInvoices(20)]);
      setMedicines(m);
      setPatients(p);
      setSavedInvoices(inv);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Derived totals
  const lineTotal = (r: Row) => Math.max(0, r.qty * r.price);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + lineTotal(r), 0), [rows]);
  const total = Math.max(0, subtotal + invoiceAddOn - invoiceDiscount);
  const costTotal = useMemo(() => rows.reduce((s, r) => s + r.qty * (r.cost || 0), 0), [rows]);
  const netProfit = subtotal + invoiceAddOn - invoiceDiscount - costTotal;


  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.lineId === id ? { ...r, ...patch } : r)));
  const removeRow = (id: number) => {
    setRows((rs) => rs.filter((r) => r.lineId !== id));
    setSelectedLineId((s) => (s === id ? null : s));
  };

  // Numpad handlers
  const padPress = (ch: string) => {
    if (ch === "C") return setPadBuffer("");
    if (ch === "000") return setPadBuffer((b) => (b + "000").slice(0, 12));
    if (ch === "." && padBuffer.includes(".")) return;
    setPadBuffer((b) => (b + ch).slice(0, 12));
  };
  const bufferValue = () => {
    const v = Number(padBuffer);
    return isFinite(v) ? v : 0;
  };
  const applyPrice = () => {
    if (selectedLineId == null || padBuffer === "") return;
    updateRow(selectedLineId, { price: Math.max(0, bufferValue()) });
    setPadBuffer("");
  };
  const applyQty = () => {
    if (selectedLineId == null || padBuffer === "") return;
    updateRow(selectedLineId, { qty: Math.max(1, Math.floor(bufferValue())) });
    setPadBuffer("");
  };
  const applyUnitToggle = () => {
    // Placeholder: cycles unit — currently just clears buffer (schema tracks one unit per row).
    setPadBuffer("");
  };
  const applyMinus = () => {
    if (padBuffer === "") return;
    setInvoiceDiscount((d) => Math.max(0, d + bufferValue()));
    setPadBuffer("");
  };
  const applyPlus = () => {
    if (padBuffer === "") return;
    setInvoiceAddOn((a) => Math.max(0, a + bufferValue()));
    setPadBuffer("");
  };



  const addMedicineRow = (id: string) => {
    const m = medicines.find((x) => x.id === id);
    if (!m) return;
    const lineId = Date.now() + Math.random();
    // Default sale unit is the LARGE unit (box / bottle). Fall back to selling_price when large_unit_price is unset.
    const largePrice = Number(m.large_unit_price) > 0 ? Number(m.large_unit_price) : Number(m.selling_price);
    const largeCost = Number(m.large_unit_cost) > 0 ? Number(m.large_unit_cost) : Number(m.purchase_price) || 0;
    setRows((rs) => [
      ...rs,
      {
        lineId,
        medicineId: m.id,
        name: [m.trade_name, (m as any).strength, (m as any).dosage_form, (m as any).company].filter(Boolean).join(" "),
        qty: 1,
        price: largePrice,
        cost: largeCost,
        unit: "box",
        freq: Math.max(1, Number((m as any).daily_frequency ?? 1) || 1),
        mealTiming: String((m as any).meal_timing ?? "any"),
      },
    ]);
    setSelectedLineId(lineId);

  };

  /** Insert a chronic medication by its saved name — matches by trade/scientific name. */
  const insertChronicMed = (name: string) => {
    const needle = name.trim().toLowerCase();
    if (!needle) return;
    const m =
      medicines.find((x) => x.trade_name.toLowerCase() === needle) ??
      medicines.find(
        (x) =>
          x.trade_name.toLowerCase().includes(needle) ||
          (x.scientific_name ?? "").toLowerCase().includes(needle),
      );
    if (m) addMedicineRow(m.id);
    else alert(`لم يتم العثور على المادة "${name}" في المخزون.`);
  };



  const submitBarcode = () => {
    const q = barcodeInput.trim();
    if (!q) return;
    const found = medicines.find((m) => (m.barcode ?? "") === q);
    if (found) {
      addMedicineRow(found.id);
      setBarcodeInput("");
      scanRef.current?.focus();
    }
  };

  const filteredPatients = useMemo(() => {
    const q = patientQuery.trim();
    if (!q) return patients.slice(0, 10);
    return patients.filter(
      (p) => p.full_name.includes(q) || (p.phone ?? "").includes(q),
    );
  }, [patients, patientQuery]);

  const clearWorking = () => {
    setTabs((ts) => ts.map((t, i) => (i === active ? emptyTab() : t)));
  };


  const doSave = async (status: "saved" | "suspended") => {
    if (rows.length === 0) {
      alert("لا توجد أصناف في الفاتورة");
      return;
    }
    setErr(null);
    try {
      await saveSaleInvoice({
        patient_id: patient?.id ?? null,
        status,
        payment_type: paymentType,
        discount: invoiceDiscount,
        addon: invoiceAddOn,
        paid_amount: paymentType === "partial" ? paidAmount : undefined,
        items: rows.map((r) => ({ medicine_id: r.medicineId, qty: r.qty, unit_price: r.price })),
      });

      // Sync diagnosis + prescribed meds to patient's clinical timeline.
      if (status === "saved" && patient && diagnosis.trim()) {
        const rec = getClinical(patient.id);
        const today = new Date().toISOString().slice(0, 10);
        setClinical(patient.id, {
          ...rec,
          visits: [
            {
              id: crypto.randomUUID(),
              doctor: lang === "ar" ? "زيارة الصيدلية" : "Pharmacy Visit",
              date: today,
              diagnosis: diagnosis.trim(),
              // Dosage baseline carried to the e-prescription module.
              prescribed: rows.map(
                (r) =>
                  `${r.name} — ${r.freq}×/يوم · ${MEAL_LABEL[r.mealTiming]?.ar ?? MEAL_LABEL.any.ar}`,
              ),
            },
            ...rec.visits,
          ],
        });
      }
      // Register chronic refill schedules for any item that has "حبة و أيام" configured.
      if (status === "saved" && patient) {
        for (const r of rows) {
          const days = medicineDaysPerCycle(medicines.find((m) => m.id === r.medicineId));
          if (days > 0) {
            addChronicSchedule({
              id: crypto.randomUUID(),
              patientId: patient.id,
              patientName: patient.full_name,
              patientPhone: patient.phone,
              medicineId: r.medicineId,
              medicineName: r.name,
              purchasedAt: new Date().toISOString(),
              daysPerCycle: days,
            });
          }
        }
      }
      clearWorking();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // Suspending = jump to next empty tab (current cart stays parked in this tab).
  const suspendLocal = () => {
    if (rows.length === 0) return;
    const next = ([0, 1, 2] as const).find((i) => i !== active && tabs[i].rows.length === 0);
    if (next != null) setActive(next);
  };


  const newInvoice = () => {
    if (rows.length > 0 && !confirm("بدء فاتورة جديدة سيمحو الفاتورة الحالية غير المحفوظة. المتابعة؟")) return;
    clearWorking();
  };

  const addNewPatient = async () => {
    const name = prompt("اسم المريض الجديد:");
    if (!name) return;
    const phone = prompt("رقم الهاتف (اختياري):") ?? "";
    try {
      const created = await createPatient({ full_name: name, phone: phone || null });
      const list = await listPatients();
      setPatients(list);
      setPatient(created);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const selectedMedicine = useMemo(() => {
    const row = rows.find((r) => r.lineId === selectedLineId) ?? rows[rows.length - 1];
    return row ? medicines.find((m) => m.id === row.medicineId) : undefined;
  }, [rows, selectedLineId, medicines]);

  return (
    <AppShell
      title={t("page.sales")}
      medicine={selectedMedicine}
      sidebarFooter={
        <div dir="rtl" className="space-y-3">
          <AiRecommendations
            medicine={selectedMedicine}
            patient={patient}
            rows={rows}
            medicines={medicines}
            lang={lang}
          />

          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 text-center">
            {lang === "ar" ? "إرسال الفاتورة الحالية" : "Send Current Invoice"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                const msg = buildInvoiceMessage({ patient, rows, subtotal, discount: invoiceDiscount, total, lang });
                const phone = (patient?.phone ?? "").replace(/[^\d]/g, "");
                const url = phone
                  ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
                  : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-[#25D366]/15 border border-[#25D366]/40 text-[#25D366] hover:bg-[#25D366]/25 active:scale-95 transition"
              aria-label="WhatsApp"
              title={lang === "ar" ? "واتساب الفاتورة" : "WhatsApp Invoice"}
            >
              <span className="text-xl leading-none">🟢</span>
              <span className="text-[10px] font-bold">WhatsApp</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const msg = buildInvoiceMessage({ patient, rows, subtotal, discount: invoiceDiscount, total, lang });
                const url = `https://t.me/share/url?url=${encodeURIComponent("Breef Pharmacy")}&text=${encodeURIComponent(msg)}`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-[#0088cc]/15 border border-[#0088cc]/40 text-[#4db8ff] hover:bg-[#0088cc]/25 active:scale-95 transition"
              aria-label="Telegram"
              title={lang === "ar" ? "تليجرام الفاتورة" : "Telegram Invoice"}
            >
              <span className="text-xl leading-none">🔵</span>
              <span className="text-[10px] font-bold">Telegram</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const msg = buildInvoiceSms({ patient, subtotal, discount: invoiceDiscount, total, lang });
                const phone = (patient?.phone ?? "").replace(/[^\d+]/g, "");
                window.location.href = `sms:${phone}?&body=${encodeURIComponent(msg)}`;
              }}
              className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-emerald/15 border border-emerald/40 text-emerald hover:bg-emerald/25 active:scale-95 transition"
              aria-label="SMS"
              title={lang === "ar" ? "رسالة نصية SMS" : "SMS"}
            >
              <span className="text-xl leading-none">✉️</span>
              <span className="text-[10px] font-bold">SMS</span>
            </button>
          </div>
        </div>
      }
    >

      <div className="flex-1 flex overflow-hidden">
        {/* Patient / keypad aside — compressed */}
        <aside className="border-l border-border flex flex-col shrink-0 bg-slate-950/40 w-72">

              <div className="p-3 border-b border-border space-y-3">
                <div className="relative">
                  <input
                    value={patientQuery}
                    onFocus={() => setPatientOpen(true)}
                    onChange={(e) => {
                      setPatientQuery(e.target.value);
                      setPatientOpen(true);
                    }}
                    onBlur={() => setTimeout(() => setPatientOpen(false), 150)}
                    placeholder={t("pos.searchPatient")}
                    className="w-full bg-slate-800 border border-border rounded-lg pr-3 pl-9 py-2 text-xs focus:ring-2 focus:ring-emerald/40 outline-none"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addNewPatient(); }}
                    className="absolute top-1/2 -translate-y-1/2 left-1.5 size-6 grid place-items-center rounded-md bg-emerald text-primary-foreground hover:brightness-110 active:scale-95 transition font-bold text-sm"
                    aria-label={t("pos.newPatient")}
                    title={t("pos.newPatient")}
                  >
                    +
                  </button>
                  {patientOpen && filteredPatients.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 top-full mt-1 max-h-56 overflow-auto bg-card border border-border rounded-lg shadow-lg">
                      {filteredPatients.map((p) => (
                        <button
                          key={p.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPatient(p);
                            setPatientQuery("");
                            setPatientOpen(false);
                          }}
                          className={`w-full ${lang === "ar" ? "text-right" : "text-left"} px-3 py-2 hover:bg-emerald/10 text-xs`}
                        >
                          <p className="font-bold">{p.full_name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{p.phone ?? ""}</p>
                          {(p.interests?.length ?? 0) > 0 && (
                            <div className={`flex flex-wrap gap-1 mt-1 ${lang === "ar" ? "justify-end" : "justify-start"}`}>
                              {p.interests.map((v, i) => (
                                <span key={i} className="px-1.5 py-0.5 rounded bg-emerald/10 border border-emerald/30 text-emerald text-[9px] font-bold">
                                  ★ {v}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {patient ? (
                  <div className="p-3 bg-slate-800/60 rounded-lg border border-border space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="size-8 shrink-0 rounded-lg bg-slate-800 border border-border grid place-items-center font-bold text-emerald text-sm">
                        {patient.full_name.charAt(0)}
                      </div>
                      <div className={`flex-1 min-w-0 ${lang === "ar" ? "text-right" : "text-left"}`}>
                        <p className="font-bold text-sm truncate">{patient.full_name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{patient.phone ?? ""}</p>
                      </div>
                      <button
                        onClick={() => setPatient(null)}
                        className="size-8 shrink-0 grid place-items-center rounded-lg bg-slate-800 border border-border text-muted-foreground hover:bg-destructive/15 hover:text-destructive hover:border-destructive/40 transition text-sm"
                        aria-label="remove patient"
                      >
                        ✕
                      </button>
                    </div>
                    {(patient.chronic_diseases?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {patient.chronic_diseases.map((d, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-md bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold">
                            🩺 {d}
                          </span>
                        ))}
                      </div>
                    )}
                    {(patient.chronic_meds?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-emerald mb-1">
                          {lang === "ar" ? "العلاجات المزمنة" : "Chronic Meds"}
                        </p>
                        <div className="space-y-1">
                          {patient.chronic_meds.map((m, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-900/60 border border-emerald/20">
                              <span className="flex-1 text-[11px] font-bold text-foreground truncate" title={m}>💊 {m}</span>
                              <button
                                type="button"
                                onClick={() => insertChronicMed(m)}
                                className="shrink-0 px-2 py-0.5 rounded bg-emerald text-primary-foreground text-[10px] font-bold hover:brightness-110 active:scale-95"
                                title={lang === "ar" ? "إدراج في الفاتورة" : "Insert into invoice"}
                              >
                                {lang === "ar" ? "إدراج" : "Insert"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(patient.interests?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                          {lang === "ar" ? "اهتمامات المريض" : "Interests"}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {patient.interests.map((v, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md bg-emerald/10 border border-emerald/30 text-emerald text-[10px] font-bold">
                              ★ {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground text-center p-2">
                    لم يتم اختيار مريض — الفاتورة بدون ربط بمريض.
                  </p>
                )}
              </div>


              {/* Touch numpad — 5 rows */}

              <div className="px-3 py-2 border-b border-border space-y-1.5 bg-slate-950/40">
                {/* Amount display flanked by Additional Product + Shortcuts */}
                <div className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const name = prompt(lang === "ar" ? "اسم المنتج الإضافي:" : "Additional product name:");
                      if (!name) return;
                      const priceStr = prompt(lang === "ar" ? "السعر:" : "Price:", padBuffer || "0");
                      const price = Math.max(0, Number(priceStr) || 0);
                      const lineId = Date.now() + Math.random();
                      setRows((rs) => [...rs, { lineId, medicineId: "", name, qty: 1, price, cost: 0, unit: "box", freq: 1, mealTiming: "any" }]);
                      setSelectedLineId(lineId);
                      setPadBuffer("");
                    }}
                    className="px-2 rounded-md bg-slate-800 border border-emerald/40 text-emerald text-[10px] font-bold hover:bg-emerald/15 flex flex-col items-center justify-center leading-none"
                    title={lang === "ar" ? "منتج إضافي" : "Additional product"}
                  >
                    <span className="text-base">➕</span>
                    <span className="mt-0.5">{lang === "ar" ? "منتج" : "Add"}</span>
                  </button>
                  <div className="flex-1 bg-slate-900 border border-emerald/30 rounded-md px-2.5 py-1 flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
                      {selectedLineId != null
                        ? (lang === "ar" ? "الصف المحدد" : "Selected row")
                        : (lang === "ar" ? "المبلغ" : "Amount")}
                    </span>
                    <span className="font-mono text-sm font-bold text-emerald">{padBuffer || "0"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      alert(lang === "ar"
                        ? "الاختصارات:\n• F2 بحث المريض\n• Enter مسح باركود\n• +/− خصم و مصاريف\n• انقر السعر لتعديله"
                        : "Shortcuts:\n• F2 patient search\n• Enter barcode scan\n• +/− discount & addon\n• Click price to edit");
                    }}
                    className="px-2 rounded-md bg-slate-800 border border-accent/40 text-accent text-[10px] font-bold hover:bg-accent/15 flex flex-col items-center justify-center leading-none"
                    title={lang === "ar" ? "الاختصارات" : "Shortcuts"}
                  >
                    <span className="text-base">⌨</span>
                    <span className="mt-0.5">{lang === "ar" ? "اختصار" : "Keys"}</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1">
                  {[
                    ["1","2","3"],
                    ["4","5","6"],
                    ["7","8","9"],
                    ["0",".","C"],
                    ["-","000","+"],
                  ].flat().map((ch, i) => {
                    const isClear = ch === "C";
                    const isSign = ch === "-" || ch === "+";
                    const onClick = () => {
                      if (ch === "-") return applyMinus();
                      if (ch === "+") return applyPlus();
                      padPress(ch);
                    };
                    return (
                      <button
                        key={i}
                        onClick={onClick}
                        className={`py-1.5 rounded-md font-mono font-bold text-xs border border-border bg-slate-800 hover:bg-emerald/10 active:scale-95 transition ${
                          isClear ? "text-destructive" : isSign ? "text-emerald" : "text-foreground"
                        }`}
                      >
                        {ch}
                      </button>
                    );
                  })}
                </div>

                {/* Action row — directly beneath numpad */}
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={applyPrice}
                    className="py-1.5 rounded-md text-[10px] font-bold bg-slate-800 border border-emerald/40 text-emerald hover:bg-emerald/10 active:scale-95 transition"
                  >
                    {lang === "ar" ? "تغيير السعر" : "Change price"}
                  </button>
                  <button
                    onClick={applyQty}
                    className="py-1.5 rounded-md text-[10px] font-bold bg-slate-800 border border-emerald/40 text-emerald hover:bg-emerald/10 active:scale-95 transition"
                  >
                    {lang === "ar" ? "تغيير العدد" : "Change qty"}
                  </button>
                  <button
                    onClick={applyUnitToggle}
                    className="py-1.5 rounded-md text-[10px] font-bold bg-slate-800 border border-emerald/40 text-emerald hover:bg-emerald/10 active:scale-95 transition"
                  >
                    {lang === "ar" ? "تغيير الوحدة" : "Change unit"}
                  </button>
                </div>
              </div>

              {/* Live item preview — front image of the actively selected line item */}
              <div className="px-3 py-2 border-b border-border bg-slate-950/40" dir="rtl">
                <p className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">
                  {lang === "ar" ? "معاينة المادة المحددة" : "Selected item preview"}
                </p>
                <SelectedItemThumb medicineId={selectedMedicine?.id ?? null} name={selectedMedicine?.trade_name ?? ""} />
              </div>



              {/* Financial summary rows */}
              <div className="px-4 py-3 border-b border-border space-y-1.5 bg-slate-950/30">
                <SummaryRow
                  label={lang === "ar" ? "مبلغ الخصم" : "Discount"}
                  value={invoiceDiscount}
                  onChange={setInvoiceDiscount}
                  tone="warn"
                />
                <SummaryRow
                  label={lang === "ar" ? "المسدد" : "Paid"}
                  value={paidAmount}
                  onChange={setPaidAmount}
                  tone="ok"
                />
              </div>


        </aside>


        {/* Main workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Suspended-invoice tab bar — only visible when any tab has content */}
          {err && (

            <p className="mx-4 mt-3 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2">
              {err}
            </p>
          )}

          {/* Toolbar */}
          <div className="px-4 py-2 border-b border-border bg-slate-950/40 flex gap-2 items-center shrink-0">
            <div className="flex-1 relative">
              <span className="absolute top-1/2 -translate-y-1/2 right-2.5 text-emerald text-sm">⊞</span>
              <input
                ref={scanRef}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitBarcode()}
                placeholder={t("pos.scan")}
                className="w-full bg-card border border-emerald/30 rounded-lg pr-8 pl-2.5 py-1.5 text-xs font-mono focus:ring-2 focus:ring-emerald/40 focus:border-emerald outline-none"
              />
            </div>
            <FuzzyItemPicker
              medicines={medicines}
              query={itemQuery}
              setQuery={setItemQuery}
              open={itemPickerOpen}
              setOpen={setItemPickerOpen}
              containerRef={itemPickerRef}
              onPick={(id) => { addMedicineRow(id); setItemQuery(""); setItemPickerOpen(false); }}
              placeholder={medicines.length === 0 ? "لا توجد مواد" : t("pos.pickItem")}
              lang={lang}
            />
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              title={lang === "ar" ? "الوصول السريع" : "Quick access"}
              className="px-2.5 py-1.5 bg-yellow-soft border border-emerald/40 rounded-lg text-xs font-bold hover:bg-yellow-softer active:scale-95 transition"
              aria-label="quick-access"
            >
              ⚡
            </button>
            <button
              onClick={submitBarcode}
              className="px-4 py-1.5 bg-emerald text-primary-foreground rounded-lg text-[11px] font-bold hover:brightness-110"
            >
              {t("pos.add")}
            </button>

            {/* Prev / Next historical invoice navigation */}
            <div className="flex items-stretch bg-slate-800 border border-emerald/30 rounded-lg overflow-hidden" title={lang === "ar" ? "تصفح الفواتير المحفوظة" : "Browse saved invoices"}>
              <button
                type="button"
                onClick={() => cycleBrowse(1)}
                disabled={savedInvoices.length === 0}
                className="px-2.5 text-emerald hover:bg-emerald/10 disabled:opacity-30 text-lg font-bold"
                aria-label={lang === "ar" ? "فاتورة سابقة" : "Previous invoice"}
                title={lang === "ar" ? "فاتورة سابقة" : "Previous invoice"}
              >
                ‹
              </button>
              <div className="px-2 py-1 text-center min-w-[70px] border-x border-emerald/20">
                <p className="text-[9px] text-muted-foreground uppercase tracking-widest leading-none">
                  {lang === "ar" ? "فاتورة" : "Invoice"}
                </p>
                <p className="text-[11px] font-mono font-bold text-emerald mt-0.5 leading-none">
                  {browsedInvoice ? `#${browsedInvoice.invoice_no}` : "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => cycleBrowse(-1)}
                disabled={savedInvoices.length === 0}
                className="px-2.5 text-emerald hover:bg-emerald/10 disabled:opacity-30 text-lg font-bold"
                aria-label={lang === "ar" ? "فاتورة تالية" : "Next invoice"}
                title={lang === "ar" ? "فاتورة تالية" : "Next invoice"}
              >
                ›
              </button>
            </div>
          </div>

          {quickOpen && (
            <div className="px-4 py-3 border-b border-border bg-yellow-soft/40 shrink-0" dir="rtl">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold text-emerald">
                  ⚡ {lang === "ar" ? "الوصول السريع" : "Quick Access"}
                </p>
                <button onClick={() => setQuickOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
              </div>
              {quickAccessIds.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {lang === "ar"
                    ? "لم تُعرَّف مواد سريعة بعد — أضِفها من الإعدادات → مواد الوصول السريع."
                    : "No quick items configured yet — add them in Settings → Quick Access Items."}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {quickAccessIds
                    .map((id) => medicines.find((m) => m.id === id))
                    .filter((m): m is Medicine => !!m)
                    .map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => addMedicineRow(m.id)}
                        className="px-3 py-2 rounded-lg bg-card border border-emerald/40 text-xs font-bold hover:bg-yellow-soft active:scale-95 transition"
                        title={medicineDisplay(m)}
                      >
                        {m.trade_name} <span className="text-[10px] text-muted-foreground">#{m.quantity_in_stock ?? 0}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}



          {/* Diagnosis + suspended-invoice tabs — merged compact bar */}
          <div className="px-4 py-1.5 border-b border-border bg-slate-950/30 flex items-center gap-2 shrink-0" dir={lang === "ar" ? "rtl" : "ltr"}>
            <label className="text-[10px] font-bold uppercase tracking-widest text-emerald shrink-0">
              🩹 {lang === "ar" ? "تشخيص" : "Diagnosis"}
            </label>
            <input
              type="text"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              list="diagnosis-suggestions"
              placeholder={lang === "ar" ? "تشخيص سريع..." : "Quick diagnosis..."}
              className={`w-1/2 bg-slate-900 border border-emerald/30 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-emerald/40 focus:border-emerald outline-none ${lang === "ar" ? "text-right" : "text-left"}`}
            />
            {/* Suspended-invoice tabs (relocated here) */}
            <div className="flex items-stretch gap-1 mr-auto">
              {([0, 1, 2] as const)
                .filter((i) => i === active || tabs[i].rows.length > 0)
                .map((i) => {
                  const isActive = active === i;
                  const tab = tabs[i];
                  const hasCart = tab.rows.length > 0;
                  const label = (lang === "ar" ? TAB_LABELS_AR : TAB_LABELS_EN)[i];
                  const cls = isActive
                    ? "bg-slate-900 text-emerald border-emerald"
                    : hasCart
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/40 hover:bg-amber-500/20"
                      : "bg-slate-800/60 text-muted-foreground border-border hover:text-foreground";
                  return (
                    <button
                      key={i}
                      onClick={() => setActive(i)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition ${cls}`}
                    >
                      <span className="text-[9px] font-mono opacity-70">#{i + 1}</span>
                      <span>{label}</span>
                      <span className={`text-[9px] font-mono px-1 rounded ${isActive ? "bg-emerald/20" : hasCart ? "bg-amber-500/20" : "bg-slate-700/40"}`}>
                        {tab.rows.length}
                      </span>
                    </button>
                  );
                })}
            </div>
            {browsedInvoice && (
              <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 rounded bg-slate-800 border border-border">
                {lang === "ar" ? "معروضة:" : "Viewing:"} #{browsedInvoice.invoice_no} · {browsedInvoice.total.toLocaleString()} {lang === "ar" ? "د.ع" : "IQD"}
              </span>
            )}
          </div>



          <section className="flex-1 overflow-y-auto overflow-x-auto">
            <table className={`w-full min-w-[700px] table-fixed ${lang === "ar" ? "text-right" : "text-left"} border-collapse`}>
              <thead className="sticky top-0 bg-slate-950/80 backdrop-blur-md z-10">
                <tr className="border-b border-border">
                  <Th className="w-[26px]">#</Th>
                  <Th className="w-auto min-w-[130px]">{t("pos.col.name")}</Th>
                  <Th className="w-[62px] min-w-[62px]">{lang === "ar" ? "الوحدة" : "Unit"}</Th>
                  <Th className="w-[80px] min-w-[80px]">{t("pos.col.qty")}</Th>
                  <Th className="w-[70px] min-w-[70px]">{t("pos.col.price")}</Th>
                  <Th className="w-[78px] min-w-[78px]">{t("pos.col.total")}</Th>
                  <Th className="w-[104px] min-w-[104px]">{lang === "ar" ? "المرات" : "Freq"}</Th>
                  <Th className="w-[136px] min-w-[136px]" />


                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r, i) => {
                  const tint = r.medicineId ? colors.get(r.medicineId) : undefined;
                  return (
                  <tr
                    key={r.lineId}
                    onClick={() => setSelectedLineId(r.lineId)}
                    className={`cursor-pointer transition ${
                      selectedLineId === r.lineId
                        ? "bg-emerald/10 outline outline-1 outline-emerald/40"
                        : "hover:bg-emerald/5"
                    }`}
                  >
                    <td className="px-1 py-2 font-mono text-[10px] text-muted-foreground align-middle">
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="px-2 py-2 font-medium align-middle">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded-md text-[11px] leading-snug break-words"
                        style={tint ? { backgroundColor: tintFromHex(tint, 0.35), boxShadow: `inset 0 0 0 1px ${tint}` } : undefined}
                      >
                        {r.name}
                      </span>
                      <div className="text-[9px] text-muted-foreground font-mono mt-0.5">
                        {lang === "ar" ? "كلفة" : "Cost"}: {r.cost.toLocaleString()} {lang === "ar" ? "د.ع" : "IQD"}
                      </div>
                    </td>
                    <td className="px-1.5 py-2 align-middle">

                      {(() => {
                        const m = medicines.find((x) => x.id === r.medicineId);
                        const stripsPerBox = Math.max(1, Number(m?.units_per_large ?? 1) || 1);
                        const multiUnit = stripsPerBox > 1 && !!m?.small_unit_name;
                        if (!multiUnit) {
                          return (
                            <span className="block text-center text-[11px] font-bold text-muted-foreground">
                              {r.unit === "strip" ? (lang === "ar" ? "شريط" : "Strip") : (lang === "ar" ? "باكيت" : "Box")}
                            </span>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextUnit: RowUnit = r.unit === "strip" ? "box" : "strip";
                              const factor = nextUnit === "box" ? stripsPerBox : 1 / stripsPerBox;
                              updateRow(r.lineId, {
                                unit: nextUnit,
                                price: Math.max(0, Math.round(r.price * factor)),
                              });
                            }}
                            className="w-full flex items-center justify-center gap-1 px-1.5 py-1 rounded-md bg-slate-800 border border-emerald/30 text-emerald text-[11px] font-bold hover:bg-emerald/10 transition"
                            title={lang === "ar" ? "تبديل الوحدة" : "Toggle unit"}
                          >
                            <span>{r.unit === "strip" ? (lang === "ar" ? "شريط" : "Strip") : (lang === "ar" ? "باكيت" : "Box")}</span>
                            <span aria-hidden>⇄</span>
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-1.5 py-2 align-middle">
                      <div className="flex items-center justify-center gap-1" dir="ltr">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateRow(r.lineId, { qty: Math.max(1, r.qty - 1) });
                          }}
                          className="size-5 shrink-0 grid place-items-center rounded bg-slate-800 border border-emerald/30 text-emerald hover:bg-emerald/15 active:scale-95 transition"
                          aria-label="decrement"
                          title={lang === "ar" ? "إنقاص" : "Decrement"}
                        >
                          <ChevronLeft className="size-3" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={r.qty}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateRow(r.lineId, { qty: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-8 shrink-0 bg-slate-800 border border-border rounded px-0 py-0.5 text-center font-mono text-[11px] outline-none focus:ring-1 focus:ring-emerald/40"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateRow(r.lineId, { qty: r.qty + 1 });
                          }}
                          className="size-5 shrink-0 grid place-items-center rounded bg-slate-800 border border-emerald/30 text-emerald hover:bg-emerald/15 active:scale-95 transition"
                          aria-label="increment"
                          title={lang === "ar" ? "زيادة" : "Increment"}
                        >
                          <ChevronRight className="size-3" />
                        </button>
                      </div>
                    </td>

                    <td className="px-1.5 py-2 align-middle">
                      <button
                        type="button"
                        onClick={() => {
                          const input = window.prompt(
                            lang === "ar" ? `سعر جديد لـ ${r.name} (بالدينار):` : `New price for ${r.name} (IQD):`,
                            String(r.price),
                          );
                          if (input == null) return;
                          const n = Number(input.replace(/[^\d.]/g, ""));
                          if (!Number.isFinite(n) || n < 0) return;
                          updateRow(r.lineId, { price: Math.round(n) });
                        }}
                        className="w-full bg-slate-800 border border-border rounded px-1.5 py-1 text-center font-mono text-[11px] whitespace-nowrap hover:bg-emerald/15 hover:border-emerald/40 hover:text-emerald"
                        title={lang === "ar" ? "انقر لتعديل السعر" : "Click to edit price"}
                      >
                        {r.price.toLocaleString()}
                      </button>
                    </td>
                    <td className="px-2 py-2 font-mono font-bold text-emerald text-[11px] tabular-nums whitespace-nowrap align-middle">
                      {lineTotal(r).toLocaleString()}
                    </td>
                    {/* Frequency — count + period selector, compact */}
                    <td className="px-1.5 py-1.5 align-middle">
                      <div className="flex flex-col items-center gap-0.5 leading-none">
                        <div className="flex items-center gap-0.5" dir="ltr">
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={r.freq}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              updateRow(r.lineId, { freq: Math.max(0, Math.min(24, Number(e.target.value) || 0)) })
                            }
                            className="w-7 bg-slate-800 border border-emerald/30 rounded px-0 py-0.5 text-center font-mono text-[11px] outline-none focus:ring-1 focus:ring-emerald/40"
                            title={lang === "ar" ? "عدد المرات" : "Doses"}
                          />
                          <div className="flex rounded overflow-hidden border border-border">
                            {(["day", "week", "month"] as const).map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateRow(r.lineId, { freqUnit: u });
                                }}
                                className={`px-1 py-0.5 text-[9px] font-bold ${
                                  (r.freqUnit ?? "day") === u
                                    ? "bg-emerald/25 text-emerald"
                                    : "bg-slate-800 text-muted-foreground hover:text-foreground"
                                }`}
                                title={u}
                              >
                                {lang === "ar"
                                  ? u === "day" ? "يوم" : u === "week" ? "أسبوع" : "شهر"
                                  : u === "day" ? "D" : u === "week" ? "W" : "M"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <span className="px-1 py-[1px] rounded bg-sky-500/10 border border-sky-500/30 text-sky-300 text-[9px] font-bold whitespace-nowrap">
                          {MEAL_LABEL[r.mealTiming]?.[lang === "ar" ? "ar" : "en"] ?? MEAL_LABEL.any[lang === "ar" ? "ar" : "en"]}
                        </span>
                      </div>
                    </td>

                    <td className="px-2 py-2 align-middle">
                      <div className="flex items-center gap-1.5 justify-end flex-nowrap">


                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const m = medicines.find((x) => x.id === r.medicineId);
                            addToCart({
                              medicineId: r.medicineId,
                              barcode: m?.barcode ?? null,
                              name: r.name,
                              currentStock: Number(m?.quantity_in_stock ?? 0) || 0,
                              minimum: Number(m?.minimum_stock ?? 0) || 0,
                              maximum: Number(m?.maximum_stock ?? 0) || 0,
                              suggestedQty: r.qty,
                              addedAt: new Date().toISOString(),
                              status: "order",
                            });
                            toast.success(lang === "ar" ? "أُضيفت إلى سلة الطلبات" : "Added to Orders Basket");
                          }}
                          className="size-7 shrink-0 grid place-items-center rounded-md bg-emerald/15 border border-emerald/40 text-emerald hover:bg-emerald/25 transition"
                          title={lang === "ar" ? "إخراج للسلة" : "Add to basket"}
                          aria-label="Add to basket"
                        >
                          <ShoppingBasket className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.medicineId) navigate({ to: "/products", search: { focus: r.medicineId } as never });
                            else navigate({ to: "/products" });
                          }}
                          className="size-7 shrink-0 grid place-items-center rounded-md bg-slate-800 border border-sky-500/30 text-sky-300 hover:bg-sky-500/15"
                          title={lang === "ar" ? "بطاقة المادة" : "Item card"}
                          aria-label="Open item card"
                        >
                          <IdCard className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const m = medicines.find((x) => x.id === r.medicineId);
                            if (m?.barcode) {
                              window.print?.();
                            }
                            toast.message(lang === "ar" ? `الباركود: ${m?.barcode ?? "—"}` : `Barcode: ${m?.barcode ?? "—"}`);
                          }}
                          className="size-7 shrink-0 grid place-items-center rounded-md bg-slate-800 border border-emerald/30 text-emerald hover:bg-emerald/15"
                          title={lang === "ar" ? "الباركود" : "Barcode"}
                          aria-label="Barcode"
                        >
                          <BarcodeIcon className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRow(r.lineId);
                          }}
                          className="size-7 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          aria-label="حذف"
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
                    <td colSpan={8} className="text-center py-16 text-muted-foreground text-sm">
                      {loading ? "جاري التحميل..." : t("pos.emptyRows")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>




          <footer className="p-5 bg-slate-950/60 border-t border-border flex items-center justify-between shrink-0 gap-4 flex-wrap">
            <div className="flex gap-6 items-center flex-wrap">
              <Stat label={t("pos.count")} value={String(rows.length).padStart(2, "0")} />
              <Stat label={lang === "ar" ? "مصاريف الفاتورة" : "Invoice expenses"} value={invoiceAddOn.toLocaleString()} />
              <ActiveFundWidget />
              <div className="space-y-1">
                <p className="text-[10px] text-accent font-bold uppercase tracking-widest">
                  {lang === "ar" ? "ربح الفاتورة" : "Invoice Net Profit"}
                </p>
                <p className={`text-xl font-mono font-bold ${netProfit >= 0 ? "text-emerald" : "text-destructive"}`}>
                  {netProfit.toLocaleString()} <span className="text-[10px] text-muted-foreground">{lang === "ar" ? "د.ع" : "IQD"}</span>
                </p>
              </div>
            </div>
            <div className={lang === "ar" ? "text-left" : "text-right"}>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
                {t("pos.finalTotal")}
              </p>
              <p className="text-4xl font-mono font-bold text-emerald tracking-tighter drop-shadow-[0_0_20px_rgba(52,211,153,0.25)]">
                {total.toLocaleString()} <span className="text-base text-muted-foreground">{t("pos.iqd")}</span>
              </p>
            </div>
          </footer>

          {/* Bottom-center invoice action toolbar */}
          <div className="px-4 py-3 border-t border-border bg-slate-950/80 shrink-0" dir="rtl">
            <div className="flex items-stretch justify-center gap-2 flex-wrap">
              <BarBtn icon="💾" label={lang === "ar" ? "حفظ" : "Save"} onClick={() => doSave("saved")} variant="primary" />
              <BarBtn icon="⏸" label={lang === "ar" ? "تعليق" : "Suspend"} onClick={suspendLocal} variant="accent" />
              <BarBtn icon="↩" label={lang === "ar" ? "ارجاع" : "Return"} onClick={newInvoice} />
              <button
                type="button"
                onClick={() => setPaymentType((p) => (p === "cash" ? "credit" : p === "credit" ? "partial" : "cash"))}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 border border-emerald/40 text-emerald hover:bg-emerald/10 active:scale-95 transition font-bold text-xs"
                aria-label="switch payment type"
              >
                <span className="text-base">➔</span>
                <span>
                  {paymentType === "cash"
                    ? (lang === "ar" ? "نقدي / Cash" : "Cash / نقدي")
                    : paymentType === "credit"
                      ? (lang === "ar" ? "أجل / Credit" : "Credit / أجل")
                      : (lang === "ar" ? "جزئي / Partial" : "Partial / جزئي")}
                </span>
                <span className="text-base">➔</span>
              </button>
              {paymentType === "partial" && (
                <input
                  type="number"
                  min={0}
                  value={paidAmount || ""}
                  onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value) || 0))}
                  placeholder={lang === "ar" ? "المبلغ المدفوع" : "Paid amount"}
                  className="w-36 px-3 py-2.5 rounded-lg bg-slate-800 border border-amber-500/40 text-amber-300 text-xs font-mono text-center"
                />
              )}

              <BarBtn icon="🔍" label={lang === "ar" ? "بحث" : "Search"} onClick={() => scanRef.current?.focus()} />
              <BarBtn icon="🖨" label={lang === "ar" ? "طباعة" : "Print"} onClick={() => window.print()} />
              <BarBtn
                icon="🗑"
                label={lang === "ar" ? "حذف الفاتورة" : "Delete invoice"}
                onClick={() => {
                  if (rows.length === 0) return;
                  if (!confirm(lang === "ar" ? "حذف الفاتورة الحالية نهائياً؟" : "Delete current invoice permanently?")) return;
                  clearWorking();
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </AppShell>

  );
}

function SelectedItemThumb({ medicineId, name }: { medicineId: string | null; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!medicineId) { setSrc(null); return; }
    try {
      const raw = localStorage.getItem(`product-img:${medicineId}`);
      const p = raw ? (JSON.parse(raw) as { front?: string }) : {};
      setSrc(p.front ?? null);
    } catch { setSrc(null); }
  }, [medicineId]);
  return (
    <div className="h-20 rounded-md bg-slate-900 border border-emerald/30 grid place-items-center overflow-hidden">
      {src ? (
        <img src={src} alt={name} className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="text-[10px] text-muted-foreground text-center px-2">
          {medicineId ? "لا توجد صورة" : "اختر مادة"}
        </span>
      )}
    </div>
  );
}

function medicineDisplay(m: Medicine): string {
  return [m.trade_name, (m as any).strength, (m as any).dosage_form, (m as any).company]
    .filter(Boolean)
    .join(" ");
}

function FuzzyItemPicker({
  medicines, query, setQuery, open, setOpen, containerRef, onPick, placeholder, lang,
}: {
  medicines: Medicine[];
  query: string;
  setQuery: (v: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onPick: (id: string) => void;
  placeholder: string;
  lang: string;
}) {
  const results = useMemo(
    () =>
      fuzzyFilter(
        query,
        medicines,
        (m) => [m.trade_name, m.scientific_name || "", (m as any).company || "", m.barcode || ""],
        { limit: 30 },
      ),
    [query, medicines],
  );
  const suggestion = useMemo(
    () =>
      results.length === 0 && query.trim()
        ? nearestSuggestion(query, medicines, (m) => [m.trade_name, m.scientific_name || ""])
        : null,
    [results.length, query, medicines],
  );
  return (
    <div ref={containerRef} className="relative w-[320px]">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) { onPick(results[0].item.id); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full bg-card border border-emerald/30 rounded-lg px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
      />
      {open && (results.length > 0 || suggestion) && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-80 overflow-auto bg-card border border-emerald/40 rounded-lg shadow-xl">
          {suggestion && results.length === 0 && (
            <button
              type="button"
              onClick={() => { onPick(suggestion.item.id); setQuery(""); }}
              className="w-full text-right px-3 py-2 text-xs text-amber-600 hover:bg-yellow-soft border-b border-border"
            >
              {lang === "ar" ? "هل تقصد" : "Did you mean"}: <b>{medicineDisplay(suggestion.item)}</b>؟
            </button>
          )}
          {results.map(({ item: m }) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m.id)}
              className="w-full text-right px-3 py-2 text-xs hover:bg-yellow-soft border-b border-border/50 last:border-0 flex justify-between gap-2"
            >
              <span className="truncate">{medicineDisplay(m)}</span>
              <span className="text-muted-foreground shrink-0">#{m.quantity_in_stock ?? 0}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}



function Queue({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`border rounded-lg bg-card ${accent ? "border-accent/30" : "border-border"}`}>
      <div className={`px-3 py-1.5 border-b ${accent ? "border-accent/20 bg-accent/5" : "border-border bg-emerald/5"}`}>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${accent ? "text-accent" : "text-emerald"}`}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function AiRecommendations({
  medicine,
  patient,
  rows,
  medicines,
  lang,
}: {
  medicine?: Medicine;
  patient: PatientRow | null;
  rows: Array<{ medicineId: string; name: string }>;
  medicines: Medicine[];
  lang: "ar" | "en";
}) {
  const { interactions, substitutes, notes } = useMemo(() => {
    if (!medicine) return { interactions: [] as string[], substitutes: [] as Medicine[], notes: "" };
    const sci = (medicine.scientific_name || "").trim().toLowerCase();
    const firstToken = sci.split(/[\s,\-\/]+/)[0] ?? "";
    const inter: string[] = [];
    // Duplicate active ingredient already in cart
    rows.forEach((r) => {
      if (r.medicineId === medicine.id) return;
      const m = medicines.find((x) => x.id === r.medicineId);
      const other = (m?.scientific_name || "").trim().toLowerCase();
      if (firstToken && other.startsWith(firstToken)) {
        inter.push(
          lang === "ar"
            ? `تكرار المادة الفعّالة مع «${r.name}»`
            : `Duplicate active ingredient with "${r.name}"`,
        );
      }
    });
    // Chronic med conflicts
    (patient?.chronic_meds ?? []).forEach((cm) => {
      const c = cm.trim().toLowerCase();
      if (c && firstToken && (c.includes(firstToken) || firstToken.includes(c))) {
        inter.push(
          lang === "ar"
            ? `تداخل محتمل مع علاج مزمن: ${cm}`
            : `Potential interaction with chronic med: ${cm}`,
        );
      }
    });
    const subs = medicines
      .filter(
        (m) =>
          m.id !== medicine.id &&
          firstToken &&
          (m.scientific_name || "").trim().toLowerCase().startsWith(firstToken),
      )
      .slice(0, 4);
    return { interactions: inter, substitutes: subs, notes: medicine.notes ?? "" };
  }, [medicine, patient, rows, medicines, lang]);

  if (!medicine) return null;

  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const [open, setOpen] = useState(false);
  const badgeCount = interactions.length + substitutes.length + (notes ? 1 : 0);

  return (
    <div className="rounded-lg border border-emerald/30 bg-gradient-to-br from-emerald/5 to-slate-900/40 shadow-[0_0_16px_-10px] shadow-emerald/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5"
        aria-expanded={open}
      >
        <span className="size-1.5 rounded-full bg-emerald animate-pulse shadow-[0_0_5px] shadow-emerald" />
        <h3 className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald flex-1 text-right">
          {L("توصيات الذكاء الاصطناعي", "AI Recommendations")}
        </h3>
        {badgeCount > 0 && (
          <span className="text-[8px] font-mono font-bold text-emerald bg-emerald/10 border border-emerald/30 rounded px-1">
            {badgeCount}
          </span>
        )}
        <span className="text-emerald text-[10px]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-2.5 pb-2 space-y-2 max-h-56 overflow-y-auto">
          <div>
            <p className="text-[8px] font-bold text-accent mb-0.5 uppercase tracking-wider">
              ⚠︎ {L("التداخلات الدوائية", "Drug Interactions")}
            </p>
            {interactions.length ? (
              <ul className="space-y-0.5">
                {interactions.map((it, i) => (
                  <li
                    key={i}
                    className="text-[9px] leading-snug text-foreground/90 bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5"
                  >
                    {it}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[9px] text-muted-foreground">{L("لا توجد تداخلات مرصودة.", "No interactions detected.")}</p>
            )}
          </div>

          <div>
            <p className="text-[8px] font-bold text-emerald mb-0.5 uppercase tracking-wider">
              ⇄ {L("اقتراحات بديلة للدواء", "Smart Substitutes")}
            </p>
            {substitutes.length ? (
              <div className="flex flex-wrap gap-1">
                {substitutes.map((s) => (
                  <span
                    key={s.id}
                    title={s.scientific_name}
                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald/10 border border-emerald/30 text-emerald font-medium truncate max-w-[130px]"
                  >
                    {s.trade_name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[9px] text-muted-foreground">{L("لا توجد بدائل مقترحة.", "No substitutes.")}</p>
            )}
          </div>

          <div>
            <p className="text-[8px] font-bold text-emerald mb-0.5 uppercase tracking-wider">
              ✦ {L("الملاحظات الذكية", "Smart Notes")}
            </p>
            <p className="text-[9px] leading-relaxed text-foreground/85 bg-slate-900/60 border border-border rounded px-1.5 py-1">
              {notes || L("لا توجد ملاحظات محفوظة لهذه المادة.", "No notes recorded for this item.")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wide text-right ${className}`}>
      {children}
    </th>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{label}</p>
      <p className="text-xl font-mono">{value}</p>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onChange,
  readOnly,
  tone,
}: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  tone?: "ok" | "warn";
}) {
  const text = tone === "ok" ? "text-emerald" : tone === "warn" ? "text-accent" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      {readOnly ? (
        <span className={`font-mono text-sm font-bold ${text}`}>{value.toLocaleString()}</span>
      ) : (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange?.(Math.max(0, Number(e.target.value) || 0))}
          className={`w-28 bg-slate-800 border border-border rounded-md px-2 py-1 font-mono text-sm font-bold text-right ${text} outline-none focus:ring-2 focus:ring-emerald/40`}
        />
      )}
    </div>
  );
}

function ToolBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="py-2 rounded-md text-[10px] font-bold bg-slate-800 border border-border text-muted-foreground hover:text-emerald hover:border-emerald/40 hover:bg-emerald/5 transition"
    >
      {label}
    </button>
  );
}

function TouchBtn({
  label,
  icon,
  onClick,
  variant,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  variant?: "primary" | "accent";
}) {
  const base =
    variant === "primary"
      ? "bg-emerald text-primary-foreground border-emerald hover:brightness-110"
      : variant === "accent"
        ? "bg-accent text-accent-foreground border-accent hover:brightness-110"
        : "bg-slate-800 text-foreground border-border hover:border-emerald/40 hover:text-emerald hover:bg-emerald/5";
  return (
    <button
      onClick={onClick}
      className={`py-3 rounded-lg border font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition ${base}`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function BarBtn({
  icon,
  label,
  onClick,
  variant,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: "primary" | "accent";
}) {
  const base =
    variant === "primary"
      ? "bg-emerald text-primary-foreground border-emerald hover:brightness-110"
      : variant === "accent"
        ? "bg-accent text-accent-foreground border-accent hover:brightness-110"
        : "bg-slate-800 text-foreground border-border hover:border-emerald/40 hover:text-emerald hover:bg-emerald/5";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border font-bold text-xs active:scale-95 transition ${base}`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
    </button>
  );
}


type InvoiceMsgArgs = {
  patient: PatientRow | null;
  rows: Row[];
  subtotal: number;
  discount: number;
  total: number;
  lang: "ar" | "en";
};

function buildInvoiceMessage({ patient, rows, subtotal, discount, total, lang }: InvoiceMsgArgs): string {
  const brand = getBranding().name;
  const name = patient?.full_name ?? (lang === "ar" ? "عزيزي العميل" : "Dear Customer");
  const fmt = (n: number) => new Intl.NumberFormat(lang === "ar" ? "ar-IQ" : "en-US").format(Math.round(n));
  const itemsList = rows
    .map((r, i) => `${i + 1}. ${r.name} × ${r.qty} — ${fmt(r.qty * r.price)}`)
    .join("\n");
  if (lang === "ar") {
    return (
      `عزيزي ${name}، شكراً لزيارتك ${brand}.\n\n` +
      `تفاصيل فاتورتك:\n${itemsList || "—"}\n\n` +
      `إجمالي المواد: ${fmt(subtotal)} د.ع\n` +
      `الخصم: ${fmt(discount)} د.ع\n` +
      `الصافي النهائي: ${fmt(total)} د.ع\n\n` +
      `نتمنى لك الشفاء العاجل! 🌿`
    );
  }
  return (
    `Dear ${name}, thank you for visiting ${brand}.\n\n` +
    `Your invoice:\n${itemsList || "—"}\n\n` +
    `Subtotal: ${fmt(subtotal)} IQD\n` +
    `Discount: ${fmt(discount)} IQD\n` +
    `Total: ${fmt(total)} IQD\n\n` +
    `Wishing you a swift recovery! 🌿`
  );
}

function buildInvoiceSms({
  patient,
  subtotal,
  discount,
  total,
  lang,
}: Omit<InvoiceMsgArgs, "rows">): string {
  const brand = getBranding().name;
  const name = patient?.full_name ?? (lang === "ar" ? "عميلنا" : "Customer");
  const fmt = (n: number) => Math.round(n).toString();
  if (lang === "ar") {
    return `${brand}: ${name}، الإجمالي ${fmt(subtotal)} خصم ${fmt(discount)} الصافي ${fmt(total)} د.ع. شكراً لزيارتك.`;
  }
  return `${brand}: ${name}, subtotal ${fmt(subtotal)} disc ${fmt(discount)} total ${fmt(total)} IQD. Thank you.`;
}





function ActiveFundWidget() {
  const [fund, setFund] = useState<{ name: string; balance: number } | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("name, opening_balance")
        .eq("type", "cash")
        .order("created_at", { ascending: true })
        .limit(1);
      const row = (data ?? [])[0] as { name: string; opening_balance: number } | undefined;
      if (row) setFund({ name: row.name, balance: Number(row.opening_balance ?? 0) });
    })();
  }, []);
  if (!fund) return null;
  return (
    <div className="space-y-1 px-3 py-1.5 rounded-lg border border-emerald/30 bg-emerald/5">
      <p className="text-[10px] text-emerald font-bold uppercase tracking-widest">💰 صندوق نشط</p>
      <p className="text-sm font-mono font-bold text-foreground">
        {fund.name}
        <span className="text-emerald ms-2">{fund.balance.toLocaleString()} د.ع</span>
      </p>
    </div>
  );
}
