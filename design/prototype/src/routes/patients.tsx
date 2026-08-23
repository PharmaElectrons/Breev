import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PatientLoyaltyCard } from "@/components/bi-reports";

import {
  createPatient,
  deletePatient,
  listPatients,
  updatePatient,
  type PatientRow,
} from "@/lib/db";

import { bmi, bmiCategory } from "@/lib/patients";
import {
  ensureAbuYusufSeed,
  getClinical,
  setClinical,
  useClinical,
  type LabEntry,
  type PharmacyEntry,
  type VisitEntry,
} from "@/lib/clinical";
import {
  ageFromDob,
  getExtras,
  isBirthdayToday,
  setExtras,
  useExtras,
} from "@/lib/patient-extras";


export const Route = createFileRoute("/patients")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الملف الصحي للمريض — Breef Pharmacy" },
      { name: "description", content: "إدارة ملفات المرضى، الأمراض المزمنة، والأدوية المستمرة." },
    ],
  }),
  component: PatientsPage,
});

const empty: Partial<PatientRow> = {
  full_name: "",
  phone: "",
  address: "",
  gender: null,
  age: null,
  height_cm: null,
  weight_kg: null,
  chronic_diseases: [],
  chronic_meds: [],
  interests: [],
  notes: "",
  is_smoker: false,
  uses_alcohol: false,
  has_allergy: false,
  allergies: [],
};


