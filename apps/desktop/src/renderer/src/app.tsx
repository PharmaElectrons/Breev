import { AppShell } from "./app-shell";
import { IdentityStateProvider } from "./identity-state-provider";
import { useStartupConnection } from "./use-startup-connection";

/**
 * The renderer composition root.
 *
 * The startup handshake decides whether a local API exists at all; the identity
 * provider then owns the authenticated context that the shell's navigation and
 * the workspace both read.
 */
export function App(): React.JSX.Element {
  const startup = useStartupConnection();

  return (
    <IdentityStateProvider
      baseUrl={startup.state === "ready" ? startup.localApiOrigin : null}
    >
      <AppShell startup={startup} />
    </IdentityStateProvider>
  );
}
