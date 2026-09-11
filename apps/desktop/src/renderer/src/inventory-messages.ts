import {
  type BatchEligibilityStatus,
  type InventoryColumnField,
  type InventoryRiskIndicator,
  type ProductStateColour,
} from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export interface InventoryCopy {
  readonly automatic: string;
  readonly backToInventory: string;
  readonly columns: Record<InventoryColumnField, string>;
  readonly empty: string;
  readonly export: string;
  readonly exportCancelled: string;
  readonly exportFailed: string;
  readonly exportSaved: string;
  readonly exportStepUp: string;
  readonly loading: string;
  readonly movement: {
    readonly adjustment: string;
    readonly date: string;
    readonly empty: string;
    readonly kind: string;
    readonly quantity: string;
    readonly reference: string;
    readonly time: string;
    readonly title: string;
    readonly user: string;
    readonly value: string;
    readonly receipt: string;
    readonly return: string;
  };
  readonly riskIndicators: Record<InventoryRiskIndicator, string>;
  readonly retry: string;
  readonly reviewUnavailable: string;
  readonly readOnly: string;
  readonly permissionDenied: string;
  readonly settings: string;
  readonly settingsNote: string;
  readonly sortAnnouncement: (
    column: string,
    direction: "ascending" | "descending",
  ) => string;
  readonly stateColours: Record<ProductStateColour, string>;
  readonly manual: string;
  readonly manualNone: string;
  readonly title: string;
  readonly valuationDenied: string;
  readonly safety: {
    readonly backToInventory: string;
    readonly blockedSince: string;
    readonly corrected: string;
    readonly correction: string;
    readonly correctionDescription: string;
    readonly correctionSaved: string;
    readonly correctionStepUp: string;
    readonly dailyStatus: (state: string, date: string | null) => string;
    readonly emptyHistory: string;
    readonly evidence: string;
    readonly evidenceHint: string;
    readonly events: string;
    readonly eventKinds: Record<"expired" | "recalled" | "quarantined", string>;
    readonly fefo: string;
    readonly fefoDescription: string;
    readonly fefoPreview: string;
    readonly history: string;
    readonly jobUnavailable: string;
    readonly lastRun: string;
    readonly lot: string;
    readonly nextMonth: string;
    readonly noBatches: string;
    readonly noPreview: string;
    readonly originalExpiry: string;
    readonly previewBlocked: string;
    readonly previewPick: string;
    readonly previewResult: string;
    readonly previousMonth: string;
    readonly quantity: string;
    readonly quarantine: string;
    readonly quarantineDescription: string;
    readonly recall: string;
    readonly recallDescription: string;
    readonly reason: string;
    readonly review: string;
    readonly reviewColumns: {
      readonly batch: string;
      readonly blockedDays: string;
      readonly carryingAmount: string;
      readonly detected: string;
      readonly effectiveExpiry: string;
      readonly item: string;
      readonly status: string;
    };
    readonly reviewEmpty: string;
    readonly reviewMonth: string;
    readonly reviewUnavailable: string;
    readonly runNow: string;
    readonly runQueued: string;
    readonly runSummary: (completed: number, missed: number) => string;
    readonly safetyStatus: string;
    readonly status: string;
    readonly statusEvents: string;
    readonly statusLabels: Record<BatchEligibilityStatus, string>;
    readonly statusSentence: (
      status: BatchEligibilityStatus,
      daysToExpiry: string | null,
    ) => string;
    readonly submit: string;
    readonly tableCaption: string;
    readonly unavailable: string;
    readonly dispositionNote: string;
    readonly warning: string;
    readonly gate: string;
    readonly missedRuns: (count: number, date: string | null) => string;
  };
}

const arabicColumns: Record<InventoryColumnField, string> = {
  averageCost: "متوسط الكلفة",
  balance: "الرصيد الحالي",
  batches: "الدفعات",
  consumptionRate: "الاستهلاك لكل 30 يوماً",
  expiry: "أقرب انتهاء",
  item: "المادة",
  levels: "الحد الأدنى / الأقصى",
  reorderPoint: "نقطة إعادة الطلب",
  risk: "مؤشرات المخاطر",
  value: "القيمة",
};

