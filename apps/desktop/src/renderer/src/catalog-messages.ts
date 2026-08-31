import type {
  CatalogDenialCode,
  CatalogFieldErrorCode,
  ProductDefinitionMode,
  ProductFoodTiming,
  ProductStateColour,
  ProductStatus,
} from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export interface CatalogCopy {
  readonly actions: {
    readonly archive: string;
    readonly archiveConfirmSubmit: string;
    readonly archiveConfirmTitle: string;
    readonly archiveConfirmWarning: string;
    readonly cancel: string;
    readonly create: string;
    readonly edit: string;
    readonly merge: string;
    readonly mergeConfirmSubmit: string;
    readonly mergeDescription: string;
    readonly mergeTitle: string;
    readonly saveChanges: string;
  };
  readonly barcodes: {
    readonly add: string;
    readonly empty: string;
    readonly label: string;
    readonly placeholder: string;
    readonly remove: string;
  };
  readonly definition: {
    readonly generalItem: {
      readonly company: string;
      readonly property: string;
      readonly size: string;
      readonly subBrand: string;
      readonly targetAudience: string;
      readonly typeOfUse: string;
    };
    readonly medication: {
      readonly dosageForm: string;
      readonly manufacturer: string;
      readonly strength: string;
      readonly tradeName: string;
    };
    readonly modeLabel: string;
    readonly modes: Record<ProductDefinitionMode, string>;
  };
  readonly denials: Record<CatalogDenialCode, string>;
  readonly fieldErrors: Record<CatalogFieldErrorCode, string>;
  readonly fields: {
    readonly arabicSearchName: string;
    readonly arabicSearchNameHint: string;
    readonly category: string;
    readonly generatedDisplayName: string;
    readonly generatedDisplayNameEmpty: string;
    readonly generatedDisplayNameHint: string;
    readonly scientificName: string;
    readonly survivorProductId: string;
    readonly survivorProductPlaceholder: string;
  };
  readonly instructions: {
    readonly description: string;
    readonly foodTiming: string;
    readonly foodTimingNone: string;
    readonly foodTimings: Record<ProductFoodTiming, string>;
    readonly title: string;
    readonly usesPerDay: string;
    readonly usesPerMonth: string;
    readonly usesPerWeek: string;
  };
  readonly inventory: {
    readonly balanceLabel: string;
    readonly emptyState: string;
    readonly readOnlyAssistiveText: string;
    readonly title: string;
  };
  readonly list: {
    readonly empty: string;
    readonly loading: string;
    readonly newProduct: string;
    readonly title: string;
  };
  readonly modeSwitchModal: {
    readonly abandonedFieldsLead: string;
    readonly cancel: string;
    readonly confirm: string;
    readonly description: string;
    readonly title: string;
  };
  readonly record: {
    readonly id: string;
    readonly mergedInto: string;
    readonly nameTemplateVersion: string;
    readonly revision: string;
    readonly status: string;
    readonly statuses: Record<ProductStatus, string>;
    readonly title: string;
  };
  readonly sharing: {
    readonly aiSharingAllowed: string;
    readonly description: string;
    readonly externallyVisible: string;
    readonly metadataNotice: string;
    readonly title: string;
  };
  readonly stateColours: {
    readonly coldStorageRequired: string;
    readonly colors: Record<ProductStateColour, string>;
    readonly manualColor: string;
    readonly manualColorNone: string;
    readonly title: string;
  };
  readonly titles: {
    readonly createProduct: string;
    readonly editProduct: string;
    readonly productCatalog: string;
  };
}

