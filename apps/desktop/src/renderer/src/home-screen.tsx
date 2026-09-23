import {
  Boxes,
  CheckCircle2,
  ChevronRight,
  Pill,
  Settings,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Wifi,
} from "lucide-react";

import { useIdentityState } from "./identity-state-provider";
import { roleDisplayName } from "./identity-messages";
import { identityMessages } from "./identity-messages";
import { messages } from "./messages";
import { navigationMessages } from "./navigation-messages";
import { usePreferences } from "./preferences-provider";
import type { StartupConnection } from "./use-startup-connection";

export function HomeScreen({
  startup,
}: {
  readonly startup: StartupConnection;
}): React.JSX.Element | null {
  const { state } = useIdentityState();
  const { locale } = usePreferences();

  if (state === null || state.state !== "authenticated") {
    return null;
  }

  const copy = messages[locale];
  const identityCopy = identityMessages[locale];
  const navCopy = navigationMessages[locale];

  const allowedPermissions = new Set(state.allowedPermissions);

  const canSales = allowedPermissions.has("sales.drafts.manage");
  const canPurchases =
    allowedPermissions.has("purchases.drafts.manage") ||
    allowedPermissions.has("purchases.posted.view");
  const canInventory =
    allowedPermissions.has("inventory.review") ||
    allowedPermissions.has("inventory.counts.record");
  const canCatalog = allowedPermissions.has("catalog.item.manage");
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

  return (
    <section
      className="home-dashboard animate-reveal"
      aria-label={navCopy.modules.dashboard.label}
    >
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
            <span className="pharmacy-highlight">{state.pharmacy.name}</span>
          </h2>
          <p className="home-subtitle">
            {locale === "ar"
              ? `أنت متصل بحساب ${state.user.username} بصلاحية ${roleDisplayName(state.user.role, identityCopy)}.`
              : `Logged in as ${state.user.username} with ${roleDisplayName(state.user.role, identityCopy)} role.`}
          </p>
        </div>
      </header>

      <div className="home-section-title">
        <h3>{locale === "ar" ? "الأقسام السريعة" : "Quick Access Modules"}</h3>
      </div>

      <div className="home-launcher-grid">
        {quickLinks
          .filter((link) => link.visible)
          .map((link) => {
            const IconComponent = link.icon;
            return (
              <a
                key={link.id}
                href={link.href}
                className="home-launcher-card"
                data-module={link.id}
              >
                <div className="home-card-header">
                  <div className="home-card-icon-wrap">
                    <IconComponent
                      className="home-card-icon"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="home-card-badge">{link.badge}</span>
                </div>
                <div className="home-card-body">
                  <h4 className="home-card-title">{link.label}</h4>
                  <p className="home-card-desc">{link.desc}</p>
                </div>
                <div className="home-card-footer">
                  <span className="home-card-action">
                    {locale === "ar" ? "فتح القسم" : "Open"}
                  </span>
                  <ChevronRight
                    className="home-card-arrow"
                    aria-hidden="true"
                  />
                </div>
              </a>
            );
          })}
      </div>

      <div className="home-system-summary">
        <div className="home-summary-card">
          <div className="home-summary-icon-wrap">
            <Wifi className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div className="home-summary-info">
            <h4>{copy.connectionStatus}</h4>
            <p>
              {startup.handshake !== null
                ? `${copy.apiVersion} ${startup.handshake.apiVersion} · ${copy.schemaVersion} ${startup.handshake.schemaVersion}`
                : copy.status[startup.state]?.title}
            </p>
          </div>
          <a
            href="#/settings/connection"
            className="quiet-button home-summary-link"
          >
            {locale === "ar" ? "عرض تفاصيل الاتصال" : "View Connection Status"}
          </a>
        </div>

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
                ? `خطة ${state.entitlement.licence?.plan ?? "الأساسية"} · محلي بدون اتصال`
                : `Plan: ${state.entitlement.licence?.plan ?? "Core"} · Offline-first`}
            </p>
          </div>
          <a
            href="#/settings/licence"
            className="quiet-button home-summary-link"
          >
            {locale === "ar" ? "إدارة الترخيص" : "Manage Licence"}
          </a>
        </div>
      </div>
    </section>
  );
}
