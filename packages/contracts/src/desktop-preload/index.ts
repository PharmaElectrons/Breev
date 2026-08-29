import { z } from "zod";

export const DESKTOP_API_GLOBAL = "breevDesktop" as const;

export const DESKTOP_CANCEL_TERMINAL_PAIRING_CHANNEL =
  "breev:desktop:cancel-terminal-pairing" as const;
export const DESKTOP_MANUAL_ENDPOINT_CHANNEL =
  "breev:desktop:submit-manual-endpoint" as const;
export const DESKTOP_PAIRING_INVITATION_CHANNEL =
  "breev:desktop:submit-pairing-invitation" as const;
export const DESKTOP_STARTUP_CONFIG_CHANNEL =
  "breev:desktop:get-startup-config" as const;
export const DESKTOP_TERMINAL_PAIRING_STATE_CHANNEL =
  "breev:desktop:get-terminal-pairing-state" as const;

export const DESKTOP_DEVICE_ROLES = ["main", "terminal"] as const;

export const desktopDeviceRoleSchema = z.enum(DESKTOP_DEVICE_ROLES);

export const desktopStartupConfigRequestSchema = z.strictObject({});

/**
 * A terminal reaches the Main installation through a loopback bridge that
 * Electron main owns, so the renderer keeps one loopback HTTP origin in both
 * roles and the content security policy never has to admit a LAN origin.
 */
export const desktopStartupConfigResponseSchema = z.strictObject({
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

export type DesktopDeviceRole = z.infer<typeof desktopDeviceRoleSchema>;
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

export interface BreevDesktopApi {
  cancelTerminalPairing(): Promise<TerminalPairingState>;
  getStartupConfig(): Promise<DesktopStartupConfig>;
  getTerminalPairingState(): Promise<TerminalPairingState>;
  submitManualEndpoint(
    request: DesktopManualEndpointRequest,
  ): Promise<TerminalPairingState>;
  submitPairingInvitation(
    request: DesktopPairingInvitationRequest,
  ): Promise<TerminalPairingState>;
}

function isLocalApiOrigin(value: string): boolean {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/u.exec(value);
  return match !== null && Number(match[1]) <= 65_535;
}
