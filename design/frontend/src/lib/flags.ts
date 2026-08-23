// Compute active alert flags for a medicine based on user settings.
import type { Medicine } from "@/lib/db";
import type { FlagKey, Settings } from "@/lib/settings";

export type ActiveFlag = { key: FlagKey; color: string; label: string };

// Medicines can carry these optional client-side markers (stored in the notes
// column as JSON tags, or via UI toggles later). For now we detect them by
// simple string patterns embedded in notes to avoid a DB migration.
function noteHas(m: Medicine, tag: string) {
  return (m.notes ?? "").toLowerCase().includes(tag.toLowerCase());
}

export function computeFlags(m: Medicine, all: Medicine[], settings: Settings): ActiveFlag[] {
  const out: ActiveFlag[] = [];
  const f = settings.flags;

  if (f.loss?.enabled && Number(m.purchase_price) > 0 && Number(m.selling_price) > 0 && Number(m.purchase_price) > Number(m.selling_price)) {
    out.push({ key: "loss", color: f.loss.color, label: f.loss.label });
  }

  if (f.needsBarcode?.enabled && (!m.barcode || noteHas(m, "#needs-barcode"))) {
    out.push({ key: "needsBarcode", color: f.needsBarcode.color, label: f.needsBarcode.label });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (f.expired?.enabled && m.expiry_date && m.expiry_date < today) {
    out.push({ key: "expired", color: f.expired.color, label: f.expired.label });
  }

  if (f.frozen?.enabled && m.expiry_date && m.scientific_name) {
    const closer = all.find(
      (o) =>
        o.id !== m.id &&
        o.scientific_name?.trim().toLowerCase() === m.scientific_name.trim().toLowerCase() &&
        o.expiry_date &&
        o.expiry_date < (m.expiry_date as string) &&
        o.expiry_date >= today,
    );
    if (closer) out.push({ key: "frozen", color: f.frozen.color, label: f.frozen.label });
  }

  if (f.cold?.enabled && (noteHas(m, "براد") || noteHas(m, "cold") || noteHas(m, "#cold"))) {
    out.push({ key: "cold", color: f.cold.color, label: "تخزن في البراد" });
  }

  return out;
}

export function primaryFlagColor(flags: ActiveFlag[]): string | null {
  return flags[0]?.color ?? null;
}
