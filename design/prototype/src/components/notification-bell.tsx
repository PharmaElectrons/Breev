// Header notification bell: live system alerts (low stock, expiring items,
// pending reservations / need requests) pulled from Lovable Cloud.
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, AlertTriangle, Clock, PackageMinus, ClipboardList } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

type Alert = {
  id: string;
  kind: "low" | "expire" | "negative" | "task";
  title: string;
  body: string;
  to: string;
};

export function NotificationBell() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const soon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const [{ data: meds }, { data: resv }] = await Promise.all([
      supabase
        .from("medicines")
        .select("id,trade_name,quantity_in_stock,minimum_stock,expiry_date")
        .eq("is_active", true),
      supabase
        .from("patient_reservations")
        .select("id,patient_name,medicine_name,qty,status")
        .eq("status", "pending")
        .limit(20),
    ]);

    const out: Alert[] = [];
    for (const m of (meds ?? []) as any[]) {
      const qty = Number(m.quantity_in_stock || 0);
      if (qty < 0) {
        out.push({
          id: `neg-${m.id}`,
          kind: "negative",
          title: isAr ? "رصيد سالب" : "Negative stock",
          body: `${m.trade_name} — ${qty}`,
          to: "/inventory",
        });
      } else if (qty <= Number(m.minimum_stock || 0)) {
        out.push({
          id: `low-${m.id}`,
          kind: "low",
          title: isAr ? "نقص مخزون" : "Low stock",
          body: `${m.trade_name} — ${isAr ? "الرصيد" : "balance"} ${qty}`,
          to: "/cart",
        });
      }
      if (m.expiry_date && m.expiry_date <= soon) {
        out.push({
          id: `exp-${m.id}`,
          kind: "expire",
          title: isAr ? "قرب انتهاء الصلاحية" : "Expiring soon",
          body: `${m.trade_name} — ${m.expiry_date}`,
          to: "/reports",
        });
      }
    }
    for (const r of (resv ?? []) as any[]) {
      out.push({
        id: `task-${r.id}`,
        kind: "task",
        title: isAr ? "حجز بانتظار التنفيذ" : "Pending reservation",
        body: `${r.patient_name} — ${r.medicine_name} (${r.qty})`,
        to: "/patients",
      });
    }
    setAlerts(out.slice(0, 60));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAr]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (open && boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const groups = useMemo(() => {
    const counts = { low: 0, expire: 0, negative: 0, task: 0 } as Record<Alert["kind"], number>;
    for (const a of alerts) counts[a.kind] += 1;
    return counts;
  }, [alerts]);

  const icon = (k: Alert["kind"]) =>
    k === "expire" ? <Clock className="size-3.5" /> : k === "negative" ? <PackageMinus className="size-3.5" /> : k === "task" ? <ClipboardList className="size-3.5" /> : <AlertTriangle className="size-3.5" />;

  const tone = (k: Alert["kind"]) =>
    k === "negative" ? "text-destructive" : k === "expire" ? "text-amber-400" : k === "task" ? "text-sky-400" : "text-emerald";

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={isAr ? "الإشعارات" : "Notifications"}
        className="relative size-9 grid place-items-center rounded-lg border border-border bg-slate-800/60 text-muted-foreground hover:text-emerald hover:border-emerald/40 transition"
      >
        <Bell className="size-4" />
        {alerts.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-destructive text-[9px] font-bold text-white grid place-items-center">
            {alerts.length > 99 ? "99+" : alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div
          dir={isAr ? "rtl" : "ltr"}
          className="absolute z-50 mt-2 w-[340px] max-h-[70vh] overflow-hidden rounded-xl border border-border bg-slate-950/95 backdrop-blur-md shadow-2xl"
          style={isAr ? { left: 0 } : { right: 0 }}
        >
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <p className="text-xs font-bold text-foreground">{isAr ? "تنبيهات النظام" : "System alerts"}</p>
            <span className="text-[10px] font-mono text-muted-foreground">
              {isAr ? "نقص" : "Low"} {groups.low} • {isAr ? "صلاحية" : "Exp"} {groups.expire} • {isAr ? "سالب" : "Neg"} {groups.negative} • {isAr ? "مهام" : "Tasks"} {groups.task}
            </span>
          </div>
          <div className="max-h-[58vh] overflow-y-auto divide-y divide-border/50">
            {alerts.map((a) => (
              <Link
                key={a.id}
                to={a.to}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2 px-3 py-2 hover:bg-slate-800/60 transition"
              >
                <span className={`mt-0.5 ${tone(a.kind)}`}>{icon(a.kind)}</span>
                <span className="min-w-0">
                  <span className={`block text-[11px] font-bold ${tone(a.kind)}`}>{a.title}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{a.body}</span>
                </span>
              </Link>
            ))}
            {alerts.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-emerald">
                {isAr ? "لا توجد تنبيهات — كل شيء مستقر ✔" : "No alerts — all clear ✔"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
