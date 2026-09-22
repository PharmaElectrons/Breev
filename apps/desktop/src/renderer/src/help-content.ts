import type { ModuleId } from "./module-ids";
import type { Locale } from "./preferences";

/** One job a user carries out on a screen, as an ordered list of plain steps. */
export interface GuideTask {
  /** Stable, kebab-case, unique within its module. */
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
}

export interface ModuleGuide {
  /**
   * What the screen is for, in the user's terms.
   *
   * Empty for a module with no implementation behind it: the panel then falls
   * back to the honest "not built yet" copy that `navigation-messages.ts`
   * already owns, rather than restating it in a second place where the two
   * could drift apart.
   */
  readonly purpose: string;
  readonly tasks: readonly GuideTask[];
}

/** One tooltip in a tutorial, keyed by the `data-tour` anchor it points at. */
export interface TourCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * Guide text for every module surface.
 *
 * Everything here traces to `docs/workflows.md` and
 * `docs/requirements/breev-phase1-mvp-scope.md`. Two rules govern it:
 *
 * Nothing describes a screen Breev has not built. A guide that explains an
 * absent flow misleads exactly as much as an "unavailable" tab that pretends to
 * work, so an unbuilt module carries no prose at all.
 *
 * Nothing names a function key. docs/workflows.md forbids finalizing function
 * keys before the team observes them with pharmacists, Windows, and certified
 * scanners, and none are implemented, so the guide documents only what exists:
 * Enter advancing a field, and Escape closing a dialog.
 */
