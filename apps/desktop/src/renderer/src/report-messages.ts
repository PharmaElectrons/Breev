import type {
  InventoryReportColumn,
  InventoryReportKind,
} from "@breev/contracts/local-rest";

interface ReportCopy {
  title: string;
  description: string;
  from: string;
  to: string;
  actor: string;
  allActors: string;
  businessFrom: string;
  businessTo: string;
  apply: string;
  loading: string;
  empty: string;
  unavailable: string;
  denied: string;
  invalidPeriod: string;
  group: string;
  noGroup: string;
  columnsLabel: string;
  addFilter: string;
  removeFilter: string;
  filterValue: string;
  operator: string;
  contains: string;
  eq: string;
  gte: string;
  lte: string;
  export: string;
  sensitiveExport: string;
  saved: string;
  cancelled: string;
  tooLarge: string;
  previous: string;
  next: string;
  rows: string;
  activity: string;
  noActivity: string;
  openSource: string;
  close: string;
  unitUnavailable: string;
  sort: string;
  ascending: string;
  descending: string;
  direction: string;
  days: string;
  window: string;
  system: string;
  categories: Record<InventoryReportKind, string>;
  columns: Record<InventoryReportColumn, string>;
  explanations: Record<string, string>;
  states: Record<string, string>;
}
export const reportMessages: Record<"ar" | "en", ReportCopy> = {
  en: {
    title: "Inventory reports",
    description:
      "Historical stock and posted activity. From is inclusive; To is exclusive.",
    from: "From · posting time",
    to: "To · posting time",
    actor: "Attributed user",
    allActors: "All users",
    businessFrom: "Business date from · activity only",
    businessTo: "Business date to · activity only",
    apply: "Apply filters",
    loading: "Loading report…",
    empty: "No matching rows for this period and filters.",
    unavailable:
      "The report could not load. Check the local connection and retry.",
    denied: "Your account cannot access this report or source record.",
    invalidPeriod:
      "Enter a valid period in the pharmacy timezone. Repeated or skipped clock times need an unambiguous time.",
    group: "Group by",
    noGroup: "No grouping",
    columnsLabel: "Visible columns",
    addFilter: "Add column filter",
    removeFilter: "Remove filter",
    filterValue: "Filter value",
    operator: "Match",
    contains: "Contains",
    eq: "Equals",
    gte: "At least",
    lte: "At most",
    export: "Export CSV · without costs",
    sensitiveExport: "Protected export · with costs",
    saved: "Report saved.",
    cancelled: "Export cancelled.",
    tooLarge:
      "The report exceeds the export limit. Narrow the period or filters.",
    previous: "Previous page",
    next: "Next page",
    rows: "Matching rows",
    activity: "Period activity",
    noActivity:
      "No matching activity. Opening and closing stock still belong to the whole pharmacy.",
    openSource: "Open source record",
    close: "Close",
    unitUnavailable: "Historical description unavailable",
    sort: "Sort by",
    ascending: "Ascending",
    descending: "Descending",
    direction: "Sort direction",
    days: "days",
    window: "Consumption window ending at To",
    system: "System",
    categories: {
      quantity: "Quantity",
      value: "Value",
      "average-cost": "Average cost",
      "batches-expiry": "Batches and expiry",
      consumption: "Consumption",
      alerts: "Alerts",
      "stocktake-movements": "Stocktake movements",
    },
    columns: {
      item: "Recorded item",
      unit: "Inventory unit",
      openingQuantity: "Opening quantity",
      periodQuantity: "Complete period change",
      activityQuantity: "Attributed quantity change",
      closingQuantity: "Closing quantity",
      openingValueFils: "Opening value",
      periodValueFils: "Complete value change",
      activityValueFils: "Attributed value change",
      closingValueFils: "Closing value",
      openingAverageCostScaled: "Opening WAC / unit",
      closingAverageCostScaled: "Closing WAC / unit",
      batch: "Lot",
      expiry: "Recorded expiry",
      status: "Batch status at To",
      alert: "Alert",
      availability: "Availability",
      consumedQuantity: "Consumed units",
      consumptionPer30Days: "Units per 30 days",
      observedQuantity: "Balance at observation",
      countedQuantity: "Counted units",
      actor: "User",
      postedAt: "Posting time",
      businessDate: "Business date",
      source: "Source record",
    },
    explanations: {
      "working-default-columns":
        "Columns and grouping are working defaults awaiting client approval.",
      "activity-filter-does-not-filter-balances":
        "User and business-date filters select activity. Opening and closing balances include all pharmacy activity.",
      "historical-label-unavailable":
        "Some historical descriptions were not recorded; current item names are not substituted.",
      "business-date-unavailable":
        "Some sources have no recorded business date and are excluded by business-date filters.",
      "historical-policy-unavailable":
        "Historical minimum, maximum, reorder and near-expiry rules are unavailable. Recorded expiry, recall and quarantine facts remain visible.",
      "no-eligible-demand":
        "No eligible posted demand exists in milestone 2. Receipts, adjustments, supplier returns and count variances do not count as consumption.",
    },
    states: {
      eligible: "Eligible",
      expired: "Expired",
      recalled: "Recalled",
      quarantined: "Quarantined",
      available: "Available",
      "historical-policy": "Threshold alerts",
      "historical-policy-unavailable": "Historical policy unavailable",
      "purchase-receipt": "Purchase receipt",
      "purchase-adjustment": "Purchase adjustment",
      "purchase-return": "Supplier return",
      "count-variance": "Applied count variance",
      "expiry-amendment": "Expiry correction",
    },
  },
  ar: {
    title: "تقارير المخزون",
    description:
      "المخزون التاريخي والحركات المرحّلة. وقت البداية مشمول ووقت النهاية غير مشمول.",
    from: "من · وقت الترحيل",
    to: "إلى · وقت الترحيل",
    actor: "المستخدم المنسوبة إليه الحركة",
    allActors: "جميع المستخدمين",
    businessFrom: "تاريخ العمل من · للحركات فقط",
    businessTo: "تاريخ العمل إلى · للحركات فقط",
    apply: "تطبيق المرشحات",
    loading: "جارٍ تحميل التقرير…",
    empty: "لا توجد صفوف مطابقة للفترة والمرشحات.",
    unavailable: "تعذّر تحميل التقرير. تحقق من الاتصال المحلي وأعد المحاولة.",
    denied: "ليس لحسابك صلاحية عرض التقرير أو السجل الأصلي.",
    invalidPeriod:
      "أدخل فترة صحيحة بتوقيت الصيدلية. يلزم وقت واضح عند تكرار الساعة أو تجاوزها.",
    group: "تجميع حسب",
    noGroup: "دون تجميع",
    columnsLabel: "الأعمدة الظاهرة",
    addFilter: "إضافة مرشح عمود",
    removeFilter: "إزالة المرشح",
    filterValue: "قيمة المرشح",
    operator: "المطابقة",
    contains: "يحتوي",
    eq: "يساوي",
    gte: "على الأقل",
    lte: "على الأكثر",
    export: "تصدير CSV · دون التكاليف",
    sensitiveExport: "تصدير محمي · مع التكاليف",
    saved: "تم حفظ التقرير.",
    cancelled: "أُلغي التصدير.",
    tooLarge: "يتجاوز التقرير حد التصدير. قلّل الفترة أو المرشحات.",
    previous: "الصفحة السابقة",
    next: "الصفحة التالية",
    rows: "الصفوف المطابقة",
    activity: "حركات الفترة",
    noActivity:
      "لا توجد حركات مطابقة. يظل رصيد البداية والنهاية شاملاً للصيدلية كلها.",
    openSource: "فتح السجل الأصلي",
    close: "إغلاق",
    unitUnavailable: "الوصف التاريخي غير متاح",
    sort: "ترتيب حسب",
    ascending: "تصاعدي",
    descending: "تنازلي",
    direction: "اتجاه الترتيب",
    days: "يوماً",
    window: "فترة الاستهلاك المنتهية عند وقت النهاية",
    system: "النظام",
    categories: {
      quantity: "الكمية",
      value: "القيمة",
      "average-cost": "متوسط التكلفة",
      "batches-expiry": "الدفعات والانتهاء",
      consumption: "الاستهلاك",
      alerts: "التنبيهات",
      "stocktake-movements": "حركات الجرد",
    },
    columns: {
      item: "الصنف المسجل",
      unit: "وحدة المخزون",
      openingQuantity: "كمية البداية",
      periodQuantity: "التغير الكامل للفترة",
      activityQuantity: "تغير الكمية المنسوب للمستخدم",
      closingQuantity: "كمية النهاية",
      openingValueFils: "قيمة البداية",
      periodValueFils: "التغير الكامل للقيمة",
      activityValueFils: "تغير القيمة المنسوب للمستخدم",
      closingValueFils: "قيمة النهاية",
      openingAverageCostScaled: "متوسط البداية للوحدة",
      closingAverageCostScaled: "متوسط النهاية للوحدة",
      batch: "رقم التشغيلة",
      expiry: "الانتهاء المسجل",
      status: "حالة الدفعة عند النهاية",
      alert: "التنبيه",
      availability: "التوفر",
      consumedQuantity: "الوحدات المستهلكة",
      consumptionPer30Days: "الوحدات لكل ٣٠ يوماً",
      observedQuantity: "الرصيد عند الملاحظة",
      countedQuantity: "الكمية المعدودة",
      actor: "المستخدم",
      postedAt: "وقت الترحيل",
      businessDate: "تاريخ العمل",
      source: "السجل الأصلي",
    },
    explanations: {
      "working-default-columns":
        "الأعمدة والتجميع خيارات عمل أولية بانتظار اعتماد العميل.",
      "activity-filter-does-not-filter-balances":
        "مرشحات المستخدم وتاريخ العمل تختار الحركات. رصيد البداية والنهاية يشمل كل حركات الصيدلية.",
      "historical-label-unavailable":
        "بعض الأوصاف التاريخية لم تُسجل؛ لا تُستبدل بأسماء الأصناف الحالية.",
      "business-date-unavailable":
        "بعض السجلات لا تحمل تاريخ عمل مسجلاً وتُستبعد عند تصفية تاريخ العمل.",
      "historical-policy-unavailable":
        "قواعد الحد الأدنى والأقصى وإعادة الطلب وقرب الانتهاء التاريخية غير متاحة. تظل حقائق الانتهاء والسحب والحجر المسجلة ظاهرة.",
      "no-eligible-demand":
        "لا يوجد طلب مرحّل مؤهل في المرحلة الثانية. الاستلام والتعديلات ومرتجعات المورد وفروق الجرد لا تُحسب استهلاكاً.",
    },
    states: {
      eligible: "مؤهل",
      expired: "منتهي",
      recalled: "مسحوب",
      quarantined: "محجور",
      available: "متاح",
      "historical-policy": "تنبيهات الحدود",
      "historical-policy-unavailable": "السياسة التاريخية غير متاحة",
      "purchase-receipt": "استلام مشتريات",
      "purchase-adjustment": "تعديل مشتريات",
      "purchase-return": "مرتجع مورد",
      "count-variance": "فرق جرد مطبّق",
      "expiry-amendment": "تصحيح الانتهاء",
    },
  },
};
