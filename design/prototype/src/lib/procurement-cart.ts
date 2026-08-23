// Lightweight in-memory + localStorage-backed procurement cart shared
// between the Reports "Today's Sales" view, POS quick-add, and the
// "سلة الطلبات" (Orders Basket) workspace.
import { useEffect, useState } from "react";

export type CartStatus = "order" | "out";

export type CartItem = {
  medicineId: string;
  barcode: string | null;
  name: string;
  currentStock: number;
  minimum: number;
  maximum: number;
  suggestedQty: number;
  addedAt: string;
  status?: CartStatus;
};

const KEY = "breef.procurement.cart.v1";
const listeners = new Set<() => void>();
const notify = () => {
  listeners.forEach((l) => l());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("breef:cart-changed"));
  }
};

function load(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as CartItem[]) : [];
    return arr.map((c) => ({ ...c, status: c.status ?? "order" }));
  } catch {
    return [];
  }
}

function save(items: CartItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(items));
  notify();
}

export function getCart(): CartItem[] {
  return load();
}

export function addToCart(item: CartItem) {
  const cur = load();
  const existing = cur.find((c) => c.medicineId === item.medicineId);
  if (existing) {
    existing.suggestedQty += item.suggestedQty;
    save(cur);
  } else {
    save([...cur, { ...item, status: item.status ?? "order" }]);
  }
}

export function removeFromCart(medicineId: string) {
  save(load().filter((c) => c.medicineId !== medicineId));
}

export function updateQty(medicineId: string, qty: number) {
  const cur = load().map((c) =>
    c.medicineId === medicineId ? { ...c, suggestedQty: Math.max(0, qty) } : c,
  );
  save(cur);
}

export function setCartStatus(medicineId: string, status: CartStatus) {
  const cur = load().map((c) => (c.medicineId === medicineId ? { ...c, status } : c));
  save(cur);
}

export function toggleCartStatus(medicineId: string) {
  const cur = load().map((c) =>
    c.medicineId === medicineId
      ? { ...c, status: (c.status ?? "order") === "order" ? "out" : "order" }
      : c,
  );
  save(cur as CartItem[]);
}

export function replaceCart(items: CartItem[]) {
  save(items.map((c) => ({ ...c, status: c.status ?? "order" })));
}

export function clearCart() {
  save([]);
}

export function useCart(): CartItem[] {
  const [items, setItems] = useState<CartItem[]>(() => load());
  useEffect(() => {
    const l = () => setItems(load());
    listeners.add(l);
    window.addEventListener("breef:cart-changed", l);
    window.addEventListener("storage", l);
    return () => {
      listeners.delete(l);
      window.removeEventListener("breef:cart-changed", l);
      window.removeEventListener("storage", l);
    };
  }, []);
  return items;
}
