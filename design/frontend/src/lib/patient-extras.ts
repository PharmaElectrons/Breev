// Patient extras persisted in Supabase (patient_extras + patient_weight_logs),
// plus global reservation and chronic-refill lists. Sync-looking API is backed
// by in-memory caches that hydrate on demand and update on mutation.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ChronicSchedule = {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  medicineId: string;
  medicineName: string;
  purchasedAt: string;
  daysPerCycle: number;
  reorderAlerted?: boolean;
  patientNotified?: boolean;
};

export type WeightLog = { id: string; date: string; kg: number };
export type Reservation = {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  medicineId: string;
  medicineName: string;
  qty: number;
  status: "pending" | "arrived";
  createdAt: string;
  notifiedAt?: string;
};

export type PatientExtras = {
  dob?: string;
  weights: WeightLog[];
};

const emptyExtras = (): PatientExtras => ({ weights: [] });

const extrasCache: Record<string, PatientExtras> = {};
const extrasHydrated = new Set<string>();
const extrasHydrating = new Set<string>();

let reservationsCache: Reservation[] = [];
let reservationsHydrated = false;
let reservationsHydrating = false;

let chronicCache: ChronicSchedule[] = [];
let chronicHydrated = false;
let chronicHydrating = false;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function reportError(scope: string, e: unknown) {
  console.error(`[patient-extras] ${scope} failed`, e);
  toast.error(`${scope}: ${e instanceof Error ? e.message : String(e)}`);
}

// ---- Extras (DOB + weight logs) ---------------------------------------
async function hydrateExtras(patientId: string) {
  if (extrasHydrated.has(patientId) || extrasHydrating.has(patientId)) return;
  extrasHydrating.add(patientId);
  try {
    const [ex, wl] = await Promise.all([
      supabase.from("patient_extras").select("dob").eq("patient_id", patientId).maybeSingle(),
      supabase
        .from("patient_weight_logs")
        .select("id,log_date,kg")
        .eq("patient_id", patientId)
        .order("log_date", { ascending: true }),
    ]);
    extrasCache[patientId] = {
      dob: (ex.data?.dob as string | null | undefined) ?? undefined,
      weights: (wl.data ?? []).map((r) => ({
        id: r.id as string,
        date: r.log_date as string,
        kg: Number(r.kg),
      })),
    };
    extrasHydrated.add(patientId);
    notify();
  } catch (e) {
    reportError("تحميل بيانات المريض", e);
  } finally {
    extrasHydrating.delete(patientId);
  }
}

export function getExtras(patientId: string): PatientExtras {
  if (!extrasHydrated.has(patientId)) {
    void hydrateExtras(patientId);
    return extrasCache[patientId] ?? emptyExtras();
  }
  return extrasCache[patientId] ?? emptyExtras();
}

export function setExtras(patientId: string, ex: PatientExtras) {
  extrasCache[patientId] = ex;
  extrasHydrated.add(patientId);
  notify();
  void persistExtras(patientId, ex);
}

async function persistExtras(patientId: string, ex: PatientExtras) {
  try {
    const up = await supabase
      .from("patient_extras")
      .upsert({ patient_id: patientId, dob: ex.dob ?? null }, { onConflict: "patient_id" });
    if (up.error) throw up.error;
    const del = await supabase.from("patient_weight_logs").delete().eq("patient_id", patientId);
    if (del.error) throw del.error;
    if (ex.weights.length) {
      const ins = await supabase.from("patient_weight_logs").insert(
        ex.weights.map((w) => ({
          id: w.id,
          patient_id: patientId,
          log_date: w.date,
          kg: w.kg,
        })),
      );
      if (ins.error) throw ins.error;
    }
  } catch (e) {
    reportError("حفظ بيانات المريض", e);
  }
}

export function useExtras(patientId: string | null): PatientExtras {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (patientId) void hydrateExtras(patientId);
  }, [patientId]);
  if (!patientId) return emptyExtras();
  return getExtras(patientId);
}

// ---- Reservations -----------------------------------------------------
async function hydrateReservations() {
  if (reservationsHydrated || reservationsHydrating) return;
  reservationsHydrating = true;
  try {
    const { data, error } = await supabase
      .from("patient_reservations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    reservationsCache = (data ?? []).map((r) => ({
      id: r.id as string,
      patientId: r.patient_id as string,
      patientName: r.patient_name as string,
      patientPhone: (r.patient_phone as string | null) ?? null,
      medicineId: r.medicine_id as string,
      medicineName: r.medicine_name as string,
      qty: Number(r.qty),
      status: r.status as "pending" | "arrived",
      createdAt: r.created_at as string,
      notifiedAt: (r.notified_at as string | null) ?? undefined,
    }));
    reservationsHydrated = true;
    notify();
  } catch (e) {
    reportError("تحميل الحجوزات", e);
  } finally {
    reservationsHydrating = false;
  }
}

