import {
  REORDER_PROPOSAL_BASES,
  REORDER_WARNINGS,
  type InventoryDenial,
} from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export const BASKET_DENIAL_CODES = [
  "body-invalid",
  "product-not-found",
  "idempotency-conflict",
  "reorder-item-not-found",
  "reorder-item-status-invalid",
  "reorder-quantity-zero",
  "reorder-product-inactive",
  "version-conflict",
] as const satisfies readonly InventoryDenial["code"][];

export type BasketDenialCode = (typeof BASKET_DENIAL_CODES)[number];
type ReorderProposalBasis = (typeof REORDER_PROPOSAL_BASES)[number];
type ReorderWarning = (typeof REORDER_WARNINGS)[number];

export interface BasketQuantityPart {
  readonly count: string;
  readonly unitName: string;
}

export interface BasketProjectionSummary {
  readonly maximumLevel: string | null;
  readonly projectedLevel: string;
  readonly warning: ReorderWarning | null;
}

export interface BasketCopy {
  readonly actions: {
    readonly confirm: string;
    readonly remove: string;
    readonly retry: string;
    readonly returnToBasket: string;
  };
  readonly addedAnnouncement: (
    name: string,
    quantity: string,
    unit: string,
  ) => string;
  readonly alreadyOrderedAnnouncement: (name: string) => string;
  readonly archivedRow: string;
  readonly columns: {
    readonly actions: string;
    readonly balance: string;
    readonly consumption: string;
    readonly item: string;
    readonly levels: string;
    readonly orderDate: string;
    readonly orderedBy: string;
    readonly projection: string;
    readonly quantity: string;
    readonly risk: string;
    readonly status: string;
  };
  readonly confirmedAnnouncement: (name: string) => string;
  readonly denialMessages: Record<BasketDenialCode, string>;
  readonly description: string;
  readonly empty: string;
  readonly emptyOrdered: string;
  readonly loading: string;
  readonly mergedRow: string;
  readonly notSaved: string;
  readonly permissionDenied: string;
  readonly proposalBasis: Record<ReorderProposalBasis, string>;
  readonly projectionWarnings: Record<ReorderWarning, string>;
  readonly quantityCaption: (parts: readonly BasketQuantityPart[]) => string;
  readonly quantityLabel: (name: string) => string;
  readonly quantityInvalid: string;
  readonly refreshedAnnouncement: (
    name: string,
    quantity: string,
    unit: string,
  ) => string;
  readonly removedAnnouncement: (name: string) => string;
  readonly reviewUnavailable: string;
  readonly savedAnnouncement: (
    name: string,
    quantity: string,
    unit: string,
    projection: BasketProjectionSummary,
  ) => string;
  readonly statusLabels: {
    readonly ordered: string;
  };
  readonly surplusWarning: (projected: string, maximum: string) => string;
  readonly tabs: {
    readonly basket: string;
    readonly ordered: string;
  };
  readonly title: string;
  readonly withinMaximum: string;
  readonly returnedAnnouncement: (name: string) => string;
}

const arabicProposalBasis: Record<ReorderProposalBasis, string> = {
  "balance-at-or-above-maximum": "الرصيد عند الحد الأقصى أو فوقه",
  "maximum-minus-balance": "الحد الأقصى ناقص الرصيد",
  "no-maximum-level": "لا يوجد حد أقصى",
};

const englishProposalBasis: Record<ReorderProposalBasis, string> = {
  "balance-at-or-above-maximum": "Balance is at or above the maximum",
  "maximum-minus-balance": "Maximum minus balance",
  "no-maximum-level": "No maximum level",
};

