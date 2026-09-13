import { SALES_DENIAL_CODES } from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export type SalesDenialCode = (typeof SALES_DENIAL_CODES)[number];

export interface SalesCopy {
  readonly addToBasket: string;
  readonly addToBasketAriaLabel: (name: string) => string;
  readonly archivedResultRow: string;
  readonly denialMessages: Record<SalesDenialCode, string>;
  readonly description: string;
  readonly draftHeading: (createdAt: string) => string;
  readonly draftUnavailable: string;
  readonly draftsHeading: string;
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
  readonly title: string;
  readonly versionLabel: (version: string) => string;
}

const arabicDenials: Record<SalesDenialCode, string> = {
  "body-invalid": "تعذّر قبول الطلب. تحقق من البيانات المُدخلة.",
  "idempotency-conflict":
    "أُرسل الأمر نفسه ببيانات مختلفة. أعد تحميل المسودة وحاول مجدداً.",
  "sale-draft-not-found": "لم تعد مسودة البيع هذه موجودة.",
  "version-conflict": "استُؤنفت هذه المسودة على جهاز آخر. أعد تحميل القائمة.",
};

const englishDenials: Record<SalesDenialCode, string> = {
  "body-invalid": "The request was not accepted. Check the entered values.",
  "idempotency-conflict":
    "The same command was sent with different data. Reload the draft and try again.",
  "sale-draft-not-found": "This sale draft no longer exists.",
  "version-conflict":
    "This draft was resumed on another device. Reload the list.",
};

export const salesMessages: Record<Locale, SalesCopy> = {
  ar: {
    addToBasket: "إضافة إلى سلة الطلبات",
    addToBasketAriaLabel: (name) => `إضافة ${name} إلى سلة الطلبات`,
    archivedResultRow: "مؤرشفة — لا يمكن طلبها؛ اختر المادة النشطة.",
    denialMessages: arabicDenials,
    description:
      "افتح مسودة بيع أو استأنفها، ثم ابحث عن صنف لإضافته إلى سلة الطلبات. تبقى المسودة محفوظة على الخادم.",
    draftHeading: (createdAt) => `مسودة بيع — فُتحت ${createdAt}`,
    draftUnavailable:
      "تعذّر الوصول إلى مسودة البيع. تحقق من الاتصال وحاول مرة أخرى.",
    draftsHeading: "مسودات البيع المفتوحة",
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
    title: "البيع",
    versionLabel: (version) => `الإصدار ${version}`,
  },
  en: {
    addToBasket: "Add to order basket",
    addToBasketAriaLabel: (name) => `Add ${name} to the order basket`,
    archivedResultRow:
      "Archived — it cannot be ordered; choose the active item.",
    denialMessages: englishDenials,
    description:
      "Open or resume a sale draft, then search for an item to add to the order basket. The draft is kept on the server.",
    draftHeading: (createdAt) => `Sale draft — opened ${createdAt}`,
    draftUnavailable:
      "The sale draft is unavailable. Check the connection and try again.",
    draftsHeading: "Open sale drafts",
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
    title: "Sales",
    versionLabel: (version) => `Version ${version}`,
  },
};
