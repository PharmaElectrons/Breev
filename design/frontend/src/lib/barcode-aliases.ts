// Multiple barcode aliases per medicine (client-only persistence).
const KEY = "breef.barcodeAliases.v1";

type Map = Record<string, string[]>;

function read(): Map {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const obj = raw ? (JSON.parse(raw) as Map) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function write(map: Map) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(map));
}

export function getBarcodeAliases(medicineId: string): string[] {
  const list = read()[medicineId];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

export function setBarcodeAliases(medicineId: string, aliases: string[]) {
  const map = read();
  const clean = Array.from(new Set(aliases.map((a) => a.trim()).filter(Boolean)));
  if (clean.length === 0) delete map[medicineId];
  else map[medicineId] = clean;
  write(map);
}