const arabicDenials: Record<BasketDenialCode, string> = {
  "body-invalid": "بيانات الطلب غير صالحة.",
  "idempotency-conflict": "مفتاح المحاولة مستخدم لطلب مختلف.",
  "product-not-found": "لم يتم العثور على المادة.",
  "reorder-item-not-found": "لم يتم العثور على سطر الطلب.",
  "reorder-item-status-invalid":
    "لا يمكن تنفيذ هذا الإجراء في حالة السطر الحالية.",
  "reorder-product-inactive": "المادة غير نشطة ولا يمكن طلبها.",
  "reorder-quantity-zero": "لا يمكن تأكيد كمية تساوي صفراً.",
  "version-conflict": "تغير السطر؛ أعد مراجعته قبل الحفظ.",
};

const englishDenials: Record<BasketDenialCode, string> = {
  "body-invalid": "The request details are invalid.",
  "idempotency-conflict": "This attempt key was used for a different request.",
  "product-not-found": "The item was not found.",
  "reorder-item-not-found": "The order basket row was not found.",
  "reorder-item-status-invalid":
    "This action is not valid for the row's current status.",
  "reorder-product-inactive": "This item is inactive and cannot be ordered.",
  "reorder-quantity-zero": "An order quantity of zero cannot be confirmed.",
  "version-conflict": "The row changed; review it before saving.",
};

function quantityCaption(parts: readonly BasketQuantityPart[]): string {
  return parts
    .map((part) => `${String(part.count)} ${part.unitName}`)
    .join(" + ");
}

const arabic: BasketCopy = {
  actions: {
    confirm: "تأكيد الطلب",
    remove: "إزالة من السلة",
    retry: "إعادة المحاولة",
    returnToBasket: "إرجاع إلى السلة",
  },
  addedAnnouncement: (name, quantity, unit) =>
    `أُضيفت ${quantity} ${unit} من ${name} إلى سلة الطلبات.`,
  alreadyOrderedAnnouncement: (name) =>
    `${name} مطلوبة بالفعل. لم يتغير شيء. افتح المواد المطلوبة لمراجعتها.`,
  archivedRow: "مؤرشفة — أزلها من السلة",
  columns: {
    actions: "الإجراءات",
    balance: "الرصيد",
    consumption: "الاستهلاك لكل 30 يوماً",
    item: "المادة",
    levels: "الحد الأدنى / الأقصى",
    orderDate: "تاريخ الطلب",
    orderedBy: "طلبها",
    projection: "الرصيد المتوقع",
    quantity: "الكمية",
    risk: "المخاطر",
    status: "الحالة",
  },
  confirmedAnnouncement: (name) =>
    `تم تأكيد طلب ${name} ونقلها إلى المواد المطلوبة.`,
  denialMessages: arabicDenials,
  description: "راجع الكميات المقترحة وأكّد المواد المطلوبة عند تجهيز الطلب.",
  empty: "لا توجد مواد في سلة الطلبات.",
  emptyOrdered: "لا توجد مواد مطلوبة.",
  loading: "جارٍ تحميل سلة الطلبات...",
  mergedRow: "مدمجة في مادة أخرى — أزلها من السلة",
  notSaved: "لم تُحفظ",
  permissionDenied: "لا تملك صلاحية الوصول إلى سلة الطلبات.",
  proposalBasis: arabicProposalBasis,
  projectionWarnings: { surplus: "فائض محتمل" },
  quantityCaption,
  quantityLabel: (name) => `كمية ${name}`,
  quantityInvalid: "استخدم عدداً صحيحاً غير سالب.",
  refreshedAnnouncement: (name, quantity, unit) =>
    `تم تحديث حالة ${name}. الكمية المحفوظة الآن ${quantity} ${unit}.`,
  removedAnnouncement: (name) => `أُزيلت ${name} من سلة الطلبات.`,
  reviewUnavailable:
    "تعذر الوصول إلى سلة الطلبات. تحقق من الاتصال وحاول مرة أخرى.",
  savedAnnouncement: (name, quantity, unit, projection) => {
    const result = `تم حفظ ${quantity} ${unit} من ${name}`;
    if (projection.warning === "surplus" && projection.maximumLevel !== null) {
      return `${result} — الرصيد المتوقع ${projection.projectedLevel} يتجاوز الحد الأقصى ${projection.maximumLevel} وقد يسبب فائضاً أو هدراً.`;
    }
    if (projection.maximumLevel !== null) {
      return `${result} — الرصيد المتوقع ${projection.projectedLevel} ضمن الحد الأقصى ${projection.maximumLevel}.`;
    }
    return `${result} — الرصيد المتوقع ${projection.projectedLevel}؛ لا يوجد حد أقصى.`;
  },
  statusLabels: { ordered: "تم طلبها" },
  surplusWarning: (projected, maximum) =>
    `الرصيد المتوقع ${projected} — قد يسبب فائضاً أو هدراً (الحد الأقصى ${maximum})`,
  tabs: { basket: "السلة", ordered: "المواد المطلوبة" },
  title: "سلة الطلبات",
  withinMaximum: "ضمن الحد الأقصى",
  returnedAnnouncement: (name) => `أُعيدت ${name} إلى سلة الطلبات.`,
};

