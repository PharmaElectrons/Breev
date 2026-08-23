import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { breakdown, consumptionRate, sellingPrice, type Product } from "@/lib/pharmacy";
import type { Medicine } from "@/lib/db";
import { useI18n, type Lang } from "@/lib/i18n";
import { useBranding, useBrandTitle } from "@/lib/branding";
import { supabase } from "@/integrations/supabase/client";



const UNITS = ["باكيت", "شريط", "قطعة"] as const;
export type Unit = (typeof UNITS)[number];

/** Sliding horizontal unit toggle with left/right arrows. */
export function UnitToggle({
  value,
  onChange,
  compact,
}: {
  value: Unit;
  onChange: (u: Unit) => void;
  compact?: boolean;
}) {
  const { lang } = useI18n();
  const labelMap: Record<Unit, { ar: string; en: string }> = {
    باكيت: { ar: "باكيت", en: "Box" },
    شريط: { ar: "شريط", en: "Strip" },
    قطعة: { ar: "قطعة", en: "Piece" },
  };
  const idx = Math.max(0, UNITS.indexOf(value));
  const shift = (dir: -1 | 1) => {
    const next = (idx + dir + UNITS.length) % UNITS.length;
    onChange(UNITS[next]);
  };
  const cellW = compact ? 56 : 72;
  return (
    <div
      className={`inline-flex items-center gap-1 bg-slate-800 border border-border rounded-full p-0.5 ${
        compact ? "text-[10px]" : "text-xs"
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          shift(-1);
        }}
        className="size-6 grid place-items-center rounded-full hover:bg-emerald/15 text-muted-foreground hover:text-emerald transition"
        aria-label="prev"
      >
        ‹
      </button>
      <div className="relative overflow-hidden" style={{ width: cellW }}>
        <div
          className="flex transition-transform duration-300"
          style={{ transform: `translateX(${idx * cellW}px)` }}
        >
          {UNITS.map((u) => (
            <span
              key={u}
              className="shrink-0 text-center font-bold text-emerald"
              style={{ width: cellW }}
            >
              {labelMap[u][lang]}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          shift(1);
        }}
        className="size-6 grid place-items-center rounded-full hover:bg-emerald/15 text-muted-foreground hover:text-emerald transition"
        aria-label="next"
      >
        ›
      </button>
    </div>
  );
}

export function ProductInfoSidebar({ medicine, footer }: { medicine?: Medicine; footer?: ReactNode }) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<"month" | "quarter">("month");

  if (!medicine) {
    return (
      <aside className="w-80 shrink-0 border-r border-border bg-slate-950/60 backdrop-blur-md flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="size-12 rounded-full bg-emerald/10 border border-emerald/30 grid place-items-center mb-3">
            <div className="size-4 rounded-sm bg-emerald/60" />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {lang === "ar"
              ? "لا توجد مادة محددة. اختر مادة من الفاتورة لعرض تفاصيلها."
              : "No item selected. Pick a medicine from the invoice to see details."}
          </p>
        </div>
        {footer && <div className="border-t border-border p-3">{footer}</div>}
      </aside>
    );
  }

  const unitsPerLarge = Math.max(1, medicine.units_per_large || 1);
  const totalPills = medicine.quantity_in_stock || 0;
  const largeCount = Math.floor(totalPills / unitsPerLarge);
  const remainderPills = totalPills - largeCount * unitsPerLarge;

  // Liquid / bottle-style items (syrups, drops, injections) have no strip sub-unit.
  // Detect via dosage_form or the item's own large-unit label.
  const dosage = (medicine.dosage_form || "").toLowerCase();
  const largeLabelRaw = (medicine.large_unit_name || "").toLowerCase();
  const isLiquid =
    /شراب|قطر|بخاخ|إبر|ابر|حقن|امبول|بطل|syrup|liquid|drop|spray|inject|amp|bottle/.test(
      `${dosage} ${largeLabelRaw}`,
    );

  const stripsShown: number | null = isLiquid ? null : 0;

  const largeLabel = medicine.large_unit_name || (lang === "ar" ? "باكيت" : "Box");
  const smallLabel = isLiquid
    ? (lang === "ar" ? "عدد الأيام" : "Days")
    : (medicine.small_unit_name || (lang === "ar" ? "حبة" : "Pill"));
  const stripLabel = lang === "ar" ? "شريط" : "Strip";
  const days = Number(medicine.days_per_cycle) || 0;
  const baseValue = isLiquid ? days : remainderPills;

  const price = Number(medicine.selling_price) || 0;
  const dailyRate = 0; // consumption tracking not in schema yet
  const monthlyRate = 0;
  const sufficiencyDays = dailyRate > 0 ? Math.floor(totalPills / dailyRate) : 0;
  const rateValue = period === "month" ? monthlyRate : monthlyRate * 3;

  return (
    <aside className="w-80 shrink-0 border-r border-border bg-slate-950/60 backdrop-blur-md flex flex-col animate-reveal">
      {/* Header */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <span className="size-2.5 rounded-full bg-emerald shadow-[0_0_8px] shadow-emerald/60" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald">
            {lang === "ar" ? "شريط معلومات المادة" : "Product Info"}
          </h2>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap text-right">
          <p className="text-sm font-bold leading-tight text-foreground truncate min-w-0 flex-1" title={medicine.scientific_name}>
            {medicine.scientific_name}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono shrink-0">
            {medicine.barcode || (lang === "ar" ? "بدون باركود" : "No barcode")}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{medicine.trade_name}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 scanline">
        {/* Detailed balance */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 text-right">
            {lang === "ar" ? "الرصيد بالتفصيل" : "Detailed Balance"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <FractionCell label={largeLabel} value={largeCount} />
            <FractionCell label={stripLabel} value={stripsShown} />
            <FractionCell label={smallLabel} value={baseValue} />
          </div>
          <p className="text-[11px] text-muted-foreground font-mono mt-2 text-center">
            {lang === "ar" ? "الإجمالي" : "Total"}: {totalPills.toLocaleString()} {smallLabel}
          </p>
        </div>

        {/* Fact sheet rows */}
        <div className="space-y-0 border border-border rounded-lg overflow-hidden bg-card/40">
          <Row
            label={lang === "ar" ? "التعبئة" : "Packing"}
            value={`1 ${largeLabel} = ${unitsPerLarge} ${smallLabel}`}
          />
          <div className="flex justify-between items-center px-3 py-1.5 border-b border-border text-[11px]">
            <span className="text-muted-foreground">
              {lang === "ar" ? "حدود المخزن" : "Stock limits"}
            </span>
            <div className="flex items-center gap-3 font-mono">
              <span className="text-emerald font-bold" title={lang === "ar" ? "حد الأدنى" : "Min"}>
                ↓ {medicine.minimum_stock}
              </span>
              <span className="text-accent font-bold" title={lang === "ar" ? "حد الأعلى" : "Max"}>
                ↑ {medicine.maximum_stock}
              </span>
              <span className="text-muted-foreground text-[10px]">{largeLabel}</span>
            </div>
          </div>
          <Row
            label={lang === "ar" ? "سعر الجملة" : "Wholesale price"}
            value={`${price.toLocaleString()} ${lang === "ar" ? "د.ع" : "IQD"}`}
            accent
          />
          <div className="flex justify-between items-center px-3 py-2 border-b border-border">
            <span className="text-xs text-muted-foreground">
              {lang === "ar" ? "معدل الصرف" : "Consumption rate"}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-emerald font-bold">
                {rateValue.toLocaleString()} {stripLabel}
              </span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as "month" | "quarter")}
                className="text-[10px] bg-slate-800 border border-border rounded px-2 py-0.5 font-mono"
              >
                <option value="month">{lang === "ar" ? "شهر" : "Month"}</option>
                <option value="quarter">{lang === "ar" ? "ربع" : "Quarter"}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-between items-center px-3 py-2 bg-accent/5">
            <span className="text-xs text-muted-foreground">
              {lang === "ar" ? "أيام الكفاية" : "Days of supply"}
            </span>
            <span className="font-mono text-sm text-accent font-bold">
              {sufficiencyDays} {lang === "ar" ? "يوم" : "days"}
            </span>
          </div>
          {(medicine as any).expiry_date && (() => {
            const exp = new Date((medicine as any).expiry_date as string);
            const days = Math.round((exp.getTime() - Date.now()) / 86400000);
            const tone = days < 0 ? "text-destructive" : days < 90 ? "text-accent" : "text-emerald";
            return (
              <div className="flex justify-between items-center px-3 py-2 border-b border-border">
                <span className="text-xs text-muted-foreground">
                  {lang === "ar" ? "تاريخ الاكسباير" : "Expiry"}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-foreground/80">
                    {exp.toISOString().slice(0, 10)}
                  </span>
                  <span className={`font-mono text-[11px] font-bold ${tone}`}>
                    {days < 0
                      ? lang === "ar" ? `منتهي منذ ${-days} يوم` : `Expired ${-days}d ago`
                      : lang === "ar" ? `${days} يوم متبقي` : `${days}d left`}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Medical notes */}
        {medicine.notes && (
          <div className="bg-emerald/5 border border-emerald/20 rounded-xl p-3 space-y-1">
            <p className="text-[10px] font-bold text-emerald uppercase tracking-wider">
              {lang === "ar" ? "ملاحظات طبية" : "Medical notes"}
            </p>
            <p className="text-[11px] leading-relaxed text-foreground/80">{medicine.notes}</p>
          </div>
        )}
      </div>
      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </aside>
  );
}

function FractionCell({ label, value }: { label: string; value: number | null }) {
  const isBlank = value === null;
  return (
    <div className={`border rounded-lg p-3 text-center ${isBlank ? "bg-slate-900/40 border-dashed border-border/60" : "bg-card border-border"}`}>
      <p className={`text-2xl font-mono font-bold tabular-nums leading-none ${isBlank ? "text-muted-foreground/40" : "text-emerald"}`}>
        {isBlank ? "—" : value}
      </p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1.5">{label}</p>
    </div>
  );
}

function Row({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between items-center px-3 py-2 border-b border-border last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${accent ? "text-emerald font-bold" : warn ? "text-accent font-bold" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}




function LiveClock() {
  const { lang } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  return (
    <div className={lang === "ar" ? "text-left" : "text-right"} suppressHydrationWarning>
      <p className="text-[10px] text-emerald leading-none font-mono uppercase tracking-widest">
        {now ? now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
      </p>
      <p className="text-xs font-medium text-muted-foreground mt-1">
        {now ? now.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : ""}
      </p>
    </div>
  );
}

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="relative inline-flex items-center gap-1.5 rounded-lg border border-emerald/40 bg-emerald/10 pl-2 pr-1 py-1 shadow-[0_0_12px_-6px] shadow-emerald/60">
      <span className="text-[10px] font-bold uppercase tracking-widest text-emerald">
        {lang === "ar" ? "اللغة" : "Lang"}
      </span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="appearance-none bg-transparent text-emerald font-bold text-[11px] pr-5 pl-1 focus:outline-none cursor-pointer"
        aria-label="Switch language"
      >
        <option value="ar" className="bg-slate-900 text-emerald">🇮🇶 العربية</option>
        <option value="en" className="bg-slate-900 text-emerald">🇬🇧 English</option>
      </select>
      <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 size-3 text-emerald" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
    </div>
  );
}

function SignOutButton() {
  return null;
}


const OVERFLOW_MODULES = [
  { to: "/external-integration", ar: "الربط الخارجي", en: "External Integration" },
  { to: "/integration", ar: "جدول الربط الخارجي", en: "Integration Sheet" },
  { to: "/delivery", ar: "التوصيل", en: "Delivery & Logistics" },
  { to: "/ecommerce", ar: "التكامل مع المتجر الالكتروني", en: "E-Commerce Integration" },
  { to: "/marketing", ar: "الترويج والتسويق", en: "Promotion & Marketing" },
  { to: "/cart", ar: "مقارنة المذاخر والطلبيات", en: "Supplier Matrix & Ordering" },
] as const;

function OverflowMenu({ pathname }: { pathname: string }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="more modules"
        aria-expanded={open}
        className={`px-2.5 py-1.5 rounded-sm text-base leading-none font-bold transition-colors ${
          open ? "bg-emerald text-primary-foreground" : "text-muted-foreground hover:text-emerald"
        }`}
      >
        •••
      </button>
      {open && (
        <div
          dir={lang === "ar" ? "rtl" : "ltr"}
          className="absolute top-full mt-2 z-50 min-w-60 rounded-lg border border-border bg-slate-950/95 backdrop-blur-md shadow-xl p-1 animate-reveal"
          style={lang === "ar" ? { left: 0 } : { right: 0 }}
        >
          {OVERFLOW_MODULES.map((m) => (
            <Link
              key={m.to}
              to={m.to}
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                pathname === m.to
                  ? "bg-emerald/15 text-emerald"
                  : "text-muted-foreground hover:bg-emerald/10 hover:text-foreground"
              }`}
            >
              {lang === "ar" ? m.ar : m.en}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children, title, medicine, sidebarFooter }: { children: ReactNode; title: string; medicine?: Medicine; sidebarFooter?: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useI18n();
  const branding = useBranding();
  useBrandTitle(title);
  const tabs = [
    { to: "/dashboard", label: t("nav.dashboard") },
    { to: "/", label: t("nav.sales") },
    { to: "/purchases", label: t("nav.purchases") },
    { to: "/inventory", label: t("nav.inventory") },
    { to: "/products", label: t("nav.products") },
    { to: "/patients", label: t("nav.patients") },
    { to: "/clinic", label: "العيادة" },

    { to: "/messages", label: t("nav.messages") },
    { to: "/cart", label: t("nav.cart") },
    { to: "/reports", label: t("nav.reports") },
    { to: "/accounts", label: t("nav.accounts") },
    { to: "/employees", label: t("nav.employees") },
    { to: "/settings", label: t("nav.settings") },
  ];

  return (
    <div className="flex h-screen w-full bg-background font-display text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col bg-slate-900 overflow-hidden shadow-[20px_0_60px_-20px_rgba(0,0,0,0.08)]">
        <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-slate-950/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="flex items-center gap-2.5 min-w-0 shrink">
              <div className="size-8 rounded-lg bg-emerald/15 border border-emerald/30 grid place-items-center overflow-hidden">
                {branding.logoDataUrl ? (
                  <img src={branding.logoDataUrl} alt="logo" className="size-full object-contain" />
                ) : (
                  <div className="size-3 rounded-sm bg-emerald" />
                )}
              </div>
              <h1 className="font-bold text-lg tracking-tight whitespace-nowrap truncate">
                <span className="text-emerald">{branding.name}</span>
                <span className="text-muted-foreground/40 font-light font-mono mx-2">/</span>
                <span className="text-foreground/90 text-sm font-medium">{title}</span>
              </h1>
            </div>
            <nav className="flex items-center gap-0.5 bg-slate-800/60 p-1 rounded-md border border-border flex-1 basis-0 min-w-[180px]">
              <div className="flex-1 min-w-0 flex gap-0.5 overflow-x-auto scroll-smooth snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {tabs.map((tab) => {
                  const active = pathname === tab.to;
                  return (
                    <Link
                      key={tab.to}
                      to={tab.to}
                      className={`snap-start shrink-0 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium rounded-sm transition-colors ${
                        active
                          ? "bg-emerald text-primary-foreground shadow-[0_0_20px_-4px] shadow-emerald/60"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </div>
              <OverflowMenu pathname={pathname} />
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <LanguageToggle />
            <SignOutButton />
            <LiveClock />
          </div>
        </header>
        {children}
      </main>
      <ProductInfoSidebar medicine={medicine} footer={sidebarFooter} />
    </div>
  );
}