const englishColumns: Record<InventoryColumnField, string> = {
  averageCost: "Average cost",
  balance: "Current balance",
  batches: "Batches",
  consumptionRate: "Consumption / 30 days",
  expiry: "Earliest expiry",
  item: "Item",
  levels: "Minimum / maximum",
  reorderPoint: "Reorder point",
  risk: "Risk indicators",
  value: "Value",
};

const arabicRisks: Record<InventoryRiskIndicator, string> = {
  "above-maximum": "فوق الحد الأقصى",
  "at-or-below-reorder-point": "عند نقطة إعادة الطلب أو دونها",
  "below-minimum": "دون الحد الأدنى",
  "cold-storage": "تخزين بارد",
  expired: "منتهي الصلاحية",
  "expiring-soon": "قريب الانتهاء",
  "missing-barcode": "باركود مفقود",
  "out-of-stock": "نفاد المخزون",
};

const englishRisks: Record<InventoryRiskIndicator, string> = {
  "above-maximum": "Above maximum",
  "at-or-below-reorder-point": "At or below reorder point",
  "below-minimum": "Below minimum",
  "cold-storage": "Cold storage",
  expired: "Expired",
  "expiring-soon": "Expiring soon",
  "missing-barcode": "Missing barcode",
  "out-of-stock": "Out of stock",
};

const arabicColours: Record<ProductStateColour, string> = {
  blue: "أزرق — تخزين بارد",
  green: "أخضر — سليم",
  grey: "رمادي — باركود مفقود",
  orange: "برتقالي — يحتاج انتباهاً",
  purple: "بنفسجي — فوق الحد الأقصى",
  red: "أحمر — خطر أو نفاد",
  yellow: "أصفر — قريب الانتهاء",
};

const englishColours: Record<ProductStateColour, string> = {
  blue: "Blue — cold storage",
  green: "Green — healthy",
  grey: "Grey — missing barcode",
  orange: "Orange — attention needed",
  purple: "Purple — above maximum",
  red: "Red — risk or out of stock",
  yellow: "Yellow — expiring soon",
};

const arabicStatuses: Record<BatchEligibilityStatus, string> = {
  eligible: "صالح للبيع",
  "near-expiry": "قريب الانتهاء",
  expired: "منتهي الصلاحية",
  recalled: "مسحوب",
  quarantined: "موضوع في الحجر",
  "postponed-blocked": "محجوب بسبب التأجيل",
};

const englishStatuses: Record<BatchEligibilityStatus, string> = {
  eligible: "Eligible",
  "near-expiry": "Near expiry",
  expired: "Expired",
  recalled: "Recalled",
  quarantined: "Quarantined",
  "postponed-blocked": "Postponed — blocked",
};

function statusSentence(
  locale: Locale,
  status: BatchEligibilityStatus,
  daysToExpiry: string | null,
): string {
  if (locale === "ar") {
    switch (status) {
      case "eligible":
        return "صالح للبيع";
      case "near-expiry":
        return (
          "قريب الانتهاء — قابل للبيع، ينتهي خلال " +
          (daysToExpiry ?? "؟") +
          " يوماً"
        );
      case "expired":
        return "منتهي الصلاحية — ممنوع البيع";
      case "recalled":
        return "مسحوب — ممنوع البيع";
      case "quarantined":
        return "موضوع في الحجر — ممنوع البيع";
      case "postponed-blocked":
        return "محجوب بسبب التأجيل — ممنوع البيع";
    }
  }
  switch (status) {
    case "eligible":
      return "Eligible — sellable";
    case "near-expiry":
      return (
        "Near expiry — sellable, expires in " + (daysToExpiry ?? "?") + " days"
      );
    case "expired":
      return "Expired — sale blocked";
    case "recalled":
      return "Recalled — sale blocked";
    case "quarantined":
      return "Quarantined — sale blocked";
    case "postponed-blocked":
      return "Postponed — sale blocked";
  }
}

