import type {
  TerminalPairingFailureReason,
  TerminalPairingStage,
  TerminalPairingState,
} from "@breev/contracts/desktop-preload";
import { PAIRING_INVITATION_PREFIX } from "@breev/contracts/local-rest";

/**
 * Presentation logic for the terminal pairing ceremony. The state itself comes
 * from Electron main through the preload contract; this module only decides
 * what the screen shows for it.
 */

/** Ordered ceremony stages, excluding the two resting stages. */
export const TERMINAL_PAIRING_PROGRESS_STEPS = [
  "validating-endpoint",
  "generating-key",
  "joining",
  "awaiting-confirmation",
  "fetching-certificate",
  "paired",
] as const;

export type TerminalPairingProgressStep =
  (typeof TERMINAL_PAIRING_PROGRESS_STEPS)[number];

/**
 * Position of a stage in the ceremony, or -1 for the resting stages
 * (`awaiting-invitation` and `failed`), which are not steps.
 */
export function pairingProgressIndex(stage: TerminalPairingStage): number {
  return (TERMINAL_PAIRING_PROGRESS_STEPS as readonly string[]).indexOf(stage);
}

/** True while the ceremony is running and only cancellation is offered. */
export function isPairingInProgress(state: TerminalPairingState): boolean {
  return pairingProgressIndex(state.stage) >= 0 && state.stage !== "paired";
}

/**
 * Failures a second attempt cannot clear. Offering "try again" for these would
 * promise the operator something the machine cannot deliver, so the screen
 * spends the space on what to repair instead.
 */
export const UNRECOVERABLE_PAIRING_FAILURES = [
  "key-protection-unavailable",
] as const satisfies readonly TerminalPairingFailureReason[];

/** True when a failed ceremony can be attempted again on this machine. */
export function isPairingRetryable(
  reason: TerminalPairingFailureReason,
): boolean {
  return !(UNRECOVERABLE_PAIRING_FAILURES as readonly string[]).includes(
    reason,
  );
}

/** True when the operator may submit an invitation or an endpoint. */
export function acceptsPairingInvitation(state: TerminalPairingState): boolean {
  if (state.stage === "awaiting-invitation") {
    return true;
  }
  return state.stage === "failed" && isPairingRetryable(state.reason);
}

/**
 * The twelve comparison digits exist only once the terminal has proposed a
 * key, so they are shown from `awaiting-confirmation` until the certificate is
 * collected.
 */
export function pairingFingerprintDigits(
  state: TerminalPairingState,
): string | null {
  return state.stage === "awaiting-confirmation" ||
    state.stage === "fetching-certificate"
    ? state.fingerprintDigits
    : null;
}

/** Endpoint host:port typed by hand, validated before it reaches the preload. */
export function parseEndpointPort(value: string): number | null {
  if (!/^[0-9]{1,5}$/u.test(value)) {
    return null;
  }
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : null;
}

/**
 * Accepts the invitation exactly as a keyboard-wedge scanner types it, using
 * the same shape the local API pins. This is a typo check only: Electron main
 * re-validates every field and remains the sole authority on trust.
 */
export function isPairingInvitation(value: string): boolean {
  const invitation = value.trim();
  if (
    invitation.length > 2_048 ||
    !invitation.startsWith(PAIRING_INVITATION_PREFIX)
  ) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/u.test(
    invitation.slice(PAIRING_INVITATION_PREFIX.length),
  );
}
