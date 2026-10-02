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
  readonly activeDraft: string;
  readonly addToBasket: string;
  readonly addToBasketAriaLabel: (name: string) => string;
  readonly changePrice: string;
  readonly changeQuantity: string;
  readonly changeUnit: string;
  readonly denialMessages: Record<SalesDenialCode, string>;
  readonly description: string;
  readonly discountAmount: string;
  readonly draftHeading: (createdAt: string) => string;
  readonly draftsHeading: string;
  readonly draftUnavailable: string;
  readonly empty: string;
  readonly itemColumn: string;
  readonly itemsCount: string;
  readonly loading: string;
  readonly newDraft: string;
  readonly newDraftButton: string;
  readonly noItemSelectedPrompt: string;
  readonly noResults: string;
  readonly openedBy: (displayName: string) => string;
  readonly patientSearchPlaceholder: string;
  readonly patientUnlinkedStatus: string;
  readonly permissionDenied: string;
  readonly quickAccessButton: string;
  readonly reload: string;
  readonly resume: string;
  readonly resumeAriaLabel: (createdAt: string) => string;
  readonly scanOrSearchPlaceholder: string;
  readonly searchAgain: string;
  readonly searchDenied: string;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly searchResultCount: (count: number) => string;
  readonly searchUnavailable: string;
  readonly searching: string;
  readonly selectDraftPrompt: string;
  readonly selectItemPrompt: string;
  readonly selectProductButton: string;
  readonly selectedItemPreview: string;
  readonly title: string;
  readonly versionLabel: (version: string) => string;
  readonly miscNameLabel: string;
  readonly miscUnitLabel: string;
  readonly miscQuantityLabel: string;
  readonly miscPriceLabel: string;
  readonly miscCostLabel: string;
  readonly miscSubmitButton: string;
  readonly miscValidationMessage: string;
  readonly miscPriceTooLargeMessage: string;
  readonly miscCostTooLargeMessage: string;
  readonly scanAddButton: string;
  readonly createNewItemButton: string;
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
    activeDraft: "المسودة الحالية",
    addToBasket: "إضافة إلى سلة الطلبات",
    addToBasketAriaLabel: (name) => `إضافة ${name} إلى سلة الطلبات`,
    changePrice: "تغيير السعر",
    changeQuantity: "تغيير العدد",
    changeUnit: "تغيير الوحدة",
    denialMessages: arabicDenials,
    description:
      "افتح مسودة بيع أو استأنفها، ثم ابحث عن صنف لإضافته إلى سلة الطلبات. تبقى المسودة محفوظة على الخادم.",
    discountAmount: "مبلغ الخصم",
    draftHeading: (createdAt) => `مسودة بيع — فُتحت ${createdAt}`,
    draftUnavailable:
      "تعذّر الوصول إلى مسودة البيع. تحقق من الاتصال وحاول مرة أخرى.",
    draftsHeading: "مسودات البيع المفتوحة",
    empty: "لا توجد مسودات بيع مفتوحة.",
    itemColumn: "اسم المادة",
    itemsCount: "عدد المواد",
    loading: "جارٍ التحميل…",
    newDraft: "مسودة بيع جديدة",
    newDraftButton: "إضافة",
    noItemSelectedPrompt:
      "لا توجد مادة محددة. اختر مادة من الفاتورة لعرض تفاصيلها.",
    noResults: "لا توجد نتائج مطابقة.",
    openedBy: (displayName) => `فتحها ${displayName}`,
    patientSearchPlaceholder: "ابحث باسم المريض أو رقم الهاتف...",
    patientUnlinkedStatus: "لم يتم اختيار مريض — الفاتورة بدون ربط بمريض.",
    permissionDenied: "لا تملك صلاحية العمل على مسودات البيع.",
    quickAccessButton: "روابط سريعة",
    reload: "إعادة التحميل",
    resume: "استئناف",
    resumeAriaLabel: (createdAt) => `استئناف مسودة البيع المفتوحة ${createdAt}`,
    scanOrSearchPlaceholder:
      "امسح الباركود أو اكتبه ثم Enter لإضافة المادة للفاتورة",
    searchAgain: "إعادة البحث",
    searchDenied: "لا تملك صلاحية البحث في الأصناف.",
    searchLabel: "ابحث بالاسم العربي أو الإنجليزي أو الباركود",
    searchPlaceholder: "ابحث عن صنف",
    searchResultCount: (count) => `عدد نتائج البحث: ${String(count)}`,
    searchUnavailable: "تعذّر إجراء البحث. تحقق من الاتصال وحاول مرة أخرى.",
    searching: "جارٍ البحث…",
    selectDraftPrompt: "أنشئ مسودة جديدة أو اختر مسودة من القائمة للمتابعة.",
    selectItemPrompt: "اختر مادة",
    selectProductButton: "+ اختر مادة",
    selectedItemPreview: "معاينة المادة المحددة",
    title: "البيع",
    versionLabel: (version) => `الإصدار ${version}`,
    miscNameLabel: "الاسم",
    miscUnitLabel: "الوحدة",
    miscQuantityLabel: "الكمية",
    miscPriceLabel: "سعر الوحدة (د.ع)",
    miscCostLabel: "التكلفة (د.ع)",
    miscSubmitButton: "إضافة إلى الفاتورة",
    miscValidationMessage: "تحقق من الاسم والوحدة والكمية والسعر والتكلفة.",
    miscPriceTooLargeMessage: "السعر كبير جداً.",
    miscCostTooLargeMessage: "التكلفة كبيرة جداً.",
    scanAddButton: "إضافة",
    createNewItemButton: "إنشاء مادة جديدة",
  },
  en: {
    activeDraft: "Current draft",
    addToBasket: "Add to order basket",
    addToBasketAriaLabel: (name) => `Add ${name} to the order basket`,
    changePrice: "Change price",
    changeQuantity: "Change quantity",
    changeUnit: "Change unit",
    denialMessages: englishDenials,
    description:
      "Open or resume a sale draft, then search for an item to add to the order basket. The draft is kept on the server.",
    discountAmount: "Discount amount",
    draftHeading: (createdAt) => `Sale draft — opened ${createdAt}`,
    draftUnavailable:
      "The sale draft is unavailable. Check the connection and try again.",
    draftsHeading: "Open sale drafts",
    empty: "There are no open sale drafts.",
    itemColumn: "Item",
    itemsCount: "Items count",
    loading: "Loading…",
    newDraft: "New sale draft",
    newDraftButton: "New",
    noItemSelectedPrompt:
      "No item selected. Select an item from the invoice to show its details.",
    noResults: "No items matched.",
    openedBy: (displayName) => `Opened by ${displayName}`,
    patientSearchPlaceholder: "Search patient name or phone number...",
    patientUnlinkedStatus:
      "No patient selected — invoice not linked to a patient.",
    permissionDenied: "You do not have permission to work on sale drafts.",
    quickAccessButton: "Quick Access",
    reload: "Reload",
    resume: "Resume",
    resumeAriaLabel: (createdAt) => `Resume the sale draft opened ${createdAt}`,
    scanOrSearchPlaceholder:
      "Scan barcode or type then Enter to add item to invoice",
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
    selectItemPrompt: "Choose an item",
    selectProductButton: "+ Select item",
    selectedItemPreview: "Selected item preview",
    title: "Sales",
    versionLabel: (version) => `Version ${version}`,
    miscNameLabel: "Name",
    miscUnitLabel: "Unit",
    miscQuantityLabel: "Quantity",
    miscPriceLabel: "Unit price (IQD)",
    miscCostLabel: "Cost (IQD)",
    miscSubmitButton: "Add to sale",
    miscValidationMessage: "Check the name, unit, quantity, price, and cost.",
    miscPriceTooLargeMessage: "Price is too large.",
    miscCostTooLargeMessage: "Cost is too large.",
    scanAddButton: "Add",
    createNewItemButton: "Create new item",
  },
};
