import type {
  CapabilityName,
  EntitlementContext,
} from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export interface LicensingCopy {
  readonly availableCapabilities: string;
  readonly capabilities: Record<CapabilityName, string>;
  readonly deactivate: string;
  readonly deactivateDescription: string;
  readonly deviceAllowance: string;
  readonly denials: Record<
    | "clock-rollback"
    | "entitlement-denied"
    | "idempotency-conflict"
    | "licence-invalid",
    string
  >;
  readonly daysRemaining: string;
  readonly expires: string;
  /** The near-expiry warning; `days` is the whole days left until expiry. */
  readonly expiryWarning: (days: number) => string;
  readonly founderGrants: string;
  readonly founderGrantsNone: string;
  readonly graceUntil: string;
  readonly graceWarning: string;
  readonly issued: string;
  readonly licenceDocument: string;
  readonly licenceStatus: string;
  readonly plan: string;
  readonly planFeatures: string;
  readonly planFeaturesNone: string;
  readonly renew: string;
  readonly renewDescription: string;
  readonly statuses: Record<EntitlementContext["status"], string>;
}

/**
 * Arabic counts a day differently at one, two, three to ten, and above ten.
 * The number itself is formatted by the caller's locale; this only chooses
 * the noun form.
 */
function arabicDays(days: number): string {
  if (days === 0) return "اليوم";
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  const formatted = new Intl.NumberFormat("ar-IQ").format(days);
  return days <= 10 ? `${formatted} أيام` : `${formatted} يوماً`;
}

export const licensingMessages: Record<Locale, LicensingCopy> = {
  ar: {
    availableCapabilities: "الوظائف المتاحة",
    capabilities: {
      "additional-device-pos": "نقاط بيع لأجهزة إضافية",
      "ai-services": "خدمات الذكاء الاصطناعي",
      "basic-accounting": "المحاسبة الأساسية",
      "complete-export": "التصدير الكامل",
      "crm-advanced-reports": "تقارير العملاء المتقدمة",
      "local-inventory": "المخزون المحلي",
      "local-purchases": "المشتريات المحلية",
      "local-sales": "المبيعات المحلية",
      "named-patient-table": "سجل المرضى بالأسماء",
      "one-way-cloud-sync": "المزامنة السحابية أحادية الاتجاه",
      printing: "الطباعة",
      "purchase-invoice-ocr": "قراءة فواتير الشراء",
      renewal: "تجديد الترخيص",
      reports: "التقارير",
      "supported-restore": "الاستعادة المدعومة",
      backup: "النسخ الاحتياطي",
      "whatsapp-messaging": "رسائل واتساب",
    },
    deactivate: "إزالة الترخيص",
    deactivateDescription:
      "العودة إلى الوظائف المجانية مع الاحتفاظ بجميع بيانات الصيدلية وسجل الترخيص.",
    deviceAllowance: "عدد الأجهزة المسموح",
    denials: {
      "clock-rollback": "تعذر تثبيت الترخيص بعد رصد رجوع الساعة.",
      "entitlement-denied": "الترخيص الحالي لا يتيح هذه الوظيفة.",
      "idempotency-conflict":
        "أُعيد استخدام معرّف الطلب لمستند ترخيص مختلف. أعد المحاولة.",
      "licence-invalid":
        "تعذر التحقق من صحة الترخيص أو ارتباطه بهذه الصيدلية والجهاز الرئيسي.",
    },
    daysRemaining: "الأيام المتبقية",
    expires: "ينتهي في",
    expiryWarning: (days) =>
      days === 0
        ? "ينتهي الترخيص اليوم. جدّده لتستمر الوظائف المدفوعة."
        : `ينتهي الترخيص خلال ${arabicDays(days)}. جدّده لتستمر الوظائف المدفوعة.`,
    founderGrants: "منح المؤسس",
    founderGrantsNone: "لا توجد منح إضافية",
    graceUntil: "فترة السماح حتى",
    graceWarning:
      "انتهت مدة الترخيص وتستمر الوظائف المدفوعة خلال فترة السماح. لا يمكن إقران نقطة بيع جديدة حتى التجديد.",
    issued: "صدر في",
    licenceDocument: "مستند الترخيص الموقّع",
    licenceStatus: "حالة الترخيص",
    plan: "الخطة",
    planFeatures: "وظائف الخطة",
    planFeaturesNone: "لا توجد وظائف مدفوعة في الخطة",
    renew: "تجديد الترخيص أو تثبيته",
    renewDescription:
      "ألصق مستند الترخيص المجدد الموقّع. يطبّقه بريف دون إعادة تثبيت أو تغيير في البيانات، بعد تأكيد كلمة المرور.",
    statuses: {
      "clock-rollback": "تم رصد رجوع الساعة — الوظائف المجانية فقط",
      expired: "انتهى الترخيص — الوظائف المجانية فقط",
      "free-core": "الوظائف المجانية",
      grace: "انتهى الترخيص — ضمن فترة السماح",
      "invalid-licence": "الترخيص غير صالح — الوظائف المجانية فقط",
      licensed: "الترخيص فعّال",
    },
  },
  en: {
    availableCapabilities: "Available functions",
    capabilities: {
      "additional-device-pos": "Additional-device POS",
      "ai-services": "AI services",
      "basic-accounting": "Basic accounting",
      "complete-export": "Complete export",
      "crm-advanced-reports": "Advanced CRM reports",
      "local-inventory": "Local inventory",
      "local-purchases": "Local purchases",
      "local-sales": "Local sales",
      "named-patient-table": "Named patient table",
      "one-way-cloud-sync": "One-way cloud sync",
      printing: "Printing",
      "purchase-invoice-ocr": "Purchase-invoice OCR",
      renewal: "Licence renewal",
      reports: "Reports",
      "supported-restore": "Supported restore",
      backup: "Backup",
      "whatsapp-messaging": "WhatsApp messaging",
    },
    deactivate: "Remove licence",
    deactivateDescription:
      "Return to Free Core while retaining all pharmacy data and licence history.",
    deviceAllowance: "Permitted devices",
    denials: {
      "clock-rollback":
        "The licence cannot be installed after a clock rollback was detected.",
      "entitlement-denied":
        "The current licence does not include this function.",
      "idempotency-conflict":
        "The request identifier was reused for a different licence document. Try again.",
      "licence-invalid":
        "The licence signature or its pharmacy/Main-device binding is invalid.",
    },
    daysRemaining: "Days remaining",
    expires: "Expires",
    expiryWarning: (days) =>
      days === 0
        ? "The licence expires today. Renew it to keep paid functions running."
        : `The licence expires in ${days === 1 ? "1 day" : `${days} days`}. Renew it to keep paid functions running.`,
    founderGrants: "Founder grants",
    founderGrantsNone: "No additional grants",
    graceUntil: "Grace period until",
    graceWarning:
      "The licence has expired and paid functions continue during the grace period. A new terminal cannot be paired until the licence is renewed.",
    issued: "Issued",
    licenceDocument: "Signed licence document",
    licenceStatus: "Licence status",
    plan: "Plan",
    planFeatures: "Plan features",
    planFeaturesNone: "No paid features in the plan",
    renew: "Renew or install licence",
    renewDescription:
      "Paste the renewed signed licence. Breev applies it without reinstalling or changing data, after password confirmation.",
    statuses: {
      "clock-rollback": "Clock rollback detected — Free Core only",
      expired: "Licence expired — Free Core only",
      "free-core": "Free Core",
      grace: "Licence expired — within the grace period",
      "invalid-licence": "Licence invalid — Free Core only",
      licensed: "Licence active",
    },
  },
};
