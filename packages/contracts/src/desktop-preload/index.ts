import { z } from "zod";

export const DESKTOP_API_GLOBAL = "breevDesktop" as const;

export const DESKTOP_COPY_IDENTIFIER_CHANNEL =
  "breev:desktop:copy-identifier" as const;
export const DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL =
  "breev:desktop:cancel-terminal-pairing" as const;
export const DESKTOP_EXPORT_DIAGNOSTICS_CHANNEL =
  "breev:desktop:export-diagnostics" as const;
export const DESKTOP_MANUAL_ENDPOINT_CHANNEL =
  "breev:desktop:submit-manual-endpoint" as const;
export const DESKTOP_OPEN_SUPPORT_CHANNEL =
  "breev:desktop:open-support" as const;
export const DESKTOP_PAIRING_INVITATION_CHANNEL =
  "breev:desktop:submit-pairing-invitation" as const;
export const DESKTOP_REPORT_RENDERER_INCIDENT_CHANNEL =
  "breev:desktop:report-renderer-incident" as const;
export const DESKTOP_STARTUP_CONFIG_CHANNEL =
  "breev:desktop:get-startup-config" as const;
export const DESKTOP_SUBMIT_DIAGNOSTICS_CHANNEL =
  "breev:desktop:submit-diagnostics" as const;
export const DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL =
  "breev:desktop:get-terminal-pairing-state" as const;

export const DESKTOP_DEVICE_ROLES = ["main", "terminal"] as const;

export const desktopDeviceRoleSchema = z.enum(DESKTOP_DEVICE_ROLES);

export const desktopStartupConfigRequestSchema = z.strictObject({});

export const desktopCopyIdentifierRequestSchema = z.strictObject({
  identifier: z.uuid(),
});

export const desktopCopyIdentifierResponseSchema = z.strictObject({
  copied: z.literal(true),
});

/**
 * A terminal reaches the Main installation through a loopback bridge that
 * Electron main owns, so the renderer keeps one loopback HTTP origin in both
 * roles and the content security policy never has to admit a LAN origin.
 */
export const desktopStartupConfigResponseSchema = z.strictObject({
  deviceId: z.uuidv7().optional(),
  installationId: z.uuid().optional(),
  localApiOrigin: z.string().max(128).refine(isLocalApiOrigin),
  role: desktopDeviceRoleSchema,
});

export const TERMINAL_PAIRING_STAGES = [
  "awaiting-confirmation",
  "awaiting-invitation",
  "failed",
  "fetching-certificate",
  "generating-key",
  "joining",
  "paired",
  "validating-endpoint",
] as const;

/**
 * `key-protection-unavailable` is the only member a retry cannot clear: the
 * terminal refuses to hold its private key where this machine's key store
 * cannot protect it, so the operator has to repair the machine before pairing
 * is possible at all.
 */
export const TERMINAL_PAIRING_FAILURE_REASONS = [
  "attempts-exceeded",
  "cancelled",
  "certificate-invalid",
  "certificate-storage-failed",
  "endpoint-unreachable",
  "entitlement-missing",
  "invitation-invalid",
  "key-protection-unavailable",
  "seat-unavailable",
  "server-identity-rejected",
  "session-cancelled",
  "session-denied",
  "session-expired",
  "unexpected",
] as const;

export const terminalPairingStageSchema = z.enum(TERMINAL_PAIRING_STAGES);

export const terminalPairingFailureReasonSchema = z.enum(
  TERMINAL_PAIRING_FAILURE_REASONS,
);

export const terminalPairingEndpointSchema = z.strictObject({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
});

/**
 * mDNS answers are location hints only. Nothing in a candidate is trusted:
 * the invitation still supplies the session, the join secret, and the
 * certificate-authority pin.
 */
export const terminalDiscoveryCandidateSchema = z.strictObject({
  host: z.string().min(1).max(255),
  installationId: z.uuidv7(),
  name: z.string().min(1).max(64),
  port: z.number().int().min(1).max(65_535),
});

const terminalPairingDigitsSchema = z.string().regex(/^\d{12}$/u);

const terminalPairingCandidatesSchema = z
  .array(terminalDiscoveryCandidateSchema)
  .max(16);

