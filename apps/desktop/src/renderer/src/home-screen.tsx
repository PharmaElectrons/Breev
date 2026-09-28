import {
  AlertCircle,
  Bell,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Coins,
  Copy,
  CreditCard,
  Pill,
  Search,
  Server,
  Settings,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Warehouse,
  Wifi,
} from "lucide-react";
import type { InventoryItem, Product } from "@breev/contracts/local-rest";
import { useEffect, useMemo, useState } from "react";

import { useIdentityState } from "./identity-state-provider";
import { roleDisplayName } from "./identity-messages";
import { identityMessages } from "./identity-messages";
import { messages } from "./messages";
import { navigationMessages } from "./navigation-messages";
import { usePreferences } from "./preferences-provider";
import type { StartupConnection } from "./use-startup-connection";
import {
  addReorderItem,
  newInventoryIdempotencyKey,
  requestInventoryItems,
} from "./inventory-api";
import { requestProductList } from "./catalog-api";
import { formatFilsToIqd } from "./product-record";

type SortKey =
  | "name"
  | "sold"
  | "profit"
  | "margin"
  | "expiry"
  | "stock"
  | "monthly"
  | "surplus";
type SortDir = "asc" | "desc";

interface DashboardRow {
  readonly id: string;
  readonly name: string;
  readonly sold: number;
  readonly profitFils: string;
  readonly profit: number;
  readonly margin: number;
  readonly expiry: string | null;
  readonly stock: number;
  readonly monthly: number;
  readonly surplus: number;
}

interface DashboardAlertItem {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly type: "expired" | "expiring-soon" | "low-stock";
  readonly badge: string;
  readonly message: string;
  readonly urgency: "high" | "medium";
  readonly actionHref?: string;
  readonly actionLabel?: string;
}

const dashboardCopy = {
  ar: {
    kpi: {
      totalSales: "اجمالي البيع",
      dailySales: "البيع اليومي",
      totalExpenses: "اجمالي الصرفيات",
      todayExpenses: "الصرفيات اليوم",
      totalProfit: "اجمالي الربح",
      todayProfit: "ربح اليوم",
      warehouseCost: "اجمالي كلفة المخزن",
      warehouseRetail: "قيمة المخزن - سعر البيع",
      totalDebts: "اجمالي الديون",
      nearExpiryRatio: "نسبة قريب الانتهاء",
    },
    table: {
      title: "تحليل الأداء — الأكثر مبيعاً والأكثر ربحاً",
      itemsUnit: "مادة",
      empty: "لا توجد بيانات متاحة حالياً.",
      searchPlaceholder: "بحث عن مادة بالاسم أو الرمز...",
      noSearchResults: "لا توجد مواد مطابقة للبحث الحالي.",
      filters: {
        all: "الكل",
        topSelling: "الأكثر مبيعاً",
        mostProfitable: "الأعلى ربحاً",
        lowStock: "نواقص المخزون",
        nearExpiry: "قريب الانتهاء",
        surplus: "مقترح الفائض",
      },
      columns: {
        item: "المادة",
        sold: "كمية المباع",
        profit: "الربح",
        margin: "نسبة الربح %",
        expiry: "الاكسباير",
        stock: "الكمية الحالية",
        monthly: "الصرف الشهري",
        surplus: "مقترح الفائض",
      },
    },
    notifications: {
      title: "مركز التنبيهات الموحد",
      itemAlerts: "تنبيهات المواد",
      patientAlerts: "تنبيهات المرضى",
      invoiceAlerts: "فواتير ومستحقات",
      noAlerts: "لا توجد تنبيهات نشطة",
      lowStockPrefix: "مواد بحاجة للطلب",
      nearExpiryPrefix: "مواد قريبة الانتهاء",
      viewBatch: "فحص الدفعة",
      reorder: "إضافة للنواقص",
      allSafe: "جميع المواد في النطاق الآمن",
      allSafeDesc: "لا توجد مواد قريبة الانتهاء أو وصلت إلى نقطة إعادة الطلب.",
      patientsTitle: "متابعة المرضى والوصفات المزمنة",
      patientsDesc:
        "لا توجد مواعيد إعادة صرف مستحقة اليوم. يتم توليد التنبيهات تلقائياً عند تسجيل الوصفات الدورية.",
      invoicesTitle: "فواتير ومستحقات الموردين",
      invoicesDesc: "لا توجد فواتير أو مستحقات مالية متأخرة الدفع حالياً.",
    },
    systemIdentifiers: {
      title: "معلومات النظام والنسخة",
      pharmacyId: "معرّف الصيدلية",
      deviceId: "معرّف الجهاز",
      deviceRole: "دور الجهاز",
      installationId: "معرّف التثبيت",
      copy: "نسخ",
      copied: "تم النسخ!",
      mainRole: "جهاز رئيسي (Main)",
      terminalRole: "نقطة بيع طرفية (Terminal)",
      notAvailable: "غير متوفر",
    },
  },
  en: {
    kpi: {
      totalSales: "Total Sales",
      dailySales: "Daily Sales",
      totalExpenses: "Total Expenses",
      todayExpenses: "Today Expenses",
      totalProfit: "Total Profit",
      todayProfit: "Today Profit",
      warehouseCost: "Warehouse Cost",
      warehouseRetail: "Warehouse Retail Value",
      totalDebts: "Total Debts",
      nearExpiryRatio: "Near Expiry Ratio",
    },
    table: {
      title: "Performance Analysis — Top Selling & Most Profitable",
      itemsUnit: "items",
      empty: "No data available.",
      searchPlaceholder: "Search items by name or code...",
      noSearchResults: "No items match your search filter.",
      filters: {
        all: "All",
        topSelling: "Top Selling",
        mostProfitable: "Most Profitable",
        lowStock: "Low Stock",
        nearExpiry: "Near Expiry",
        surplus: "Suggested Surplus",
      },
      columns: {
        item: "Item",
        sold: "Sold Qty",
        profit: "Profit",
        margin: "Profit %",
        expiry: "Expiry",
        stock: "Current Stock",
        monthly: "Monthly Rate",
        surplus: "Suggested Surplus",
      },
    },
    notifications: {
      title: "Unified Notification Center",
      itemAlerts: "Item Alerts",
      patientAlerts: "Patient Alerts",
      invoiceAlerts: "Invoices & Payments",
      noAlerts: "No active alerts",
      lowStockPrefix: "items need reorder",
      nearExpiryPrefix: "items near expiry",
      viewBatch: "View Batch",
      reorder: "Add to Reorder",
      allSafe: "All items within safe thresholds",
      allSafeDesc:
        "No batches are near expiry or at low-stock reorder thresholds.",
      patientsTitle: "Patient Prescription Reminders",
      patientsDesc:
        "No prescription refills due today. Reminders will populate automatically with recurring patient dispensings.",
      invoicesTitle: "Supplier Invoices & Due Payments",
      invoicesDesc: "No overdue invoices or pending supplier payments.",
    },
    systemIdentifiers: {
      title: "System & Version Information",
      pharmacyId: "Pharmacy ID",
      deviceId: "Device ID",
      deviceRole: "Device Role",
      installationId: "Installation ID",
      copy: "Copy",
      copied: "Copied!",
      mainRole: "Main Device",
      terminalRole: "POS Terminal",
      notAvailable: "Not Available",
    },
  },
} as const;

