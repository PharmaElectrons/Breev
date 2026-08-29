import type { TerminalPairingFailureReason } from "@breev/contracts/desktop-preload";

import type { Locale } from "./preferences";
import type { TerminalPairingProgressStep } from "./terminal-pairing";

export interface TerminalPairingCopy {
  readonly candidatesEmpty: string;
  readonly candidatesTitle: string;
  readonly candidateUse: string;
  readonly cancel: string;
  readonly description: string;
  readonly discoveryNote: string;
  readonly failures: Record<TerminalPairingFailureReason, string>;
  readonly failureTitle: string;
  readonly failureUnrecoverableTitle: string;
  readonly fingerprintHelp: string;
  readonly fingerprintTitle: string;
  readonly host: string;
  readonly hostInvalid: string;
  readonly installationLabel: string;
  readonly invitation: string;
  readonly invitationHelp: string;
  readonly invitationInvalid: string;
  readonly invitationTitle: string;
  readonly manualDescription: string;
  readonly manualSubmit: string;
  readonly manualTitle: string;
  readonly pairedDescription: string;
  readonly pairedTitle: string;
  readonly port: string;
  readonly portInvalid: string;
  readonly progressTitle: string;
  readonly retry: string;
  readonly stepState: Record<"current" | "done" | "pending", string>;
  readonly steps: Record<TerminalPairingProgressStep, string>;
  readonly submit: string;
  readonly terminalNameLabel: string;
  readonly title: string;
}

