// Domain types and helpers for the pharmacy. No mock data — the system starts empty.
// Real medicines are stored in Lovable Cloud (see src/lib/db.ts).

export type ProductForm = "tablet" | "syrup";

export type Product = {
  id: string;
  barcode: string;
  tradeName: string;
  scientificName: string;
  boxCost: number;
  profitPct: number;
  stripsPerBox: number;
  pillsPerStrip: number;
  reorderHigh: number;
  reorderMin: number;
  notes: string;
  monthlyRate: number;
  totalPills: number;
  expiry: string;
  form: ProductForm;
  nonBarcoded: boolean;
};

// Round to nearest 500 IQD (pharmacy standard tick).
export function roundToNearest500(n: number) {
  return Math.round(n / 500) * 500;
}

// Round UP to nearest 250 IQD — used for auto-split retail on small units.
export function roundUpTo250(n: number) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / 250) * 250;
}

// Margin-on-sale pricing: profit % is relative to the SALE price, not cost.
// Sale = Cost / (1 - margin%). Auto-rounded to nearest 500 IQD.
// Example: cost 8000, margin 25% → 8000/0.75 = 10666.67 → 10500.
export function priceFromMarginOnSale(cost: number, marginPct: number) {
  const m = Math.min(0.95, Math.max(0, marginPct / 100));
  if (m >= 1) return roundToNearest500(cost);
  const raw = cost / (1 - m);
  return roundToNearest500(raw);
}

export function sellingPrice(p: Pick<Product, "boxCost" | "profitPct">) {
  return priceFromMarginOnSale(p.boxCost, p.profitPct);
}

export function breakdown(totalPills: number, stripsPerBox: number, pillsPerStrip: number) {
  const perBox = Math.max(1, stripsPerBox * pillsPerStrip);
  const boxes = Math.floor(totalPills / perBox);
  const rem1 = totalPills - boxes * perBox;
  const strips = Math.floor(rem1 / Math.max(1, pillsPerStrip));
  const pills = rem1 - strips * pillsPerStrip;
  return { boxes, strips, pills, perBox };
}

export function consumptionRate(p: Product, months: 1 | 3 = 1) {
  if (p.form === "syrup") {
    const perMonth = p.monthlyRate;
    return { value: perMonth * months, unit: "قطعة" as const };
  }
  const stripsPerMonth = p.monthlyRate / Math.max(1, p.pillsPerStrip);
  return { value: Math.round(stripsPerMonth * months * 10) / 10, unit: "شريط" as const };
}

// System starts empty — data lives in Lovable Cloud.
export const products: Product[] = [];

export function formatIQD(n: number) {
  return `${Math.round(n).toLocaleString()} د.ع`;
}