function formatIQDValue(
  filsAmount: bigint | number,
  locale: "ar" | "en",
): string {
  const iqd =
    typeof filsAmount === "bigint"
      ? Number(filsAmount / 1000n)
      : Math.round(filsAmount / 1000);
  const formatted = iqd.toLocaleString("en-US");
  return locale === "ar" ? `${formatted} د.ع` : `${formatted} IQD`;
}

export function HomeScreen({
  startup,
}: {
  readonly startup: StartupConnection;
}): React.JSX.Element | null {
  const { state } = useIdentityState();
  const { locale } = usePreferences();

  const [meds, setMeds] = useState<InventoryItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [valuationGranted, setValuationGranted] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addingReorderId, setAddingReorderId] = useState<string | null>(null);
  const [activeNotificationTab, setActiveNotificationTab] = useState<
    "item" | "patient" | "invoice"
  >("item");
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tableFilter, setTableFilter] = useState<
    | "all"
    | "top-selling"
    | "most-profitable"
    | "low-stock"
    | "near-expiry"
    | "surplus"
  >("all");

  const isAuthenticated = state !== null && state.state === "authenticated";
  const authState = isAuthenticated ? state : null;

  const allowedPermissions = useMemo(
    () => new Set(authState?.allowedPermissions ?? []),
    [authState?.allowedPermissions],
  );

  const canInventory =
    allowedPermissions.has("inventory.review") ||
    allowedPermissions.has("inventory.counts.record");
  const canCatalog = allowedPermissions.has("catalog.item.manage");

  useEffect(() => {
    if (
      startup.state !== "ready" ||
      !startup.localApiOrigin ||
      !isAuthenticated
    ) {
      return;
    }
    let active = true;

    const loadData = async () => {
      try {
        const itemsPromise = requestInventoryItems(startup.localApiOrigin!)
          .then((res) => {
            if (active) {
              setMeds(res.items);
              setValuationGranted(res.fields.valuation === "granted");
            }
            return res;
          })
          .catch(() => null);

        const productsPromise = canCatalog
          ? requestProductList(startup.localApiOrigin!)
              .then((res) => {
                if (active) {
                  setProducts(res.products);
                }
                return res;
              })
              .catch(() => null)
          : Promise.resolve(null);

        await Promise.all([itemsPromise, productsPromise]);
      } catch {
        // Fallback gracefully on network/auth denial
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [
    startup.state,
    startup.localApiOrigin,
    isAuthenticated,
    canInventory,
    canCatalog,
  ]);

  if (!isAuthenticated || authState === null) {
    return null;
  }

  const copy = messages[locale];
  const identityCopy = identityMessages[locale];
  const navCopy = navigationMessages[locale];
  const dCopy = dashboardCopy[locale];

  const canSales = allowedPermissions.has("sales.drafts.manage");
  const canPurchases =
    allowedPermissions.has("purchases.drafts.manage") ||
    allowedPermissions.has("purchases.posted.view");
  const canBasket =
    allowedPermissions.has("inventory.reorder.manage") ||
    allowedPermissions.has("inventory.reorder.confirm");

  const quickLinks = [
    {
      id: "sales",
      href: "#/sales",
      icon: ShoppingCart,
      label: navCopy.modules.sales.label,
      desc:
        locale === "ar"
          ? "نقطة البيع، إصدار الفواتير وصرف الأدوية"
          : "Point of sale, sales drafts, and dispensing",
      visible: canSales,
      badge: locale === "ar" ? "البيع المباشر" : "POS Active",
    },
    {
      id: "purchases",
      href: "#/purchases",
      icon: ShoppingBag,
      label: navCopy.modules.purchases.label,
      desc:
        locale === "ar"
          ? "استلام فواتير الشراء، الموردين، وإرجاع الأدوية"
          : "Supplier invoices, purchases, and returns",
      visible: canPurchases,
      badge: locale === "ar" ? "المشتريات" : "Purchasing",
    },
    {
      id: "inventory",
      href: "#/inventory",
      icon: Boxes,
      label: navCopy.modules.inventory.label,
      desc:
        locale === "ar"
          ? "متابعة أرصدة المخزون، الجرد الدوري، وتواريخ الصلاحية"
          : "Stock levels, count sessions, and batch safety",
      visible: canInventory,
      badge: locale === "ar" ? "المخزن" : "Stock Control",
    },
    {
      id: "products",
      href: "#/catalog/products",
      icon: Pill,
      label: navCopy.modules.products.label,
      desc:
        locale === "ar"
          ? "دليل الأدوية والمواد، الباركودات، وأسعار البيع"
          : "Medication catalog, barcodes, and pricing",
      visible: canCatalog,
      badge: locale === "ar" ? "المواد" : "Catalog",
    },
    {
      id: "basket",
      href: "#/basket",
      icon: ShoppingBasket,
      label: navCopy.modules.basket.label,
      desc:
        locale === "ar"
          ? "سلة طلبات النواقص وإعداد طلبيات الموردين"
          : "Reorder shortages and supplier order preparation",
      visible: canBasket,
      badge: locale === "ar" ? "النواقص" : "Reorder",
    },
    {
      id: "settings",
      href: "#/settings",
      icon: Settings,
      label: navCopy.modules.settings.label,
      desc:
        locale === "ar"
          ? "إعدادات الصيدلية، الأدوار، المستخدمين، وحالة الاتصال"
          : "Pharmacy settings, roles, users, and connection",
      visible: true,
      badge: locale === "ar" ? "الإعدادات" : "System",
    },
  ];

  // Derived KPI, Analytics and Dynamic Alert Data
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const {
    warehouseCostFils,
    warehouseRetailFils,
    nearExpiryRatio,
    analyticsRows,
    alertItems,
  } = useMemo(() => {
    let costAcc = 0n;
    let retailAcc = 0n;
    let nearCount = 0;
    const now = Date.now();
    const alerts: DashboardAlertItem[] = [];
    const seenProductIds = new Set<string>();

    const rows: DashboardRow[] = meds.map((m) => {
      seenProductIds.add(m.productId);
      const product = productMap.get(m.productId);
      const stock = Number(m.balance || 0);
      const backendMonthly = Number(m.consumptionRatePer30Days || 0);
      const monthly =
        backendMonthly > 0
          ? backendMonthly
          : Math.max(1, Math.round(stock * 0.25));
      const expiry = m.batches?.earliestExpiry ?? null;
      const reorderPoint = m.stockLevels?.reorderPoint
        ? Number(m.stockLevels.reorderPoint)
        : 5;

      let surplus = 0;
      if (expiry) {
        const expiryTime = new Date(expiry).getTime();
        if (!isNaN(expiryTime)) {
          const monthsLeft = Math.max(
            0.1,
            (expiryTime - now) / (30 * 86400000),
          );
          const projectedNeed = monthly * monthsLeft;
          surplus = Math.max(0, Math.ceil(stock - projectedNeed));
        }
      }

      const costFils = m.averageUnitCostFils
        ? BigInt(m.averageUnitCostFils)
        : null;
      const retailFils = product?.pricing?.retailPriceFils
        ? BigInt(product.pricing.retailPriceFils)
        : 0n;

      const sold = monthly;
      const profitUnitFils =
        retailFils > 0n && costFils !== null && retailFils > costFils
          ? retailFils - costFils
          : 0n;
      const profitFils =
        profitUnitFils > 0n ? String(profitUnitFils * BigInt(sold)) : "0";
      const profit = Number(profitFils) / 1000;

      if (m.valueFils) {
        costAcc += BigInt(m.valueFils);
      } else if (costFils) {
        costAcc += BigInt(Math.max(0, stock)) * costFils;
      }
      if (retailFils > 0n && stock > 0) {
        retailAcc += BigInt(stock) * retailFils;
      }

      let margin = 0;
      if (retailFils > 0n && costFils !== null) {
        const profitUnit = Number(retailFils - costFils);
        margin = (profitUnit / Number(retailFils)) * 100;
      } else if (product?.pricing?.method === "by-percentage") {
        margin = Number(product.pricing.marginPercentage);
      }

      const isExpired =
        m.riskIndicators?.includes("expired") ||
        (expiry ? new Date(expiry).getTime() < now : false);
      const isExpiringSoon =
        !isExpired &&
        (m.riskIndicators?.includes("expiring-soon") ||
          (expiry ? new Date(expiry).getTime() - now < 90 * 86400000 : false));
      const isLowStock =
        m.riskIndicators?.includes("at-or-below-reorder-point") ||
        m.riskIndicators?.includes("below-minimum") ||
        m.riskIndicators?.includes("out-of-stock") ||
        stock <= reorderPoint;

      if (isExpired) {
        nearCount++;
        alerts.push({
          id: `expired-${m.productId}`,
          productId: m.productId,
          name: m.displayName,
          type: "expired",
          badge: locale === "ar" ? "منتهي الصلاحية" : "Expired",
          message:
            locale === "ar"
              ? `تاريخ الانتهاء ${expiry ?? "غير محدد"} (غير مسموح بالصرف)`
              : `Expired on ${expiry ?? "unknown"} (cannot dispense)`,
          urgency: "high",
          actionHref: "#/inventory",
          actionLabel: dCopy.notifications.viewBatch,
        });
      } else if (isExpiringSoon) {
        nearCount++;
        alerts.push({
          id: `expiry-${m.productId}`,
          productId: m.productId,
          name: m.displayName,
          type: "expiring-soon",
          badge: locale === "ar" ? "قريب الانتهاء" : "Near Expiry",
          message:
            locale === "ar"
              ? `ينتهي بتاريخ ${expiry ?? ""} (أقل من 90 يوماً)`
              : `Earliest expiry: ${expiry ?? ""} (under 90 days remaining)`,
          urgency: "medium",
          actionHref: "#/inventory",
          actionLabel: dCopy.notifications.viewBatch,
        });
      }

      if (isLowStock) {
        alerts.push({
          id: `stock-${m.productId}`,
          productId: m.productId,
          name: m.displayName,
          type: "low-stock",
          badge: locale === "ar" ? "نقص مخزون" : "Low Stock",
          message:
            locale === "ar"
              ? `الرصيد الحالي: ${stock} · حد إعادة الطلب: ${reorderPoint}`
              : `Current Stock: ${stock} · Reorder Point: ${reorderPoint}`,
          urgency: stock === 0 ? "high" : "medium",
          actionHref: "#/basket",
          actionLabel: dCopy.notifications.reorder,
        });
      }

      return {
        id: m.productId,
        name: m.displayName,
        sold,
        profitFils,
        profit,
        margin,
        expiry,
        stock,
        monthly,
        surplus,
      };
    });

    for (const p of products) {
      if (!seenProductIds.has(p.id)) {
        seenProductIds.add(p.id);
        const margin =
          p.pricing?.method === "by-percentage"
            ? Number(p.pricing.marginPercentage)
            : 0;
        rows.push({
          id: p.id,
          name: p.displayName,
          sold: 0,
          profitFils: "0",
          profit: 0,
          margin,
          expiry: null,
          stock: 0,
          monthly: 0,
          surplus: 0,
        });
      }
    }

    const totalTracked = meds.length + products.length;
    const ratio = totalTracked > 0 ? (nearCount / totalTracked) * 100 : 0;
    return {
      warehouseCostFils: costAcc,
      warehouseRetailFils: retailAcc,
      nearExpiryRatio: ratio,
      analyticsRows: rows,
      alertItems: alerts,
    };
  }, [meds, productMap, products, locale, dCopy]);

  const sortedRows = useMemo(() => {
    let rows = [...analyticsRows];

    // 1. Text search filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(query));
    }

    // 2. Category quick filters
    if (tableFilter === "top-selling") {
      rows = rows.filter((r) => r.sold > 0);
    } else if (tableFilter === "most-profitable") {
      rows = rows.filter((r) => r.profit > 0 || r.margin > 0);
    } else if (tableFilter === "low-stock") {
      rows = rows.filter((r) => r.stock <= 5);
    } else if (tableFilter === "near-expiry") {
      const now = Date.now();
      rows = rows.filter((r) => {
        if (!r.expiry) return false;
        const diff = (new Date(r.expiry).getTime() - now) / 86400000;
        return diff <= 180 && diff >= -30;
      });
    } else if (tableFilter === "surplus") {
      rows = rows.filter((r) => r.surplus > 0);
    }

    // 3. Multi-column sort
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "name") {
        return a.name.localeCompare(b.name) * dir;
      }
      if (sortKey === "expiry") {
        const at = a.expiry ? new Date(a.expiry).getTime() : Infinity;
        const bt = b.expiry ? new Date(b.expiry).getTime() : Infinity;
        return (at - bt) * dir;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) {
        return a.name.localeCompare(b.name);
      }
      return ((av as number) - (bv as number)) * dir;
    });
    return rows.slice(0, 50);
  }, [analyticsRows, searchQuery, tableFilter, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const handleCopy = async (id: string, value: string | undefined | null) => {
    if (!value) return;
    try {
      if (window.breevDesktop?.copyIdentifier) {
        await window.breevDesktop.copyIdentifier({ identifier: value });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      }
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === id ? null : curr));
      }, 2000);
    } catch {
      // Ignore clipboard write failures in restricted sandbox
    }
  };

  const handleReorder = async (productId: string) => {
    if (!startup.localApiOrigin || addingReorderId !== null) return;
    setAddingReorderId(productId);
    try {
      await addReorderItem(startup.localApiOrigin, {
        idempotencyKey: newInventoryIdempotencyKey(),
        productId,
      });
    } catch (err) {
      console.error("Failed to add reorder item:", err);
    } finally {
      setAddingReorderId(null);
      window.location.hash = "#/basket";
    }
  };

  const handleNotificationTabClick = (tab: "item" | "patient" | "invoice") => {
    if (isNotificationOpen && activeNotificationTab === tab) {
      setIsNotificationOpen(false);
    } else {
      setActiveNotificationTab(tab);
      setIsNotificationOpen(true);
    }
  };

  return (
    <section
      className="home-dashboard animate-reveal"
      aria-label={navCopy.modules.dashboard.label}
    >
      {/* 1. Header greeting & operational status */}
      <header className="home-header">
        <div className="home-header-content">
          <div className="home-header-badge">
            <span className="home-status-dot" aria-hidden="true" />
            <span>
              {startup.state === "ready"
                ? locale === "ar"
                  ? "النظام جاهز ومتاح للعمل المحلي"
                  : "System Ready & Operational"
                : (copy.status[startup.state]?.title ?? startup.state)}
            </span>
          </div>
          <h2 className="home-title">
            {locale === "ar" ? "مرحباً بك في" : "Welcome to"}{" "}
            <span className="pharmacy-highlight">
              {authState.pharmacy.name}
            </span>
          </h2>
          <p className="home-subtitle">
            {locale === "ar"
              ? `أنت متصل بحساب ${authState.user.username} بصلاحية ${roleDisplayName(authState.user.role, identityCopy)}.`
              : `Logged in as ${authState.user.username} with ${roleDisplayName(authState.user.role, identityCopy)} role.`}
          </p>
        </div>
      </header>

      {/* 2. Quick Access Modules (Compacted Buttons) */}
      <section
        className="home-quick-nav-section"
        aria-label={
          locale === "ar" ? "الأقسام السريعة" : "Quick Access Modules"
        }
      >
        <div className="home-section-title">
          <h3>
            {locale === "ar" ? "الأقسام السريعة" : "Quick Access Modules"}
          </h3>
        </div>

        <div
          className="home-launcher-grid home-quick-links-bar"
          role="navigation"
          aria-label={
            locale === "ar" ? "الأقسام السريعة" : "Quick Access Modules"
          }
        >
          {quickLinks
            .filter((link) => link.visible)
            .map((link) => {
              const IconComponent = link.icon;
              return (
                <a
                  key={link.id}
                  href={link.href}
                  className="home-launcher-card home-quick-btn"
                  data-module={link.id}
                  title={`${link.label} — ${link.desc}`}
                >
                  <div className="home-quick-btn-icon-wrap">
                    <IconComponent
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="home-quick-btn-label">{link.label}</span>
                  <span className="home-quick-btn-badge">{link.badge}</span>
                  <span className="home-quick-btn-action">
                    {locale === "ar" ? "فتح القسم" : "Open"}
                  </span>
                </a>
              );
            })}
        </div>
      </section>

      {/* 3. Operational KPI Stacked Cards Grid matching Prototype Pixel-Perfect */}
      <section className="home-kpi-grid" aria-label="KPI Metrics">
        {/* Card 1: Sales (Emerald) */}
        <KpiStackedCard
          Icon={TrendingUp}
          tone="emerald"
          topLabel={dCopy.kpi.totalSales}
          topValue={formatIQDValue(0n, locale)}
          subLabel={dCopy.kpi.dailySales}
          subValue={formatIQDValue(0n, locale)}
        />

        {/* Card 2: Expenses (Rose) */}
        <KpiStackedCard
          Icon={TrendingDown}
          tone="rose"
          topLabel={dCopy.kpi.totalExpenses}
          topValue={formatIQDValue(0n, locale)}
          subLabel={dCopy.kpi.todayExpenses}
          subValue={formatIQDValue(0n, locale)}
        />

        {/* Card 3: Profit (Emerald / Rose) */}
        <KpiStackedCard
          Icon={Coins}
          tone="emerald"
          topLabel={dCopy.kpi.totalProfit}
          topValue={valuationGranted ? formatIQDValue(0n, locale) : "—"}
          subLabel={dCopy.kpi.todayProfit}
          subValue={valuationGranted ? formatIQDValue(0n, locale) : "—"}
        />

        {/* Card 4: Warehouse Cost & Retail (Amber) */}
        <KpiStackedCard
          Icon={Warehouse}
          tone="amber"
          topLabel={dCopy.kpi.warehouseCost}
          topValue={
            valuationGranted ? formatIQDValue(warehouseCostFils, locale) : "—"
          }
          subLabel={dCopy.kpi.warehouseRetail}
          subValue={formatIQDValue(warehouseRetailFils, locale)}
        />

        {/* Card 5: Debts & Near Expiry Ratio (Cyan) */}
        <KpiStackedCard
          Icon={CreditCard}
          tone="cyan"
          topLabel={dCopy.kpi.totalDebts}
          topValue={formatIQDValue(0n, locale)}
          subLabel={dCopy.kpi.nearExpiryRatio}
          subValue={`${nearExpiryRatio.toFixed(1)}%`}
        />
      </section>

      {/* 4. Unified Notification Center Strip & Alert List (Operational Exceptions) */}
      <section
        className="home-notification-panel"
        role="region"
        aria-label={dCopy.notifications.title}
      >
        <div className="home-notification-strip">
          <div className="flex items-center gap-2 mr-2">
            <Bell className="size-4 text-primary" aria-hidden="true" />
            <span className="text-xs font-bold text-foreground">
              {dCopy.notifications.title}:
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleNotificationTabClick("item")}
            className="home-notification-tab"
            data-active={isNotificationOpen && activeNotificationTab === "item"}
            aria-expanded={
              isNotificationOpen && activeNotificationTab === "item"
            }
          >
            <span>{dCopy.notifications.itemAlerts}</span>
            <span
              className={`home-notification-badge ${
                alertItems.length > 0
                  ? "text-amber-600 bg-amber-500/10 font-bold"
                  : "text-muted-foreground"
              }`}
            >
              {alertItems.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleNotificationTabClick("patient")}
            className="home-notification-tab"
            data-active={
              isNotificationOpen && activeNotificationTab === "patient"
            }
            aria-expanded={
              isNotificationOpen && activeNotificationTab === "patient"
            }
          >
            <span>{dCopy.notifications.patientAlerts}</span>
            <span className="home-notification-badge text-muted-foreground">
              0
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleNotificationTabClick("invoice")}
            className="home-notification-tab"
            data-active={
              isNotificationOpen && activeNotificationTab === "invoice"
            }
            aria-expanded={
              isNotificationOpen && activeNotificationTab === "invoice"
            }
          >
            <span>{dCopy.notifications.invoiceAlerts}</span>
            <span className="home-notification-badge text-muted-foreground">
              0
            </span>
          </button>

          <div className="text-xs text-muted-foreground mr-auto flex items-center gap-2">
            {activeNotificationTab === "item" && (
              <span>
                {alertItems.length > 0
                  ? `${alertItems.length} ${
                      locale === "ar"
                        ? "تنبيه مواد بحاجة للمتابعة"
                        : "active item alerts requiring attention"
                    }`
                  : dCopy.notifications.noAlerts}
              </span>
            )}
            {activeNotificationTab === "patient" && (
              <span>{dCopy.notifications.noAlerts}</span>
            )}
            {activeNotificationTab === "invoice" && (
              <span>{dCopy.notifications.noAlerts}</span>
            )}
            <button
              type="button"
              onClick={() => setIsNotificationOpen((open) => !open)}
              className="home-notification-toggle-btn"
              data-open={isNotificationOpen}
              aria-expanded={isNotificationOpen}
              aria-label={
                isNotificationOpen
                  ? locale === "ar"
                    ? "إغلاق قائمة التنبيهات"
                    : "Collapse notification list"
                  : locale === "ar"
                    ? "عرض قائمة التنبيهات"
                    : "Expand notification list"
              }
            >
              <ChevronDown
                className={`size-4 transition-transform duration-200 ${
                  isNotificationOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        {/* Smoothly Collapsible Dynamic Notification List Content */}
        <div
          className="home-notification-collapse-wrapper"
          data-open={isNotificationOpen}
          aria-hidden={!isNotificationOpen}
        >
          <div className="home-notification-collapse-inner">
            <div className="home-notification-body">
              <div
                key={activeNotificationTab}
                className="home-notification-content-pane"
              >
                {activeNotificationTab === "item" &&
                  (alertItems.length > 0 ? (
                    <div className="home-alert-list">
                      {alertItems.map((alert) => (
                        <div
                          key={alert.id}
                          className="home-alert-card"
                          data-type={alert.type}
                          data-urgency={alert.urgency}
                        >
                          <div className="home-alert-icon-wrap">
                            {alert.type === "expired" ? (
                              <AlertCircle
                                className="size-4 text-rose-600"
                                aria-hidden="true"
                              />
                            ) : alert.type === "expiring-soon" ? (
                              <Clock
                                className="size-4 text-amber-600"
                                aria-hidden="true"
                              />
                            ) : (
                              <Boxes
                                className="size-4 text-amber-600"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <div className="home-alert-content">
                            <div className="flex items-center gap-2">
                              <strong className="home-alert-name">
                                {alert.name}
                              </strong>
                              <span
                                className="home-alert-badge"
                                data-type={alert.type}
                              >
                                {alert.badge}
                              </span>
                            </div>
                            <p className="home-alert-desc">{alert.message}</p>
                          </div>
                          {alert.type === "low-stock" ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleReorder(alert.productId)
                              }
                              disabled={addingReorderId === alert.productId}
                              className="home-alert-action"
                            >
                              {addingReorderId === alert.productId
                                ? locale === "ar"
                                  ? "جاري الإضافة..."
                                  : "Adding..."
                                : alert.actionLabel}
                              <ChevronRight
                                className="size-3"
                                aria-hidden="true"
                              />
                            </button>
                          ) : alert.actionHref ? (
                            <a
                              href={alert.actionHref}
                              className="home-alert-action"
                            >
                              {alert.actionLabel}
                              <ChevronRight
                                className="size-3"
                                aria-hidden="true"
                              />
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="home-notification-empty">
                      <CheckCircle2
                        className="size-4 text-emerald-600 shrink-0"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-semibold text-foreground text-xs">
                          {dCopy.notifications.allSafe}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {dCopy.notifications.allSafeDesc}
                        </p>
                      </div>
                    </div>
                  ))}

                {activeNotificationTab === "patient" && (
                  <div className="home-notification-empty">
                    <CheckCircle2
                      className="size-4 text-blue-600 shrink-0"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-semibold text-foreground text-xs">
                        {dCopy.notifications.patientsTitle}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {dCopy.notifications.patientsDesc}
                      </p>
                    </div>
                  </div>
                )}

                {activeNotificationTab === "invoice" && (
                  <div className="home-notification-empty">
                    <CheckCircle2
                      className="size-4 text-indigo-600 shrink-0"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-semibold text-foreground text-xs">
                        {dCopy.notifications.invoicesTitle}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {dCopy.notifications.invoicesDesc}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Consolidated Performance Analysis Table (Deep Work Area) */}
      <PerformanceTableSection
        dCopy={dCopy}
        locale={locale}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        tableFilter={tableFilter}
        setTableFilter={setTableFilter}
        sortedRows={sortedRows}
        valuationGranted={valuationGranted}
        sortKey={sortKey}
        sortDir={sortDir}
        toggleSort={toggleSort}
      />

      {/* 6. System Summary & Installation Identifiers (3 Sept 2026 Stakeholder Decision) */}
      <div className="home-system-summary">
        {/* Connection Status Card */}
        <div className="home-summary-card">
          <div className="home-summary-icon-wrap">
            <Wifi className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div className="home-summary-info">
            <h4>{copy.connectionStatus}</h4>
            <p>
              {startup.handshake !== null
                ? `${copy.apiVersion} ${startup.handshake.apiVersion} · ${copy.schemaVersion} ${startup.handshake.schemaVersion}`
                : (copy.status[startup.state]?.title ?? startup.state)}
            </p>
          </div>
          <a
            href="#/settings/connection"
            className="quiet-button home-summary-link"
          >
            {locale === "ar" ? "عرض تفاصيل الاتصال" : "View Connection Status"}
          </a>
        </div>

        {/* Licence & Security Card */}
        <div className="home-summary-card">
          <div className="home-summary-icon-wrap">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
          </div>
          <div className="home-summary-info">
            <h4>
              {locale === "ar" ? "الترخيص والأمان" : "Licence & Security"}
            </h4>
            <p>
              {locale === "ar"
                ? `خطة ${authState.entitlement.licence?.plan ?? "الأساسية"} · محلي بدون اتصال`
                : `Plan: ${authState.entitlement.licence?.plan ?? "Core"} · Offline-first`}
            </p>
          </div>
          <a
            href="#/settings/licence"
            className="quiet-button home-summary-link"
          >
            {locale === "ar" ? "إدارة الترخيص" : "Manage Licence"}
          </a>
        </div>

        {/* System Support Identifiers Card with 1-Click Copy */}
        <div className="home-summary-card">
          <div className="home-summary-icon-wrap">
            <Server className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div className="home-summary-info">
            <h4>{dCopy.systemIdentifiers.title}</h4>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span
                className="home-identifier-badge"
                title={dCopy.systemIdentifiers.pharmacyId}
              >
                <span>ID: {authState.pharmacy.id.slice(0, 8)}...</span>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy("pharmacyId", authState.pharmacy.id)
                  }
                  className="home-copy-button"
                  aria-label={`${dCopy.systemIdentifiers.copy} ${dCopy.systemIdentifiers.pharmacyId}`}
                >
                  {copiedId === "pharmacyId" ? (
                    <Check className="size-3 text-emerald-600" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </button>
              </span>

              {startup.startupConfig?.deviceId && (
                <span
                  className="home-identifier-badge"
                  title={dCopy.systemIdentifiers.deviceId}
                >
                  <span>
                    DEV: {startup.startupConfig.deviceId.slice(0, 8)}...
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy(
                        "deviceId",
                        startup.startupConfig?.deviceId,
                      )
                    }
                    className="home-copy-button"
                    aria-label={`${dCopy.systemIdentifiers.copy} ${dCopy.systemIdentifiers.deviceId}`}
                  >
                    {copiedId === "deviceId" ? (
                      <Check className="size-3 text-emerald-600" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </span>
              )}
            </div>
          </div>
          <a
            href="#/settings/connection"
            className="quiet-button home-summary-link"
          >
            {locale === "ar" ? "المعرّفات الكاملة" : "All Identifiers"}
          </a>
        </div>
      </div>
    </section>
  );
}

function SortableTh({
  label,
  k,
  active,
  dir,
  onClick,
}: {
  readonly label: string;
  readonly k: SortKey;
  readonly active: SortKey;
  readonly dir: SortDir;
  readonly onClick: (k: SortKey) => void;
}) {
  const isActive = active === k;
  return (
    <th className="select-none text-right">
      <button
        type="button"
        onClick={() => onClick(k)}
        className="home-sort-button"
        data-active={isActive}
      >
        <span>{label}</span>
        {isActive &&
          (dir === "asc" ? (
            <ChevronUp className="size-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3" aria-hidden="true" />
          ))}
      </button>
    </th>
  );
}

function KpiStackedCard({
  Icon,
  tone,
  topLabel,
  topValue,
  subLabel,
  subValue,
}: {
  readonly Icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  readonly tone: "emerald" | "rose" | "amber" | "cyan";
  readonly topLabel: string;
  readonly topValue: string;
  readonly subLabel: string;
  readonly subValue: string;
}) {
  return (
    <div className="home-kpi-card" data-tone={tone}>
      <div className="home-kpi-upper">
        <div className="home-kpi-icon-wrap">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="home-kpi-body">
          <p className="home-kpi-top-label">{topLabel}</p>
          <p className="home-kpi-top-value">{topValue}</p>
        </div>
      </div>
      <div className="home-kpi-lower">
        <p className="home-kpi-sub-label">{subLabel}</p>
        <p className="home-kpi-sub-value">{subValue}</p>
      </div>
    </div>
  );
}

function PerformanceTableSection({
  dCopy,
  locale,
  searchQuery,
  setSearchQuery,
  tableFilter,
  setTableFilter,
  sortedRows,
  valuationGranted,
  sortKey,
  sortDir,
  toggleSort,
}: {
  readonly dCopy: (typeof dashboardCopy)["ar" | "en"];
  readonly locale: "ar" | "en";
  readonly searchQuery: string;
  readonly setSearchQuery: (q: string) => void;
  readonly tableFilter:
    | "all"
    | "top-selling"
    | "most-profitable"
    | "low-stock"
    | "near-expiry"
    | "surplus";
  readonly setTableFilter: (
    f:
      | "all"
      | "top-selling"
      | "most-profitable"
      | "low-stock"
      | "near-expiry"
      | "surplus",
  ) => void;
  readonly sortedRows: readonly DashboardRow[];
  readonly valuationGranted: boolean;
  readonly sortKey: SortKey;
  readonly sortDir: SortDir;
  readonly toggleSort: (k: SortKey) => void;
}) {
  return (
    <section className="home-table-section">
      <header className="home-table-header">
        <div className="home-table-header-left">
          <Sparkles
            className="size-4 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <h3 className="home-table-title">{dCopy.table.title}</h3>
          <span className="home-table-count">
            {sortedRows.length} {dCopy.table.itemsUnit}
          </span>
        </div>

        <div className="home-table-search-wrap">
          <Search
            className="size-3.5 text-muted-foreground shrink-0"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={dCopy.table.searchPlaceholder}
            className="home-table-search-input"
            aria-label={dCopy.table.searchPlaceholder}
          />
        </div>
      </header>

      {/* Quick Category Filters */}
      <div
        className="home-table-filters"
        role="tablist"
        aria-label="Table Filters"
      >
        {(
          [
            { key: "all", label: dCopy.table.filters.all },
            { key: "top-selling", label: dCopy.table.filters.topSelling },
            {
              key: "most-profitable",
              label: dCopy.table.filters.mostProfitable,
            },
            { key: "low-stock", label: dCopy.table.filters.lowStock },
            { key: "near-expiry", label: dCopy.table.filters.nearExpiry },
            { key: "surplus", label: dCopy.table.filters.surplus },
          ] as const
        ).map((filter) => (
          <button
            key={filter.key}
            type="button"
            role="tab"
            aria-selected={tableFilter === filter.key}
            onClick={() => setTableFilter(filter.key)}
            className="home-table-filter-btn"
            data-active={tableFilter === filter.key}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="home-table-scroll">
        <table className="home-table">
          <thead>
            <tr>
              <th className="text-right">{dCopy.table.columns.item}</th>
              <SortableTh
                label={dCopy.table.columns.sold}
                k="sold"
                active={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              {valuationGranted && (
                <SortableTh
                  label={dCopy.table.columns.profit}
                  k="profit"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                />
              )}
              {valuationGranted && (
                <SortableTh
                  label={dCopy.table.columns.margin}
                  k="margin"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                />
              )}
              <SortableTh
                label={dCopy.table.columns.expiry}
                k="expiry"
                active={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableTh
                label={dCopy.table.columns.stock}
                k="stock"
                active={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableTh
                label={dCopy.table.columns.monthly}
                k="monthly"
                active={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableTh
                label={dCopy.table.columns.surplus}
                k="surplus"
                active={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold text-foreground">{r.name}</td>
                <td className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {r.sold}
                </td>
                {valuationGranted && (
                  <td className="font-mono font-bold text-foreground">
                    {formatFilsToIqd(r.profitFils, locale)}
                  </td>
                )}
                {valuationGranted && (
                  <td
                    className={`font-mono font-bold ${
                      r.margin >= 25
                        ? "text-emerald-700 dark:text-emerald-400"
                        : r.margin >= 10
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {r.margin.toFixed(1)}%
                  </td>
                )}
                <td className="font-mono text-muted-foreground text-[11px]">
                  {r.expiry ?? "—"}
                </td>
                <td className="font-mono text-foreground font-medium">
                  {r.stock}
                </td>
                <td className="font-mono text-muted-foreground">
                  {r.monthly.toFixed(1)}
                </td>
                <td
                  className={`font-mono font-bold ${
                    r.surplus > 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {r.surplus}
                </td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td
                  colSpan={valuationGranted ? 8 : 6}
                  className="p-8 text-center text-muted-foreground"
                >
                  {searchQuery.trim() || tableFilter !== "all"
                    ? dCopy.table.noSearchResults
                    : dCopy.table.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
