// Lightweight i18n with localStorage persistence + document dir sync.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "ar" | "en";

type Dict = Record<string, { ar: string; en: string }>;

const D: Dict = {
  // Header / nav
  "brand.suffix": { ar: "Pharmacy", en: "Pharmacy" },
  "nav.dashboard": { ar: "القائمة الرئيسية", en: "Main Dashboard" },
  "nav.sales": { ar: "البيع", en: "Sales" },
  "nav.purchases": { ar: "المشتريات", en: "Purchases" },
  "nav.inventory": { ar: "المخزن", en: "Inventory" },
  "nav.products": { ar: "المواد", en: "Products" },
  "nav.reports": { ar: "التقارير", en: "Reports" },
  "nav.accounts": { ar: "الحسابات", en: "Accounts" },
  "nav.employees": { ar: "الموظفين والأدوار", en: "Employees & Roles" },
  "nav.settings": { ar: "الإعدادات", en: "Settings" },
  "nav.patients": { ar: "الملف الصحي", en: "Patient Profile" },
  "nav.messages": { ar: "إرسال رسالة", en: "Send Message" },
 "nav.cart": { ar: "سلة الطلبات", en: "Orders Basket" },
 "nav.integration": { ar: "ربط خارجي", en: "External Integration" },
  "lang.toggle": { ar: "العربية ⇄ English", en: "English ⇄ العربية" },

  // Page titles
  "page.sales": { ar: "شاشة البيع", en: "Sales Screen" },
  "page.purchases": { ar: "المشتريات", en: "Purchases" },
  "page.inventory": { ar: "المخزن", en: "Inventory" },
  "page.products": { ar: "المواد", en: "Products" },
  "page.reports": { ar: "التقارير", en: "Reports" },
  "page.settings": { ar: "الإعدادات", en: "Settings" },
  "page.patients": { ar: "الملف الصحي للمريض", en: "Patient Profile" },

  // Patients module
  "patient.search": { ar: "🔎 ابحث بالاسم أو رقم الهاتف...", en: "🔎 Search by name or phone..." },
  "patient.name": { ar: "الاسم الكامل", en: "Full Name" },
  "patient.phone": { ar: "رقم الهاتف", en: "Phone" },
  "patient.age": { ar: "العمر", en: "Age" },
  "patient.height": { ar: "الطول (سم)", en: "Height (cm)" },
  "patient.weight": { ar: "الوزن (كغم)", en: "Weight (kg)" },
  "patient.chronicDiseases": { ar: "الأمراض المزمنة", en: "Chronic Diseases" },
  "patient.chronicDiseasesPh": { ar: "مثال: ضغط، سكري، قصور كلوي", en: "e.g. Hypertension, Diabetes, CKD" },
  "patient.chronicMeds": { ar: "الأدوية المزمنة (مربوطة بالبيع)", en: "Chronic Medications (POS-linked)" },
  "patient.chronicMedsHint": {
    ar: "ابحث وأضف الأدوية المزمنة — ستظهر تلقائياً في اقتراحات شاشة البيع.",
    en: "Search and add chronic meds — they surface automatically on the POS screen.",
  },
  "patient.chronicMedsSearch": {
    ar: "🔎 ابحث عن دواء لإضافته...",
    en: "🔎 Search a medication to add...",
  },
  "patient.chronicMedsEmpty": {
    ar: "لا توجد أدوية مزمنة مسجلة بعد.",
    en: "No chronic medications registered yet.",
  },
  "patient.chronicMedsRemove": { ar: "إلغاء", en: "Remove" },
  "patient.chronicCond": { ar: "حالة مزمنة", en: "chronic conditions" },
  "patient.interactionCheck": { ar: "فحص التداخل الدوائي قبل الصرف", en: "Interaction Check Before Dispense" },
  "patient.pickDrug": { ar: "اختر دواء للفحص", en: "Pick a drug to check" },
  "patient.noInteraction": {
    ar: "لا تداخلات معروفة مع ملف هذا المريض.",
    en: "No known interactions with this patient's file.",
  },
  "patient.secPharmacy": { ar: "السجل الدوائي للصيدلية", en: "Pharmacy History" },
  "patient.secLab": { ar: "السجل المختبري", en: "Laboratory Results" },
  "patient.secVisit": { ar: "السجل الطبي (زيارات الأطباء)", en: "Physician Visits" },
  "patient.col.item": { ar: "اسم المادة", en: "Item" },
  "patient.col.firstBuy": { ar: "أول شراء", en: "First Purchase" },
  "patient.col.lastBuy": { ar: "آخر شراء", en: "Last Purchase" },
  "patient.col.qty": { ar: "الكمية الكلية", en: "Cumulative Qty" },
  "patient.col.refill": { ar: "إعادة الصرف", en: "Refill" },
  "patient.col.test": { ar: "اسم التحليل", en: "Test" },
  "patient.col.testDate": { ar: "التاريخ", en: "Date" },
  "patient.col.result": { ar: "النتيجة", en: "Result" },
  "patient.col.compare": { ar: "مقارنة بالسابق", en: "vs Previous" },
  "patient.col.date": { ar: "التاريخ", en: "Date" },
  "patient.col.doctor": { ar: "الطبيب", en: "Doctor" },
  "patient.col.diagnosis": { ar: "التشخيص", en: "Diagnosis" },
  "patient.col.prescribed": { ar: "الأدوية الموصوفة", en: "Prescribed" },
  "bmi.underweight": { ar: "نحيف", en: "Underweight" },
  "bmi.normal": { ar: "طبيعي", en: "Normal" },
  "bmi.overweight": { ar: "زيادة وزن", en: "Overweight" },
  "bmi.obese": { ar: "سمنة", en: "Obese" },

  // Sidebar
  "side.header": { ar: "شريط معلومات المادة", en: "Product Info" },
  "side.breakdown": { ar: "الرصيد بالتفصيل", en: "Stock Breakdown" },
  "unit.box": { ar: "باكيت", en: "Box" },
  "unit.strip": { ar: "شريط", en: "Strip" },
  "unit.pill": { ar: "حبة", en: "Pill" },
  "unit.piece": { ar: "قطعة", en: "Piece" },
  "side.total": { ar: "الإجمالي", en: "Total" },
  "side.packing": { ar: "التعبئة", en: "Packing" },
  "side.reorderHigh": { ar: "حد الطلب الأعلى", en: "Reorder Max" },
  "side.reorderMin": { ar: "الحد الأدنى", en: "Reorder Min" },
  "side.sellPrice": { ar: "سعر البيع", en: "Selling Price" },
  "side.consumptionRate": { ar: "معدل الصرف", en: "Consumption Rate" },
  "side.month": { ar: "شهر", en: "Month" },
  "side.quarter": { ar: "3 أشهر", en: "3 Months" },
  "side.sufficiency": { ar: "حد الكفاية", en: "Stock Sufficiency" },
  "side.days": { ar: "يوم", en: "days" },
  "side.medicalNotes": { ar: "ملاحظات طبية", en: "Medical Notes" },
  "side.noBarcode": { ar: "— بدون باركود —", en: "— No barcode —" },

  // POS
  "pos.patient": { ar: "بيانات المريض", en: "Patient Info" },
  "pos.newPatient": { ar: "+ مريض جديد", en: "+ New Patient" },
  "pos.searchPatient": {
    ar: "🔎 ابحث باسم المريض أو رقم الهاتف...",
    en: "🔎 Search patient by name or phone...",
  },
  "pos.chronic": { ar: "الأدوية المزمنة", en: "Chronic Meds" },
  "pos.alertBefore": { ar: "تنبيه قبل 3 أيام", en: "Alert 3 days ahead" },
  "pos.dose": { ar: "جرعة", en: "Dose" },
  "pos.perDay": { ar: "/يوم", en: "/day" },
  "pos.remaining": { ar: "متبقي", en: "remaining" },
  "pos.addToInvoice": { ar: "إضافة للفاتورة", en: "Add to Invoice" },
  "pos.keypad": { ar: "لوحة الأرقام", en: "Keypad" },
  "pos.mode.add": { ar: "وضع: إضافة", en: "Mode: Add-On" },
  "pos.mode.discount": { ar: "وضع: خصم", en: "Mode: Discount" },
  "pos.mode.price": { ar: "وضع: تغيير سعر", en: "Mode: Change Price" },
  "pos.mode.qty": { ar: "وضع: تغيير كمية", en: "Mode: Change Qty" },
  "pos.act.add": { ar: "إضافة", en: "Add-On" },
  "pos.act.discount": { ar: "خصم", en: "Discount" },
  "pos.act.price": { ar: "تغيير سعر", en: "Change Price" },
  "pos.act.qty": { ar: "تغيير كمية", en: "Change Qty" },
  "pos.hint": {
    ar: "اكتب رقماً ثم اختر عملية.",
    en: "Type a number then pick an action.",
  },
  "pos.applyLine": {
    ar: "ستُطبق على المادة المحددة.",
    en: "Applies to the selected line.",
  },
  "pos.applyInvoice": {
    ar: "ستُطبق على الفاتورة كاملة.",
    en: "Applies to the whole invoice.",
  },
  "pos.applyGrand": {
    ar: "الخصم والإضافة تُطبقان على الفاتورة الكلية.",
    en: "Discount & Add-on apply to the Grand Total.",
  },
  "pos.grandDiscount": { ar: "خصم الفاتورة الكلية", en: "Grand Total Discount" },
  "pos.grandAddOn": { ar: "إضافة على الفاتورة الكلية", en: "Grand Total Add-On" },
  "pos.pay.cash": { ar: "نقد", en: "Cash" },
  "pos.pay.credit": { ar: "أجل", en: "Credit" },
  "pos.print": { ar: "طباعة فاتورة", en: "Print Invoice" },
  "pos.save": { ar: "حفظ", en: "Save" },
  "pos.suspend": { ar: "تعليق الفاتورة", en: "Suspend" },
  "pos.scan": {
    ar: "امسح الباركود أو اكتبه ثم Enter لإضافة المادة للفاتورة...",
    en: "Scan or type barcode then press Enter to add the item...",
  },
  "pos.add": { ar: "إضافة", en: "Add" },
  "pos.pickItem": { ar: "+ اختر مادة", en: "+ Pick item" },
  "pos.col.name": { ar: "اسم المادة", en: "Item Name" },
  "pos.col.unit": { ar: "الوحدة", en: "Unit" },
  "pos.col.qty": { ar: "الكمية", en: "Qty" },
  "pos.col.price": { ar: "السعر", en: "Price" },
  "pos.col.discount": { ar: "الخصم", en: "Discount" },
  "pos.col.total": { ar: "الإجمالي", en: "Total" },
  "pos.chronicTag": { ar: "مزمن", en: "chronic" },
  "pos.emptyRows": { ar: "امسح باركود أو أضف مادة للبدء", en: "Scan a barcode or add an item to start" },
  "pos.savedQ": { ar: "تسلسل الفواتير المحفوظة", en: "Saved Invoices" },
  "pos.suspendedQ": { ar: "فواتير معلقة", en: "Suspended Invoices" },
  "pos.noSaved": { ar: "لا فواتير محفوظة", en: "No saved invoices" },
  "pos.noSuspended": { ar: "لا فواتير معلقة", en: "No suspended invoices" },
  "pos.resume": { ar: "استئناف →", en: "Resume →" },
  "pos.items": { ar: "مواد", en: "items" },
  "pos.count": { ar: "عدد المواد", en: "Items Count" },
  "pos.invDiscount": { ar: "خصم فاتورة", en: "Invoice Discount" },
  "pos.invAddOn": { ar: "إضافة على الفاتورة", en: "Add-On" },
  "pos.printBarcode": { ar: "طباعة الباركود", en: "Print Barcodes" },
  "pos.finalTotal": { ar: "المجموع النهائي", en: "Final Total" },
  "pos.iqd": { ar: "د.ع", en: "IQD" },
  "pos.noResults": { ar: "لا نتائج", en: "No results" },
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string; dir: "rtl" | "ltr" };
const I18nCtx = createContext<Ctx | null>(null);

const STORAGE_KEY = "breef.lang.v1";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (saved === "ar" || saved === "en") setLangState(saved);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* noop */
    }
  }, []);

  const t = useCallback(
    (k: string) => {
      const entry = D[k];
      if (!entry) return k;
      return entry[lang];
    },
    [lang],
  );

  const value = useMemo<Ctx>(() => ({ lang, setLang, t, dir: lang === "ar" ? "rtl" : "ltr" }), [lang, setLang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) {
    // Safe fallback so components rendered outside provider still function.
    return { lang: "ar", setLang: () => {}, t: (k) => (D[k]?.ar ?? k), dir: "rtl" };
  }
  return c;
}
