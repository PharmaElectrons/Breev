import type { ModuleId } from "./navigation";
import type { Locale } from "./preferences";

interface ModuleCopy {
  /** The reason this surface is not available yet, in the user's own terms. */
  readonly unavailableReason: string;
  readonly label: string;
}

interface NavigationCopy {
  readonly modules: Record<ModuleId, ModuleCopy>;
  readonly moduleNavigation: string;
  readonly unavailableBadge: string;
  readonly unavailableHeading: string;
  readonly unavailableLead: string;
}

/**
 * Arabic labels follow the client-supplied prototype's own module bar, so the
 * pharmacy meets the vocabulary it was shown.
 *
 * The unavailable copy states the plain truth — the screen is not built yet —
 * and nothing more. It never describes a capability Breev cannot perform, and
 * it never names an internal delivery milestone: a pharmacist is owed an honest
 * answer about what works today, not Breev's release sequencing.
 */
export const navigationMessages: Record<Locale, NavigationCopy> = {
  ar: {
    moduleNavigation: "أقسام النظام",
    unavailableBadge: "غير متاح بعد",
    unavailableHeading: "هذه الشاشة غير متاحة بعد",
    unavailableLead:
      "لم يُبنَ هذا القسم في بريف بعد. لا توجد بيانات تجريبية هنا، ولن يعرض بريف أرقاماً غير حقيقية.",
    modules: {
      accounts: {
        label: "الحسابات",
        unavailableReason:
          "دفتر الحسابات والسندات وكشوف الحسابات غير متاحة بعد.",
      },
      administration: {
        label: "الموظفون والصلاحيات",
        unavailableReason: "",
      },
      basket: {
        label: "سلة الطلبات",
        unavailableReason:
          "سلة إعادة الطلب تعتمد على أرصدة المخزن، وهي غير متاحة بعد.",
      },
      dashboard: {
        label: "القائمة الرئيسية",
        unavailableReason:
          "تعتمد الملخصات على المبيعات والمشتريات والمخزن والحسابات، وهي غير متاحة بعد.",
      },
      inventory: {
        label: "المخزن",
        unavailableReason:
          "يُشتق رصيد المخزن من حركات المخزون، وهي غير متاحة بعد.",
      },
      messages: {
        label: "إرسال رسالة",
        unavailableReason:
          "إرسال الرسائل يبقى معطلاً حتى اعتماد المزود والقوالب وأنواع الرسائل.",
      },
      patients: {
        label: "الملف الصحي",
        unavailableReason: "ملفات المرضى ومتابعتها غير متاحة بعد.",
      },
      products: {
        label: "المواد",
        unavailableReason: "",
      },
      purchases: {
        label: "المشتريات",
        unavailableReason: "فواتير الشراء والتعديلات والإرجاعات غير متاحة بعد.",
      },
      reports: {
        label: "التقارير",
        unavailableReason:
          "تُبنى التقارير على المستندات المرحّلة، ولا توجد مستندات مرحّلة بعد.",
      },
      sales: {
        label: "البيع",
        unavailableReason: "شاشة البيع غير متاحة بعد.",
      },
      settings: {
        label: "الإعدادات",
        unavailableReason:
          "إعدادات الصيدلية والترخيص والأجهزة متاحة حالياً ضمن شاشة الموظفين والصلاحيات.",
      },
    },
  },
  en: {
    moduleNavigation: "Modules",
    unavailableBadge: "Not available yet",
    unavailableHeading: "This screen is not available yet",
    unavailableLead:
      "Breev has not built this module yet. There is no sample data here, and Breev will not show figures that are not real.",
    modules: {
      accounts: {
        label: "Accounts",
        unavailableReason:
          "The ledger, vouchers, and account statements are not available yet.",
      },
      administration: {
        label: "Employees & roles",
        unavailableReason: "",
      },
      basket: {
        label: "Orders basket",
        unavailableReason:
          "The reorder basket reads stock balances, which are not available yet.",
      },
      dashboard: {
        label: "Main dashboard",
        unavailableReason:
          "The summaries read sales, purchases, inventory, and accounts, none of which are available yet.",
      },
      inventory: {
        label: "Inventory",
        unavailableReason:
          "Stock is derived from inventory movements, which are not available yet.",
      },
      messages: {
        label: "Send message",
        unavailableReason:
          "Message sending stays disabled until the provider, templates, and message types are approved.",
      },
      patients: {
        label: "Patient profile",
        unavailableReason:
          "Patient profiles and follow-ups are not available yet.",
      },
      products: {
        label: "Products",
        unavailableReason: "",
      },
      purchases: {
        label: "Purchases",
        unavailableReason:
          "Purchase invoices, adjustments, and returns are not available yet.",
      },
      reports: {
        label: "Reports",
        unavailableReason:
          "Reports read posted documents, and no documents have been posted yet.",
      },
      sales: {
        label: "Sales",
        unavailableReason: "The point-of-sale screen is not available yet.",
      },
      settings: {
        label: "Settings",
        unavailableReason:
          "Pharmacy settings, licensing, and terminals are reachable today from Employees & roles.",
      },
    },
  },
};
