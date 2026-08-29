import { describe, expect, it, vi } from "vitest";

import { createBreevDesktopApi } from "./api.js";

const startupConfig = {
  localApiOrigin: "http://127.0.0.1:31310",
  role: "main" as const,
};
const pairingState = {
  candidates: [],
  stage: "awaiting-invitation" as const,
};

describe("desktop preload API", () => {
  it("exposes exactly the named asynchronous methods the shell needs", async () => {
    const invoke = vi.fn().mockResolvedValue(startupConfig);
    const api = createBreevDesktopApi(invoke);

    expect(Object.keys(api)).toEqual([
      "cancelTerminalPairing",
      "getStartupConfig",
      "getTerminalPairingState",
      "submitManualEndpoint",
      "submitPairingInvitation",
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    await expect(api.getStartupConfig()).resolves.toEqual(startupConfig);
    expect(invoke).toHaveBeenCalledWith("breev:desktop:get-startup-config", {});
  });

  it("names one channel per method and never accepts one from the renderer", async () => {
    const invoke = vi.fn().mockResolvedValue(pairingState);
    const api = createBreevDesktopApi(invoke);

    await api.getTerminalPairingState();
    await api.cancelTerminalPairing();
    await api.submitPairingInvitation({ invitation: "breev-pair://1/x" });
    await api.submitManualEndpoint({
      host: "192.168.1.5",
      invitation: "breev-pair://1/x",
      port: 31_311,
    });

    expect(invoke.mock.calls).toEqual([
      ["breev:desktop:get-terminal-pairing-state", {}],
      ["breev:desktop:cancel-terminal-pairing", {}],
      [
        "breev:desktop:submit-pairing-invitation",
        { invitation: "breev-pair://1/x" },
      ],
      [
        "breev:desktop:submit-manual-endpoint",
        { host: "192.168.1.5", invitation: "breev-pair://1/x", port: 31_311 },
      ],
    ]);
  });

  it.each([
    "getStartupConfig",
    "getTerminalPairingState",
    "cancelTerminalPairing",
  ] as const)(
    "rejects generic arguments to %s before they cross IPC",
    async (method) => {
      const invoke = vi.fn();
      const api = createBreevDesktopApi(invoke);

      await expect(
        Reflect.apply(api[method], api, [{ channel: "generic" }]),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ invitation: "breev-pair://1/x", extra: "x" }],
    [{ invitation: "x".repeat(2_049) }],
    [{ invitation: 5 }],
    [{}],
    [undefined],
  ])("rejects a widened pairing invitation request", async (request) => {
    const invoke = vi.fn();
    const api = createBreevDesktopApi(invoke);

    await expect(
      api.submitPairingInvitation(request as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    [{ host: "192.168.1.5", invitation: "breev-pair://1/x" }],
    [{ host: "192.168.1.5", invitation: "breev-pair://1/x", port: 0 }],
    [{ host: "192.168.1.5", invitation: "breev-pair://1/x", port: "31311" }],
    [{ host: "", invitation: "breev-pair://1/x", port: 31_311 }],
  ])("rejects a widened manual endpoint request", async (request) => {
    const invoke = vi.fn();
    const api = createBreevDesktopApi(invoke);

    await expect(api.submitManualEndpoint(request as never)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects extra arguments beside a valid request", async () => {
    const invoke = vi.fn();
    const api = createBreevDesktopApi(invoke);

    await expect(
      Reflect.apply(api.submitPairingInvitation, api, [
        { invitation: "breev-pair://1/x" },
        { channel: "generic" },
      ]),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects an invalid response from main", async () => {
    const api = createBreevDesktopApi(
      vi
        .fn()
        .mockResolvedValue({ localApiOrigin: "file:///etc", role: "main" }),
    );

    await expect(api.getStartupConfig()).rejects.toThrow();
  });

  it("rejects a pairing state main could not have produced", async () => {
    const api = createBreevDesktopApi(
      vi.fn().mockResolvedValue({ candidates: [], stage: "compromised" }),
    );

    await expect(api.getTerminalPairingState()).rejects.toThrow();
  });
});