function PatientsPage() {
  const [list, setList] = useState<PatientRow[]>([]);
  const [q, setQ] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<PatientRow>>(empty);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const p = await listPatients();
      setList(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };


  useEffect(() => {
    refresh();
  }, []);


  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (p) => p.full_name.toLowerCase().includes(s) || (p.phone ?? "").includes(s),
    );
  }, [list, q]);

  const startCreate = () => {
    setCreating(true);
    setActiveId(null);
    setForm(empty);
  };

  const openPatient = (p: PatientRow) => {
    setCreating(false);
    setActiveId(p.id);
    setForm(p);
    ensureAbuYusufSeed(p.id, p.full_name);
    setPickerOpen(false);
  };

  const openPatientById = (id: string) => {
    const p = list.find((x) => x.id === id);
    if (p) openPatient(p);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (creating) {
        const c = await createPatient(form);
        await refresh();
        setActiveId(c.id);
        setForm(c);
        setCreating(false);
      } else if (activeId) {
        const u = await updatePatient(activeId, form);
        await refresh();
        setForm(u);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!activeId) return;
    if (!confirm("حذف هذا الملف؟")) return;
    setBusy(true);
    try {
      await deletePatient(activeId);
      setActiveId(null);
      setForm(empty);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const editing = creating || activeId;

  return (
    <AppShell title="الملف الصحي للمريض">
      <div className="flex-1 flex overflow-hidden">
        {/* RIGHT: Birthday matrix — CRM milestones */}
        <BirthdayMatrixSidebar />


        {/* MAIN */}
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {/* Top header: patient picker + actions */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  value={q}
                  onFocus={() => setPickerOpen(true)}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPickerOpen(true);
                  }}
                  placeholder="ابحث عن مريض بالاسم أو الهاتف..."
                  className="w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
                />
                {pickerOpen && filtered.length > 0 && (
                  <div className="absolute z-20 top-full mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-slate-950 shadow-lg">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => openPatient(p)}
                        className="w-full text-right px-3 py-2 hover:bg-emerald/10 border-b border-border/40"
                      >
                        <div className="text-sm font-bold">{p.full_name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {p.phone ?? ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={startCreate}
                className="px-3 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 shrink-0"
              >
                + مريض جديد
              </button>
              {activeId && !creating && (
                <button
                  onClick={remove}
                  disabled={busy}
                  className="px-3 py-2 rounded-lg border border-destructive/40 text-destructive text-xs font-bold hover:bg-destructive/10"
                >
                  حذف
                </button>
              )}
              {editing && (
                <button
                  onClick={submit}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50"
                >
                  {creating ? "حفظ" : "تحديث"}
                </button>
              )}
            </div>

            {err && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2">
                {err}
              </p>
            )}

            {!editing && (
              <PatientDirectory rows={filtered} onOpen={openPatient} />
            )}


            {editing && (
              <>
                {!creating && activeId && <PatientLoyaltyCard patientId={activeId} />}
                <PatientEditor
                  form={form}
                  setForm={setForm}
                  activeId={activeId}
                  creating={creating}
                />
              </>
            )}

          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ============= Birthday Matrix Sidebar (CRM) =============

type BirthdayRow = { name: string; phone: string; dob: string };

const BIRTHDAY_MOCK: BirthdayRow[] = [
  { name: "أبو يوسف الجميلي", phone: "07701234567", dob: "1975-07-13" },
  { name: "أحمد علي حسين", phone: "07711223344", dob: "1988-03-21" },
  { name: "زينب كاظم", phone: "07801122334", dob: "1992-11-05" },
  { name: "مصطفى الربيعي", phone: "07901234432", dob: "1980-01-30" },
  { name: "فاطمة الزهراء", phone: "07711998877", dob: "1995-07-13" },
  { name: "علي حيدر", phone: "07701555222", dob: "1970-09-14" },
  { name: "نور الهدى", phone: "07811223344", dob: "2001-05-19" },
  { name: "حسين عبد الأمير", phone: "07705554433", dob: "1965-12-25" },
  { name: "سارة محمد", phone: "07709876543", dob: "1990-08-04" },
  { name: "يوسف كريم", phone: "07803344556", dob: "1985-02-11" },
  { name: "مريم حسن", phone: "07712345678", dob: "1978-06-30" },
  { name: "ليلى العبيدي", phone: "07902223344", dob: "1993-10-17" },
  { name: "عمر الطائي", phone: "07704443322", dob: "1982-04-08" },
  { name: "رقية جواد", phone: "07708887766", dob: "1998-12-01" },
  { name: "كرار الأسدي", phone: "07801237890", dob: "1972-11-22" },
  { name: "زهراء منتظر", phone: "07711118899", dob: "2003-07-13" },
  { name: "أحمد المالكي", phone: "07903332211", dob: "1968-09-27" },
  { name: "بتول سعد", phone: "07706667788", dob: "1996-01-15" },
  { name: "حيدر عباس", phone: "07812345009", dob: "1987-05-06" },
  { name: "شهد فلاح", phone: "07702228899", dob: "1999-03-03" },
];

function BirthdayMatrixSidebar() {
  const today = new Date();
  const rows = [...BIRTHDAY_MOCK]
    .map((r) => {
      const d = new Date(r.dob);
      const isToday = d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      // days until next birthday
      const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
      if (next < today && !isToday) next.setFullYear(today.getFullYear() + 1);
      const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
      return { ...r, isToday, daysUntil, age: ageFromDob(r.dob) ?? 0 };
    })
    .sort((a, b) => {
      if (a.isToday !== b.isToday) return a.isToday ? -1 : 1;
      return a.daysUntil - b.daysUntil;
    });

  const buildLink = (r: BirthdayRow) => {
    const msg = `عزيزنا/عزيزتنا ${r.name} 🎂✨\nكل عام وأنتم بألف خير من عائلة صيدلية Breef.\nنتمنى لكم عاماً مليئاً بالصحة والسعادة والبركات.\nهدية عيد الميلاد بانتظاركم في الصيدلية 🎁`;
    return `/messages?to=${encodeURIComponent(r.phone)}&text=${encodeURIComponent(msg)}`;
  };

  const todayCount = rows.filter((r) => r.isToday).length;

  return (
    <aside className="w-72 border-l border-border bg-slate-950/40 shrink-0 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald flex items-center gap-1">
          🎂 مصفوفة أعياد الميلاد
        </h3>
        <p className="text-[10px] text-muted-foreground mt-1">
          {todayCount > 0 ? (
            <span className="text-amber-400 font-bold">🎉 {todayCount} عيد ميلاد اليوم</span>
          ) : (
            <>{rows.length} مريض · مرتّبون حسب أقرب موعد</>
          )}
        </p>
      </div>
      <div className="flex-1 overflow-auto divide-y divide-border/40">
        {rows.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            className={`p-2 ${r.isToday ? "bg-amber-500/10" : ""}`}
          >
            <div className="flex items-center justify-between gap-1">
              <p className="text-[12px] font-bold truncate flex-1 text-right">{r.name}</p>
              {r.isToday && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-amber-500/25 text-amber-400 shrink-0 animate-pulse">
                  🎉 اليوم
                </span>
              )}
            </div>
            <div className="flex items-center justify-between mt-0.5 text-[10px] font-mono text-muted-foreground/80">
              <span>عيدهم: {r.dob.slice(5)}</span>
              <span>{r.age} سنة</span>
            </div>
            <Link
              to={buildLink(r)}
              className={`mt-1 flex items-center justify-center gap-1 w-full py-1 rounded text-[10px] font-bold transition ${
                r.isToday
                  ? "bg-amber-500 text-slate-900 hover:brightness-110"
                  : "bg-emerald/15 text-emerald hover:bg-emerald/25"
              }`}
            >
              ✉ إرسال تهنئة
            </Link>
          </div>
        ))}
      </div>
    </aside>
  );
}


// ============= Patient Editor =============

function PatientEditor({
  form,
  setForm,
  activeId,
  creating,
}: {
  form: Partial<PatientRow>;
  setForm: (u: (f: Partial<PatientRow>) => Partial<PatientRow>) => void;
  activeId: string | null;
  creating: boolean;
}) {

  const extras = useExtras(activeId);
  const [newWeight, setNewWeight] = useState("");
  const computedAge = ageFromDob(extras.dob);
  const bd = isBirthdayToday(extras.dob);
  const bmiVal = bmi(Number(form.height_cm ?? 0), Number(form.weight_kg ?? 0));
  const bmiCat = bmiVal ? bmiCategory(bmiVal) : null;

  const birthdayMsg = form.full_name
    ? `عزيزنا/عزيزتنا ${form.full_name}، كل عام وأنتم بألف خير من صيدلية Breef 🎂`
    : "";
  const bdayLink = form.phone
    ? `/messages?to=${encodeURIComponent(form.phone)}&text=${encodeURIComponent(birthdayMsg)}`
    : "/messages";

  const saveWeight = () => {
    const kg = Number(newWeight);
    if (!kg || !activeId) return;
    const prev = form.weight_kg ?? null;
    const ex = getExtras(activeId);
    ex.weights = [...ex.weights, { id: crypto.randomUUID(), date: new Date().toISOString().slice(0, 10), kg }];
    setExtras(activeId, ex);
    setForm((f) => ({ ...f, weight_kg: kg }));
    setNewWeight("");
    if (prev && kg !== prev) {
      const trend = kg > prev ? "زيادة" : "نقصان";
      const diff = Math.abs(kg - prev).toFixed(1);
      const msg = `عزيزنا/عزيزتنا ${form.full_name}، لاحظنا ${trend} في وزنك بمقدار ${diff} كغ (من ${prev} إلى ${kg} كغ). نتمنى لك دوام الصحة. — Breef Pharmacy`;
      if (confirm("تم حفظ الوزن. هل تريد إرسال رسالة متابعة للمريض؟")) {
        window.open(
          `/messages?to=${encodeURIComponent(form.phone ?? "")}&text=${encodeURIComponent(msg)}`,
          "_blank",
        );
      }
    }
  };

  return (
    <>
      <h2 className="text-lg font-bold">{creating ? "تسجيل مريض جديد" : form.full_name}</h2>

      {/* ROW 1 — identity level */}
      <div dir="rtl" className="grid grid-cols-12 gap-2">
        <Field
          className="col-span-3"
          label="اسم المريض *"
          value={form.full_name ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, full_name: v }))}
        />
        <Field
          className="col-span-2"
          label="رقم الهاتف"
          value={form.phone ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
        />
        <Field
          className="col-span-3"
          label="العنوان"
          value={form.address ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, address: v }))}
        />

        {/* Gender (optional) */}
        <div className="col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            الجنس
          </span>
          <div className="mt-1 flex gap-1">
            {([["male", "ذكر"], ["female", "أنثى"]] as const).map(([val, lbl]) => {
              const active = (form as { gender?: string | null }).gender === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, gender: active ? null : val }) as typeof f)
                  }
                  className={`flex-1 rounded-lg border px-1 py-2 text-[11px] font-bold transition-colors ${
                    active
                      ? "bg-emerald text-primary-foreground border-emerald"
                      : "bg-slate-800 border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>


        {/* DOB → age (smallest compact field) */}
        <label className="col-span-2 block relative">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            الميلاد / العمر
            {bd && (
              <Link
                to={bdayLink}
                title="عيد ميلاد اليوم — إرسال تهنئة"
                className="ml-auto animate-pulse text-base"
              >
                🎂
              </Link>
            )}
          </span>
          <div className="mt-1 flex gap-1">
            <input
              type="date"
              value={extras.dob ?? ""}
              onChange={(e) => {
                if (!activeId) return;
                setExtras(activeId, { ...getExtras(activeId), dob: e.target.value });
                setForm((f) => ({ ...f, age: ageFromDob(e.target.value) }));
              }}
              className="min-w-0 flex-1 bg-slate-800 border border-border rounded-lg px-1.5 py-2 text-[11px] outline-none focus:ring-2 focus:ring-emerald/40"
            />
            <div className="px-1.5 py-2 bg-slate-950 border border-border rounded-lg text-[11px] font-mono min-w-[2.25rem] text-center shrink-0">
              {computedAge ?? form.age ?? "—"}
            </div>
          </div>
        </label>
      </div>

      {/* ROW 2 — biometrics level */}
      <div dir="rtl" className="grid grid-cols-12 gap-2 items-end">
        <NumField
          className="col-span-3"
          label="الطول (سم)"
          value={Number(form.height_cm ?? 0)}
          onChange={(v) => setForm((f) => ({ ...f, height_cm: v || null }))}
        />

        {/* Weight + history */}
        <label className="col-span-7 block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            الوزن — آخر قيمة: {form.weight_kg ?? "—"} كغ
          </span>
          <div className="mt-1 flex gap-1">
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const kg = Number(e.target.value);
                if (kg) setForm((f) => ({ ...f, weight_kg: kg }));
              }}
              className="bg-slate-800 border border-border rounded-lg px-2 py-2 text-[11px] font-mono outline-none focus:ring-2 focus:ring-emerald/40 min-w-[6.5rem]"
              title="سجل الأوزان"
            >
              <option value="">📋 سجل ({extras.weights.length})</option>
              {extras.weights
                .slice()
                .reverse()
                .map((w) => (
                  <option key={w.id} value={w.kg}>
                    {w.date} — {w.kg} كغ
                  </option>
                ))}
            </select>
            <input
              type="number"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              placeholder="+ وزن جديد"
              className="flex-1 min-w-0 bg-slate-800 border border-border rounded-lg px-2 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald/40"
            />
            <button
              onClick={saveWeight}
              className="px-3 py-2 rounded-lg bg-emerald text-primary-foreground text-[11px] font-bold hover:brightness-110 shrink-0"
            >
              حفظ
            </button>
          </div>
        </label>

        {/* Auto-calculated BMI */}
        <div className="col-span-2 px-2 py-1.5 border border-emerald/30 bg-emerald/5 rounded-lg text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-emerald leading-none">BMI</p>
          <p className="text-sm font-mono font-bold text-emerald leading-tight">{bmiVal || "—"}</p>
          {bmiCat && <p className="text-[9px] text-muted-foreground leading-none">{bmiCat}</p>}
        </div>
      </div>

      {/* Tags */}
      <div dir="rtl" className="grid grid-cols-3 gap-2">
        <TagField
          label="الأمراض المزمنة"
          value={form.chronic_diseases ?? []}
          onChange={(v) => setForm((f) => ({ ...f, chronic_diseases: v }))}
          tone="rose"
          placeholder="+ مرض"
        />
        <TagField
          label="الأدوية المزمنة"
          value={form.chronic_meds ?? []}
          onChange={(v) => setForm((f) => ({ ...f, chronic_meds: v }))}
          tone="emerald"
          placeholder="+ دواء"
        />
        <TagField
          label="الاهتمامات"
          value={form.interests ?? []}
          onChange={(v) => setForm((f) => ({ ...f, interests: v }))}
          tone="amber"
          placeholder="+ اهتمام"
        />
      </div>

      {/* ROW 3 — notes + lifestyle / medical toggles */}
      <div dir="rtl" className="grid grid-cols-12 gap-2 items-start">
        <label className="col-span-7 block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            ملاحظات عامة
          </span>
          <textarea
            rows={3}
            value={form.notes ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="mt-1 w-full h-[86px] resize-none bg-slate-800 border border-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
        </label>

        <div className="col-span-5 space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            المؤشرات السلوكية والطبية
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            <Toggle
              label="مدخن"
              on={!!form.is_smoker}
              onChange={(v) => setForm((f) => ({ ...f, is_smoker: v }))}
            />
            <Toggle
              label="الكحول"
              on={!!form.uses_alcohol}
              onChange={(v) => setForm((f) => ({ ...f, uses_alcohol: v }))}
            />
            <Toggle
              label="حساسية"
              on={!!form.has_allergy}
              onChange={(v) =>
                setForm((f) => ({ ...f, has_allergy: v, allergies: v ? (f.allergies ?? []) : [] }))
              }
            />
          </div>
          {form.has_allergy && (
            <AllergyPicker
              value={form.allergies ?? []}
              onChange={(v) => setForm((f) => ({ ...f, allergies: v }))}
            />
          )}
        </div>
      </div>

      {!creating && activeId && <ClinicalSections patientId={activeId} />}

    </>
  );
}


// ============= Patient Directory =============

function PatientDirectory({
  rows,
  onOpen,
}: {
  rows: PatientRow[];
  onOpen: (p: PatientRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="grid place-items-center py-24 text-center text-muted-foreground text-sm">
        لا توجد ملفات مرضى — أنشئ ملفاً جديداً.
      </div>
    );
  }
  return (
    <section dir="rtl" className="border border-border rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-primary/5 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-bold text-emerald uppercase tracking-widest">دليل المرضى</h3>
        <span className="text-[10px] text-muted-foreground font-mono">{rows.length} ملف</span>
      </div>
      <table className="w-full text-right">
        <thead className="bg-slate-950/50 text-[10px] text-muted-foreground uppercase tracking-widest">
          <tr>
            <th className="px-3 py-2 w-10">#</th>
            <th className="px-3 py-2 text-right">اسم المريض</th>
            <th className="px-3 py-2">الهاتف</th>
            <th className="px-3 py-2">العنوان</th>
            <th className="px-3 py-2">العمر</th>
            <th className="px-3 py-2">الأمراض المزمنة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((p, i) => (
            <tr
              key={p.id}
              onClick={() => onOpen(p)}
              className="cursor-pointer hover:bg-emerald/10 transition"
            >
              <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(p);
                  }}
                  className="text-xs font-bold text-emerald hover:underline text-right"
                >
                  {p.full_name}
                </button>
              </td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{p.phone ?? "—"}</td>
              <td className="px-3 py-1.5 text-[11px]">{p.address ?? "—"}</td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{p.age ?? "—"}</td>
              <td className="px-3 py-1.5 text-[11px]">
                {(p.chronic_diseases ?? []).slice(0, 3).join("، ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ============= Small inputs =============

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex items-center justify-between gap-2 px-2 py-2 rounded-lg border text-[11px] font-bold transition ${
        on
          ? "border-emerald/50 bg-emerald/10 text-emerald"
          : "border-border bg-slate-800 text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <span
        className={`relative h-4 w-8 shrink-0 rounded-full transition ${
          on ? "bg-emerald" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
            on ? "right-0.5" : "right-[1.125rem]"
          }`}
        />
      </span>
    </button>
  );
}

const ALLERGY_FAMILIES = [
  "البنسلينات (Penicillins)",
  "السيفالوسبورينات (Cephalosporins)",
  "مضادات الالتهاب غير الستيرويدية (NSAIDs)",
  "السلفا (Sulfa)",
  "الأسبرين (Aspirin)",
  "الماكروليدات (Macrolides)",
  "التخدير الموضعي (Local Anesthetics)",
  "اللاتكس (Latex)",
  "حساسية غذائية (Food)",
  "حبوب اللقاح / الغبار (Environmental)",
];

function AllergyPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ALLERGY_FAMILIES.filter(
      (o) => !value.includes(o) && (!s || o.toLowerCase().includes(s)),
    );
  }, [q, value]);

  const add = (v: string) => {
    if (!v.trim() || value.includes(v)) return;
    onChange([...value, v.trim()]);
    setQ("");
  };

  return (
    <div className="rounded-lg border border-emerald/40 bg-emerald/5 p-2 space-y-1.5 animate-reveal">
      <span className="text-[10px] font-bold uppercase tracking-widest text-emerald">
        نوع الحساسية / عائلة الدواء
      </span>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <span
              key={v}
              className="px-2 py-0.5 text-[10px] rounded-full bg-rose-500/15 text-rose-400 flex items-center gap-1"
            >
              {v}
              <button onClick={() => onChange(value.filter((x) => x !== v))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(q);
          }
        }}
        placeholder="ابحث أو أضف مادة مسببة للحساسية..."
        className="w-full bg-slate-800 border border-border rounded-lg px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-emerald/40"
      />
      {options.length > 0 && (
        <div className="max-h-28 overflow-auto rounded-lg border border-border/60 divide-y divide-border/40">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => add(o)}
              className="w-full text-right px-2 py-1 text-[11px] hover:bg-emerald/10"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function Field({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
      />
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full bg-slate-800 border border-border rounded-lg px-2 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald/40"
      />
    </label>
  );
}

const TONES: Record<string, string> = {
  emerald: "bg-emerald/15 text-emerald",
  rose: "bg-rose-500/15 text-rose-400",
  amber: "bg-amber-500/15 text-amber-500",
};

function TagField({
  label,
  value,
  onChange,
  placeholder,
  tone = "emerald",
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  tone?: "emerald" | "rose" | "amber";
}) {
  const [input, setInput] = useState("");
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="mt-1 flex flex-wrap gap-1.5 p-2 min-h-[42px] bg-slate-800 border border-border rounded-lg">
        {value.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className={`px-2 py-0.5 text-[11px] rounded-full flex items-center gap-1 ${TONES[tone]}`}
          >
            {v}
            <button
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="hover:text-destructive"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              e.preventDefault();
              onChange([...value, input.trim()]);
              setInput("");
            }
          }}
          className="flex-1 min-w-[100px] bg-transparent text-xs outline-none"
        />
      </div>
    </div>
  );
}

// ============= Clinical Sections (compact) =============

function ClinicalSections({ patientId }: { patientId: string }) {
  const rec = useClinical(patientId);
  const [tab, setTab] = useState<"pharmacy" | "labs" | "visits">("pharmacy");

  const update = (patch: Partial<typeof rec>) => {
    setClinical(patientId, { ...getClinical(patientId), ...patch });
  };

  return (
    <div dir="rtl" className="space-y-2 pt-2 border-t border-border">
      <div className="flex items-center gap-1">
        <h3 className="text-xs font-bold text-emerald uppercase tracking-widest ml-auto">
          السجل الطبي الإلكتروني (EMR)
        </h3>
        {(["pharmacy", "visits", "labs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 text-[11px] rounded-lg font-bold ${
              tab === t
                ? "bg-emerald text-primary-foreground"
                : "bg-slate-800 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "pharmacy" ? "الصيدلية" : t === "visits" ? "الطبيب" : "المختبر"}
          </button>
        ))}
      </div>


      {tab === "pharmacy" && (
        <section className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/50 text-[10px] text-muted-foreground uppercase tracking-widest">
              <tr>
                <th className="px-3 py-2 text-right">المادة</th>
                <th className="px-3 py-2">أول شراء</th>
                <th className="px-3 py-2">آخر شراء</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rec.pharmacy.map((r, i) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 text-xs">{r.item}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{r.firstPurchase}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{r.lastPurchase}</td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => update({ pharmacy: rec.pharmacy.filter((_, j) => j !== i) })}
                      className="text-destructive text-xs"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {rec.pharmacy.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground text-xs">
                    لا توجد سجلات.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <AddRow
            fields={[
              { key: "item", ph: "اسم المادة" },
              { key: "firstPurchase", ph: "أول شراء", type: "date" },
              { key: "lastPurchase", ph: "آخر شراء", type: "date" },
            ]}
            onAdd={(v) =>
              update({
                pharmacy: [
                  ...rec.pharmacy,
                  { id: crypto.randomUUID(), ...(v as Omit<PharmacyEntry, "id">) },
                ],
              })
            }
          />
        </section>
      )}

      {tab === "labs" && (
        <section className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/50 text-[10px] text-muted-foreground uppercase tracking-widest">
              <tr>
                <th className="px-3 py-2 text-right">التحليل</th>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">النتيجة</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rec.labs
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((r, i) => {
                  const prev = rec.labs
                    .filter((x) => x.test === r.test && x.date < r.date)
                    .sort((a, b) => b.date.localeCompare(a.date))[0];
                  const trend = prev ? compareTrend(prev.value, r.value) : null;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-1.5 text-xs">{r.test}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px]">{r.date}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {r.value}
                        {trend && (
                          <span className={`ml-2 text-[10px] font-bold ${trend.color}`}>
                            {trend.arrow} vs {prev!.date} ({prev!.value})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => update({ labs: rec.labs.filter((_, j) => j !== i) })}
                          className="text-destructive text-xs"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              {rec.labs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground text-xs">
                    لا توجد نتائج.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <AddRow
            fields={[
              { key: "test", ph: "التحليل" },
              { key: "date", ph: "التاريخ", type: "date" },
              { key: "value", ph: "القيمة (مع الوحدة)" },
            ]}
            onAdd={(v) =>
              update({
                labs: [...rec.labs, { id: crypto.randomUUID(), ...(v as Omit<LabEntry, "id">) }],
              })
            }
          />
        </section>
      )}

      {tab === "visits" && (
        <section className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/50 text-[10px] text-muted-foreground uppercase tracking-widest">
              <tr>
                <th className="px-3 py-2 text-right">الطبيب</th>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">التشخيص</th>
                <th className="px-3 py-2">الأدوية</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rec.visits.map((r, i) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 text-xs">
                    <div className="font-medium">{r.doctor}</div>
                    {r.specialty && (
                      <div className="text-[10px] text-muted-foreground">{r.specialty}</div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{r.date}</td>
                  <td className="px-3 py-1.5 text-xs">{r.diagnosis}</td>
                  <td className="px-3 py-1.5 text-[11px]">{r.prescribed.join("، ")}</td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => update({ visits: rec.visits.filter((_, j) => j !== i) })}
                      className="text-destructive text-xs"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {rec.visits.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-center text-muted-foreground text-xs">
                    لا توجد زيارات.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <AddRow
            fields={[
              { key: "doctor", ph: "الطبيب" },
              { key: "specialty", ph: "التخصص" },
              { key: "date", ph: "التاريخ", type: "date" },
              { key: "diagnosis", ph: "التشخيص" },
              { key: "prescribed", ph: "الأدوية (بفاصلة)" },
            ]}
            onAdd={(v) => {
              const prescribed = String(v.prescribed || "")
                .split(/[،,]/)
                .map((s) => s.trim())
                .filter(Boolean);
              const entry: VisitEntry = {
                id: crypto.randomUUID(),
                doctor: String(v.doctor || ""),
                specialty: v.specialty ? String(v.specialty) : undefined,
                date: String(v.date || ""),
                diagnosis: String(v.diagnosis || ""),
                prescribed,
              };
              update({ visits: [...rec.visits, entry] });
            }}
          />
        </section>
      )}
    </div>
  );
}

function AddRow({
  fields,
  onAdd,
}: {
  fields: { key: string; ph: string; type?: string }[];
  onAdd: (v: Record<string, string>) => void;
}) {
  const [v, setV] = useState<Record<string, string>>({});
  return (
    <div className="p-2 flex gap-1.5 flex-wrap bg-slate-950/30 border-t border-border">
      {fields.map((f) => (
        <input
          key={f.key}
          type={f.type ?? "text"}
          value={v[f.key] ?? ""}
          onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))}
          placeholder={f.ph}
          className="flex-1 min-w-[110px] bg-slate-800 border border-border rounded-lg px-2 py-1 text-[11px] outline-none focus:ring-2 focus:ring-emerald/40"
        />
      ))}
      <button
        onClick={() => {
          if (Object.values(v).some((x) => x?.trim())) {
            onAdd(v);
            setV({});
          }
        }}
        className="px-3 py-1 bg-emerald text-primary-foreground rounded-lg text-[11px] font-bold hover:brightness-110"
      >
        + إضافة
      </button>
    </div>
  );
}

function compareTrend(prev: string, cur: string): { arrow: string; color: string } | null {
  const p = parseFloat(prev);
  const c = parseFloat(cur);
  if (Number.isNaN(p) || Number.isNaN(c)) return null;
  if (c < p) return { arrow: "▼", color: "text-emerald" };
  if (c > p) return { arrow: "▲", color: "text-destructive" };
  return { arrow: "▬", color: "text-muted-foreground" };
}
