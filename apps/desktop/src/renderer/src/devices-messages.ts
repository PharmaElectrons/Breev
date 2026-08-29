import type {
  DevicesDenialCode,
  PairingCancellationReason,
  PairingFailureReason,
} from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export interface DevicesCopy {
  readonly active: string;
  readonly approvalSubmit: string;
  readonly approverPassword: string;
  readonly approverUsername: string;
  readonly awaitingConfirmationDescription: string;
  readonly awaitingConfirmationTitle: string;
  readonly cancel: string;
  readonly cancelMismatch: string;
  readonly cancelSession: string;
  readonly commandFailed: string;
  readonly commandFailedTitle: string;
  readonly confirmPairing: string;
  readonly connected: string;
  readonly denial: string;
  readonly denials: Record<DevicesDenialCode, string>;
  readonly description: string;
  readonly deviceListTitle: string;
  readonly devicesEmpty: string;
  readonly expiresIn: string;
  readonly fingerprintTitle: string;
  readonly invitationUri: string;
  readonly loading: string;
  readonly pairedAt: string;
  readonly pairingTitle: string;
  readonly qrLabel: string;
  readonly qrUnavailable: string;
  readonly requestReference: string;
  readonly requestSeatRelease: string;
  readonly revocationReason: string;
  readonly revoke: string;
  readonly revokeDescription: string;
  readonly revoked: string;
  readonly revokeSubmit: string;
  readonly seatReleaseApprovalDescription: string;
  readonly seatReleaseApprovalTitle: string;
  readonly seatReleased: string;
  readonly seatReleasePending: string;
  readonly seatUsage: string;
  readonly seatUsageUnlicensed: string;
  readonly sectionsLabel: string;
  readonly sessionCancelled: Record<PairingCancellationReason, string>;
  readonly sessionConfirmed: string;
  readonly sessionExpired: string;
  readonly sessionFailed: Record<PairingFailureReason, string>;
  readonly sessionNone: string;
  readonly staleData: string;
  readonly startAgain: string;
  readonly startPairing: string;
  readonly terminalName: string;
  readonly title: string;
  readonly validUntil: string;
  readonly viewDevices: string;
}

