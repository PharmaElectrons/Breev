import type { ModuleId } from "./navigation";
import { navigationMessages } from "./navigation-messages";
import { usePreferences } from "./preferences-provider";

/**
 * Adapted from the client prototype's `ModuleWorkspace` scaffold, which marks a
 * module "قيد التهيئة".
 *
 * The prototype's version advertises feature cards for work that does not
 * exist. This one states only what is true: the screen is not built, there is
 * no sample data, and Breev will not show a figure it cannot stand behind.
 */
export function UnavailableSurface({
  moduleId,
}: {
  readonly moduleId: ModuleId;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = navigationMessages[locale];
  const module = copy.modules[moduleId];

  return (
    <section
      aria-labelledby="unavailable-surface-heading"
      className="unavailable-surface animate-reveal"
    >
      <div className="unavailable-card">
        <span className="unavailable-chip">{copy.unavailableBadge}</span>
        <h2 id="unavailable-surface-heading" data-testid="unavailable-surface">
          {`${module.label} — ${copy.unavailableHeading}`}
        </h2>
        <p>{module.unavailableReason}</p>
        <p>{copy.unavailableLead}</p>
      </div>
    </section>
  );
}
