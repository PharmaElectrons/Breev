import type { Locale } from "./preferences";
import type { StartupState } from "./startup-state";

interface StatusMessage {
  readonly description: string;
  readonly title: string;
}

interface SystemOverviewMessages {
  readonly apiVersion: string;
  readonly connected: string;
  readonly copy: string;
  readonly copied: string;
  readonly database: string;
  readonly databaseAvailable: string;
  readonly description: string;
  readonly deviceId: string;
  readonly installationId: string;
  readonly localDeviceRole: string;
  readonly localServer: string;
  readonly mainRole: string;
  readonly notAvailable: string;
  readonly pharmacyId: string;
  readonly pharmacyName: string;
  readonly schemaVersion: string;
  readonly terminalRole: string;
  readonly title: string;
}

export interface CrashMessage {
  readonly cancelSubmission: string;
  readonly confirmSubmission: string;
  readonly confirmSubmissionDescription: string;
  readonly confirmSubmissionTitle: string;
  readonly contactSupport: string;
  readonly contactFailed: string;
  readonly contactOpened: string;
  readonly contactUnavailable: string;
  readonly copied: string;
  readonly copyFailed: string;
  readonly copySummary: string;
  readonly description: string;
  readonly exportDiagnostics: string;
  readonly exportCancelled: string;
  readonly exportFailed: string;
  readonly exportSaved: string;
  readonly incidentLabel: string;
  readonly manualSupportInstructions: string;
  readonly privacyNotice: string;
  readonly reloadTerminal: string;
  readonly reportReference: string;
  readonly retryView: string;
  readonly retryUnavailable: string;
  readonly submitDiagnostics: string;
  readonly submitFailed: string;
  readonly submitted: string;
  readonly submitUnavailable: string;
  readonly title: string;
}

interface Messages {
  readonly apiVersion: string;
  readonly brandDescription: string;
  readonly checkAgain: string;
  readonly checking: string;
  readonly connectionStatus: string;
  readonly crash: CrashMessage;
  readonly deviceProof: Record<
    "committed" | "denied" | "failed" | "idle" | "running",
    string
  >;
  readonly deviceProofAction: string;
  readonly lastChecked: string;
  readonly schemaVersion: string;
  readonly status: Record<StartupState, StatusMessage>;
  readonly systemOverview: SystemOverviewMessages;
  readonly switchLanguage: string;
  readonly switchToDarkTheme: string;
  readonly switchToLightTheme: string;
  readonly themeDark: string;
  readonly themeLight: string;
}