export function listReservations(): Reservation[] {
  if (!reservationsHydrated) void hydrateReservations();
  return reservationsCache;
}

export function saveReservations(r: Reservation[]) {
  reservationsCache = r;
  reservationsHydrated = true;
  notify();
  void persistReservations(r);
}

async function persistReservations(r: Reservation[]) {
  try {
    const del = await supabase.from("patient_reservations").delete().gte("qty", 0);
    if (del.error) throw del.error;
    if (r.length) {
      const ins = await supabase.from("patient_reservations").insert(
        r.map((x) => ({
          id: x.id,
          patient_id: x.patientId,
          patient_name: x.patientName,
          patient_phone: x.patientPhone,
          medicine_id: x.medicineId,
          medicine_name: x.medicineName,
          qty: x.qty,
          status: x.status,
          created_at: x.createdAt,
          notified_at: x.notifiedAt ?? null,
        })),
      );
      if (ins.error) throw ins.error;
    }
  } catch (e) {
    reportError("حفظ الحجوزات", e);
  }
}

export function useReservations(): Reservation[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    void hydrateReservations();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return listReservations();
}

// ---- Chronic refill schedule ------------------------------------------
async function hydrateChronic() {
  if (chronicHydrated || chronicHydrating) return;
  chronicHydrating = true;
  try {
    const { data, error } = await supabase
      .from("chronic_schedule")
      .select("*")
      .order("purchased_at", { ascending: false });
    if (error) throw error;
    chronicCache = (data ?? []).map((r) => ({
      id: r.id as string,
      patientId: r.patient_id as string,
      patientName: r.patient_name as string,
      patientPhone: (r.patient_phone as string | null) ?? null,
      medicineId: r.medicine_id as string,
      medicineName: r.medicine_name as string,
      purchasedAt: r.purchased_at as string,
      daysPerCycle: Number(r.days_per_cycle),
      reorderAlerted: r.reorder_alerted as boolean,
      patientNotified: r.patient_notified as boolean,
    }));
    chronicHydrated = true;
    notify();
  } catch (e) {
    reportError("تحميل جدول الأدوية المزمنة", e);
  } finally {
    chronicHydrating = false;
  }
}

export function listChronicSchedule(): ChronicSchedule[] {
  if (!chronicHydrated) void hydrateChronic();
  return chronicCache;
}

export function saveChronicSchedule(v: ChronicSchedule[]) {
  chronicCache = v;
  chronicHydrated = true;
  notify();
  void persistChronic(v);
}

async function persistChronic(v: ChronicSchedule[]) {
  try {
    const del = await supabase.from("chronic_schedule").delete().gte("days_per_cycle", 0);
    if (del.error) throw del.error;
    if (v.length) {
      const ins = await supabase.from("chronic_schedule").insert(
        v.map((x) => ({
          id: x.id,
          patient_id: x.patientId,
          patient_name: x.patientName,
          patient_phone: x.patientPhone,
          medicine_id: x.medicineId,
          medicine_name: x.medicineName,
          purchased_at: x.purchasedAt,
          days_per_cycle: x.daysPerCycle,
          reorder_alerted: x.reorderAlerted ?? false,
          patient_notified: x.patientNotified ?? false,
        })),
      );
      if (ins.error) throw ins.error;
    }
  } catch (e) {
    reportError("حفظ جدول الأدوية المزمنة", e);
  }
}

export function useChronicSchedule(): ChronicSchedule[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    void hydrateChronic();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return listChronicSchedule();
}

export function addChronicSchedule(s: ChronicSchedule) {
  saveChronicSchedule([...listChronicSchedule(), s]);
}

export function chronicPhase(s: ChronicSchedule): {
  daysSince: number;
  daysLeft: number;
  phase: "ok" | "reorder" | "notify" | "overdue";
} {
  const purchased = new Date(s.purchasedAt).getTime();
  const daysSince = Math.max(0, Math.floor((Date.now() - purchased) / 86400000));
  const daysLeft = s.daysPerCycle - daysSince;
  let phase: "ok" | "reorder" | "notify" | "overdue" = "ok";
  if (daysLeft <= 0) phase = "overdue";
  else if (daysSince >= 9) phase = "notify";
  else if (daysSince >= 7) phase = "reorder";
  return { daysSince, daysLeft, phase };
}

/** Read the "حبة و أيام" cycle length from a medicine record. */
export function medicineDaysPerCycle(med: { days_per_cycle?: number | null } | null | undefined): number {
  if (!med) return 0;
  return Number(med.days_per_cycle ?? 0) || 0;
}

export function ageFromDob(dob?: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

export function isBirthdayToday(dob?: string): boolean {
  if (!dob) return false;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
