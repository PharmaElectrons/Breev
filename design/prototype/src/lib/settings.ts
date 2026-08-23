// Global app settings (client-only, persisted in localStorage).
import { useEffect, useState } from "react";

export type FlagKey = "loss" | "needsBarcode" | "expired" | "frozen" | "cold";

export type FlagRule = {
  enabled: boolean;
  color: string;
  label: string;
};

export type BranchInfo = {
  name: string;
  phone: string;
  address: string;
};

export type InvoiceRounding = {
  enabled: boolean;
  nearest: number; // round total to nearest N IQD (e.g. 250, 500, 1000)
  mode: "nearest" | "up" | "down";
};

export type Settings = {
  missingBarcodeColor: string; // legacy — kept for purchase page compatibility
  flags: Record<FlagKey, FlagRule>;
  branch: BranchInfo;
  invoiceRounding: InvoiceRounding;
};

const DEFAULT: Settings = {
  missingBarcodeColor: "#FDE68A",
  flags: {
    loss: { enabled: true, color: "#EF4444", label: "خسارة سعرية" },
    needsBarcode: { enabled: true, color: "#F97316", label: "تحتاج طباعة باركود" },
    expired: { enabled: true, color: "#22C55E", label: "منتهية الصلاحية" },
    frozen: { enabled: true, color: "#A855F7", label: "مجمدة لصالح الأقرب انتهاء" },
    cold: { enabled: true, color: "#94A3B8", label: "تخزن في البراد" },
  },
  branch: { name: "الفرع الرئيسي", phone: "", address: "" },
  invoiceRounding: { enabled: false, nearest: 250, mode: "nearest" },
};


const KEY = "breef.settings.v2";

function read(): Settings {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT,
      ...parsed,
      flags: { ...DEFAULT.flags, ...(parsed.flags ?? {}) },
      branch: { ...DEFAULT.branch, ...(parsed.branch ?? {}) },
      invoiceRounding: { ...DEFAULT.invoiceRounding, ...(parsed.invoiceRounding ?? {}) },
    };
  } catch {
    return DEFAULT;
  }
}

const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return read();
}

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...read(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l(next));
}

export function updateFlag(key: FlagKey, patch: Partial<FlagRule>) {
  const cur = read();
  const next: Settings = {
    ...cur,
    flags: { ...cur.flags, [key]: { ...cur.flags[key], ...patch } },
  };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l(next));
}

export function updateBranch(patch: Partial<BranchInfo>) {
  const cur = read();
  const next: Settings = { ...cur, branch: { ...cur.branch, ...patch } };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l(next));
}

export function updateInvoiceRounding(patch: Partial<InvoiceRounding>) {
  const cur = read();
  const next: Settings = { ...cur, invoiceRounding: { ...cur.invoiceRounding, ...patch } };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l(next));
}

export function applyInvoiceRounding(total: number, rule?: InvoiceRounding): number {
  const r = rule ?? read().invoiceRounding;
  if (!r.enabled || !r.nearest || r.nearest <= 0) return Math.round(total);
  const n = r.nearest;
  if (r.mode === "up") return Math.ceil(total / n) * n;
  if (r.mode === "down") return Math.floor(total / n) * n;
  return Math.round(total / n) * n;
}


export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT);
  useEffect(() => {
    setS(read());
    const l = (n: Settings) => setS(n);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return s;
}
