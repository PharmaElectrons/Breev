import type {
  CatalogDenialCode,
  CatalogFieldErrorCode,
  PriceRoundingSetting,
  ProductDefinitionMode,
  ProductFoodTiming,
  ProductPricingMethod,
  ProductStateColour,
  ProductStatus,
  ProductUnitInterface,
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
    readonly decreaseValue: string;
    readonly increaseValue: string;
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
    readonly addCategory: string;
    readonly arabicSearchName: string;
    readonly arabicSearchNameHint: string;
    readonly category: string;
    readonly categoryAdded: string;
    readonly generatedDisplayName: string;
    readonly generatedDisplayNameEmpty: string;
    readonly generatedDisplayNameHint: string;
    readonly scientificName: string;
    readonly survivorProductId: string;
    readonly survivorProductPlaceholder: string;
  };
  readonly flow: {
    readonly back: string;
    readonly continue: string;
    readonly discardAction: string;
    readonly discardDescription: string;
    readonly discardTitle: string;
    readonly keepAction: string;
    readonly optionalSettings: string;
    readonly optionalUnitSettings: string;
    readonly reloadLatest: string;
    readonly retrySave: string;
    readonly stepIdentity: string;
    readonly stepSetup: string;
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
  readonly movementHistory: {
    readonly inventoryFacts: string;
    readonly openFull: string;
    readonly recent: string;
  };
  readonly permissions: {
    readonly catalogManageRequired: string;
  };
  readonly suppliers: {
    readonly add: string;
    readonly empty: string;
    readonly loadFailed: string;
    readonly loading: string;
    readonly noActiveOptions: string;
    readonly readOnly: string;
    readonly referenceOnly: string;
    readonly remove: string;
    readonly retry: string;
    readonly status: Record<"active" | "archived" | "merged", string>;
    readonly title: string;
  };
  readonly inventory: {
    readonly batchFactsReadOnly: string;
    readonly batchFactsTitle: string;
  };
  readonly list: {
    readonly empty: string;
    readonly loading: string;
    readonly newProduct: string;
    readonly title: string;
  };
  readonly rail: {
    readonly count: string;
    readonly newShort: string;
    readonly selectPrompt: string;
  };
  readonly modeSwitchModal: {
    readonly abandonedFieldsLead: string;
    readonly cancel: string;
    readonly confirm: string;
    readonly description: string;
    readonly title: string;
  };
  readonly packaging: {
    readonly addPackageUnit: string;
    readonly baseUnitsPerPackage: string;
    readonly baseUnitsPerPackagePlaceholder: string;
    readonly countDefault: string;
    readonly defaultUnitsDescription: string;
    readonly defaultUnitsTitle: string;
    readonly description: string;
    readonly enableThirdUnit: string;
    readonly interfaces: Record<ProductUnitInterface, string>;
    readonly inventoryUnitHelp: string;
    readonly inventoryUnitName: string;
    readonly inventoryUnitNamePlaceholder: string;
    readonly noPackageUnits: string;
    readonly packageUnitName: string;
    readonly packageUnitNamePlaceholder: string;
    readonly packageUnitsTitle: string;
    readonly purchaseDefault: string;
    readonly removePackageUnit: string;
    readonly saleDefault: string;
    readonly thirdUnitName: string;
    readonly thirdUnitNamePlaceholder: string;
    readonly thirdUnitNotice: string;
    readonly thirdUnitTitle: string;
    readonly title: string;
  };
  readonly pricing: {
    readonly costFils: string;
    readonly costFilsHelp: string;
    readonly costFilsPlaceholder: string;
    readonly description: string;
    readonly marginPercentage: string;
    readonly marginPercentageHelp: string;
    readonly marginPercentagePlaceholder: string;
    readonly methodLabel: string;
    readonly methods: Record<ProductPricingMethod, string>;
    readonly retailPriceCalculatedPreview: string;
    readonly retailPriceFils: string;
    readonly retailPriceLockedNotice: string;
    readonly retailPricePendingCalculation: string;
    readonly retailPricePlaceholder: string;
    readonly rounding: string;
    readonly roundings: Record<PriceRoundingSetting, string>;
    readonly title: string;
    readonly wholesalePriceFils: string;
    readonly wholesalePriceNotice: string;
    readonly wholesalePricePlaceholder: string;
  };
  readonly record: {
    readonly defaultUnits: string;
    readonly id: string;
    readonly inventoryUnit: string;
    readonly marginPercentage: string;
    readonly mergedInto: string;
    readonly nameTemplateVersion: string;
    readonly noPackageUnits: string;
    readonly noThirdUnit: string;
    readonly packagingTitle: string;
    readonly packageUnits: string;
    readonly pricingMethod: string;
    readonly pricingTitle: string;
    readonly retailPrice: string;
    readonly revision: string;
    readonly rounding: string;
    readonly status: string;
    readonly statuses: Record<ProductStatus, string>;
    readonly thirdUnit: string;
    readonly title: string;
    readonly wholesaleDecisionNotice: string;
    readonly wholesalePrice: string;
  };
  readonly sharing: {
    readonly aiSharingAllowed: string;
    readonly description: string;
    readonly externallyVisible: string;
    readonly metadataNotice: string;
    readonly title: string;
  };
  readonly stateColours: {
    readonly clearColor: string;
    readonly coldStorageRequired: string;
    readonly colors: Record<ProductStateColour, string>;
    readonly manualColor: string;
    readonly manualColorNone: string;
    readonly title: string;
  };
  readonly stockLevels: {
    readonly maximum: string;
    readonly minimum: string;
    readonly reorderPoint: string;
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
      decreaseValue: "تقليل القيمة",
      increaseValue: "زيادة القيمة",
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
      "barcode-already-present": "هذا المنتج لديه هذا الباركود بالفعل.",
      "barcode-not-found": "الباركود المطلوب غير مرتبط بهذا المنتج.",
      "body-invalid": "بيانات المنتج المدخلة غير صالحة.",
      "idempotency-conflict": "تمت معالجة عملية متعارضة بهذا المفتاح مسبقاً.",
      "merge-into-self": "لا يمكن دمج المنتج مع نفسه.",
      "merge-survivor-not-mergeable":
        "المنتج البديل مؤرشف أو مدمج ولا يمكن الدمج فيه.",
      "matching-suggestion-not-found":
        "اقتراح المطابقة غير موجود أو تم اعتماده بالفعل.",
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
      addCategory: "\u0625\u0636\u0627\u0641\u0629 \u0641\u0626\u0629",
      arabicSearchName: "اسم البحث بالعربية",
      arabicSearchNameHint:
        "اسم بحث مستقل باللغة العربية، لا يُدمج في الاسم الإنجليزي المعروض",
      category: "التصنيف",
      generatedDisplayName: "الاسم التجاري الإنجليزي المُولّد",
      categoryAdded: "أُضيف التصنيف. احفظ المنتج ليظهر في الاقتراحات.",
      generatedDisplayNameEmpty:
        "(املأ حقول التعريف أعلاه لتوليد الاسم تلقائياً)",
      generatedDisplayNameHint:
        "يتم توليده تلقائياً من حقول التعريف ولا يقبل الإدخال اليدوي الحر",
      scientificName: "الاسم العلمي / العام",
      survivorProductId: "معرّف المنتج البديل (UUID)",
      survivorProductPlaceholder: "019b0000-0000-7000-8000-000000000000",
    },
    flow: {
      back: "\u0631\u062c\u0648\u0639",
      continue: "\u0645\u062a\u0627\u0628\u0639\u0629",
      discardAction:
        "\u062a\u062c\u0627\u0647\u0644 \u0627\u0644\u062a\u063a\u064a\u064a\u0631\u0627\u062a",
      discardDescription:
        "\u0644\u0645 \u064a\u062a\u0645 \u062d\u0641\u0638 \u062a\u0639\u062f\u064a\u0644\u0627\u062a\u0643. \u0647\u0644 \u062a\u0631\u064a\u062f \u0627\u0644\u062e\u0631\u0648\u062c \u0648\u062a\u062c\u0627\u0647\u0644\u0647\u0627\u061f",
      discardTitle:
        "\u062a\u062c\u0627\u0647\u0644 \u0627\u0644\u062a\u063a\u064a\u064a\u0631\u0627\u062a\u061f",
      keepAction:
        "\u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u062a\u062d\u0631\u064a\u0631",
      optionalSettings:
        "\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0625\u0636\u0627\u0641\u064a\u0629",
      optionalUnitSettings:
        "\u0648\u062d\u062f\u0627\u062a \u0627\u0644\u062a\u0639\u0628\u0626\u0629 \u0627\u0644\u0625\u0636\u0627\u0641\u064a\u0629",
      reloadLatest:
        "\u0625\u0639\u0627\u062f\u0629 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0623\u062d\u062f\u062b",
      retrySave:
        "\u0625\u0639\u0627\u062f\u0629 \u0645\u062d\u0627\u0648\u0644\u0629 \u0627\u0644\u062d\u0641\u0638",
      stepIdentity:
        "\u0627\u0644\u062e\u0637\u0648\u0629 1: \u0627\u0644\u0647\u0648\u064a\u0629",
      stepSetup:
        "\u0627\u0644\u062e\u0637\u0648\u0629 2: \u0627\u0644\u062a\u0639\u0628\u0626\u0629 \u0648\u0627\u0644\u062a\u0633\u0639\u064a\u0631",
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
    movementHistory: {
      inventoryFacts:
        "\u062d\u0642\u0627\u0626\u0642 \u0627\u0644\u0645\u062e\u0632\u0648\u0646",
      openFull:
        "\u0641\u062a\u062d \u0633\u062c\u0644 \u0627\u0644\u062d\u0631\u0643\u0627\u062a \u0627\u0644\u0643\u0627\u0645\u0644",
      recent:
        "\u0622\u062e\u0631 \u0627\u0644\u062d\u0631\u0643\u0627\u062a \u0627\u0644\u0645\u0633\u062c\u0644\u0629",
    },
    permissions: {
      catalogManageRequired:
        "\u062a\u062d\u062a\u0627\u062c \u0625\u0644\u0649 \u0635\u0644\u0627\u062d\u064a\u0629 \u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0641\u0647\u0631\u0633 \u0644\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0623\u0648 \u062a\u0639\u062f\u064a\u0644\u0647\u0627.",
    },
    suppliers: {
      add: "\u0625\u0636\u0627\u0641\u0629 \u0645\u0648\u0631\u0651\u062f",
      empty:
        "\u0644\u0627 \u062a\u0648\u062c\u062f \u0631\u0648\u0627\u0628\u0637 \u0645\u0648\u0631\u0651\u062f\u064a\u0646.",
      loadFailed:
        "\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u062e\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u0645\u0648\u0631\u0651\u062f\u064a\u0646.",
      loading:
        "\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u0648\u0631\u0651\u062f\u064a\u0646...",
      noActiveOptions:
        "\u0644\u0627 \u062a\u0648\u062c\u062f \u062e\u064a\u0627\u0631\u0627\u062a \u0646\u0634\u0637\u0629 \u0623\u062e\u0631\u0649 \u0644\u0644\u0625\u0636\u0627\u0641\u0629.",
      readOnly:
        "\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0645\u0648\u0631\u0651\u062f\u064a\u0646 \u0644\u0644\u0645\u0631\u0627\u062c\u0639\u0629 \u0641\u0642\u0637.",
      referenceOnly:
        "\u0645\u0631\u0627\u062c\u0639 \u0645\u0639\u0644\u0648\u0645\u0627\u062a\u064a\u0629 \u0641\u0642\u0637\u061b \u062a\u064f\u062d\u062f\u0651\u062f \u0627\u0644\u0643\u0644\u0641\u0629 \u0648\u0627\u0644\u0645\u0648\u0631\u0651\u062f \u0639\u0644\u0649 \u0643\u0644 \u0641\u0627\u062a\u0648\u0631\u0629 \u0634\u0631\u0627\u0621.",
      remove: "\u0625\u0632\u0627\u0644\u0629",
      retry:
        "\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629",
      status: {
        active: "\u0646\u0634\u0637",
        archived: "\u0645\u0624\u0631\u0634\u0641",
        merged: "\u0645\u062f\u0645\u0648\u062c",
      },
      title:
        "\u0627\u0644\u0645\u0648\u0631\u0651\u062f\u0648\u0646 \u0627\u0644\u0645\u0631\u062a\u0628\u0637\u0648\u0646",
    },
    inventory: {
      batchFactsReadOnly:
        "\u0623\u0631\u0635\u062f\u0629 \u0627\u0644\u062f\u0641\u0639\u0627\u062a \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637 \u0648\u062a\u064f\u062f\u0627\u0631 \u0645\u0646 \u0634\u0627\u0634\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646.",
      batchFactsTitle:
        "\u062d\u0642\u0627\u0626\u0642 \u0627\u0644\u062f\u0641\u0639\u0627\u062a",
    },
    list: {
      empty: "لم يتم تعريف أي منتجات في الفهرس بعد.",
      loading: "جارٍ تحميل المنتجات...",
      newProduct: "تعريف منتج جديد",
      title: "المنتجات المعرّفة",
    },
    rail: {
      count: "المواد",
      newShort: "+ جديد",
      selectPrompt: "اختر مادة من القائمة أو عرّف مادة جديدة.",
    },
    modeSwitchModal: {
      abandonedFieldsLead: "سيتم مسح وتفريغ القيم التالية:",
      cancel: "الإبقاء على الوضع الحالي",
      confirm: "تأكيد تبديل الوضع",
      description:
        "تبديل وضع التعريف سيؤدي إلى إزالة حقول الوضع الحالي ولن يتم تضمينها في تعريف المنتج الجديد.",
      title: "تأكيد تبديل وضع التعريف",
    },
    packaging: {
      addPackageUnit: "+ إضافة وحدة عبوة",
      baseUnitsPerPackage: "معامل التحويل (وحدات مخزون لكل عبوة)",
      baseUnitsPerPackagePlaceholder: "عدد صحيح موجب ≥ 1",
      countDefault: "الافتراضي للجرد والعد",
      defaultUnitsDescription:
        "الوحدة المبدئية التي تبدأ بها كل واجهة (يمكن تغييرها أثناء العملية عند السماح بذلك).",
      defaultUnitsTitle: "الوحدات الافتراضية للواجهات",
      description:
        "وحدة المخزون الأساسية الصحيحة، ومعاملات تحويل العبوات، والوحدة الثالثة للمتابعة، والوحدات الافتراضية لكل واجهة.",
      enableThirdUnit: "إضافة وحدة ثالثة لمتابعة الأيام أو الجرعات",
      interfaces: {
        count: "الجرد والعد",
        purchase: "المشتريات",
        sale: "المبيعات",
      },
      inventoryUnitHelp:
        "الوحدة الصحيحة غير القابلة للتجزئة التي تُسجل بها أرصدة المخزون وحركاته. حقل إلزامي.",
      inventoryUnitName: "وحدة المخزون (الوحدة الأساسية)",
      inventoryUnitNamePlaceholder: "مثال: شريط، قرص، أمبولة، قطعة",
      noPackageUnits:
        "لا توجد وحدات عبوات أكبر مضافة. ستتعامل الواجهات بوحدة المخزون فقط.",
      packageUnitName: "اسم العبوة",
      packageUnitNamePlaceholder: "مثال: علبة، باكت، كرتون",
      packageUnitsTitle: "وحدات العبوات الأكبر",
      purchaseDefault: "الافتراضي لفواتير الشراء",
      removePackageUnit: "إزالة وحدة العبوة",
      saleDefault: "الافتراضي لشاشة البيع",
      thirdUnitName: "اسم الوحدة الثالثة",
      thirdUnitNamePlaceholder: "مثال: يوم علاج، كورس، جرعة",
      thirdUnitNotice:
        "لمتابعة الأيام أو الجرعات فقط — لا تؤثر على المخزون مطلقاً. مستبعدة بنيوياً من أرصدة المخزون والمشتريات والمبيعات.",
      thirdUnitTitle: "الوحدة الثالثة (متابعة الأيام والجرعات فقط)",
      title: "التعبئة والوحدات",
    },
    pricing: {
      costFils: "كلفة الشراء المعتمدة (بالفلس)",
      costFilsHelp:
        "مدخل مؤقت للاحتساب. يُستخدم لاحتساب سعر المفرد الأولي ولا يُخزن في بطاقة المادة.",
      costFilsPlaceholder: "مثال: 80000 (أي 80 د.ع)",
      description:
        "طريقة التسعير، وإدخال أو احتساب سعر المفرد، وسعر الجملة الاسترشادي.",
      marginPercentage: "نسبة هامش الربح (%)",
      marginPercentageHelp:
        "هامش ربح من سعر البيع (السعر = الكلفة ÷ (1 − الهامش))، وليس إضافة على التكلفة.",
      marginPercentagePlaceholder: "مثال: 20",
      methodLabel: "طريقة التسعير",
      methods: {
        "by-percentage": "البيع بالنسبة (هامش ربح من سعر البيع)",
        "by-price": "البيع بالسعر (تحديد سعر المفرد مباشرة)",
      },
      retailPriceCalculatedPreview: "سعر المفرد المحسوب / المخزن",
      retailPriceFils: "سعر المفرد (بالفلس)",
      retailPriceLockedNotice:
        "مغلق — يحتسبه الخادم تلقائياً من كلفة الشراء وهامش الربح من سعر البيع والتقريب.",
      retailPricePendingCalculation: "(يحتسبه الخادم تلقائياً عند الحفظ)",
      retailPricePlaceholder: "مثال: 100000 (أي 100 د.ع)",
      rounding: "مقدار تقريب السعر",
      roundings: {
        "nearest-1000-iqd": "لأقرب 1,000 د.ع",
        "nearest-250-iqd": "لأقرب 250 د.ع",
        "nearest-500-iqd": "لأقرب 500 د.ع",
        off: "بدون تقريب (الفلس الدقيق)",
      },
      title: "التسعير والحدود التجارية",
      wholesalePriceFils: "سعر الجملة (بالفلس، اختياري)",
      wholesalePriceNotice:
        "إعداد عمل مؤقت (قرار قيد البت): يظهر في لوحة بيانات المادة فقط، ولا يُعتمد لاختيار السعر أثناء البيع.",
      wholesalePricePlaceholder: "مثال: 85000 (أي 85 د.ع)",
    },
    record: {
      defaultUnits: "الافتراضيات للواجهات",
      id: "معرّف المنتج",
      inventoryUnit: "وحدة المخزون",
      marginPercentage: "نسبة هامش الربح",
      mergedInto: "مدموج في المنتج",
      nameTemplateVersion: "إصدار قالب التسمية",
      noPackageUnits: "لا توجد (وحدة المخزون فقط)",
      noThirdUnit: "لا توجد",
      packagingTitle: "التعبئة وتحويلات الوحدات",
      packageUnits: "وحدات العبوات ومعاملاتها",
      pricingMethod: "طريقة التسعير",
      pricingTitle: "التسعير والبيانات التجارية",
      retailPrice: "سعر المفرد",
      revision: "رقم المراجعة",
      rounding: "إعداد التقريب",
      status: "حالة المنتج",
      statuses: {
        active: "نشط",
        archived: "مؤرشف",
        merged: "مدمج",
      },
      thirdUnit: "الوحدة الثالثة (لا تؤثر على المخزون)",
      title: "سجل المنتج",
      wholesaleDecisionNotice:
        "إعداد عمل مؤقت (قرار قيد البت): يظهر سعر الجملة في لوحة بيانات المادة فقط ولا يُعتمد لاختيار السعر أثناء البيع.",
      wholesalePrice: "سعر الجملة",
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
      clearColor: "\u0645\u0633\u062d \u0627\u0644\u0644\u0648\u0646",
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
    stockLevels: {
      maximum: "الحد الأقصى",
      minimum: "الحد الأدنى",
      reorderPoint: "نقطة إعادة الطلب",
      title: "مستويات المخزون",
    },
    titles: {
      createProduct: "تعريف منتج جديد",
      editProduct: "تعديل بيانات المنتج",
      productCatalog: "فهرس المنتجات",
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
      decreaseValue: "Decrease value",
      increaseValue: "Increase value",
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
      "barcode-already-present": "This product already has that barcode.",
      "barcode-not-found":
        "The requested barcode is not attached to this product.",
      "body-invalid": "The submitted product data is invalid.",
      "idempotency-conflict":
        "A conflicting operation with this key was already processed.",
      "merge-into-self": "A product cannot be merged into itself.",
      "merge-survivor-not-mergeable":
        "The survivor product is archived or merged and cannot accept merges.",
      "matching-suggestion-not-found":
        "The matching suggestion was not found or was already approved.",
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
      addCategory: "Add category",
      arabicSearchName: "Arabic search name",
      arabicSearchNameHint:
        "Independent Arabic search name, not appended to the English name",
      category: "Category",
      generatedDisplayName: "Generated English display name",
      categoryAdded: "Added here. Save the product to make it a suggestion.",
      generatedDisplayNameEmpty:
        "(Fill definition fields above to generate display name)",
      generatedDisplayNameHint:
        "Generated automatically from definition fields — free text entry is not permitted",
      scientificName: "Scientific / Generic name",
      survivorProductId: "Survivor Product ID (UUID)",
      survivorProductPlaceholder: "019b0000-0000-7000-8000-000000000000",
    },
    flow: {
      back: "Back",
      continue: "Continue",
      discardAction: "Discard changes",
      discardDescription:
        "Your changes have not been saved. Leave this form and discard them?",
      discardTitle: "Discard changes?",
      keepAction: "Keep editing",
      optionalSettings: "Optional product settings",
      optionalUnitSettings: "Additional package units",
      reloadLatest: "Reload latest version",
      retrySave: "Retry save",
      stepIdentity: "Step 1: Identity",
      stepSetup: "Step 2: Unit and pricing",
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
    movementHistory: {
      inventoryFacts: "Inventory facts",
      openFull: "Open full movement history",
      recent: "Most recent recorded movements",
    },
    permissions: {
      catalogManageRequired:
        "Catalog management permission is required to create or edit products.",
    },
    suppliers: {
      add: "Add supplier",
      empty: "No supplier links yet.",
      loadFailed: "Supplier options could not be loaded.",
      loading: "Loading suppliers...",
      noActiveOptions: "No other active suppliers are available to add.",
      readOnly: "Supplier links are shown for reference only.",
      referenceOnly:
        "Informational links only. Choose supplier and cost separately on each purchase invoice.",
      remove: "Remove",
      retry: "Retry",
      status: {
        active: "Active",
        archived: "Archived",
        merged: "Merged",
      },
      title: "Linked suppliers",
    },
    inventory: {
      batchFactsReadOnly:
        "Batch balances are read-only here and are managed in Inventory.",
      batchFactsTitle: "Batch facts",
    },
    list: {
      empty: "No products defined in the catalog yet.",
      loading: "Loading products...",
      newProduct: "Define new product",
      title: "Defined products",
    },
    rail: {
      count: "Products",
      newShort: "+ New",
      selectPrompt: "Select a product from the list, or define a new one.",
    },
    modeSwitchModal: {
      abandonedFieldsLead: "The following entered fields will be cleared:",
      cancel: "Keep current mode",
      confirm: "Switch mode",
      description:
        "Switching definition mode will remove fields from the current mode and they will not be part of the new definition.",
      title: "Confirm mode switch",
    },
    packaging: {
      addPackageUnit: "+ Add package unit",
      baseUnitsPerPackage: "Ratio (Inventory Units per package)",
      baseUnitsPerPackagePlaceholder: "Positive integer >= 1",
      countDefault: "Inventory count default",
      defaultUnitsDescription:
        "Starting unit for each interface (can be changed during a transaction where permitted).",
      defaultUnitsTitle: "Interface Default Units",
      description:
        "Integer inventory base unit, larger package conversion ratios, non-stock follow-up third unit, and interface defaults.",
      enableThirdUnit: "Add Third Unit for days/dosage follow-up",
      interfaces: {
        count: "Inventory count",
        purchase: "Purchasing",
        sale: "Sales",
      },
      inventoryUnitHelp:
        "The integer unit stock balances and movements are recorded in. Required.",
      inventoryUnitName: "Inventory Unit (base unit)",
      inventoryUnitNamePlaceholder: "e.g. Strip, Tablet, Ampoule, Piece",
      noPackageUnits:
        "No larger package units defined. All interfaces will operate in the inventory unit.",
      packageUnitName: "Package Name",
      packageUnitNamePlaceholder: "e.g. Box, Pack, Carton",
      packageUnitsTitle: "Larger Package Units",
      purchaseDefault: "Purchase invoice default",
      removePackageUnit: "Remove package unit",
      saleDefault: "Sale screen default",
      thirdUnitName: "Third Unit Name",
      thirdUnitNamePlaceholder: "e.g. Treatment Day, Course, Dose",
      thirdUnitNotice:
        "Follow-up only — never stock. Structurally excluded from inventory balances, purchasing, and sales.",
      thirdUnitTitle: "Third Unit (Dosage & Days Follow-up Only)",
      title: "Packaging & Units",
    },
    pricing: {
      costFils: "Approved cost (fils)",
      costFilsHelp:
        "Transient calculation input. Used to derive the initial retail price and never stored on the item master.",
      costFilsPlaceholder: "e.g. 80000 (80 IQD)",
      description:
        "Pricing method, retail price entry or derivation, and panel-only wholesale reference.",
      marginPercentage: "Profit margin percentage (%)",
      marginPercentageHelp:
        "Margin on selling price (price = cost / (1 − margin)), not markup on cost.",
      marginPercentagePlaceholder: "e.g. 20",
      methodLabel: "Pricing method",
      methods: {
        "by-percentage": "Sell by percentage (margin on selling price)",
        "by-price": "Sell by price (direct retail entry)",
      },
      retailPriceCalculatedPreview: "Stored / calculated retail price",
      retailPriceFils: "Retail price (fils)",
      retailPriceLockedNotice:
        "Locked — calculated by server from approved cost, margin on selling price, and rounding.",
      retailPricePendingCalculation: "(Calculated on server save)",
      retailPricePlaceholder: "e.g. 100000 (100 IQD)",
      rounding: "Price rounding step",
      roundings: {
        "nearest-1000-iqd": "Nearest 1,000 IQD",
        "nearest-250-iqd": "Nearest 250 IQD",
        "nearest-500-iqd": "Nearest 500 IQD",
        off: "No rounding (exact fils)",
      },
      title: "Pricing & Commercial Terms",
      wholesalePriceFils: "Wholesale price (fils, optional)",
      wholesalePriceNotice:
        "Working default (open decision): Visible only in the item panel; not active for sale-time price selection.",
      wholesalePricePlaceholder: "e.g. 85000 (85 IQD)",
    },
    record: {
      defaultUnits: "Interface Defaults",
      id: "Product ID",
      inventoryUnit: "Inventory Unit",
      marginPercentage: "Margin percentage",
      mergedInto: "Merged into product",
      nameTemplateVersion: "Name template version",
      noPackageUnits: "None (inventory unit only)",
      noThirdUnit: "None",
      packagingTitle: "Packaging & Unit Conversions",
      packageUnits: "Package units & ratios",
      pricingMethod: "Pricing method",
      pricingTitle: "Pricing & Commercial Reference",
      retailPrice: "Retail price",
      revision: "Revision",
      rounding: "Rounding setting",
      status: "Product status",
      statuses: {
        active: "Active",
        archived: "Archived",
        merged: "Merged",
      },
      thirdUnit: "Third Unit (non-stock)",
      title: "Product record",
      wholesaleDecisionNotice:
        "Working default (open decision): Wholesale price is displayed in the item panel only and is not active for sale-time price selection.",
      wholesalePrice: "Wholesale price",
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
      clearColor: "Clear color",
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
    stockLevels: {
      maximum: "Maximum level",
      minimum: "Minimum level",
      reorderPoint: "Reorder point",
      title: "Stock levels",
    },
    titles: {
      createProduct: "Define new product",
      editProduct: "Edit product details",
      productCatalog: "Product catalog",
    },
  },
};
