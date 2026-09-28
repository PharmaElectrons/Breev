/* eslint-disable no-unused-vars */
const { Client } = require("pg");

const PHARMACY_ID = "01a051f7-a562-74f3-a450-fa79e182792a";
const USER_ID = "01a051f7-a569-7684-b5be-55b0dbef6001";
const TERMINAL_DEVICE_ID = "01a05277-d6b7-7d77-adec-f73d1d35ae2d";
const MAIN_DEVICE_ID = "01a051b4-f1e4-7442-a67f-46e5f9b190e5";

const client = new Client({
  connectionString:
    "postgresql://breev_app:app_secret_password@127.0.0.1:5432/breev_local",
});

// Helper to get UUIDv7 from PostgreSQL
async function getUuidv7() {
  const res = await client.query("SELECT uuidv7() as id");
  return res.rows[0].id;
}

const SUPPLIERS_DATA = [
  {
    name: "مكتب النهرين العلمي للأدوية",
    phone: "07701234567",
    address: "بغداد - شارع السعدون - مجمع النهرين الطبي",
    paymentTerms: "credit",
    creditLimit: 50000000,
    duePeriodDays: 30,
    alertWindowDays: 7,
    allowanceRate: 5.0,
  },
  {
    name: "شركة الروان لتجارة وتوزيع الأدوية",
    phone: "07802345678",
    address: "بغداد - الحارثية - شارع الكندي",
    paymentTerms: "credit",
    creditLimit: 75000000,
    duePeriodDays: 45,
    alertWindowDays: 10,
    allowanceRate: 7.5,
  },
  {
    name: "مكتب دجلة للأدوية والمستلزمات الطبية",
    phone: "07503456789",
    address: "أربيل - شارع 60 متري - قرب مستشفى رزكاري",
    paymentTerms: "credit",
    creditLimit: 40000000,
    duePeriodDays: 30,
    alertWindowDays: 7,
    allowanceRate: 6.0,
  },
  {
    name: "مذخر بابل الدوائي المركزي",
    phone: "07814567890",
    address: "بابل - الحلة - حي الصحة",
    paymentTerms: "credit",
    creditLimit: 60000000,
    duePeriodDays: 60,
    alertWindowDays: 14,
    allowanceRate: 8.0,
  },
  {
    name: "مكتب الشفاء لتوزيع المستحضرات الصيدلانية",
    phone: "07715678901",
    address: "البصرة - العشار - شارع الوطن",
    paymentTerms: "cash",
    creditLimit: 25000000,
    duePeriodDays: 15,
    alertWindowDays: 5,
    allowanceRate: 4.5,
  },
];