export const terminalPairingMessages: Record<Locale, TerminalPairingCopy> = {
  ar: {
    candidatesEmpty:
      "لم يُعثر على حاسبة رئيسية على الشبكة المحلية. أدخل العنوان يدوياً.",
    candidatesTitle: "الحواسيب المكتشفة على الشبكة",
    candidateUse: "استخدام هذا العنوان",
    cancel: "إلغاء الإقران",
    description:
      "امسح رمز الإقران المعروض على الحاسبة الرئيسية للصيدلية باستخدام قارئ الباركود، أو ألصق رابط الدعوة. تنتهي صلاحية الدعوة خلال خمس دقائق.",
    discoveryNote:
      "الاكتشاف يقترح العنوان فقط. تبقى الدعوة الممسوحة هي مصدر الثقة الوحيد.",
    failures: {
      "attempts-exceeded":
        "تجاوزت هذه النقطة عدد محاولات الانضمام المسموح. ابدأ جلسة إقران جديدة على الحاسبة الرئيسية.",
      cancelled: "أُلغي الإقران من هذه النقطة.",
      "certificate-invalid":
        "الشهادة المستلمة لا تطابق مفتاح هذا الجهاز. أعد المحاولة بدعوة جديدة.",
      "certificate-storage-failed":
        "تعذر حفظ هوية الجهاز على هذه النقطة. تحقق من مساحة القرص والصلاحيات ثم أعد المحاولة.",
      "endpoint-unreachable":
        "تعذر الوصول إلى الحاسبة الرئيسية على هذا العنوان. تحقق من الشبكة المحلية ثم أعد المحاولة.",
      "entitlement-missing":
        "لا يتيح الترخيص الحالي إضافة نقاط بيع. راجع الترخيص على الحاسبة الرئيسية.",
      "invitation-invalid":
        "رابط الدعوة غير صالح. امسح رمز الإقران مرة أخرى من الحاسبة الرئيسية.",
      "key-protection-unavailable":
        "لا يستطيع مخزن مفاتيح هذا الحاسوب حماية مفتاح نقطة البيع، ولن يُحفظ المفتاح بدون حماية. إعادة المحاولة لن تغيّر ذلك. سجّل الدخول إلى حساب المستخدم على هذا الحاسوب بكلمة مروره بشكل طبيعي، وتأكد من تفعيل خدمة حماية بيانات الاعتماد في نظام التشغيل، ثم أعد تشغيل التطبيق وابدأ الإقران من جديد. إذا استمرت المشكلة فاستخدم حاسوباً آخر لنقطة البيع.",
      "seat-unavailable":
        "لا يوجد مقعد متاح ضمن عدد الأجهزة المسموح. حرّر مقعداً على الحاسبة الرئيسية ثم أعد المحاولة.",
      "server-identity-rejected":
        "تعذر التحقق من هوية الحاسبة الرئيسية. لم تُرسل أي بيانات. أعد المحاولة بدعوة جديدة.",
      "session-cancelled":
        "أُلغيت جلسة الإقران من الحاسبة الرئيسية. ابدأ جلسة جديدة هناك.",
      "session-denied":
        "رفضت الحاسبة الرئيسية طلب الانضمام. ابدأ جلسة إقران جديدة هناك.",
      "session-expired":
        "انتهت صلاحية جلسة الإقران. ابدأ جلسة جديدة على الحاسبة الرئيسية.",
      unexpected: "تعذر إكمال الإقران. أعد المحاولة.",
    },
    failureTitle: "توقف الإقران",
    failureUnrecoverableTitle: "لا يمكن إقران هذا الحاسوب",
    fingerprintHelp:
      "قارن هذه الأرقام مع الأرقام المعروضة على الحاسبة الرئيسية، ثم أكّد الإقران هناك. إذا اختلفت الأرقام فاختر عدم التطابق على الحاسبة الرئيسية.",
    fingerprintTitle: "رقم التحقق",
    host: "عنوان الحاسبة الرئيسية",
    hostInvalid: "أدخل اسم مضيف أو عنوان IP صالحاً.",
    installationLabel: "معرّف التثبيت",
    invitation: "رابط الدعوة",
    invitationHelp:
      "ضع المؤشر في هذا الحقل وامسح رمز QR. يكتب القارئ الرابط ثم يرسله تلقائياً.",
    invitationInvalid:
      "يجب أن يبدأ رابط الدعوة بـ breev-pair://1/ كما هو معروض على الحاسبة الرئيسية.",
    invitationTitle: "مسح دعوة الإقران",
    manualDescription:
      "إذا لم يظهر اسم الحاسبة الرئيسية في القائمة، أدخل عنوانها ومنفذها مع رابط الدعوة نفسه.",
    manualSubmit: "الاتصال بهذا العنوان",
    manualTitle: "إدخال العنوان يدوياً",
    pairedDescription:
      "تم إصدار شهادة الجهاز وحفظها. ستعيد نقطة البيع التشغيل إلى شاشة تسجيل الدخول.",
    pairedTitle: "تم الإقران",
    port: "المنفذ",
    portInvalid: "أدخل منفذاً بين 1 و65535.",
    progressTitle: "مراحل الإقران",
    retry: "إعادة المحاولة",
    stepState: {
      current: "جارٍ التنفيذ",
      done: "مكتمل",
      pending: "بالانتظار",
    },
    steps: {
      "awaiting-confirmation": "بانتظار التأكيد على الحاسبة الرئيسية",
      "fetching-certificate": "استلام شهادة الجهاز",
      "generating-key": "إنشاء مفتاح الجهاز",
      joining: "إرسال طلب الانضمام",
      paired: "اكتمل الإقران",
      "validating-endpoint": "التحقق من هوية الحاسبة الرئيسية",
    },
    submit: "بدء الإقران",
    terminalNameLabel: "اسم نقطة البيع",
    title: "إقران نقطة البيع الإضافية",
  },
  en: {
    candidatesEmpty:
      "No Main Pharmacy Computer was found on this network. Enter the address manually.",
    candidatesTitle: "Computers found on this network",
    candidateUse: "Use this address",
    cancel: "Cancel pairing",
    description:
      "Scan the pairing code shown on the Main Pharmacy Computer with the barcode scanner, or paste the invitation link. An invitation expires after five minutes.",
    discoveryNote:
      "Discovery only suggests an address. The scanned invitation remains the only source of trust.",
    failures: {
      "attempts-exceeded":
        "This terminal exceeded the permitted join attempts. Start a new pairing session on the Main Pharmacy Computer.",
      cancelled: "Pairing was cancelled on this terminal.",
      "certificate-invalid":
        "The certificate received does not match this device's key. Try again with a new invitation.",
      "certificate-storage-failed":
        "The device identity could not be stored on this terminal. Check disk space and permissions, then try again.",
      "endpoint-unreachable":
        "The Main Pharmacy Computer could not be reached at that address. Check the local network and try again.",
      "entitlement-missing":
        "The current licence does not include additional POS terminals. Review the licence on the Main Pharmacy Computer.",
      "invitation-invalid":
        "That invitation link is not valid. Scan the pairing code again from the Main Pharmacy Computer.",
      "key-protection-unavailable":
        "This computer's key store cannot protect the terminal key, and Breev will not store that key unprotected. Trying again will not change this. Sign in to this computer's user account with its password in the normal way, make sure the operating system's credential protection service is running, then restart Breev and pair again. If it keeps failing, use a different computer for this terminal.",
      "seat-unavailable":
        "No seat is available within the permitted device count. Release a seat on the Main Pharmacy Computer, then try again.",
      "server-identity-rejected":
        "The identity of the Main Pharmacy Computer could not be verified. Nothing was sent. Try again with a new invitation.",
      "session-cancelled":
        "Pairing was cancelled on the Main Pharmacy Computer. Start a new session there.",
      "session-denied":
        "The Main Pharmacy Computer rejected the join request. Start a new pairing session there.",
      "session-expired":
        "The pairing session expired. Start a new session on the Main Pharmacy Computer.",
      unexpected: "Pairing could not be completed. Try again.",
    },
    failureTitle: "Pairing stopped",
    failureUnrecoverableTitle: "This computer cannot be paired",
    fingerprintHelp:
      "Compare these digits with the digits on the Main Pharmacy Computer, then confirm there. If they differ, choose the mismatch option on the Main Pharmacy Computer.",
    fingerprintTitle: "Verification number",
    host: "Main Pharmacy Computer address",
    hostInvalid: "Enter a valid host name or IP address.",
    installationLabel: "Installation reference",
    invitation: "Invitation link",
    invitationHelp:
      "Put the cursor in this field and scan the QR code. The scanner types the link and submits it.",
    invitationInvalid:
      "The invitation link must start with breev-pair://1/ exactly as shown on the Main Pharmacy Computer.",
    invitationTitle: "Scan the pairing invitation",
    manualDescription:
      "If the Main Pharmacy Computer is not listed, enter its address and port together with the same invitation link.",
    manualSubmit: "Connect to this address",
    manualTitle: "Enter the address manually",
    pairedDescription:
      "The device certificate was issued and stored. This terminal restarts into the sign-in screen.",
    pairedTitle: "Terminal paired",
    port: "Port",
    portInvalid: "Enter a port between 1 and 65535.",
    progressTitle: "Pairing steps",
    retry: "Try again",
    stepState: {
      current: "In progress",
      done: "Done",
      pending: "Waiting",
    },
    steps: {
      "awaiting-confirmation": "Waiting for confirmation on the Main computer",
      "fetching-certificate": "Collecting the device certificate",
      "generating-key": "Creating the device key",
      joining: "Sending the join request",
      paired: "Pairing complete",
      "validating-endpoint": "Verifying the Main Pharmacy Computer",
    },
    submit: "Start pairing",
    terminalNameLabel: "Terminal name",
    title: "Pair this additional POS terminal",
  },
};
