// Quick-access items: pharmacist-curated fast-add slots (client-only persistence).
import { useEffect, useState } from "react";

const KEY = "breef.quickAccess.v1";
const listeners = new Set<(ids: string[]) => void>();

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((l) => l(ids));
}

export function getQuickAccess(): string[] {
  return read();
}

export function addQuickAccess(id: string) {
  const cur = read();
  if (cur.includes(id)) return;
  write([...cur, id]);
}

export function removeQuickAccess(id: string) {
  write(read().filter((x) => x !== id));
}

export function useQuickAccess(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    setIds(read());
    const l = (n: string[]) => setIds(n);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return ids;
}
