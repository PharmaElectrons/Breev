// Live database access for the pharmacy — Lovable Cloud (Supabase) via the browser client.
// All tables are shared between authenticated pharmacy users; RLS enforces sign-in.
import { supabase } from "@/integrations/supabase/client";

// ---- Medicines ----------------------------------------------------------
export type Medicine = {
  id: string;
  barcode: string | null;
  scientific_name: string;
  trade_name: string;
  strength: string | null;
  dosage_form: string | null;
  company: string | null;
  category: string | null;
  purchase_price: number;
  selling_price: number;
  quantity_in_stock: number;
  minimum_stock: number;
  maximum_stock: number;
  expiry_date: string | null;
  batch_number: string | null;
  location: string | null;
  notes: string | null;
  is_active: boolean;
  large_unit_name: string | null;
  large_unit_price: number;
  large_unit_cost: number;
  small_unit_name: string | null;
  small_unit_price: number;
  small_unit_cost: number;
  units_per_large: number;
  wholesale_large_price: number;
  wholesale_small_price: number;
  agent_price: number;
  days_per_cycle: number;
  /** Default doses per day, used as the sales-grid baseline. */
  daily_frequency: number;
  /** Food interaction: 'before' | 'after' | 'any'. */
  meal_timing: string;
  /** Visible on connected e-commerce / delivery / API channels. */
  publish_online: boolean;
  highlight_color: string | null;
  created_at: string;
  updated_at: string;
};

export type MedicineInput = Omit<Medicine, "id" | "created_at" | "updated_at">;

