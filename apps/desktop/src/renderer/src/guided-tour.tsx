import { useCallback, useMemo, useRef, useState } from "react";
import {
  EVENTS,
  STATUS,
  useJoyride,
  type BeaconRenderProps,
  type Step,
  type TooltipRenderProps,
} from "react-joyride";

import { tourCopy } from "./help-content";
import { helpMessages } from "./help-messages";
import type { ModuleId } from "./module-ids";
import type { Locale } from "./preferences";
import { tourSteps } from "./tour-steps";

/**
 * Whether the element an anchor names is on the page and actually showing.
 *
 * Presence in the DOM is not enough. A screen keeps its other tabs mounted and
 * merely `hidden` — the purchasing invoice regions stay in the document while
 * the user is on Suppliers — so a selector match alone would announce a step
 * the spotlight cannot frame. `checkVisibility` is what separates the two, and
 * it is guarded because it is a comparatively recent DOM method: where it is
 * missing the anchor is treated as showing, which is the behaviour this had
 * before.
 */
function visibleTourTarget(anchor: string): boolean {
  const element = document.querySelector(`[data-tour="${anchor}"]`);
  if (element === null) {
    return false;
  }
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility()
    : true;
}

/**
 * Which anchors of a module's tutorial are actually on the page right now.
 *
 * A surface hides what the signed-in user has no permission for, and several
 * regions only render once there is something to show, so a tutorial is filtered
 * against the live DOM rather than assumed. An anchor that is not there is
 * dropped instead of pointing the spotlight at nothing.
 */
export function availableTourAnchors(moduleId: ModuleId): readonly string[] {
  const steps = tourSteps[moduleId];
  if (steps === undefined) {
    return [];
  }
  return steps.map((step) => step.anchor).filter(visibleTourTarget);
}

/** Whether a module can offer a tutorial at this moment. */
export function hasRunnableTour(moduleId: ModuleId): boolean {
  return availableTourAnchors(moduleId).length > 0;
}

function TourBeacon(props: BeaconRenderProps): React.JSX.Element {
  // Rendered inside Joyride's own <button>, so this must stay a <span>.
  // Supplying it at all is what stops Joyride injecting a <style> element for
  // its stock beacon animation, which the renderer's `style-src 'self'`
  // Content Security Policy would block. See help-panel.tsx for the full note.
  return (
    <span aria-hidden="true" className="tour-beacon" data-index={props.index} />
  );
}

function TourLoader(): React.JSX.Element {
  // Present for the same Content Security Policy reason as TourBeacon: the
  // stock loader injects a <style> element for its spinner keyframes.
  return <span aria-hidden="true" className="tour-loader" />;
}

function tourTooltip(locale: Locale) {
  return function TourTooltip({
    backProps,
    index,
    isLastStep,
    primaryProps,
    size,
    skipProps,
    step,
    tooltipProps,
  }: TooltipRenderProps): React.JSX.Element {
    const copy = helpMessages[locale];
    const titleId = `tour-step-title-${String(index)}`;

    return (
      <div {...tooltipProps} aria-labelledby={titleId} className="tour-tooltip">
        <p className="tour-step-counter">{copy.stepCounter(index + 1, size)}</p>
        <h2 className="tour-step-title" id={titleId}>
          {step.title}
        </h2>
        <div className="tour-step-body">{step.content}</div>
        <div className="tour-actions">
          {/* `skipProps`, not `closeProps`: Joyride labels the close control
              "Close the tutorial" while this button reads "Skip", and a
              control whose accessible name does not contain its visible label
              cannot be operated by name (WCAG 2.5.3). `skipProps` carries the
              skip label, and its action ends the tour outright instead of
              stepping forward. */}
          <button
            {...skipProps}
            className="quiet-button tour-skip"
            type="button"
          >
            {copy.skip}
          </button>
          <span className="tour-actions-end">
            {index > 0 ? (
              <button {...backProps} className="quiet-button" type="button">
                {copy.back}
              </button>
            ) : null}
            <button {...primaryProps} className="primary-button" type="button">
              {isLastStep ? copy.done : copy.next}
            </button>
          </span>
        </div>
      </div>
    );
  };
}

