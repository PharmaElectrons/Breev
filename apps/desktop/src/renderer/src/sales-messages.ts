import { SALES_DENIAL_CODES } from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export function salesLoadMoreMessage(locale: Locale): string {
  return locale === "ar" ? "عرض المزيد من النتائج" : "Load more results";
}

export function salesUpdatedLabel(locale: Locale): string {
  return locale === "ar" ? "آخر تحديث" : "Updated";
}

export type SalesDenialCode = (typeof SALES_DENIAL_CODES)[number];

export interface SalesCopy {
  readonly addToBasket: string;
  readonly addToBasketAriaLabel: (name: string) => string;
  readonly denialMessages: Record<SalesDenialCode, string>;
  readonly description: string;
  readonly draftHeading: (createdAt: string) => string;
  readonly draftUnavailable: string;
  readonly activeDraft: string;
  readonly draftsHeading: string;
  readonly itemColumn: string;
  readonly empty: string;
  readonly loading: string;
  readonly newDraft: string;
  readonly noResults: string;
  readonly openedBy: (displayName: string) => string;
  readonly permissionDenied: string;
  readonly reload: string;
  readonly resume: string;
  readonly resumeAriaLabel: (createdAt: string) => string;
  readonly searchAgain: string;
  readonly searchDenied: string;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly searchResultCount: (count: number) => string;
  readonly searchUnavailable: string;
  readonly searching: string;
  readonly selectDraftPrompt: string;
  readonly title: string;
  readonly versionLabel: (version: string) => string;
}

const arabicDenials: Record<SalesDenialCode, string> = {
  "body-invalid": "تعذّر قبول الطلب. تحقق من البيانات المُدخلة.",
  "idempotency-conflict":
    "أُرسل الأمر نفسه ببيانات مختلفة. أعد تحميل المسودة وحاول مجدداً.",
  "sale-draft-not-found": "لم تعد مسودة البيع هذه موجودة.",
  "sale-line-not-found": "لم يعد سطر البيع هذا موجوداً. أعد تحميل المسودة.",
  "sale-product-unavailable": "المادة غير متاحة للبيع. ابحث عنها من جديد.",
  "sale-unit-invalid": "لا يمكن استخدام هذه الوحدة مع المادة.",
  "sale-quantity-invalid": "الكمية لا تتوافق مع تحويل الوحدة.",
  "sale-quick-access-invalid": "إعداد الوصول السريع غير صالح.",
  "sale-price-invalid": "السعر الجديد أو سبب تغييره غير صالح.",
  "sale-discount-invalid": "الخصم يتجاوز المبلغ المتاح أو قيمته غير صحيحة.",
  "sale-draft-inactive": "هذه المسودة غير نشطة. استأنفها قبل التعديل.",
  "version-conflict": "استُؤنفت هذه المسودة على جهاز آخر. أعد تحميل القائمة.",
};

const englishDenials: Record<SalesDenialCode, string> = {
  "body-invalid": "The request was not accepted. Check the entered values.",
  "idempotency-conflict":
    "The same command was sent with different data. Reload the draft and try again.",
  "sale-draft-not-found": "This sale draft no longer exists.",
  "sale-line-not-found": "This sale line no longer exists. Reload the draft.",
  "sale-product-unavailable":
    "This item is unavailable for sale. Search again.",
  "sale-unit-invalid": "This unit cannot be used for the item.",
  "sale-quantity-invalid": "The quantity cannot be converted to that unit.",
  "sale-quick-access-invalid": "The quick-access settings are invalid.",
  "sale-price-invalid": "The new price or its reason is invalid.",
  "sale-discount-invalid":
    "The discount is invalid or exceeds the available amount.",
  "sale-draft-inactive": "This draft is inactive. Resume it before editing.",
  "version-conflict":
    "This draft was resumed on another device. Reload the list.",
};

export const salesMessages: Record<Locale, SalesCopy> = {
  ar: {
    addToBasket: "إضافة إلى سلة الطلبات",
    addToBasketAriaLabel: (name) => `إضافة ${name} إلى سلة الطلبات`,
    denialMessages: arabicDenials,
    description:
      "افتح مسودة بيع أو استأنفها، ثم ابحث عن صنف لإضافته إلى سلة الطلبات. تبقى المسودة محفوظة على الخادم.",
    draftHeading: (createdAt) => `مسودة بيع — فُتحت ${createdAt}`,
    draftUnavailable:
      "تعذّر الوصول إلى مسودة البيع. تحقق من الاتصال وحاول مرة أخرى.",
    activeDraft: "المسودة الحالية",
    draftsHeading: "مسودات البيع المفتوحة",
    itemColumn: "المادة",
    empty: "لا توجد مسودات بيع مفتوحة.",
    loading: "جارٍ التحميل…",
    newDraft: "مسودة بيع جديدة",
    noResults: "لا توجد نتائج مطابقة.",
    openedBy: (displayName) => `فتحها ${displayName}`,
    permissionDenied: "لا تملك صلاحية العمل على مسودات البيع.",
    reload: "إعادة التحميل",
    resume: "استئناف",
    resumeAriaLabel: (createdAt) => `استئناف مسودة البيع المفتوحة ${createdAt}`,
    searchAgain: "إعادة البحث",
    searchDenied: "لا تملك صلاحية البحث في الأصناف.",
    searchLabel: "ابحث بالاسم العربي أو الإنجليزي أو الباركود",
    searchPlaceholder: "ابحث عن صنف",
    searchResultCount: (count) => `عدد نتائج البحث: ${String(count)}`,
    searchUnavailable: "تعذّر إجراء البحث. تحقق من الاتصال وحاول مرة أخرى.",
    searching: "جارٍ البحث…",
    selectDraftPrompt: "أنشئ مسودة جديدة أو اختر مسودة من القائمة للمتابعة.",
    title: "البيع",
    versionLabel: (version) => `الإصدار ${version}`,
  },
  en: {
    addToBasket: "Add to order basket",
    addToBasketAriaLabel: (name) => `Add ${name} to the order basket`,
    denialMessages: englishDenials,
    description:
      "Open or resume a sale draft, then search for an item to add to the order basket. The draft is kept on the server.",
    draftHeading: (createdAt) => `Sale draft — opened ${createdAt}`,
    draftUnavailable:
      "The sale draft is unavailable. Check the connection and try again.",
    activeDraft: "Current draft",
    draftsHeading: "Open sale drafts",
    itemColumn: "Item",
    empty: "There are no open sale drafts.",
    loading: "Loading…",
    newDraft: "New sale draft",
    noResults: "No items matched.",
    openedBy: (displayName) => `Opened by ${displayName}`,
    permissionDenied: "You do not have permission to work on sale drafts.",
    reload: "Reload",
    resume: "Resume",
    resumeAriaLabel: (createdAt) => `Resume the sale draft opened ${createdAt}`,
    searchAgain: "Search again",
    searchDenied: "You do not have permission to search items.",
    searchLabel: "Search Arabic name, English name, or barcode",
    searchPlaceholder: "Search for an item",
    searchResultCount: (count) => `Search results: ${String(count)}`,
    searchUnavailable:
      "The search is unavailable. Check the connection and try again.",
    searching: "Searching…",
    selectDraftPrompt:
      "Create a draft or choose one from the list to continue.",
    title: "Sales",
    versionLabel: (version) => `Version ${version}`,
  },
};