export const catalogMessages: Record<Locale, CatalogCopy> = {
  ar: {
    actions: {
      archive: "أرشفة المنتج",
      archiveConfirmSubmit: "تأكيد الأرشفة",
      archiveConfirmTitle: "أرشفة المنتج",
      archiveConfirmWarning:
        "هل أنت متأكد من أرشفة هذا المنتج؟ سيبقى المنتج قابلاً للقراءة في كافة السجلات والفواتير التاريخية.",
      cancel: "إلغاء",
      create: "إنشاء منتج",
      edit: "تعديل المنتج",
      merge: "دمج المنتج",
      mergeConfirmSubmit: "تأكيد الدمج",
      mergeDescription:
        "ستُوجّه العمليات والمعاملات المستقبلية إلى المنتج البديل المختار. سيبقى هذا المنتج محفوظاً للعرض التاريخي فقط.",
      mergeTitle: "دمج المنتج في منتج بديل",
      saveChanges: "حفظ التعديلات",
    },
    barcodes: {
      add: "إضافة باركود",
      empty: "لا يوجد باركود مضاف",
      label: "أرقام الباركود",
      placeholder: "أدخل رقم الباركود",
      remove: "إزالة",
    },
    definition: {
      generalItem: {
        company: "الشركة / المصنع",
        property: "الخاصية أو الدرجة",
        size: "الحجم أو السعة",
        subBrand: "العلامة الفرعية / السلسلة",
        targetAudience: "الفئة المستهدفة",
        typeOfUse: "النوع أو الاستخدام",
      },
      medication: {
        dosageForm: "الشكل الصيدلاني",
        manufacturer: "الشركة المصنعة",
        strength: "التركيز أو القوة",
        tradeName: "الاسم التجاري",
      },
      modeLabel: "وضع تعريف المنتج",
      modes: {
        "general-item": "منتج عام / طبي / تجميلي",
        medication: "دواء",
      },
    },
    denials: {
      "body-invalid": "بيانات المنتج المدخلة غير صالحة.",
      "idempotency-conflict": "تمت معالجة عملية متعارضة بهذا المفتاح مسبقاً.",
      "merge-into-self": "لا يمكن دمج المنتج مع نفسه.",
      "merge-survivor-not-mergeable":
        "المنتج البديل مؤرشف أو مدمج ولا يمكن الدمج فيه.",
      "product-archived": "المنتج مؤرشف ولا يمكن تعديله.",
      "product-merged": "المنتج مدمج بالفعل ولا يمكن تعديله.",
      "product-not-found": "المنتج المطلوب غير موجود في الفهرس.",
      "version-conflict":
        "تم تعديل المنتج بواسطة عملية أخرى. يرجى إعادة التحميل.",
    },
    fieldErrors: {
      invalid: "قيمة غير صالحة.",
      "out-of-range": "القيمة خارج النطاق المسموح به.",
      required: "هذا الحقل مطلوب.",
      "too-long": "القيمة تتجاوز الحد الأقصى للطول المسموح به.",
      "unknown-field": "حقل غير معروف.",
    },
    fields: {
      arabicSearchName: "اسم البحث بالعربية",
      arabicSearchNameHint:
        "اسم بحث مستقل باللغة العربية، لا يُدمج في الاسم الإنجليزي المعروض",
      category: "التصنيف",
      generatedDisplayName: "الاسم التجاري الإنجليزي المُولّد",
      generatedDisplayNameEmpty:
        "(املأ حقول التعريف أعلاه لتوليد الاسم تلقائياً)",
      generatedDisplayNameHint:
        "يتم توليده تلقائياً من حقول التعريف ولا يقبل الإدخال اليدوي الحر",
      scientificName: "الاسم العلمي / العام",
      survivorProductId: "معرّف المنتج البديل (UUID)",
      survivorProductPlaceholder: "019b0000-0000-7000-8000-000000000000",
    },
    instructions: {
      description: "تعليمات الاستخدام وتوقيت الطعام لسياق البيع والمريض.",
      foodTiming: "التوقيت بالنسبة للطعام",
      foodTimingNone: "غير محدد",
      foodTimings: {
        "after-food": "بعد الطعام",
        "before-food": "قبل الطعام",
        "regardless-of-food": "مع أو بدون طعام",
      },
      title: "تعليمات الاستخدام",
      usesPerDay: "مرات الاستخدام يومياً",
      usesPerMonth: "مرات الاستخدام شهرياً",
      usesPerWeek: "مرات الاستخدام أسبوعياً",
    },
    inventory: {
      balanceLabel: "رصيد المخزون",
      emptyState:
        "0 وحدة مخزنية — الرصيد يُشتق من حركات المخزون؛ لا تملك الفهرسة رصيد المخزون",
      readOnlyAssistiveText:
        "رصيد المخزون للقراءة فقط. لا يمكن تعديل الرصيد مباشرة من الفهرس.",
      title: "رصيد المخزون",
    },
    list: {
      empty: "لم يتم تعريف أي مواد في الفهرس بعد.",
      loading: "جارٍ تحميل المواد...",
      newProduct: "تعريف منتج جديد",
      title: "المواد المعرفة",
    },
    modeSwitchModal: {
      abandonedFieldsLead: "سيتم مسح وتفريغ القيم التالية:",
      cancel: "الإبقاء على الوضع الحالي",
      confirm: "تأكيد تبديل الوضع",
      description:
        "تبديل وضع التعريف سيؤدي إلى إزالة حقول الوضع الحالي ولن يتم تضمينها في تعريف المنتج الجديد.",
      title: "تأكيد تبديل وضع التعريف",
    },
    record: {
      id: "معرّف المنتج",
      mergedInto: "مدموج في المنتج",
      nameTemplateVersion: "إصدار قالب التسمية",
      revision: "رقم المراجعة",
      status: "حالة المنتج",
      statuses: {
        active: "نشط",
        archived: "مؤرشف",
        merged: "مدمج",
      },
      title: "سجل المنتج",
    },
    sharing: {
      aiSharingAllowed:
        "السماح بمشاركة البيانات مع خدمات الذكاء الاصطناعي الخارجية",
      description: "خيارات التحكم في ظهور المنتج ومشاركة بياناته.",
      externallyVisible: "متاح في العرض الخارجي والويب",
      metadataNotice:
        "خيارات المشاركة والظهور هي بيانات وصفية فقط وليست ضوابط أمان.",
      title: "المشاركة والظهور الخارجي",
    },
    stateColours: {
      coldStorageRequired: "يتطلب حفظاً مبرداً (حفظ بارد)",
      colors: {
        blue: "أزرق",
        green: "أخضر",
        grey: "رمادي",
        orange: "برتقالي",
        purple: "بنفسجي",
        red: "أحمر",
        yellow: "أصفر",
      },
      manualColor: "لون الحالة اليدوي",
      manualColorNone: "بدون لون",
      title: "مؤشرات الحالة والألوان",
    },
    titles: {
      createProduct: "تعريف منتج جديد",
      editProduct: "تعديل بيانات المنتج",
      productCatalog: "فهرس المواد",
    },
  },
  en: {
    actions: {
      archive: "Archive product",
      archiveConfirmSubmit: "Confirm archive",
      archiveConfirmTitle: "Archive product",
      archiveConfirmWarning:
        "Are you sure you want to archive this product? It will remain resolvable for historical snapshots and invoices.",
      cancel: "Cancel",
      create: "Create product",
      edit: "Edit product",
      merge: "Merge product",
      mergeConfirmSubmit: "Confirm merge",
      mergeDescription:
        "Future operations will redirect to the selected survivor product. This product will remain readable for historical documents only.",
      mergeTitle: "Merge product into survivor",
      saveChanges: "Save changes",
    },
    barcodes: {
      add: "Add barcode",
      empty: "No barcodes added",
      label: "Barcodes",
      placeholder: "Enter barcode",
      remove: "Remove",
    },
    definition: {
      generalItem: {
        company: "Company / Manufacturer",
        property: "Property / Degree",
        size: "Size / Volume",
        subBrand: "Sub-brand / Series",
        targetAudience: "Target / Audience",
        typeOfUse: "Type / Use",
      },
      medication: {
        dosageForm: "Dosage form",
        manufacturer: "Manufacturer",
        strength: "Strength",
        tradeName: "Trade name",
      },
      modeLabel: "Product definition mode",
      modes: {
        "general-item": "General / Medical / Cosmetic item",
        medication: "Medication",
      },
    },
    denials: {
      "body-invalid": "The submitted product data is invalid.",
      "idempotency-conflict":
        "A conflicting operation with this key was already processed.",
      "merge-into-self": "A product cannot be merged into itself.",
      "merge-survivor-not-mergeable":
        "The survivor product is archived or merged and cannot accept merges.",
      "product-archived": "The product is archived and cannot be modified.",
      "product-merged": "The product is already merged and cannot be modified.",
      "product-not-found":
        "The requested product was not found in the catalog.",
      "version-conflict":
        "The product has been modified by another operation. Please reload.",
    },
    fieldErrors: {
      invalid: "Invalid value.",
      "out-of-range": "Value is out of allowed range.",
      required: "This field is required.",
      "too-long": "Value exceeds maximum allowed length.",
      "unknown-field": "Unknown field.",
    },
    fields: {
      arabicSearchName: "Arabic search name",
      arabicSearchNameHint:
        "Independent Arabic search name, not appended to the English name",
      category: "Category",
      generatedDisplayName: "Generated English display name",
      generatedDisplayNameEmpty:
        "(Fill definition fields above to generate display name)",
      generatedDisplayNameHint:
        "Generated automatically from definition fields — free text entry is not permitted",
      scientificName: "Scientific / Generic name",
      survivorProductId: "Survivor Product ID (UUID)",
      survivorProductPlaceholder: "019b0000-0000-7000-8000-000000000000",
    },
    instructions: {
      description:
        "Usage frequency and food timing instructions for sales and patient context.",
      foodTiming: "Food timing",
      foodTimingNone: "Not specified",
      foodTimings: {
        "after-food": "After food",
        "before-food": "Before food",
        "regardless-of-food": "Regardless of food",
      },
      title: "Item instructions",
      usesPerDay: "Uses per day",
      usesPerMonth: "Uses per month",
      usesPerWeek: "Uses per week",
    },
    inventory: {
      balanceLabel: "Inventory balance",
      emptyState:
        "0 Inventory Units — balance is derived from Inventory movements; Catalog does not own stock balance",
      readOnlyAssistiveText:
        "Read-only inventory balance. Stock cannot be directly modified through Catalog.",
      title: "Inventory balance",
    },
    list: {
      empty: "No products defined in the catalog yet.",
      loading: "Loading products...",
      newProduct: "Define new product",
      title: "Defined products",
    },
    modeSwitchModal: {
      abandonedFieldsLead: "The following entered fields will be cleared:",
      cancel: "Keep current mode",
      confirm: "Switch mode",
      description:
        "Switching definition mode will remove fields from the current mode and they will not be part of the new definition.",
      title: "Confirm mode switch",
    },
    record: {
      id: "Product ID",
      mergedInto: "Merged into product",
      nameTemplateVersion: "Name template version",
      revision: "Revision",
      status: "Product status",
      statuses: {
        active: "Active",
        archived: "Archived",
        merged: "Merged",
      },
      title: "Product record",
    },
    sharing: {
      aiSharingAllowed: "Allow sharing data with AI / external services",
      description: "Item visibility and external data sharing settings.",
      externallyVisible: "Externally visible (web/catalog views)",
      metadataNotice:
        "Sharing and visibility flags are descriptive metadata, not access control policies.",
      title: "External sharing & visibility",
    },
    stateColours: {
      coldStorageRequired: "Cold storage required",
      colors: {
        blue: "Blue",
        green: "Green",
        grey: "Grey",
        orange: "Orange",
        purple: "Purple",
        red: "Red",
        yellow: "Yellow",
      },
      manualColor: "Manual state color",
      manualColorNone: "None",
      title: "State indicators",
    },
    titles: {
      createProduct: "Define new product",
      editProduct: "Edit product details",
      productCatalog: "Product catalog",
    },
  },
};