export const devicesMessages: Record<Locale, DevicesCopy> = {
  ar: {
    active: "فعّال",
    approvalSubmit: "اعتماد تحرير المقعد",
    approverPassword: "كلمة مرور المعتمِد",
    approverUsername: "اسم مستخدم المعتمِد",
    awaitingConfirmationDescription:
      "قارن الأرقام أدناه مع الأرقام المعروضة على نقطة البيع. أكّد فقط إذا تطابقت تماماً وكنت أمام الجهاز نفسه.",
    awaitingConfirmationTitle: "بانتظار تأكيدك",
    cancel: "إلغاء",
    cancelMismatch: "الأرقام غير متطابقة",
    cancelSession: "إلغاء جلسة الإقران",
    commandFailed:
      "لم تصل استجابة من الحاسبة الرئيسية لهذا الإجراء، وقد يكون نُفّذ أو لم يُنفّذ. حدّث القائمة وتحقق من حالة الجهاز قبل إعادة المحاولة.",
    commandFailedTitle: "تعذر إكمال الإجراء",
    confirmPairing: "تأكيد الإقران",
    connected: "متصل الآن",
    denial: "تم رفض الإجراء",
    denials: {
      "body-invalid": "تحقق من البيانات المدخلة.",
      "device-not-found": "لم يعد هذا الجهاز موجوداً في سجل الأجهزة.",
      "device-not-revoked": "يجب إبطال الجهاز قبل طلب تحرير مقعده.",
      "pairing-attempts-exceeded":
        "تجاوزت جلسة الإقران عدد المحاولات المسموح. ابدأ جلسة جديدة.",
      "pairing-entitlement-missing":
        "لا يتيح الترخيص الحالي إضافة نقاط بيع. جدّد الترخيص أو أضف المقاعد المطلوبة.",
      "pairing-seat-unavailable":
        "لا يوجد مقعد متاح ضمن عدد الأجهزة المسموح. حرّر مقعد جهاز مبطل أولاً.",
      "pairing-session-conflict":
        "توجد جلسة إقران نشطة بالفعل. أكملها أو ألغها قبل بدء جلسة أخرى.",
      "pairing-session-expired": "انتهت صلاحية جلسة الإقران. ابدأ جلسة جديدة.",
      "pairing-session-missing": "لم تعد جلسة الإقران متاحة. ابدأ جلسة جديدة.",
      "pairing-session-replayed":
        "أُعيد استخدام جلسة الإقران. أُوقف الإجراء وسُجل في سجل التدقيق.",
      "pairing-signature-invalid":
        "تعذر التحقق من توقيع نقطة البيع. أُوقف الإقران.",
      "rate-limit-exceeded":
        "محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.",
      "seat-release-approver-invalid":
        "يجب أن يعتمد تحرير المقعد مستخدم آخر نشط يملك صلاحية إقران الأجهزة، ببيانات دخول صحيحة.",
      "seat-release-request-invalid":
        "لم يعد طلب تحرير المقعد صالحاً. ابدأ طلباً جديداً.",
    },
    description:
      "اربط نقاط البيع الإضافية بهذه الحاسبة الرئيسية وأدر مقاعدها وإبطالها.",
    deviceListTitle: "الأجهزة المقترنة",
    devicesEmpty: "لا توجد نقاط بيع مقترنة بعد.",
    expiresIn: "تنتهي خلال",
    fingerprintTitle: "رقم التحقق",
    invitationUri: "رابط الدعوة",
    loading: "جارٍ تحميل حالة الأجهزة",
    pairedAt: "تاريخ الإقران",
    pairingTitle: "إقران نقطة بيع",
    qrLabel: "رمز الإقران — امسحه بقارئ نقطة البيع",
    qrUnavailable: "رمز الإقران غير متاح. ابدأ جلسة إقران جديدة.",
    requestReference: "مرجع الطلب",
    requestSeatRelease: "طلب تحرير المقعد",
    revocationReason: "سبب الإبطال",
    revoke: "إبطال الجهاز",
    revokeDescription:
      "الإبطال يقطع الجهاز فوراً وينهي جلساته. يبقى المقعد محجوزاً حتى يعتمد مستخدم آخر تحريره.",
    revoked: "مبطل",
    revokeSubmit: "تأكيد الإبطال",
    seatReleaseApprovalDescription:
      "يجب أن يعتمد تحرير المقعد مستخدم آخر يملك صلاحية إقران الأجهزة. أدخل بيانات دخوله على هذه الحاسبة.",
    seatReleaseApprovalTitle: "اعتماد تحرير المقعد",
    seatReleased: "تم تحرير المقعد",
    seatReleasePending: "بانتظار اعتماد مستخدم آخر",
    seatUsage: "المقاعد المستخدمة",
    seatUsageUnlicensed: "لا يوجد ترخيص مثبّت",
    sectionsLabel: "أقسام الأجهزة",
    sessionCancelled: {
      "fingerprint-mismatch":
        "أُلغيت الجلسة لعدم تطابق أرقام التحقق. تحقق من الجهاز الذي يحاول الاتصال ثم ابدأ جلسة جديدة.",
      "user-cancelled": "أُلغيت جلسة الإقران.",
    },
    sessionConfirmed: "تم إقران نقطة البيع وإصدار شهادتها.",
    sessionExpired: "انتهت صلاحية جلسة الإقران دون اكتمالها.",
    sessionFailed: {
      "excess-attempts":
        "أُوقفت الجلسة بعد محاولات انضمام خاطئة كثيرة، وسُجل ذلك في سجل التدقيق.",
    },
    sessionNone:
      "لا توجد جلسة إقران نشطة. يتطلب البدء تأكيد كلمة المرور، وتنتهي الجلسة خلال خمس دقائق.",
    staleData:
      "تعذر تحديث حالة الأجهزة، وقد تكون المعروضة قديمة. الإجراءات معطّلة حتى ينجح التحديث.",
    startAgain: "بدء جلسة جديدة",
    startPairing: "بدء الإقران",
    terminalName: "اسم نقطة البيع",
    title: "نقاط البيع الإضافية",
    validUntil: "صلاحية الشهادة حتى",
    viewDevices: "عرض الأجهزة",
  },
  en: {
    active: "Active",
    approvalSubmit: "Approve seat release",
    approverPassword: "Approver password",
    approverUsername: "Approver username",
    awaitingConfirmationDescription:
      "Compare the digits below with the digits on the terminal. Confirm only if they match exactly and you are standing at that terminal.",
    awaitingConfirmationTitle: "Waiting for your confirmation",
    cancel: "Cancel",
    cancelMismatch: "Digits do not match",
    cancelSession: "Cancel pairing session",
    commandFailed:
      "The Main Pharmacy Computer did not answer this action, so it may or may not have been applied. Refresh and check the device state before trying again.",
    commandFailedTitle: "Action could not be completed",
    confirmPairing: "Confirm pairing",
    connected: "Connected now",
    denial: "Action denied",
    denials: {
      "body-invalid": "Check the information you entered.",
      "device-not-found": "That device is no longer in the device register.",
      "device-not-revoked":
        "Revoke the device before requesting the release of its seat.",
      "pairing-attempts-exceeded":
        "The pairing session exceeded the permitted join attempts. Start a new session.",
      "pairing-entitlement-missing":
        "The current licence does not include additional POS terminals. Renew the licence or add the seats you need.",
      "pairing-seat-unavailable":
        "No seat is available within the permitted device count. Release a revoked device's seat first.",
      "pairing-session-conflict":
        "A pairing session is already active. Finish or cancel it before starting another.",
      "pairing-session-expired":
        "The pairing session expired. Start a new session.",
      "pairing-session-missing":
        "That pairing session is no longer available. Start a new session.",
      "pairing-session-replayed":
        "The pairing session was reused. The action was stopped and recorded in the audit trail.",
      "pairing-signature-invalid":
        "The terminal's signature could not be verified. Pairing was stopped.",
      "rate-limit-exceeded":
        "Too many attempts in a short time. Wait briefly before trying again.",
      "seat-release-approver-invalid":
        "A seat release must be approved by a different active user who can pair devices, with correct credentials.",
      "seat-release-request-invalid":
        "That seat release request is no longer valid. Start a new request.",
    },
    description:
      "Pair additional POS terminals with this Main Pharmacy Computer and manage their seats and revocation.",
    deviceListTitle: "Paired devices",
    devicesEmpty: "No additional POS terminal is paired yet.",
    expiresIn: "Expires in",
    fingerprintTitle: "Verification number",
    invitationUri: "Invitation link",
    loading: "Loading device status",
    pairedAt: "Paired",
    pairingTitle: "Pair a terminal",
    qrLabel: "Pairing code — scan it with the terminal's scanner",
    qrUnavailable: "The pairing code is not available. Start a new session.",
    requestReference: "Request reference",
    requestSeatRelease: "Request seat release",
    revocationReason: "Revocation reason",
    revoke: "Revoke device",
    revokeDescription:
      "Revocation disconnects the device immediately and ends its sessions. The seat stays reserved until a different user approves its release.",
    revoked: "Revoked",
    revokeSubmit: "Confirm revocation",
    seatReleaseApprovalDescription:
      "A different user who can pair devices must approve this seat release. Enter their credentials on this computer.",
    seatReleaseApprovalTitle: "Approve the seat release",
    seatReleased: "Seat released",
    seatReleasePending: "Waiting for another user's approval",
    seatUsage: "Seats in use",
    seatUsageUnlicensed: "No licence installed",
    sectionsLabel: "Device sections",
    sessionCancelled: {
      "fingerprint-mismatch":
        "The session was cancelled because the verification digits did not match. Check which device tried to connect, then start a new session.",
      "user-cancelled": "The pairing session was cancelled.",
    },
    sessionConfirmed: "The terminal is paired and its certificate was issued.",
    sessionExpired: "The pairing session expired before it completed.",
    sessionFailed: {
      "excess-attempts":
        "The session stopped after too many incorrect join attempts, and this was recorded in the audit trail.",
    },
    sessionNone:
      "No pairing session is active. Starting one requires password confirmation and expires after five minutes.",
    staleData:
      "The device status could not be refreshed and may be out of date. Actions stay unavailable until it refreshes.",
    startAgain: "Start a new session",
    startPairing: "Start pairing",
    terminalName: "Terminal name",
    title: "Additional POS terminals",
    validUntil: "Certificate valid until",
    viewDevices: "View devices",
  },
};
