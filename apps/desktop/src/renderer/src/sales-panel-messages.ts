import { SALE_ITEM_PANEL_FIELDS } from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export type SaleItemPanelField = (typeof SALE_ITEM_PANEL_FIELDS)[number];

export interface SalesPanelMessages {
  // Panel headers and labels
  readonly itemDetailsTitle: string;
  readonly currentPrice: string;
  readonly scientificName: string;
  readonly wholesalePrice: string;
  readonly packaging: string;
  readonly balance: string;
  readonly detailedBalance: string;
  readonly totalBalance: string;
  readonly stockLimits: string;
  readonly minLimit: string;
  readonly maxLimit: string;
  readonly consumptionRate: string;
  readonly noConsumptionHistory: string;
  readonly consumptionPeriodLabel: (months: 1 | 2 | 3) => string;
  readonly estimatedSurplus: string;
  readonly itemPreview: string;
  readonly noImage: string;
  readonly batchesHeading: string;
  readonly notSet: string;
  readonly noStockRecord: string;
  readonly maximumNotSet: string;
  readonly noBatchesRecorded: string;
  readonly unlabeledBatchOrdinal: (ordinal: number) => string;
  readonly batchStatus: Record<
    | "eligible"
    | "near-expiry"
    | "expired"
    | "recalled"
    | "quarantined"
    | "postponed-blocked",
    string
  >;
  readonly expiryDate: string;
  readonly noExpiryDate: string;
  readonly daysRemaining: (days: number) => string;
  readonly daysExpired: (days: number) => string;

  // Presentation Settings Modal
  readonly settingsModalTitle: string;
  readonly settingsModalDescription: string;
  readonly tabFields: string;
  readonly tabQuickAccess: string;
  readonly fieldsSectionTitle: string;
  readonly fieldsSectionHint: string;
  readonly fieldLabels: Record<SaleItemPanelField, string>;
  readonly consumptionSectionTitle: string;
  readonly consumptionMonthsOptions: Record<1 | 2 | 3, string>;
  readonly drawerBalanceSectionTitle: string;
  readonly drawerBalanceLabel: string;
  readonly currentEmployeeDrawer: string;
  readonly drawerBalanceLoading: string;
  readonly drawerBalanceUnavailable: string;
  readonly drawerBalanceError: string;
  readonly quickAccessSectionTitle: string;
  readonly quickAccessSectionHint: string;
  readonly newCategoryPlaceholder: string;
  readonly addCategoryButton: string;
  readonly categoryNameLabel: string;
  readonly moveCategoryUp: string;
  readonly moveCategoryDown: string;
  readonly deleteCategory: string;
  readonly tilesInCategoryHeading: string;
  readonly emptyCategoryPrompt: string;
  readonly noCategoriesPrompt: string;
  readonly moveTileUp: string;
  readonly moveTileDown: string;
  readonly removeTile: string;
  readonly chooseTileImage: string;
  readonly removeTileImage: string;
  readonly imageRequirementsHint: string;
  readonly imageTooLargeError: string;
  readonly quickAccessPayloadTooLargeError: string;
  readonly imageTypeUnsupportedError: string;
  readonly imageReadError: string;
  readonly categoryNameRequiredError: string;
  readonly atLeastOneFieldRequiredError: string;
  readonly maxCategoriesReachedError: string;
  readonly saveSettingsButton: string;
  readonly savingSettingsButton: string;
  readonly cancelButton: string;
  readonly closeButton: string;
  readonly presentationSettingsButton: string;
}

