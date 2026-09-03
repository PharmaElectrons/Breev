const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days from one instant to another, both ISO 8601 UTC instants.
 *
 * Floored: 25 hours ahead is 1 day, 23 hours ahead is 0 days, and an instant
 * already behind `now` is negative. This is display arithmetic for the owner
 * panel and nothing else — the local API decides every licence boundary
 * against Trusted Breev Time, and a renderer clock that disagrees changes
 * only what the panel says, never what the pharmacy may do.
 */
export function daysUntil(nowIso: string, targetIso: string): number {
  const difference = Date.parse(targetIso) - Date.parse(nowIso);
  if (!Number.isFinite(difference)) {
    throw new Error("daysUntil needs two valid ISO 8601 instants");
  }
  return Math.floor(difference / MILLISECONDS_PER_DAY);
}
