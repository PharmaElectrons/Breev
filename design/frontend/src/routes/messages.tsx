import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { listMedicines, listPatients, type Medicine, type PatientRow } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import {
  listReservations,
  saveReservations,
  useReservations,
  type Reservation,
} from "@/lib/patient-extras";

import { toast } from "sonner";
import { Package, PackageX, Moon, Hourglass, Stethoscope, Sparkles, Send, CalendarClock, BellRing } from "lucide-react";


export const Route = createFileRoute("/messages")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "إرسال رسالة — Breef Pharmacy" },
      { name: "description", content: "مركز CRM الذكي: قوالب رسائل جاهزة، إرسال فوري أو مجدول عبر واتساب وتليجرام." },
    ],
  }),
  component: MessagesPage,
});

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return "964" + digits.slice(1);
  return digits;
}

const waLink = (phone: string, text: string) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
const tgLink = (phone: string, text: string) =>
  `https://t.me/share/url?url=${encodeURIComponent("Breef Pharmacy")}&text=${encodeURIComponent(text + "\n\n" + phone)}`;

type FrameKey = "stock" | "unavailable" | "refill" | "greeting" | "checkin";

function buildTemplate(
  key: FrameKey,
  patient: PatientRow | null,
  meds: string[],
): string {
  const name = patient?.full_name ?? "عزيزي العميل";
  const phone = patient?.phone ?? "—";
  const medList = meds.length ? meds.join("، ") : (patient?.chronic_meds?.[0] ?? "دوائك");
  switch (key) {
    case "stock":
      return `عزيزي/عزيزتي ${name} 🌿\nنودّ إعلامك بأن العلاج (${medList}) الذي طلبته أصبح متوفراً الآن في صيدلية Breef وجاهز للاستلام.\nنرحّب بزيارتك في أي وقت.\n— هاتف: ${phone}`;
    case "unavailable":
      return `عزيزي/عزيزتي ${name} 🌿\nنأسف لإعلامك بأن العلاج (${medList}) غير متوفر حالياً في صيدلية Breef.\nنعدك بالإخطار فور توفره، ونقدّر تفهمك وثقتك بنا.\n— هاتف: ${phone}`;
    case "greeting":
      return `عزيزي/عزيزتي ${name} ✨\nجمعة مباركة وأوقاتاً سعيدة من عائلة صيدلية Breef.\nصحتك أمانة… نحن دائماً بجانبك.`;
    case "refill":
      return `تذكير ودّي 🌿\nعزيزي/عزيزتي ${name}، اقترب موعد نفاد جرعتك من (${medList}) خلال الأيام القادمة حسب جدولة الاستهلاك.\nيسرّنا تجهيز الطلب مسبقاً — صيدلية Breef.`;
    case "checkin":
      return `عزيزي/عزيزتي ${name} 🩺\nنطمئن على حالتك الصحية بعد بدء علاج (${medList}).\nهل تشعر بأي تحسّن أو أعراض جانبية؟ فريق صيدلية Breef بخدمتك في أي وقت.`;
  }
}

const AI_TONES = [
  { key: "empathetic", label: "تعاطفي", prefix: "برسالة دافئة ومتعاطفة: " },
  { key: "professional", label: "احترافي", prefix: "بأسلوب طبي احترافي: " },
  { key: "promotional", label: "ترويجي", prefix: "بلمسة ترويجية لطيفة: " },
] as const;

function aiRewrite(text: string, tone: (typeof AI_TONES)[number]["key"]): string {
  // Local heuristic "AI" polish — deterministic, no network.
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const t = AI_TONES.find((x) => x.key === tone)!;
  const emoji = tone === "empathetic" ? "💚" : tone === "professional" ? "🩺" : "🎁";
  return `${emoji} ${t.prefix}\n${trimmed}\n\nمع تحيات فريق صيدلية Breef — نهتمّ بك ${emoji}`;
}