export const terminalPairingStateResponseSchema = z.discriminatedUnion(
  "stage",
  [
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      stage: z.literal("awaiting-invitation"),
    }),
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      endpoint: terminalPairingEndpointSchema,
      stage: z.literal("validating-endpoint"),
    }),
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      endpoint: terminalPairingEndpointSchema,
      stage: z.literal("generating-key"),
    }),
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      endpoint: terminalPairingEndpointSchema,
      stage: z.literal("joining"),
    }),
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      deviceName: z.string().min(1).max(64),
      endpoint: terminalPairingEndpointSchema,
      fingerprintDigits: terminalPairingDigitsSchema,
      stage: z.literal("awaiting-confirmation"),
    }),
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      endpoint: terminalPairingEndpointSchema,
      fingerprintDigits: terminalPairingDigitsSchema,
      stage: z.literal("fetching-certificate"),
    }),
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      deviceId: z.uuidv7(),
      endpoint: terminalPairingEndpointSchema,
      installationId: z.uuidv7(),
      stage: z.literal("paired"),
    }),
    z.strictObject({
      candidates: terminalPairingCandidatesSchema,
      endpoint: terminalPairingEndpointSchema.nullable(),
      reason: terminalPairingFailureReasonSchema,
      stage: z.literal("failed"),
    }),
  ],
);

export const desktopTerminalPairingStateRequestSchema = z.strictObject({});

export const desktopPairingInvitationRequestSchema = z.strictObject({
  invitation: z.string().min(1).max(2_048),
});

/**
 * Manual entry and discovery replace the endpoint only. The operator still
 * supplies the invitation, so no path reaches the Main installation without
 * the session, the join secret, and the pin the invitation carries.
 */
export const desktopManualEndpointRequestSchema = z.strictObject({
  host: z.string().min(1).max(255),
  invitation: z.string().min(1).max(2_048),
  port: z.number().int().min(1).max(65_535),
});

export const desktopCancelTerminalPairingRequestSchema = z.strictObject({});

export const desktopExportDiagnosticsRequestSchema = z.strictObject({
  incidentCode: z
    .string()
    .regex(/^(?:APP|ASYNC|BOOT|MAIN|VIEW)-[0-9A-F]{8}$/u)
    .optional(),
});

export const desktopExportDiagnosticsResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("cancelled") }),
    z.strictObject({
      code: z.literal("export-failed"),
      status: z.literal("failed"),
    }),
    z.strictObject({ status: z.literal("saved") }),
  ],
);

export const desktopOpenSupportRequestSchema = z.strictObject({
  incidentCode: z
    .string()
    .regex(/^(?:APP|ASYNC|BOOT|MAIN|VIEW)-[0-9A-F]{8}$/u)
    .optional(),
  locale: z.enum(["ar", "en"]),
});

export const desktopOpenSupportResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    channel: z.enum(["email", "portal"]),
    status: z.literal("opened"),
  }),
  z.strictObject({ status: z.literal("unavailable") }),
  z.strictObject({
    code: z.literal("open-failed"),
    status: z.literal("failed"),
  }),
]);

export const desktopSubmitDiagnosticsRequestSchema = z.strictObject({
  incidentCode: z
    .string()
    .regex(/^(?:APP|ASYNC|BOOT|MAIN|VIEW)-[0-9A-F]{8}$/u)
    .optional(),
});

export const desktopSubmitDiagnosticsResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      reportId: z.string().regex(/^[0-9a-f]{32}$/u),
      status: z.literal("submitted"),
    }),
    z.strictObject({ status: z.literal("unavailable") }),
    z.strictObject({
      code: z.literal("submit-failed"),
      status: z.literal("failed"),
    }),
  ],
);

export const RENDERER_INCIDENT_SOURCES = [
  "application",
  "bootstrap",
  "global-error",
  "unhandled-rejection",
  "workspace",
] as const;

export const rendererIncidentSourceSchema = z.enum(RENDERER_INCIDENT_SOURCES);

export const desktopReportRendererIncidentRequestSchema = z.strictObject({
  code: z.string().regex(/^(?:APP|ASYNC|BOOT|VIEW)-[0-9A-F]{8}$/u),
  source: rendererIncidentSourceSchema,
});

