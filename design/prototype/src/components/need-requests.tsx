// طلب احتياج — Inter-pharmacy B2B need requests exchange.
// Dual panel: incoming offers for our requests (right sidebar) + market demands grid (center).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Handshake,
  Plus,
  Search,
  X as XIcon,
  Check,
  Ban,
  MapPin,
  Phone,
  Clock,
  ArrowDownAZ,
  PackageCheck,
  TrendingUp,
} from "lucide-react";
import type { Medicine } from "@/lib/db";
import { formatIQD } from "@/lib/pharmacy";
import { fuzzyFilter } from "@/lib/fuzzy";

const ACCENT = "#4A6B82";

export type PharmacyInfo = {
  name: string;
  phone: string;
  location: string;
  hours: string;
};

export type IncomingOffer = {
  id: string;
  pharmacy: PharmacyInfo;
  unitPrice: number;
  availableQty: number;
  status: "pending" | "accepted" | "rejected";
};

export type OurRequest = {
  id: string;
  itemName: string;
  qty: number;
  targetPrice: number | null;
  offers: IncomingOffer[];
};

export type MarketDemand = {
  id: string;
  itemName: string;
  qty: number;
  targetPrice: number | null;
  pharmacy: PharmacyInfo;
  fulfilled?: boolean;
};

const PHARMACIES: PharmacyInfo[] = [
  { name: "صيدلية النور", phone: "0770 123 4567", location: "بغداد — الكرادة، شارع 62", hours: "9:00 ص — 11:00 م" },
  { name: "صيدلية الشفاء", phone: "0771 987 6543", location: "بغداد — المنصور، شارع الأميرات", hours: "8:00 ص — 12:00 م" },
  { name: "صيدلية الحياة", phone: "0780 555 2211", location: "بغداد — زيونة، شارع الربيعي", hours: "10:00 ص — 10:00 م" },
  { name: "صيدلية ابن سينا", phone: "0750 441 3322", location: "أربيل — شارع 100 متر", hours: "24 ساعة" },
  { name: "صيدلية الرحمة", phone: "0782 776 9900", location: "البصرة — العشار", hours: "9:00 ص — 9:00 م" },
];

const SEED_REQUESTS: OurRequest[] = [
  {
    id: "req-1", itemName: "Augmentin 1g Tab", qty: 20, targetPrice: 9000,
    offers: [
      { id: "of-1", pharmacy: PHARMACIES[0], unitPrice: 8750, availableQty: 20, status: "pending" },
      { id: "of-2", pharmacy: PHARMACIES[1], unitPrice: 9200, availableQty: 35, status: "pending" },
    ],
  },
  {
    id: "req-2", itemName: "Nexium 40mg Cap", qty: 15, targetPrice: null,
    offers: [{ id: "of-3", pharmacy: PHARMACIES[2], unitPrice: 12500, availableQty: 10, status: "pending" }],
  },
  {
    id: "req-3", itemName: "Ventolin Inhaler", qty: 8, targetPrice: 6500,
    offers: [
      { id: "of-4", pharmacy: PHARMACIES[3], unitPrice: 6250, availableQty: 12, status: "pending" },
      { id: "of-5", pharmacy: PHARMACIES[4], unitPrice: 6900, availableQty: 6, status: "pending" },
    ],
  },
];

const SEED_DEMANDS: MarketDemand[] = [
  { id: "dm-1", itemName: "Panadol Extra 500mg", qty: 30, targetPrice: 4500, pharmacy: PHARMACIES[1] },
  { id: "dm-2", itemName: "Lipitor 20mg", qty: 12, targetPrice: null, pharmacy: PHARMACIES[0] },
  { id: "dm-3", itemName: "Concor 5mg", qty: 25, targetPrice: 11000, pharmacy: PHARMACIES[2] },
  { id: "dm-4", itemName: "Zithromax 500mg", qty: 10, targetPrice: 14000, pharmacy: PHARMACIES[3] },
  { id: "dm-5", itemName: "Voltaren Gel", qty: 18, targetPrice: 7000, pharmacy: PHARMACIES[4] },
  { id: "dm-6", itemName: "Glucophage 850mg", qty: 40, targetPrice: null, pharmacy: PHARMACIES[0] },
];

