// "تواجد" (Tawajud) — inter-pharmacy shift coverage marketplace, pharmacist
// professional profiles, and staff performance rating ecosystem.
// Presentation-layer module: ratings / profiles / shift posts persist locally
// (localStorage) so the workspace is fully usable without schema changes.
import { useEffect, useMemo, useState } from "react";
import {
  Star,
  Award,
  BadgeCheck,
  CalendarClock,
  ClipboardList,
  FileText,
  GraduationCap,
  IdCard,
  MapPin,
  MessageSquare,
  Phone,
  Mail,
  Plus,
  Send,
  Sparkles,
  Timer,
  Users,
  Building2,
  Handshake,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

// ---- Types -------------------------------------------------------------
type KpiKey =
  | "punctuality"
  | "prescription"
  | "dispensing"
  | "clinical"
  | "communication"
  | "sales";

const KPIS: { key: KpiKey; label: string; hint: string; ai?: boolean }[] = [
  { key: "punctuality", label: "الالتزام بالوقت", hint: "مرتبط بأوقات الحضور والانصراف" },
  { key: "prescription", label: "قراءة الوصفات والراجيتات", hint: "دقة قراءة الوصفة الطبية" },
  { key: "dispensing", label: "دقة الصرف وعدم الخطأ", hint: "نسبة الصرف الصحيح" },
  { key: "clinical", label: "المستوى العلمي والاستشارة", hint: "الكفاءة العلمية والدوائية" },
  { key: "communication", label: "التواصل وحسن التعامل", hint: "مؤشر مقترح من بريف AI", ai: true },
  { key: "sales", label: "الإنتاجية والمبيعات", hint: "مؤشر مقترح من بريف AI", ai: true },
];

type Scorecard = {
  scores: Record<KpiKey, number>;
  recommendation: string;
};

type PharmacistProfile = {
  syndicateId: string;
  syndicateYear: string;
  university: string;
  gradYear: string;
  grade: string;
  residence: string;
  phone: string;
  email: string;
  startDate: string;
  endDate: string;
  docCertificate: string;
  docSyndicate: string;
};

type ShiftPost = {
  id: string;
  branch: string;
  from: string;
  to: string;
  days: string[];
  hourlyRate: number;
  createdAt: string;
  applicants: Applicant[];
};

type Applicant = {
  id: string;
  name: string;
  rating: number;
  hourlyRate: number;
  responseRate: number;
  responseHours: number;
  aiMatch: number;
  status: "applied" | "shortlisted";
};

type Person = { id: string; name: string; phone: string; dailyHours: number };

const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

const EMPTY_SCORES: Record<KpiKey, number> = {
  punctuality: 0,
  prescription: 0,
  dispensing: 0,
  clinical: 0,
  communication: 0,
  sales: 0,
};

const EMPTY_PROFILE: PharmacistProfile = {
  syndicateId: "",
  syndicateYear: "",
  university: "",
  gradYear: "",
  grade: "",
  residence: "",
  phone: "",
  email: "",
  startDate: "",
  endDate: "",
  docCertificate: "",
  docSyndicate: "",
};

const PHARMACY = {
  name: "صيدلية بريف — الفرع الرئيسي",
  address: "بغداد — الكرادة، شارع 62",
  maps: "https://maps.google.com/?q=Baghdad+Karrada",
  phone: "+964 770 000 0000",
  email: "info@breef-pharmacy.com",
};

// ---- Local persistence -------------------------------------------------
function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

const seedApplicants = (): Applicant[] => [
  { id: "a1", name: "د. مريم عبد الرزاق", rating: 4.9, hourlyRate: 9000, responseRate: 98, responseHours: 1, aiMatch: 96, status: "applied" },
  { id: "a2", name: "د. حسين الجبوري", rating: 4.6, hourlyRate: 7500, responseRate: 91, responseHours: 3, aiMatch: 88, status: "applied" },
  { id: "a3", name: "د. زينب كريم", rating: 4.3, hourlyRate: 6500, responseRate: 84, responseHours: 6, aiMatch: 79, status: "applied" },
];

const seedPosts = (): ShiftPost[] => [
  {
    id: "p1",
    branch: "الفرع الرئيسي — الكرادة",
    from: "16:00",
    to: "23:00",
    days: ["السبت", "الأحد", "الاثنين"],
    hourlyRate: 8000,
    createdAt: new Date().toISOString().slice(0, 10),
    applicants: seedApplicants(),
  },
];



// ---- UI atoms ----------------------------------------------------------
function Stars({
  value,
  onChange,
  size = "size-4",
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: string;
}) {
  return (
    <div className="flex items-center gap-0.5" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={onChange ? "transition hover:scale-110" : "cursor-default"}
          aria-label={`${n} من 5`}
        >
          <Star
            className={`${size} ${
              n <= Math.round(value) ? "fill-emerald text-emerald" : "text-muted-foreground/40"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-muted-foreground mb-1">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded-md bg-slate-800 border border-border px-2 text-[11px] text-foreground outline-none focus:border-emerald"
      />
    </label>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
  aside,
}: {
  title: string;
  icon: typeof Star;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-slate-950/40 p-4">
      <header className="flex items-center justify-between gap-2 mb-3">
        <h3 className="flex items-center gap-2 text-xs font-bold text-emerald">
          <Icon className="size-4" />
          {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

// ---- Main --------------------------------------------------------------
export function TawajudWorkspace({ people }: { people: Person[] }) {
  const [view, setView] = useState<"rating" | "profile" | "market">("rating");
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!selected && people.length) setSelected(people[0].id);
  }, [people, selected]);

  const person = people.find((p) => p.id === selected) ?? null;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg border border-border w-fit">
          {[
            { k: "rating" as const, label: "التقييم والأداء", icon: Award },
            { k: "profile" as const, label: "الملف المهني للصيدلاني", icon: IdCard },
            { k: "market" as const, label: "سوق التواجد والطلبات", icon: Handshake },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setView(t.k)}
              className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold rounded-md transition ${
                view === t.k ? "bg-emerald text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {view !== "market" && (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-8 rounded-md bg-slate-800 border border-border px-2 text-[11px] font-bold text-foreground outline-none focus:border-emerald"
          >
            {people.length === 0 && <option value="">لا يوجد موظفون</option>}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {view === "rating" && <RatingModule person={person} />}
      {view === "profile" && <ProfileModule person={person} />}
      {view === "market" && <MarketModule />}
    </div>
  );
}

// ---- 1) Rating & performance -------------------------------------------
function RatingModule({ person }: { person: Person | null }) {
  const key = person ? `tawajud.score.${person.id}` : "";
  const [card, setCard] = useState<Scorecard>({ scores: EMPTY_SCORES, recommendation: "" });

  useEffect(() => {
    if (!key) return;
    setCard(loadLS<Scorecard>(key, { scores: EMPTY_SCORES, recommendation: "" }));
  }, [key]);

  const overall = useMemo(() => {
    const vals = KPIS.map((k) => card.scores[k.key] || 0).filter((v) => v > 0);
    if (!vals.length) return 0;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }, [card.scores]);

  function set(k: KpiKey, v: number) {
    const next = { ...card, scores: { ...card.scores, [k]: v } };
    setCard(next);
    if (key) saveLS(key, next);
  }

  if (!person) return <Empty text="اختر موظفاً لعرض بطاقة التقييم." />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Panel
          title={`بطاقة تقييم الأداء — ${person.name}`}
          icon={Award}
          aside={
            <div className="flex items-center gap-2">
              <Stars value={overall} />
              <span className="text-[11px] font-bold text-emerald">{overall || "—"} / 5</span>
            </div>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {KPIS.map((k) => (
              <div
                key={k.key}
                className="rounded-xl border border-border bg-slate-900/60 px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-foreground truncate flex items-center gap-1">
                    {k.label}
                    {k.ai && (
                      <span className="inline-flex items-center gap-0.5 px-1 rounded bg-emerald/10 border border-emerald/30 text-[9px] text-emerald">
                        <Sparkles className="size-2.5" /> AI
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{k.hint}</p>
                </div>
                <Stars value={card.scores[k.key] || 0} onChange={(v) => set(k.key, v)} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="توصية الصيدلية والملاحظات السريرية" icon={MessageSquare}>
          <textarea
            value={card.recommendation}
            onChange={(e) => {
              const next = { ...card, recommendation: e.target.value };
              setCard(next);
              if (key) saveLS(key, next);
            }}
            rows={5}
            placeholder="اكتب توصية رسمية للصيدلاني: الالتزام، الكفاءة العلمية، التعامل مع المرضى…"
            className="w-full rounded-xl bg-slate-800 border border-border p-3 text-[11px] leading-relaxed text-foreground outline-none focus:border-emerald"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={() => {
                if (key) saveLS(key, card);
                toast.success("تم حفظ التوصية والتقييم");
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald text-primary-foreground text-[11px] font-bold hover:bg-emerald-dim"
            >
              <Send className="size-3.5" /> إصدار التوصية
            </button>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="مؤشرات الوقت" icon={Timer}>
          <Stat label="معدل ساعات العمل باليوم" value={`${person.dailyHours.toFixed(2)} ساعة`} />
          <Stat label="التقييم العام" value={`${overall || "—"} / 5`} />
          <Stat
            label="الالتزام بالوقت"
            value={`${card.scores.punctuality ? card.scores.punctuality * 20 : 0}%`}
          />
        </Panel>
        <Panel title="بطاقة الصيدلية" icon={Building2}>
          <PharmacyCard />
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-slate-900/60 px-3 py-2 mb-2 last:mb-0">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-bold text-foreground">{value}</span>
    </div>
  );
}

function PharmacyCard() {
  return (
    <a
      href={PHARMACY.maps}
      target="_blank"
      rel="noreferrer"
      className="block rounded-xl border border-border bg-slate-900/60 p-3 hover:border-emerald/50 transition"
    >
      <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
        <BadgeCheck className="size-3.5 text-emerald" /> {PHARMACY.name}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
        <MapPin className="size-3" /> {PHARMACY.address}
      </p>
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Phone className="size-3" /> {PHARMACY.phone}
      </p>
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Mail className="size-3" /> {PHARMACY.email}
      </p>
    </a>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-slate-950/40 p-8 text-center text-[11px] text-muted-foreground">
      {text}
    </div>
  );
}

// ---- 2) Pharmacist professional profile --------------------------------
function ProfileModule({ person }: { person: Person | null }) {
  const key = person ? `tawajud.profile.${person.id}` : "";
  const [p, setP] = useState<PharmacistProfile>(EMPTY_PROFILE);

  useEffect(() => {
    if (!key) return;
    setP(loadLS<PharmacistProfile>(key, { ...EMPTY_PROFILE }));
  }, [key]);

  function upd(patch: Partial<PharmacistProfile>) {
    const next = { ...p, ...patch };
    setP(next);
    if (key) saveLS(key, next);
  }

  function pickFile(field: "docCertificate" | "docSyndicate", file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => upd({ [field]: String(reader.result) } as Partial<PharmacistProfile>);
    reader.readAsDataURL(file);
  }

  if (!person) return <Empty text="اختر موظفاً لعرض ملفه المهني." />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Panel title={`الهوية والبيانات الأكاديمية — ${person.name}`} icon={GraduationCap}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="رقم هوية النقابة" value={p.syndicateId} onChange={(v) => upd({ syndicateId: v })} />
            <Field label="سنة الانتماء للنقابة" value={p.syndicateYear} onChange={(v) => upd({ syndicateYear: v })} />
            <Field label="الجامعة" value={p.university} onChange={(v) => upd({ university: v })} />
            <Field label="سنة التخرج" value={p.gradYear} onChange={(v) => upd({ gradYear: v })} />
            <Field label="التقدير" value={p.grade} onChange={(v) => upd({ grade: v })} />
            <Field label="محل السكن" value={p.residence} onChange={(v) => upd({ residence: v })} />
            <Field label="رقم الهاتف" value={p.phone || person.phone} onChange={(v) => upd({ phone: v })} />
            <Field label="البريد الإلكتروني" value={p.email} onChange={(v) => upd({ email: v })} />
          </div>
        </Panel>

        <Panel title="المستندات الموثقة" icon={FileText}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(
              [
                { f: "docCertificate" as const, label: "تأييد التخرج" },
                { f: "docSyndicate" as const, label: "هوية النقابة" },
              ]
            ).map((d) => (
              <div key={d.f} className="rounded-xl border border-border bg-slate-900/60 p-3">
                <p className="text-[11px] font-bold text-foreground mb-2">{d.label}</p>
                {p[d.f] ? (
                  p[d.f].startsWith("data:application/pdf") ? (
                    <a
                      href={p[d.f]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-emerald underline"
                    >
                      عرض ملف PDF
                    </a>
                  ) : (
                    <img src={p[d.f]} alt={d.label} className="h-28 w-full object-contain rounded-lg bg-slate-800" />
                  )
                ) : (
                  <p className="text-[10px] text-muted-foreground h-28 grid place-items-center rounded-lg border border-dashed border-border">
                    لا يوجد مستند مرفوع
                  </p>
                )}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => pickFile(d.f, e.target.files?.[0])}
                  className="mt-2 w-full text-[10px] text-muted-foreground"
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="سجل العمل والمدة الوظيفية" icon={CalendarClock}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="تاريخ المباشرة" type="date" value={p.startDate} onChange={(v) => upd({ startDate: v })} />
            <Field label="تاريخ الانتهاء" type="date" value={p.endDate} onChange={(v) => upd({ endDate: v })} />
          </div>
          <div className="mt-3 rounded-xl border border-border bg-slate-900/60 p-3">
            <p className="text-[10px] font-bold text-muted-foreground mb-2">تقييمات الصيدليات الموثقة</p>
            <VerifiedReviews personId={person.id} />
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="بطاقة الصيدلية الحالية" icon={Building2}>
          <PharmacyCard />
        </Panel>
        <Panel title="ملخص الملف" icon={IdCard}>
          <Stat label="الاسم" value={person.name} />
          <Stat label="معدل الساعات باليوم" value={`${person.dailyHours.toFixed(2)}`} />
          <Stat label="هوية النقابة" value={p.syndicateId || "—"} />
        </Panel>
      </div>
    </div>
  );
}

function VerifiedReviews({ personId }: { personId: string }) {
  const card = loadLS<Scorecard>(`tawajud.score.${personId}`, {
    scores: EMPTY_SCORES,
    recommendation: "",
  });
  const vals = KPIS.map((k) => card.scores[k.key] || 0).filter((v) => v > 0);
  const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-foreground">{PHARMACY.name}</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {card.recommendation || "لم تُصدر توصية بعد."}
        </p>
      </div>
      <div className="shrink-0 text-left">
        <Stars value={avg} />
        <p className="text-[10px] text-emerald font-bold mt-1">{avg || "—"} / 5</p>
      </div>
    </div>
  );
}

// ---- 3) Tawajud marketplace --------------------------------------------
function MarketModule() {
  const [posts, setPosts] = useState<ShiftPost[]>([]);
  const [sort, setSort] = useState<"rating" | "rate" | "ai">("ai");
  const [form, setForm] = useState({ branch: "", from: "16:00", to: "23:00", hourlyRate: "8000", days: [] as string[] });

  useEffect(() => {
    setPosts(loadLS<ShiftPost[]>("tawajud.posts", seedPosts()));
  }, []);

  function persist(next: ShiftPost[]) {
    setPosts(next);
    saveLS("tawajud.posts", next);
  }

  function addPost() {
    if (!form.branch.trim()) {
      toast.error("حدد موقع/فرع الصيدلية");
      return;
    }
    const post: ShiftPost = {
      id: crypto.randomUUID(),
      branch: form.branch.trim(),
      from: form.from,
      to: form.to,
      days: form.days.length ? form.days : DAYS.slice(0, 3),
      hourlyRate: Number(form.hourlyRate) || 0,
      createdAt: new Date().toISOString().slice(0, 10),
      applicants: seedApplicants(),
    };
    persist([post, ...posts]);
    setForm({ ...form, branch: "" });
    toast.success("تم نشر طلب التواجد");
  }

  function shortlist(postId: string, appId: string) {
    persist(
      posts.map((p) =>
        p.id === postId
          ? {
              ...p,
              applicants: p.applicants.map((a) =>
                a.id === appId ? { ...a, status: a.status === "shortlisted" ? "applied" : "shortlisted" } : a,
              ),
            }
          : p,
      ),
    );
  }

  function sortApplicants(list: Applicant[]) {
    const arr = [...list];
    if (sort === "rating") arr.sort((a, b) => b.rating - a.rating);
    else if (sort === "rate") arr.sort((a, b) => a.hourlyRate - b.hourlyRate);
    else arr.sort((a, b) => b.aiMatch - a.aiMatch);
    return arr;
  }

  const interviews = posts.flatMap((p) =>
    p.applicants
      .filter((a) => a.status === "shortlisted")
      .map((a) => ({ id: `${p.id}-${a.id}`, pharmacy: p.branch, shift: `${p.from} — ${p.to}`, rate: p.hourlyRate, name: a.name })),
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <Panel title="نشر طلب تواجد جديد" icon={Plus}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="موقع / فرع الصيدلية" value={form.branch} onChange={(v) => setForm({ ...form, branch: v })} placeholder="بغداد — الكرادة" />
            <Field label="من الساعة" type="time" value={form.from} onChange={(v) => setForm({ ...form, from: v })} />
            <Field label="إلى الساعة" type="time" value={form.to} onChange={(v) => setForm({ ...form, to: v })} />
            <Field label="أجر الساعة (د.ع)" value={form.hourlyRate} onChange={(v) => setForm({ ...form, hourlyRate: v })} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {DAYS.map((d) => {
              const on = form.days.includes(d);
              return (
                <button
                  key={d}
                  onClick={() =>
                    setForm({ ...form, days: on ? form.days.filter((x) => x !== d) : [...form.days, d] })
                  }
                  className={`px-2 py-1 rounded-md text-[10px] font-bold border transition ${
                    on
                      ? "bg-emerald text-primary-foreground border-emerald"
                      : "bg-slate-800 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {d}
                </button>
              );
            })}
            <button
              onClick={addPost}
              className="ms-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald text-primary-foreground text-[11px] font-bold hover:bg-emerald-dim"
            >
              <Send className="size-3.5" /> نشر الطلب
            </button>
          </div>
        </Panel>

        <Panel
          title="طلبات التواجد والمتقدمون"
          icon={ClipboardList}
          aside={
            <div className="flex items-center gap-1.5">
              <Filter className="size-3.5 text-muted-foreground" />
              {[
                { k: "ai" as const, label: "اقتراحات بريف الذكية" },
                { k: "rating" as const, label: "التقييم الأقوى" },
                { k: "rate" as const, label: "الأقل سعراً" },
              ].map((o) => (
                <button
                  key={o.k}
                  onClick={() => setSort(o.k)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold border transition ${
                    sort === o.k
                      ? "bg-emerald text-primary-foreground border-emerald"
                      : "bg-slate-800 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="space-y-3">
            {posts.length === 0 && <Empty text="لا توجد طلبات تواجد منشورة." />}
            {posts.map((post) => (
              <div key={post.id} className="rounded-xl border border-border bg-slate-900/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-emerald" /> {post.branch}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {post.from} — {post.to} • {post.days.join(" / ")} • {post.hourlyRate.toLocaleString()} د.ع/ساعة
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-emerald/10 border border-emerald/30 text-[10px] font-bold text-emerald">
                    {post.applicants.length} متقدم
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-right p-1.5 font-bold">الصيدلاني</th>
                        <th className="p-1.5 font-bold">التقييم</th>
                        <th className="p-1.5 font-bold">السعر/ساعة</th>
                        <th className="p-1.5 font-bold">نسبة الرد</th>
                        <th className="p-1.5 font-bold">سرعة الرد</th>
                        <th className="p-1.5 font-bold">مطابقة AI</th>
                        <th className="p-1.5 font-bold">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortApplicants(post.applicants).map((a) => (
                        <tr key={a.id} className="border-b border-border/50 last:border-0">
                          <td className="p-1.5 text-right font-bold text-foreground">{a.name}</td>
                          <td className="p-1.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Stars value={a.rating} size="size-3" />
                              <span className="text-emerald font-bold">{a.rating}</span>
                            </div>
                          </td>
                          <td className="p-1.5 text-center text-foreground">{a.hourlyRate.toLocaleString()}</td>
                          <td className="p-1.5 text-center text-foreground">{a.responseRate}%</td>
                          <td className="p-1.5 text-center text-muted-foreground">{a.responseHours} س</td>
                          <td className="p-1.5 text-center">
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald/10 border border-emerald/30 text-emerald font-bold">
                              <Sparkles className="size-2.5" /> {a.aiMatch}%
                            </span>
                          </td>
                          <td className="p-1.5 text-center">
                            <button
                              onClick={() => shortlist(post.id, a.id)}
                              className={`px-2 py-0.5 rounded-md font-bold border transition ${
                                a.status === "shortlisted"
                                  ? "bg-emerald text-primary-foreground border-emerald"
                                  : "bg-slate-800 text-muted-foreground border-border hover:text-foreground"
                              }`}
                            >
                              {a.status === "shortlisted" ? "تمت الموافقة الأولية" : "موافقة أولية"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="طلبات المقابلة (للصيدلاني)" icon={Users}>
          {interviews.length === 0 ? (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              لا توجد صيدليات أبدت موافقة أولية بعد. اضغط «موافقة أولية» على أي متقدم لتظهر هنا.
            </p>
          ) : (
            <div className="space-y-2">
              {interviews.map((i) => (
                <div key={i.id} className="rounded-xl border border-emerald/40 bg-emerald/5 p-3">
                  <p className="text-[11px] font-bold text-foreground">{i.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Building2 className="size-3" /> {i.pharmacy}
                  </p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <CalendarClock className="size-3" /> {i.shift} • {i.rate.toLocaleString()} د.ع/ساعة
                  </p>
                  <p className="text-[10px] text-emerald font-bold mt-1">موافقة أولية — تطلب مقابلة</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="بطاقة الصيدلية" icon={Building2}>
          <PharmacyCard />
        </Panel>
      </div>
    </div>
  );
}
