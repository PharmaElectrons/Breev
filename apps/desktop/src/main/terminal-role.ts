import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { DesktopDeviceRole } from "@breev/contracts/desktop-preload";

export const DEVICE_ROLE_VARIABLE = "BREEV_DEVICE_ROLE" as const;
export const INSTALLED_DEVICE_ROLE_FILE = "device-role" as const;
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
 * Packaged Windows installations take their role from installer-owned state,
 * not from an ambient process environment variable. A missing role file is
 * treated as Main for existing Main installations created before role
 * selection existed. Existing terminal state without the role file is unsafe
 * to guess and requires an installer repair.
 */
export function resolveDesktopDeviceRole(
  environment: Environment,
  options: {
    readonly isPackaged: boolean;
    readonly platform: NodeJS.Platform;
  },
): DesktopDeviceRole {
  if (!options.isPackaged || options.platform !== "win32") {
    return readDeviceRole(environment);
  }

  const programData = environment.ProgramData;
  if (programData === undefined || programData.length === 0) {
    throw new Error(
      "A packaged Windows installation requires ProgramData to locate its device role",
    );
  }

  const configurationDirectory = path.join(programData, "Breev", "config");
  const roleFile = path.join(
    configurationDirectory,
    INSTALLED_DEVICE_ROLE_FILE,
  );
  if (!existsSync(roleFile)) {
    if (existsSync(path.join(configurationDirectory, "terminal"))) {
      throw new Error(
        "The installed device role is missing for this POS Terminal. Repair the Breev installation.",
      );
    }
    return "main";
  }

  let value: string;
  try {
    value = readFileSync(roleFile, "utf8");
  } catch {
    throw new Error(
      "The installed device role cannot be read. Repair the Breev installation.",
    );
  }

  if (value === "main" || value === "terminal") {
    return value;
  }
  throw new Error(
    'The installed device role must contain exactly "main" or "terminal". Repair the Breev installation.',
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