const PRODUCTS_DATA = [
  // 1. Analgesics & Antipyretics
  {
    tradeName: "Panadol Extra",
    strength: "500 mg / 65 mg",
    dosageForm: "Tablet",
    manufacturer: "GSK",
    arabicSearchName: "بنادول اكسترا باراسيتامول كافيين مسكن الم",
    scientificName: "Paracetamol + Caffeine",
    category: "مسكنات وألم",
    usesPerDay: 3,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 3500000n, // 3,500 IQD
    retailFils: 5000000n, // 5,000 IQD
    margin: 30.0,
    inventoryUnit: "علبة",
    packageUnit: "باكيت (24 حبة)",
    packageRatio: 24,
    barcode: "6281001001011",
    minLevel: 20,
    reorderPoint: 40,
    maxLevel: 200,
    batches: [
      { lot: "LOT-26P01", expiry: "2027-05-15", qty: 65 },
      { lot: "LOT-26P02", expiry: "2028-02-20", qty: 85 },
    ],
  },
  {
    tradeName: "Brufen",
    strength: "400 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Abbott",
    arabicSearchName: "بروفين ايبوبروفين مسكن وخافض حرارة",
    scientificName: "Ibuprofen",
    category: "مسكنات وألم",
    usesPerDay: 3,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "orange",
    wholesaleFils: 2800000n,
    retailFils: 4000000n,
    margin: 30.0,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281001001028",
    minLevel: 15,
    reorderPoint: 30,
    maxLevel: 150,
    // EXPIRED (Aug 2026) to test expired alert
    batches: [{ lot: "LOT-24B11", expiry: "2026-08-10", qty: 18 }],
  },
  {
    tradeName: "Voltaren",
    strength: "50 mg",
    dosageForm: "Enteric-Coated Tablet",
    manufacturer: "Novartis",
    arabicSearchName: "فولتارين ديكلوفيناك مسكن روماتيزم ومفاصل",
    scientificName: "Diclofenac Sodium",
    category: "مسكنات وألم",
    usesPerDay: 2,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "yellow",
    wholesaleFils: 4500000n,
    retailFils: 6500000n,
    margin: 30.7,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281001001035",
    minLevel: 10,
    reorderPoint: 25,
    maxLevel: 100,
    batches: [{ lot: "LOT-26VT1", expiry: "2027-08-15", qty: 60 }],
  },
  {
    tradeName: "Ponstan Forte",
    strength: "500 mg",
    dosageForm: "Tablet",
    manufacturer: "Pfizer",
    arabicSearchName: "بونستان فورت حمض الميفيناميك اسنان ودورة",
    scientificName: "Mefenamic Acid",
    category: "مسكنات وألم",
    usesPerDay: 3,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "yellow",
    wholesaleFils: 3200000n,
    retailFils: 4750000n,
    margin: 32.6,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281001001042",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 90,
    batches: [{ lot: "LOT-26PF1", expiry: "2027-10-20", qty: 45 }],
  },
  {
    tradeName: "Cataflam",
    strength: "50 mg",
    dosageForm: "Sugar-Coated Tablet",
    manufacturer: "Novartis",
    arabicSearchName: "كتافلام ديكلوفيناك بوتاسيوم سريع المفعول",
    scientificName: "Diclofenac Potassium",
    category: "مسكنات وألم",
    usesPerDay: 2,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "red",
    wholesaleFils: 4800000n,
    retailFils: 7000000n,
    margin: 31.4,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281001001059",
    minLevel: 15,
    reorderPoint: 30,
    maxLevel: 120,
    batches: [{ lot: "LOT-26CF1", expiry: "2027-12-10", qty: 70 }],
  },

  // 2. Antibiotics & Antimicrobials
  {
    tradeName: "Augmentin",
    strength: "1 g",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "GSK",
    arabicSearchName: "اوجمنتين اموكسيسيلين كلافولانيك مضاد حيوي واسع",
    scientificName: "Amoxicillin + Clavulanic Acid",
    category: "مضادات حيوية",
    usesPerDay: 2,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "purple",
    wholesaleFils: 9500000n,
    retailFils: 13500000n,
    margin: 29.6,
    inventoryUnit: "علبة",
    packageUnit: "شريط (7 حبات)",
    packageRatio: 7,
    barcode: "6281002001010",
    minLevel: 15,
    reorderPoint: 35,
    maxLevel: 150,
    batches: [
      { lot: "LOT-26A01", expiry: "2027-04-10", qty: 45 },
      { lot: "LOT-26A02", expiry: "2027-11-20", qty: 55 },
    ],
  },
  {
    tradeName: "Amoxil",
    strength: "500 mg",
    dosageForm: "Capsule",
    manufacturer: "GSK",
    arabicSearchName: "اموكسيل اموكسيسيلين كبسول التهابات ومضاد",
    scientificName: "Amoxicillin",
    category: "مضادات حيوية",
    usesPerDay: 3,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "red",
    wholesaleFils: 4000000n,
    retailFils: 6000000n,
    margin: 33.3,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 كبسولات)",
    packageRatio: 10,
    barcode: "6281002001027",
    minLevel: 10,
    reorderPoint: 25,
    maxLevel: 100,
    // NEAR EXPIRY (Nov 15, 2026)
    batches: [{ lot: "LOT-25AX1", expiry: "2026-11-15", qty: 42 }],
  },
  {
    tradeName: "Zithromax",
    strength: "500 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Pfizer",
    arabicSearchName: "زيثروماكس ازيثرومايسين مضاد حيوي 3 حبات",
    scientificName: "Azithromycin",
    category: "مضادات حيوية",
    usesPerDay: 1,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 7500000n,
    retailFils: 11000000n,
    margin: 31.8,
    inventoryUnit: "علبة",
    packageUnit: "باكيت (3 حبات)",
    packageRatio: 3,
    barcode: "6281002001034",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    // NEAR EXPIRY (Nov 28, 2026)
    batches: [{ lot: "LOT-25ZT1", expiry: "2026-11-28", qty: 25 }],
  },
  {
    tradeName: "Ciproxin",
    strength: "500 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Bayer",
    arabicSearchName: "سيبروكسين سيبروفلوكساسين مجاري بولية ومسالك",
    scientificName: "Ciprofloxacin",
    category: "مضادات حيوية",
    usesPerDay: 2,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "purple",
    wholesaleFils: 6000000n,
    retailFils: 8500000n,
    margin: 29.4,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281002001041",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 90,
    batches: [{ lot: "LOT-26CP1", expiry: "2027-09-15", qty: 48 }],
  },
  {
    tradeName: "Flagyl",
    strength: "500 mg",
    dosageForm: "Tablet",
    manufacturer: "Sanofi",
    arabicSearchName: "فلاجيل ميترونيدازول مطهر معوي وبكتيريا وطفيليات",
    scientificName: "Metronidazole",
    category: "مضادات حيوية",
    usesPerDay: 3,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "yellow",
    wholesaleFils: 2500000n,
    retailFils: 3750000n,
    margin: 33.3,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281002001058",
    minLevel: 15,
    reorderPoint: 30,
    maxLevel: 120,
    // EXPIRED (Aug 25, 2026)
    batches: [{ lot: "LOT-24FL1", expiry: "2026-08-25", qty: 24 }],
  },
  {
    tradeName: "Claforan",
    strength: "1 g",
    dosageForm: "Vial Injection",
    manufacturer: "Sanofi",
    arabicSearchName: "كلافوران سيفوتاكسيم ابر فيال وريدي عضلي",
    scientificName: "Cefotaxime",
    category: "مضادات حيوية",
    usesPerDay: 2,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "red",
    wholesaleFils: 3200000n,
    retailFils: 4500000n,
    margin: 28.8,
    inventoryUnit: "فيال",
    packageUnit: "باكيت (10 فيالات)",
    packageRatio: 10,
    barcode: "6281002001065",
    minLevel: 10,
    reorderPoint: 25,
    maxLevel: 100,
    // NEAR EXPIRY (Oct 25, 2026)
    batches: [{ lot: "LOT-25CL1", expiry: "2026-10-25", qty: 32 }],
  },

  // 3. Cardiovascular & Hypertension
  {
    tradeName: "Concor",
    strength: "5 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Merck",
    arabicSearchName: "كونكور بيسوبرولول ضغط دم ونبضات قلب",
    scientificName: "Bisoprolol Fumarate",
    category: "أمراض القلب والضغط",
    usesPerDay: 1,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "green",
    wholesaleFils: 5500000n,
    retailFils: 8000000n,
    margin: 31.2,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281003001019",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    // LOW STOCK: stock = 5 <= reorderPoint 20
    batches: [{ lot: "LOT-26CC1", expiry: "2027-06-15", qty: 5 }],
  },
  {
    tradeName: "Lipitor",
    strength: "20 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Pfizer",
    arabicSearchName: "ليبيتور اتورفاستاتين كولسترول ودهون ثلاثية",
    scientificName: "Atorvastatin Calcium",
    category: "أمراض القلب والضغط",
    usesPerDay: 1,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 16000000n,
    retailFils: 22500000n,
    margin: 28.8,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281003001026",
    minLevel: 15,
    reorderPoint: 30,
    maxLevel: 100,
    batches: [{ lot: "LOT-26LP1", expiry: "2027-09-20", qty: 55 }],
  },
  {
    tradeName: "Plavix",
    strength: "75 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Sanofi",
    arabicSearchName: "بلافيكس كلوبيدوجريل مميع دم وقاية جلطات",
    scientificName: "Clopidogrel",
    category: "أمراض القلب والضغط",
    usesPerDay: 1,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "red",
    wholesaleFils: 18000000n,
    retailFils: 25000000n,
    margin: 28.0,
    inventoryUnit: "علبة",
    packageUnit: "شريط (14 حبة)",
    packageRatio: 14,
    barcode: "6281003001033",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 70,
    batches: [{ lot: "LOT-26PX1", expiry: "2027-11-30", qty: 42 }],
  },
  {
    tradeName: "Norvasc",
    strength: "5 mg",
    dosageForm: "Tablet",
    manufacturer: "Pfizer",
    arabicSearchName: "نورفاسك املوديبين علاج ضغط الدم والشرايين",
    scientificName: "Amlodipine Besylate",
    category: "أمراض القلب والضغط",
    usesPerDay: 1,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "orange",
    wholesaleFils: 9000000n,
    retailFils: 13000000n,
    margin: 30.7,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281003001040",
    minLevel: 12,
    reorderPoint: 25,
    maxLevel: 90,
    batches: [{ lot: "LOT-26NV1", expiry: "2028-01-10", qty: 65 }],
  },
  {
    tradeName: "Capoten",
    strength: "25 mg",
    dosageForm: "Tablet",
    manufacturer: "Bristol-Myers Squibb",
    arabicSearchName: "كابوتين كابتوبريل ضغط دم تحت اللسان طوارئ",
    scientificName: "Captopril",
    category: "أمراض القلب والضغط",
    usesPerDay: 2,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "grey",
    wholesaleFils: 3000000n,
    retailFils: 4500000n,
    margin: 33.3,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281003001057",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    // EXPIRED (Sep 05, 2026)
    batches: [{ lot: "LOT-24CP1", expiry: "2026-09-05", qty: 14 }],
  },

  // 4. Diabetes & Endocrinology
  {
    tradeName: "Glucophage",
    strength: "850 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Merck",
    arabicSearchName: "كلوكوفاج جلوكوفاج منظم سكر ميتفورمين",
    scientificName: "Metformin Hydrochloride",
    category: "السكري والغدد",
    usesPerDay: 2,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 4500000n,
    retailFils: 6500000n,
    margin: 30.7,
    inventoryUnit: "علبة",
    packageUnit: "شريط (15 حبة)",
    packageRatio: 15,
    barcode: "6281004001018",
    minLevel: 25,
    reorderPoint: 50,
    maxLevel: 250,
    batches: [{ lot: "LOT-26GC1", expiry: "2028-03-25", qty: 110 }],
  },
  {
    tradeName: "Januvia",
    strength: "100 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "MSD",
    arabicSearchName: "جانوفيا سيتاجليبتين سكر من النوع الثاني",
    scientificName: "Sitagliptin",
    category: "السكري والغدد",
    usesPerDay: 1,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "purple",
    wholesaleFils: 24000000n,
    retailFils: 33000000n,
    margin: 27.2,
    inventoryUnit: "علبة",
    packageUnit: "شريط (14 حبة)",
    packageRatio: 14,
    barcode: "6281004001025",
    minLevel: 5,
    reorderPoint: 12,
    maxLevel: 50,
    // LOW STOCK: stock = 3 <= reorderPoint 12
    batches: [{ lot: "LOT-26JN1", expiry: "2027-07-20", qty: 3 }],
  },
  {
    tradeName: "Lantus SoloStar",
    strength: "100 U/ml",
    dosageForm: "Prefilled Pen 3 ml",
    manufacturer: "Sanofi",
    arabicSearchName: "لانتوس سولوستار قلم انسولين طويل المفعول ثلاجة",
    scientificName: "Insulin Glargine",
    category: "السكري والغدد",
    usesPerDay: 1,
    foodTiming: "regardless-of-food",
    coldStorage: true, // COLD STORAGE REQUIRED!
    colour: "blue",
    wholesaleFils: 38000000n,
    retailFils: 52000000n,
    margin: 26.9,
    inventoryUnit: "باكيت",
    packageUnit: "باكيت (5 اقلام)",
    packageRatio: 5,
    barcode: "6281004001032",
    minLevel: 5,
    reorderPoint: 15,
    maxLevel: 60,
    // OUT OF STOCK (0 stock) to test out-of-stock badge & reorder item
    batches: [],
  },
  {
    tradeName: "Euthyrox",
    strength: "50 mcg",
    dosageForm: "Tablet",
    manufacturer: "Merck",
    arabicSearchName: "ايوثيروكس ليفوثيروكسين خمول الغدة الدرقية",
    scientificName: "Levothyroxine Sodium",
    category: "السكري والغدد",
    usesPerDay: 1,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "purple",
    wholesaleFils: 5000000n,
    retailFils: 7500000n,
    margin: 33.3,
    inventoryUnit: "علبة",
    packageUnit: "شريط (25 حبة)",
    packageRatio: 25,
    barcode: "6281004001049",
    minLevel: 15,
    reorderPoint: 30,
    maxLevel: 100,
    batches: [{ lot: "LOT-26EX1", expiry: "2027-08-30", qty: 75 }],
  },

  // 5. Gastrointestinal
  {
    tradeName: "Nexium",
    strength: "40 mg",
    dosageForm: "Gastro-Resistant Tablet",
    manufacturer: "AstraZeneca",
    arabicSearchName: "نيكسيوم اسوميبرازول حموضة المعدة وارتجاع المريء",
    scientificName: "Esomeprazole Magnesium",
    category: "الجهاز الهضمي",
    usesPerDay: 1,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "purple",
    wholesaleFils: 14000000n,
    retailFils: 19500000n,
    margin: 28.2,
    inventoryUnit: "علبة",
    packageUnit: "شريط (7 حبات)",
    packageRatio: 7,
    barcode: "6281005001017",
    minLevel: 15,
    reorderPoint: 35,
    maxLevel: 120,
    batches: [{ lot: "LOT-26NX1", expiry: "2027-11-15", qty: 85 }],
  },
  {
    tradeName: "Controloc",
    strength: "40 mg",
    dosageForm: "Gastro-Resistant Tablet",
    manufacturer: "Takeda",
    arabicSearchName: "كونترولوك بانتوبرازول قرحة وحموضة المعدة",
    scientificName: "Pantoprazole Sodium",
    category: "الجهاز الهضمي",
    usesPerDay: 1,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "yellow",
    wholesaleFils: 12000000n,
    retailFils: 17000000n,
    margin: 29.4,
    inventoryUnit: "علبة",
    packageUnit: "شريط (14 حبة)",
    packageRatio: 14,
    barcode: "6281005001024",
    minLevel: 10,
    reorderPoint: 25,
    maxLevel: 90,
    batches: [{ lot: "LOT-26CT1", expiry: "2028-02-10", qty: 50 }],
  },
  {
    tradeName: "Motilium",
    strength: "10 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "Janssen",
    arabicSearchName: "موتيليوم دومبيريدون غثيان وترجيع وتنظيم الهضم",
    scientificName: "Domperidone",
    category: "الجهاز الهضمي",
    usesPerDay: 3,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "green",
    wholesaleFils: 4200000n,
    retailFils: 6000000n,
    margin: 30.0,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281005001031",
    minLevel: 10,
    reorderPoint: 25,
    maxLevel: 100,
    // NEAR EXPIRY (Dec 05, 2026)
    batches: [{ lot: "LOT-25MT1", expiry: "2026-12-05", qty: 35 }],
  },
  {
    tradeName: "Duspatalin",
    strength: "200 mg",
    dosageForm: "Retard Capsule",
    manufacturer: "Abbott",
    arabicSearchName: "دسباتالين ميبفرين تشنجات القولون العصبي ومغص",
    scientificName: "Mebeverine Hydrochloride",
    category: "الجهاز الهضمي",
    usesPerDay: 2,
    foodTiming: "before-food",
    coldStorage: false,
    colour: "yellow",
    wholesaleFils: 8500000n,
    retailFils: 12000000n,
    margin: 29.1,
    inventoryUnit: "علبة",
    packageUnit: "شريط (15 كبسولة)",
    packageRatio: 15,
    barcode: "6281005001048",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    // NEAR EXPIRY (Dec 18, 2026)
    batches: [{ lot: "LOT-25DS1", expiry: "2026-12-18", qty: 28 }],
  },
  {
    tradeName: "Gaviscon Double Action",
    strength: "200 ml",
    dosageForm: "Oral Suspension",
    manufacturer: "Reckitt Benckiser",
    arabicSearchName: "جافيسكون شراب دبل اكشن حرقة الفؤاد وحموضة",
    scientificName: "Sodium Alginate + Potassium Bicarbonate",
    category: "الجهاز الهضمي",
    usesPerDay: 3,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "green",
    wholesaleFils: 6500000n,
    retailFils: 9500000n,
    margin: 31.5,
    inventoryUnit: "زجاجة",
    packageUnit: "باكيت (12 زجاجة)",
    packageRatio: 12,
    barcode: "6281005001055",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    batches: [{ lot: "LOT-26GV1", expiry: "2027-07-25", qty: 40 }],
  },

  // 6. Respiratory & Allergy
  {
    tradeName: "Ventolin",
    strength: "100 mcg / dose",
    dosageForm: "Inhaler (200 doses)",
    manufacturer: "GSK",
    arabicSearchName: "فنتولين سالبوتامول بخاخ ربو وتوسيع قصبات هوائية",
    scientificName: "Salbutamol Sulfate",
    category: "الجهاز التنفسي",
    usesPerDay: 2,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 4500000n,
    retailFils: 6500000n,
    margin: 30.7,
    inventoryUnit: "بخاخ",
    packageUnit: "كرتونة (10 بخاخات)",
    packageRatio: 10,
    barcode: "6281006001016",
    minLevel: 20,
    reorderPoint: 40,
    maxLevel: 150,
    batches: [{ lot: "LOT-26VN1", expiry: "2028-05-30", qty: 95 }],
  },
  {
    tradeName: "Symbicort Turbuhaler",
    strength: "160 mcg / 4.5 mcg",
    dosageForm: "Inhaler (120 doses)",
    manufacturer: "AstraZeneca",
    arabicSearchName: "سيمبيكورت بوديسونيد فورموتيرول بخاخ وقائي للربو",
    scientificName: "Budesonide + Formoterol",
    category: "الجهاز التنفسي",
    usesPerDay: 2,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "red",
    wholesaleFils: 28000000n,
    retailFils: 38000000n,
    margin: 26.3,
    inventoryUnit: "بخاخ",
    packageUnit: "باكيت (1 بخاخ)",
    packageRatio: 1,
    barcode: "6281006001023",
    minLevel: 5,
    reorderPoint: 10,
    maxLevel: 40,
    // LOW STOCK: stock = 2 <= reorderPoint 10
    batches: [{ lot: "LOT-26SB1", expiry: "2027-08-20", qty: 2 }],
  },
  {
    tradeName: "Claritine",
    strength: "10 mg",
    dosageForm: "Tablet",
    manufacturer: "Bayer",
    arabicSearchName: "كلاريتين لوراتادين حساسية وجيوب انفية وحكة",
    scientificName: "Loratadine",
    category: "الجهاز التنفسي",
    usesPerDay: 1,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 5500000n,
    retailFils: 8000000n,
    margin: 31.2,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281006001030",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    // NEAR EXPIRY (Dec 30, 2026)
    batches: [{ lot: "LOT-25CR1", expiry: "2026-12-30", qty: 22 }],
  },
  {
    tradeName: "Xyzal",
    strength: "5 mg",
    dosageForm: "Film-Coated Tablet",
    manufacturer: "UCB",
    arabicSearchName: "زيزال ليفوسيتريزين حساسية موسمية وطفح جلدي",
    scientificName: "Levocetirizine Dihydrochloride",
    category: "الجهاز التنفسي",
    usesPerDay: 1,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "purple",
    wholesaleFils: 7000000n,
    retailFils: 10000000n,
    margin: 30.0,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281006001047",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 90,
    batches: [{ lot: "LOT-26XZ1", expiry: "2027-10-10", qty: 45 }],
  },
  {
    tradeName: "Prospan",
    strength: "100 ml",
    dosageForm: "Syrup",
    manufacturer: "Engelhard",
    arabicSearchName: "بروسبان شراب سعال اوراق اللبلاب كحة وبلغم",
    scientificName: "Hedera Helix (Ivy Leaf Extract)",
    category: "الجهاز التنفسي",
    usesPerDay: 3,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "green",
    wholesaleFils: 5500000n,
    retailFils: 8000000n,
    margin: 31.2,
    inventoryUnit: "زجاجة",
    packageUnit: "باكيت (1 زجاجة)",
    packageRatio: 1,
    barcode: "6281006001054",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    // EXPIRED (Aug 20, 2026)
    batches: [{ lot: "LOT-24PR1", expiry: "2026-08-20", qty: 8 }],
  },

  // 7. Vitamins, Minerals & Supplements
  {
    tradeName: "Neurobion Forte",
    strength: "Vitamin B1 + B6 + B12",
    dosageForm: "Coated Tablet",
    manufacturer: "Merck",
    arabicSearchName: "نيوروبيون فورت مقوي اعصاب فيتامين ب مركب",
    scientificName: "Thiamine + Pyridoxine + Cyanocobalamin",
    category: "فيتامينات ومكملات",
    usesPerDay: 1,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "purple",
    wholesaleFils: 4000000n,
    retailFils: 6000000n,
    margin: 33.3,
    inventoryUnit: "علبة",
    packageUnit: "شريط (10 حبات)",
    packageRatio: 10,
    barcode: "6281007001015",
    minLevel: 25,
    reorderPoint: 50,
    maxLevel: 200,
    batches: [{ lot: "LOT-26NB1", expiry: "2028-06-15", qty: 120 }],
  },
  {
    tradeName: "Osteocare",
    strength: "Calcium + Mg + Zinc + D3",
    dosageForm: "Tablet",
    manufacturer: "Vitabiotics",
    arabicSearchName: "اوستيوكير كالسيوم مغنيسيوم زنك هشاشة عظام",
    scientificName: "Calcium Carbonate + Magnesium + Vitamin D3",
    category: "فيتامينات ومكملات",
    usesPerDay: 2,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 8000000n,
    retailFils: 11500000n,
    margin: 30.4,
    inventoryUnit: "علبة",
    packageUnit: "شريط (15 حبة)",
    packageRatio: 15,
    barcode: "6281007001022",
    minLevel: 10,
    reorderPoint: 20,
    maxLevel: 80,
    // LOW STOCK: stock = 4 <= reorderPoint 20
    batches: [{ lot: "LOT-26OC1", expiry: "2027-11-10", qty: 4 }],
  },
  {
    tradeName: "Feroglobin B12",
    strength: "Iron + Zinc + B12",
    dosageForm: "Capsule",
    manufacturer: "Vitabiotics",
    arabicSearchName: "فيروجلوبين كبسول حديد فقر دم وانيميا وطاقة",
    scientificName: "Iron + Vitamin B Complex + Zinc",
    category: "فيتامينات ومكملات",
    usesPerDay: 1,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "red",
    wholesaleFils: 7500000n,
    retailFils: 11000000n,
    margin: 31.8,
    inventoryUnit: "علبة",
    packageUnit: "شريط (15 كبسولة)",
    packageRatio: 15,
    barcode: "6281007001039",
    minLevel: 15,
    reorderPoint: 30,
    maxLevel: 100,
    batches: [{ lot: "LOT-26FG1", expiry: "2027-12-20", qty: 60 }],
  },
  {
    tradeName: "Vitamin D3",
    strength: "50,000 IU",
    dosageForm: "Softgel",
    manufacturer: "Euro-Pharm",
    arabicSearchName: "فيتامين د3 50000 وحدة دولية حبوب اسبوعية",
    scientificName: "Cholecalciferol",
    category: "فيتامينات ومكملات",
    usesPerDay: 1,
    foodTiming: "after-food",
    coldStorage: false,
    colour: "yellow",
    wholesaleFils: 6000000n,
    retailFils: 9000000n,
    margin: 33.3,
    inventoryUnit: "علبة",
    packageUnit: "باكيت (12 كبسولة)",
    packageRatio: 12,
    barcode: "6281007001046",
    minLevel: 15,
    reorderPoint: 30,
    maxLevel: 120,
    batches: [{ lot: "LOT-26VD1", expiry: "2028-08-15", qty: 80 }],
  },

  // 8. Dermatology & Topicals
  {
    tradeName: "Fucidin",
    strength: "20 mg / g",
    dosageForm: "Cream 30 g",
    manufacturer: "Leo Pharma",
    arabicSearchName: "فيوسيدين مرهم كريم مضاد حيوي جلدي حب شباب وجروح",
    scientificName: "Sodium Fusidate",
    category: "أدوية جلدية",
    usesPerDay: 2,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "red",
    wholesaleFils: 4500000n,
    retailFils: 6500000n,
    margin: 30.7,
    inventoryUnit: "تيوب",
    packageUnit: "باكيت (1 تيوب)",
    packageRatio: 1,
    barcode: "6281008001014",
    minLevel: 15,
    reorderPoint: 35,
    maxLevel: 120,
    batches: [{ lot: "LOT-26FC1", expiry: "2027-09-30", qty: 70 }],
  },
  {
    tradeName: "Daktacort",
    strength: "20 mg / 10 mg per g",
    dosageForm: "Cream 15 g",
    manufacturer: "Janssen",
    arabicSearchName: "داكتاكورت كريم فطريات والتهاب جلدي كورتيزون",
    scientificName: "Miconazole Nitrate + Hydrocortisone",
    category: "أدوية جلدية",
    usesPerDay: 2,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "yellow",
    wholesaleFils: 5000000n,
    retailFils: 7500000n,
    margin: 33.3,
    inventoryUnit: "تيوب",
    packageUnit: "باكيت (1 تيوب)",
    packageRatio: 1,
    barcode: "6281008001021",
    minLevel: 10,
    reorderPoint: 25,
    maxLevel: 90,
    batches: [{ lot: "LOT-26DK1", expiry: "2027-10-25", qty: 50 }],
  },
  {
    tradeName: "Bepanthen",
    strength: "50 mg / g",
    dosageForm: "Moisturizing Cream 30 g",
    manufacturer: "Bayer",
    arabicSearchName: "بيبانثين مرهم كريم مرطب للحروق والجلد وتسلخات",
    scientificName: "Dexpanthenol",
    category: "أدوية جلدية",
    usesPerDay: 3,
    foodTiming: "regardless-of-food",
    coldStorage: false,
    colour: "blue",
    wholesaleFils: 6000000n,
    retailFils: 8500000n,
    margin: 29.4,
    inventoryUnit: "تيوب",
    packageUnit: "باكيت (1 تيوب)",
    packageRatio: 1,
    barcode: "6281008001038",
    minLevel: 20,
    reorderPoint: 40,
    maxLevel: 150,
    batches: [{ lot: "LOT-26BP1", expiry: "2028-02-15", qty: 90 }],
  },
];

