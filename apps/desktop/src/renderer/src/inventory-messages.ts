import {
  COUNT_LINE_STATUSES,
  type InventoryDenial,
  type BatchEligibilityStatus,
  type InventoryColumnField,
  type InventoryRiskIndicator,
  type ProductStateColour,
} from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export const COUNT_DENIAL_CODES = [
  "count-session-not-found",
  "count-line-not-found",
  "count-session-completed",
  "count-entry-invalid",
  "count-balance-changed",
  "count-variance-zero",
  "count-variance-already-applied",
  "count-blocked-stock",
  "count-no-batch",
  "count-no-cost-basis",
  "count-valuation-mismatch",
] as const satisfies readonly InventoryDenial["code"][];

export type CountDenialCode = (typeof COUNT_DENIAL_CODES)[number];
type CountLineStatus = (typeof COUNT_LINE_STATUSES)[number];

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
    readonly countVariance: string;
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
  readonly count: {
    readonly title: string;
    readonly startTitle: string;
    readonly loopTitle: string;
    readonly description: string;
    readonly start: string;
    readonly resume: string;
    readonly activeSessions: string;
    readonly completedSessions: string;
    readonly noActiveSessions: string;
    readonly noCompletedSessions: string;
    readonly startedAt: string;
    readonly startedBy: string;
    readonly lineCount: string;
    readonly pendingVariances: string;
    readonly number: string;
    readonly status: string;
    readonly statusLabels: Record<CountLineStatus, string>;
    readonly item: string;
    readonly itemPlaceholder: string;
    readonly itemRequired: string;
    readonly itemNotFound: string;
    readonly archivedItem: string;
    readonly currentBalance: string;
    readonly countUnit: string;
    readonly unitCaption: (unit: string) => string;
    readonly save: string;
    readonly savedAnnouncement: (
      item: string,
      counted: string,
      unit: string,
      variance: string,
    ) => string;
    readonly varianceSentence: (
      before: string,
      counted: string,
      variance: string,
    ) => string;
    readonly balanceChanged: (current: string) => string;
    readonly blockedStock: (count: string) => string;
    readonly reviewBatches: string;
    readonly validationEntryRequired: string;
    readonly validationEntryInteger: string;
    readonly unavailable: string;
    readonly lines: string;
    readonly emptyLines: string;
    readonly tableCaption: string;
    readonly columns: {
      readonly item: string;
      readonly recorded: string;
      readonly counted: string;
      readonly before: string;
      readonly after: string;
      readonly variance: string;
      readonly status: string;
      readonly action: string;
    };
    readonly includesBlocked: (count: string) => string;
    readonly applyVariance: string;
    readonly applicationReason: string;
    readonly applicationEvidence: string;
    readonly reasonHint: string;
    readonly evidenceHint: string;
    readonly applicationSaved: string;
    readonly applicationAppliedBy: string;
    readonly complete: string;
    readonly completionConfirmation: (count: string) => string;
    readonly completed: string;
    readonly cancel: string;
    readonly close: string;
    readonly denialMessages: Record<CountDenialCode, string>;
  };
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

const arabicCountStatuses: Record<CountLineStatus, string> = {
  matched: "متطابق",
  pending: "بانتظار التطبيق",
  stale: "قديم — يحتاج مراجعة",
  applied: "طُبّق",
};

const englishCountStatuses: Record<CountLineStatus, string> = {
  matched: "Matched",
  pending: "Pending application",
  stale: "Stale — review needed",
  applied: "Applied",
};

