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

interface Messages {
  readonly apiVersion: string;
  readonly brandDescription: string;
  readonly checkAgain: string;
  readonly checking: string;
  readonly connectionStatus: string;
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
