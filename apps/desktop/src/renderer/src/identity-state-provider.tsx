import type { IdentityState } from "@breev/contracts/local-rest";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { requestIdentityState } from "./identity-api";

const IDENTITY_POLL_INTERVAL_MS = 5_000;

interface IdentityStateValue {
  readonly refresh: () => Promise<void>;
  readonly setState: (state: IdentityState) => void;
  readonly state: IdentityState | null;
}

const IdentityStateContext = createContext<IdentityStateValue | null>(null);

/**
 * One poller for the authenticated context.
 *
 * The app shell needs the same permission and entitlement facts the workspace
 * needs, so the state lives above both rather than being fetched twice. A null
 * `baseUrl` means the startup connection has not reached Ready; the provider
 * simply holds no state until it does.
 *
 * Every write carries a generation. A poll that started before a login, a
 * logout, or a change of `baseUrl` cannot land afterwards and restore the
 * state the user just left — which would show a signed-out shell to a
 * signed-in pharmacist, or the reverse.
 */
export function IdentityStateProvider({
  baseUrl,
  children,
}: React.PropsWithChildren<{
  readonly baseUrl: string | null;
}>): React.JSX.Element {
  const [state, setInternalState] = useState<IdentityState | null>(null);
  const generation = useRef(0);

  /** Invalidate every request now in flight. */
  const invalidate = useCallback((): number => {
    generation.current += 1;
    return generation.current;
  }, []);

  /** An authoritative result — a login, logout, or command response. */
  const setState = useCallback(
    (next: IdentityState): void => {
      invalidate();
      setInternalState(next);
    },
    [invalidate],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (baseUrl === null) {
      return;
    }
    const current = generation.current;
    try {
      const next = await requestIdentityState(baseUrl);
      if (generation.current === current) {
        setInternalState(next);
      }
    } catch {
      // The startup connection owns transport availability. Preserve the last
      // identity state while it reconnects.
    }
  }, [baseUrl]);

  useEffect(() => {
    invalidate();
    if (baseUrl === null) {
      setInternalState(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Chained rather than on an interval, so a slow response cannot overlap
    // the next poll.
    const poll = async (): Promise<void> => {
      await refresh();
      if (!cancelled) {
        timer = setTimeout(() => void poll(), IDENTITY_POLL_INTERVAL_MS);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      invalidate();
    };
  }, [baseUrl, invalidate, refresh]);

  const value = useMemo<IdentityStateValue>(
    () => ({ refresh, setState, state }),
    [refresh, setState, state],
  );

  return (
    <IdentityStateContext.Provider value={value}>
      {children}
    </IdentityStateContext.Provider>
  );
}

export function useIdentityState(): IdentityStateValue {
  const value = useContext(IdentityStateContext);
  if (value === null) {
    throw new Error(
      "useIdentityState must be used inside IdentityStateProvider",
    );
  }
  return value;
}
