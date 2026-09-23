import {
  BarChart3,
  Boxes,
  HeartPulse,
  Home,
  MessageSquare,
  Package,
  Pill,
  Settings,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Wallet,
} from "lucide-react";

import { navigationMessages } from "./navigation-messages";
import type { ModuleId, NavigationModule } from "./navigation";
import { usePreferences } from "./preferences-provider";

function ModuleIcon({
  moduleId,
}: {
  readonly moduleId: ModuleId;
}): React.JSX.Element {
  switch (moduleId) {
    case "dashboard":
      return <Home className="module-tab-icon" aria-hidden="true" />;
    case "sales":
      return <ShoppingCart className="module-tab-icon" aria-hidden="true" />;
    case "purchases":
      return <ShoppingBag className="module-tab-icon" aria-hidden="true" />;
    case "inventory":
      return <Boxes className="module-tab-icon" aria-hidden="true" />;
    case "products":
      return <Pill className="module-tab-icon" aria-hidden="true" />;
    case "patients":
      return <HeartPulse className="module-tab-icon" aria-hidden="true" />;
    case "messages":
      return <MessageSquare className="module-tab-icon" aria-hidden="true" />;
    case "basket":
      return <ShoppingBasket className="module-tab-icon" aria-hidden="true" />;
    case "reports":
      return <BarChart3 className="module-tab-icon" aria-hidden="true" />;
    case "accounts":
      return <Wallet className="module-tab-icon" aria-hidden="true" />;
    case "settings":
      return <Settings className="module-tab-icon" aria-hidden="true" />;
    default:
      return <Package className="module-tab-icon" aria-hidden="true" />;
  }
}

/**
 * The client prototype's module tab bar.
 *
 * Every entry is a link, never a button: navigation is not an action, and the
 * shell's documented button focus order (language, theme, check) stays exactly
 * where docs/quality.md's keyboard evidence expects it.
 *
 * A surface with no implementation behind it is still reachable, because a tab
 * that silently does nothing is worse than one that explains itself. It is
 * marked by a dashed underline as well as by muted colour, and carries
 * visually hidden text, so the state never depends on colour alone.
 */
export function ModuleNavigation({
  activeModuleId,
  modules,
  excludeModuleIds = ["accounts", "settings"],
}: {
  readonly activeModuleId: ModuleId;
  readonly modules: readonly NavigationModule[];
  readonly excludeModuleIds?: readonly ModuleId[];
}): React.JSX.Element | null {
  const { locale } = usePreferences();
  const copy = navigationMessages[locale];

  const visibleModules = modules.filter(
    (module) => !excludeModuleIds.includes(module.id),
  );

  if (visibleModules.length === 0) {
    return null;
  }

  return (
    <nav aria-label={copy.moduleNavigation} className="module-nav">
      <ul>
        {visibleModules.map((module) => (
          <li key={module.id}>
            <a
              aria-current={module.id === activeModuleId ? "page" : undefined}
              className="module-tab"
              data-availability={module.availability}
              data-module={module.id}
              href={module.hash}
            >
              <ModuleIcon moduleId={module.id} />
              <span className="module-tab-label">
                {copy.modules[module.id].label}
              </span>
              {module.availability === "unavailable" ? (
                <span className="visually-hidden">
                  {` — ${copy.unavailableBadge}`}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
