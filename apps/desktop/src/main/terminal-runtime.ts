import type {
  DesktopManualEndpointRequest,
  TerminalDiscoveryCandidate,
  TerminalPairingFailureReason,
  TerminalPairingState,
} from "@breev/contracts/desktop-preload";
import type { Agent as HttpsAgent } from "node:https";

import {
  PairingFailure,
  runPairingCeremony,
  type PairingCeremonyProgress,
} from "./pairing-client.js";
import {
  parsePairingInvitation,
  withPairingEndpoint,
  type PairingEndpoint,
  type PairingInvitation,
} from "./pairing-invitation.js";
import {
  createUpstreamAgent,
  startTerminalBridge,
  type TerminalBridge,
} from "./terminal-bridge.js";
import {
  readTerminalDeviceBinding,
  readTerminalPrivateKey,
  TerminalKeyProtectionUnavailable,
  writeTerminalDeviceBinding,
  type TerminalKeyProtector,
} from "./terminal-binding.js";
import {
  startTerminalDiscovery,
  type TerminalDiscovery,
} from "./terminal-discovery.js";

export interface TerminalRuntimeOptions {
  readonly allowedOrigin: string;
  readonly deviceName: string;
  readonly protector: TerminalKeyProtector;
  readonly startDiscovery?: () => TerminalDiscovery;
  readonly stateDirectory: string;
}

export interface TerminalRuntime {
  readonly bridgeOrigin: string;
  readonly bridgeToken: string;
  readonly cancelPairing: () => TerminalPairingState;
  readonly close: () => Promise<void>;
  readonly state: () => TerminalPairingState;
  readonly submitInvitation: (invitation: string) => TerminalPairingState;
  readonly submitManualEndpoint: (
    request: DesktopManualEndpointRequest,
  ) => TerminalPairingState;
}

type PairingProgress = {
  readonly deviceName: string | undefined;
  readonly endpoint: PairingEndpoint;
  readonly fingerprintDigits: string | undefined;
  readonly stage: PairingCeremonyProgress["stage"];
};

type PairedIdentity = {
  readonly deviceId: string;
  readonly endpoint: PairingEndpoint;
  readonly installationId: string;
};

type PairingFailureState = {
  readonly endpoint: PairingEndpoint | null;
  readonly reason: TerminalPairingFailureReason;
};

/**
 * Everything an Additional POS Terminal needs before and after it holds a
 * certificate: the loopback bridge the renderer talks to, the pairing
 * ceremony, and the discovery list. The Main role never constructs this.
 */
