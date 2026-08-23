import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessageCircle, Plus, Save, Trash2, Users, ShieldCheck, ListChecks, KeyRound, Handshake } from "lucide-react";
import { TawajudWorkspace } from "@/components/tawajud-workspace";

export const Route = createFileRoute("/employees")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الموظفين والأدوار — Breef Pharmacy" },
      { name: "description", content: "إدارة الموظفين، الرواتب، الأدوار، والصلاحيات." },
    ],
  }),
  component: EmployeesPage,
});

// ---- Types & constants -------------------------------------------------
type Employee = {
  id: string;
  name: string;
  phone: string;
  shift_hours: number;
  check_in: string;
  check_out: string;
  actual_worked: number;
  hourly_rate: number;
  salary: number;
  username: string;
  password: string;
  role_key: string;
  status: "active" | "terminated";
  permissions: string[];
};

type CustomRole = {
  id: string;
  key: string;
  label: string;
  permissions: string[];
  is_system: boolean;
};

// Every module/tab the RBAC matrix can gate. Keep in sync with app-shell nav.
const MODULES: { key: string; label: string }[] = [
  { key: "dashboard", label: "القائمة الرئيسية" },
  { key: "sales_invoice", label: "فاتورة بيع" },
  { key: "purchase_invoice", label: "فاتورة شراء" },
  { key: "cart", label: "سلة الطلبات" },
  { key: "inventory", label: "المخزن / الجرد" },
  { key: "health_profile", label: "ملف صحي" },
  { key: "messages", label: "الرسائل والحجوزات" },
  { key: "accounts", label: "الحسابات" },
  { key: "reports", label: "التقارير" },
  { key: "employees", label: "الموظفين والأدوار" },
  { key: "integration", label: "ربط خارجي" },
  { key: "settings", label: "الإعدادات" },
];

function reportErr(scope: string, e: unknown) {
  console.error(`[employees] ${scope}`, e);
  toast.error(`${scope}: ${e instanceof Error ? e.message : String(e)}`);
}

