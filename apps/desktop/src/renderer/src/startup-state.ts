import type { TerminalPairingState } from "@breev/contracts/desktop-preload";
import type { LocalHealthResponse } from "@breev/contracts/local-rest";
import { LocalRestVersionMismatchError } from "@breev/contracts/local-rest";

export type StartupState =
  | "starting"
  | "connecting"
  | "ready"
  | "main-unavailable"
  | "incompatible-version"
  | "repair-required"
  | "unpaired";

export type SettledStartupState = Exclude<
  StartupState,
  "starting" | "connecting"
>;

export function stateFromHealth(
  response: LocalHealthResponse,
): SettledStartupState {
  switch (response.status) {
    case "healthy":
      return "ready";
    case "degraded":
      return "main-unavailable";
    case "repair-required":
      return "repair-required";
  }
}

export function stateFromStartupFailure(error: unknown): SettledStartupState {
  return error instanceof LocalRestVersionMismatchError
    ? "incompatible-version"
    : "main-unavailable";
}

/**
 * A terminal without a device certificate cannot reach the Main Pharmacy
 * Computer at all, so it shows the pairing ceremony instead of a connection
 * state. Once the certificate exists the shell falls back to the ordinary
 * health handshake, which owns every later availability state including the
 * LAN-loss state 'main-unavailable'.
 */
export function stateFromTerminalPairing(
  pairing: TerminalPairingState,
): StartupState {
  return pairing.stage === "paired" ? "connecting" : "unpaired";
}