export async function startTerminalRuntime(
  options: TerminalRuntimeOptions,
): Promise<TerminalRuntime> {
  let paired: PairedIdentity | undefined;
  let progress: PairingProgress | undefined;
  let failure: PairingFailureState | undefined;
  let controller: AbortController | undefined;
  let discovery: TerminalDiscovery | undefined;
  let agent: HttpsAgent | undefined;

  const binding = readTerminalDeviceBinding(options.stateDirectory);
  if (binding !== undefined) {
    agent = createUpstreamAgent({
      binding,
      privateKeyPem: readTerminalPrivateKey(
        options.stateDirectory,
        options.protector,
      ),
    });
    paired = {
      deviceId: binding.deviceId,
      endpoint: { host: binding.endpointHost, port: binding.endpointPort },
      installationId: binding.installationId,
    };
  }

  const listening: TerminalBridge = await startTerminalBridge({
    allowedOrigin: options.allowedOrigin,
    upstream:
      agent === undefined || paired === undefined
        ? undefined
        : { agent, host: paired.endpoint.host, port: paired.endpoint.port },
  });

  if (paired === undefined) {
    try {
      discovery = (options.startDiscovery ?? startTerminalDiscovery)();
    } catch {
      // Discovery is a convenience. A terminal that cannot browse the network
      // still pairs from the scanned invitation or a typed address.
      discovery = undefined;
    }
  }

  const candidates = (): TerminalDiscoveryCandidate[] => [
    ...(discovery?.candidates() ?? []),
  ];

  const state = (): TerminalPairingState => {
    if (paired !== undefined) {
      return {
        candidates: [],
        deviceId: paired.deviceId,
        endpoint: paired.endpoint,
        installationId: paired.installationId,
        stage: "paired",
      };
    }
    if (failure !== undefined) {
      return {
        candidates: candidates(),
        endpoint: failure.endpoint,
        reason: failure.reason,
        stage: "failed",
      };
    }
    if (progress === undefined) {
      return { candidates: candidates(), stage: "awaiting-invitation" };
    }
    const digits = progress.fingerprintDigits;
    if (
      progress.stage !== "awaiting-confirmation" &&
      progress.stage !== "fetching-certificate"
    ) {
      return {
        candidates: candidates(),
        endpoint: progress.endpoint,
        stage: progress.stage,
      };
    }
    if (digits === undefined) {
      // The comparison stages exist only once the digits do. Reporting the
      // preceding stage beats inventing a number the user would compare.
      return {
        candidates: candidates(),
        endpoint: progress.endpoint,
        stage: "joining",
      };
    }
    if (progress.stage === "awaiting-confirmation") {
      return {
        candidates: candidates(),
        deviceName: progress.deviceName ?? options.deviceName,
        endpoint: progress.endpoint,
        fingerprintDigits: digits,
        stage: "awaiting-confirmation",
      };
    }
    return {
      candidates: candidates(),
      endpoint: progress.endpoint,
      fingerprintDigits: digits,
      stage: "fetching-certificate",
    };
  };

  const start = (invitation: PairingInvitation): TerminalPairingState => {
    if (!options.protector.isEncryptionAvailable()) {
      // Refused before anything is sent. A pairing session allows only a few
      // join attempts, and a machine that cannot protect the key must not
      // spend one of them to discover that it cannot finish.
      return fail("key-protection-unavailable");
    }
    controller?.abort();
    const running = new AbortController();
    controller = running;
    failure = undefined;
    progress = {
      deviceName: undefined,
      endpoint: invitation.endpoint,
      fingerprintDigits: undefined,
      stage: "validating-endpoint",
    };

    void runPairingCeremony({
      deviceName: options.deviceName,
      invitation,
      onProgress: (update) => {
        if (controller !== running) {
          return;
        }
        progress = {
          deviceName: update.deviceName ?? progress?.deviceName,
          endpoint: invitation.endpoint,
          fingerprintDigits:
            update.fingerprintDigits ?? progress?.fingerprintDigits,
          stage: update.stage,
        };
      },
      signal: running.signal,
    })
      .then((result) => {
        if (controller !== running) {
          return;
        }
        let stored;
        try {
          stored = writeTerminalDeviceBinding({
            binding: result.binding,
            directory: options.stateDirectory,
            privateKeyPem: result.privateKeyPem,
            protector: options.protector,
          });
        } catch (error) {
          // A machine that cannot protect the key is a different problem from a
          // full disk: it names its own failure so the screen can say that
          // retrying will not help.
          throw new PairingFailure(
            error instanceof TerminalKeyProtectionUnavailable
              ? "key-protection-unavailable"
              : "certificate-storage-failed",
            error instanceof Error ? error.message : String(error),
          );
        }
        agent?.destroy();
        agent = createUpstreamAgent({
          binding: stored,
          privateKeyPem: result.privateKeyPem,
        });
        listening.setUpstream({
          agent,
          host: stored.endpointHost,
          port: stored.endpointPort,
        });
        // The renderer keeps the same loopback origin, so the terminal enters
        // its paired runtime without restarting the application.
        paired = {
          deviceId: stored.deviceId,
          endpoint: {
            host: stored.endpointHost,
            port: stored.endpointPort,
          },
          installationId: stored.installationId,
        };
        progress = undefined;
        discovery?.stop();
        discovery = undefined;
      })
      .catch((error: unknown) => {
        if (controller !== running) {
          return;
        }
        progress = undefined;
        failure = {
          endpoint: invitation.endpoint,
          reason: error instanceof PairingFailure ? error.reason : "unexpected",
        };
      });

    return state();
  };

  const fail = (
    reason: PairingFailureState["reason"],
  ): TerminalPairingState => {
    controller?.abort();
    controller = undefined;
    progress = undefined;
    failure = { endpoint: null, reason };
    return state();
  };

  return {
    bridgeOrigin: listening.origin,
    bridgeToken: listening.token,
    cancelPairing: () => {
      if (paired !== undefined) {
        return state();
      }
      return fail("cancelled");
    },
    close: async () => {
      controller?.abort();
      discovery?.stop();
      agent?.destroy();
      await listening.close();
    },
    state,
    submitInvitation: (invitation) => {
      if (paired !== undefined) {
        return state();
      }
      try {
        return start(parsePairingInvitation(invitation));
      } catch {
        return fail("invitation-invalid");
      }
    },
    submitManualEndpoint: (request) => {
      if (paired !== undefined) {
        return state();
      }
      try {
        return start(
          withPairingEndpoint(parsePairingInvitation(request.invitation), {
            host: request.host,
            port: request.port,
          }),
        );
      } catch {
        return fail("invitation-invalid");
      }
    },
  };
}