export const helpContent: Record<Locale, Record<ModuleId, ModuleGuide>> = {
  ar: {
    dashboard: {
      purpose:
        "تؤكد هذه الشاشة أن هذا الجهاز متصل بحاسوب الصيدلية الرئيسي، وتعرض المعرّفات التي يطلبها الدعم الفني عند الحاجة.",
      tasks: [
        {
          id: "check-connection",
          title: "التحقق من الاتصال",
          steps: [
            "اقرأ حالة الاتصال في أعلى الشاشة.",
            "اضغط «تحقق الآن» لإعادة الفحص في الحال.",
            "إذا ظهرت حالة غير «جاهز»، لا تُكمل العمل قبل معالجتها.",
          ],
        },
        {
          id: "copy-identifiers",
          title: "نسخ معرّف للدعم الفني",
          steps: [
            "ابحث عن السطر المطلوب في قائمة المعلومات.",
            "اضغط زر النسخ بجانب قيمته.",
            "ألصق القيمة في رسالتك إلى الدعم الفني.",
          ],
        },
      ],
    },
    purchases: {
      purpose:
        "تُسجَّل هنا فواتير الموردين، فتدخل البضاعة إلى المخزن بدفعاتها وتواريخ صلاحيتها. المستند المُرحّل لا يُعدَّل ولا يُحذف.",
      tasks: [
        {
          id: "record-invoice",
          title: "تسجيل فاتورة شراء",
          steps: [
            "أدخل بيانات الفاتورة أولاً: المورد ورقم الفاتورة وتاريخها ونوعها نقداً أو ديناً.",
            "انتقل إلى سطور الأصناف. يُنقل Enter بين الحقول بالترتيب: الصنف أو الباركود، ثم الكمية، ثم الكلفة، ثم سعر البيع، ثم تاريخ الصلاحية.",
            "راجع الإجماليات والدفعات وأثر الفاتورة قبل الترحيل.",
            "الترحيل إجراء منفصل وصريح. لا يُرحِّل Enter في حقل تاريخ الصلاحية الفاتورة أبداً.",
          ],
        },
        {
          id: "review-posted",
          title: "مراجعة فاتورة مُرحّلة",
          steps: [
            "افتح تبويب الفواتير المُرحّلة واختر الفاتورة.",
            "اقرأ بيانات المستند والبنود المُرحّلة كما رُحِّلت.",
            "راجع قيد اليومية الناتج عنها. المستند المُرحّل لا يُعدَّل ولا يُحذف.",
          ],
        },
      ],
    },
    inventory: {
      purpose:
        "يعرض المخزن الرصيد الحالي مشتقاً من حركات المخزون، ومنه تبدأ عمليات الجرد ومراجعة الدفعات القريبة من انتهاء الصلاحية.",
      tasks: [
        {
          id: "review-stock",
          title: "مراجعة الرصيد",
          steps: [
            "رتّب الجدول بالضغط على عنوان العمود.",
            "أظهر الأعمدة التي تحتاجها أو أخفِ غيرها من إعدادات الأعمدة.",
            "افتح حركات أي صنف للاطلاع على المستند الذي غيَّر رصيده.",
          ],
        },
        {
          id: "count-session",
          title: "جرد المخزن",
          steps: [
            "ابدأ جلسة جرد جديدة أو استأنف جلسة قائمة.",
            "امسح الباركود أو اختر الصنف، ثم أدخل الرصيد المعدود واضغط Enter.",
            "راجع الفرق بين الرصيد المسجَّل والمعدود، وأدخل السبب المطلوب.",
            "اعتماد الفرق يُنشئ حركة مخزون مستقلة، ولا يعيد كتابة الحركات السابقة.",
          ],
        },
        {
          id: "safety-review",
          title: "مراجعة الدفعات",
          steps: [
            "افتح مراجعة سلامة الدفعات من أعلى الشاشة.",
            "راجع الدفعات المنتهية أو الموقوفة.",
            "اختر الإجراء المعتمد لكل كمية متأثرة.",
          ],
        },
      ],
    },
    products: {
      purpose:
        "تُعرَّف هنا المواد التي تتعامل بها الصيدلية: الاسم والتعبئة ووحدات القياس والكلفة والسعر. تعتمد شاشات الشراء والمخزن على هذه التعريفات.",
      tasks: [
        {
          id: "find-product",
          title: "البحث عن مادة",
          steps: [
            "اكتب جزءاً من الاسم أو امسح الباركود في حقل البحث.",
            "اختر المادة من القائمة لعرض سجلها.",
          ],
        },
        {
          id: "create-product",
          title: "إضافة مادة جديدة",
          steps: [
            "اضغط زر الإضافة أعلى قائمة المواد.",
            "أدخل الاسم ووحدة المخزن والتعبئة.",
            "أدخل الكلفة والسعر، واحفظ السجل.",
          ],
        },
      ],
    },
    basket: {
      purpose:
        "تجمع سلة الطلبات المواد التي تحتاج إعادة طلب، وتتيح تثبيت الكميات وتأكيدها كمطلوبة من المورد.",
      tasks: [
        {
          id: "review-pending",
          title: "مراجعة المواد المعلّقة",
          steps: [
            "راجع المواد في قائمة الانتظار والكمية المقترحة لكل منها.",
            "عدّل الكمية عند الحاجة.",
          ],
        },
        {
          id: "confirm-ordered",
          title: "تأكيد الطلب",
          steps: [
            "أكّد المواد التي طلبتها فعلاً من المورد.",
            "تنتقل المواد المؤكدة إلى قائمة المطلوبة.",
            "يمكنك إعادة أي مادة إلى قائمة الانتظار إذا تراجعت عن طلبها.",
          ],
        },
      ],
    },
    administration: {
      purpose:
        "تُدار من هنا حسابات الموظفين وصلاحياتهم، إضافة إلى إعدادات الصيدلية وحالة الترخيص والأجهزة المرتبطة والحضور.",
      tasks: [
        {
          id: "manage-users",
          title: "إدارة حسابات الموظفين",
          steps: [
            "أنشئ حساباً للموظف وحدّد دوره.",
            "أعد تعيين كلمة المرور أو أوقف الحساب عند الحاجة.",
          ],
        },
        {
          id: "manage-roles",
          title: "ضبط الصلاحيات",
          steps: [
            "افتح محرر الأدوار.",
            "حدّد الصلاحيات المسموحة لكل دور.",
            "ما لا يملك الموظف صلاحيته لا يظهر له أصلاً في القوائم.",
          ],
        },
        {
          id: "check-licence",
          title: "متابعة الترخيص",
          steps: [
            "راجع بطاقة حالة الترخيص: الخطة وتاريخ الانتهاء وعدد الأجهزة المسموح بها.",
            "بعض الإجراءات تطلب تأكيد كلمة مرورك مرة أخرى قبل تنفيذها.",
          ],
        },
      ],
    },
    sales: {
      purpose:
        "تُفتح من هنا مسودة بيع وتُستأنف، ويُبحث عن المواد لإضافتها إلى سلة الطلبات. تُحفظ المسودة على حاسوب الصيدلية الرئيسي، فلا تُفقد إذا انتقلت إلى شاشة أخرى.",
      tasks: [
        {
          id: "open-draft",
          title: "فتح مسودة بيع أو استئنافها",
          steps: [
            "اضغط «مسودة بيع جديدة» لبدء مسودة.",
            "أو اختر «استئناف» بجانب مسودة مفتوحة في القائمة للعودة إليها.",
          ],
        },
        {
          id: "find-item",
          title: "البحث عن مادة وإضافتها إلى سلة الطلبات",
          steps: [
            "اكتب في حقل البحث الاسم العربي أو الإنجليزي أو امسح الباركود.",
            "اختر المادة من نتائج البحث.",
            "استخدم «أضف إلى سلة الطلبات» لتسجيل حاجتك إلى إعادة طلبها.",
          ],
        },
      ],
    },
    patients: { purpose: "", tasks: [] },
    messages: { purpose: "", tasks: [] },
    reports: { purpose: "", tasks: [] },
    accounts: { purpose: "", tasks: [] },
    settings: { purpose: "", tasks: [] },
  },
  en: {
    dashboard: {
      purpose:
        "This screen confirms that this device is connected to the pharmacy's main computer, and shows the identifiers support asks for when you need help.",
      tasks: [
        {
          id: "check-connection",
          title: "Check the connection",
          steps: [
            "Read the connection status at the top of the screen.",
            "Press Check now to test it again immediately.",
            "If the status is anything other than Ready, resolve it before carrying on.",
          ],
        },
        {
          id: "copy-identifiers",
          title: "Copy an identifier for support",
          steps: [
            "Find the row you need in the information list.",
            "Press the copy button beside its value.",
            "Paste the value into your message to support.",
          ],
        },
      ],
    },
    purchases: {
      purpose:
        "Supplier invoices are recorded here, which is how stock enters the pharmacy with its batches and expiry dates. A posted document is never edited or deleted.",
      tasks: [
        {
          id: "record-invoice",
          title: "Record a purchase invoice",
          steps: [
            "Enter the invoice details first: supplier, invoice number, invoice date, and whether it is cash or debt.",
            "Move to the item rows. Enter advances through the fields in order: item or barcode, quantity, cost, selling price, then expiry.",
            "Review the totals, the batches, and the effect of the invoice before posting.",
            "Posting is a separate, explicit action. Enter on the expiry field never posts the invoice.",
          ],
        },
        {
          id: "review-posted",
          title: "Review a posted invoice",
          steps: [
            "Open the posted invoices tab and select the invoice.",
            "Read the document details and its posted rows exactly as they were posted.",
            "Review the journal entry it produced. A posted document is never edited or deleted.",
          ],
        },
      ],
    },
    inventory: {
      purpose:
        "Inventory shows current stock derived from inventory movements. Stock counts and the review of batches nearing expiry both start here.",
      tasks: [
        {
          id: "review-stock",
          title: "Review stock",
          steps: [
            "Sort the table by pressing a column heading.",
            "Show the columns you need and hide the rest from the column settings.",
            "Open an item's movements to see the document that changed its balance.",
          ],
        },
        {
          id: "count-session",
          title: "Count the stock",
          steps: [
            "Start a new count session or resume an open one.",
            "Scan the barcode or pick the item, enter the counted balance, and press Enter.",
            "Review the variance between the recorded and counted balance, and give the reason asked for.",
            "Applying a variance posts its own inventory movement; it never rewrites earlier history.",
          ],
        },
        {
          id: "safety-review",
          title: "Review batches",
          steps: [
            "Open the batch safety review from the top of the screen.",
            "Go through the expired, recalled, or quarantined batches.",
            "Choose the approved action for each affected quantity.",
          ],
        },
      ],
    },
    products: {
      purpose:
        "This is where the pharmacy's items are defined: name, packaging, units, cost, and price. Purchasing and Inventory both rely on these definitions.",
      tasks: [
        {
          id: "find-product",
          title: "Find an item",
          steps: [
            "Type part of the name, or scan a barcode, in the search field.",
            "Pick the item from the list to open its record.",
          ],
        },
        {
          id: "create-product",
          title: "Add a new item",
          steps: [
            "Press the add button above the item list.",
            "Enter the name, the inventory unit, and the packaging.",
            "Enter the cost and the price, then save the record.",
          ],
        },
      ],
    },
    basket: {
      purpose:
        "The order basket collects the items that need reordering, so you can settle the quantities and confirm them as ordered from the supplier.",
      tasks: [
        {
          id: "review-pending",
          title: "Review pending items",
          steps: [
            "Go through the waiting items and the quantity proposed for each.",
            "Change a quantity where you need to.",
          ],
        },
        {
          id: "confirm-ordered",
          title: "Confirm the order",
          steps: [
            "Confirm the items you have actually ordered from the supplier.",
            "Confirmed items move to the ordered list.",
            "You can return an item to the waiting list if the order falls through.",
          ],
        },
      ],
    },
    administration: {
      purpose:
        "Staff accounts and their permissions are managed here, along with pharmacy settings, licence status, paired devices, and attendance.",
      tasks: [
        {
          id: "manage-users",
          title: "Manage staff accounts",
          steps: [
            "Create an account for the employee and set their role.",
            "Reset a password or lock an account when you need to.",
          ],
        },
        {
          id: "manage-roles",
          title: "Set permissions",
          steps: [
            "Open the role editor.",
            "Choose the permissions each role is allowed.",
            "What an employee has no permission for is hidden from them, not shown disabled.",
          ],
        },
        {
          id: "check-licence",
          title: "Keep track of the licence",
          steps: [
            "Review the licence status card: the plan, the expiry date, and how many devices are permitted.",
            "Some actions ask you to confirm your password again before they run.",
          ],
        },
      ],
    },
    sales: {
      purpose:
        "Open or resume a sale draft here, and search for items to add to the order basket. The draft is kept on the pharmacy's main computer, so it is not lost if you move to another screen.",
      tasks: [
        {
          id: "open-draft",
          title: "Open or resume a sale draft",
          steps: [
            "Press New sale draft to start one.",
            "Or press Resume beside an open draft in the list to go back to it.",
          ],
        },
        {
          id: "find-item",
          title: "Find an item and add it to the order basket",
          steps: [
            "Type the Arabic or English name in the search field, or scan a barcode.",
            "Pick the item from the results.",
            "Use Add to order basket to record that it needs reordering.",
          ],
        },
      ],
    },
    patients: { purpose: "", tasks: [] },
    messages: { purpose: "", tasks: [] },
    reports: { purpose: "", tasks: [] },
    accounts: { purpose: "", tasks: [] },
    settings: { purpose: "", tasks: [] },
  },
};

