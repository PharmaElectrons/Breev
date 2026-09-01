import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  INSTALLED_DEVICE_ROLE_FILE,
  readDeviceRole,
  readTerminalDeviceName,
  resolveDesktopDeviceRole,
  resolveTerminalStateDirectory,
} from "./terminal-role.js";

const temporaryDirectories: string[] = [];

function createProgramData(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "breev-role-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createConfigurationDirectory(programData: string): string {
  const directory = path.join(programData, "Breev", "config");
  mkdirSync(directory, { recursive: true });
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("device role", () => {
  it.each([{}, { BREEV_DEVICE_ROLE: "" }, { BREEV_DEVICE_ROLE: "main" }])(
    "keeps the Main Pharmacy Computer behavior by default",
    (environment) => {
      expect(readDeviceRole(environment)).toBe("main");
    },
  );

  it("opts into the terminal runtime only on the exact word", () => {
    expect(readDeviceRole({ BREEV_DEVICE_ROLE: "terminal" })).toBe("terminal");
  });

  it.each(["Terminal", "terminal ", "pos", "main,terminal", "TERMINAL"])(
    "refuses an unknown role rather than guessing: %s",
    (value) => {
      expect(() => readDeviceRole({ BREEV_DEVICE_ROLE: value })).toThrow();
    },
  );
});

describe("installed Windows device role", () => {
  it.each([
    ["main" as const, "terminal"],
    ["terminal" as const, "main"],
  ])(
    "uses the installer-owned %s role instead of the process environment",
    (installedRole, environmentRole) => {
      const programData = createProgramData();
      const configurationDirectory = createConfigurationDirectory(programData);
      writeFileSync(
        path.join(configurationDirectory, INSTALLED_DEVICE_ROLE_FILE),
        installedRole,
        "utf8",
      );

      expect(
        resolveDesktopDeviceRole(
          {
            BREEV_DEVICE_ROLE: environmentRole,
            ProgramData: programData,
          },
          { isPackaged: true, platform: "win32" },
        ),
      ).toBe(installedRole);
    },
  );

  it("keeps an existing Main installation on Main when no role state exists", () => {
    const programData = createProgramData();

    expect(
      resolveDesktopDeviceRole(
        { BREEV_DEVICE_ROLE: "terminal", ProgramData: programData },
        { isPackaged: true, platform: "win32" },
      ),
    ).toBe("main");
  });

  it("requires repair when terminal state exists without a role file", () => {
    const programData = createProgramData();
    const configurationDirectory = createConfigurationDirectory(programData);
    mkdirSync(path.join(configurationDirectory, "terminal"));

    expect(() =>
      resolveDesktopDeviceRole(
        { ProgramData: programData },
        { isPackaged: true, platform: "win32" },
      ),
    ).toThrow(/repair/i);
  });

  it.each(["", "main\n", "Terminal", "pos"])(
    "requires repair for invalid installed role content: %j",
    (value) => {
      const programData = createProgramData();
      const configurationDirectory = createConfigurationDirectory(programData);
      writeFileSync(
        path.join(configurationDirectory, INSTALLED_DEVICE_ROLE_FILE),
        value,
        "utf8",
      );

      expect(() =>
        resolveDesktopDeviceRole(
          { ProgramData: programData },
          { isPackaged: true, platform: "win32" },
        ),
      ).toThrow(/repair/i);
    },
  );

  it("requires repair when the installed role cannot be read", () => {
    const programData = createProgramData();
    const configurationDirectory = createConfigurationDirectory(programData);
    mkdirSync(path.join(configurationDirectory, INSTALLED_DEVICE_ROLE_FILE));

    expect(() =>
      resolveDesktopDeviceRole(
        { ProgramData: programData },
        { isPackaged: true, platform: "win32" },
      ),
    ).toThrow(/cannot be read.*repair/i);
  });

  it("fails when ProgramData cannot be located", () => {
    expect(() =>
      resolveDesktopDeviceRole({}, { isPackaged: true, platform: "win32" }),
    ).toThrow(/ProgramData/);
  });

  it("keeps environment role selection for development", () => {
    expect(
      resolveDesktopDeviceRole(
        { BREEV_DEVICE_ROLE: "terminal" },
        { isPackaged: false, platform: "win32" },
      ),
    ).toBe("terminal");
  });
});

describe("terminal state directory", () => {
  it("uses the configured absolute directory on any platform", () => {
    expect(
      resolveTerminalStateDirectory(
        { BREEV_TERMINAL_STATE_DIR: "/var/lib/breev/terminal" },
        { platform: "linux" },
      ),
    ).toBe(path.resolve("/var/lib/breev/terminal"));
  });

  it("refuses a relative directory", () => {
    expect(() =>
      resolveTerminalStateDirectory(
        { BREEV_TERMINAL_STATE_DIR: "state" },
        { platform: "linux" },
      ),
    ).toThrow();
  });

  it("falls back to the service configuration directory on Windows", () => {
    expect(
      resolveTerminalStateDirectory(
        { ProgramData: "C:\\ProgramData" },
        { platform: "win32" },
      ),
    ).toBe(path.join("C:\\ProgramData", "Breev", "config", "terminal"));
  });

  it.each([
    [{}, "win32" as const],
    [{ ProgramData: "" }, "win32" as const],
    [{}, "linux" as const],
  ])(
    "fails loudly when no directory can be located",
    (environment, platform) => {
      expect(() =>
        resolveTerminalStateDirectory(environment, { platform }),
      ).toThrow();
    },
  );
});

describe("terminal device name", () => {
  it("prefers the configured name", () => {
    expect(
      readTerminalDeviceName(
        { BREEV_TERMINAL_DEVICE_NAME: "Counter 2" },
        "host-1",
      ),
    ).toBe("Counter 2");
  });

  it("falls back to the machine name", () => {
    expect(readTerminalDeviceName({}, "pharmacy-pos-1")).toBe("pharmacy-pos-1");
  });

  it("drops separators and bounds the length the Main screen shows", () => {
    expect(
      readTerminalDeviceName(
        { BREEV_TERMINAL_DEVICE_NAME: "  <b>Counter</b>\n2  " },
        "host",
      ),
    ).toBe("bCounterb2");
    expect(
      readTerminalDeviceName(
        { BREEV_TERMINAL_DEVICE_NAME: "n".repeat(200) },
        "host",
      ).length,
    ).toBe(64);
  });

  it("keeps an Arabic name intact", () => {
    expect(
      readTerminalDeviceName(
        { BREEV_TERMINAL_DEVICE_NAME: "الطرفية ٢" },
        "host",
      ),
    ).toBe("الطرفية ٢");
  });

  it("names an unnamed terminal rather than sending an empty string", () => {
    expect(
      readTerminalDeviceName({ BREEV_TERMINAL_DEVICE_NAME: "***" }, ""),
    ).toBe("Breev terminal");
  });
});
