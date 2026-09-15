import { useCallback, useMemo, useState } from "react";
import {
  EVENTS,
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
  return steps
    .map((step) => step.anchor)
    .filter(
      (anchor) => document.querySelector(`[data-tour="${anchor}"]`) !== null,
    );
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
    closeProps,
    index,
    isLastStep,
    primaryProps,
    size,
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
          <button
            {...closeProps}
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
  onFinished,
}: {
  readonly locale: Locale;
  readonly onFinished: (moduleId: ModuleId) => void;
}): GuidedTour {
  const [runningModule, setRunningModule] = useState<ModuleId | null>(null);

  const steps = useMemo<Step[]>(() => {
    if (runningModule === null) {
      return [];
    }
    const copy = tourCopy[locale];
    const definitions = tourSteps[runningModule] ?? [];
    return definitions
      .filter(
        (definition) =>
          document.querySelector(`[data-tour="${definition.anchor}"]`) !== null,
      )
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
    setRunningModule(moduleId);
  }, []);

  const finished = useCallback(() => {
    setRunningModule((current) => {
      if (current !== null) {
        onFinished(current);
      }
      return null;
    });
  }, [onFinished]);

  const { Tour } = useJoyride({
    beaconComponent: TourBeacon,
    continuous: true,
    loaderComponent: TourLoader,
    locale: {
      back: helpMessages[locale].back,
      close: helpMessages[locale].closeTour,
      last: helpMessages[locale].done,
      next: helpMessages[locale].next,
      skip: helpMessages[locale].skip,
    },
    onEvent: (data) => {
      if (data.type === EVENTS.TOUR_END) {
        finished();
      }
    },
    options: {
      // The spotlight is decoration; the tooltip carries the meaning, so the
      // page underneath stays interactive and nothing is trapped behind it.
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
    Tour,
  };
}