const english: BasketCopy = {
  actions: {
    confirm: "Confirm order",
    remove: "Remove",
    retry: "Retry",
    returnToBasket: "Return to basket",
  },
  addedAnnouncement: (name, quantity, unit) =>
    `Added ${quantity} ${unit} for ${name} to the order basket.`,
  alreadyOrderedAnnouncement: (name) =>
    `${name} is already ordered. Nothing changed. Open Ordered Items to review it.`,
  archivedRow: "Archived — remove from the basket",
  columns: {
    actions: "Actions",
    balance: "Balance",
    consumption: "Consumption / 30 days",
    item: "Item",
    levels: "Minimum / maximum",
    orderDate: "Order date",
    orderedBy: "Ordered by",
    projection: "Projection",
    quantity: "Quantity",
    risk: "Risk",
    status: "Status",
  },
  confirmedAnnouncement: (name) => `${name} moved to Ordered Items.`,
  denialMessages: englishDenials,
  description:
    "Review proposed quantities and confirm the items when the order is ready.",
  empty: "There are no items in the order basket.",
  emptyOrdered: "There are no Ordered Items.",
  loading: "Loading the order basket...",
  mergedRow: "Merged into another item — remove from the basket",
  notSaved: "Not saved",
  permissionDenied: "You do not have permission to access the order basket.",
  proposalBasis: englishProposalBasis,
  projectionWarnings: { surplus: "Potential surplus" },
  quantityCaption,
  quantityLabel: (name) => `Quantity for ${name}`,
  quantityInvalid: "Use a whole, non-negative number.",
  refreshedAnnouncement: (name, quantity, unit) =>
    `${name} was refreshed. The saved quantity is now ${quantity} ${unit}.`,
  removedAnnouncement: (name) => `${name} was removed from the order basket.`,
  reviewUnavailable:
    "The order basket is unavailable. Check the connection and try again.",
  savedAnnouncement: (name, quantity, unit, projection) => {
    const result = `Saved ${quantity} ${unit} for ${name}`;
    if (projection.warning === "surplus" && projection.maximumLevel !== null) {
      return `${result} — projected ${projection.projectedLevel} exceeds the maximum ${projection.maximumLevel} and could create surplus or waste.`;
    }
    if (projection.maximumLevel !== null) {
      return `${result} — projected ${projection.projectedLevel} is within the maximum ${projection.maximumLevel}.`;
    }
    return `${result} — projected ${projection.projectedLevel}; no maximum level is set.`;
  },
  statusLabels: { ordered: "Ordered" },
  surplusWarning: (projected, maximum) =>
    `Projected ${projected} — could create surplus or waste (maximum ${maximum})`,
  tabs: { basket: "Basket", ordered: "Ordered Items" },
  title: "Order basket",
  withinMaximum: "Within the maximum",
  returnedAnnouncement: (name) => `${name} returned to the order basket.`,
};

export const basketMessages: Record<Locale, BasketCopy> = {
  ar: arabic,
  en: english,
};
