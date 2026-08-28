import type { CapabilityName } from "@breev/contracts/local-rest";

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
  readonly expires: string;
  readonly install: string;
  readonly installDescription: string;
  readonly licenceDocument: string;
  readonly licenceStatus: string;
  readonly plan: string;
  readonly statuses: Record<
    "clock-rollback" | "expired" | "free-core" | "invalid-licence" | "licensed",
    string
  >;
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
    expires: "ينتهي في",
    install: "تثبيت الترخيص",
    installDescription:
      "ألصق مستند الترخيص الموقّع. سيُطلب تأكيد كلمة المرور قبل التثبيت.",
    licenceDocument: "مستند الترخيص الموقّع",
    licenceStatus: "حالة الترخيص",
    plan: "الخطة",
    statuses: {
      "clock-rollback": "تم رصد رجوع الساعة — الوظائف المجانية فقط",
      expired: "انتهى الترخيص — الوظائف المجانية فقط",
      "free-core": "الوظائف المجانية",
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
    expires: "Expires",
    install: "Install licence",
    installDescription:
      "Paste the signed licence document. Password confirmation is required before installation.",
    licenceDocument: "Signed licence document",
    licenceStatus: "Licence status",
    plan: "Plan",
    statuses: {
      "clock-rollback": "Clock rollback detected — Free Core only",
      expired: "Licence expired — Free Core only",
      "free-core": "Free Core",
      "invalid-licence": "Licence invalid — Free Core only",
      licensed: "Licence active",
    },
  },
};
