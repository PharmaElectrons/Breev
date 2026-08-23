// Clinical history for patients — persisted in Supabase (patient_visits,
// patient_labs, patient_pharmacy_history). Sync-looking API is backed by an
// in-memory cache that hydrates on first access; mutations write through to
// the database and notify subscribers.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PharmacyEntry = {
  id: string;
  item: string;
  firstPurchase: string; // YYYY-MM-DD
  lastPurchase: string;
};

export type LabEntry = {
  id: string;
  test: string;
  date: string;
  value: string;
};

export type VisitEntry = {
  id: string;
  doctor: string;
  specialty?: string;
  date: string;
  diagnosis: string;
  prescribed: string[];
};

export type ClinicalRecord = {
  pharmacy: PharmacyEntry[];
  labs: LabEntry[];
  visits: VisitEntry[];
};

const EMPTY: ClinicalRecord = { pharmacy: [], labs: [], visits: [] };

const cache: Record<string, ClinicalRecord> = {};
const hydrated = new Set<string>();
const hydrating = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

async function hydrate(patientId: string) {
  if (hydrated.has(patientId) || hydrating.has(patientId)) return;
  hydrating.add(patientId);
  try {
    const [ph, la, vi] = await Promise.all([
      supabase
        .from("patient_pharmacy_history")
        .select("id,item,first_purchase,last_purchase")
        .eq("patient_id", patientId)
        .order("last_purchase", { ascending: false }),
      supabase
        .from("patient_labs")
        .select("id,test,lab_date,value_text")
        .eq("patient_id", patientId)
        .order("lab_date", { ascending: false }),
      supabase
        .from("patient_visits")
        .select("id,doctor,specialty,visit_date,diagnosis,prescribed")
        .eq("patient_id", patientId)
        .order("visit_date", { ascending: false }),
    ]);
    cache[patientId] = {
      pharmacy: (ph.data ?? []).map((r) => ({
        id: r.id as string,
        item: r.item as string,
        firstPurchase: r.first_purchase as string,
        lastPurchase: r.last_purchase as string,
      })),
      labs: (la.data ?? []).map((r) => ({
        id: r.id as string,
        test: r.test as string,
        date: r.lab_date as string,
        value: r.value_text as string,
      })),
      visits: (vi.data ?? []).map((r) => ({
        id: r.id as string,
        doctor: r.doctor as string,
        specialty: (r.specialty as string | null) ?? undefined,
        date: r.visit_date as string,
        diagnosis: r.diagnosis as string,
        prescribed: (r.prescribed as string[] | null) ?? [],
      })),
    };
    hydrated.add(patientId);
    notify();
  } catch (e) {
    console.error("[clinical] hydrate failed", e);
  } finally {
    hydrating.delete(patientId);
  }
}

export function getClinical(patientId: string): ClinicalRecord {
  if (!hydrated.has(patientId)) {
    void hydrate(patientId);
    return cache[patientId] ?? EMPTY;
  }
  return cache[patientId] ?? EMPTY;
}

/** Full-replace save: diff each subtable via delete-all + insert-all for this patient. */
export function setClinical(patientId: string, rec: ClinicalRecord) {
  cache[patientId] = rec;
  hydrated.add(patientId);
  notify();
  void persistClinical(patientId, rec);
}

async function persistClinical(patientId: string, rec: ClinicalRecord) {
  try {
    const [dph, dla, dvi] = await Promise.all([
      supabase.from("patient_pharmacy_history").delete().eq("patient_id", patientId),
      supabase.from("patient_labs").delete().eq("patient_id", patientId),
      supabase.from("patient_visits").delete().eq("patient_id", patientId),
    ]);
    if (dph.error) throw dph.error;
    if (dla.error) throw dla.error;
    if (dvi.error) throw dvi.error;

    if (rec.pharmacy.length) {
      const { error } = await supabase.from("patient_pharmacy_history").insert(
        rec.pharmacy.map((p) => ({
          id: p.id,
          patient_id: patientId,
          item: p.item,
          first_purchase: p.firstPurchase,
          last_purchase: p.lastPurchase,
        })),
      );
      if (error) throw error;
    }
    if (rec.labs.length) {
      const { error } = await supabase.from("patient_labs").insert(
        rec.labs.map((l) => ({
          id: l.id,
          patient_id: patientId,
          test: l.test,
          lab_date: l.date,
          value_text: l.value,
        })),
      );
      if (error) throw error;
    }
    if (rec.visits.length) {
      const { error } = await supabase.from("patient_visits").insert(
        rec.visits.map((v) => ({
          id: v.id,
          patient_id: patientId,
          doctor: v.doctor,
          specialty: v.specialty ?? null,
          visit_date: v.date,
          diagnosis: v.diagnosis,
          prescribed: v.prescribed,
        })),
      );
      if (error) throw error;
    }

  } catch (e) {
    console.error("[clinical] persist failed", e);
    toast.error(`تعذّر حفظ السجل السريري: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Kept for import compatibility. No-op — demo data has been removed. */
export function ensureAbuYusufSeed(_patientId: string, _name: string) {
  /* intentionally empty */
}

export function useClinical(patientId: string | null): ClinicalRecord {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (patientId) void hydrate(patientId);
  }, [patientId]);
  if (!patientId) return EMPTY;
  return getClinical(patientId);
}
