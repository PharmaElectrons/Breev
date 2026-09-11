import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Focus that must already be final when a view becomes actionable.
 *
 * ## The readiness contract
 *
 * A screen is "ready" for the next keystroke only once two things have both
 * happened in the same React commit: the controls the user can act on are in
 * the DOM, and focus sits where the screen says it does. Deferring the focus
 * step to `requestAnimationFrame`, `queueMicrotask`, or `setTimeout` breaks
 * that contract: the new view is visible and actionable for a frame or two
 * while the deferred callback is still pending, so a keystroke that arrives
 * in that window lands on whichever control had focus before, and the
 * deferred callback then moves focus a second time behind the user's back.
 * That is a real defect for keyboard and assistive-technology users, and it
 * is exactly the window an automated driver falls into on a slow machine.
 *
 * `useLayoutEffect` runs synchronously after the commit and before paint, so
 * a focus requested alongside a state change lands in the same commit as the
 * view it belongs to. Nothing can observe the new view without also observing
 * its focus. Request the focus in the same event handler (or the same async
 * continuation) as the state change that renders the target; React batches
 * both into one commit.
 *
 * The target resolver runs at commit time, never earlier, so it may fall back
 * to a neighbour when the original control legitimately disappears with the
 * state change (a committed recall removes its own button, for example).
 */
export type CommittedFocusTarget = () => HTMLElement | null | undefined;

export function useCommittedFocus(): (target: CommittedFocusTarget) => void {
  const [request, setRequest] = useState<{
    readonly target: CommittedFocusTarget;
  } | null>(null);

  useLayoutEffect(() => {
    if (request === null) return;
    request.target()?.focus();
    setRequest(null);
  }, [request]);

  return useCallback((target: CommittedFocusTarget) => {
    setRequest({ target });
  }, []);
}
