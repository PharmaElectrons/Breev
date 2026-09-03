import {
  PHARMACY_ROLE_DISPLAY_NAMES,
  type IdentityDenialCode,
  type IdentityRoleReference,
  type PharmacyRoleKey,
} from "@breev/contracts/local-rest";

import type {
  ImplementedPermissionId,
  PermissionGroupId,
} from "./permission-catalogue";
import type { Locale } from "./preferences";

export interface PermissionLabel {
  readonly description: string;
  readonly name: string;
}

export interface IdentityCopy {
  readonly addRole: string;
  readonly addUser: string;
  readonly attendance: string;
  readonly attendanceDisabled: string;
  readonly bootstrapDescription: string;
  readonly bootstrapSubmit: string;
  readonly bootstrapTitle: string;
  readonly builtInRole: string;
  readonly cancel: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly changeMyPassword: string;
  readonly changePasswordDescription: string;
  readonly createRole: string;
  readonly createUser: string;
  readonly currentPassword: string;
  readonly customRole: string;
  readonly customRoleBadge: string;
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
  readonly newRoleTitle: string;
  readonly ownerPermissionFloor: string;
  readonly password: string;
  readonly passwordChanged: string;
  readonly permissionConfiguration: string;
  /** "N of M permissions" for a role row; both numbers are whole counts. */
  readonly permissionCount: (granted: number, total: number) => string;
  readonly permissionGroups: Record<PermissionGroupId, string>;
  readonly permissionLabels: Record<ImplementedPermissionId, PermissionLabel>;
  readonly permissions: string;
  readonly permissionsHelp: string;
  readonly pharmacyName: string;
  readonly ready: string;
  readonly reauthenticate: string;
  readonly reauthenticationDescription: string;
  readonly renameRole: string;
  readonly requestReference: string;
  readonly role: string;
  readonly roleList: string;
  readonly roleName: string;
  readonly roles: Readonly<Record<PharmacyRoleKey, string>>;
  readonly resetPassword: string;
  readonly save: string;
  readonly saveDisplayName: string;
  readonly savePermissions: string;
  readonly saveRole: string;
  readonly selfLockoutWarning: string;
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

/**
 * A built-in role is named by Breev in the user's language; a custom role is
 * named by the pharmacy and shown verbatim in both languages.
 */
export function roleDisplayName(
  role: IdentityRoleReference,
  copy: Pick<IdentityCopy, "roles">,
): string {
  return role.kind === "built-in" ? copy.roles[role.key] : role.name;
}

const permissionLabels: Record<
  Locale,
  Record<ImplementedPermissionId, PermissionLabel>
> = {
  ar: {
    "attendance.record": {
      description: "تسجيل الحضور والانصراف عند تفعيل الحضور اليدوي.",
      name: "تسجيل الحضور",
    },
    "catalog.item.manage": {
      description: "إضافة سجلات الأصناف وتعديل أسمائها وباركوداتها وتعبئتها.",
      name: "إدارة الأصناف",
    },
    "devices.pair": {
      description: "إضافة نقاط بيع إضافية وإبطالها واعتماد تحرير المقاعد.",
      name: "إقران نقاط البيع وإدارتها",
    },
    "identity.roles.manage": {
      description: "إنشاء الأدوار وتحديد ما يمكن لكل دور فعله.",
      name: "إدارة الأدوار والصلاحيات",
    },
    "identity.users.manage": {
      description:
        "إضافة المستخدمين وإعادة تعيين كلمات مرورهم وإيقاف الحسابات وتعيين الأدوار.",
      name: "إدارة المستخدمين",
    },
    "licensing.manage": {
      description: "تثبيت ترخيص الصيدلية أو تجديده أو إزالته.",
      name: "إدارة الترخيص",
    },
    "pharmacy.settings.manage": {
      description:
        "تفعيل تسجيل الحضور أو إيقافه وتغيير إعدادات الصيدلية الأخرى.",
      name: "تغيير إعدادات الصيدلية",
    },
  },
  en: {
    "attendance.record": {
      description: "Check in and check out when manual attendance is enabled.",
      name: "Record attendance",
    },
    "catalog.item.manage": {
      description:
        "Add and edit product records, names, barcodes, and packaging.",
      name: "Manage products",
    },
    "devices.pair": {
      description:
        "Add additional POS terminals, revoke them, and approve seat releases.",
      name: "Pair and manage terminals",
    },
    "identity.roles.manage": {
      description: "Create roles and choose what each role can do.",
      name: "Manage roles and permissions",
    },
    "identity.users.manage": {
      description:
        "Add users, reset their passwords, lock accounts, and assign roles.",
      name: "Manage users",
    },
    "licensing.manage": {
      description: "Install or renew the pharmacy licence, or remove it.",
      name: "Manage the licence",
    },
    "pharmacy.settings.manage": {
      description:
        "Turn attendance on or off and change other pharmacy settings.",
      name: "Change pharmacy settings",
    },
  },
};

export const identityMessages: Record<Locale, IdentityCopy> = {
  ar: {
    addRole: "إضافة دور",
    addUser: "إضافة مستخدم",
    attendance: "الحضور",
    attendanceDisabled: "تسجيل الحضور غير مفعّل.",
    bootstrapDescription:
      "أنشئ الصيدلية وحساب المالك الأول مرة واحدة. لا توجد بيانات دخول افتراضية.",
    bootstrapSubmit: "إنشاء الصيدلية والمالك",
    bootstrapTitle: "إعداد الصيدلية",
    builtInRole: "دور أساسي من بريف",
    cancel: "إلغاء",
    checkIn: "تسجيل الحضور",
    checkOut: "تسجيل الانصراف",
    changeMyPassword: "تغيير كلمة مروري",
    changePasswordDescription:
      "أدخل كلمة مرورك الحالية، ثم اختر كلمة مرور جديدة.",
    createRole: "إنشاء الدور",
    createUser: "إنشاء المستخدم",
    currentPassword: "كلمة المرور الحالية",
    customRole: "دور مخصص لهذه الصيدلية",
    customRoleBadge: "مخصص",
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
      "role-name-reserved":
        "هذا الاسم محجوز لدور أساسي. اختر اسماً آخر للدور المخصص.",
      "role-name-taken": "يوجد دور بهذا الاسم بالفعل.",
      "role-not-custom": "لا يمكن إعادة تسمية الأدوار الأساسية.",
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
    newRoleTitle: "دور جديد",
    ownerPermissionFloor:
      "يجب أن يحتفظ دور المالك بصلاحيتي إدارة الأدوار والمستخدمين.",
    password: "كلمة المرور",
    passwordChanged: "تم تغيير كلمة المرور.",
    permissionConfiguration: "إعداد صلاحيات الأدوار",
    permissionCount: (granted, total) =>
      `${new Intl.NumberFormat("ar-IQ").format(granted)} من ${new Intl.NumberFormat("ar-IQ").format(total)} صلاحيات`,
    permissionGroups: {
      administration: "الإدارة",
      attendance: "الحضور",
      "devices-licensing": "الأجهزة والترخيص",
      products: "الأصناف",
    },
    permissionLabels: permissionLabels.ar,
    permissions: "الصلاحيات الممنوحة",
    permissionsHelp:
      "تتحكم الصلاحيات فيما يمكن لأعضاء هذا الدور فعله. يحصل كل مستخدم مُعيَّن على الدور على الصلاحيات نفسها. تبقى مزايا الخطة منفصلة عن صلاحيات المستخدم.",
    pharmacyName: "اسم الصيدلية",
    ready: "نشط",
    reauthenticate: "تأكيد كلمة المرور",
    reauthenticationDescription:
      "هذا إجراء حساس. أدخل كلمة مرور حسابك الحالي لإكماله.",
    renameRole: "إعادة تسمية الدور",
    requestReference: "مرجع الطلب",
    role: "الدور",
    roleList: "الأدوار",
    roleName: "اسم الدور",
    roles: PHARMACY_ROLE_DISPLAY_NAMES.ar,
    resetPassword: "إعادة تعيين كلمة المرور",
    save: "حفظ",
    saveDisplayName: "حفظ الاسم",
    savePermissions: "حفظ الصلاحيات",
    saveRole: "حفظ الدور",
    selfLockoutWarning:
      "أنت تزيل إدارة الأدوار من دورك أنت. بعد الحفظ لن تتمكن من فتح هذه الشاشة مرة أخرى.",
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
    addRole: "Add role",
    addUser: "Add user",
    attendance: "Attendance",
    attendanceDisabled: "Manual attendance is not enabled.",
    bootstrapDescription:
      "Create the pharmacy and its first owner once. There are no default credentials.",
    bootstrapSubmit: "Create pharmacy and owner",
    bootstrapTitle: "Set up this pharmacy",
    builtInRole: "Built-in Breev role",
    cancel: "Cancel",
    checkIn: "Check in",
    checkOut: "Check out",
    changeMyPassword: "Change my password",
    changePasswordDescription:
      "Enter your current password, then choose a new password.",
    createRole: "Create role",
    createUser: "Create user",
    currentPassword: "Current password",
    customRole: "Custom role of this pharmacy",
    customRoleBadge: "Custom",
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
      "role-name-reserved":
        "That name is reserved for a built-in role. Choose another name for the custom role.",
      "role-name-taken": "A role with that name already exists.",
      "role-not-custom": "Built-in roles cannot be renamed.",
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
    newRoleTitle: "New role",
    ownerPermissionFloor:
      "The owner role must keep role and user management permissions.",
    password: "Password",
    passwordChanged: "Password changed.",
    permissionConfiguration: "Configure role permissions",
    permissionCount: (granted, total) => `${granted} of ${total} permissions`,
    permissionGroups: {
      administration: "Administration",
      attendance: "Attendance",
      "devices-licensing": "Devices and licensing",
      products: "Products",
    },
    permissionLabels: permissionLabels.en,
    permissions: "Granted permissions",
    permissionsHelp:
      "Permissions control what members of this role can do. Every user assigned to the role receives the same permissions. Plan entitlements remain separate from user authority.",
    pharmacyName: "Pharmacy name",
    ready: "Active",
    reauthenticate: "Confirm password",
    reauthenticationDescription:
      "This is a sensitive action. Enter the password for your current account to continue.",
    renameRole: "Rename role",
    requestReference: "Request reference",
    role: "Role",
    roleList: "Roles",
    roleName: "Role name",
    roles: PHARMACY_ROLE_DISPLAY_NAMES.en,
    resetPassword: "Reset password",
    save: "Save",
    saveDisplayName: "Save name",
    savePermissions: "Save permissions",
    saveRole: "Save role",
    selfLockoutWarning:
      "You are removing role management from your own role. After saving, you will no longer be able to open this screen.",
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
