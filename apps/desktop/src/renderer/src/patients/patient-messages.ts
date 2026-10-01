import type { Locale } from "../preferences.js";

export interface PatientCopy {
  readonly title: string;
  readonly description: string;
  readonly searchPlaceholder: string;
  readonly searchLabel: string;
  readonly searchButton: string;
  readonly searchDenied: string;
  readonly searchUnavailable: string;
  readonly searchResults: string;
  readonly searchPagination: string;
  readonly emptyResults: string;
  readonly emptyList: string;
  readonly loading: string;
  readonly createPatient: string;
  readonly save: string;
  readonly update: string;
  readonly cancel: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveUnavailable: string;
  readonly profileNotFound: string;
  readonly profileLoadError: string;
  readonly loadingLatest: string;
  readonly conflictReconciled: string;
  readonly nameRequired: string;
  readonly allergyRequired: string;
  readonly permissionDenied: string;
  readonly createHeading: string;
  readonly editHeading: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly phone: string;
  readonly address: string;
  readonly email: string;
  readonly gender: string;
  readonly male: string;
  readonly female: string;
  readonly dateOfBirth: string;
  readonly age: string;
  readonly years: string;
  readonly otherNotes: string;
  readonly discountPercent: string;
  readonly dnd: string;
  readonly chronicConditions: string;
  readonly chronicMedications: string;
  readonly interests: string;
  readonly profileHeading: string;
  readonly editProfile: string;
  readonly viewProfile: string;
  readonly weightHistoryHeading: string;
  readonly addWeightHeading: string;
  readonly weightKg: string;
  readonly heightCm: string;
  readonly bmi: string;
  readonly addWeight: string;
  readonly weightMeasuredAt: string;
  readonly noHeight: string;
  readonly setHeight: string;
  readonly addCondition: string;
  readonly removeCondition: string;
  readonly bmiCategory: (category: string) => string;
  readonly smoking: string;
  readonly isSmoker: string;
  readonly alcohol: string;
  readonly allergies: string;
  readonly hasAllergy: string;
  readonly sensitivities: string;
  readonly addItem: string;
  readonly removeItem: string;
  readonly unsavedChanges: string;
  readonly conflictError: string;
  readonly idempotencyConflict: string;
  readonly validationFailed: string;
  readonly unknownSaveOutcome: string;
  readonly retrySave: string;
  readonly reloadLatest: string;
  readonly discardChangesTitle: string;
  readonly discardChangesMessage: string;
  readonly keepEditing: string;
  readonly discardChanges: string;
  readonly networkError: string;
  readonly retryAction: string;
  readonly recordedBy: string;
  readonly noWeightMeasurements: string;
  readonly bmiNeedsHeight: string;
  readonly bmiNeedsWeight: string;
  readonly bmiAfterSave: string;
  readonly weightHistoryLoadError: string;
  readonly loadMoreWeights: string;
  readonly loadingWeights: string;
  readonly timeZoneUnavailable: string;
  readonly setHeightFirst: string;
  readonly page: string;
  readonly of: string;
  readonly previous: string;
  readonly next: string;
  readonly totalPatients: string;
  readonly notSet: string;
  readonly patientDirectory: string;
  readonly lifestyleAndMedical: string;
  readonly newPatient: string;
  readonly addNewPatient: string;
  readonly addConditionPlaceholder: string;
  readonly addMedicationPlaceholder: string;
  readonly addInterestPlaceholder: string;
  readonly addAllergyPlaceholder: string;
  readonly allergyFamilyLabel: string;
  readonly filterSearchPlaceholder: string;
  readonly biometricsHeading: string;
  readonly identityHeading: string;
  readonly latestWeight: string;
  readonly yes: string;
  readonly no: string;
  readonly dndEnabled: string;
  readonly dndDisabled: string;
  readonly invalidWeightFormat: string;
  readonly invalidHeightFormat: string;
  readonly invalidDiscountFormat: string;
  readonly selectedWeightDetails: (date: string, weight: string) => string;
}