async function seed() {
  await client.connect();
  console.log(
    "Connected to PostgreSQL (breev_local). Starting comprehensive seed...",
  );

  try {
    await client.query("BEGIN");

    // 1. Seed Suppliers
    const supplierIds = [];
    for (const sup of SUPPLIERS_DATA) {
      // Check if supplier already exists by name
      const existing = await client.query(
        "SELECT id FROM suppliers WHERE pharmacy_id = $1 AND name = $2",
        [PHARMACY_ID, sup.name],
      );
      let sId;
      if (existing.rows.length > 0) {
        sId = existing.rows[0].id;
      } else {
        sId = await getUuidv7();
        const terms = JSON.stringify({
          phone: sup.phone,
          address: sup.address,
          paymentTerms: sup.paymentTerms,
          creditLimit: sup.creditLimit,
          duePeriodDays: sup.duePeriodDays,
          alertWindowDays: sup.alertWindowDays,
        });
        await client.query(
          `INSERT INTO suppliers (
            id, pharmacy_id, name, terms, status, revision, created_at, created_by, updated_at, updated_by
          ) VALUES ($1, $2, $3, $4, 'active', 1, statement_timestamp(), $5, statement_timestamp(), $5)`,
          [sId, PHARMACY_ID, sup.name, terms, USER_ID],
        );

        // Add allowance rate
        await client.query(
          `INSERT INTO supplier_allowance_rates (
            supplier_id, pharmacy_id, allowance_percentage, effective_from, recorded_at, recorded_by
          ) VALUES ($1, $2, $3, '2026-01-01', statement_timestamp(), $4)`,
          [sId, PHARMACY_ID, sup.allowanceRate, USER_ID],
        );
      }
      supplierIds.push({ id: sId, name: sup.name });
    }
    console.log(`Seeded/verified ${supplierIds.length} suppliers.`);

    // 2. Seed Catalog Products, Units, Barcodes, Batches, Movements, and Valuation
    const createdProductIds = [];
    const lowStockProductIds = [];

    for (let i = 0; i < PRODUCTS_DATA.length; i++) {
      const p = PRODUCTS_DATA[i];
      const displayName = `${p.tradeName} ${p.strength} ${p.dosageForm}`;

      // Check if product exists
      const existing = await client.query(
        "SELECT id FROM catalog_products WHERE pharmacy_id = $1 AND medication_trade_name = $2",
        [PHARMACY_ID, p.tradeName],
      );

      let productId;
      let inventoryUnitId;
      let packageUnitId;

      if (existing.rows.length > 0) {
        productId = existing.rows[0].id;
        console.log(
          `Product "${displayName}" already exists (${productId}). Skipping insert, checking batches...`,
        );
      } else {
        productId = await getUuidv7();
        inventoryUnitId = await getUuidv7();
        packageUnitId = await getUuidv7();

        // Insert product
        await client.query(
          `INSERT INTO catalog_products (
            id, pharmacy_id, definition_mode,
            medication_trade_name, medication_strength, medication_dosage_form, medication_manufacturer,
            display_name, name_template_version, arabic_search_name, scientific_name, category,
            uses_per_day, food_timing, externally_visible, ai_sharing_allowed,
            manual_state_colour, cold_storage_required, status, revision,
            created_at, created_by, updated_at, updated_by,
            count_default_unit_id, purchase_default_unit_id, sale_default_unit_id,
            pricing_method, retail_price_fils, wholesale_price_fils, margin_percentage, price_rounding,
            minimum_level, maximum_level, reorder_point
          ) VALUES (
            $1, $2, 'medication',
            $3, $4, $5, $6,
            $7, 1, $8, $9, $10,
            $11, $12, true, true,
            $13, $14, 'active', 1,
            statement_timestamp(), $15, statement_timestamp(), $15,
            $16, $17, $16,
            'by-price', $18, $19, null, null,
            $20, $21, $22
          )`,
          [
            productId,
            PHARMACY_ID,
            p.tradeName,
            p.strength,
            p.dosageForm,
            p.manufacturer,
            displayName,
            p.arabicSearchName,
            p.scientificName,
            p.category,
            p.usesPerDay,
            p.foodTiming,
            p.colour,
            p.coldStorage,
            USER_ID,
            inventoryUnitId,
            packageUnitId,
            p.retailFils.toString(),
            p.wholesaleFils.toString(),
            p.minLevel,
            p.maxLevel,
            p.reorderPoint,
          ],
        );

        // Insert inventory unit
        await client.query(
          `INSERT INTO catalog_product_units (
            id, pharmacy_id, product_id, kind, name, ordinal, base_units_per_package
          ) VALUES ($1, $2, $3, 'inventory', $4, 0, null)`,
          [inventoryUnitId, PHARMACY_ID, productId, p.inventoryUnit],
        );

        // Insert package unit
        await client.query(
          `INSERT INTO catalog_product_units (
            id, pharmacy_id, product_id, kind, name, ordinal, base_units_per_package
          ) VALUES ($1, $2, $3, 'package', $4, 1, $5)`,
          [
            packageUnitId,
            PHARMACY_ID,
            productId,
            p.packageUnit,
            p.packageRatio,
          ],
        );

        // Insert barcode
        await client.query(
          `INSERT INTO catalog_product_barcodes (
            pharmacy_id, product_id, barcode, ordinal, recorded_at, recorded_by, kind, source
          ) VALUES ($1, $2, $3, 1, statement_timestamp(), $4, 'product', 'provided')`,
          [PHARMACY_ID, productId, p.barcode, USER_ID],
        );
      }

      createdProductIds.push({
        id: productId,
        name: displayName,
        inventoryUnitId,
        packageUnitId,
        data: p,
      });

      // Check if batches already exist for this product
      const existingBatches = await client.query(
        "SELECT id FROM inventory_batches WHERE pharmacy_id = $1 AND product_id = $2",
        [PHARMACY_ID, productId],
      );

      if (existingBatches.rows.length === 0 && p.batches.length > 0) {
        let totalQuantity = 0n;
        let totalCarryingAmountFils = 0n;
        const assignedSupplier = supplierIds[i % supplierIds.length];
        const invoiceDocId = await getUuidv7();

        for (let bIdx = 0; bIdx < p.batches.length; bIdx++) {
          const b = p.batches[bIdx];
          const batchId = await getUuidv7();
          const movementId = await getUuidv7();
          const batchQty = BigInt(b.qty);
          const carryingFils = batchQty * p.wholesaleFils;

          totalQuantity += batchQty;
          totalCarryingAmountFils += carryingFils;

          // 1. Insert Batch
          await client.query(
            `INSERT INTO inventory_batches (
              id, pharmacy_id, product_id, lot_number, expiry_date, quantity, status, created_at, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, 'active', statement_timestamp() - interval '30 days', $7)`,
            [
              batchId,
              PHARMACY_ID,
              productId,
              b.lot,
              b.expiry,
              batchQty.toString(),
              USER_ID,
            ],
          );

          // 2. Insert Movement
          await client.query(
            `INSERT INTO inventory_movements (
              id, pharmacy_id, product_id, batch_id, reason, quantity, carrying_amount_fils,
              source_document_type, source_document_id, source_row_ordinal, occurred_at, created_by
            ) VALUES ($1, $2, $3, $4, 'purchase-receipt', $5, $6, 'purchase-invoice', $7, $8, statement_timestamp() - interval '30 days', $9)`,
            [
              movementId,
              PHARMACY_ID,
              productId,
              batchId,
              batchQty.toString(),
              carryingFils.toString(),
              invoiceDocId,
              bIdx + 1,
              USER_ID,
            ],
          );
        }

        // 3. Upsert Valuation State
        const valuationScaled = totalCarryingAmountFils * 10000000000n; // 10^10 scale
        await client.query(
          `INSERT INTO inventory_valuation_state (
            pharmacy_id, product_id, total_quantity, total_value_scaled, updated_at
          ) VALUES ($1, $2, $3, $4, statement_timestamp())
          ON CONFLICT (pharmacy_id, product_id) DO UPDATE
          SET total_quantity = EXCLUDED.total_quantity,
              total_value_scaled = EXCLUDED.total_value_scaled,
              updated_at = statement_timestamp()`,
          [
            PHARMACY_ID,
            productId,
            totalQuantity.toString(),
            valuationScaled.toString(),
          ],
        );
      }

      // Check if low stock
      const totalStock = p.batches.reduce((sum, b) => sum + b.qty, 0);
      if (totalStock <= p.reorderPoint) {
        lowStockProductIds.push({
          productId,
          balance: totalStock,
          reorderPoint: p.reorderPoint,
          maxLevel: p.maxLevel,
        });
      }
    }

    console.log(
      `Seeded ${createdProductIds.length} catalog products with units, barcodes, batches and valuation.`,
    );

    // 3. Seed Reorder Basket Items for low-stock items
    for (const item of lowStockProductIds) {
      const existingReorder = await client.query(
        "SELECT id FROM inventory_reorder_items WHERE pharmacy_id = $1 AND product_id = $2 AND status = 'basket'",
        [PHARMACY_ID, item.productId],
      );
      if (existingReorder.rows.length === 0) {
        const reorderId = await getUuidv7();
        const proposedQty = Math.max(15, (item.maxLevel || 50) - item.balance);
        await client.query(
          `INSERT INTO inventory_reorder_items (
            id, pharmacy_id, product_id, status, version, quantity, proposed_quantity, proposal_basis,
            balance_at_proposal, maximum_level_at_proposal, proposed_at, added_at, added_by,
            updated_at, updated_by, device_id
          ) VALUES (
            $1, $2, $3, 'basket', 1, $4, $4, 'maximum-minus-balance',
            $5, $6, statement_timestamp(), statement_timestamp(), $7,
            statement_timestamp(), $7, $8
          )`,
          [
            reorderId,
            PHARMACY_ID,
            item.productId,
            proposedQty,
            item.balance,
            item.maxLevel,
            USER_ID,
            TERMINAL_DEVICE_ID,
          ],
        );
      }
    }
    console.log(`Seeded ${lowStockProductIds.length} items in reorder basket.`);

    // 4. Seed 2 Active Purchase Drafts
    const existingDrafts = await client.query(
      "SELECT id FROM purchase_drafts WHERE pharmacy_id = $1 AND status = 'active'",
      [PHARMACY_ID],
    );

    if (existingDrafts.rows.length === 0) {
      // Draft 1 from Al-Nahrain
      const draft1Id = await getUuidv7();
      await client.query(
        `INSERT INTO purchase_drafts (
          id, pharmacy_id, supplier_invoice_number, supplier_id, supplier_name_snapshot,
          settlement_context, invoice_date, allowance_percentage_snapshot, allowance_basis_fils,
          status, version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          $1, $2, 'INV-2026-9042', $3, 'مكتب النهرين العلمي للأدوية',
          'debt', '2026-09-27', 5.0, 45000000,
          'active', 1, statement_timestamp(), $4, statement_timestamp(), $4
        )`,
        [draft1Id, PHARMACY_ID, supplierIds[0].id, USER_ID],
      );

      // Draft 1 rows (Panadol Extra + Augmentin)
      const row1Id = await getUuidv7();
      const row2Id = await getUuidv7();
      const p1 = createdProductIds[0];
      const p2 = createdProductIds[5];

      await client.query(
        `INSERT INTO purchase_draft_rows (
          id, pharmacy_id, draft_id, ordinal, product_id, item_display_name, inventory_unit_name,
          entered_unit_kind, entered_package_unit_name, base_units_per_entered_unit, entered_quantity,
          inventory_unit_quantity, primary_supplier_cost_fils, pricing_method, retail_price_fils,
          expiry_date, lot_number, created_at, created_by
        ) VALUES (
          $1, $2, $3, 1, $4, $5, 'علبة',
          'inventory-unit', null, 1, 50,
          50, 3500000, 'by-price', 5000000,
          '2028-06-30', 'LOT-NEW-01', statement_timestamp(), $6
        )`,
        [row1Id, PHARMACY_ID, draft1Id, p1.id, p1.name, USER_ID],
      );

      await client.query(
        `INSERT INTO purchase_draft_rows (
          id, pharmacy_id, draft_id, ordinal, product_id, item_display_name, inventory_unit_name,
          entered_unit_kind, entered_package_unit_name, base_units_per_entered_unit, entered_quantity,
          inventory_unit_quantity, primary_supplier_cost_fils, pricing_method, retail_price_fils,
          expiry_date, lot_number, created_at, created_by
        ) VALUES (
          $1, $2, $3, 2, $4, $5, 'علبة',
          'inventory-unit', null, 1, 30,
          30, 9500000, 'by-price', 13500000,
          '2028-03-15', 'LOT-NEW-02', statement_timestamp(), $6
        )`,
        [row2Id, PHARMACY_ID, draft1Id, p2.id, p2.name, USER_ID],
      );

      // Draft 2 from Al-Rawan
      const draft2Id = await getUuidv7();
      await client.query(
        `INSERT INTO purchase_drafts (
          id, pharmacy_id, supplier_invoice_number, supplier_id, supplier_name_snapshot,
          settlement_context, invoice_date, allowance_percentage_snapshot, allowance_basis_fils,
          status, version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          $1, $2, 'RAWAN-OCT-105', $3, 'شركة الروان لتجارة وتوزيع الأدوية',
          'cash', '2026-09-28', 7.5, 38000000,
          'active', 1, statement_timestamp(), $4, statement_timestamp(), $4
        )`,
        [draft2Id, PHARMACY_ID, supplierIds[1].id, USER_ID],
      );

      const row3Id = await getUuidv7();
      const p3 = createdProductIds[12]; // Lipitor
      await client.query(
        `INSERT INTO purchase_draft_rows (
          id, pharmacy_id, draft_id, ordinal, product_id, item_display_name, inventory_unit_name,
          entered_unit_kind, entered_package_unit_name, base_units_per_entered_unit, entered_quantity,
          inventory_unit_quantity, primary_supplier_cost_fils, pricing_method, retail_price_fils,
          expiry_date, lot_number, created_at, created_by
        ) VALUES (
          $1, $2, $3, 1, $4, $5, 'علبة',
          'inventory-unit', null, 1, 20,
          20, 16000000, 'by-price', 22500000,
          '2028-05-20', 'LOT-RAW-88', statement_timestamp(), $6
        )`,
        [row3Id, PHARMACY_ID, draft2Id, p3.id, p3.name, USER_ID],
      );

      console.log("Seeded 2 active purchase drafts with line items.");
    }

    // 5. Seed 1 Active Sale Draft with 2 items in cart
    const existingSaleDrafts = await client.query(
      "SELECT id FROM sale_drafts WHERE pharmacy_id = $1 AND status = 'active'",
      [PHARMACY_ID],
    );

    if (existingSaleDrafts.rows.length === 0) {
      const saleDraftId = await getUuidv7();
      await client.query(
        `INSERT INTO sale_drafts (
          id, pharmacy_id, status, version, created_at, created_by, updated_at, updated_by,
          device_id, invoice_discount_fils
        ) VALUES (
          $1, $2, 'active', 1, statement_timestamp(), $3, statement_timestamp(), $3,
          $4, 0
        )`,
        [saleDraftId, PHARMACY_ID, USER_ID, TERMINAL_DEVICE_ID],
      );

      const p1 = createdProductIds[0];
      const p2 = createdProductIds[5];
      const line1Id = await getUuidv7();
      const line2Id = await getUuidv7();

      // Line 1: Panadol Extra
      const eligible1 = JSON.stringify([
        { id: p1.inventoryUnitId, name: "علبة", ratio: 1 },
      ]);
      await client.query(
        `INSERT INTO sale_draft_lines (
          id, pharmacy_id, draft_id, line_kind, product_id, display_name, unit_id, unit_name,
          base_units_per_unit, eligible_units, quantity, captured_retail_price_fils, captured_unit_ratio,
          unit_price_fils, price_version, cost_fils, price_captured_at, line_discount_percentage,
          ordinal, price_source
        ) VALUES (
          $1, $2, $3, 'catalog', $4, $5, $6, 'علبة',
          1, $7::jsonb, 2, 5000000, 1,
          5000000, 1, 3500000, statement_timestamp(), 0,
          1, 'retail'
        )`,
        [
          line1Id,
          PHARMACY_ID,
          saleDraftId,
          p1.id,
          p1.name,
          p1.inventoryUnitId,
          eligible1,
        ],
      );

      // Line 2: Augmentin
      const eligible2 = JSON.stringify([
        { id: p2.inventoryUnitId, name: "علبة", ratio: 1 },
      ]);
      await client.query(
        `INSERT INTO sale_draft_lines (
          id, pharmacy_id, draft_id, line_kind, product_id, display_name, unit_id, unit_name,
          base_units_per_unit, eligible_units, quantity, captured_retail_price_fils, captured_unit_ratio,
          unit_price_fils, price_version, cost_fils, price_captured_at, line_discount_percentage,
          ordinal, price_source
        ) VALUES (
          $1, $2, $3, 'catalog', $4, $5, $6, 'علبة',
          1, $7::jsonb, 1, 13500000, 1,
          13500000, 1, 9500000, statement_timestamp(), 0,
          2, 'retail'
        )`,
        [
          line2Id,
          PHARMACY_ID,
          saleDraftId,
          p2.id,
          p2.name,
          p2.inventoryUnitId,
          eligible2,
        ],
      );

      console.log("Seeded 1 active sale draft (POS cart) with 2 line items.");
    }

    await client.query("COMMIT");
    console.log("=== Demo dataset successfully seeded and committed! ===");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error during seed transaction:", err);
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch(console.error);
