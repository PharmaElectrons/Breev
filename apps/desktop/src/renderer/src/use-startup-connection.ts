import type { LocalHealthSuccess } from "@breev/contracts/local-rest";
import { useCallback, useEffect, useRef, useState } from "react";

import { requestLocalHealth } from "./local-api";
import { requestMainDeviceProofMutation } from "./local-api";
import {
  stateFromHealth,
  stateFromStartupFailure,
  type StartupState,
} from "./startup-state";

const HEALTH_POLL_INTERVAL_MS = 1_000;

interface StartupConnection {
  readonly checkNow: () => void;
  readonly deviceProof: "committed" | "denied" | "failed" | "idle" | "running";
  readonly handshake: LocalHealthSuccess | null;
  readonly lastCheckedAt: Date | null;
  readonly runDeviceProof: () => Promise<void>;
  readonly state: StartupState;
}

export function useStartupConnection(): StartupConnection {
  const [state, setState] = useState<StartupState>("starting");
  const [handshake, setHandshake] = useState<LocalHealthSuccess | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [deviceProof, setDeviceProof] =
    useState<StartupConnection["deviceProof"]>("idle");
  const localApiOriginRef = useRef<string | undefined>(undefined);
  const checkNowRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let checkInFlight = false;
    let localApiOrigin: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextCheck = (): void => {
      timer = setTimeout(() => {
        timer = undefined;
        void check(false);
      }, HEALTH_POLL_INTERVAL_MS);
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
        localApiOrigin = config.localApiOrigin;
        localApiOriginRef.current = config.localApiOrigin;
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
  return {
    checkNow,
    deviceProof,
    handshake,
    lastCheckedAt,
    runDeviceProof,
    state,
  };
}
