// واجهة العيادة — Clinic workspace: patient banner, visit history + AI summary,
// examination fields, rich-text report editor with templates, lab orders, and a
// dual-search e-prescription builder.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  AlignRight,
  AlignCenter,
  AlignLeft,
  List,
  Printer,
  Save,
  FileText,
  Sparkles,
  FlaskConical,
  Send,
  Plus,
  Trash2,
  X,
  Pill,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { listMedicines, listPatients, type Medicine, type PatientRow } from "@/lib/db";
import { bmi, bmiCategory } from "@/lib/patients";
import { getClinical, setClinical, useClinical } from "@/lib/clinical";

export const Route = createFileRoute("/clinic")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "واجهة العيادة — Breef Pharmacy" },
      {
        name: "description",
        content:
          "واجهة العيادة: سجل الزيارات، ملخص الحالة بالذكاء الاصطناعي، التقارير الطبية، التحاليل، والراجيتة الدوائية.",
      },
      { property: "og:title", content: "واجهة العيادة — Breef Pharmacy" },
      {
        property: "og:description",
        content: "إدارة زيارات المرضى، التقارير الطبية، التحاليل والوصفات الإلكترونية.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClinicPage,
});

const CLINIC_BLUE = "#4A6B82";

type TemplateRow = { id: string; kind: string; name: string; content: string };

const LAB_TESTS = [
  "CBC — تعداد الدم الكامل",
  "FBS — سكر صائم",
  "HbA1c — السكر التراكمي",
  "Lipid Profile — دهون الدم",
  "Creatinine — الكرياتينين",
  "Urea — اليوريا",
  "LFT — وظائف الكبد",
  "TSH — الغدة الدرقية",
  "Vitamin D — فيتامين د",
  "Serum Iron — الحديد",
  "CRP — بروتين سي التفاعلي",
  "GUE — إدرار عام",
  "Uric Acid — حامض اليوريك",
  "ESR — سرعة الترسيب",
  "Electrolytes — الشوارد",
];

const FREQS = ["مرة يومياً", "مرتين يومياً", "3 مرات يومياً", "4 مرات يومياً", "عند اللزوم", "أسبوعياً", "شهرياً"];

type RxLine = {
  id: string;
  scientific: string;
  trade: string;
  dose: string;
  freq: string;
  duration: string;
};

