// Patient domain types and helpers. No mock data — real records live in Lovable Cloud.

export type PurchaseHistory = {
  itemId: string;
  itemName: string;
  firstPurchase: string;
  lastPurchase: string;
  cumulativeQty: number;
  dailyDose: number;
  chronic: boolean;
};

export type LabResult = {
  id: string;
  name: string;
  date: string;
  value: number;
  unit: string;
  ref: [number, number];
  previous?: { value: number; date: string };
};

export type Visit = {
  id: string;
  date: string;
  doctor: string;
  diagnosis: string;
  prescribed: string[];
};

export type Patient = {
  id: string;
  fullName: string;
  phone: string;
  age: number;
  heightCm: number;
  weightKg: number;
  chronicDiseases: string[];
  chronicMeds: string[];
  history: PurchaseHistory[];
  labs: LabResult[];
  visits: Visit[];
};

export function bmi(heightCm: number, weightKg: number): number {
  if (!heightCm || !weightKg) return 0;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";
export function bmiCategory(v: number): BmiCategory {
  if (v < 18.5) return "underweight";
  if (v < 25) return "normal";
  if (v < 30) return "overweight";
  return "obese";
}

export function labIsCritical(l: LabResult): boolean {
  return l.value < l.ref[0] || l.value > l.ref[1];
}

const INTERACTIONS: Array<{
  match: RegExp;
  conditions: string[];
  labFlag?: { name: RegExp; over?: number; under?: number };
  message: { ar: string; en: string };
}> = [
  {
    match: /NSAID|Ibuprofen|Diclofenac|Naproxen|بروفين|ديكلوفيناك|نابروكسين/i,
    conditions: ["kidney", "كلى", "قصور كلوي", "chronic kidney"],
    labFlag: { name: /creatinine|كرياتينين/i, over: 1.3 },
    message: {
      ar: "تحذير سريري: مضادات الالتهاب غير الستيرويدية قد تؤذي الكلى.",
      en: "Clinical warning: NSAIDs may harm kidneys in CKD patients.",
    },
  },
];

export function checkInteractions(
  patient: Patient,
  productName: string,
  lang: "ar" | "en",
): string[] {
  const alerts: string[] = [];
  const cond = patient.chronicDiseases.map((c) => c.toLowerCase());
  for (const rule of INTERACTIONS) {
    if (!rule.match.test(productName)) continue;
    const conditionHit = rule.conditions.some((k) =>
      cond.some((c) => c.includes(k.toLowerCase())),
    );
    if (conditionHit) alerts.push(rule.message[lang]);
  }
  return alerts;
}

export function refillStatus(h: PurchaseHistory, today = new Date()) {
  const last = new Date(h.lastPurchase);
  const daysSince = Math.max(0, Math.floor((today.getTime() - last.getTime()) / 86400000));
  const daysSupply = h.dailyDose > 0 ? Math.floor(h.cumulativeQty / h.dailyDose) : 0;
  const daysLeft = Math.max(0, daysSupply - daysSince);
  const pct = daysSupply > 0 ? Math.min(100, Math.round((daysSince / daysSupply) * 100)) : 0;
  return { daysSince, daysSupply, daysLeft, pct };
}

// System starts empty — real patient records live in Lovable Cloud.
export const patients: Patient[] = [];
