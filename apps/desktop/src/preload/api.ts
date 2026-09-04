import {
  DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL,
  DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL,
  DESKTOP_MANUAL_ENDPOINT_CHANNEL,
  DESKTOP_OPEN_SUPPORT_CHANNEL,
  DESKTOP_PAIRING_INVITATION_CHANNEL,
  DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL,
  DESKTOP_STARTUP_CONFIG_CHANNEL,
  DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL,
  DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL,
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
  type BreevDesktopApi,
} from "@breev/contracts/desktop-preload";

type Invoke = (channel: string, payload: unknown) => Promise<unknown>;

/**
 * Named asynchronous methods only. Each one validates its request before it
 * crosses IPC and its response after, so neither side trusts the other's
 * shape, and no channel name, path, or generic request reaches the renderer.
 */
export function createBreevDesktopApi(invoke: Invoke): BreevDesktopApi {
  return Object.freeze({
    cancelTerminalPairing: async (...arguments_: unknown[]) => {
      assertNoArguments("cancelTerminalPairing", arguments_);
      return terminalPairingStateResponseSchema.parse(
        await invoke(
          DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL,
          desktopCancelTerminalPairingRequestSchema.parse({}),
        ),
      );
    },
    exportDiagnostics: async (...arguments_: unknown[]) => {
      assertSingleArgument("exportDiagnostics", arguments_);
      return desktopExportDiagnosticsResponseSchema.parse(
        await invoke(
          DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL,
          desktopExportDiagnosticsRequestSchema.parse(arguments_[0]),
        ),
      );
    },
    getStartupConfig: async (...arguments_: unknown[]) => {
      assertNoArguments("getStartupConfig", arguments_);
      return desktopStartupConfigResponseSchema.parse(
        await invoke(
          DESKTOP_STARTUP_CONFIG_CHANNEL,
          desktopStartupConfigRequestSchema.parse({}),
        ),
      );
    },
    getTerminalPairingState: async (...arguments_: unknown[]) => {
      assertNoArguments("getTerminalPairingState", arguments_);
      return terminalPairingStateResponseSchema.parse(
        await invoke(
          DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL,
          desktopTerminalPairingStateRequestSchema.parse({}),
        ),
      );
    },
    openSupport: async (...arguments_: unknown[]) => {
      assertSingleArgument("openSupport", arguments_);
      return desktopOpenSupportResponseSchema.parse(
        await invoke(
          DESKTOP_OPEN_SUPPORT_CHANNEL,
          desktopOpenSupportRequestSchema.parse(arguments_[0]),
        ),
      );
    },
    reportRendererIncident: async (...arguments_: unknown[]) => {
      assertSingleArgument("reportRendererIncident", arguments_);
      return desktopReportRendererIncidentResponseSchema.parse(
        await invoke(
          DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL,
          desktopReportRendererIncidentRequestSchema.parse(arguments_[0]),
        ),
      );
    },
    submitManualEndpoint: async (...arguments_: unknown[]) => {
      assertSingleArgument("submitManualEndpoint", arguments_);
      return terminalPairingStateResponseSchema.parse(
        await invoke(
          DESKTOP_MANUAL_ENDPOINT_CHANNEL,
          desktopManualEndpointRequestSchema.parse(arguments_[0]),
        ),
      );
    },
    submitDiagnostics: async (...arguments_: unknown[]) => {
      assertSingleArgument("submitDiagnostics", arguments_);
      return desktopSubmitDiagnosticsResponseSchema.parse(
        await invoke(
          DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL,
          desktopSubmitDiagnosticsRequestSchema.parse(arguments_[0]),
        ),
      );
    },
    submitPairingInvitation: async (...arguments_: unknown[]) => {
      assertSingleArgument("submitPairingInvitation", arguments_);
      return terminalPairingStateResponseSchema.parse(
        await invoke(
          DESKTOP_PAIRING_INVITATION_CHANNEL,
          desktopPairingInvitationRequestSchema.parse(arguments_[0]),
        ),
      );
    },
  });
}

function assertNoArguments(name: string, arguments_: unknown[]): void {
  if (arguments_.length !== 0) {
    throw new Error(`${name} does not accept arguments`);
  }
}

function assertSingleArgument(name: string, arguments_: unknown[]): void {
  if (arguments_.length !== 1) {
    throw new Error(`${name} accepts exactly one request`);
  }
}
