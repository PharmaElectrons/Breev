// Lightweight in-memory map of medicine → highlight color, used to tint
// invoice rows across the sales and purchases workspaces.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const listeners = new Set<(m: Map<string, string>) => void>();
let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

async function fetchColors(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("medicines")
    .select("id, highlight_color")
    .not("highlight_color", "is", null);
  const m = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; highlight_color: string | null }>) {
    if (row.highlight_color) m.set(row.id, row.highlight_color);
  }
  cache = m;
  listeners.forEach((l) => l(m));
  return m;
}

export function primeMedicineColors(): Promise<Map<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) inflight = fetchColors().finally(() => { inflight = null; });
  return inflight;
}

export function setMedicineColor(id: string, color: string | null) {
  const m = new Map(cache ?? []);
  if (color) m.set(id, color); else m.delete(id);
  cache = m;
  listeners.forEach((l) => l(m));
}

export function useMedicineColors(): Map<string, string> {
  const [m, setM] = useState<Map<string, string>>(cache ?? new Map());
  useEffect(() => {
    listeners.add(setM);
    void primeMedicineColors();
    return () => { listeners.delete(setM); };
  }, []);
  return m;
}

// Convert an arbitrary hex like #FDE68A to an rgba() with the given alpha,
// so the row tint stays subtle over the app background.
export function tintFromHex(hex: string, alpha = 0.22): string {
  const h = hex.replace("#", "").trim();
  if (h.length !== 3 && h.length !== 6) return hex;
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
