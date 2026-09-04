import { describe, expect, it } from "vitest";

import {
  desktopCancelTerminalPairingRequestSchema,
  desktopExportDiagnosticsRequestSchema,
  desktopExportDiagnosticsResponseSchema,
  desktopManualEndpointRequestSchema,
  desktopOpenSupportRequestSchema,
  desktopOpenSupportResponseSchema,
  desktopPairingInvitationRequestSchema,
  desktopReportRendererIncidentRequestSchema,
  desktopReportRendererIncidentResponseSchema,
  desktopStartupConfigRequestSchema,
  desktopStartupConfigResponseSchema,
  desktopSubmitDiagnosticsRequestSchema,
  desktopSubmitDiagnosticsResponseSchema,
  desktopTerminalPairingStateRequestSchema,
  terminalPairingStateResponseSchema,
} from "./index.js";

const installationId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const deviceId = "0192f0a0-1c2d-7e3f-8a4b-5c6d7e8f9a0c";

describe("desktop preload contract", () => {
  it("accepts the startup configuration exchange for both device roles", () => {
    expect(desktopStartupConfigRequestSchema.parse({})).toEqual({});
    for (const role of ["main", "terminal"] as const) {
      expect(
        desktopStartupConfigResponseSchema.parse({
          localApiOrigin: "http://127.0.0.1:31310",
          role,
        }),
      ).toEqual({ localApiOrigin: "http://127.0.0.1:31310", role });
    }
  });

  it.each([
    { request: "generic" },
    { channel: "arbitrary" },
    { path: "/tmp/breev" },
  ])("rejects generic or privileged request fields", (payload) => {
    expect(() => desktopStartupConfigRequestSchema.parse(payload)).toThrow();
    expect(() =>
      desktopTerminalPairingStateRequestSchema.parse(payload),
    ).toThrow();
    expect(() =>
      desktopCancelTerminalPairingRequestSchema.parse(payload),
    ).toThrow();
  });

  it.each([
    "file:///tmp/breev",
    "https://example.com",
    "http://localhost:31310",
    "http://127.0.0.1:31310/health",
    "http://user:secret@127.0.0.1:31310",
    "https://192.168.1.5:31311",
  ])("rejects an unsafe local API origin: %s", (localApiOrigin) => {
    expect(() =>
      desktopStartupConfigResponseSchema.parse({
        localApiOrigin,
        role: "terminal",
      }),
    ).toThrow();
  });

  it.each(["main-pharmacy", "", "MAIN", "terminal "])(
    "rejects an unknown device role: %s",
    (role) => {
      expect(() =>
        desktopStartupConfigResponseSchema.parse({
          localApiOrigin: "http://127.0.0.1:31310",
          role,
        }),
      ).toThrow();
    },
  );

  it("accepts every terminal pairing stage the renderer must render", () => {
    const candidates = [
      {
        host: "192.168.1.5",
        installationId,
        name: "breev-0192f0a0",
        port: 31_311,
      },
    ];
    const endpoint = { host: "192.168.1.5", port: 31_311 };

    expect(
      terminalPairingStateResponseSchema.parse({
        candidates,
        stage: "awaiting-invitation",
      }).stage,
    ).toBe("awaiting-invitation");
    expect(
      terminalPairingStateResponseSchema.parse({
        candidates: [],
        deviceName: "Counter 2",
        endpoint,
        fingerprintDigits: "012345678901",
        stage: "awaiting-confirmation",
      }).stage,
    ).toBe("awaiting-confirmation");
    expect(
      terminalPairingStateResponseSchema.parse({
        candidates: [],
        deviceId,
        endpoint,
        installationId,
        stage: "paired",
      }).stage,
    ).toBe("paired");
    expect(
      terminalPairingStateResponseSchema.parse({
        candidates: [],
        endpoint: null,
        reason: "invitation-invalid",
        stage: "failed",
      }).stage,
    ).toBe("failed");
    const keyProtectionFailure = terminalPairingStateResponseSchema.parse({
      candidates: [],
      endpoint: null,
      reason: "key-protection-unavailable",
      stage: "failed",
    });
    expect(
      keyProtectionFailure.stage === "failed"
        ? keyProtectionFailure.reason
        : undefined,
    ).toBe("key-protection-unavailable");
  });

  it.each([
    {
      candidates: [],
      deviceName: "Counter 2",
      endpoint: { host: "192.168.1.5", port: 31_311 },
      fingerprintDigits: "12345",
      stage: "awaiting-confirmation",
    },
    {
      candidates: [],
      endpoint: { host: "192.168.1.5", port: 31_311 },
      reason: "unknown-reason",
      stage: "failed",
    },
    { candidates: [], stage: "unknown-stage" },
    {
      candidates: [{ host: "192.168.1.5", port: 31_311 }],
      stage: "awaiting-invitation",
    },
  ])("rejects a malformed terminal pairing state", (payload) => {
    expect(() => terminalPairingStateResponseSchema.parse(payload)).toThrow();
  });

  it("accepts an invitation and a manual endpoint only in their exact shape", () => {
    expect(
      desktopPairingInvitationRequestSchema.parse({
        invitation: "breev-pair://1/x",
      }),
    ).toEqual({ invitation: "breev-pair://1/x" });
    expect(
      desktopManualEndpointRequestSchema.parse({
        host: "192.168.1.5",
        invitation: "breev-pair://1/x",
        port: 31_311,
      }),
    ).toEqual({
      host: "192.168.1.5",
      invitation: "breev-pair://1/x",
      port: 31_311,
    });
  });

  it("accepts only a closed, non-sensitive renderer incident summary", () => {
    expect(
      desktopReportRendererIncidentRequestSchema.parse({
        code: "VIEW-0123ABCD",
        source: "workspace",
      }),
    ).toEqual({ code: "VIEW-0123ABCD", source: "workspace" });
    expect(
      desktopReportRendererIncidentResponseSchema.parse({ accepted: true }),
    ).toEqual({ accepted: true });
  });

  it("keeps diagnostic export pathless and returns no local path", () => {
    expect(desktopExportDiagnosticsRequestSchema.parse({})).toEqual({});
    expect(
      desktopExportDiagnosticsRequestSchema.parse({
        incidentCode: "MAIN-0123ABCD",
      }),
    ).toEqual({ incidentCode: "MAIN-0123ABCD" });
    expect(
      desktopExportDiagnosticsResponseSchema.parse({
        status: "saved",
      }),
    ).toEqual({ status: "saved" });
    expect(() =>
      desktopExportDiagnosticsRequestSchema.parse({
        path: "C:\\Users\\patient-name-canary\\Desktop",
      }),
    ).toThrow();
    expect(() =>
      desktopExportDiagnosticsResponseSchema.parse({
        path: "C:\\Users\\Cashier\\Desktop",
        status: "saved",
      }),
    ).toThrow();
  });

  it("accepts only a locale and optional safe code for support", () => {
    expect(
      desktopOpenSupportRequestSchema.parse({
        incidentCode: "APP-0123ABCD",
        locale: "ar",
      }),
    ).toEqual({ incidentCode: "APP-0123ABCD", locale: "ar" });
    expect(
      desktopOpenSupportResponseSchema.parse({
        channel: "email",
        status: "opened",
      }),
    ).toEqual({ channel: "email", status: "opened" });
    expect(() =>
      desktopOpenSupportRequestSchema.parse({
        locale: "en",
        url: "https://attacker.example",
      }),
    ).toThrow();
  });

  it("keeps central submission manual and free of arbitrary payloads", () => {
    expect(desktopSubmitDiagnosticsRequestSchema.parse({})).toEqual({});
    expect(
      desktopSubmitDiagnosticsResponseSchema.parse({
        reportId: "0123456789abcdef0123456789abcdef",
        status: "submitted",
      }),
    ).toEqual({
      reportId: "0123456789abcdef0123456789abcdef",
      status: "submitted",
    });
    expect(() =>
      desktopSubmitDiagnosticsResponseSchema.parse({
        reportId: "unsafe-reference",
        status: "submitted",
      }),
    ).toThrow();
    expect(() =>
      desktopSubmitDiagnosticsRequestSchema.parse({
        bundle: { patientName: "patient-name-canary" },
      }),
    ).toThrow();
  });

  it.each([
    { code: "VIEW-0123ABCD", source: "workspace", stack: "patient canary" },
    { code: "VIEW-0123ABCD", message: "patient canary", source: "workspace" },
    { code: "view-0123abcd", source: "workspace" },
    { code: "VIEW-0123ABCD", source: "catalog" },
    { code: "patient canary", source: "workspace" },
  ])("rejects a widened renderer incident: %j", (payload) => {
    expect(() =>
      desktopReportRendererIncidentRequestSchema.parse(payload),
    ).toThrow();
  });

  it.each([
    { host: "192.168.1.5", port: 31_311 },
    { host: "192.168.1.5", invitation: "breev-pair://1/x", port: 0 },
    { host: "192.168.1.5", invitation: "breev-pair://1/x", port: 70_000 },
    { host: "192.168.1.5", invitation: "breev-pair://1/x", port: 31_311.5 },
    { host: "", invitation: "breev-pair://1/x", port: 31_311 },
    {
      host: "192.168.1.5",
      invitation: "x".repeat(2_049),
      port: 31_311,
    },
  ])("rejects a manual endpoint that omits or widens a field", (payload) => {
    expect(() => desktopManualEndpointRequestSchema.parse(payload)).toThrow();
  });
});
