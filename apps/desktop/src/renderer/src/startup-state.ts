import type { LocalHealthResponse } from "@breev/contracts/local-rest";
import { LocalRestVersionMismatchError } from "@breev/contracts/local-rest";

export type StartupState =
  | "starting"
  | "connecting"
  | "ready"
  | "main-unavailable"
  | "incompatible-version"
  | "repair-required";

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