const ARABIC_MESSAGES: SalesPanelMessages = {
  noConsumptionHistory: "لا يوجد سجل مبيعات",
  drawerBalanceUnavailable: "لا توجد حركات درج مسجلة",
  itemDetailsTitle: "تفاصيل المادة",
  currentPrice: "سعر البيع الحالي",
  scientificName: "الاسم العلمي",
  wholesalePrice: "سعر الجملة",
  packaging: "التعبئة والتحويل",
  balance: "الرصيد المتوفر",
  detailedBalance: "الرصيد بالتفصيل",
  totalBalance: "الإجمالي",
  stockLimits: "حدود المخزن",
  minLimit: "الحد الأدنى",
  maxLimit: "الحد الأعلى",
  consumptionRate: "معدل الصرف",
  consumptionPeriodLabel: (months) =>
    months === 1
      ? "متوسط شهر واحد"
      : months === 2
        ? "متوسط شهرين"
        : "متوسط 3 أشهر",
  estimatedSurplus: "الفائض التقديري",
  itemPreview: "معاينة المادة المحددة",
  noImage: "لا توجد صورة",
  batchesHeading: "الوجبات والتشغيلات",
  notSet: "غير محدد",
  noStockRecord: "لا يوجد سجل مخزون",
  maximumNotSet: "الحد الأعلى غير محدد",
  noBatchesRecorded: "لا توجد وجبات مسجلة لهذه المادة",
  unlabeledBatchOrdinal: (ordinal) => `وجبة رقم ${ordinal}`,
  batchStatus: {
    eligible: "صالح للصرف",
    "near-expiry": "قريب الانتهاء",
    expired: "منتهي الصلاحية",
    recalled: "مسحوب من التداول",
    quarantined: "قيد الحجر",
    "postponed-blocked": "موقوف مؤقتاً",
  },
  expiryDate: "تاريخ الصلاحية",
  noExpiryDate: "بدون تاريخ صلاحية",
  daysRemaining: (days) => `${days} يوم متبقٍ`,
  daysExpired: (days) => `منتهٍ منذ ${days} يوم`,

  settingsModalTitle: "إعدادات عرض نقطة البيع",
  settingsModalDescription:
    "تخصيص الحقول المعروضة في شريط تفاصيل المادة وإدارة فئات ومواد الوصول السريع.",
  tabFields: "حقول تفاصيل المادة",
  tabQuickAccess: "فئات الوصول السريع",
  fieldsSectionTitle: "حقول بطاقة تفاصيل المادة",
  fieldsSectionHint:
    "اختر الحقول التي ترغب في إظهارها في شريط تفاصيل المادة عند البيع:",
  fieldLabels: {
    scientificName: "الاسم العلمي للمادة",
    balance: "الرصيد المخزني الحالي",
    packaging: "وحدات التعبئة والتحويل",
    levels: "حدود المخزن (الأدنى والأعلى)",
    batches: "قائمة الوجبات والتشغيلات",
    expiry: "تاريخ الصلاحية وتنبيهات الأيام",
    consumption: "معدل الصرف والاستهلاك",
    surplus: "الفائض التقديري عن الحد الأعلى",
    thumbnail: "صورة المادة المصغرة",
    wholesalePrice: "سعر الجملة (عند توفر الصلاحية)",
  },
  consumptionSectionTitle: "فترة حساب معدل الاستهلاك",
  consumptionMonthsOptions: {
    1: "متوسط شهر واحد (30 يوماً)",
    2: "متوسط شهرين (60 يوماً)",
    3: "متوسط 3 أشهر (90 يوماً)",
  },
  drawerBalanceSectionTitle: "درج النقدية",
  drawerBalanceLabel: "إظهار رصيد درج النقدية في شاشة البيع",
  currentEmployeeDrawer: "درج الموظف الحالي",
  drawerBalanceLoading: "جارٍ التحميل...",
  drawerBalanceError: "تعذر تحميل رصيد الدرج",
  quickAccessSectionTitle: "إدارة فئات ومواد الوصول السريع",
  quickAccessSectionHint:
    "يمكنك إعادة ترتيب أو تسمية الفئات، وحذفها، وإعادة ترتيب المواد وتعيين صورها المصغرة. لتثبيت مواد جديدة استخدم شاشة البيع.",
  newCategoryPlaceholder: "اسم الفئة الجديدة...",
  addCategoryButton: "إضافة فئة",
  categoryNameLabel: "اسم الفئة",
  moveCategoryUp: "نقل الفئة للأعلى",
  moveCategoryDown: "نقل الفئة للأسفل",
  deleteCategory: "حذف الفئة",
  tilesInCategoryHeading: "المواد في هذه الفئة",
  emptyCategoryPrompt:
    "لا توجد مواد في هذه الفئة حالياً. ثبّت مواد من شاشة البيع لعرضها هنا.",
  noCategoriesPrompt:
    "لم تُنشأ أي فئات وصول سريع بعد. أدخل اسماً أعلاه لإضافة أول فئة.",
  moveTileUp: "نقل المادة للأعلى",
  moveTileDown: "نقل المادة للأسفل",
  removeTile: "إزالة من الوصول السريع",
  chooseTileImage: "تغيير الصورة",
  removeTileImage: "إزالة الصورة",
  imageRequirementsHint:
    "الصور المدعومة: PNG أو JPEG أو WebP، بحجم أقصى 70 كيلوبايت.",
  imageTooLargeError:
    "حجم ملف الصورة يتجاوز الحد الأقصى المسموح به (70 كيلوبايت).",
  quickAccessPayloadTooLargeError:
    "حجم إعدادات الوصول السريع وصورها يتجاوز ميغابايت واحداً. أزل بعض الصور أو استخدم صوراً أصغر.",
  imageTypeUnsupportedError:
    "نوع ملف الصورة غير مدعوم. يرجى اختيار ملف بصيغة PNG أو JPEG أو WebP.",
  imageReadError: "تعذر قراءة ملف الصورة. حاول اختيار ملف آخر.",
  categoryNameRequiredError: "يجب إدخال اسم صالح لكل فئة (بين 1 و64 حرفاً).",
  atLeastOneFieldRequiredError:
    "يجب تحديد حقل واحد على الأقل للعرض في بطاقة تفاصيل المادة.",
  maxCategoriesReachedError: "تم الوصول إلى الحد الأقصى لعدد الفئات (12 فئة).",
  saveSettingsButton: "حفظ الإعدادات",
  savingSettingsButton: "جارٍ الحفظ...",
  cancelButton: "إلغاء",
  closeButton: "إغلاق",
  presentationSettingsButton: "إعدادات العرض",
};