function ClinicPage() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pq, setPq] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    listPatients().then(setPatients).catch(() => void 0);
    listMedicines().then(setMeds).catch(() => void 0);
  }, []);

  const patient = patients.find((p) => p.id === activeId) ?? null;
  const clinical = useClinical(activeId);

  const filteredPatients = useMemo(() => {
    const s = pq.trim().toLowerCase();
    if (!s) return patients.slice(0, 40);
    return patients
      .filter((p) => p.full_name.toLowerCase().includes(s) || (p.phone ?? "").includes(s))
      .slice(0, 40);
  }, [patients, pq]);

  const bmiValue = patient ? bmi(Number(patient.height_cm ?? 0), Number(patient.weight_kg ?? 0)) : 0;

  return (
    <AppShell title="واجهة العيادة">
      <div dir="rtl" className="flex-1 flex flex-col overflow-hidden">
        {/* ── TOP PATIENT SUMMARY BAR ─────────────────────────── */}
        <div
          className="shrink-0 border-b border-border px-4 py-2.5 flex items-center gap-3"
          style={{ background: `linear-gradient(90deg, ${CLINIC_BLUE}22, transparent)` }}
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white transition-transform active:scale-95"
              style={{ background: CLINIC_BLUE }}
            >
              <Search className="size-3.5" />
              {patient ? "تغيير المريض" : "اختيار المريض"}
            </button>
            {pickerOpen && (
              <div className="absolute z-50 mt-2 w-72 rounded-lg border border-border bg-slate-950/95 backdrop-blur-md shadow-xl p-2 animate-reveal">
                <input
                  autoFocus
                  value={pq}
                  onChange={(e) => setPq(e.target.value)}
                  placeholder="بحث بالاسم أو الهاتف…"
                  className="w-full bg-slate-800 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
                />
                <div className="mt-2 max-h-72 overflow-auto space-y-0.5">
                  {filteredPatients.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setActiveId(p.id);
                        setPickerOpen(false);
                      }}
                      className="w-full text-right px-2 py-1.5 rounded-md text-xs hover:bg-emerald/10"
                    >
                      <span className="font-bold">{p.full_name}</span>
                      <span className="text-muted-foreground mr-2 font-mono text-[10px]">{p.phone ?? "—"}</span>
                    </button>
                  ))}
                  {filteredPatients.length === 0 && (
                    <p className="text-[11px] text-muted-foreground p-2">لا توجد نتائج</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 grid grid-cols-7 gap-2 min-w-0">
            <BannerCell label="اسم المريض" value={patient?.full_name ?? "—"} wide />
            <BannerCell label="العمر" value={patient?.age ? `${patient.age} سنة` : "—"} />
            <BannerCell
              label="الجنس"
              value={patient?.gender === "male" ? "ذكر" : patient?.gender === "female" ? "أنثى" : "—"}
            />
            <BannerCell label="العنوان" value={patient?.address ?? "—"} />
            <BannerCell label="الوزن" value={patient?.weight_kg ? `${patient.weight_kg} كغ` : "—"} />
            <BannerCell label="الطول" value={patient?.height_cm ? `${patient.height_cm} سم` : "—"} />
            <BannerCell
              label="BMI"
              value={bmiValue ? `${bmiValue} · ${bmiLabel(bmiValue)}` : "—"}
            />
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* ── RIGHT SIDEBAR — history + AI summary ───────────── */}
          <HistorySidebar patient={patient} visits={clinical.visits} labs={clinical.labs} />

          {/* ── MAIN CANVAS ───────────────────────────────────── */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {!patient ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                اختر مريضاً لبدء الزيارة السريرية
              </div>
            ) : (
              <>
                <ExaminationSection patientId={patient.id} />
                <ReportSection patient={patient} />
                <LabOrdersSection patient={patient} />
                <PrescriptionSection patient={patient} meds={meds} />
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function bmiLabel(v: number) {
  const c = bmiCategory(v);
  return c === "underweight" ? "نحافة" : c === "normal" ? "طبيعي" : c === "overweight" ? "زيادة" : "سمنة";
}

function BannerCell({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-slate-900/70 px-2 py-1.5">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground truncate">{label}</p>
      <p className={`truncate ${wide ? "text-sm font-bold" : "text-xs font-semibold"}`} title={value}>
        {value}
      </p>
    </div>
  );
}

/* ─────────────── RIGHT SIDEBAR ─────────────── */
function HistorySidebar({
  patient,
  visits,
  labs,
}: {
  patient: PatientRow | null;
  visits: ReturnType<typeof getClinical>["visits"];
  labs: ReturnType<typeof getClinical>["labs"];
}) {
  const [summary, setSummary] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [openVisit, setOpenVisit] = useState<string | null>(null);

  const runSummary = async () => {
    if (!patient) return;
    setLoading(true);
    setSummary("");
    try {
      const res = await fetch("/api/breef-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            "لخّص الحالة الصحية لهذا المريض عبر الزمن: الأمراض المزمنة، الأدوية السابقة، التحاليل، والمسار السريري، مع توصية موجزة للطبيب.",
          context: {
            patient: {
              name: patient.full_name,
              age: patient.age,
              gender: patient.gender,
              weight: patient.weight_kg,
              height: patient.height_cm,
              chronic_diseases: patient.chronic_diseases,
              chronic_meds: patient.chronic_meds,
              allergies: patient.allergies,
              smoker: patient.is_smoker,
              notes: patient.notes,
            },
            visits: visits.slice(0, 12),
            labs: labs.slice(0, 12),
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { answer?: string };
      setSummary(data.answer ?? "");
    } catch (e) {
      toast.error(`تعذّر توليد الملخص: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="w-72 shrink-0 border-l border-border bg-slate-950/40 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          عدد الزيارات الإجمالية
        </p>
        <p className="text-2xl font-black font-mono" style={{ color: CLINIC_BLUE }}>
          {visits.length}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">
          التاريخ والزيارات السابقة
        </p>
        {visits.length === 0 && (
          <p className="text-[11px] text-muted-foreground px-1 py-3">لا توجد زيارات مسجلة</p>
        )}
        {visits.map((v) => (
          <div key={v.id} className="rounded-lg border border-border bg-slate-900/70 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenVisit((c) => (c === v.id ? null : v.id))}
              className="w-full text-right px-2.5 py-2 hover:bg-emerald/5 transition-colors"
            >
              <span className="text-[10px] font-mono text-muted-foreground">{v.date}</span>
              <p className="text-xs font-bold truncate">{v.diagnosis || "زيارة"}</p>
              <p className="text-[10px] text-muted-foreground truncate">{v.doctor}</p>
            </button>
            {openVisit === v.id && (
              <div className="px-2.5 pb-2 text-[11px] space-y-1 animate-reveal border-t border-border pt-2">
                {v.specialty && <p className="text-muted-foreground">الاختصاص: {v.specialty}</p>}
                <p className="whitespace-pre-wrap">{v.diagnosis}</p>
                {v.prescribed.length > 0 && (
                  <ul className="list-disc pr-4 text-muted-foreground">
                    {v.prescribed.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-border">
        <div
          className="rounded-lg border p-2.5 space-y-2"
          style={{ borderColor: `${CLINIC_BLUE}66`, background: `${CLINIC_BLUE}18` }}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-emerald" />
            <p className="text-[11px] font-bold">ملخص الحالة بالذكاء الاصطناعي</p>
          </div>
          <p className="text-[11px] leading-relaxed max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">
            {loading ? "جارٍ التحليل…" : summary || "اضغط لتوليد ملخص Breef AI للحالة."}
          </p>
          <button
            type="button"
            disabled={!patient || loading}
            onClick={runSummary}
            className="w-full rounded-md py-1.5 text-[11px] font-bold text-white disabled:opacity-40 transition-transform active:scale-95"
            style={{ background: CLINIC_BLUE }}
          >
            توليد الملخص
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ─────────────── EXAMINATION ─────────────── */
function ExaminationSection({ patientId }: { patientId: string }) {
  const [complaint, setComplaint] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState("");
  const [doctor, setDoctor] = useState("");

  useEffect(() => {
    setComplaint("");
    setNotes("");
    setHistory("");
  }, [patientId]);

  const saveVisit = () => {
    if (!complaint.trim()) {
      toast.error("يرجى إدخال سبب الزيارة");
      return;
    }
    const rec = getClinical(patientId);
    setClinical(patientId, {
      ...rec,
      visits: [
        {
          id: crypto.randomUUID(),
          doctor: doctor.trim() || "الطبيب",
          date: new Date().toISOString().slice(0, 10),
          diagnosis: [complaint.trim(), notes.trim(), history.trim()].filter(Boolean).join(" — "),
          prescribed: [],
        },
        ...rec.visits,
      ],
    });
    toast.success("تم حفظ الزيارة في سجل المريض");
  };

  return (
    <section className="rounded-xl border border-border bg-slate-900/60 p-3 space-y-2">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-7">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            سبب الزيارة
          </span>
          <input
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="الشكوى الرئيسية…"
            className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="mt-1 text-[10px] font-bold text-emerald hover:underline"
          >
            {notesOpen ? "▲ إخفاء الملاحظات الإضافية" : "▼ ملاحظات إضافية"}
          </button>
          {notesOpen && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="ملاحظات الفحص السريري…"
              className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40 animate-reveal"
            />
          )}
        </div>
        <div className="col-span-5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            التاريخ المرضي
          </span>
          <textarea
            value={history}
            onChange={(e) => setHistory(e.target.value)}
            rows={notesOpen ? 6 : 3}
            placeholder="الأمراض السابقة، العمليات، الأدوية المزمنة…"
            className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={doctor}
          onChange={(e) => setDoctor(e.target.value)}
          placeholder="اسم الطبيب"
          className="w-48 bg-slate-800 border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
        />
        <button
          type="button"
          onClick={saveVisit}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white transition-transform active:scale-95"
          style={{ background: CLINIC_BLUE }}
        >
          <Save className="size-3.5" /> حفظ الزيارة
        </button>
      </div>
    </section>
  );
}

/* ─────────────── TEMPLATES ─────────────── */
async function fetchTemplates(kind: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from("report_templates")
    .select("id,kind,name,content")
    .eq("kind", kind)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TemplateRow[];
}

function TemplateModal({
  kind,
  onPick,
  onClose,
}: {
  kind: string;
  onPick: (t: TemplateRow) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  useEffect(() => {
    fetchTemplates(kind).then(setRows).catch((e) => toast.error(String(e.message ?? e)));
  }, [kind]);

  const remove = async (id: string) => {
    await supabase.from("report_templates").delete().eq("id", id);
    setRows((r) => r.filter((x) => x.id !== id));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-border bg-slate-900 p-4 space-y-3 animate-reveal"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">اختيار قالب {kind === "report" ? "التقرير" : "الراجيتة"}</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-auto space-y-1.5">
          {rows.length === 0 && <p className="text-xs text-muted-foreground py-4">لا توجد قوالب محفوظة بعد.</p>}
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border bg-slate-950/60 p-2">
              <button
                type="button"
                onClick={() => {
                  onPick(t);
                  onClose();
                }}
                className="flex-1 text-right"
              >
                <p className="text-xs font-bold">{t.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {t.content.replace(/<[^>]+>/g, " ").slice(0, 70)}
                </p>
              </button>
              <button type="button" onClick={() => remove(t.id)} className="text-rose-400 hover:text-rose-300">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function printHtml(title: string, html: string) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(
    `<html dir="rtl" lang="ar"><head><title>${title}</title><style>
      body{font-family:system-ui,'Segoe UI',Tahoma;padding:32px;color:#0f172a}
      h1{color:${CLINIC_BLUE};font-size:20px;border-bottom:2px solid ${CLINIC_BLUE};padding-bottom:8px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      td,th{border:1px solid #cbd5e1;padding:6px;font-size:13px;text-align:right}
    </style></head><body><h1>${title}</h1>${html}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

/* ─────────────── RICH TEXT REPORT ─────────────── */
function ReportSection({ patient }: { patient: PatientRow }) {
  const ref = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState(false);

  const cmd = (c: string, v?: string) => {
    ref.current?.focus();
    document.execCommand(c, false, v);
  };

  const saveTemplate = async () => {
    const name = prompt("اسم القالب:");
    if (!name) return;
    const { error } = await supabase
      .from("report_templates")
      .insert({ kind: "report", name, content: ref.current?.innerHTML ?? "" });
    if (error) toast.error(error.message);
    else toast.success("تم حفظ القالب");
  };

  return (
    <section className="rounded-xl border border-border bg-slate-900/60 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <FileText className="size-4" style={{ color: CLINIC_BLUE }} />
        <h3 className="text-xs font-bold ml-auto">التقارير والقوالب</h3>
        <button
          type="button"
          onClick={() => setModal(true)}
          className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-emerald/10"
        >
          القوالب
        </button>
        <ToolBtn onClick={() => cmd("bold")} icon={Bold} />
        <ToolBtn onClick={() => cmd("italic")} icon={Italic} />
        <ToolBtn onClick={() => cmd("underline")} icon={Underline} />
        <ToolBtn onClick={() => cmd("justifyRight")} icon={AlignRight} />
        <ToolBtn onClick={() => cmd("justifyCenter")} icon={AlignCenter} />
        <ToolBtn onClick={() => cmd("justifyLeft")} icon={AlignLeft} />
        <ToolBtn onClick={() => cmd("insertUnorderedList")} icon={List} />
        <select
          onChange={(e) => cmd("fontSize", e.target.value)}
          defaultValue="3"
          className="bg-slate-800 border border-border rounded-md text-[10px] px-1 py-1"
          aria-label="حجم الخط"
        >
          {[1, 2, 3, 4, 5, 6, 7].map((s) => (
            <option key={s} value={s}>
              حجم {s}
            </option>
          ))}
        </select>
        <input
          type="color"
          onChange={(e) => cmd("foreColor", e.target.value)}
          className="size-6 rounded border border-border bg-transparent"
          aria-label="لون النص"
        />
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        dir="rtl"
        className="min-h-40 rounded-lg border border-border bg-slate-950/60 p-3 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-emerald/30"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            printHtml(
              `تقرير طبي — ${patient.full_name}`,
              ref.current?.innerHTML ?? "",
            )
          }
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white transition-transform active:scale-95"
          style={{ background: CLINIC_BLUE }}
        >
          <Printer className="size-3.5" /> طباعة التقرير
        </button>
        <button
          type="button"
          onClick={saveTemplate}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold hover:bg-emerald/10"
        >
          <Save className="size-3.5" /> حفظ قالب
        </button>
      </div>

      {modal && (
        <TemplateModal
          kind="report"
          onClose={() => setModal(false)}
          onPick={(t) => {
            if (ref.current) ref.current.innerHTML = t.content;
          }}
        />
      )}
    </section>
  );
}

function ToolBtn({ onClick, icon: Icon }: { onClick: () => void; icon: typeof Bold }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded-md border border-border p-1.5 hover:bg-emerald/10 transition-colors"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/* ─────────────── LAB ORDERS ─────────────── */
function LabOrdersSection({ patient }: { patient: PatientRow }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPicked([]), [patient.id]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return LAB_TESTS.filter((t) => !picked.includes(t) && (!s || t.toLowerCase().includes(s))).slice(0, 8);
  }, [q, picked]);

  const send = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    const rec = getClinical(patient.id);
    setClinical(patient.id, {
      ...rec,
      labs: [
        ...picked.map((t) => ({
          id: crypto.randomUUID(),
          test: t,
          date: new Date().toISOString().slice(0, 10),
          value: "قيد الانتظار — أُرسل للمختبر",
        })),
        ...rec.labs,
      ],
    });
    setPicked([]);
    setBusy(false);
    toast.success("تم إرسال طلب التحاليل للمختبر المربوط");
  };

  return (
    <section className="rounded-xl border border-border bg-slate-900/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4" style={{ color: CLINIC_BLUE }} />
        <h3 className="text-xs font-bold">التحاليل المرسلة</h3>
      </div>
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن تحليل…"
            className="w-full bg-slate-800 border border-border rounded-lg px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
          <div className="mt-1 space-y-0.5 max-h-40 overflow-auto">
            {results.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPicked((p) => [...p, t])}
                className="w-full flex items-center gap-1.5 text-right px-2 py-1.5 rounded-md text-[11px] hover:bg-emerald/10"
              >
                <Plus className="size-3 text-emerald" /> {t}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-7">
          <div className="rounded-lg border border-border bg-slate-950/60 p-2 min-h-24 space-y-1">
            {picked.length === 0 && (
              <p className="text-[11px] text-muted-foreground p-2">لم يتم اختيار تحاليل بعد.</p>
            )}
            {picked.map((t) => (
              <div key={t} className="flex items-center gap-2 rounded-md bg-slate-900 px-2 py-1">
                <span className="text-[11px] flex-1">{t}</span>
                <button
                  type="button"
                  onClick={() => setPicked((p) => p.filter((x) => x !== t))}
                  className="text-rose-400 hover:text-rose-300"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={picked.length === 0 || busy}
            onClick={send}
            className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40 transition-transform active:scale-95"
            style={{ background: CLINIC_BLUE }}
          >
            <Send className="size-3.5" /> إرسال للمختبر المربوط
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── PRESCRIPTION ─────────────── */
function PrescriptionSection({ patient, meds }: { patient: PatientRow; meds: Medicine[] }) {
  const [sci, setSci] = useState("");
  const [trade, setTrade] = useState("");
  const [dose, setDose] = useState("");
  const [freq, setFreq] = useState(FREQS[0]);
  const [duration, setDuration] = useState("");
  const [lines, setLines] = useState<RxLine[]>([]);
  const [modal, setModal] = useState(false);
  const [header, setHeader] = useState("");

  useEffect(() => setLines([]), [patient.id]);

  const sciMatches = useMemo(() => {
    const s = sci.trim().toLowerCase();
    if (!s) return [];
    return meds.filter((m) => (m.scientific_name ?? "").toLowerCase().includes(s)).slice(0, 6);
  }, [sci, meds]);

  const tradeMatches = useMemo(() => {
    const s = trade.trim().toLowerCase();
    if (!s) return [];
    return meds.filter((m) => (m.trade_name ?? "").toLowerCase().includes(s)).slice(0, 6);
  }, [trade, meds]);

  const add = () => {
    if (!sci && !trade) return;
    setLines((l) => [
      ...l,
      { id: crypto.randomUUID(), scientific: sci, trade, dose, freq, duration },
    ]);
    setSci("");
    setTrade("");
    setDose("");
    setDuration("");
  };

  const rxHtml = () => {
    const rows = lines
      .map(
        (l, i) =>
          `<tr><td>${i + 1}</td><td>${l.trade || "—"}</td><td>${l.scientific || "—"}</td><td>${l.dose || "—"}</td><td>${l.freq}</td><td>${l.duration || "—"}</td></tr>`,
      )
      .join("");
    return `${header ? `<div>${header}</div>` : ""}
      <p><b>المريض:</b> ${patient.full_name} &nbsp; <b>العمر:</b> ${patient.age ?? "—"} &nbsp; <b>التاريخ:</b> ${new Date().toLocaleDateString("en-GB")}</p>
      <table><thead><tr><th>#</th><th>الاسم التجاري</th><th>الاسم العلمي</th><th>الجرعة</th><th>التكرار</th><th>المدة</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const saveToVisit = () => {
    if (lines.length === 0) return;
    const rec = getClinical(patient.id);
    const prescribed = lines.map(
      (l) => `${l.trade || l.scientific} — ${l.dose} ${l.freq} ${l.duration}`.trim(),
    );
    const [first, ...rest] = rec.visits;
    if (first && first.date === new Date().toISOString().slice(0, 10)) {
      setClinical(patient.id, {
        ...rec,
        visits: [{ ...first, prescribed: [...first.prescribed, ...prescribed] }, ...rest],
      });
    } else {
      setClinical(patient.id, {
        ...rec,
        visits: [
          {
            id: crypto.randomUUID(),
            doctor: "الطبيب",
            date: new Date().toISOString().slice(0, 10),
            diagnosis: "راجيتة دوائية",
            prescribed,
          },
          ...rec.visits,
        ],
      });
    }
    toast.success("تم حفظ الراجيتة في سجل المريض");
  };

  const saveTemplate = async () => {
    const name = prompt("اسم قالب الراجيتة:");
    if (!name) return;
    const { error } = await supabase
      .from("report_templates")
      .insert({ kind: "prescription", name, content: header || rxHtml() });
    if (error) toast.error(error.message);
    else toast.success("تم حفظ القالب");
  };

  return (
    <section className="rounded-xl border border-border bg-slate-900/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Pill className="size-4" style={{ color: CLINIC_BLUE }} />
        <h3 className="text-xs font-bold">الراجيتة الدوائية</h3>
      </div>

      <div className="grid grid-cols-12 gap-2 items-start">
        <SearchBox
          className="col-span-3"
          label="الاسم العلمي"
          value={sci}
          onChange={setSci}
          matches={sciMatches.map((m) => ({ id: m.id, main: m.scientific_name, sub: m.trade_name }))}
          onPick={(m) => {
            setSci(m.main);
            setTrade(m.sub);
          }}
        />
        <SearchBox
          className="col-span-3"
          label="الاسم التجاري"
          value={trade}
          onChange={setTrade}
          matches={tradeMatches.map((m) => ({ id: m.id, main: m.trade_name, sub: m.scientific_name }))}
          onPick={(m) => {
            setTrade(m.main);
            setSci(m.sub);
          }}
        />
        <label className="col-span-2 block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">الجرعة</span>
          <input
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="حبة / 5 مل"
            className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
        </label>
        <label className="col-span-2 block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">التكرار</span>
          <select
            value={freq}
            onChange={(e) => setFreq(e.target.value)}
            className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2 py-2 text-xs outline-none"
          >
            {FREQS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-1 block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">المدة</span>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="7 أيام"
            className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="col-span-1 mt-[18px] rounded-lg py-2 text-[11px] font-bold text-white transition-transform active:scale-95"
          style={{ background: CLINIC_BLUE }}
        >
          إضافة
        </button>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-950/60 text-[9px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-right">#</th>
              <th className="px-2 py-1.5 text-right">الاسم التجاري</th>
              <th className="px-2 py-1.5 text-right">الاسم العلمي</th>
              <th className="px-2 py-1.5 text-right">الجرعة</th>
              <th className="px-2 py-1.5 text-right">التكرار</th>
              <th className="px-2 py-1.5 text-right">المدة</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                  لم تُضف أدوية بعد
                </td>
              </tr>
            )}
            {lines.map((l, i) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-2 py-1.5 font-mono">{i + 1}</td>
                <td className="px-2 py-1.5 font-bold">{l.trade || "—"}</td>
                <td className="px-2 py-1.5">{l.scientific || "—"}</td>
                <td className="px-2 py-1.5">{l.dose || "—"}</td>
                <td className="px-2 py-1.5">{l.freq}</td>
                <td className="px-2 py-1.5">{l.duration || "—"}</td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setLines((x) => x.filter((y) => y.id !== l.id))}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setModal(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold hover:bg-emerald/10"
        >
          اختيار قالب
        </button>
        <button
          type="button"
          onClick={saveToVisit}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold hover:bg-emerald/10"
        >
          <Save className="size-3.5" /> حفظ
        </button>
        <button
          type="button"
          onClick={saveTemplate}
          className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold hover:bg-emerald/10"
        >
          حفظ قالب
        </button>
        <button
          type="button"
          onClick={() => printHtml(`راجيتة دوائية — ${patient.full_name}`, rxHtml())}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white transition-transform active:scale-95"
          style={{ background: CLINIC_BLUE }}
        >
          <Printer className="size-3.5" /> طباعة الراجيتة
        </button>
      </div>

      {modal && (
        <TemplateModal kind="prescription" onClose={() => setModal(false)} onPick={(t) => setHeader(t.content)} />
      )}
    </section>
  );
}

function SearchBox({
  className,
  label,
  value,
  onChange,
  matches,
  onPick,
}: {
  className?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  matches: Array<{ id: string; main: string; sub: string }>;
  onPick: (m: { id: string; main: string; sub: string }) => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div className={`relative ${className ?? ""}`}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
      />
      {focus && matches.length > 0 && (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-border bg-slate-950/95 backdrop-blur-md shadow-xl p-1 animate-reveal">
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m)}
              className="w-full text-right px-2 py-1.5 rounded-md text-[11px] hover:bg-emerald/10"
            >
              <span className="font-bold">{m.main}</span>
              <span className="text-muted-foreground mr-2">{m.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