type SortMode = "available" | "alpha" | "margin";

function matchMedicine(name: string, meds: Medicine[]): Medicine | undefined {
  const hit = fuzzyFilter(name, meds, (m) => [m.trade_name, m.scientific_name], { limit: 1 });
  return hit[0]?.item;
}

export function NeedRequests({ medIndex }: { medIndex: Record<string, Medicine> }) {
  const meds = useMemo(() => Object.values(medIndex), [medIndex]);
  const [requests, setRequests] = useState<OurRequest[]>(SEED_REQUESTS);
  const [demands, setDemands] = useState<MarketDemand[]>(SEED_DEMANDS);
  const [openRequest, setOpenRequest] = useState<OurRequest | null>(null);
  const [fulfillTarget, setFulfillTarget] = useState<MarketDemand | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>("available");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const mapped = demands.map((d) => {
      const med = matchMedicine(d.itemName, meds);
      const stock = med?.quantity_in_stock ?? 0;
      const cost = med?.small_unit_cost ?? med?.purchase_price ?? 0;
      const retail = med?.small_unit_price ?? med?.selling_price ?? 0;
      const margin = d.targetPrice != null ? d.targetPrice - retail : -Infinity;
      return { demand: d, med, stock, cost, retail, margin };
    });
    const q = query.trim();
    const filtered = q
      ? mapped.filter((r) => r.demand.itemName.toLowerCase().includes(q.toLowerCase()))
      : mapped;
    const sorted = [...filtered];
    if (sort === "alpha") sorted.sort((a, b) => a.demand.itemName.localeCompare(b.demand.itemName));
    else if (sort === "margin") sorted.sort((a, b) => b.margin - a.margin);
    else sorted.sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0));
    return sorted;
  }, [demands, meds, sort, query]);

  const decideOffer = (reqId: string, offerId: string, status: "accepted" | "rejected") => {
    setRequests((prev) =>
      prev.map((r) =>
        r.id !== reqId
          ? r
          : { ...r, offers: r.offers.map((o) => (o.id === offerId ? { ...o, status } : o)) },
      ),
    );
    setOpenRequest((cur) =>
      cur && cur.id === reqId
        ? { ...cur, offers: cur.offers.map((o) => (o.id === offerId ? { ...o, status } : o)) }
        : cur,
    );
    toast[status === "accepted" ? "success" : "error"](
      status === "accepted" ? "تم قبول العرض وإشعار الصيدلية" : "تم رفض العرض",
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden" dir="rtl">
      {/* Right sidebar — incoming offers */}
      <aside className="w-[300px] shrink-0 border-l border-border bg-slate-950/40 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <PackageCheck className="w-4 h-4" style={{ color: ACCENT }} />
          <h3 className="text-xs font-bold">العروض والموافقات الواردة</h3>
          <span className="ms-auto text-[10px] font-mono text-muted-foreground">{requests.length}</span>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-2">
          {requests.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-8">لا توجد طلبات محققة بعد</p>
          )}
          {requests.map((r) => {
            const best = [...r.offers].sort((a, b) => a.unitPrice - b.unitPrice)[0];
            const accepted = r.offers.some((o) => o.status === "accepted");
            return (
              <div key={r.id}
                className="rounded-xl border p-2.5 space-y-1.5 transition hover:brightness-110 animate-in fade-in"
                style={{ borderColor: `${ACCENT}66`, background: `${ACCENT}14` }}>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-bold leading-tight flex-1">{r.itemName}</span>
                  {accepted && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald/20 text-emerald border border-emerald/40">مقبول</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  الكمية: <span className="text-foreground">{r.qty}</span>
                  {" · "}السعر المطلوب:{" "}
                  <span className="text-foreground">{r.targetPrice != null ? formatIQD(r.targetPrice) : "بلا سعر محدد"}</span>
                </div>
                {best && (
                  <div className="text-[10px] rounded-lg bg-slate-900/50 border border-border px-2 py-1">
                    <div className="font-bold text-teal-300">{best.pharmacy.name}</div>
                    <div className="font-mono text-muted-foreground">
                      السعر المعروض: <span className="text-emerald">{formatIQD(best.unitPrice)}</span>
                    </div>
                  </div>
                )}
                <button onClick={() => setOpenRequest(r)}
                  className="w-full py-1 rounded-lg text-[11px] font-bold text-white hover:brightness-110 transition"
                  style={{ background: ACCENT }}>
                  إتمام ({r.offers.length} عرض)
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Center canvas — market demands */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-slate-900/40 flex items-center gap-2 flex-wrap text-xs">
          <Handshake className="w-4 h-4" style={{ color: ACCENT }} />
          <h3 className="text-xs font-bold">طلبات الصيدليات الأخرى</h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث..."
              className="ps-2 pe-7 py-1 rounded bg-slate-800 border border-border text-[11px] outline-none focus:ring-2"
              style={{ boxShadow: "none" }} />
          </div>
          <div className="flex-1" />
          <SortBtn active={sort === "available"} onClick={() => setSort("available")}
            icon={<PackageCheck className="w-3.5 h-3.5" />} label="الموجود أولاً" />
          <SortBtn active={sort === "alpha"} onClick={() => setSort("alpha")}
            icon={<ArrowDownAZ className="w-3.5 h-3.5" />} label="أبجدي" />
          <SortBtn active={sort === "margin"} onClick={() => setSort("margin")}
            icon={<TrendingUp className="w-3.5 h-3.5" />} label="هامش الطلب الأعلى" />
          <button onClick={() => setInsertOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold text-white hover:brightness-110"
            style={{ background: ACCENT }}>
            <Plus className="w-3.5 h-3.5" /> إدراج احتياج
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">اسم المادة</th>
                  <th className="px-3 py-2">الكمية والسعر المطلوب</th>
                  <th className="px-3 py-2">رصيدنا</th>
                  <th className="px-3 py-2">الكلفة / البيع</th>
                  <th className="px-3 py-2">حالة التوفر</th>
                  <th className="px-3 py-2">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ demand, stock, cost, retail, margin }) => {
                  const available = stock > 0;
                  const profitable = margin > 0 && Number.isFinite(margin);
                  return (
                    <tr key={demand.id}
                      className={`transition ${available ? "hover:bg-emerald/5" : "opacity-70 hover:bg-rose-500/5"}`}>
                      <td className={`px-3 py-2 text-xs font-bold ${available ? "text-emerald" : "text-rose-300"}`}>
                        {demand.itemName}
                        <div className="text-[10px] font-normal text-muted-foreground">{demand.pharmacy.name}</div>
                      </td>
                      <td className="px-3 py-2 text-[11px] font-mono">
                        <div>{demand.qty} وحدة</div>
                        <div className={demand.targetPrice != null ? "text-teal-300" : "text-muted-foreground"}>
                          {demand.targetPrice != null ? formatIQD(demand.targetPrice) : "بلا سعر محدد"}
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-xs font-mono font-bold ${available ? "text-emerald" : "text-rose-400"}`}>
                        {stock}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-mono">
                        <div className="text-muted-foreground">كلفة: {formatIQD(cost)}</div>
                        <div className={profitable ? "text-emerald" : ""}>بيع: {formatIQD(retail)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                          available
                            ? "bg-emerald/15 border-emerald/40 text-emerald"
                            : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                        }`}>
                          {available ? "متوفر" : "غير متوفر"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {demand.fulfilled ? (
                          <span className="text-[10px] text-emerald font-bold">تم الإرسال</span>
                        ) : (
                          <button onClick={() => setFulfillTarget(demand)}
                            className="px-3 py-1 rounded-lg text-[11px] font-bold text-white hover:brightness-110"
                            style={{ background: ACCENT }}>
                            إتمام
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-xs text-muted-foreground">
                      لا توجد طلبات من صيدليات أخرى حالياً
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {openRequest && (
        <OffersModal request={openRequest} onClose={() => setOpenRequest(null)}
          onDecide={(offerId, status) => decideOffer(openRequest.id, offerId, status)} />
      )}

      {fulfillTarget && (
        <FulfillModal demand={fulfillTarget} onClose={() => setFulfillTarget(null)}
          onSubmit={(price, qty) => {
            setDemands((prev) => prev.map((d) => (d.id === fulfillTarget.id ? { ...d, fulfilled: true } : d)));
            setFulfillTarget(null);
            toast.success(`تم إرسال عرضك (${qty} وحدة بسعر ${formatIQD(price)}) إلى ${fulfillTarget.pharmacy.name}`);
          }} />
      )}

      {insertOpen && (
        <InsertNeedModal meds={meds} onClose={() => setInsertOpen(false)}
          onSubmit={(itemName, qty, targetPrice) => {
            setRequests((prev) => [
              { id: `req-${Date.now()}`, itemName, qty, targetPrice, offers: [] },
              ...prev,
            ]);
            setInsertOpen(false);
            toast.success("تم إدراج الاحتياج ونشره على شبكة الصيدليات");
          }} />
      )}
    </div>
  );
}

function SortBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border transition ${
        active ? "text-white" : "border-border text-muted-foreground hover:text-foreground"
      }`}
      style={active ? { background: `${ACCENT}`, borderColor: ACCENT } : undefined}>
      {icon} {label}
    </button>
  );
}

function ModalShell({ title, onClose, children, width = "max-w-lg" }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose} dir="rtl">
      <div onClick={(e) => e.stopPropagation()}
        className={`w-full ${width} max-h-[85vh] overflow-auto rounded-2xl border border-border bg-slate-900 shadow-2xl animate-in zoom-in-95`}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2"
          style={{ background: `${ACCENT}22` }}>
          <h3 className="text-sm font-bold">{title}</h3>
          <button onClick={onClose} className="ms-auto text-muted-foreground hover:text-foreground">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function PharmacyMeta({ p }: { p: PharmacyInfo }) {
  return (
    <div className="grid grid-cols-1 gap-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" style={{ color: ACCENT }} />{p.phone}</span>
      <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" style={{ color: ACCENT }} />{p.location}</span>
      <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" style={{ color: ACCENT }} />{p.hours}</span>
    </div>
  );
}

function OffersModal({ request, onClose, onDecide }: {
  request: OurRequest;
  onClose: () => void;
  onDecide: (offerId: string, status: "accepted" | "rejected") => void;
}) {
  return (
    <ModalShell title={`عروض المواد — ${request.itemName}`} onClose={onClose} width="max-w-2xl">
      <div className="text-[11px] font-mono text-muted-foreground">
        الكمية المطلوبة: <span className="text-foreground">{request.qty}</span>
        {" · "}السعر المستهدف:{" "}
        <span className="text-foreground">
          {request.targetPrice != null ? formatIQD(request.targetPrice) : "بلا سعر محدد"}
        </span>
      </div>
      {request.offers.length === 0 && (
        <p className="text-xs text-muted-foreground py-6 text-center">لم تصل أي عروض بعد</p>
      )}
      <div className="space-y-2">
        {request.offers.map((o) => (
          <div key={o.id} className="rounded-xl border border-border bg-slate-950/50 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-teal-300">{o.pharmacy.name}</span>
              {o.status !== "pending" && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                  o.status === "accepted"
                    ? "bg-emerald/15 border-emerald/40 text-emerald"
                    : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                }`}>
                  {o.status === "accepted" ? "مقبول" : "مرفوض"}
                </span>
              )}
            </div>
            <PharmacyMeta p={o.pharmacy} />
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="px-2 py-1 rounded-lg bg-slate-800 border border-border">
                السعر المعروض: <span className="text-emerald font-bold">{formatIQD(o.unitPrice)}</span>
              </span>
              <span className="px-2 py-1 rounded-lg bg-slate-800 border border-border">
                الكمية المتوفرة: <span className="font-bold">{o.availableQty}</span>
              </span>
            </div>
            {o.status === "pending" && (
              <div className="flex gap-2">
                <button onClick={() => onDecide(o.id, "accepted")}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald text-primary-foreground text-[11px] font-bold hover:brightness-110">
                  <Check className="w-3.5 h-3.5" /> قبول العرض
                </button>
                <button onClick={() => onDecide(o.id, "rejected")}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-destructive text-white text-[11px] font-bold hover:brightness-110">
                  <Ban className="w-3.5 h-3.5" /> رفض العرض
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function FulfillModal({ demand, onClose, onSubmit }: {
  demand: MarketDemand; onClose: () => void; onSubmit: (price: number, qty: number) => void;
}) {
  const [price, setPrice] = useState<string>(demand.targetPrice != null ? String(demand.targetPrice) : "");
  const [qty, setQty] = useState<string>(String(demand.qty));
  const submit = () => {
    const p = Number(price), q = Number(qty);
    if (!p || p <= 0) return toast.error("أدخل سعراً صالحاً");
    if (!q || q <= 0) return toast.error("أدخل كمية صالحة");
    onSubmit(p, q);
  };
  return (
    <ModalShell title={`إتمام طلب — ${demand.itemName}`} onClose={onClose}>
      <div className="rounded-xl border border-border bg-slate-950/50 p-3 space-y-1.5">
        <div className="text-sm font-bold text-teal-300">{demand.pharmacy.name}</div>
        <PharmacyMeta p={demand.pharmacy} />
      </div>
      <div className="text-[11px] font-mono text-muted-foreground">
        الكمية المطلوبة: <span className="text-foreground">{demand.qty}</span>
        {" · "}السعر المطلوب:{" "}
        <span className="text-foreground">{demand.targetPrice != null ? formatIQD(demand.targetPrice) : "بلا سعر محدد"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">السعر المعروض</span>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-slate-800 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">الكمية المعروضة</span>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-full bg-slate-800 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none" />
        </label>
      </div>
      <button onClick={submit}
        className="w-full py-2 rounded-lg text-xs font-bold text-white hover:brightness-110"
        style={{ background: ACCENT }}>
        إرسال العرض إلى الصيدلية
      </button>
    </ModalShell>
  );
}

function InsertNeedModal({ meds, onClose, onSubmit }: {
  meds: Medicine[]; onClose: () => void;
  onSubmit: (itemName: string, qty: number, targetPrice: number | null) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");

  const suggestions = useMemo(() => {
    if (!q.trim() || picked === q) return [];
    return fuzzyFilter(q, meds, (m) => [m.trade_name, m.scientific_name, m.barcode ?? ""], { limit: 8 })
      .map((s) => s.item);
  }, [q, meds, picked]);

  const submit = () => {
    const name = (picked ?? q).trim();
    const n = Number(qty);
    if (!name) return toast.error("اختر المادة أولاً");
    if (!n || n <= 0) return toast.error("أدخل الكمية المطلوبة");
    onSubmit(name, n, price ? Number(price) : null);
  };

  return (
    <ModalShell title="إدراج احتياج" onClose={onClose}>
      <label className="block space-y-1 relative">
        <span className="text-[10px] text-muted-foreground">المادة (بحث ذكي / باركود)</span>
        <input value={q} autoFocus onChange={(e) => { setQ(e.target.value); setPicked(null); }}
          placeholder="اكتب اسم المادة أو امسح الباركود..."
          className="w-full bg-slate-800 border border-border rounded px-2 py-1.5 text-xs outline-none" />
        {suggestions.length > 0 && (
          <div className="absolute z-10 inset-x-0 top-full mt-1 max-h-52 overflow-auto rounded-lg border border-border bg-slate-900 shadow-xl">
            {suggestions.map((m) => (
              <button key={m.id} type="button"
                onClick={() => { setPicked(m.trade_name); setQ(m.trade_name); }}
                className="w-full text-right px-2 py-1.5 text-[11px] hover:bg-slate-800 flex items-center gap-2">
                <span className="flex-1 font-bold">{m.trade_name}</span>
                <span className={`font-mono ${m.quantity_in_stock > 0 ? "text-emerald" : "text-rose-400"}`}>
                  {m.quantity_in_stock}
                </span>
              </button>
            ))}
          </div>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">الكمية المطلوبة *</span>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-full bg-slate-800 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">السعر المستهدف (اختياري)</span>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-slate-800 border border-border rounded px-2 py-1.5 text-xs font-mono outline-none" />
        </label>
      </div>
      <button onClick={submit}
        className="w-full py-2 rounded-lg text-xs font-bold text-white hover:brightness-110"
        style={{ background: ACCENT }}>
        نشر الاحتياج
      </button>
    </ModalShell>
  );
}