// Parse HH:MM strings and return hours worked (positive), handling overnight shifts.
function computeWorked(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const [ih, im] = checkIn.split(":").map((n) => parseInt(n, 10) || 0);
  const [oh, om] = checkOut.split(":").map((n) => parseInt(n, 10) || 0);
  let mins = oh * 60 + om - (ih * 60 + im);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

// ---- Page shell --------------------------------------------------------
type Tab = "employees" | "roles" | "overview" | "tawajud";

function EmployeesPage() {
  const [tab, setTab] = useState<Tab>("employees");

  return (
    <AppShell title="الموظفين والأدوار">
      <div className="flex-1 overflow-auto p-6" dir="rtl">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg border border-border w-fit">
            {[
              { k: "employees" as const, label: "إدارة الموظفين والرواتب", icon: Users },
              { k: "roles" as const, label: "الأدوار والصلاحيات", icon: ShieldCheck },
              { k: "overview" as const, label: "الموظفين والأدوار (نظرة سريعة)", icon: ListChecks },
              { k: "tawajud" as const, label: "تواجد", icon: Handshake },
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-md transition ${
                  tab === t.k ? "bg-emerald text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === "employees" ? (
            <EmployeesTab />
          ) : tab === "roles" ? (
            <RolesTab />
          ) : tab === "tawajud" ? (
            <TawajudTab />
          ) : (
            <OverviewTab />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** Loads staff from the DB and hands them to the Tawajud ecosystem. */
function TawajudTab() {
  const [people, setPeople] = useState<Array<{ id: string; name: string; phone: string; dailyHours: number }>>([]);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name, phone, actual_worked, shift_hours")
        .order("name", { ascending: true });
      if (error) return reportErr("تحميل الموظفين", error);
      setPeople(
        (data ?? []).map((e) => ({
          id: e.id as string,
          name: (e.name as string) ?? "",
          phone: (e.phone as string) ?? "",
          dailyHours: Number(e.actual_worked ?? 0) || Number(e.shift_hours ?? 0) || 0,
        })),
      );
    })();
  }, []);
  return <TawajudWorkspace people={people} />;
}

function OverviewTab() {
  const [rows, setRows] = useState<Array<{ id: string; name: string; role: string }>>([]);
  useEffect(() => {
    (async () => {
      const [empRes, roleRes] = await Promise.all([
        supabase.from("employees").select("id, name, role_key").order("name"),
        supabase.from("custom_roles").select("key, label"),
      ]);
      const roleMap = new Map<string, string>();
      for (const r of (roleRes.data ?? []) as Array<{ key: string; label: string }>) {
        roleMap.set(r.key, r.label);
      }
      setRows(
        ((empRes.data ?? []) as Array<{ id: string; name: string; role_key: string | null }>).map((e) => ({
          id: e.id,
          name: e.name,
          role: e.role_key ? (roleMap.get(e.role_key) ?? e.role_key) : "—",
        })),
      );
    })();
  }, []);
  return (
    <div className="bg-slate-900/60 border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-slate-800/60 flex items-center justify-between">
        <p className="text-xs font-bold text-emerald">قائمة الموظفين وأدوارهم</p>
        <span className="text-[10px] font-mono text-muted-foreground">{rows.length} موظف</span>
      </div>
      <table className="w-full text-xs text-right">
        <thead className="bg-slate-800/40 text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-bold w-16">#</th>
            <th className="px-4 py-2 font-bold">اسم الموظف</th>
            <th className="px-4 py-2 font-bold">دوره</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.length === 0 ? (
            <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">لا توجد بيانات</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-800/40">
              <td className="px-4 py-2 font-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-4 py-2">
                <span className="inline-block px-2 py-0.5 rounded-md bg-emerald/10 text-emerald border border-emerald/30 text-[11px] font-bold">
                  {r.role}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ---- Employees / Payroll tab ------------------------------------------
function EmployeesTab() {
  const [list, setList] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [editing, setEditing] = useState<(Employee & { __isNew?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [empRes, roleRes] = await Promise.all([
      supabase.from("employees").select("*").order("name", { ascending: true }),
      supabase.from("custom_roles").select("*").order("label"),
    ]);
    if (empRes.error) return reportErr("تحميل الموظفين", empRes.error);
    if (roleRes.error) return reportErr("تحميل الأدوار", roleRes.error);
    setList(
      (empRes.data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        phone: (r.phone as string | null) ?? "",
        shift_hours: Number(r.shift_hours ?? 8),
        check_in: (r.check_in as string | null) ?? "",
        check_out: (r.check_out as string | null) ?? "",
        actual_worked: Number(r.actual_worked ?? 0),
        hourly_rate: Number(r.hourly_rate ?? 0),
        salary: Number(r.salary ?? 0),
        username: (r.username as string | null) ?? "",
        password: (r.password as string | null) ?? "",
        role_key: (r.role_key as string | null) ?? "",
        status: ((r.status as string) ?? "active") as "active" | "terminated",
        permissions: ((r.permissions as string[] | null) ?? []) as string[],
      })),
    );
    setRoles(
      (roleRes.data ?? []).map((r) => ({
        id: r.id as string,
        key: r.key as string,
        label: r.label as string,
        permissions: (r.permissions as string[] | null) ?? [],
        is_system: Boolean(r.is_system),
      })),
    );
  };
  useEffect(() => { void refresh(); }, []);

  const startNew = () =>
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      phone: "",
      shift_hours: 8,
      check_in: "08:00",
      check_out: "16:00",
      actual_worked: 0,
      hourly_rate: 0,
      salary: 0,
      username: "",
      password: "",
      role_key: "",
      status: "active",
      permissions: [],
      __isNew: true,
    });

  const recompute = (e: Employee): Employee => {
    const worked = computeWorked(e.check_in, e.check_out);
    return { ...e, actual_worked: worked, salary: Math.round(worked * (Number(e.hourly_rate) || 0)) };
  };

  const saveEmp = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return toast.error("يجب إدخال الاسم");
    const finalRow = recompute(editing);
    setBusy(true);
    try {
      const payload = {
        name: finalRow.name,
        phone: finalRow.phone || null,
        shift_hours: finalRow.shift_hours,
        check_in: finalRow.check_in || null,
        check_out: finalRow.check_out || null,
        actual_worked: finalRow.actual_worked,
        hourly_rate: finalRow.hourly_rate,
        salary: finalRow.salary,
        username: finalRow.username || null,
        password: finalRow.password || null,
        role_key: finalRow.role_key || null,
        status: finalRow.status,
        permissions: finalRow.permissions,
        shift: `${finalRow.check_in || "?"}-${finalRow.check_out || "?"}`,
      };
      if (editing.__isNew) {
        const { error } = await supabase.from("employees").insert({ id: editing.id, ...payload });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employees").update(payload).eq("id", editing.id);
        if (error) throw error;
      }
      setEditing(null);
      await refresh();
      toast.success("تم الحفظ");
    } catch (e) {
      reportErr("حفظ الموظف", e);
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("حذف هذا الموظف نهائياً؟")) return;
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) return reportErr("حذف الموظف", error);
    await refresh();
  };

  // Recompute salary using latest data logs then open WhatsApp with a summary.
  const sendWhatsApp = async (emp: Employee) => {
    const finalRow = recompute(emp);
    // Persist the fresh recompute so the ledger stays in sync.
    try {
      await supabase
        .from("employees")
        .update({ actual_worked: finalRow.actual_worked, salary: finalRow.salary })
        .eq("id", emp.id);
    } catch (e) {
      reportErr("تحديث الراتب قبل الإرسال", e);
    }
    const phone = (emp.phone || "").replace(/[^\d]/g, "");
    const msg = [
      `مرحباً ${emp.name}`,
      `كشف الراتب:`,
      `• ساعات الدوام: ${finalRow.shift_hours}`,
      `• الدخول: ${finalRow.check_in || "—"} — الخروج: ${finalRow.check_out || "—"}`,
      `• الوقت الفعلي: ${finalRow.actual_worked} ساعة`,
      `• الراتب بالساعة: ${finalRow.hourly_rate.toLocaleString()} د.ع`,
      `• الراتب الكلي: ${finalRow.salary.toLocaleString()} د.ع`,
    ].join("\n");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    await refresh();
  };

  // Inline row edits (attendance / permissions) — optimistic UI then persist.
  const [permOpen, setPermOpen] = useState<string | null>(null);

  const patchRow = async (id: string, patch: Partial<Employee>) => {
    let payload: any = {};
    setList((rows) =>
      rows.map((r) => {
        if (r.id !== id) return r;
        const merged = recompute({ ...r, ...patch });
        payload = {
          ...patch,
          actual_worked: merged.actual_worked,
          salary: merged.salary,
          shift: `${merged.check_in || "?"}-${merged.check_out || "?"}`,
        };
        return merged;
      }),
    );
    const { error } = await supabase.from("employees").update(payload as never).eq("id", id);
    if (error) reportErr("تحديث بيانات الموظف", error);
  };

  const toggleEmpPerm = (emp: Employee, mod: string) => {
    const next = emp.permissions.includes(mod)
      ? emp.permissions.filter((p) => p !== mod)
      : [...emp.permissions, mod];
    void patchRow(emp.id, { permissions: next });
  };

  const totals = useMemo(

    () => list.reduce(
      (acc, e) => ({ worked: acc.worked + e.actual_worked, salary: acc.salary + e.salary }),
      { worked: 0, salary: 0 },
    ),
    [list],
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
      {/* Payroll table */}
      <div className="border border-border rounded-2xl overflow-hidden bg-slate-950/40">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-xs font-bold text-emerald">جدول الموظفين والرواتب ({list.length})</p>
          <button
            onClick={startNew}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110"
          >
            <Plus className="size-3.5" /> إضافة موظف
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-2 py-2">اسم الموظف</th>
                <th className="px-2 py-2">الهاتف</th>
                <th className="px-2 py-2">ساعات الدوام</th>
                <th className="px-2 py-2">بصمة دخول</th>
                <th className="px-2 py-2">بصمة خروج</th>
                <th className="px-2 py-2 text-emerald">الوقت الفعلي</th>
                <th className="px-2 py-2">الراتب/ساعة</th>
                <th className="px-2 py-2 text-emerald">الراتب الكلي</th>
                <th className="px-2 py-2">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {list.map((e) => {
                const worked = computeWorked(e.check_in, e.check_out) || e.actual_worked;
                const salary = Math.round(worked * (e.hourly_rate || 0));
                const open = permOpen === e.id;
                return (
                  <Fragment key={e.id}>
                  <tr className={e.status === "terminated" ? "opacity-50" : "hover:bg-emerald/5"}>
                    <td className="px-2 py-2 font-medium">{e.name}</td>
                    <td className="px-2 py-2 font-mono">{e.phone || "—"}</td>
                    <td className="px-2 py-2 font-mono">{e.shift_hours}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="time"
                        value={e.check_in || ""}
                        onChange={(ev) => void patchRow(e.id, { check_in: ev.target.value })}
                        className={timeInp}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="time"
                        value={e.check_out || ""}
                        onChange={(ev) => void patchRow(e.id, { check_out: ev.target.value })}
                        className={timeInp}
                      />
                    </td>
                    <td className="px-2 py-2 font-mono text-emerald">{worked}h</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        value={e.hourly_rate}
                        onChange={(ev) => void patchRow(e.id, { hourly_rate: Number(ev.target.value) || 0 })}
                        className={`${timeInp} w-24`}
                      />
                    </td>
                    <td className="px-2 py-2 font-mono text-emerald font-bold">{salary.toLocaleString()} د.ع</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => sendWhatsApp(e)}
                          title="إرسال كشف الراتب إلى واتساب (يتم إعادة حساب الراتب)"
                          className="flex items-center gap-1 px-2 py-1 rounded bg-emerald/10 border border-emerald/40 text-emerald text-[10px] font-bold hover:bg-emerald/20"
                        >
                          <MessageCircle className="size-3" /> واتساب
                        </button>
                        <button
                          onClick={() => setPermOpen(open ? null : e.id)}
                          title="صلاحيات الوصول للتبويبات"
                          className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold transition ${
                            open
                              ? "bg-emerald text-primary-foreground border-emerald"
                              : "bg-slate-800 border-border hover:border-emerald/40 hover:text-emerald"
                          }`}
                        >
                          <KeyRound className="size-3" /> صلاحيات ({e.permissions.length})
                        </button>
                        <button
                          onClick={() => setEditing({ ...e })}
                          className="px-2 py-1 rounded bg-slate-800 border border-border text-[10px] font-bold hover:border-emerald/40 hover:text-emerald"
                        >
                          تعديل
                        </button>
                        <button
                          onClick={() => remove(e.id)}
                          className="px-2 py-1 rounded bg-slate-800 border border-destructive/30 text-destructive text-[10px] font-bold hover:bg-destructive/10"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-900/50">
                      <td colSpan={9} className="px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                          صلاحيات الوصول الخاصة بـ {e.name}
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                          {MODULES.map((m) => {
                            const on = e.permissions.includes(m.key);
                            return (
                              <button
                                key={m.key}
                                onClick={() => toggleEmpPerm(e, m.key)}
                                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold text-right transition ${
                                  on
                                    ? "bg-emerald/10 border-emerald/40 text-emerald"
                                    : "bg-slate-800 border-border text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <span className="truncate">{m.label}</span>
                                <span className={`shrink-0 w-8 h-4 rounded-full relative transition ${on ? "bg-emerald" : "bg-slate-700"}`}>
                                  <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${on ? "right-0.5" : "right-[calc(100%-0.875rem)]"}`} />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">
                          تُحفظ الصلاحيات تلقائياً وتتجاوز صلاحيات الدور المخصص لهذا الموظف.
                        </p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}

              {list.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground text-xs">
                    لا يوجد موظفون بعد.
                  </td>
                </tr>
              )}
            </tbody>
            {list.length > 0 && (
              <tfoot className="bg-slate-900/60 text-[11px] font-bold">
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-muted-foreground">الإجماليات</td>
                  <td className="px-2 py-2 font-mono text-emerald">{totals.worked.toFixed(2)}h</td>
                  <td className="px-2 py-2">—</td>
                  <td className="px-2 py-2 font-mono text-emerald">{totals.salary.toLocaleString()} د.ع</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Edit form */}
      <div className="border border-border rounded-2xl bg-slate-950/40 p-4">
        <p className="text-xs font-bold text-emerald mb-3">
          {editing ? "بيانات الموظف والحساب" : "اختر موظفاً أو أضف جديداً"}
        </p>
        {editing ? (
          <div className="space-y-2.5">
            <Row2>
              <Field label="اسم الموظف">
                <input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v.target.value })} className={inp} />
              </Field>
              <Field label="رقم الهاتف">
                <input value={editing.phone} onChange={(v) => setEditing({ ...editing, phone: v.target.value })} className={inp} placeholder="9647..." />
              </Field>
            </Row2>
            <Row2>
              <Field label="ساعات الدوام (يومياً)">
                <input type="number" value={editing.shift_hours} onChange={(v) => setEditing({ ...editing, shift_hours: Number(v.target.value) || 0 })} className={inp} />
              </Field>
              <Field label="الراتب / ساعة (د.ع)">
                <input type="number" value={editing.hourly_rate} onChange={(v) => setEditing({ ...editing, hourly_rate: Number(v.target.value) || 0 })} className={inp} />
              </Field>
            </Row2>
            <Row2>
              <Field label="وقت الدخول">
                <input type="time" value={editing.check_in} onChange={(v) => setEditing({ ...editing, check_in: v.target.value })} className={inp} />
              </Field>
              <Field label="وقت الخروج">
                <input type="time" value={editing.check_out} onChange={(v) => setEditing({ ...editing, check_out: v.target.value })} className={inp} />
              </Field>
            </Row2>
            <div className="rounded-lg border border-emerald/30 bg-emerald/5 p-2.5 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-[10px] text-muted-foreground">الوقت الفعلي</p>
                <p className="font-mono font-bold text-emerald">{computeWorked(editing.check_in, editing.check_out)}h</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">الراتب الكلي (تلقائي)</p>
                <p className="font-mono font-bold text-emerald">
                  {(computeWorked(editing.check_in, editing.check_out) * editing.hourly_rate).toLocaleString()} د.ع
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-border">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">حساب الدخول</p>
              <Row2>
                <Field label="اسم حساب">
                  <input value={editing.username} onChange={(v) => setEditing({ ...editing, username: v.target.value })} className={inp} placeholder="username" />
                </Field>
                <Field label="باسوورد الدخول">
                  <input type="password" value={editing.password} onChange={(v) => setEditing({ ...editing, password: v.target.value })} className={inp} />
                </Field>
              </Row2>
              <Field label="دور الموظف">
                <select value={editing.role_key} onChange={(v) => setEditing({ ...editing, role_key: v.target.value })} className={inp}>
                  <option value="">— بلا دور —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={saveEmp} disabled={busy} className="flex-1 py-2 rounded-lg bg-emerald text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-50">
                <Save className="inline size-3.5 me-1" /> حفظ
              </button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-slate-800 border border-border text-xs font-bold">
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={startNew}
            className="w-full py-3 rounded-lg bg-slate-800 border border-dashed border-emerald/40 text-emerald text-xs font-bold hover:bg-emerald/10"
          >
            <Plus className="inline size-3.5 me-1" /> إضافة موظف جديد
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Roles / Permissions tab ------------------------------------------
function RolesTab() {
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { data, error } = await supabase.from("custom_roles").select("*").order("label");
    if (error) return reportErr("تحميل الأدوار", error);
    const rs = (data ?? []).map((r) => ({
      id: r.id as string,
      key: r.key as string,
      label: r.label as string,
      permissions: (r.permissions as string[] | null) ?? [],
      is_system: Boolean(r.is_system),
    }));
    setRoles(rs);
    if (!selected && rs.length) setSelected(rs[0].id);
  };
  useEffect(() => { void refresh(); }, []);

  const active = roles.find((r) => r.id === selected) ?? null;

  const addRole = async () => {
    const label = prompt("اسم الدور الجديد:");
    if (!label) return;
    const key = prompt("مفتاح (بالإنجليزي، بدون فراغات):", label.replace(/\s+/g, "_").toLowerCase());
    if (!key) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("custom_roles")
        .insert({ key, label, permissions: [], is_system: false })
        .select("*")
        .single();
      if (error) throw error;
      await refresh();
      setSelected(data.id as string);
      toast.success("تمت إضافة الدور");
    } catch (e) { reportErr("إضافة دور", e); }
    finally { setBusy(false); }
  };

  const removeRole = async () => {
    if (!active || active.is_system) return;
    if (!confirm(`حذف الدور "${active.label}"؟`)) return;
    const { error } = await supabase.from("custom_roles").delete().eq("id", active.id);
    if (error) return reportErr("حذف الدور", error);
    setSelected(null);
    await refresh();
  };

  const togglePerm = async (mod: string) => {
    if (!active) return;
    const has = active.permissions.includes(mod);
    const next = has ? active.permissions.filter((p) => p !== mod) : [...active.permissions, mod];
    setRoles((rs) => rs.map((r) => (r.id === active.id ? { ...r, permissions: next } : r)));
    const { error } = await supabase.from("custom_roles").update({ permissions: next }).eq("id", active.id);
    if (error) reportErr("حفظ الصلاحيات", error);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <div className="border border-border rounded-2xl bg-slate-950/40 overflow-hidden">
        <div className="px-3 py-3 border-b border-border flex items-center justify-between">
          <p className="text-xs font-bold text-emerald">الأدوار ({roles.length})</p>
          <button
            onClick={addRole}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald text-primary-foreground text-[11px] font-bold hover:brightness-110 disabled:opacity-40"
          >
            <Plus className="size-3" /> جديد
          </button>
        </div>
        <div className="divide-y divide-border/50">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`w-full text-right px-3 py-2 flex items-center gap-2 hover:bg-emerald/5 transition ${
                selected === r.id ? "bg-emerald/10 border-r-2 border-emerald" : ""
              }`}
            >
              <div className="size-8 rounded-full bg-emerald/15 border border-emerald/30 grid place-items-center text-emerald font-bold text-xs">
                {(r.label || "?").charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{r.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {r.permissions.length} صلاحية {r.is_system ? "• نظامي" : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-2xl bg-slate-950/40 p-4">
        {active ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-emerald">{active.label}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{active.key}</p>
              </div>
              {!active.is_system && (
                <button
                  onClick={removeRole}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-destructive/30 text-destructive text-xs font-bold hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" /> حذف الدور
                </button>
              )}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                صلاحيات الوصول للتبويبات
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MODULES.map((m) => {
                  const on = active.permissions.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      onClick={() => togglePerm(m.key)}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-bold text-right transition ${
                        on ? "bg-emerald/10 border-emerald/40 text-emerald" : "bg-slate-800 border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>{m.label}</span>
                      <span className={`w-9 h-5 rounded-full relative transition ${on ? "bg-emerald" : "bg-slate-700"}`}>
                        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? "right-0.5" : "right-[calc(100%-1.125rem)]"}`} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                يتم الحفظ تلقائياً عند تعديل أي مفتاح.
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full grid place-items-center text-center text-muted-foreground text-xs py-16">
            اختر دوراً أو أضف دوراً جديداً.
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Small UI helpers --------------------------------------------------
const timeInp =
  "bg-slate-800 border border-border rounded-md px-2 py-1 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald/40 focus:border-emerald";

const inp =
  "w-full bg-slate-800 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald/40 focus:border-emerald";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}
