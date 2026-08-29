import path from "node:path";

import type { DesktopDeviceRole } from "@breev/contracts/desktop-preload";

export const DEVICE_ROLE_VARIABLE = "BREEV_DEVICE_ROLE" as const;
export const TERMINAL_STATE_DIRECTORY_VARIABLE =
  "BREEV_TERMINAL_STATE_DIR" as const;
export const TERMINAL_DEVICE_NAME_VARIABLE =
  "BREEV_TERMINAL_DEVICE_NAME" as const;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * An unset role keeps today's Main Pharmacy Computer behavior. Only the exact
 * word "terminal" opts a machine into the Additional POS Terminal runtime, so
 * a typo can never silently downgrade a Main installation.
 */
export function readDeviceRole(environment: Environment): DesktopDeviceRole {
  const value = environment[DEVICE_ROLE_VARIABLE];
  if (value === undefined || value.length === 0 || value === "main") {
    return "main";
  }
  if (value === "terminal") {
    return "terminal";
  }
  throw new Error(
    `${DEVICE_ROLE_VARIABLE} must be either "main" or "terminal"`,
  );
}

/**
 * Development installs point the terminal state somewhere writable. An
 * installed Windows terminal always uses the service-owned configuration
 * directory the installer creates.
 */
export function resolveTerminalStateDirectory(
  environment: Environment,
  options: { readonly platform: NodeJS.Platform },
): string {
  const configured = environment[TERMINAL_STATE_DIRECTORY_VARIABLE];
  if (configured !== undefined && configured.trim().length > 0) {
    if (!path.isAbsolute(configured)) {
      throw new Error(
        `${TERMINAL_STATE_DIRECTORY_VARIABLE} must be an absolute path`,
      );
    }
    return path.resolve(configured);
  }

  if (options.platform !== "win32") {
    throw new Error(
      `A terminal outside Windows must set ${TERMINAL_STATE_DIRECTORY_VARIABLE}`,
    );
  }
  const programData = environment.ProgramData;
  if (programData === undefined || programData.length === 0) {
    throw new Error(
      "A Windows terminal requires ProgramData to locate its configuration",
    );
  }
  return path.join(programData, "Breev", "config", "terminal");
}

/**
 * The name is shown to the user on the Main screen while they confirm the
 * physical terminal, so it stays short and free of separators.
 */
export function readTerminalDeviceName(
  environment: Environment,
  fallbackHostname: string,
): string {
  const configured = environment[TERMINAL_DEVICE_NAME_VARIABLE]?.trim();
  const candidate =
    configured !== undefined && configured.length > 0
      ? configured
      : fallbackHostname.trim();
  const sanitized = candidate.replaceAll(/[^\p{L}\p{N} _-]/gu, "").slice(0, 64);
  return sanitized.length > 0 ? sanitized : "Breev terminal";
}
