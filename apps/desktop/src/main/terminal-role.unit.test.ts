import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  readDeviceRole,
  readTerminalDeviceName,
  resolveTerminalStateDirectory,
} from "./terminal-role.js";

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