const arabicSafety: InventoryCopy["safety"] = {
  backToInventory: "العودة إلى مراجعة المخزون",
  blockedSince: "محجوبة منذ",
  corrected: "مصحح",
  correction: "تصحيح تاريخ الانتهاء",
  correctionDescription:
    "احتفظ بالتاريخ الأصلي. اذكر سبب التصحيح ودليله قبل إعادة التحقق.",
  correctionSaved: "تم تصحيح تاريخ الانتهاء مع حفظ التاريخ الأصلي.",
  correctionStepUp: "يتطلب تصحيح الانتهاء إعادة التحقق من كلمة المرور.",
  dailyStatus: (state, date) =>
    "حالة التقييم اليومي: " +
    ({
      behind: "متأخر",
      current: "محدّث",
      "never-run": "لم يُشغّل",
      "time-zone-invalid": "المنطقة الزمنية غير صالحة",
    }[state] ?? state) +
    (date === null ? "" : " — آخر إكمال " + date),
  emptyHistory: "لا توجد أحداث سلامة لهذه الدفعة.",
  evidence: "الدليل",
  evidenceHint: "أرفق مرجعاً أو وصفاً يمكن مراجعته.",
  events: "أحداث الحالة",
  eventKinds: {
    expired: "منتهي الصلاحية",
    quarantined: "موضوع في الحجر",
    recalled: "مسحوب",
  },
  fefo: "اختيار FEFO",
  fefoDescription: "يعرض الدفعات القابلة للبيع بترتيب أقرب انتهاء أولاً.",
  fefoPreview: "معاينة الاختيار",
  history: "السجل الكامل",
  jobUnavailable: "خدمة التقييم اليومي غير متاحة حالياً.",
  lastRun: "آخر تشغيل",
  lot: "رقم التشغيلة",
  nextMonth: "الشهر التالي",
  noBatches: "لا توجد دفعات ذات رصيد لهذه المادة.",
  noPreview: "أدخل كمية ثم اختر معاينة الاختيار.",
  originalExpiry: "الانتهاء الأصلي",
  previewBlocked: "دفعات محجوبة لا يمكن اختيارها",
  previewPick: "معاينة الاختيار",
  previewResult: "نتيجة معاينة FEFO",
  previousMonth: "الشهر السابق",
  quantity: "الكمية",
  quarantine: "حجر الدفعة",
  quarantineDescription: "احجز الدفعة فوراً مع سبب ودليل قابل للمراجعة.",
  recall: "سحب الدفعة",
  recallDescription: "سجّل سحب الدفعة مع سبب ودليل قابل للمراجعة.",
  reason: "السبب",
  review: "مراجعة السلامة الشهرية",
  reviewColumns: {
    batch: "الدفعة",
    blockedDays: "أيام الحجب",
    carryingAmount: "القيمة الدفترية",
    detected: "تاريخ الاكتشاف",
    effectiveExpiry: "الانتهاء الفعلي",
    item: "المادة",
    status: "الحالة",
  },
  reviewEmpty: "لا توجد دفعات منتهية أو محجوبة في هذا الشهر.",
  reviewMonth: "شهر المراجعة",
  reviewUnavailable: "تعذر تحميل مراجعة سلامة الدفعات.",
  runNow: "تشغيل التقييم الآن",
  runQueued: "تم طلب تشغيل تقييم سلامة الدفعات.",
  runSummary: (completed, missed) =>
    "التقييمات المكتملة: " + completed + "، التواريخ الفائتة: " + missed,
  safetyStatus: "سلامة الدفعات",
  status: "الحالة",
  statusEvents: "الأحداث",
  statusLabels: arabicStatuses,
  statusSentence: (status, days) => statusSentence("ar", status, days),
  submit: "حفظ",
  tableCaption: "دفعات المادة مرتبة حسب FEFO",
  unavailable: "تعذر الوصول إلى سلامة الدفعات. تحقق من الاتصال وحاول مرة أخرى.",
  dispositionNote:
    "تُحل الدفعات المحجوبة عبر مسار التصرف اللاحق؛ لا يوجد إجراء تحرير هنا.",
  warning: "تنبيه: هذه الدفعة قريبة الانتهاء لكنها قابلة للبيع.",
  gate: "إعداد هندسي مؤقت بانتظار بوابة الصيدلي G-02 — غير معتمد",
  missedRuns: (count, date) =>
    "تقييم السلامة اليومي متأخر بمقدار " +
    count +
    " تواريخ عمل؛ آخر إكمال " +
    (date ?? "لم يُشغّل بعد") +
    ".",
};

