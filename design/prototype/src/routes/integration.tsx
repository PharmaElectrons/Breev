import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/integration")({
  component: IntegrationPage,
});

type Row = {
  invoice_id: string;
  invoice_no: number;
  phone: string;
  third_unit: string;
  created_at: string;
  patient_id: string;
  patient_name: string;
  chronic_diseases: string;
  chronic_meds: string;
  prescribed: string;
  notes: string;
  diagnosis: string;
};

const OVERRIDES_KEY = "integration.overrides.v1";
type Overrides = Record<string, { notes?: string; diagnosis?: string }>;

function loadOverrides(): Overrides {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveOverrides(o: Overrides) {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o));
}

function IntegrationPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides());
  const [filter, setFilter] = useState("");

  async function fetchRows() {
    setLoading(true);
    try {
      // Only invoices tied to registered named patients (excludes cash customer where patient_id is null)
      const { data: invs, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_no, created_at, patient_id, status")
        .not("patient_id", "is", null)
        .eq("status", "saved")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const invoices = invs ?? [];
      if (invoices.length === 0) {
        setRows([]);
        return;
      }
      const patientIds = Array.from(new Set(invoices.map((i) => i.patient_id as string)));
      const invIds = invoices.map((i) => i.id as string);

      const [{ data: pats }, { data: items }] = await Promise.all([
        supabase
          .from("patients")
          .select("id, full_name, phone, chronic_diseases, chronic_meds, notes")
          .in("id", patientIds),
        supabase
          .from("sales_invoice_items")
          .select("invoice_id, qty, medicines(trade_name, strength, dosage_form, small_unit_name, units_per_large)")
          .in("invoice_id", invIds),
      ]);

      const pmap = new Map<string, any>((pats ?? []).map((p) => [p.id as string, p]));
      const imap = new Map<string, string[]>();
      const umap = new Map<string, string[]>();
      for (const it of (items ?? []) as any[]) {
        const med = it.medicines;
        const name = med?.trade_name ?? "";
        if (!name) continue;
        const parts = [name, med?.strength, med?.dosage_form].filter(Boolean).join(" ");
        const arr = imap.get(it.invoice_id) ?? [];
        arr.push(`${parts}${it.qty > 1 ? ` ×${it.qty}` : ""}`);
        imap.set(it.invoice_id, arr);
        const uarr = umap.get(it.invoice_id) ?? [];
        const unit = med?.small_unit_name || "قطعة";
        const ratio = Number(med?.units_per_large) || 0;
        uarr.push(ratio > 0 ? `${name}: ${ratio} ${unit}` : `${name}: ${unit}`);
        umap.set(it.invoice_id, uarr);
      }

      const mapped: Row[] = invoices
        .filter((inv) => pmap.has(inv.patient_id as string))
        .map((inv) => {
          const p = pmap.get(inv.patient_id as string);
          const name = String(p?.full_name ?? "").trim();
          const lower = name.toLowerCase();
          if (
            !name ||
            name.includes("مريض نقدي") ||
            name.includes("زبون نقدي") ||
            lower === "cash" ||
            lower === "walk-in"
          )
            return null;
          return {
            invoice_id: inv.id as string,
            invoice_no: inv.invoice_no as number,
            phone: String(p?.phone ?? ""),
            third_unit: (umap.get(inv.id as string) ?? []).join(" • "),
            created_at: inv.created_at as string,
            patient_id: inv.patient_id as string,
            patient_name: name,
            chronic_diseases: (p?.chronic_diseases ?? []).join("، "),
            chronic_meds: (p?.chronic_meds ?? []).join("، "),
            prescribed: (imap.get(inv.id as string) ?? []).join("، "),
            notes: p?.notes ?? "",
            diagnosis: "",
          } as Row;
        })
        .filter(Boolean) as Row[];
      setRows(mapped);
    } catch (e) {
      console.error(e);
      toast.error(`تعذّر تحميل البيانات: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchRows();
    // Live sync: new sales invoices append a row automatically
    const channel = supabase
      .channel("integration-sales-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sales_invoices" },
        (payload) => {
          const row = payload.new as { patient_id: string | null; status: string };
          if (row.patient_id && row.status === "saved") {
            void fetchRows();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.patient_name.toLowerCase().includes(q) ||
        r.chronic_diseases.toLowerCase().includes(q) ||
        r.prescribed.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  function setOverride(id: string, field: "notes" | "diagnosis", value: string) {
    setOverrides((prev) => {
      const next = { ...prev, [id]: { ...prev[id], [field]: value } };
      saveOverrides(next);
      return next;
    });
  }

  return (
    <AppShell title="ربط خارجي">
      <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3" dir="rtl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-emerald">ورقة الربط الخارجي</h2>
            <p className="text-xs text-muted-foreground">
              يتم التقاط بيانات فواتير البيع للمرضى المسجّلين تلقائياً — يُستثنى المريض النقدي.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="بحث…"
              className="h-8 px-3 rounded-md bg-slate-900 border border-border text-xs w-56"
            />
            <button
              onClick={fetchRows}
              className="h-8 px-3 rounded-md bg-emerald/15 border border-emerald/30 text-emerald text-xs hover:bg-emerald/25"
            >
              تحديث
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto border border-border rounded-lg bg-slate-950/60">
          <table className="w-full text-xs border-collapse" dir="rtl">
            <thead className="sticky top-0 bg-slate-900 text-emerald z-10">
              <tr>
                <Th className="w-12">تسلسل</Th>
                <Th className="w-20">الرقم</Th>
                <Th className="w-32">اسم المريض</Th>
                <Th className="w-36">الامراض المزمنة</Th>
                <Th className="w-36">أدويته المزمنة</Th>
                <Th className="w-40">الملاحظات</Th>
                <Th className="w-40">التشخيص</Th>
                <Th className="min-w-[320px]">الادوية الموصوفة</Th>
                <Th className="w-56">الوحدة الثالثة لكل دواء</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    جاري التحميل…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    لا توجد بيانات — أنشئ فاتورة بيع لمريض مسجّل لتظهر هنا.
                  </td>
                </tr>
              )}
              {filtered.map((r, i) => {
                const ov = overrides[r.invoice_id] ?? {};
                return (
                  <tr
                    key={r.invoice_id}
                    className="border-t border-border hover:bg-emerald/5 align-top"
                  >
                    <Td className="text-center font-mono text-muted-foreground">{i + 1}</Td>
                    <Td className="font-mono text-[11px] text-muted-foreground">{r.phone || "—"}</Td>
                    <Td className="font-semibold text-foreground">{r.patient_name}</Td>
                    <Td className="text-muted-foreground">{r.chronic_diseases || "—"}</Td>
                    <Td className="text-muted-foreground">{r.chronic_meds || "—"}</Td>
                    <Td className="p-0">
                      <textarea
                        value={ov.notes ?? r.notes ?? ""}
                        onChange={(e) => setOverride(r.invoice_id, "notes", e.target.value)}
                        rows={2}
                        className="w-full h-full min-h-[52px] bg-transparent px-2 py-1.5 text-xs resize-none focus:outline-none focus:bg-emerald/5 leading-relaxed"
                        placeholder="…"
                      />
                    </Td>
                    <Td className="p-0">
                      <textarea
                        value={ov.diagnosis ?? ""}
                        onChange={(e) => setOverride(r.invoice_id, "diagnosis", e.target.value)}
                        rows={2}
                        className="w-full h-full min-h-[52px] bg-transparent px-2 py-1.5 text-xs resize-none focus:outline-none focus:bg-emerald/5 leading-relaxed"
                        placeholder="…"
                      />
                    </Td>
                    <Td className="text-foreground/90 leading-relaxed">{r.prescribed || "—"}</Td>
                    <Td className="text-muted-foreground text-[11px] leading-relaxed">{r.third_unit || "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>عدد الصفوف: {filtered.length}</span>
          <span>التعديلات محفوظة محلياً</span>
        </div>
      </div>
    </AppShell>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-right px-2 py-2 font-semibold border-b border-border whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 border-b border-border/60 ${className}`}>{children}</td>;
}
