import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readMainDeviceProvisioning } from "./main-device-binding.js";

const PROVISIONING = {
  deviceId: "0198dcbb-d7e3-7000-8000-000000000001",
  deviceSecret: "A".repeat(43),
  sessionToken: "B".repeat(43),
} as const;

describe("readMainDeviceProvisioning", () => {
  it("reads direct environment variables ahead of any file", async () => {
    const filePath = await writeProvisioningFile({
      ...PROVISIONING,
      deviceSecret: "C".repeat(43),
    });

    expect(
      readMainDeviceProvisioning({
        BREEV_MAIN_DEVICE_FILE: filePath,
        BREEV_MAIN_DEVICE_ID: PROVISIONING.deviceId,
        BREEV_MAIN_DEVICE_SECRET: PROVISIONING.deviceSecret,
        BREEV_MAIN_DEVICE_SESSION: PROVISIONING.sessionToken,
      }),
    ).toEqual(PROVISIONING);
  });

  it("reads the provisioning file named by BREEV_MAIN_DEVICE_FILE", async () => {
    const filePath = await writeProvisioningFile(PROVISIONING);

    expect(
      readMainDeviceProvisioning({ BREEV_MAIN_DEVICE_FILE: filePath }),
    ).toEqual(PROVISIONING);
  });

  it("throws when the configured file is missing or invalid", async () => {
    expect(() =>
      readMainDeviceProvisioning({
        BREEV_MAIN_DEVICE_FILE: path.join(tmpdir(), "does-not-exist.json"),
      }),
    ).toThrow("unreadable");

    const invalidPath = await writeProvisioningFile({
      deviceId: PROVISIONING.deviceId,
    });
    expect(() =>
      readMainDeviceProvisioning({ BREEV_MAIN_DEVICE_FILE: invalidPath }),
    ).toThrow();
  });

  it("returns undefined without variables or a configured file", () => {
    expect(readMainDeviceProvisioning({})).toBeUndefined();
    expect(
      readMainDeviceProvisioning({ BREEV_MAIN_DEVICE_FILE: "  " }),
    ).toBeUndefined();
  });
});

async function writeProvisioningFile(content: object): Promise<string> {
  const configRoot = await mkdtemp(path.join(tmpdir(), "breev-provisioning-"));
  const filePath = path.join(configRoot, "main-device.json");
  await writeFile(filePath, JSON.stringify(content), "utf8");
  return filePath;
}