export interface GuidedTour {
  /** Render this in the shell. Null while no tutorial is running. */
  readonly Tour: React.ReactElement | null;
  readonly startTour: (moduleId: ModuleId) => void;
  /**
   * Abandon a running tutorial without ending it in the user's name.
   *
   * For the shell to use when the ground moves under the tour — the module
   * changes, or the session ends — so nothing is recorded and no focus is
   * taken from wherever the new screen put it.
   */
  readonly stopTour: () => void;
  readonly runningModule: ModuleId | null;
}

/**
 * The tutorial engine, mounted once by the shell.
 *
 * Joyride runs uncontrolled here: every tutorial is scoped to the screen the
 * user is already on, so there is no route to drive and no reason to mirror the
 * step index into React state where it could fall out of step.
 */
export function useGuidedTour({
  locale,
  onEnded,
}: {
  readonly locale: Locale;
  /**
   * The tutorial stopped running. `completed` is true only when the user
   * reached the end of it: skipping, Escape, and a click on the overlay all end
   * the tour without completing it, and must not be recorded as having taught
   * anything.
   */
  readonly onEnded: (moduleId: ModuleId, completed: boolean) => void;
}): GuidedTour {
  const [runningModule, setRunningModule] = useState<ModuleId | null>(null);
  // Joyride's event handler needs the module the tour belongs to, and it fires
  // outside React's render, so the value is mirrored here rather than read from
  // a state updater where a side effect does not belong.
  const running = useRef<ModuleId | null>(null);

  const steps = useMemo<Step[]>(() => {
    if (runningModule === null) {
      return [];
    }
    const copy = tourCopy[locale];
    const definitions = tourSteps[runningModule] ?? [];
    return definitions
      .filter((definition) => visibleTourTarget(definition.anchor))
      .map((definition) => ({
        content: copy[definition.anchor]?.body ?? "",
        target: `[data-tour="${definition.anchor}"]`,
        title: copy[definition.anchor]?.title ?? "",
        ...(definition.placement === undefined
          ? {}
          : { placement: definition.placement }),
      }));
  }, [locale, runningModule]);

  const startTour = useCallback((moduleId: ModuleId) => {
    running.current = moduleId;
    setRunningModule(moduleId);
  }, []);

  const stopTour = useCallback(() => {
    running.current = null;
    setRunningModule(null);
  }, []);

  const endTour = useCallback(
    (completed: boolean) => {
      const moduleId = running.current;
      running.current = null;
      setRunningModule(null);
      if (moduleId !== null) {
        onEnded(moduleId, completed);
      }
    },
    [onEnded],
  );

  const { Tour } = useJoyride({
    beaconComponent: TourBeacon,
    continuous: true,
    // `stopTour` abandons a tutorial by unmounting it, so the next one has to
    // begin at its own first step rather than resume a paused index.
    initialStepIndex: 0,
    loaderComponent: TourLoader,
    locale: {
      back: helpMessages[locale].back,
      last: helpMessages[locale].done,
      next: helpMessages[locale].next,
      skip: helpMessages[locale].skip,
    },
    onEvent: (data) => {
      if (data.type === EVENTS.TOUR_END) {
        // Joyride ends the tour for both outcomes. Only reaching the last step
        // counts as having been taught the screen.
        endTour(data.status === STATUS.FINISHED);
      }
    },
    options: {
      // The overlay covers the screen apart from the spotlight cut-out, so the
      // page underneath is not interactive while a step is showing; only the
      // highlighted region still takes clicks. Clicking the overlay or pressing
      // Escape dismisses the current step, which ends the tour on the last one,
      // and focus is held inside the tooltip until it does.
      overlayColor: "rgba(8, 14, 26, 0.55)",
      showProgress: false,
      skipBeacon: true,
      spotlightPadding: 6,
      zIndex: 2000,
    },
    run: runningModule !== null && steps.length > 0,
    scrollToFirstStep: true,
    steps,
    tooltipComponent: tourTooltip(locale),
  });

  return {
    runningModule,
    startTour,
    stopTour,
    Tour,
  };
}