export const patientMessages: Record<Locale, PatientCopy> = {
  ar: {
    title: "المرضى",
    description: "إدارة ملفات المرضى المحليين وسجل أوزانهم.",
    searchPlaceholder: "البحث عن مريض...",
    searchLabel: "البحث بالاسم أو رقم الهاتف",
    searchButton: "بحث",
    searchDenied: "لا تملك صلاحية البحث في ملفات المرضى.",
    searchUnavailable: "تعذّر إجراء البحث. تحقق من الاتصال وحاول مرة أخرى.",
    searchResults: "نتائج المرضى",
    searchPagination: "صفحات نتائج البحث",
    emptyResults: "لا توجد نتائج مطابقة.",
    emptyList: "أنشئ أول ملف مريض.",
    loading: "جارٍ التحميل…",
    createPatient: "إضافة مريض",
    save: "حفظ",
    update: "تحديث",
    cancel: "إلغاء",
    saving: "جارٍ حفظ الملف…",
    saved: "تم حفظ الملف.",
    saveUnavailable: "تعذّر حفظ الملف. تحقق من الاتصال ثم حاول مرة أخرى.",
    profileNotFound: "لم يعد ملف المريض متاحاً.",
    profileLoadError: "تعذّر تحميل ملف المريض.",
    loadingLatest: "جارٍ تحميل النسخة الأحدث…",
    conflictReconciled: "تم تحميل النسخة الأحدث. يمكنك حفظ تعديلاتك الآن.",
    nameRequired: "الاسم الأول واسم العائلة مطلوبان.",
    allergyRequired: "أضف نوع الحساسية أو وصفها قبل الحفظ.",
    permissionDenied: "لا تملك صلاحية الوصول إلى ملفات المرضى.",
    createHeading: "تسجيل مريض جديد",
    editHeading: "تعديل بيانات المريض",
    firstName: "الاسم الأول",
    lastName: "اسم العائلة",
    fullName: "اسم المريض",
    phone: "رقم الهاتف",
    address: "العنوان",
    email: "البريد الإلكتروني",
    gender: "الجنس",
    male: "ذكر",
    female: "أنثى",
    dateOfBirth: "الميلاد",
    age: "العمر",
    years: "سنة",
    otherNotes: "ملاحظات عامة",
    discountPercent: "نسبة الخصم",
    dnd: "عدم الإزعاج",
    chronicConditions: "الأمراض المزمنة",
    chronicMedications: "الأدوية المزمنة",
    interests: "الاهتمامات",
    profileHeading: "الملف الشخصي",
    editProfile: "تعديل",
    viewProfile: "عرض",
    weightHistoryHeading: "سجل الأوزان",
    addWeightHeading: "إضافة وزن جديد",
    weightKg: "الوزن (كجم)",
    heightCm: "الطول (سم)",
    bmi: "BMI",
    addWeight: "حفظ",
    weightMeasuredAt: "تاريخ ووقت القياس",
    noHeight: "أدخل الطول أولاً",
    setHeight: "تحديد الطول",
    addCondition: "إضافة",
    removeCondition: "إزالة",
    bmiCategory: (category) => {
      switch (category) {
        case "underweight":
          return "نقص الوزن";
        case "normal":
          return "طبيعي";
        case "overweight":
          return "زيادة الوزن";
        case "obese":
          return "سمنة";
        default:
          return category;
      }
    },
    smoking: "التدخين",
    isSmoker: "مدخن",
    alcohol: "الكحول",
    allergies: "الحساسية",
    hasAllergy: "حساسية",
    sensitivities: "التحذيرات والحساسيات الطبية",
    addItem: "إضافة",
    removeItem: "إزالة",
    unsavedChanges: "توجد تعديلات غير محفوظة. هل تريد المغادرة وتجاهلها؟",
    conflictError:
      "تم تعديل هذا السجل من جلسة أخرى. يرجى إعادة التحميل والمحاولة مجدداً.",
    idempotencyConflict:
      "تعارض مفتاح الحفظ مع طلب سابق. احتفظنا بالبيانات المدخلة؛ تحقق من نتيجة الحفظ السابق قبل بدء حفظ جديد.",
    validationFailed: "تحقق من الحقول المحددة ثم حاول الحفظ مرة أخرى.",
    unknownSaveOutcome:
      "لم يصل تأكيد الحفظ. أعد المحاولة لإكمال التحقق بأمان قبل إجراء تغييرات أخرى.",
    retrySave: "إعادة محاولة الحفظ",
    reloadLatest: "تحميل آخر نسخة مع الاحتفاظ بتعديلاتي",
    discardChangesTitle: "تجاهل التعديلات؟",
    discardChangesMessage: "ستُفقد التعديلات التي لم تحفظها.",
    keepEditing: "متابعة التعديل",
    discardChanges: "تجاهل التعديلات",
    networkError:
      "تعذر الاتصال بالخادم. يرجى التحقق من الاتصال والمحاولة مجدداً.",
    retryAction: "إعادة المحاولة",
    recordedBy: "بواسطة",
    noWeightMeasurements: "لا توجد قياسات وزن مسجلة — أضف أول قياس وزن.",
    bmiNeedsHeight: "أضف الطول لعرض مؤشر كتلة الجسم.",
    bmiNeedsWeight: "أضف قياس وزن لعرض مؤشر كتلة الجسم.",
    bmiAfterSave: "يظهر مؤشر كتلة الجسم بعد حفظ البيانات.",
    weightHistoryLoadError: "تعذّر تحميل سجل الأوزان.",
    loadMoreWeights: "عرض قياسات أقدم",
    loadingWeights: "جارٍ تحميل القياسات…",
    timeZoneUnavailable: "تعذّر عرض وقت القياس في المنطقة الزمنية للصيدلية.",
    setHeightFirst: "حدد الطول أولاً لعرض مؤشر كتلة الجسم.",
    page: "صفحة",
    of: "من",
    previous: "السابق",
    next: "التالي",
    totalPatients: "إجمالي المرضى",
    notSet: "—",
    patientDirectory: "دليل المرضى",
    lifestyleAndMedical: "المؤشرات السلوكية والطبية",
    newPatient: "+ مريض جديد",
    addNewPatient: "تسجيل مريض جديد",
    addConditionPlaceholder: "+ مرض",
    addMedicationPlaceholder: "+ دواء",
    addInterestPlaceholder: "+ اهتمام",
    addAllergyPlaceholder: "ابحث أو أضف مادة مسببة للحساسية...",
    allergyFamilyLabel: "نوع الحساسية / عائلة الدواء",
    filterSearchPlaceholder: "ابحث عن مريض بالاسم أو الهاتف...",
    biometricsHeading: "القياسات الحيوية",
    identityHeading: "بيانات الهوية والاتصال",
    latestWeight: "آخر قيمة",
    yes: "نعم",
    no: "لا",
    dndEnabled: "نعم",
    dndDisabled: "لا",
    invalidWeightFormat:
      "الوزن يجب أن يكون رقماً بين 0.1 و 700.0 كجم (بحد أقصى منزلة عشرية واحدة)",
    invalidHeightFormat:
      "الطول يجب أن يكون رقماً بين 0.1 و 300.0 سم (بحد أقصى منزلة عشرية واحدة)",
    invalidDiscountFormat:
      "نسبة الخصم يجب أن تكون بين 0 و 100.00% (بحد أقصى منزلتين عشريتين)",
    selectedWeightDetails: (date, weight) =>
      `قياس محدد: ${weight} كجم (${date})`,
  },
  en: {
    title: "Patients",
    description: "Manage local patient profiles and weight history.",
    searchPlaceholder: "Search for a patient...",
    searchLabel: "Search by name or phone",
    searchButton: "Search",
    searchDenied: "You do not have permission to search patient profiles.",
    searchUnavailable:
      "Search is unavailable. Check the connection and try again.",
    searchResults: "Patient search results",
    searchPagination: "Search result pages",
    emptyResults: "No patients found.",
    emptyList: "Create your first patient.",
    loading: "Loading…",
    createPatient: "Add patient",
    save: "Save",
    update: "Update",
    cancel: "Cancel",
    saving: "Saving profile…",
    saved: "Profile saved.",
    saveUnavailable:
      "Profile could not be saved. Check the connection and retry.",
    profileNotFound: "This patient profile is no longer available.",
    profileLoadError: "Patient profile could not be loaded.",
    loadingLatest: "Loading the latest version…",
    conflictReconciled:
      "Latest version loaded. Your changes are ready to save.",
    nameRequired: "First and last name are required.",
    allergyRequired: "Add an allergy type or description before saving.",
    permissionDenied: "You do not have permission to access patient profiles.",
    createHeading: "Register new patient",
    editHeading: "Edit patient",
    firstName: "First name",
    lastName: "Last name",
    fullName: "Patient name",
    phone: "Phone number",
    address: "Address",
    email: "Email",
    gender: "Gender",
    male: "Male",
    female: "Female",
    dateOfBirth: "DOB",
    age: "Age",
    years: "years",
    otherNotes: "General notes",
    discountPercent: "Discount percent",
    dnd: "Do not disturb",
    chronicConditions: "Chronic conditions",
    chronicMedications: "Chronic medications",
    interests: "Interests",
    profileHeading: "Profile",
    editProfile: "Edit",
    viewProfile: "View",
    weightHistoryHeading: "Weight history",
    addWeightHeading: "Add weight measurement",
    weightKg: "Weight (kg)",
    heightCm: "Height (cm)",
    bmi: "BMI",
    addWeight: "Save",
    weightMeasuredAt: "Date and time",
    noHeight: "Enter height first",
    setHeight: "Set height",
    addCondition: "Add",
    removeCondition: "Remove",
    bmiCategory: (category) => {
      switch (category) {
        case "underweight":
          return "Underweight";
        case "normal":
          return "Normal weight";
        case "overweight":
          return "Overweight";
        case "obese":
          return "Obese";
        default:
          return category;
      }
    },
    smoking: "Smoking",
    isSmoker: "Smoker",
    alcohol: "Alcohol",
    allergies: "Allergies",
    hasAllergy: "Allergy",
    sensitivities: "Sensitivities & medical warnings",
    addItem: "Add",
    removeItem: "Remove",
    unsavedChanges: "You have unsaved changes. Do you want to discard them?",
    conflictError:
      "This record was modified in another session. Please reload and try again.",
    idempotencyConflict:
      "This save key conflicts with an earlier command. Your input is preserved; check the earlier save before starting a new one.",
    validationFailed: "Check the marked fields and try saving again.",
    unknownSaveOutcome:
      "The save was not confirmed. Retry this save to safely check its result before making other changes.",
    retrySave: "Retry save",
    reloadLatest: "Load the latest version and keep my changes",
    discardChangesTitle: "Discard changes?",
    discardChangesMessage: "Unsaved changes will be lost.",
    keepEditing: "Keep editing",
    discardChanges: "Discard changes",
    networkError:
      "Unable to connect to the server. Please check connection and try again.",
    retryAction: "Retry",
    recordedBy: "Recorded by",
    noWeightMeasurements:
      "No weight measurements recorded — add the first weight.",
    bmiNeedsHeight: "Add height to show BMI.",
    bmiNeedsWeight: "Add a weight measurement to show BMI.",
    bmiAfterSave: "BMI appears after the changes are saved.",
    weightHistoryLoadError: "Weight history could not be loaded.",
    loadMoreWeights: "Show older measurements",
    loadingWeights: "Loading measurements…",
    timeZoneUnavailable:
      "The measurement time could not be shown in the pharmacy time zone.",
    setHeightFirst: "Set height first to calculate BMI.",
    page: "Page",
    of: "of",
    previous: "Previous",
    next: "Next",
    totalPatients: "Total patients",
    notSet: "—",
    patientDirectory: "Patient Directory",
    lifestyleAndMedical: "Behavioral & Medical Indicators",
    newPatient: "+ New Patient",
    addNewPatient: "Register New Patient",
    addConditionPlaceholder: "+ condition",
    addMedicationPlaceholder: "+ medication",
    addInterestPlaceholder: "+ interest",
    addAllergyPlaceholder: "Search or add allergy...",
    allergyFamilyLabel: "Allergy type / drug family",
    filterSearchPlaceholder: "Search patient by name or phone...",
    biometricsHeading: "Biometrics",
    identityHeading: "Identity & Contact",
    latestWeight: "Latest",
    yes: "Yes",
    no: "No",
    dndEnabled: "Yes",
    dndDisabled: "No",
    invalidWeightFormat:
      "Weight must be a number between 0.1 and 700.0 kg (up to 1 decimal place)",
    invalidHeightFormat:
      "Height must be a number between 0.1 and 300.0 cm (up to 1 decimal place)",
    invalidDiscountFormat:
      "Discount must be between 0 and 100.00% (up to 2 decimal places)",
    selectedWeightDetails: (date, weight) => `Selected: ${weight} kg (${date})`,
  },
};
