/**
 * Presentation helpers shared by the Main devices panel and the terminal
 * pairing screen. Both screens must show the same twelve fingerprint digits,
 * split identically, so the comparison the user performs is a comparison of
 * identical artefacts in Arabic and in English.
 */

export const FINGERPRINT_DIGIT_COUNT = 12;
export const FINGERPRINT_GROUP_SIZE = 3;

/**
 * Splits the server-derived fingerprint into four groups of three digits.
 * Returns null for anything that is not exactly twelve ASCII digits, so the UI
 * can refuse to present a comparison artefact it cannot trust.
 */
export function fingerprintGroups(digits: string): readonly string[] | null {
  if (!/^[0-9]{12}$/u.test(digits)) {
    return null;
  }
  const groups: string[] = [];
  for (
    let index = 0;
    index < FINGERPRINT_DIGIT_COUNT;
    index += FINGERPRINT_GROUP_SIZE
  ) {
    groups.push(digits.slice(index, index + FINGERPRINT_GROUP_SIZE));
  }
  return groups;
}

/** Seconds left before an ISO instant, clamped to zero and NaN-safe. */
export function remainingSeconds(expiresAt: string, now: Date): number {
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) {
    return 0;
  }
  const remaining = Math.ceil((deadline - now.getTime()) / 1_000);
  return remaining > 0 ? remaining : 0;
}

/**
 * Formats a countdown as m:ss. The result is always rendered inside an
 * LTR-isolated element, identically in both locales.
 */
export function formatCountdown(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safeSeconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}