/**
 * Tutorial tooltips, keyed by the `data-tour` anchor each one points at.
 *
 * The anchor doubles as the copy key so there is one name to keep in step
 * rather than two that can drift apart.
 */
export const tourCopy: Record<Locale, Record<string, TourCopy>> = {
  ar: {
    "dashboard-connection": {
      title: "حالة الاتصال",
      body: "تخبرك هذه البطاقة ما إذا كان الجهاز متصلاً بحاسوب الصيدلية الرئيسي. «تحقق الآن» يعيد الفحص فوراً.",
    },
    "dashboard-identity": {
      title: "معرّفات الجهاز والصيدلية",
      body: "هنا اسم الصيدلية ومعرّفها ودور هذا الجهاز وإصدارات النظام. انسخ أي قيمة بزر النسخ عند مراسلة الدعم الفني.",
    },
    "sales-new-draft": {
      title: "بدء مسودة بيع",
      body: "تبدأ من هنا مسودة بيع جديدة. تُحفظ المسودة على حاسوب الصيدلية الرئيسي.",
    },
    "sales-draft-list": {
      title: "المسودات المفتوحة",
      body: "المسودات التي لم تُغلق بعد. اضغط «استئناف» للعودة إلى أي منها.",
    },
    "sales-search": {
      title: "البحث عن مادة",
      body: "اكتب الاسم العربي أو الإنجليزي، أو امسح الباركود.",
    },
    "sales-results": {
      title: "نتائج البحث",
      body: "اختر المادة من النتائج، ويمكنك إضافتها إلى سلة الطلبات من هنا.",
    },
    "purchases-view-tabs": {
      title: "التنقل بين الشراء والموردين",
      body: "تنتقل من هنا بين فاتورة الشراء والمسودات المحفوظة والفواتير المُرحّلة والموردين. لا يظهر لك من هذه التبويبات إلا ما تسمح به صلاحياتك.",
    },
    "purchases-header-form": {
      title: "بيانات الفاتورة أولاً",
      body: "أدخل المورد ورقم الفاتورة وتاريخها ونوعها قبل البدء بسطور الأصناف.",
    },
    "purchases-lines-table": {
      title: "سطور الأصناف",
      body: "ينقلك Enter بين الحقول: الصنف أو الباركود، ثم الكمية، ثم الكلفة، ثم سعر البيع، ثم تاريخ الصلاحية. الترحيل إجراء منفصل، ولا يحدث بالضغط على Enter.",
    },
    "inventory-actions": {
      title: "إجراءات المخزن",
      body: "من هنا تبدأ جلسة جرد، أو تصدّر بيانات المخزون الحساسة، أو تفتح سلة الطلبات، أو تغيّر إعدادات الأعمدة.",
    },
    "inventory-columns": {
      title: "أعمدة الجدول",
      body: "أظهر الأعمدة التي تحتاجها وأخفِ غيرها. تُحفظ اختيارات الأعمدة لهذا المستخدم فقط.",
    },
    "inventory-stock-table": {
      title: "الرصيد الحالي",
      body: "الرصيد مشتق من حركات المخزون. افتح حركات أي صنف لمعرفة المستند الذي غيَّر رصيده.",
    },
    "products-search": {
      title: "البحث عن مادة",
      body: "اكتب جزءاً من الاسم أو امسح الباركود للوصول إلى المادة.",
    },
    "products-rail": {
      title: "قائمة المواد",
      body: "اختر مادة لعرض سجلها، أو أضف مادة جديدة من زر الإضافة.",
    },
    "products-canvas": {
      title: "سجل المادة",
      body: "يعرض هذا الجزء تفاصيل المادة المختارة: التعبئة ووحدات القياس والكلفة والسعر.",
    },
    "basket-view-tabs": {
      title: "الانتظار والمطلوبة",
      body: "تنتقل من هنا بين المواد التي تنتظر الطلب والمواد التي أُكِّد طلبها.",
    },
    "basket-table": {
      title: "مواد السلة",
      body: "عدّل الكمية لكل مادة، ثم أكّد ما طلبته فعلاً من المورد.",
    },
    "admin-workspace-summary": {
      title: "حسابك الحالي",
      body: "يظهر هنا اسمك ودورك في الصيدلية، ومنه تسجّل الخروج.",
    },
    "admin-change-password": {
      title: "تغيير كلمة المرور",
      body: "غيّر كلمة مرورك من هنا في أي وقت.",
    },
    "admin-licence": {
      title: "حالة الترخيص",
      body: "الخطة وتاريخ الانتهاء وعدد الأجهزة المسموح بها. بعض الإجراءات تطلب تأكيد كلمة مرورك قبل تنفيذها.",
    },
  },
  en: {
    "dashboard-connection": {
      title: "Connection status",
      body: "This card tells you whether the device is connected to the pharmacy's main computer. Check now tests it again immediately.",
    },
    "dashboard-identity": {
      title: "Device and pharmacy identifiers",
      body: "The pharmacy name and id, this device's role, and the system versions. Copy any value with its copy button when you contact support.",
    },
    "sales-new-draft": {
      title: "Start a sale draft",
      body: "This starts a new sale draft. The draft is kept on the pharmacy's main computer.",
    },
    "sales-draft-list": {
      title: "Open drafts",
      body: "Drafts that have not been closed yet. Press Resume to go back to one.",
    },
    "sales-search": {
      title: "Find an item",
      body: "Type the Arabic or English name, or scan a barcode.",
    },
    "sales-results": {
      title: "Search results",
      body: "Pick the item from the results, and add it to the order basket from here.",
    },
    "purchases-view-tabs": {
      title: "Moving between purchases and suppliers",
      body: "Switch here between the purchase invoice, saved drafts, posted invoices, and suppliers. You only see the tabs your permissions allow.",
    },
    "purchases-header-form": {
      title: "Invoice details come first",
      body: "Enter the supplier, invoice number, date, and whether it is cash or debt before you start the item rows.",
    },
    "purchases-lines-table": {
      title: "The item rows",
      body: "Enter advances through the fields: item or barcode, quantity, cost, selling price, then expiry. Posting is a separate action and never happens by pressing Enter.",
    },
    "inventory-actions": {
      title: "Inventory actions",
      body: "Start a count session, export sensitive inventory data, open the order basket, or change the column settings.",
    },
    "inventory-columns": {
      title: "Table columns",
      body: "Show the columns you need and hide the rest. Column choices are saved for this user only.",
    },
    "inventory-stock-table": {
      title: "Current stock",
      body: "Stock is derived from inventory movements. Open an item's movements to see the document that changed its balance.",
    },
    "products-search": {
      title: "Find an item",
      body: "Type part of the name or scan a barcode to reach the item.",
    },
    "products-rail": {
      title: "The item list",
      body: "Pick an item to open its record, or add a new one with the add button.",
    },
    "products-canvas": {
      title: "The item record",
      body: "This area shows the selected item's details: packaging, units, cost, and price.",
    },
    "basket-view-tabs": {
      title: "Waiting and ordered",
      body: "Switch here between items waiting to be ordered and items you have confirmed as ordered.",
    },
    "basket-table": {
      title: "Basket items",
      body: "Set the quantity for each item, then confirm what you have actually ordered from the supplier.",
    },
    "admin-workspace-summary": {
      title: "Your account",
      body: "Your name and role in this pharmacy, and where you sign out.",
    },
    "admin-change-password": {
      title: "Change your password",
      body: "Change your own password here at any time.",
    },
    "admin-licence": {
      title: "Licence status",
      body: "The plan, the expiry date, and how many devices are permitted. Some actions ask you to confirm your password first.",
    },
  },
};