const FALLBACK_MEDICINES: Medicine[] = [
  {
    id: "med-1",
    barcode: "629110001001",
    trade_name: "Panadol Extra",
    scientific_name: "Paracetamol + Caffeine",
    strength: "500mg/65mg",
    dosage_form: "Tablet",
    company: "GSK",
    category: "مسكنات وألم",
    purchase_price: 2000,
    selling_price: 2500,
    quantity_in_stock: 45,
    minimum_stock: 10,
    maximum_stock: 100,
    expiry_date: "2027-12-31",
    batch_number: "PN-2024-01",
    location: "A1-02",
    notes: null,
    is_active: true,
    large_unit_name: "باكيت",
    large_unit_price: 25000,
    large_unit_cost: 20000,
    small_unit_name: "شريط",
    small_unit_price: 2500,
    small_unit_cost: 2000,
    units_per_large: 10,
    wholesale_large_price: 23000,
    wholesale_small_price: 2300,
    agent_price: 19000,
    days_per_cycle: 30,
    daily_frequency: 3,
    meal_timing: "after",
    publish_online: true,
    highlight_color: "#3b82f6",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "med-2",
    barcode: "629110001002",
    trade_name: "Amoxicillin 500mg",
    scientific_name: "Amoxicillin Trihydrate",
    strength: "500mg",
    dosage_form: "Capsule",
    company: "Julphar",
    category: "مضادات حيوية",
    purchase_price: 3500,
    selling_price: 5000,
    quantity_in_stock: 30,
    minimum_stock: 5,
    maximum_stock: 60,
    expiry_date: "2027-06-30",
    batch_number: "AMX-8841",
    location: "B2-01",
    notes: null,
    is_active: true,
    large_unit_name: "باكيت",
    large_unit_price: 10000,
    large_unit_cost: 7000,
    small_unit_name: "شريط",
    small_unit_price: 5000,
    small_unit_cost: 3500,
    units_per_large: 2,
    wholesale_large_price: 9000,
    wholesale_small_price: 4500,
    agent_price: 6500,
    days_per_cycle: 7,
    daily_frequency: 3,
    meal_timing: "before",
    publish_online: true,
    highlight_color: "#10b981",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "med-3",
    barcode: "629110001003",
    trade_name: "Augmentin 1g",
    scientific_name: "Amoxicillin + Clavulanate",
    strength: "1000mg",
    dosage_form: "Tablet",
    company: "GSK",
    category: "مضادات حيوية",
    purchase_price: 9000,
    selling_price: 12000,
    quantity_in_stock: 18,
    minimum_stock: 8,
    maximum_stock: 50,
    expiry_date: "2028-01-15",
    batch_number: "AUG-9912",
    location: "B2-03",
    notes: null,
    is_active: true,
    large_unit_name: "باكيت",
    large_unit_price: 12000,
    large_unit_cost: 9000,
    small_unit_name: "شريط",
    small_unit_price: 6000,
    small_unit_cost: 4500,
    units_per_large: 2,
    wholesale_large_price: 11000,
    wholesale_small_price: 5500,
    agent_price: 8500,
    days_per_cycle: 7,
    daily_frequency: 2,
    meal_timing: "after",
    publish_online: true,
    highlight_color: "#8b5cf6",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "med-4",
    barcode: "629110001004",
    trade_name: "Concor 5mg",
    scientific_name: "Bisoprolol Fumarate",
    strength: "5mg",
    dosage_form: "Tablet",
    company: "Merck",
    category: "أدوية القلب والضغط",
    purchase_price: 6000,
    selling_price: 8000,
    quantity_in_stock: 22,
    minimum_stock: 6,
    maximum_stock: 40,
    expiry_date: "2027-09-01",
    batch_number: "CNC-3301",
    location: "C1-04",
    notes: null,
    is_active: true,
    large_unit_name: "باكيت",
    large_unit_price: 16000,
    large_unit_cost: 12000,
    small_unit_name: "شريط",
    small_unit_price: 8000,
    small_unit_cost: 6000,
    units_per_large: 2,
    wholesale_large_price: 15000,
    wholesale_small_price: 7500,
    agent_price: 11500,
    days_per_cycle: 30,
    daily_frequency: 1,
    meal_timing: "any",
    publish_online: true,
    highlight_color: "#f59e0b",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
];

export async function listMedicines(): Promise<Medicine[]> {
  try {
    const { data, error } = await supabase
      .from("medicines")
      .select("*")
      .order("trade_name", { ascending: true });
    if (!error && data && data.length > 0) return data as Medicine[];
  } catch (err) {
    console.warn("Supabase listMedicines offline, using sample dataset:", err);
  }
  return FALLBACK_MEDICINES;
}

/**
 * Normalize a user-provided date string to PostgreSQL DATE format (YYYY-MM-DD).
 * Returns null for empty/undefined input. Throws for non-empty invalid values so
 * the caller can surface a clear message instead of PostgREST's
 * "invalid input syntax for type date".
 * Accepts: YYYY-MM-DD (HTML <input type="date">), DD/MM/YYYY, DD-MM-YYYY.
 */
export function normalizeDate(value: unknown, fieldLabel = "التاريخ"): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD (native <input type="date">)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY (also accepts 2-digit year → 20YY)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let y = parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    const m = parseInt(dmy[2], 10);
    const d = parseInt(dmy[1], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
        return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
          .toString()
          .padStart(2, "0")}`;
      }
    }
  }

  throw new Error(`${fieldLabel} غير صالح: "${s}". استخدم صيغة YYYY-MM-DD.`);
}

export async function createMedicine(input: Partial<MedicineInput>): Promise<Medicine> {
  // Keep legacy purchase_price/selling_price in sync with new small-unit cost/price
  // so POS and purchase flows keep working transparently.
  const smallCost = input.small_unit_cost ?? 0;
  const smallPrice = input.small_unit_price ?? 0;
  const payload = {
    scientific_name: input.scientific_name ?? "",
    trade_name: input.trade_name ?? "",
    barcode: input.barcode ?? null,
    strength: input.strength ?? null,
    dosage_form: input.dosage_form ?? null,
    company: input.company ?? null,
    category: input.category ?? null,
    purchase_price: smallCost,
    selling_price: smallPrice,
    quantity_in_stock: input.quantity_in_stock ?? 0,
    minimum_stock: input.minimum_stock ?? 0,
    maximum_stock: input.maximum_stock ?? 0,
    expiry_date: normalizeDate(input.expiry_date, "تاريخ الصلاحية"),
    batch_number: input.batch_number ?? null,
    location: input.location ?? null,
    notes: input.notes ?? null,
    is_active: input.is_active ?? true,
    large_unit_name: input.large_unit_name ?? null,
    large_unit_price: input.large_unit_price ?? 0,
    large_unit_cost: input.large_unit_cost ?? 0,
    small_unit_name: input.small_unit_name ?? null,
    small_unit_price: smallPrice,
    small_unit_cost: smallCost,
    units_per_large: input.units_per_large ?? 1,
    wholesale_large_price: input.wholesale_large_price ?? 0,
    wholesale_small_price: input.wholesale_small_price ?? 0,
    agent_price: input.agent_price ?? 0,
    days_per_cycle: input.days_per_cycle ?? 0,
    daily_frequency: Math.max(0, Number(input.daily_frequency ?? 1) || 1),
    meal_timing: ["before", "after", "any"].includes(String(input.meal_timing)) ? input.meal_timing : "any",
    publish_online: input.publish_online ?? false,
    highlight_color: (input.highlight_color ?? null) || null,
  };
  const { data, error } = await supabase.from("medicines").insert(payload).select("*").single();
  if (error) throw error;
  return data as Medicine;
}

export async function updateMedicine(id: string, patch: Partial<MedicineInput>): Promise<Medicine> {
  const sync: Partial<MedicineInput> = { ...patch };
  if (patch.small_unit_cost !== undefined) sync.purchase_price = patch.small_unit_cost;
  if (patch.small_unit_price !== undefined) sync.selling_price = patch.small_unit_price;
  // Normalize any date fields present in the patch. Empty strings → null.
  if ("expiry_date" in patch) {
    sync.expiry_date = normalizeDate(patch.expiry_date, "تاريخ الصلاحية");
  }
  if ("highlight_color" in patch) {
    sync.highlight_color = (patch.highlight_color ?? null) || null;
  }
  const { data, error } = await supabase
    .from("medicines")
    .update(sync)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Medicine;
}

export async function deleteMedicine(id: string): Promise<void> {
  const { error } = await supabase.from("medicines").delete().eq("id", id);
  if (error) throw error;
}

// ---- Patients -----------------------------------------------------------
export type PatientRow = {
  id: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  gender: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  chronic_diseases: string[];
  chronic_meds: string[];
  interests: string[];
  notes: string | null;
  is_smoker: boolean;
  uses_alcohol: boolean;
  has_allergy: boolean;
  allergies: string[];
  created_at: string;
};

const FALLBACK_PATIENTS: PatientRow[] = [
  {
    id: "pat-1",
    full_name: "أحمد علي حسين",
    phone: "07701234567",
    address: "بغداد - الكرادة",
    gender: "male",
    age: 45,
    height_cm: 175,
    weight_kg: 82,
    chronic_diseases: ["الضغط", "السكري"],
    chronic_meds: ["Concor 5mg"],
    interests: [],
    notes: "مريض منتظم",
    is_smoker: true,
    uses_alcohol: false,
    has_allergy: false,
    allergies: [],
    created_at: new Date().toISOString(),
  },
  {
    id: "pat-2",
    full_name: "فاطمة محمد كاظم",
    phone: "07809876543",
    address: "بغداد - المنصور",
    gender: "female",
    age: 38,
    height_cm: 162,
    weight_kg: 68,
    chronic_diseases: [],
    chronic_meds: [],
    interests: [],
    notes: "حساسية من البنسلين",
    is_smoker: false,
    uses_alcohol: false,
    has_allergy: true,
    allergies: ["Penicillin"],
    created_at: new Date().toISOString(),
  },
];

export async function listPatients(): Promise<PatientRow[]> {
  try {
    const { data, error } = await supabase
      .from("patients")
      .select("*")
      .order("full_name", { ascending: true });
    if (!error && data && data.length > 0) return data as PatientRow[];
  } catch (err) {
    console.warn("Supabase listPatients offline, using sample dataset:", err);
  }
  return FALLBACK_PATIENTS;
}

export async function createPatient(p: Partial<PatientRow>): Promise<PatientRow> {
  const payload = {
    full_name: p.full_name ?? "",
    phone: p.phone ?? null,
    address: p.address ?? null,
    gender: p.gender ?? null,
    age: p.age ?? null,
    height_cm: p.height_cm ?? null,
    weight_kg: p.weight_kg ?? null,
    chronic_diseases: p.chronic_diseases ?? [],
    chronic_meds: p.chronic_meds ?? [],
    interests: p.interests ?? [],
    notes: p.notes ?? null,
    is_smoker: p.is_smoker ?? false,
    uses_alcohol: p.uses_alcohol ?? false,
    has_allergy: p.has_allergy ?? false,
    allergies: p.allergies ?? [],
  };

  const { data, error } = await supabase.from("patients").insert(payload).select("*").single();
  if (error) throw error;
  return data as PatientRow;
}

export async function updatePatient(id: string, patch: Partial<PatientRow>): Promise<PatientRow> {
  const { data, error } = await supabase
    .from("patients")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as PatientRow;
}

export async function deletePatient(id: string): Promise<void> {
  const { error } = await supabase.from("patients").delete().eq("id", id);
  if (error) throw error;
}

// ---- Sales invoices -----------------------------------------------------
export type SaleItemInput = {
  medicine_id: string;
  qty: number;
  unit_price: number;
};

export type SaleInvoice = {
  id: string;
  invoice_no: number;
  patient_id: string | null;
  status: string;
  payment_type: string;
  subtotal: number;
  discount: number;
  addon: number;
  total: number;
  created_at: string;
};

export async function listSalesInvoices(limit = 30): Promise<SaleInvoice[]> {
  const { data, error } = await supabase
    .from("sales_invoices")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SaleInvoice[];
}

export async function saveSaleInvoice(args: {
  patient_id: string | null;
  status: "saved" | "suspended";
  payment_type: "cash" | "credit" | "partial";
  discount: number;
  addon: number;
  paid_amount?: number;
  items: SaleItemInput[];
}): Promise<SaleInvoice> {
  const subtotal = args.items.reduce((s, it) => s + it.qty * it.unit_price, 0);
  const total = Math.max(0, subtotal + args.addon - args.discount);
  const paid_amount =
    args.payment_type === "cash"
      ? total
      : args.payment_type === "credit"
        ? 0
        : Math.max(0, Math.min(total, Number(args.paid_amount) || 0));

  const { data: user } = await supabase.auth.getUser();

  const { data: invoice, error: invErr } = await supabase
    .from("sales_invoices")
    .insert({
      patient_id: args.patient_id,
      status: args.status,
      payment_type: args.payment_type,
      subtotal,
      discount: args.discount,
      addon: args.addon,
      total,
      paid_amount,
      created_by: user.user?.id ?? null,
    })
    .select("*")
    .single();
  if (invErr) throw invErr;

  if (args.items.length > 0) {
    const rows = args.items.map((it) => ({
      invoice_id: (invoice as SaleInvoice).id,
      medicine_id: it.medicine_id,
      qty: it.qty,
      unit_price: it.unit_price,
      line_total: it.qty * it.unit_price,
    }));
    const { error: itemsErr } = await supabase.from("sales_invoice_items").insert(rows);
    if (itemsErr) throw itemsErr;
  }

  return invoice as SaleInvoice;
}


// ---- Alerts -------------------------------------------------------------
export async function listLowStock(): Promise<Medicine[]> {
  const { data, error } = await supabase.from("low_stock_medicines").select("*");
  if (error) throw error;
  return (data ?? []) as Medicine[];
}

export async function listExpiring(): Promise<Medicine[]> {
  const { data, error } = await supabase.from("expiring_medicines").select("*");
  if (error) throw error;
  return (data ?? []) as Medicine[];
}

// Aggregate sold qty per medicine within a datetime range (ISO strings).
export async function getConsumptionByMedicine(
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("sales_invoice_items")
    .select("medicine_id, qty, sales_invoices!inner(created_at)")
    .gte("sales_invoices.created_at", from)
    .lte("sales_invoices.created_at", to);
  if (error) throw error;
  const agg: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ medicine_id: string; qty: number }>) {
    agg[row.medicine_id] = (agg[row.medicine_id] ?? 0) + Number(row.qty || 0);
  }
  return agg;
}
