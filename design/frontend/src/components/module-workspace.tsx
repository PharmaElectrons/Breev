import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export type ModuleFeature = {
  icon: LucideIcon;
  title: string;
  desc: string;
};

/** Shared clean workspace scaffold for the advanced expansion modules. */
export function ModuleWorkspace({
  title,
  subtitle,
  features,
  children,
}: {
  title: string;
  subtitle: string;
  features: ModuleFeature[];
  children?: ReactNode;
}) {
  return (
    <AppShell title={title}>
      <div className="flex-1 overflow-auto p-6" dir="rtl">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="rounded-2xl border border-border bg-slate-950/40 px-5 py-4">
            <h2 className="text-sm font-bold text-emerald">{title}</h2>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border bg-slate-950/40 p-4 hover:border-emerald/40 transition-colors"
              >
                <div className="size-9 rounded-lg bg-emerald/10 border border-emerald/30 grid place-items-center mb-3">
                  <f.icon className="size-4 text-emerald" />
                </div>
                <p className="text-xs font-bold text-foreground">{f.title}</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{f.desc}</p>
                <span className="inline-block mt-3 px-2 py-0.5 rounded-md bg-slate-800 border border-border text-[10px] font-bold text-muted-foreground">
                  قيد التهيئة
                </span>
              </div>
            ))}
          </div>

          {children}
        </div>
      </div>
    </AppShell>
  );
}