const englishSafety: InventoryCopy["safety"] = {
  backToInventory: "Back to inventory review",
  blockedSince: "Blocked since",
  corrected: "Corrected",
  correction: "Correct expiry date",
  correctionDescription:
    "Keep the original date. Give a reason and evidence before reauthentication.",
  correctionSaved: "Expiry corrected; the original date remains in history.",
  correctionStepUp: "Correcting expiry requires password reauthentication.",
  dailyStatus: (state, date) =>
    "Daily evaluation: " +
    ({
      behind: "behind",
      current: "current",
      "never-run": "never run",
      "time-zone-invalid": "time-zone invalid",
    }[state] ?? state) +
    (date === null ? "" : " — last completed " + date),
  emptyHistory: "There are no safety events for this batch.",
  evidence: "Evidence",
  evidenceHint: "Add a reviewable reference or description.",
  events: "Status events",
  eventKinds: {
    expired: "Expired",
    quarantined: "Quarantined",
    recalled: "Recalled",
  },
  fefo: "FEFO pick",
  fefoDescription: "Shows sellable batches with the earliest expiry first.",
  fefoPreview: "Pick preview",
  history: "Full history",
  jobUnavailable: "The daily safety evaluator is currently unavailable.",
  lastRun: "Last run",
  lot: "Lot number",
  nextMonth: "Next month",
  noBatches: "There are no batches with balance for this item.",
  noPreview: "Enter a quantity, then choose Preview pick.",
  originalExpiry: "Original expiry",
  previewBlocked: "Blocked batches cannot be picked",
  previewPick: "Preview pick",
  previewResult: "FEFO preview result",
  previousMonth: "Previous month",
  quantity: "Quantity",
  quarantine: "Quarantine batch",
  quarantineDescription:
    "Block the batch now with a reviewable reason and evidence.",
  recall: "Recall batch",
  recallDescription:
    "Record the recall now with a reviewable reason and evidence.",
  reason: "Reason",
  review: "Monthly safety review",
  reviewColumns: {
    batch: "Batch",
    blockedDays: "Blocked days",
    carryingAmount: "Carrying amount",
    detected: "Detected",
    effectiveExpiry: "Effective expiry",
    item: "Item",
    status: "Status",
  },
  reviewEmpty: "No expired or blocked batches were found for this month.",
  reviewMonth: "Review month",
  reviewUnavailable: "The batch safety review could not be loaded.",
  runNow: "Run evaluation now",
  runQueued: "Batch safety evaluation requested.",
  runSummary: (completed, missed) =>
    "Completed evaluations: " + completed + "; missed dates: " + missed,
  safetyStatus: "Batch safety",
  status: "Status",
  statusEvents: "Events",
  statusLabels: englishStatuses,
  statusSentence: (status, days) => statusSentence("en", status, days),
  submit: "Save",
  tableCaption: "Product batches ordered by FEFO",
  unavailable:
    "Batch safety is unavailable. Check the connection and try again.",
  dispositionNote:
    "Blocked stock is resolved through the later disposition workflow; there is no release action here.",
  warning: "Warning: this batch is near expiry but remains sellable.",
  gate: "Engineering default pending pharmacist gate G-02 — not approved",
  missedRuns: (count, date) =>
    "Daily safety evaluation is behind by " +
    count +
    " business dates; last completed " +
    (date ?? "never") +
    ".",
};

