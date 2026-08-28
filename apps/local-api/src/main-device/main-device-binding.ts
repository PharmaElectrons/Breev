import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface MainDeviceProvisioning {
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly sessionToken: string;
}

export function hashMainDeviceSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function isHighEntropyMainDeviceSecret(
  value: string | undefined,
): value is string {
  if (value === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64url").length === 32;
}

export function isUuidV7(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

export function readMainDeviceProvisioning(
  environment: NodeJS.ProcessEnv,
): MainDeviceProvisioning | undefined {
  const values = {
    deviceId: environment.BREEV_MAIN_DEVICE_ID,
    deviceSecret: environment.BREEV_MAIN_DEVICE_SECRET,
    sessionToken: environment.BREEV_MAIN_DEVICE_SESSION,
  };
  const presentCount = Object.values(values).filter(
    (value) => value !== undefined,
  ).length;
  if (presentCount === 0) {
    // Installed systems distribute the binding through a file the installer
    // generates, because a Windows service and a desktop shortcut share no
    // environment. Direct variables win so development setups are unchanged.
    const filePath = environment.BREEV_MAIN_DEVICE_FILE;
    if (filePath === undefined || filePath.trim().length === 0) {
      return undefined;
    }
    return readMainDeviceProvisioningFile(filePath);
  }
  if (presentCount !== 3) {
    throw new Error(
      "Main device provisioning requires an ID, credential, and session",
    );
  }
  return validateMainDeviceProvisioning(values);
}

function readMainDeviceProvisioningFile(
  filePath: string,
): MainDeviceProvisioning {
  // A configured file that cannot be read or fails validation throws instead
  // of degrading: the installer verifies API health, so a misconfiguration
  // must surface during installation rather than as a silently unprovisioned
  // Main device.
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `The Main device provisioning file is unreadable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      "The Main device provisioning file must contain a JSON object",
    );
  }
  const record = parsed as Record<string, unknown>;
  return validateMainDeviceProvisioning({
    deviceId: asOptionalString(record.deviceId),
    deviceSecret: asOptionalString(record.deviceSecret),
    sessionToken: asOptionalString(record.sessionToken),
  });
}

function validateMainDeviceProvisioning(values: {
  deviceId: string | undefined;
  deviceSecret: string | undefined;
  sessionToken: string | undefined;
}): MainDeviceProvisioning {
  if (!isUuidV7(values.deviceId)) {
    throw new Error("BREEV_MAIN_DEVICE_ID must be a UUIDv7");
  }
  if (!isHighEntropyMainDeviceSecret(values.deviceSecret)) {
    throw new Error(
      "BREEV_MAIN_DEVICE_SECRET must be a 32-byte base64url value",
    );
  }
  if (!isHighEntropyMainDeviceSecret(values.sessionToken)) {
    throw new Error(
      "BREEV_MAIN_DEVICE_SESSION must be a 32-byte base64url value",
    );
  }

  return {
    deviceId: values.deviceId,
    deviceSecret: values.deviceSecret,
    sessionToken: values.sessionToken,
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
