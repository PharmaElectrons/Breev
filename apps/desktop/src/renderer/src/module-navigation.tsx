import { navigationMessages } from "./navigation-messages";
import type { ModuleId, NavigationModule } from "./navigation";
import { usePreferences } from "./preferences-provider";

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
}: {
  readonly activeModuleId: ModuleId;
  readonly modules: readonly NavigationModule[];
}): React.JSX.Element | null {
  const { locale } = usePreferences();
  const copy = navigationMessages[locale];

  if (modules.length === 0) {
    return null;
  }

  return (
    <nav aria-label={copy.moduleNavigation} className="module-nav">
      <ul>
        {modules.map((module) => (
          <li key={module.id}>
            <a
              aria-current={module.id === activeModuleId ? "page" : undefined}
              className="module-tab"
              data-availability={module.availability}
              data-module={module.id}
              href={module.hash}
            >
              {copy.modules[module.id].label}
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