function MessagesPage() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<PatientRow | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedMeds, setSelectedMeds] = useState<Record<string, string[]>>({});
  const [schedule, setSchedule] = useState<Record<string, string>>({});
  const [tone, setTone] = useState<(typeof AI_TONES)[number]["key"]>("empathetic");
  const [activeFrame, setActiveFrame] = useState<FrameKey | null>(null);
  const reservations = useReservations();

  useEffect(() => {
    Promise.all([listPatients(), listMedicines()]).then(([p, m]) => {
      setPatients(p);
      setMeds(m);
      setLoading(false);
    });
  }, []);

  // Consume URL params (?to=phone&text=body) from birthday/greeting shortcuts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const text = params.get("text");
    const to = params.get("to");
    if (text) setMessage(text);
    if (to && patients.length) {
      const digits = to.replace(/\D/g, "");
      const found = patients.find((p) => (p.phone ?? "").replace(/\D/g, "") === digits);
      if (found) setSelected(found);
    }
  }, [patients]);

  // Auto-flip pending reservations to "arrived" when stock becomes available.
  useEffect(() => {
    if (meds.length === 0) return;
    const current = listReservations();
    let changed = false;
    const updated = current.map((r) => {
      if (r.status !== "pending") return r;
      const m = meds.find((x) => x.id === r.medicineId);
      if (m && m.quantity_in_stock >= r.qty) {
        changed = true;
        return { ...r, status: "arrived" as const };
      }
      return r;
    });
    if (changed) saveReservations(updated);
  }, [meds]);

  // Group reservations by patient — patients with active bookings bubble to top.
  const patientResMap = useMemo(() => {
    const m = new Map<string, Reservation[]>();
    for (const r of reservations) {
      const list = m.get(r.patientId) ?? [];
      list.push(r);
      m.set(r.patientId, list);
    }
    return m;
  }, [reservations]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s
      ? patients.filter(
          (p) => p.full_name.toLowerCase().includes(s) || (p.phone ?? "").includes(s),
        )
      : patients;
    // Reserved patients first, sorted by newest reservation date.
    return [...base].sort((a, b) => {
      const ra = patientResMap.get(a.id);
      const rb = patientResMap.get(b.id);
      if (!!ra !== !!rb) return ra ? -1 : 1;
      if (ra && rb) {
        const newestA = ra.reduce((x, r) => (r.createdAt > x ? r.createdAt : x), "");
        const newestB = rb.reduce((x, r) => (r.createdAt > x ? r.createdAt : x), "");
        return newestB.localeCompare(newestA);
      }
      return a.full_name.localeCompare(b.full_name, "ar");
    });
  }, [patients, q, patientResMap]);


  const medsForSelected = (p: PatientRow): string[] =>
    selectedMeds[p.id] ?? p.chronic_meds ?? [];

  const applyFrame = (key: FrameKey) => {
    if (!selected) {
      toast.error("اختر مريضاً أولاً من الجدول أو القائمة");
      return;
    }
    setActiveFrame(key);
    setMessage(buildTemplate(key, selected, medsForSelected(selected)));
  };

  const runAi = () => {
    if (!message.trim()) return toast.error("اكتب أو اختر قالباً أولاً");
    setMessage(aiRewrite(message, tone));
    toast.success("تمت الصياغة بالذكاء الاصطناعي");
  };

  const send = (patient: PatientRow, channel: "wa" | "tg", body?: string) => {
    const text = (body ?? message).trim();
    if (!text) return toast.error("اكتب الرسالة أولاً");
    const phone = normalizePhone(patient.phone);
    if (!phone) return toast.error("لا يوجد رقم هاتف لهذا المريض");
    const url = channel === "wa" ? waLink(phone, text) : tgLink(phone, text);
    window.open(url, "_blank", "noopener,noreferrer");
    void supabase
      .from("message_log")
      .insert({ patient_id: patient.id, phone, channel, body: text })
      .then((res: { error: { message: string } | null }) => {
        if (res.error) console.error("[messages] log failed", res.error);
      });
  };



  const schedSend = (p: PatientRow) => {
    const when = schedule[p.id];
    if (!when) return toast.error("اختر تاريخاً ووقتاً للجدولة");
    const at = new Date(when);
    if (isNaN(at.getTime())) return toast.error("تاريخ غير صالح");
    const delay = at.getTime() - Date.now();
    if (delay <= 0) return toast.error("اختر وقتاً في المستقبل");
    toast.success(`تمت جدولة الرسالة إلى ${p.full_name} في ${at.toLocaleString("ar")}`);
    // Local timer — persists only during this session.
    setTimeout(() => {
      try { send(p, "wa"); } catch { /* ignore */ }
    }, Math.min(delay, 2_147_000_000));
  };

  const toggleMed = (pid: string, med: string) => {
    setSelectedMeds((prev) => {
      const cur = prev[pid] ?? patients.find((p) => p.id === pid)?.chronic_meds ?? [];
      const next = cur.includes(med) ? cur.filter((m) => m !== med) : [...cur, med];
      return { ...prev, [pid]: next };
    });
  };

  const toggleAllMeds = (p: PatientRow) => {
    setSelectedMeds((prev) => {
      const cur = prev[p.id] ?? p.chronic_meds ?? [];
      const all = p.chronic_meds ?? [];
      return { ...prev, [p.id]: cur.length === all.length ? [] : [...all] };
    });
  };

  const frames: Array<{ key: FrameKey; icon: React.ReactNode; label: string; sub: string; color: string }> = [
    { key: "stock", icon: <Package className="w-5 h-5" />, label: "توفر العلاج", sub: "Available", color: "emerald" },
    { key: "refill", icon: <Hourglass className="w-5 h-5" />, label: "جدولة الاستهلاك", sub: "Refill", color: "sky" },
    { key: "unavailable", icon: <PackageX className="w-5 h-5" />, label: "لم يتوفر العلاج", sub: "Unavailable", color: "amber" },
    { key: "greeting", icon: <Moon className="w-5 h-5" />, label: "ترحيب / معايدة", sub: "Greeting", color: "amber" },
    { key: "checkin", icon: <Stethoscope className="w-5 h-5" />, label: "استفسار صحي", sub: "Check-in", color: "rose" },
  ];

  return (
    <AppShell title="إرسال رسالة">
      <div className="flex-1 flex overflow-hidden" dir="rtl">
        {/* Patients quick list */}
        <aside className="w-64 border-l border-border bg-slate-950/40 flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث عن مريض..."
              className="w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40"
            />
          </div>
          <div className="flex-1 overflow-auto divide-y divide-border/50">
            {loading && <p className="p-4 text-xs text-muted-foreground text-center">جاري التحميل...</p>}
            {filtered.map((p) => {
              const res = patientResMap.get(p.id) ?? [];
              const arrived = res.filter((r) => r.status === "arrived");
              const pending = res.filter((r) => r.status === "pending");
              const isActive = selected?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-2 transition ${
                    isActive ? "bg-emerald/10 border-r-2 border-emerald" : "hover:bg-emerald/5"
                  } ${arrived.length > 0 ? "bg-emerald/5" : ""}`}
                >
                  <button
                    onClick={() => setSelected(p)}
                    className="w-full text-right"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-sm font-bold truncate flex-1">{p.full_name}</p>
                      {arrived.length > 0 && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-emerald text-primary-foreground shrink-0 animate-pulse flex items-center gap-0.5"
                          title="علاج محجوز وصل"
                        >
                          <BellRing className="w-2.5 h-2.5" /> وصل
                        </span>
                      )}
                      {arrived.length === 0 && pending.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-amber-500/25 text-amber-400 shrink-0">
                          ⏳ {pending.length}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{p.phone ?? "—"}</p>
                  </button>
                  {res.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {res.map((r) => {
                        const med = meds.find((m) => m.id === r.medicineId);
                        const stock = med?.quantity_in_stock ?? 0;
                        const available = stock > 0;
                        return (
                          <div
                            key={r.id}
                            className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] ${
                              available
                                ? "bg-emerald/10 border-emerald/30"
                                : "bg-slate-900/60 border-border"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-bold text-[10px] leading-tight">{r.medicineName}</p>
                              <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground">
                                <span title="تاريخ الحجز">📅 {new Date(r.createdAt).toLocaleDateString("ar-EG")}</span>
                                <span
                                  className={available ? "text-emerald font-bold" : "text-amber-400"}
                                  title="رصيد المادة"
                                >
                                  رصيد: {stock}
                                </span>
                              </div>
                            </div>
                            {available && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelected(p);
                                  const body = `عزيزنا/عزيزتنا ${r.patientName}، الدواء المحجوز "${r.medicineName}" أصبح متوفراً الآن في صيدلية Breef وجاهز للاستلام.`;
                                  send(p, "wa", body);
                                }}
                                title="إرسال رسالة وصل العلاج"
                                className="shrink-0 w-6 h-6 rounded grid place-items-center bg-[#25D366] text-white hover:brightness-110 animate-pulse"
                              >
                                <Send className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        </aside>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Frames row */}
          <section className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold">فريمات جاهزة / Quick Templates</h3>
                <p className="text-[11px] text-muted-foreground">
                  {selected ? (
                    <>مريض نشط: <span className="text-emerald font-bold">{selected.full_name}</span></>
                  ) : (
                    <span className="text-amber-400">اختر مريضاً لتفعيل حقن البيانات التلقائي</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as typeof tone)}
                  className="bg-slate-800 border border-border rounded-lg px-2 py-1.5 text-xs outline-none"
                >
                  {AI_TONES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
                <button
                  onClick={runAi}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-l from-purple-500/20 to-emerald/20 border border-purple-400/30 text-xs font-bold hover:brightness-125"
                >
                  <Sparkles className="w-4 h-4 text-purple-300" />
                  صياغة بالذكاء الاصطناعي
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {frames.map((f) => {
                const active = activeFrame === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => applyFrame(f.key)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition text-center ${
                      active
                        ? "border-emerald bg-emerald/15 shadow-lg shadow-emerald/10"
                        : "border-border bg-slate-800/50 hover:bg-slate-800 hover:border-emerald/40"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${f.color}-500/15 text-${f.color}-300`}>
                      {f.icon}
                    </div>
                    <div>
                      <p className="text-xs font-bold">{f.label}</p>
                      <p className="text-[10px] text-muted-foreground">{f.sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Message workspace */}
          <section className="bg-card border border-border rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold">كتابة نص / Message Content</h2>
                <p className="text-[11px] text-muted-foreground">
                  المتغيرات تُحقن تلقائياً: {"{اسم المريض}"} • {"{رقم الهاتف}"} • {"{اسم العلاج}"}
                </p>
              </div>
              {selected && (
                <div className="flex gap-2 text-[10px] font-mono">
                  <span className="px-2 py-1 rounded bg-emerald/10 text-emerald">{selected.full_name}</span>
                  <span className="px-2 py-1 rounded bg-sky-500/10 text-sky-300">{selected.phone ?? "—"}</span>
                </div>
              )}
            </div>
            <textarea
              rows={8}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="اختر فريماً جاهزاً من الأعلى، أو اكتب رسالتك هنا..."
              className="w-full bg-slate-950/60 border border-border rounded-xl px-4 py-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-emerald/40 font-medium"
            />
            <div className="flex gap-2">
              <button
                onClick={() => selected && send(selected, "wa")}
                disabled={!selected}
                className="flex-1 h-11 rounded-lg bg-[#25D366] text-white font-bold text-sm hover:brightness-110 disabled:opacity-40"
              >
                📱 إرسال عبر واتساب
              </button>
              <button
                onClick={() => selected && send(selected, "tg")}
                disabled={!selected}
                className="flex-1 h-11 rounded-lg bg-[#229ED9] text-white font-bold text-sm hover:brightness-110 disabled:opacity-40"
              >
                ✈️ إرسال عبر تليجرام
              </button>
              <button
                onClick={() => setMessage("")}
                className="px-4 h-11 rounded-lg border border-border bg-slate-800 text-xs font-bold hover:bg-slate-700"
              >
                مسح
              </button>
            </div>
          </section>

          {/* Grid */}
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-sm font-bold">جدول بيانات وإرسال الرسائل / Patient Messaging Grid</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                فعّل الأدوية المزمنة المراد ذكرها، ثم أرسل فوراً أو جدوّل الرسالة.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-900/60 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-bold">اسم المريض</th>
                    <th className="px-4 py-2 font-bold">الوصفة المزمنة</th>
                    <th className="px-4 py-2 font-bold">رسالة مجدولة</th>
                    <th className="px-4 py-2 font-bold text-left">إجراء الإرسال</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {patients.map((p) => {
                    const meds = p.chronic_meds ?? [];
                    const active = medsForSelected(p);
                    const phone = normalizePhone(p.phone);
                    const isCurrent = selected?.id === p.id;
                    return (
                      <tr
                        key={p.id}
                        className={`hover:bg-slate-800/40 transition ${isCurrent ? "bg-emerald/5" : ""}`}
                      >
                        <td className="px-4 py-3 align-top">
                          <button
                            onClick={() => setSelected(p)}
                            className="text-right"
                          >
                            <p className="font-bold text-sm">{p.full_name}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{p.phone ?? "—"}</p>
                          </button>
                        </td>
                        <td className="px-4 py-3 align-top max-w-md">
                          {meds.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground">— لا يوجد —</span>
                          ) : (
                            <div className="space-y-1.5">
                              <label className="flex items-center gap-1.5 text-[10px] text-emerald cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={active.length === meds.length}
                                  onChange={() => toggleAllMeds(p)}
                                  className="accent-emerald"
                                />
                                تحديد الكل
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {meds.map((m) => {
                                  const on = active.includes(m);
                                  return (
                                    <label
                                      key={m}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] cursor-pointer transition ${
                                        on
                                          ? "border-emerald bg-emerald/15 text-emerald"
                                          : "border-border bg-slate-800/60 text-muted-foreground"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() => toggleMed(p.id, m)}
                                        className="accent-emerald w-3 h-3"
                                      />
                                      {m}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <input
                            type="datetime-local"
                            value={schedule[p.id] ?? ""}
                            onChange={(e) => setSchedule((s) => ({ ...s, [p.id]: e.target.value }))}
                            className="bg-slate-800 border border-border rounded-lg px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald/40"
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex justify-end gap-1.5 flex-wrap">
                            <button
                              onClick={() => {
                                setSelected(p);
                                const body = message.trim()
                                  ? message
                                  : buildTemplate("refill", p, active);
                                if (phone) send(p, "wa", body);
                                else toast.error("لا يوجد رقم هاتف");
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 bg-[#25D366] text-white text-[11px] font-bold rounded-lg hover:brightness-110"
                            >
                              <Send className="w-3 h-3" />
                              إرسال الآن
                            </button>
                            <button
                              onClick={() => schedSend(p)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-sky-600 text-white text-[11px] font-bold rounded-lg hover:brightness-110"
                            >
                              <CalendarClock className="w-3 h-3" />
                              جدولة
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {patients.length === 0 && !loading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-xs text-muted-foreground">
                        لا يوجد مرضى مسجلون بعد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Medication Reservations */}
          <ReservationsSection
            selected={selected}
            meds={meds}
            reservations={reservations}
          />

        </div>
      </div>
    </AppShell>
  );
}

// ============= Reservations Section =============

function ReservationsSection({
  selected,
  meds,
  reservations,
}: {
  selected: PatientRow | null;
  meds: Medicine[];
  reservations: Reservation[];
}) {
  const [medQ, setMedQ] = useState("");
  const [selMed, setSelMed] = useState<Medicine | null>(null);
  const [qty, setQty] = useState(1);

  const matches = useMemo(() => {
    const s = medQ.trim().toLowerCase();
    if (!s) return [];
    return meds
      .filter((m) => m.trade_name.toLowerCase().includes(s) || (m.barcode ?? "").includes(s))
      .slice(0, 6);
  }, [medQ, meds]);

  const add = () => {
    if (!selected) {
      toast.error("اختر مريضاً أولاً");
      return;
    }
    if (!selMed || qty <= 0) return;
    const stock = selMed.quantity_in_stock;
    const status: Reservation["status"] = stock >= qty ? "arrived" : "pending";
    const r: Reservation = {
      id: crypto.randomUUID(),
      patientId: selected.id,
      patientName: selected.full_name,
      patientPhone: selected.phone,
      medicineId: selMed.id,
      medicineName: selMed.trade_name,
      qty,
      status,
      createdAt: new Date().toISOString(),
    };
    saveReservations([...listReservations(), r]);
    setSelMed(null);
    setMedQ("");
    setQty(1);
    toast.success("تم الحجز");
  };

  const remove = (id: string) => {
    saveReservations(listReservations().filter((r) => r.id !== id));
  };

  const setStatus = (id: string, status: Reservation["status"]) => {
    saveReservations(listReservations().map((r) => (r.id === id ? { ...r, status } : r)));
  };

  const buildMsg = (r: Reservation) =>
    `عزيزنا/عزيزتنا ${r.patientName}، الدواء المحجوز "${r.medicineName}" أصبح متوفراً في صيدلية Breef. تم حجزه لكم.`;
  const waLink = (r: Reservation) => {
    const phone = (r.patientPhone ?? "").replace(/\D/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(buildMsg(r))}`;
  };
  const tgLink = (r: Reservation) =>
    `https://t.me/share/url?url=&text=${encodeURIComponent(buildMsg(r))}`;

  const rows = [...reservations].sort((a, b) => {
    if (a.status !== b.status) return a.status === "arrived" ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const arrivedCount = reservations.filter((r) => r.status === "arrived").length;
  const pendingCount = reservations.filter((r) => r.status === "pending").length;

  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <BellRing className="w-4 h-4 text-emerald" />
            حجوزات الأدوية / Medication Reservations
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            عند توفر الدواء في المخزن، تتحول الحالة تلقائياً إلى "وصل" وتفعّل زر الإرسال الفوري.
          </p>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="px-2 py-1 rounded bg-emerald/15 text-emerald font-bold">
            وصل: {arrivedCount}
          </span>
          <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-400 font-bold">
            قيد الانتظار: {pendingCount}
          </span>
        </div>
      </div>

      <div className="p-3 flex gap-2 items-start flex-wrap border-b border-border bg-slate-950/30">
        <div className="text-[11px] text-muted-foreground py-1.5">
          للمريض:{" "}
          <span className="text-emerald font-bold">
            {selected?.full_name ?? "— اختر من القائمة —"}
          </span>
        </div>
        <div className="relative flex-1 min-w-[220px]">
          <input
            value={selMed ? selMed.trade_name : medQ}
            onChange={(e) => {
              setSelMed(null);
              setMedQ(e.target.value);
            }}
            placeholder="ابحث عن مادة..."
            className="w-full bg-slate-800 border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald/40"
          />
          {!selMed && matches.length > 0 && (
            <div className="absolute z-10 top-full mt-1 w-full max-h-52 overflow-auto rounded-lg border border-border bg-slate-950 shadow-lg">
              {matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelMed(m);
                    setMedQ("");
                  }}
                  className="w-full text-right px-3 py-1.5 hover:bg-emerald/10 text-xs"
                >
                  <span className="font-bold">{m.trade_name}</span>{" "}
                  <span className="text-[10px] text-muted-foreground">
                    · مخزون: {m.quantity_in_stock}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="number"
          value={qty}
          min={1}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          className="w-20 bg-slate-800 border border-border rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald/40"
        />
        <button
          onClick={add}
          disabled={!selMed || !selected}
          className="px-3 py-1.5 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-40"
        >
          + حجز
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-900/60 text-[10px] text-muted-foreground uppercase tracking-widest">
            <tr>
              <th className="px-3 py-2 text-right">المريض</th>
              <th className="px-3 py-2">المادة</th>
              <th className="px-3 py-2">الكمية</th>
              <th className="px-3 py-2">تاريخ الحجز</th>
              <th className="px-3 py-2">الحالة</th>
              <th className="px-3 py-2">إرسال رسالة</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map((r) => {
              const arrived = r.status === "arrived";
              return (
                <tr key={r.id} className={arrived ? "bg-emerald/5" : ""}>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-bold">{r.patientName}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {r.patientPhone ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.medicineName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.qty}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("ar-EG")}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setStatus(r.id, arrived ? "pending" : "arrived")}
                      className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                        arrived
                          ? "bg-emerald/20 text-emerald"
                          : "bg-amber-500/20 text-amber-500"
                      }`}
                    >
                      {arrived ? "وصل" : "قيد الانتظار"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <a
                        href={waLink(r)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="واتساب"
                        className={`w-7 h-7 rounded grid place-items-center text-xs ${
                          arrived
                            ? "bg-[#25D366] text-white animate-pulse hover:brightness-110"
                            : "bg-slate-800 text-muted-foreground pointer-events-none opacity-40"
                        }`}
                      >
                        ✉
                      </a>
                      <a
                        href={tgLink(r)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="تليجرام"
                        className={`w-7 h-7 rounded grid place-items-center text-xs ${
                          arrived
                            ? "bg-sky-500 text-white hover:brightness-110"
                            : "bg-slate-800 text-muted-foreground pointer-events-none opacity-40"
                        }`}
                      >
                        ➤
                      </a>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => remove(r.id)}
                      className="text-destructive text-xs"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  لا توجد حجوزات حالياً.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
