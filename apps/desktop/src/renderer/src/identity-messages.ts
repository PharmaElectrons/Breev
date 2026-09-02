import type {
  IdentityDenialCode,
  PharmacyRoleKey,
} from "@breev/contracts/local-rest";

import type { Locale } from "./preferences";

export interface IdentityCopy {
  readonly addUser: string;
  readonly attendance: string;
  readonly attendanceDisabled: string;
  readonly bootstrapDescription: string;
  readonly bootstrapSubmit: string;
  readonly bootstrapTitle: string;
  readonly cancel: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly changeMyPassword: string;
  readonly changePasswordDescription: string;
  readonly createUser: string;
  readonly currentPassword: string;
  readonly denial: string;
  readonly denials: Record<IdentityDenialCode, string>;
  readonly displayName: string;
  readonly enableAttendance: string;
  readonly loading: string;
  readonly locked: string;
  readonly lockUser: string;
  readonly loginDescription: string;
  readonly loginSubmit: string;
  readonly loginTitle: string;
  readonly logout: string;
  readonly newPassword: string;
  readonly ownerPermissionFloor: string;
  readonly password: string;
  readonly passwordChanged: string;
  readonly permissionConfiguration: string;
  readonly permissions: string;
  readonly pharmacyName: string;
  readonly ready: string;
  readonly reauthenticate: string;
  readonly reauthenticationDescription: string;
  readonly requestReference: string;
  readonly role: string;
  readonly roles: Record<PharmacyRoleKey, string>;
  readonly resetPassword: string;
  readonly save: string;
  readonly saveDisplayName: string;
  readonly sessionExpiredDescription: string;
  readonly sessionExpiredTitle: string;
  readonly sessionRevokedDescription: string;
  readonly sessionRevokedTitle: string;
  readonly settings: string;
  readonly status: string;
  readonly stepUpApproved: string;
  readonly unlockUser: string;
  readonly userCreated: string;
  readonly userManagement: string;
  readonly username: string;
  readonly welcome: string;
}

const roleNames: Record<Locale, Record<PharmacyRoleKey, string>> = {
  ar: {
    owner: "المالك",
    manager: "المدير",
    pharmacist: "الصيدلي",
    sales_employee: "موظف المبيعات",
    purchasing_employee: "موظف المشتريات",
    inventory_employee: "موظف المخزون",
    accountant: "المحاسب",
    support: "الدعم المحلي",
  },
  en: {
    owner: "Owner",
    manager: "Manager",
    pharmacist: "Pharmacist",
    sales_employee: "Sales employee",
    purchasing_employee: "Purchasing employee",
    inventory_employee: "Inventory employee",
    accountant: "Accountant",
    support: "Local support",
  },
};