export const desktopReportRendererIncidentResponseSchema = z.strictObject({
  accepted: z.literal(true),
});

export type DesktopDeviceRole = z.infer<typeof desktopDeviceRoleSchema>;
export type DesktopCopyIdentifierRequest = z.infer<
  typeof desktopCopyIdentifierRequestSchema
>;
export type DesktopCopyIdentifierResponse = z.infer<
  typeof desktopCopyIdentifierResponseSchema
>;
export type DesktopStartupConfigRequest = z.infer<
  typeof desktopStartupConfigRequestSchema
>;
export type DesktopStartupConfig = z.infer<
  typeof desktopStartupConfigResponseSchema
>;
export type TerminalPairingStage = z.infer<typeof terminalPairingStageSchema>;
export type TerminalPairingFailureReason = z.infer<
  typeof terminalPairingFailureReasonSchema
>;
export type TerminalPairingEndpoint = z.infer<
  typeof terminalPairingEndpointSchema
>;
export type TerminalDiscoveryCandidate = z.infer<
  typeof terminalDiscoveryCandidateSchema
>;
export type TerminalPairingState = z.infer<
  typeof terminalPairingStateResponseSchema
>;
export type DesktopTerminalPairingStateRequest = z.infer<
  typeof desktopTerminalPairingStateRequestSchema
>;
export type DesktopPairingInvitationRequest = z.infer<
  typeof desktopPairingInvitationRequestSchema
>;
export type DesktopManualEndpointRequest = z.infer<
  typeof desktopManualEndpointRequestSchema
>;
export type DesktopCancelTerminalPairingRequest = z.infer<
  typeof desktopCancelTerminalPairingRequestSchema
>;
export type DesktopExportDiagnosticsRequest = z.infer<
  typeof desktopExportDiagnosticsRequestSchema
>;
export type DesktopExportDiagnosticsResponse = z.infer<
  typeof desktopExportDiagnosticsResponseSchema
>;
export type DesktopOpenSupportRequest = z.infer<
  typeof desktopOpenSupportRequestSchema
>;
export type DesktopOpenSupportResponse = z.infer<
  typeof desktopOpenSupportResponseSchema
>;
export type DesktopSubmitDiagnosticsRequest = z.infer<
  typeof desktopSubmitDiagnosticsRequestSchema
>;
export type DesktopSubmitDiagnosticsResponse = z.infer<
  typeof desktopSubmitDiagnosticsResponseSchema
>;
export type RendererIncidentSource = z.infer<
  typeof rendererIncidentSourceSchema
>;
export type DesktopReportRendererIncidentRequest = z.infer<
  typeof desktopReportRendererIncidentRequestSchema
>;
export type DesktopReportRendererIncidentResponse = z.infer<
  typeof desktopReportRendererIncidentResponseSchema
>;

export interface BreevDesktopApi {
  cancelTerminalPairing(): Promise<TerminalPairingState>;
  copyIdentifier(
    request: DesktopCopyIdentifierRequest,
  ): Promise<DesktopCopyIdentifierResponse>;
  exportDiagnostics(
    request: DesktopExportDiagnosticsRequest,
  ): Promise<DesktopExportDiagnosticsResponse>;
  getStartupConfig(): Promise<DesktopStartupConfig>;
  getTerminalPairingState(): Promise<TerminalPairingState>;
  openSupport(
    request: DesktopOpenSupportRequest,
  ): Promise<DesktopOpenSupportResponse>;
  reportRendererIncident(
    request: DesktopReportRendererIncidentRequest,
  ): Promise<DesktopReportRendererIncidentResponse>;
  submitManualEndpoint(
    request: DesktopManualEndpointRequest,
  ): Promise<TerminalPairingState>;
  submitDiagnostics(
    request: DesktopSubmitDiagnosticsRequest,
  ): Promise<DesktopSubmitDiagnosticsResponse>;
  submitPairingInvitation(
    request: DesktopPairingInvitationRequest,
  ): Promise<TerminalPairingState>;
}

function isLocalApiOrigin(value: string): boolean {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/u.exec(value);
  return match !== null && Number(match[1]) <= 65_535;
}
