import {
  DESKTOP_ABORT_INVENTORY_EXPORT_CHANNEL,
  DESKTOP_APPEND_INVENTORY_EXPORT_CHANNEL,
  DESKTOP_BEGIN_INVENTORY_EXPORT_CHANNEL,
  DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL,
  DESKTOP_COPY_IDENTIFIER_CHANNEL,
  DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL,
  DESKTOP_FINISH_INVENTORY_EXPORT_CHANNEL,
  INVENTORY_EXPORT_CHUNK_BYTES,
  MAXIMUM_INVENTORY_EXPORT_BYTES,
  DESKTOP_MANUAL_ENDPOINT_CHANNEL,
  DESKTOP_OPEN_SUPPORT_CHANNEL,
  DESKTOP_PAIRING_INVITATION_CHANNEL,
  DESKTOP_PRINT_BARCODE_LABEL_CHANNEL,
  DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL,
  DESKTOP_STARTUP_CONFIG_CHANNEL,
  DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL,
  DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL,
  desktopCancelTerminalPairingRequestSchema,
  desktopCopyIdentifierRequestSchema,
  desktopCopyIdentifierResponseSchema,
  desktopExportDiagnosticsRequestSchema,
  desktopExportDiagnosticsResponseSchema,
  desktopAbortInventoryExportRequestSchema,
  desktopAppendInventoryExportRequestSchema,
  desktopAppendInventoryExportResponseSchema,
  desktopBeginInventoryExportRequestSchema,
  desktopBeginInventoryExportResponseSchema,
  desktopFinishInventoryExportRequestSchema,
  desktopSaveInventoryExportRequestSchema,
  desktopSaveInventoryExportResponseSchema,
  desktopManualEndpointRequestSchema,
  desktopOpenSupportRequestSchema,
  desktopOpenSupportResponseSchema,
  desktopPairingInvitationRequestSchema,
  desktopBarcodePrintRequestSchema,
  desktopBarcodePrintResponseSchema,
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

import { serializeInventoryCsv } from "../main/inventory-export-csv.js";
import { serializeInventoryReportCsv } from "../main/inventory-report-csv.js";

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
    copyIdentifier: async (...arguments_: unknown[]) => {
      assertSingleArgument("copyIdentifier", arguments_);
      return desktopCopyIdentifierResponseSchema.parse(
        await invoke(
          DESKTOP_COPY_IDENTIFIER_CHANNEL,
          desktopCopyIdentifierRequestSchema.parse(arguments_[0]),
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
    saveInventoryExport: async (...arguments_: unknown[]) => {
      assertSingleArgument("saveInventoryExport", arguments_);
      const request = desktopSaveInventoryExportRequestSchema.parse(
        arguments_[0],
      );
      const began = desktopBeginInventoryExportResponseSchema.parse(
        await invoke(
          DESKTOP_BEGIN_INVENTORY_EXPORT_CHANNEL,
          desktopBeginInventoryExportRequestSchema.parse({
            locale: request.locale,
            ...(request.format === undefined ? {} : { format: request.format }),
          }),
        ),
      );
      if (began.status !== "opened") return began;
      const serialized =
        request.format === "csv"
          ? "kind" in request.bundle
            ? serializeInventoryReportCsv(request.bundle, request.locale)
            : serializeInventoryCsv(request.bundle)
          : JSON.stringify(request.bundle, null, 2) + "\n";
      if (
        Buffer.byteLength(serialized, "utf8") > MAXIMUM_INVENTORY_EXPORT_BYTES
      ) {
        await invoke(
          DESKTOP_ABORT_INVENTORY_EXPORT_CHANNEL,
          desktopAbortInventoryExportRequestSchema.parse({}),
        );
        return desktopSaveInventoryExportResponseSchema.parse({
          status: "export-too-large",
        });
      }
      for (const chunk of exportChunks(
        serialized,
        INVENTORY_EXPORT_CHUNK_BYTES,
      )) {
        const appended = desktopAppendInventoryExportResponseSchema.parse(
          await invoke(
            DESKTOP_APPEND_INVENTORY_EXPORT_CHANNEL,
            desktopAppendInventoryExportRequestSchema.parse({ chunk }),
          ),
        );
        if (appended.status !== "appended") return appended;
      }
      return desktopSaveInventoryExportResponseSchema.parse(
        await invoke(
          DESKTOP_FINISH_INVENTORY_EXPORT_CHANNEL,
          desktopFinishInventoryExportRequestSchema.parse({}),
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
    printBarcodeLabel: async (...arguments_: unknown[]) => {
      assertSingleArgument("printBarcodeLabel", arguments_);
      return desktopBarcodePrintResponseSchema.parse(
        await invoke(
          DESKTOP_PRINT_BARCODE_LABEL_CHANNEL,
          desktopBarcodePrintRequestSchema.parse(arguments_[0]),
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

export function exportChunks(value: string, maximumBytes: number): string[] {
  const buffer = Buffer.from(value, "utf8");
  const chunks: string[] = [];
  let start = 0;
  while (start < buffer.length) {
    let end = Math.min(start + maximumBytes, buffer.length);
    while (
      end > start &&
      end < buffer.length &&
      (buffer[end]! & 0b1100_0000) === 0b1000_0000
    ) {
      end -= 1;
    }
    chunks.push(buffer.subarray(start, end).toString("utf8"));
    start = end;
  }
  return chunks;
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
