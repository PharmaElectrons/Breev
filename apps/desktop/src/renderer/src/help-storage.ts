import type { ModuleId } from "./module-ids";

export const HELP_COMPLETED_STORAGE_KEY = "breev.help.completed";

/**
 * Which tutorials this browser profile has already finished.
 *
 * The record is a convenience, never an authority: it only decides whether the
 * panel offers "start" or "run again". Storage that is unavailable, cleared, or
 * holding something other than a list of module ids degrades to "nothing
 * completed" rather than failing, exactly as the presentation preferences in
 * `preferences-provider.tsx` do.
 */
export function readCompletedTutorials(): readonly ModuleId[] {
  try {
    const raw = window.localStorage.getItem(HELP_COMPLETED_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is ModuleId => typeof entry === "string",
    );
  } catch {
    return [];
  }
}

/** Returns the new list so a caller can hold it in React state. */
export function markTutorialCompleted(moduleId: ModuleId): readonly ModuleId[] {
  const completed = readCompletedTutorials();
  if (completed.includes(moduleId)) {
    return completed;
  }
  const next = [...completed, moduleId];
  try {
    window.localStorage.setItem(
      HELP_COMPLETED_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // A tutorial may be offered again if browser storage is unavailable.
  }
  return next;
}