export const identityMessages: Record<Locale, IdentityCopy> = {
  ar: {
    addUser: "إضافة مستخدم",
    attendance: "الحضور",
    attendanceDisabled: "تسجيل الحضور غير مفعّل.",
    bootstrapDescription:
      "أنشئ الصيدلية وحساب المالك الأول مرة واحدة. لا توجد بيانات دخول افتراضية.",
    bootstrapSubmit: "إنشاء الصيدلية والمالك",
    bootstrapTitle: "إعداد الصيدلية",
    cancel: "إلغاء",
    checkIn: "تسجيل الحضور",
    checkOut: "تسجيل الانصراف",
    changeMyPassword: "تغيير كلمة مروري",
    changePasswordDescription:
      "أدخل كلمة مرورك الحالية، ثم اختر كلمة مرور جديدة.",
    createUser: "إنشاء المستخدم",
    currentPassword: "كلمة المرور الحالية",
    denial: "تم رفض الإجراء",
    denials: {
      "attendance-already-checked-in": "تم تسجيل حضورك بالفعل.",
      "attendance-already-checked-out": "تم تسجيل انصرافك بالفعل.",
      "attendance-disabled": "تسجيل الحضور غير مفعّل.",
      "body-invalid": "تحقق من البيانات المدخلة.",
      "bootstrap-already-complete": "تم إعداد هذه الصيدلية بالفعل.",
      "bootstrap-required": "يلزم إعداد الصيدلية أولاً.",
      "identity-resource-not-found": "لم يعد السجل المطلوب متاحاً.",
      "idempotency-conflict": "أُعيد استخدام مرجع الطلب لإجراء مختلف.",
      "invalid-credentials": "اسم المستخدم أو كلمة المرور غير صحيحة.",
      "last-owner-required": "يجب أن يبقى مالك نشط واحد على الأقل.",
      "owner-permission-floor-required":
        "يجب أن يحتفظ دور المالك بصلاحيتي إدارة الأدوار والمستخدمين.",
      "permission-denied": "لا يملك حسابك الإذن المطلوب.",
      "rate-limit-exceeded": "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
      "session-expired": "انتهت الجلسة. سجل الدخول مرة أخرى.",
      "session-missing": "يلزم تسجيل الدخول للمتابعة.",
      "session-revoked": "تم إنهاء الجلسة. سجل الدخول مرة أخرى.",
      "step-up-context-mismatch": "طلب التحقق مرتبط بمستخدم أو جلسة أخرى.",
      "step-up-expired": "انتهت مهلة التحقق الفوري. ابدأ من جديد.",
      "step-up-missing-permission": "لا يملك حسابك الإذن المطلوب لهذا الإجراء.",
      "step-up-not-approved": "أكمل التحقق الفوري أولاً.",
      "step-up-reused": "تم استخدام طلب التحقق بالفعل.",
      "step-up-stale": "تغيرت الصلاحيات أو البيانات. ابدأ التحقق من جديد.",
      "step-up-wrong-password": "كلمة المرور غير صحيحة.",
      "username-taken": "اسم المستخدم مستخدم بالفعل.",
      "version-conflict": "تغيرت البيانات. راجع أحدث حالة ثم حاول مرة أخرى.",
    },
    displayName: "الاسم المعروض",
    enableAttendance: "تفعيل تسجيل الحضور والانصراف اليدوي",
    loading: "جارٍ التحقق من الهوية",
    locked: "موقوف",
    lockUser: "إيقاف المستخدم",
    loginDescription: "استخدم اسم المستخدم وكلمة المرور الخاصة بك.",
    loginSubmit: "تسجيل الدخول",
    loginTitle: "تسجيل الدخول إلى بريف",
    logout: "تسجيل الخروج",
    newPassword: "كلمة المرور الجديدة",
    ownerPermissionFloor:
      "يجب أن يحتفظ دور المالك بصلاحيتي إدارة الأدوار والمستخدمين.",
    password: "كلمة المرور",
    passwordChanged: "تم تغيير كلمة المرور.",
    permissionConfiguration: "إعداد صلاحيات الأدوار",
    permissions: "الصلاحيات الممنوحة",
    pharmacyName: "اسم الصيدلية",
    ready: "نشط",
    reauthenticate: "تأكيد كلمة المرور",
    reauthenticationDescription:
      "هذا إجراء حساس. أدخل كلمة مرور حسابك الحالي لإكماله.",
    requestReference: "مرجع الطلب",
    role: "الدور",
    roles: roleNames.ar,
    resetPassword: "إعادة تعيين كلمة المرور",
    save: "حفظ",
    saveDisplayName: "حفظ الاسم",
    sessionExpiredDescription: "انتهت مدة الجلسة المحلية الآمنة.",
    sessionExpiredTitle: "انتهت الجلسة",
    sessionRevokedDescription: "لم تعد هذه الجلسة مخولة للعمل.",
    sessionRevokedTitle: "تم إنهاء الجلسة",
    settings: "إعدادات الصيدلية",
    status: "الحالة",
    stepUpApproved: "تم تأكيد الهوية لهذا الإجراء.",
    unlockUser: "إعادة تفعيل المستخدم",
    userCreated: "تم إنشاء المستخدم.",
    userManagement: "إدارة المستخدمين",
    username: "اسم المستخدم",
    welcome: "مرحباً",
  },
  en: {
    addUser: "Add user",
    attendance: "Attendance",
    attendanceDisabled: "Manual attendance is not enabled.",
    bootstrapDescription:
      "Create the pharmacy and its first owner once. There are no default credentials.",
    bootstrapSubmit: "Create pharmacy and owner",
    bootstrapTitle: "Set up this pharmacy",
    cancel: "Cancel",
    checkIn: "Check in",
    checkOut: "Check out",
    changeMyPassword: "Change my password",
    changePasswordDescription:
      "Enter your current password, then choose a new password.",
    createUser: "Create user",
    currentPassword: "Current password",
    denial: "Action denied",
    denials: {
      "attendance-already-checked-in": "You are already checked in.",
      "attendance-already-checked-out": "You are already checked out.",
      "attendance-disabled": "Manual attendance is not enabled.",
      "body-invalid": "Check the information you entered.",
      "bootstrap-already-complete": "This pharmacy is already set up.",
      "bootstrap-required": "Set up the pharmacy first.",
      "identity-resource-not-found":
        "The requested record is no longer available.",
      "idempotency-conflict":
        "That request reference was already used for another command.",
      "invalid-credentials": "The username or password is incorrect.",
      "last-owner-required": "At least one active owner must remain.",
      "owner-permission-floor-required":
        "The owner role must keep role and user management permissions.",
      "permission-denied":
        "Your account does not have the required permission.",
      "rate-limit-exceeded":
        "Too many attempts. Wait briefly before trying again.",
      "session-expired": "Your session expired. Sign in again.",
      "session-missing": "Sign in to continue.",
      "session-revoked": "Your session ended. Sign in again.",
      "step-up-context-mismatch":
        "This verification belongs to another user or session.",
      "step-up-expired": "Immediate verification expired. Start again.",
      "step-up-missing-permission":
        "Your account lacks permission for this action.",
      "step-up-not-approved": "Complete immediate verification first.",
      "step-up-reused": "This verification has already been used.",
      "step-up-stale": "Permissions or data changed. Start verification again.",
      "step-up-wrong-password": "The password is incorrect.",
      "username-taken": "That username is already in use.",
      "version-conflict":
        "The data changed. Review the latest state and try again.",
    },
    displayName: "Display name",
    enableAttendance: "Enable manual check-in and check-out",
    loading: "Checking identity",
    locked: "Locked",
    lockUser: "Lock user",
    loginDescription: "Use your own username and password.",
    loginSubmit: "Sign in",
    loginTitle: "Sign in to Breev",
    logout: "Sign out",
    newPassword: "New password",
    ownerPermissionFloor:
      "The owner role must keep role and user management permissions.",
    password: "Password",
    passwordChanged: "Password changed.",
    permissionConfiguration: "Configure role permissions",
    permissions: "Granted permissions",
    pharmacyName: "Pharmacy name",
    ready: "Active",
    reauthenticate: "Confirm password",
    reauthenticationDescription:
      "This is a sensitive action. Enter the password for your current account to continue.",
    requestReference: "Request reference",
    role: "Role",
    roles: roleNames.en,
    resetPassword: "Reset password",
    save: "Save",
    saveDisplayName: "Save name",
    sessionExpiredDescription:
      "The secure local session reached its time limit.",
    sessionExpiredTitle: "Session expired",
    sessionRevokedDescription: "This session is no longer authorized to work.",
    sessionRevokedTitle: "Session ended",
    settings: "Pharmacy settings",
    status: "Status",
    stepUpApproved: "Identity confirmed for this action.",
    unlockUser: "Reactivate user",
    userCreated: "User created.",
    userManagement: "User management",
    username: "Username",
    welcome: "Welcome",
  },
};