export const inventoryMessages: Record<Locale, InventoryCopy> = {
  ar: {
    automatic: "تلقائي",
    backToInventory: "العودة إلى المخزن",
    columns: arabicColumns,
    empty: "لا توجد مواد مخزنية بعد.",
    export: "تصدير بيانات المخزون الحساسة",
    exportCancelled: "أُلغي تصدير بيانات المخزون.",
    exportFailed: "تعذر حفظ تصدير بيانات المخزون.",
    exportSaved: "تم حفظ تصدير بيانات المخزون.",
    exportStepUp: "يتطلب التصدير إعادة التحقق من كلمة المرور.",
    loading: "جارٍ تحميل المخزون...",
    manual: "يدوي",
    manualNone: "لا يوجد لون يدوي",
    movement: {
      adjustment: "تعديل شراء",
      date: "التاريخ",
      empty: "لا توجد حركات لهذه المادة.",
      kind: "نوع الحركة",
      quantity: "الكمية",
      reference: "المستند المرجعي",
      receipt: "استلام شراء",
      return: "مرتجع شراء",
      time: "الوقت",
      title: "تفاصيل حركات المادة",
      user: "المستخدم",
      value: "القيمة",
    },
    readOnly: "هذه الشاشة للقراءة فقط؛ الأرصدة مشتقة من حركات المخزون.",
    permissionDenied: "لا تملك صلاحية مراجعة المخزون. مرجع الطلب:",
    retry: "إعادة المحاولة",
    reviewUnavailable:
      "تعذر الوصول إلى المخزون. تحقق من الاتصال وحاول مرة أخرى.",
    riskIndicators: arabicRisks,
    settings: "إعدادات الأعمدة",
    settingsNote: "تُحفظ اختيارات الأعمدة لهذا المستخدم فقط.",
    sortAnnouncement: (column, direction) =>
      "تم ترتيب " +
      column +
      " بترتيب " +
      (direction === "ascending" ? "تصاعدي" : "تنازلي") +
      ".",
    stateColours: arabicColours,
    title: "مراجعة المخزون",
    valuationDenied: "تفاصيل القيمة ومتوسط الكلفة غير متاحة لصلاحيتك.",
    safety: arabicSafety,
  },
  en: {
    automatic: "Automatic",
    backToInventory: "Back to inventory",
    columns: englishColumns,
    empty: "There are no inventory items yet.",
    export: "Export sensitive inventory data",
    exportCancelled: "Inventory export cancelled.",
    exportFailed: "The inventory export could not be saved.",
    exportSaved: "Inventory export saved.",
    exportStepUp: "Export requires password reauthentication.",
    loading: "Loading inventory...",
    manual: "Manual",
    manualNone: "No manual colour",
    movement: {
      adjustment: "Purchase adjustment",
      date: "Date",
      empty: "This item has no movements.",
      kind: "Movement kind",
      quantity: "Quantity",
      reference: "Reference document",
      receipt: "Purchase receipt",
      return: "Purchase return",
      time: "Time",
      title: "Item movement details",
      user: "User",
      value: "Value",
    },
    readOnly:
      "This screen is read-only; balances are derived from inventory movements.",
    permissionDenied:
      "You do not have inventory review permission. Request reference:",
    retry: "Retry",
    reviewUnavailable:
      "Inventory is unavailable. Check the connection and try again.",
    riskIndicators: englishRisks,
    settings: "Column settings",
    settingsNote: "Column choices are saved for this user only.",
    sortAnnouncement: (column, direction) =>
      column + " sorted " + direction + ".",
    stateColours: englishColours,
    title: "Inventory review",
    valuationDenied:
      "Value and average-cost details are not available to your permission.",
    safety: englishSafety,
  },
};
