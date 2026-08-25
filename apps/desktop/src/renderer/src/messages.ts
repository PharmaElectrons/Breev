import type { Locale } from "./preferences";
import type { StartupState } from "./startup-state";

interface StatusMessage {
  readonly description: string;
  readonly title: string;
}

interface Messages {
  readonly apiVersion: string;
  readonly brandDescription: string;
  readonly checkAgain: string;
  readonly checking: string;
  readonly connectionStatus: string;
  readonly lastChecked: string;
  readonly schemaVersion: string;
  readonly status: Record<StartupState, StatusMessage>;
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
    },
    switchLanguage: "Switch to Arabic",
    switchToDarkTheme: "Use dark theme",
    switchToLightTheme: "Use light theme",
    themeDark: "Dark",
    themeLight: "Light",
  },
};
