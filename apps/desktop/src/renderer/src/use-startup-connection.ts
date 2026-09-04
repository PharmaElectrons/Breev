import type {
  DesktopDeviceRole,
  DesktopManualEndpointRequest,
  DesktopStartupConfig,
  TerminalPairingState,
} from "@breev/contracts/desktop-preload";
import type { LocalHealthSuccess } from "@breev/contracts/local-rest";
import { useCallback, useEffect, useRef, useState } from "react";

import { requestLocalHealth } from "./local-api";
import { requestMainDeviceProofMutation } from "./local-api";
import {
  stateFromHealth,
  stateFromStartupFailure,
  stateFromTerminalPairing,
  type StartupState,
} from "./startup-state";

const HEALTH_POLL_INTERVAL_MS = 1_000;

const PAIRING_FAILED_UNEXPECTED: TerminalPairingState = {
  candidates: [],
  endpoint: null,
  reason: "unexpected",
  stage: "failed",
};

interface StartupConnection {
  readonly cancelTerminalPairing: () => Promise<void>;
  readonly checkNow: () => void;
  readonly deviceProof: "committed" | "denied" | "failed" | "idle" | "running";
  readonly handshake: LocalHealthSuccess | null;
  readonly lastCheckedAt: Date | null;
  readonly localApiOrigin: string | null;
  readonly runDeviceProof: () => Promise<void>;
  readonly state: StartupState;
  readonly startupConfig: DesktopStartupConfig | null;
  readonly submitManualEndpoint: (
    endpoint: DesktopManualEndpointRequest,
  ) => Promise<void>;
  readonly submitPairingInvitation: (invitation: string) => Promise<void>;
  readonly terminalPairing: TerminalPairingState | null;
}

export function useStartupConnection(): StartupConnection {
  const [state, setState] = useState<StartupState>("starting");
  const [handshake, setHandshake] = useState<LocalHealthSuccess | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [deviceProof, setDeviceProof] =
    useState<StartupConnection["deviceProof"]>("idle");
  const [terminalPairing, setTerminalPairing] =
    useState<TerminalPairingState | null>(null);
  const [startupConfig, setStartupConfig] =
    useState<DesktopStartupConfig | null>(null);
  const localApiOriginRef = useRef<string | undefined>(undefined);
  const checkNowRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let checkInFlight = false;
    let deviceRole: DesktopDeviceRole = "main";
    let localApiOrigin: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextCheck = (): void => {
      timer = setTimeout(() => {
        timer = undefined;
        void check(false);
      }, HEALTH_POLL_INTERVAL_MS);
    };

    const readTerminalPairing = async (): Promise<TerminalPairingState> => {
      try {
        return await window.breevDesktop.getTerminalPairingState();
      } catch {
        return PAIRING_FAILED_UNEXPECTED;
      }
    };

    const check = async (showConnecting: boolean): Promise<void> => {
      if (localApiOrigin === undefined || !active || checkInFlight) {
        return;
      }
      checkInFlight = true;
      if (showConnecting) {
        setState("connecting");
      }

      try {
        if (deviceRole === "terminal") {
          const pairing = await readTerminalPairing();
          if (!active) {
            return;
          }
          setTerminalPairing(pairing);
          if (pairing.stage !== "paired") {
            setState(stateFromTerminalPairing(pairing));
            setHandshake(null);
            return;
          }
        }

        const response = await requestLocalHealth(localApiOrigin);
        if (!active) {
          return;
        }
        const nextState = stateFromHealth(response);
        setState(nextState);
        setHandshake(response.status === "healthy" ? response : null);
      } catch (error) {
        if (!active) {
          return;
        }
        setState(stateFromStartupFailure(error));
        setHandshake(null);
      } finally {
        checkInFlight = false;
        if (active) {
          setLastCheckedAt(new Date());
          scheduleNextCheck();
        }
      }
    };

    const start = async (): Promise<void> => {
      try {
        const config = await window.breevDesktop.getStartupConfig();
        if (!active) {
          return;
        }
        deviceRole = config.role;
        localApiOrigin = config.localApiOrigin;
        localApiOriginRef.current = config.localApiOrigin;
        setStartupConfig(config);
        await check(true);
      } catch (error) {
        if (!active) {
          return;
        }
        setState(stateFromStartupFailure(error));
        setHandshake(null);
        setLastCheckedAt(new Date());
      }
    };

    checkNowRef.current = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (localApiOrigin === undefined) {
        void start();
      } else {
        void check(true);
      }
    };
    void start();

    return () => {
      active = false;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, []);

  const checkNow = useCallback(() => checkNowRef.current(), []);
  const runDeviceProof = useCallback(async (): Promise<void> => {
    const localApiOrigin = localApiOriginRef.current;
    if (localApiOrigin === undefined) {
      setDeviceProof("failed");
      return;
    }
    setDeviceProof("running");
    try {
      const result = await requestMainDeviceProofMutation(localApiOrigin);
      setDeviceProof(result.status === "committed" ? "committed" : "denied");
    } catch {
      setDeviceProof("failed");
    }
  }, []);

  const applyPairing = useCallback(
    async (work: () => Promise<TerminalPairingState>): Promise<void> => {
      let next: TerminalPairingState;
      try {
        next = await work();
      } catch {
        next = PAIRING_FAILED_UNEXPECTED;
      }
      setTerminalPairing(next);
      if (next.stage === "paired") {
        setStartupConfig((current) =>
          current === null
            ? current
            : {
                ...current,
                deviceId: next.deviceId,
                installationId: next.installationId,
              },
        );
      }
      setState(stateFromTerminalPairing(next));
    },
    [],
  );

  const submitPairingInvitation = useCallback(
    async (invitation: string): Promise<void> => {
      await applyPairing(() =>
        window.breevDesktop.submitPairingInvitation({ invitation }),
      );
    },
    [applyPairing],
  );

  const submitManualEndpoint = useCallback(
    async (endpoint: DesktopManualEndpointRequest): Promise<void> => {
      await applyPairing(() =>
        window.breevDesktop.submitManualEndpoint(endpoint),
      );
    },
    [applyPairing],
  );

  const cancelTerminalPairing = useCallback(async (): Promise<void> => {
    await applyPairing(() => window.breevDesktop.cancelTerminalPairing());
  }, [applyPairing]);

  return {
    cancelTerminalPairing,
    checkNow,
    deviceProof,
    handshake,
    lastCheckedAt,
    localApiOrigin: localApiOriginRef.current ?? null,
    runDeviceProof,
    state,
    startupConfig,
    submitManualEndpoint,
    submitPairingInvitation,
    terminalPairing,
  };
}