const arabicCountDenials: Record<CountDenialCode, string> = {
  "count-session-not-found": "جلسة الجرد غير موجودة.",
  "count-line-not-found": "سطر الجرد غير موجود.",
  "count-session-completed": "اكتملت جلسة الجرد ولا يمكن تغييرها.",
  "count-entry-invalid": "أدخل كمية صحيحة بوحدات صحيحة غير سالبة.",
  "count-balance-changed": "تغير رصيد المادة؛ أعد التحقق من الرصيد الحالي.",
  "count-variance-zero": "لا يوجد فرق يحتاج إلى تطبيق.",
  "count-variance-already-applied": "تم تطبيق فرق هذا السطر من قبل.",
  "count-blocked-stock": "لا يمكن تطبيق الفرق على مخزون محجوب.",
  "count-no-batch": "لا توجد دفعة صالحة لإسناد الفرق إليها.",
  "count-no-cost-basis": "لا توجد كلفة دفترية لتقييم هذا الفرق.",
  "count-valuation-mismatch": "لا يتطابق رصيد المخزون مع سجل التقييم.",
};

const englishCountDenials: Record<CountDenialCode, string> = {
  "count-session-not-found": "The count session was not found.",
  "count-line-not-found": "The count line was not found.",
  "count-session-completed": "This count session is complete and immutable.",
  "count-entry-invalid": "Enter whole, non-negative quantities for the units.",
  "count-balance-changed":
    "The item balance changed; review the current balance.",
  "count-variance-zero": "There is no variance to apply.",
  "count-variance-already-applied":
    "This line's variance has already been applied.",
  "count-blocked-stock": "The variance cannot be applied to blocked stock.",
  "count-no-batch": "There is no eligible batch to receive this variance.",
  "count-no-cost-basis": "There is no carrying-cost basis for this variance.",
  "count-valuation-mismatch": "The inventory balance does not match valuation.",
};

const arabicCount: InventoryCopy["count"] = {
  title: "جرد المخزون",
  startTitle: "جلسات جرد المخزون",
  loopTitle: "جرد المخزون الحالي",
  description: "سجّل الرصيد الفعلي دون تعديل بطاقة المادة مباشرة.",
  start: "بدء جلسة جرد",
  resume: "استئناف الجرد",
  activeSessions: "الجلسات النشطة",
  completedSessions: "الجلسات المكتملة",
  noActiveSessions: "لا توجد جلسات جرد نشطة.",
  noCompletedSessions: "لا توجد جلسات مكتملة.",
  startedAt: "بدأت في",
  startedBy: "بدأت بواسطة",
  lineCount: "الأسطر",
  pendingVariances: "الفروقات المعلقة",
  number: "رقم الجلسة",
  status: "الحالة",
  statusLabels: arabicCountStatuses,
  item: "المادة / الباركود",
  itemPlaceholder: "امسح الباركود أو ابحث عن مادة",
  itemRequired: "أدخل مادة أو باركوداً أولاً.",
  itemNotFound: "لم يتم العثور على مادة نشطة بهذا الإدخال.",
  archivedItem: "لا يمكن جرد مادة مؤرشفة أو مدمجة.",
  currentBalance: "الرصيد الحالي",
  countUnit: "الكمية المعدودة",
  unitCaption: (unit) => `الكمية بوحدة ${unit}`,
  save: "حفظ الرصيد",
  savedAnnouncement: (item, counted, unit, variance) =>
    `تم حفظ جرد ${item}: ${counted} ${unit}، والفرق ${variance}.`,
  varianceSentence: (before, counted, variance) =>
    `قبل ${before}، المعدود ${counted}، الفرق ${variance}.`,
  balanceChanged: (current) => `تغير الرصيد. الرصيد الحالي هو ${current}.`,
  blockedStock: (count) => `يشمل الرصيد ${count} من المخزون المحجوب.`,
  reviewBatches: "مراجعة الدفعات",
  validationEntryRequired: "أدخل كمية واحدة على الأقل.",
  validationEntryInteger: "استخدم أعداداً صحيحة غير سالبة.",
  unavailable: "تعذر الوصول إلى جلسة الجرد. تحقق من الاتصال وحاول مرة أخرى.",
  lines: "أسطر الجرد",
  emptyLines: "لم يتم تسجيل أي أسطر بعد.",
  tableCaption: "أسطر جلسة الجرد",
  columns: {
    item: "المادة",
    recorded: "المسجل",
    counted: "المعدود",
    before: "قبل",
    after: "بعد",
    variance: "الفرق",
    status: "الحالة",
    action: "الإجراء",
  },
  includesBlocked: (count) => `يشمل ${count} محجوباً`,
  applyVariance: "تطبيق الفرق",
  applicationReason: "سبب التطبيق",
  applicationEvidence: "الدليل",
  reasonHint: "اذكر سبب الفرق (مطلوب).",
  evidenceHint: "أضف مرجعاً أو وصفاً قابلاً للمراجعة (مطلوب).",
  applicationSaved: "تم تطبيق فرق الجرد وتحديث سجل الحركات.",
  applicationAppliedBy: "طُبّق بواسطة",
  complete: "إكمال الجلسة",
  completionConfirmation: (count) =>
    `ستبقى ${count} فروقات معلقة غير قابلة للتطبيق بعد إكمال الجلسة. هل تريد المتابعة؟`,
  completed: "اكتملت الجلسة.",
  cancel: "إلغاء",
  close: "إغلاق",
  denialMessages: arabicCountDenials,
};

