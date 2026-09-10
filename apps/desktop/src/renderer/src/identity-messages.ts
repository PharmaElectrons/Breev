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
  readonly roleDescriptions: Readonly<Record<PharmacyRoleKey, string>>;
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
    "catalog.item.search": {
      description:
        "البحث الفوري عن الأصناف بالاسم العربي أو الإنجليزي أو الباركود.",
      name: "البحث عن الأصناف",
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
    "inventory.review": {
      description: "مراجعة الرصيد والحركات والمخاطر دون تعديل المخزون.",
      name: "مراجعة المخزون",
    },
    "inventory.valuation.view": {
      description: "عرض قيمة المخزون ومتوسط التكلفة وبيانات المورد الحساسة.",
      name: "عرض تقييم المخزون",
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
    "purchases.adjustments.manage": {
      description:
        "إنشاء تصحيحات فواتير الشراء ومراجعة فروقها وترحيلها دون تغيير الأصل.",
      name: "إدارة تصحيحات فواتير الشراء",
    },
    "purchases.drafts.manage": {
      description:
        "إنشاء مسودات المشتريات واستئنافها وتحديثها واستبعادها وإدخال بنودها.",
      name: "إدارة مسودات المشتريات",
    },
    "purchases.posted.view": {
      description: "البحث في فواتير الشراء المُرحّلة وفتح نسخها التاريخية.",
      name: "عرض المشتريات المُرحّلة",
    },
    "purchases.returns.manage": {
      description:
        "إنشاء مرتجعات شراء للبضاعة التي غادرت الصيدلية ومراجعتها وترحيلها.",
      name: "إدارة مرتجعات المشتريات",
    },
    "purchases.costs.view": {
      description:
        "عرض تكلفة المورد الأساسية والتكلفة بعد الخصم في سجل المشتريات.",
      name: "عرض تكاليف المشتريات",
    },
    "suppliers.manage": {
      description:
        "إنشاء سجلات الموردين وتعديلها وأرشفتها ودمجها وإدارة شروطها.",
      name: "إدارة الموردين",
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
    "catalog.item.search": {
      description:
        "Instantly find products by Arabic name, English name, or barcode.",
      name: "Search products",
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
    "inventory.review": {
      description:
        "Review balances, movements, and risks without changing stock.",
      name: "Review inventory",
    },
    "inventory.valuation.view": {
      description:
        "View inventory value, average cost, and sensitive supplier data.",
      name: "View inventory valuation",
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
    "purchases.adjustments.manage": {
      description:
        "Create, review, and post purchase invoice Deltas without changing the original.",
      name: "Manage purchase adjustments",
    },
    "purchases.drafts.manage": {
      description:
        "Create, resume, update, and discard purchase drafts and enter their rows.",
      name: "Manage purchase drafts",
    },
    "purchases.posted.view": {
      description:
        "Search posted purchase invoices and open historical copies.",
      name: "View posted purchases",
    },
    "purchases.returns.manage": {
      description:
        "Create, review, and post purchase returns for goods that physically left the pharmacy.",
      name: "Manage purchase returns",
    },
    "purchases.costs.view": {
      description:
        "View Primary Supplier Cost and Cost After Discount in purchase history.",
      name: "View purchase costs",
    },
    "suppliers.manage": {
      description:
        "Create, edit, archive, and merge supplier records and maintain their terms.",
      name: "Manage suppliers",
    },
  },
};

const roleDescriptions: Record<
  Locale,
  Readonly<Record<PharmacyRoleKey, string>>
> = {
  ar: {
    owner: "الإدارة الكاملة للصيدلية عبر جميع عمليات بريف المتاحة.",
    manager: "الإشراف على أدوار الموظفين وعمليات الصيدلية المفوضة.",
    pharmacist: "العمل على صرف الأدوية ومهام الصيدلة السريرية.",
    sales_employee: "العمل على نقطة البيع ومهام مبيعات العملاء.",
    purchasing_employee: "إنشاء مسودات المشتريات للمخزون الوارد ومتابعتها.",
    inventory_employee: "العمل على سجلات المخزون والجرد وحركات المخزون.",
    accountant: "العمل على الحسابات والمراجعة المالية للصيدلية.",
    support: "تقديم الدعم التشغيلي المحلي بالصلاحيات الممنوحة صراحة فقط.",
  },
  en: {
    owner:
      "Full pharmacy administration across every implemented Breev operation.",
    manager: "Oversees staff roles and delegated pharmacy operations.",
    pharmacist: "Works with dispensing and clinical pharmacy workflows.",
    sales_employee: "Works with checkout and customer sales workflows.",
    purchasing_employee:
      "Creates and maintains purchase drafts for incoming stock.",
    inventory_employee:
      "Works with stock records, counts, and inventory movement workflows.",
    accountant:
      "Works with pharmacy accounting and financial review workflows.",
    support:
      "Provides local operational support with only explicitly granted access.",
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
      "owner-role-required": "يجب أن يكون حسابك حساب المالك لهذا التصدير.",
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
      purchasing: "المشتريات والموردون",
      inventory: "المخزون",
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
    roleDescriptions: roleDescriptions.ar,
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
      "owner-role-required": "Only the owner account can run this export.",
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
      purchasing: "Purchasing and suppliers",
      inventory: "Inventory",
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
    roleDescriptions: roleDescriptions.en,
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