export const messages: Record<Locale, Messages> = {
  ar: {
    apiVersion: "إصدار واجهة الخادم المحلي",
    brandDescription: "نظام إدارة الصيدلية",
    checkAgain: "تحقق الآن",
    checking: "جارٍ التحقق",
    connectionStatus: "حالة الاتصال",
    crash: {
      cancelSubmission: "إلغاء",
      confirmSubmission: "تأكيد الإرسال",
      confirmSubmissionDescription:
        "سيتم إرسال حزمة تشخيص منقحة فقط. لن تُرسل سجلات المرضى أو الوصفات أو بيانات البيع أو بيانات الاعتماد.",
      confirmSubmissionTitle: "هل تريد إرسال تقرير التشخيص؟",
      contactSupport: "الاتصال بالدعم",
      contactFailed: "تعذر فتح وسيلة الدعم.",
      contactOpened: "تم فتح وسيلة الدعم. أرفق حزمة التشخيص المصدرة.",
      contactUnavailable: "لم يتم إعداد وسيلة دعم معتمدة بعد.",
      copied: "تم نسخ ملخص الخطأ.",
      copyFailed: "تعذر النسخ. دوّن رمز الخطأ الظاهر.",
      copySummary: "نسخ ملخص الخطأ",
      description:
        "تعذر عرض هذا الجزء من بريف بأمان. لم يغيّر هذا الخطأ السجلات المرحّلة في الخادم المحلي.",
      exportDiagnostics: "تصدير حزمة التشخيص",
      exportCancelled: "تم إلغاء التصدير.",
      exportFailed: "تعذر حفظ حزمة التشخيص.",
      exportSaved: "تم حفظ حزمة التشخيص. أرفق الملف عند التواصل مع الدعم.",
      incidentLabel: "رمز الخطأ",
      manualSupportInstructions:
        "دوّن رمز الخطأ، ثم صدّر حزمة التشخيص وأرسلها عبر وسيلة الدعم المعتمدة لدى مؤسستك.",
      privacyNotice:
        "تتضمن الحزمة حالة Breev والنظام وسجلات أحداث منقحة فقط. لا تتضمن بيانات المرضى أو الوصفات أو المعاملات أو كلمات المرور أو الرموز السرية.",
      reloadTerminal: "إعادة تحميل نقطة البيع",
      reportReference: "مرجع التقرير",
      retryView: "إعادة المحاولة",
      retryUnavailable: "تعذرت إعادة المحاولة. أعد تحميل نقطة البيع.",
      submitDiagnostics: "إرسال تقرير التشخيص",
      submitFailed: "تعذر إرسال التقرير. يمكنك تصدير الحزمة ومشاركتها يدوياً.",
      submitted: "تم إرسال تقرير تشخيص منقح إلى نظام الدعم المركزي.",
      submitUnavailable: "إرسال التقارير المركزي غير مفعّل على هذا التثبيت.",
      title: "حدث خطأ غير متوقع",
    },
    deviceProof: {
      committed: "تم التحقق من ارتباط هذه الحاسبة والجلسة.",
      denied: "رفض الخادم ارتباط هذه الحاسبة والجلسة.",
      failed: "تعذر إكمال التحقق من ارتباط الحاسبة.",
      idle: "",
      running: "جارٍ التحقق من ارتباط الحاسبة",
    },
    deviceProofAction: "تحقق من ارتباط الحاسبة",
    lastChecked: "آخر تحقق",
    schemaVersion: "إصدار مخطط البيانات",
    status: {
      starting: {
        title: "جارٍ البدء",
        description: "يتم تجهيز واجهة بريف المكتبية الآمنة.",
      },
      connecting: {
        title: "جارٍ الاتصال",
        description:
          "يتم التحقق من واجهة الخادم المحلي والحاسبة الرئيسية للصيدلية.",
      },
      ready: {
        title: "جاهز",
        description: "الحاسبة الرئيسية للصيدلية متاحة ويمكن متابعة العمل.",
      },
      "main-unavailable": {
        title: "الحاسبة الرئيسية غير متاحة",
        description:
          "تعذر الوصول إلى الحاسبة الرئيسية للصيدلية. سيحاول بريف الاتصال تلقائياً.",
      },
      "incompatible-version": {
        title: "الإصدار غير متوافق",
        description:
          "إصدارات تطبيق بريف وواجهة الخادم المحلي ومخطط البيانات غير متوافقة.",
      },
      "repair-required": {
        title: "الإصلاح مطلوب",
        description:
          "أبلغت واجهة الخادم المحلي عن حالة تثبيت غير صالحة. لم ينشئ بريف مخزناً بديلاً للبيانات.",
      },
      unpaired: {
        title: "نقطة البيع غير مقترنة",
        description:
          "لا تملك نقطة البيع الإضافية هذه شهادة بريف بعد. أكمل الإقران مع الحاسبة الرئيسية للصيدلية للمتابعة.",
      },
    },
    systemOverview: {
      apiVersion: "إصدار واجهة الخادم المحلي",
      connected: "متصل",
      copy: "نسخ",
      copied: "تم النسخ إلى الحافظة",
      database: "اتصال قاعدة البيانات",
      databaseAvailable: "متاحة",
      description: "معلومات هذه الصيدلية والجهاز التي يحتاجها فريق الدعم.",
      deviceId: "معرف الجهاز",
      installationId: "معرف التثبيت",
      localDeviceRole: "دور الجهاز المحلي",
      localServer: "الخادم المحلي",
      mainRole: "الحاسبة الرئيسية للصيدلية",
      notAvailable: "غير متاح",
      pharmacyId: "معرف الصيدلية",
      pharmacyName: "اسم الصيدلية",
      schemaVersion: "إصدار مخطط البيانات",
      terminalRole: "نقطة بيع إضافية",
      title: "معرفات التثبيت ومعلومات النظام",
    },
    switchLanguage: "التبديل إلى الإنجليزية",
    switchToDarkTheme: "استخدام الوضع الداكن",
    switchToLightTheme: "استخدام الوضع الفاتح",
    themeDark: "داكن",
    themeLight: "فاتح",
  },
  en: {
    apiVersion: "Local API version",
    brandDescription: "Pharmacy operating system",
    checkAgain: "Check now",
    checking: "Checking",
    connectionStatus: "Connection status",
    crash: {
      cancelSubmission: "Cancel",
      confirmSubmission: "Confirm send",
      confirmSubmissionDescription:
        "Only a redacted diagnostic package will be sent. Patient, prescription, sales, and credential records are not included.",
      confirmSubmissionTitle: "Send this diagnostic report?",
      contactSupport: "Contact support",
      contactFailed: "The support destination could not be opened.",
      contactOpened: "Support opened. Attach the exported diagnostic package.",
      contactUnavailable: "No approved support destination is configured yet.",
      copied: "Error summary copied.",
      copyFailed: "Copy failed. Write down the incident code shown here.",
      copySummary: "Copy error summary",
      description:
        "Breev could not safely display this part of the application. This UI error did not alter posted records in the local API.",
      exportDiagnostics: "Export diagnostic package",
      exportCancelled: "Export cancelled.",
      exportFailed: "The diagnostic package could not be saved.",
      exportSaved:
        "Diagnostic package saved. Attach the file when contacting support.",
      incidentLabel: "Incident code",
      manualSupportInstructions:
        "Write down the incident code, export the diagnostic package, and send it through your organization's approved support channel.",
      privacyNotice:
        "The package contains Breev/system health and redacted event records only. It excludes patient, prescription, transaction, password, and secret data.",
      reloadTerminal: "Reload terminal",
      reportReference: "Report reference",
      retryView: "Try again",
      retryUnavailable: "Retry failed. Reload the terminal.",
      submitDiagnostics: "Send diagnostic report",
      submitFailed:
        "Report could not be sent. You can export and share the package manually.",
      submitted:
        "A redacted diagnostic report was sent to the central support system.",
      submitUnavailable:
        "Central reporting is not enabled for this installation.",
      title: "Something went wrong",
    },
    deviceProof: {
      committed: "This device and session binding is verified.",
      denied: "The local API denied this device and session binding.",
      failed: "The device binding check could not complete.",
      idle: "",
      running: "Checking the device binding",
    },
    deviceProofAction: "Verify Main device",
    lastChecked: "Last checked",
    schemaVersion: "Schema version",
    status: {
      starting: {
        title: "Starting",
        description: "Preparing the secure Breev desktop shell.",
      },
      connecting: {
        title: "Connecting",
        description: "Checking the local API and Main Pharmacy Computer.",
      },
      ready: {
        title: "Ready",
        description: "The Main Pharmacy Computer is available for local work.",
      },
      "main-unavailable": {
        title: "Main unavailable",
        description:
          "Breev cannot reach the Main Pharmacy Computer. It will reconnect automatically.",
      },
      "incompatible-version": {
        title: "Incompatible version",
        description:
          "The Breev desktop, local API, and schema versions do not match.",
      },
      "repair-required": {
        title: "Repair required",
        description:
          "The local API reported an invalid installation state. Breev did not create a fallback data store.",
      },
      unpaired: {
        title: "Terminal not paired",
        description:
          "This additional POS terminal has no Breev certificate yet. Complete pairing with the Main Pharmacy Computer to continue.",
      },
    },
    systemOverview: {
      apiVersion: "Local API version",
      connected: "Connected",
      copy: "Copy",
      copied: "Copied to clipboard",
      database: "Database connection",
      databaseAvailable: "Available",
      description:
        "Pharmacy and device information used when working with support.",
      deviceId: "Device ID",
      installationId: "Installation ID",
      localDeviceRole: "Local device role",
      localServer: "Local server",
      mainRole: "Main Pharmacy Computer",
      notAvailable: "Not available",
      pharmacyId: "Pharmacy ID",
      pharmacyName: "Pharmacy name",
      schemaVersion: "Schema version",
      terminalRole: "Additional POS Terminal",
      title: "Installation and system identifiers",
    },
    switchLanguage: "Switch to Arabic",
    switchToDarkTheme: "Use dark theme",
    switchToLightTheme: "Use light theme",
    themeDark: "Dark",
    themeLight: "Light",
  },
};