const englishCount: InventoryCopy["count"] = {
  title: "Stock count",
  startTitle: "Stock count sessions",
  loopTitle: "Current stock count",
  description: "Record physical stock without editing the item directly.",
  start: "Start count session",
  resume: "Resume count",
  activeSessions: "Active sessions",
  completedSessions: "Completed sessions",
  noActiveSessions: "There are no active count sessions.",
  noCompletedSessions: "There are no completed sessions.",
  startedAt: "Started",
  startedBy: "Started by",
  lineCount: "Lines",
  pendingVariances: "Pending variances",
  number: "Session number",
  status: "Status",
  statusLabels: englishCountStatuses,
  item: "Barcode / item",
  itemPlaceholder: "Scan a barcode or search for an item",
  itemRequired: "Enter an item or barcode first.",
  itemNotFound: "No active item matched this entry.",
  archivedItem: "Archived or merged items cannot be counted.",
  currentBalance: "Current balance",
  countUnit: "Counted quantity",
  unitCaption: (unit) => `Quantity in ${unit}`,
  save: "Save balance",
  savedAnnouncement: (item, counted, unit, variance) =>
    `Count saved for ${item}: ${counted} ${unit}; variance ${variance}.`,
  varianceSentence: (before, counted, variance) =>
    `Before ${before}, counted ${counted}, variance ${variance}.`,
  balanceChanged: (current) =>
    `The balance changed. Current balance: ${current}.`,
  blockedStock: (count) => `${count} of the balance is blocked stock.`,
  reviewBatches: "Review batches",
  validationEntryRequired: "Enter a quantity in at least one field.",
  validationEntryInteger: "Use whole, non-negative numbers.",
  unavailable:
    "The count session is unavailable. Check the connection and try again.",
  lines: "Count lines",
  emptyLines: "No count lines have been recorded yet.",
  tableCaption: "Count session lines",
  columns: {
    item: "Item",
    recorded: "Recorded",
    counted: "Counted",
    before: "Before",
    after: "After",
    variance: "Variance",
    status: "Status",
    action: "Action",
  },
  includesBlocked: (count) => `Includes ${count} blocked`,
  applyVariance: "Apply variance",
  applicationReason: "Application reason",
  applicationEvidence: "Evidence",
  reasonHint: "State why the variance is being applied (required).",
  evidenceHint: "Add a reviewable reference or description (required).",
  applicationSaved: "Count variance applied and movement history updated.",
  applicationAppliedBy: "Applied by",
  complete: "Complete session",
  completionConfirmation: (count) =>
    `${count} pending variances will remain unapplied after completion. Continue?`,
  completed: "Session completed.",
  cancel: "Cancel",
  close: "Close",
  denialMessages: englishCountDenials,
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
    count: arabicCount,
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
      countVariance: "فرق جرد",
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
    count: englishCount,
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
      countVariance: "Count variance",
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