const ENGLISH_MESSAGES: SalesPanelMessages = {
  itemDetailsTitle: "Item Details",
  currentPrice: "Current Retail Price",
  scientificName: "Scientific Name",
  wholesalePrice: "Wholesale Price",
  packaging: "Packaging & Units",
  balance: "Available Balance",
  detailedBalance: "Detailed Balance",
  totalBalance: "Total",
  stockLimits: "Stock Limits",
  minLimit: "Min",
  maxLimit: "Max",
  consumptionRate: "Consumption Rate",
  noConsumptionHistory: "No sales history",
  consumptionPeriodLabel: (months) =>
    months === 1 ? "1-month avg" : months === 2 ? "2-month avg" : "3-month avg",
  estimatedSurplus: "Estimated Surplus",
  itemPreview: "Selected Item Preview",
  noImage: "No image available",
  batchesHeading: "Batches & Lots",
  notSet: "Not set",
  noStockRecord: "No stock record",
  maximumNotSet: "Maximum limit not set",
  noBatchesRecorded: "No batches recorded for this item",
  unlabeledBatchOrdinal: (ordinal) => `Batch #${ordinal}`,
  batchStatus: {
    eligible: "Eligible",
    "near-expiry": "Near expiry",
    expired: "Expired",
    recalled: "Recalled",
    quarantined: "Quarantined",
    "postponed-blocked": "Postponed / Blocked",
  },
  expiryDate: "Expiry Date",
  noExpiryDate: "No expiry date",
  daysRemaining: (days) => `${days} days left`,
  daysExpired: (days) => `Expired ${days} days ago`,

  settingsModalTitle: "POS Presentation Settings",
  settingsModalDescription:
    "Customize fields displayed in the item details sidebar and manage quick-access categories and tiles.",
  tabFields: "Item Panel Fields",
  tabQuickAccess: "Quick-Access Categories",
  fieldsSectionTitle: "Item Details Panel Fields",
  fieldsSectionHint:
    "Select the fields to display in the item details sidebar during sales:",
  fieldLabels: {
    scientificName: "Scientific name",
    balance: "Current inventory balance",
    packaging: "Packaging & conversion units",
    levels: "Stock limits (Min / Max)",
    batches: "Batches & lots list",
    expiry: "Expiry date & day alerts",
    consumption: "Consumption & dispense rate",
    surplus: "Estimated surplus above maximum",
    thumbnail: "Item thumbnail image",
    wholesalePrice: "Wholesale price (when permitted)",
  },
  consumptionSectionTitle: "Consumption Rate Period",
  consumptionMonthsOptions: {
    1: "1-month average (30 days)",
    2: "2-month average (60 days)",
    3: "3-month average (90 days)",
  },
  drawerBalanceSectionTitle: "Cash Drawer",
  drawerBalanceLabel: "Show cash drawer balance in the sales interface",
  currentEmployeeDrawer: "Current employee drawer",
  drawerBalanceLoading: "Loading...",
  drawerBalanceUnavailable: "No drawer activity recorded",
  drawerBalanceError: "Drawer balance unavailable",
  quickAccessSectionTitle: "Quick-Access Categories & Tiles",
  quickAccessSectionHint:
    "Rename, reorder, or delete categories; reorder tiles and update tile thumbnails. To pin new items, use the sales screen.",
  newCategoryPlaceholder: "New category name...",
  addCategoryButton: "Add category",
  categoryNameLabel: "Category name",
  moveCategoryUp: "Move category up",
  moveCategoryDown: "Move category down",
  deleteCategory: "Delete category",
  tilesInCategoryHeading: "Items in this category",
  emptyCategoryPrompt:
    "No items in this category yet. Pin items from the sales screen to show them here.",
  noCategoriesPrompt:
    "No quick-access categories created yet. Enter a name above to add your first category.",
  moveTileUp: "Move item up",
  moveTileDown: "Move item down",
  removeTile: "Remove from quick access",
  chooseTileImage: "Change image",
  removeTileImage: "Remove image",
  imageRequirementsHint:
    "Supported image formats: PNG, JPEG, or WebP. Maximum file size: 70 KB.",
  imageTooLargeError:
    "Image file size exceeds the maximum allowed limit (70 KB).",
  quickAccessPayloadTooLargeError:
    "Quick-access settings and images exceed 1 MB. Remove some images or use smaller files.",
  imageTypeUnsupportedError:
    "Image file format is unsupported. Please choose a PNG, JPEG, or WebP file.",
  imageReadError: "Could not read the image file. Please choose another file.",
  categoryNameRequiredError:
    "Every category must have a valid name between 1 and 64 characters.",
  atLeastOneFieldRequiredError:
    "At least one field must be selected for the item details panel.",
  maxCategoriesReachedError:
    "Maximum number of categories reached (12 categories).",
  saveSettingsButton: "Save settings",
  savingSettingsButton: "Saving...",
  cancelButton: "Cancel",
  closeButton: "Close",
  presentationSettingsButton: "Presentation Settings",
};

export function getSalesPanelMessages(locale: Locale): SalesPanelMessages {
  return locale === "ar" ? ARABIC_MESSAGES : ENGLISH_MESSAGES;
}
