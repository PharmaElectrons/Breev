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
      "copyIdentifier",
      "exportDiagnostics",
      "getStartupConfig",
      "getTerminalPairingState",
      "openSupport",
      "reportRendererIncident",
      "submitManualEndpoint",
      "submitDiagnostics",
      "submitPairingInvitation",
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    await expect(api.getStartupConfig()).resolves.toEqual(startupConfig);
    expect(invoke).toHaveBeenCalledWith("breev:desktop:get-startup-config", {});
  });

  it("names one channel per method and never accepts one from the renderer", async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === "breev:desktop:copy-identifier"
        ? { copied: true }
        : channel === "breev:desktop:report-renderer-incident"
          ? { accepted: true }
          : pairingState,
    );
    const api = createBreevDesktopApi(invoke);

    await api.copyIdentifier({
      identifier: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c",
    });
    await api.getTerminalPairingState();
    await api.cancelTerminalPairing();
    await api.reportRendererIncident({
      code: "VIEW-0123ABCD",
      source: "workspace",
    });
    await api.submitPairingInvitation({ invitation: "breev-pair://1/x" });
    await api.submitManualEndpoint({
      host: "192.168.1.5",
      invitation: "breev-pair://1/x",
      port: 31_311,
    });

    expect(invoke.mock.calls).toEqual([
      [
        "breev:desktop:copy-identifier",
        { identifier: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c" },
      ],
      ["breev:desktop:get-terminal-pairing-state", {}],
      ["breev:desktop:cancel-terminal-pairing", {}],
      [
        "breev:desktop:report-renderer-incident",
        { code: "VIEW-0123ABCD", source: "workspace" },
      ],
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
    [{ identifier: "not-a-uuid" }],
    [{ identifier: "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c", extra: true }],
    [{}],
    [undefined],
  ])("rejects a widened identifier copy request", async (request) => {
    const invoke = vi.fn();
    const api = createBreevDesktopApi(invoke);

    await expect(api.copyIdentifier(request as never)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
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

  it("rejects raw renderer error details before IPC", async () => {
    const invoke = vi.fn();
    const api = createBreevDesktopApi(invoke);

    await expect(
      api.reportRendererIncident({
        code: "VIEW-0123ABCD",
        source: "workspace",
        stack: "patient-name-canary",
      } as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("exports diagnostics through a pathless validated request", async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: "saved",
    });
    const api = createBreevDesktopApi(invoke);

    await expect(
      api.exportDiagnostics({ incidentCode: "VIEW-0123ABCD" }),
    ).resolves.toEqual({
      status: "saved",
    });
    expect(invoke).toHaveBeenCalledWith("breev:desktop:export-diagnostics", {
      incidentCode: "VIEW-0123ABCD",
    });
    await expect(
      api.exportDiagnostics({ path: "C:\\outside" } as never),
    ).rejects.toThrow();
  });

  it("opens only the main-owned configured support destination", async () => {
    const invoke = vi.fn().mockResolvedValue({
      channel: "portal",
      status: "opened",
    });
    const api = createBreevDesktopApi(invoke);
    await expect(api.openSupport({ locale: "en" })).resolves.toEqual({
      channel: "portal",
      status: "opened",
    });
    expect(invoke).toHaveBeenCalledWith("breev:desktop:open-support", {
      locale: "en",
    });
    await expect(
      api.openSupport({
        locale: "en",
        url: "https://attacker.example",
      } as never),
    ).rejects.toThrow();
  });

  it("submits only a safe incident reference to the central collector", async () => {
    const invoke = vi.fn().mockResolvedValue({
      reportId: "0123456789abcdef0123456789abcdef",
      status: "submitted",
    });
    const api = createBreevDesktopApi(invoke);
    await expect(
      api.submitDiagnostics({ incidentCode: "VIEW-0123ABCD" }),
    ).resolves.toEqual({
      reportId: "0123456789abcdef0123456789abcdef",
      status: "submitted",
    });
    expect(invoke).toHaveBeenCalledWith("breev:desktop:submit-diagnostics", {
      incidentCode: "VIEW-0123ABCD",
    });
    await expect(
      api.submitDiagnostics({ logs: ["patient-name-canary"] } as never),
    ).rejects.toThrow();
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
