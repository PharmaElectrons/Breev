import { createHash } from "node:crypto";

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
    return undefined;
  }
  if (presentCount !== 3) {
    throw new Error(
      "Main device provisioning requires an ID, credential, and session",
    );
  }
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
