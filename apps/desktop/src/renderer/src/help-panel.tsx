import { useEffect, useRef } from "react";

import { helpContent } from "./help-content";
import { helpMessages } from "./help-messages";
import type { ModuleId } from "./module-ids";
import { moduleImplemented } from "./navigation";
import { navigationMessages } from "./navigation-messages";
import type { Locale } from "./preferences";

/**
 * The guide for the screen the user is on.
 *
 * Dialog mechanics follow `step-up.tsx`: a labelled modal that traps Tab,
 * closes on Escape, and hands focus back to the control that opened it, which is
 * what docs/workflows.md requires of every dialog in Breev.
 *
 * A module with no implementation behind it gets the honest "not built yet"
 * copy that `navigation-messages.ts` already owns, rather than a second copy of
 * the same sentence that could drift away from it.
 */
export function HelpPanel({
  canRunTour,
  completed,
  locale,
  moduleId,
  onClose,
  onStartTour,
}: {
  readonly canRunTour: boolean;
  readonly completed: boolean;
  readonly locale: Locale;
  readonly moduleId: ModuleId;
  readonly onClose: () => void;
  readonly onStartTour: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const copy = helpMessages[locale];
  const navigationCopy = navigationMessages[locale];
  const moduleCopy = navigationCopy.modules[moduleId];
  const guide = helpContent[locale][moduleId];
  const implemented = moduleImplemented(moduleId);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div
      aria-describedby="help-panel-description"
      aria-labelledby="help-panel-title"
      aria-modal="true"
      className="dialog-backdrop help-backdrop"
      ref={dialog}
      role="dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
          return;
        }
        if (event.key === "Tab") {
          const focusable = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable === undefined || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="identity-card help-panel">
        <header className="help-panel-heading">
          <h2 id="help-panel-title" ref={heading} tabIndex={-1}>
            {copy.panelTitle(moduleCopy.label)}
          </h2>
          <p id="help-panel-description">{copy.panelDescription}</p>
        </header>

        {/* Focusable so a keyboard user can scroll the guide, the way the
            purchasing and inventory scroll regions already are. */}
        <div
          className="help-panel-body"
          role="group"
          aria-label={copy.scrollGuide}
          tabIndex={0}
        >
          {implemented ? (
            <>
              <section aria-labelledby="help-purpose-title">
                <h3 id="help-purpose-title">{copy.purposeHeading}</h3>
                <p>{guide.purpose}</p>
              </section>

              {guide.tasks.length === 0 ? null : (
                <section aria-labelledby="help-tasks-title">
                  <h3 id="help-tasks-title">{copy.tasksHeading}</h3>
                  {guide.tasks.map((task) => (
                    <article className="help-task" key={task.id}>
                      <h4>{task.title}</h4>
                      <ol>
                        {task.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </article>
                  ))}
                </section>
              )}
            </>
          ) : (
            <section aria-labelledby="help-unavailable-title">
              <h3 id="help-unavailable-title">
                {navigationCopy.unavailableHeading}
              </h3>
              <p>{navigationCopy.unavailableLead}</p>
              {moduleCopy.unavailableReason === "" ? null : (
                <p>{moduleCopy.unavailableReason}</p>
              )}
            </section>
          )}
        </div>

        <footer className="help-panel-actions">
          {canRunTour ? (
            <button
              className="primary-button"
              type="button"
              onClick={onStartTour}
            >
              {completed ? copy.restartTutorial : copy.startTutorial}
            </button>
          ) : (
            <p className="help-no-tutorial">
              {implemented ? copy.noTutorial : copy.noTutorialUnavailableScreen}
            </p>
          )}
          <button className="quiet-button" type="button" onClick={onClose}>
            {copy.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
