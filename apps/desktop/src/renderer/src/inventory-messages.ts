import {
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
  },
};
