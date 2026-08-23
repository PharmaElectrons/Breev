import { useState } from "react";

export type BarcodeItem = {
  id: string;
  barcode: string;
  tradeName: string;
  price: number;
};

export function BarcodePrintPanel({
  items,
  onClose,
}: {
  items: { item: BarcodeItem; copies: number }[];
  onClose: () => void;
}) {
  const labels = items.flatMap(({ item, copies }) =>
    Array.from({ length: copies }, (_, i) => ({ ...item, key: `${item.id}-${i}` })),
  );
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm grid place-items-center p-8 animate-reveal">
      <div className="bg-slate-900 border border-emerald/30 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl shadow-emerald/10">
        <header className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-[10px] text-emerald font-bold uppercase tracking-widest">معاينة الطباعة</p>
            <h3 className="text-lg font-bold">ملصقات الباركود ({labels.length})</h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-emerald text-primary-foreground rounded-lg text-xs font-bold shadow-lg shadow-emerald/30"
            >
              طباعة الآن
            </button>
            <button onClick={onClose} className="px-4 py-2 bg-slate-800 border border-border rounded-lg text-xs font-bold">
              إغلاق
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-5 bg-slate-950/40">
          <div className="grid grid-cols-3 gap-3">
            {labels.map((l) => (
              <BarcodeLabel key={l.key} item={l} />
            ))}
            {labels.length === 0 && (
              <p className="col-span-3 text-center text-muted-foreground text-sm py-12">
                لا توجد ملصقات مختارة
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BarcodeLabel({ item }: { item: BarcodeItem }) {
  return (
    <div className="bg-white text-slate-950 rounded-md p-3 space-y-1.5 text-center shadow" dir="ltr">
      <p className="text-xs font-bold truncate" dir="rtl">{item.tradeName}</p>
      <BarcodeSVG value={item.barcode} />
      <p className="font-mono text-[10px] tracking-widest">{item.barcode}</p>
      <p className="font-mono text-sm font-bold" dir="rtl">
        {item.price.toLocaleString()} د.ع
      </p>
    </div>
  );
}

function BarcodeSVG({ value }: { value: string }) {
  // Simple visual barcode from digits (not scannable — for preview).
  const bars = value.split("").map((c) => (parseInt(c, 10) || 1) + 1);
  let x = 0;
  const total = bars.reduce((s, w) => s + w, 0);
  return (
    <svg viewBox={`0 0 ${total} 40`} className="w-full h-10">
      {bars.map((w, i) => {
        const rect = (
          <rect key={i} x={x} y={0} width={i % 2 === 0 ? w : w * 0.6} height={40} fill="#0a0a0a" />
        );
        x += w;
        return rect;
      })}
    </svg>
  );
}

export function useBarcodeSelection<T extends BarcodeItem>() {
  const [selected, setSelected] = useState<Record<string, number>>({});
  const toggle = (id: string) =>
    setSelected((s) => {
      if (s[id]) {
        const next = { ...s };
        delete next[id];
        return next;
      }
      return { ...s, [id]: 1 };
    });
  const setCopies = (id: string, n: number) =>
    setSelected((s) => (s[id] ? { ...s, [id]: Math.max(1, n) } : s));
  const clear = () => setSelected({});
  const build = (source: T[]) =>
    Object.entries(selected)
      .map(([id, copies]) => {
        const item = source.find((x) => x.id === id);
        return item ? { item, copies } : null;
      })
      .filter(Boolean) as { item: T; copies: number }[];
  return { selected, toggle, setCopies, clear, build, count: Object.keys(selected).length };
}
