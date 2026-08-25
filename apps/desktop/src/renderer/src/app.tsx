import type { LocalHealthSuccess } from "@breev/contracts/local-rest";
import { useCallback, useEffect, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requestLocalHealth } from "@/local-api";

type HandshakeState =
  | { kind: "connecting" }
  | { kind: "ready"; handshake: LocalHealthSuccess }
  | { kind: "database-unavailable" }
  | { kind: "api-unreachable" };

export function App(): React.JSX.Element {
  const [state, setState] = useState<HandshakeState>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: "connecting" });

    void window.breevRuntime
      .getLocalApiUrl()
      .then((baseUrl) => requestLocalHealth(baseUrl))
      .then((handshake) => {
        if (!active) {
          return;
        }

        if (handshake.database === "available") {
          setState({ kind: "ready", handshake });
        } else {
          setState({ kind: "database-unavailable" });
        }
      })
      .catch(() => {
        if (active) {
          setState({ kind: "api-unreachable" });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const content = getStatusContent(state);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <Card className="w-full max-w-xl" role="status" aria-live="polite">
        <CardHeader>
          <p className="text-sm font-medium text-primary">
            Breev local runtime
          </p>
          <CardTitle data-testid="handshake-state">{content.title}</CardTitle>
          <CardDescription>{content.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {state.kind === "ready" ? (
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted p-4 text-sm">
              <dt>API version</dt>
              <dd className="text-right font-mono">
                {state.handshake.apiVersion}
              </dd>
              <dt>Schema version</dt>
              <dd className="text-right font-mono">
                {state.handshake.schemaVersion}
              </dd>
              <dt>PostgreSQL</dt>
              <dd className="text-right font-medium">Available</dd>
            </dl>
          ) : null}
          {state.kind !== "connecting" ? (
            <button
              className="min-h-11 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              type="button"
              onClick={retry}
            >
              Retry
            </button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

function getStatusContent(state: HandshakeState): {
  title: string;
  description: string;
} {
  switch (state.kind) {
    case "connecting":
      return {
        title: "Connecting to local services",
        description: "Checking the local API and PostgreSQL.",
      };
    case "ready":
      return {
        title: "Breev runtime ready",
        description: "The local API and PostgreSQL handshake succeeded.",
      };
    case "database-unavailable":
      return {
        title: "Database unavailable",
        description:
          "The local API is reachable, but it cannot query PostgreSQL.",
      };
    case "api-unreachable":
      return {
        title: "Local API unreachable",
        description: "Breev could not reach the local API.",
      };
  }
}
