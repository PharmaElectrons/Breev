import { useEffect, useRef, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { CatalogRouteView } from "./catalog-screen";
import {
  DiagnosticSubmissionConfirmation,
  WorkspaceErrorBoundary,
} from "./error-boundary";
import { useIdentityState } from "./identity-state-provider";
import { IdentityShell } from "./identity-shell";
import { messages } from "./messages";
import { ModuleNavigation } from "./module-navigation";
import {
  catalogHash,
  DEFAULT_MODULE_ID,
  defaultModuleHash,
  moduleIdForHash,
  moduleImplemented,
  navigationModules,
  type NavigationModule,
} from "./navigation";
import { navigationMessages } from "./navigation-messages";
import { formatDateTime } from "./preferences";
import { usePreferences } from "./preferences-provider";
import { PurchasingRouteView } from "./purchasing-screen";
import type { StartupState } from "./startup-state";
import { SystemOverview } from "./system-overview";
import { TerminalPairingScreen } from "./terminal-pairing-screen";
import { UnavailableSurface } from "./unavailable-surface";
import type { useStartupConnection } from "./use-startup-connection";

export type StartupConnection = ReturnType<typeof useStartupConnection>;

/**
 * The application frame adapted from the client prototype: a compact header with
 * the brand lockup, the module tab bar, the language and theme controls, and
 * the clock, over the workspace for the addressed module.
 *
 * The connection status the startup handshake owns stays on screen. Once the
 * Main Pharmacy Computer is Ready it collapses into a strip so the workspace,
 * not the handshake, is what the pharmacist looks at.
 */
export function AppShell({
  startup,
}: {
  readonly startup: StartupConnection;
}): React.JSX.Element {
  const { locale, setLocale, setTheme, theme } = usePreferences();
  const { state: identityState } = useIdentityState();
  const {
    cancelTerminalPairing,
    checkNow,
    deviceProof,
    handshake,
    lastCheckedAt,
    localApiOrigin,
    runDeviceProof,
    state,
    submitManualEndpoint,
    submitPairingInvitation,
    startupConfig,
    terminalPairing,
  } = startup;

  const checkButtonRef = useRef<HTMLButtonElement>(null);
  const copy = messages[locale];
  const navigationCopy = navigationMessages[locale];
  const status = copy.status[state];
  const isChecking = state === "starting" || state === "connecting";

  useEffect(() => {
    if (!isChecking && document.activeElement === document.body) {
      checkButtonRef.current?.focus();
    }
  }, [isChecking, state]);

  const [currentHash, setCurrentHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );
  const [diagnosticAction, setDiagnosticAction] = useState<
    "cancelled" | "failed" | "idle" | "saved" | "saving"
  >("idle");
  const [supportAction, setSupportAction] = useState<
    "failed" | "idle" | "opened" | "opening" | "unavailable"
  >("idle");
  const [submissionAction, setSubmissionAction] = useState<
    | "confirming"
    | "failed"
    | "idle"
    | "submitted"
    | "submitting"
    | "unavailable"
  >("idle");
  const [submissionReportId, setSubmissionReportId] = useState<string | null>(
    null,
  );

  const exportDiagnostics = async (): Promise<void> => {
    setDiagnosticAction("saving");
    try {
      const result = await window.breevDesktop.exportDiagnostics({ locale });
      setDiagnosticAction(result.status);
    } catch {
      setDiagnosticAction("failed");
    }
  };

  const openSupport = async (): Promise<void> => {
    setSupportAction("opening");
    try {
      const result = await window.breevDesktop.openSupport({ locale });
      setSupportAction(result.status);
    } catch {
      setSupportAction("failed");
    }
  };

  const submitDiagnostics = async (): Promise<void> => {
    setSubmissionAction("submitting");
    setSubmissionReportId(null);
    try {
      const result = await window.breevDesktop.submitDiagnostics({});
      setSubmissionAction(result.status);
      if (result.status === "submitted") {
        setSubmissionReportId(result.reportId);
      }
    } catch {
      setSubmissionAction("failed");
    }
  };

  useEffect(() => {
    const handleHashChange = (): void => {
      setCurrentHash(window.location.hash);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const requestedModuleId = moduleIdForHash(currentHash);
  const authenticated =
    identityState !== null && identityState.state === "authenticated";
  const centralSubmissionEnabled =
    startupConfig?.diagnosticReporting === "manual";
  const modules: readonly NavigationModule[] = authenticated
    ? navigationModules({
        allowedPermissions: identityState.allowedPermissions,
        capabilities: identityState.entitlement.capabilities,
      })
    : [];

  /*
   * A location hash is a request, not an authorization.
   *
   * Routing resolves against the allowed navigation the API derived, not
   * against the hash alone: an unauthenticated visitor reaches the login
   * screen (docs/product.md — mandatory login with no bypass), a user without
   * a surface's permission never mounts it, and a pharmacy without a paid
   * capability never sees that surface's label or panel, because
   * docs/product.md requires unentitled functions to be hidden completely
   * rather than merely disabled. The local API independently authorizes every
   * request either way; this keeps the renderer from displaying what the
   * pharmacy is not entitled to see.
   */
  const moduleAllowed = modules.some(
    (module) => module.id === requestedModuleId,
  );
  const activeModuleId =
    authenticated && moduleAllowed ? requestedModuleId : DEFAULT_MODULE_ID;

  useEffect(() => {
    if (!authenticated || moduleAllowed) {
      return;
    }
    const fallback = defaultModuleHash();
    if (window.location.hash !== fallback) {
      window.location.hash = fallback;
    }
  }, [authenticated, moduleAllowed]);

  return (
    <main className="shell-page">
      <header className="shell-header" aria-label="Breev">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong className="brand-name">Breev</strong>
            <span className="brand-description">
              {modules.length > 0
                ? navigationCopy.modules[activeModuleId].label
                : copy.brandDescription}
            </span>
          </span>
        </div>

        <ModuleNavigation activeModuleId={activeModuleId} modules={modules} />

        <div className="preference-controls">
          {authenticated ? (
            <>
              <button
                className="quiet-button"
                type="button"
                aria-label={copy.crash.exportDiagnostics}
                disabled={diagnosticAction === "saving"}
                onClick={() => void exportDiagnostics()}
              >
                <DiagnosticsIcon />
                <span>{copy.crash.exportDiagnostics}</span>
              </button>
              <button
                className="quiet-button"
                type="button"
                aria-label={copy.crash.contactSupport}
                disabled={supportAction === "opening"}
                onClick={() => void openSupport()}
              >
                <SupportIcon />
                <span>{copy.crash.contactSupport}</span>
              </button>
              {centralSubmissionEnabled ? (
                <button
                  className="quiet-button"
                  type="button"
                  aria-label={copy.crash.submitDiagnostics}
                  disabled={submissionAction === "submitting"}
                  onClick={() => setSubmissionAction("confirming")}
                >
                  <SendIcon />
                  <span>{copy.crash.submitDiagnostics}</span>
                </button>
              ) : null}
            </>
          ) : null}
          <button
            className="quiet-button"
            type="button"
            aria-label={copy.switchLanguage}
            onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          >
            <LanguageIcon />
            <span>{locale === "en" ? "العربية" : "English"}</span>
          </button>
          <button
            className="quiet-button"
            type="button"
            aria-label={
              theme === "light"
                ? copy.switchToDarkTheme
                : copy.switchToLightTheme
            }
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            <ThemeIcon theme={theme} />
            <span>{theme === "light" ? copy.themeLight : copy.themeDark}</span>
          </button>
        </div>
      </header>

      {submissionAction === "confirming" ? (
        <DiagnosticSubmissionConfirmation
          copy={copy.crash}
          onCancel={() => setSubmissionAction("idle")}
          onConfirm={() => void submitDiagnostics()}
        />
      ) : null}

      <p className="support-action-status" role="status" aria-live="polite">
        {diagnosticAction === "saved"
          ? copy.crash.exportSaved
          : diagnosticAction === "failed"
            ? copy.crash.exportFailed
            : diagnosticAction === "cancelled"
              ? copy.crash.exportCancelled
              : supportAction === "opened"
                ? copy.crash.contactOpened
                : supportAction === "failed"
                  ? copy.crash.contactFailed
                  : supportAction === "unavailable"
                    ? `${copy.crash.contactUnavailable} ${copy.crash.manualSupportInstructions}`
                    : submissionAction === "submitted"
                      ? `${copy.crash.submitted} ${copy.crash.reportReference}: ${submissionReportId ?? ""}`
                      : submissionAction === "failed"
                        ? copy.crash.submitFailed
                        : submissionAction === "unavailable"
                          ? copy.crash.submitUnavailable
                          : ""}
      </p>

      <section className="status-region" aria-label={copy.connectionStatus}>
        <Card className="status-card" data-state={state}>
          <CardHeader className="status-header">
            <StatusIcon state={state} />
            <div className="status-copy" role="status" aria-live="polite">
              <p className="status-kicker">{copy.connectionStatus}</p>
              <CardTitle data-testid="shell-state">{status.title}</CardTitle>
              <CardDescription>{status.description}</CardDescription>
            </div>
          </CardHeader>

          <CardContent className="status-content">
            {state === "ready" && handshake !== null ? (
              <dl className="version-list">
                <div>
                  <dt>{copy.apiVersion}</dt>
                  <dd>{handshake.apiVersion}</dd>
                </div>
                <div>
                  <dt>{copy.schemaVersion}</dt>
                  <dd>{handshake.schemaVersion}</dd>
                </div>
              </dl>
            ) : null}

            <div className="status-actions">
              <p className="last-checked">
                {lastCheckedAt === null
                  ? " "
                  : `${copy.lastChecked}: ${formatDateTime(lastCheckedAt, locale)}`}
              </p>
              <div className="status-buttons">
                <button
                  ref={checkButtonRef}
                  className="primary-button"
                  type="button"
                  disabled={isChecking}
                  onClick={checkNow}
                >
                  {isChecking ? copy.checking : copy.checkAgain}
                </button>
                {state === "ready" ? (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={deviceProof === "running"}
                    onClick={() => void runDeviceProof()}
                  >
                    {copy.deviceProofAction}
                  </button>
                ) : null}
              </div>
            </div>
            {deviceProof === "idle" ? null : (
              <p
                className="device-proof-status"
                role="status"
                aria-live="polite"
              >
                {copy.deviceProof[deviceProof]}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {state === "unpaired" ? (
        <TerminalPairingScreen
          onCancel={cancelTerminalPairing}
          onSubmitEndpoint={submitManualEndpoint}
          onSubmitInvitation={submitPairingInvitation}
          pairing={terminalPairing}
        />
      ) : null}

      {state === "ready" && localApiOrigin !== null ? (
        <WorkspaceErrorBoundary
          actionsEnabled={authenticated}
          centralSubmissionEnabled={centralSubmissionEnabled}
          resetKey={
            activeModuleId +
            ":" +
            (activeModuleId === "products" ? catalogHash(currentHash) : "")
          }
        >
          {!authenticated ? (
            // IdentityShell owns loading, bootstrap, login, expiry, and revocation.
            <IdentityShell baseUrl={localApiOrigin} />
          ) : activeModuleId === "dashboard" &&
            handshake !== null &&
            startupConfig !== null ? (
            <SystemOverview
              handshake={handshake}
              startupConfig={startupConfig}
            />
          ) : !moduleImplemented(activeModuleId) ? (
            <UnavailableSurface moduleId={activeModuleId} />
          ) : activeModuleId === "products" ? (
            <CatalogRouteView
              baseUrl={localApiOrigin}
              hash={catalogHash(currentHash)}
            />
          ) : activeModuleId === "purchases" ? (
            <PurchasingRouteView baseUrl={localApiOrigin} />
          ) : (
            <IdentityShell baseUrl={localApiOrigin} />
          )}
        </WorkspaceErrorBoundary>
      ) : null}

      <footer className="shell-footer">Breev</footer>
    </main>
  );
}

function StatusIcon({ state }: { state: StartupState }): React.JSX.Element {
  const icon =
    state === "ready" ? (
      <path d="m7 12 3 3 7-7" />
    ) : state === "repair-required" ? (
      <>
        <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z" />
      </>
    ) : state === "incompatible-version" ? (
      <>
        <path d="M8 7h9l-2-2" />
        <path d="m17 17-9 0 2 2" />
        <path d="m17 7-2 2" />
        <path d="m8 17 2-2" />
      </>
    ) : state === "main-unavailable" ? (
      <>
        <path d="M6 8h12v8H6z" />
        <path d="m4 4 16 16" />
      </>
    ) : state === "unpaired" ? (
      <>
        <path d="M9 4v5" />
        <path d="M15 4v5" />
        <path d="M7 9h10v3a5 5 0 0 1-10 0Z" />
        <path d="M12 17v3" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    );

  return (
    <span className="status-icon" data-icon-state={state} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        {icon}
      </svg>
    </span>
  );
}

function LanguageIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: "dark" | "light" }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      {theme === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : (
        <path d="M20 15.3A8.5 8.5 0 0 1 8.7 4 8.5 8.5 0 1 0 20 15.3Z" />
      )}
    </svg>
  );
}

function DiagnosticsIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <path
        d="M5 3h10l4 4v14H5zM15 3v5h4M8 13h8M8 17h5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SupportIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <path
        d="M4 13v-2a8 8 0 0 1 16 0v2M4 13a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2v1Zm16 0a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2v1ZM17 17c0 2-2 3-5 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SendIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <path
        d="m3 11 17-8-7 18-2-7-8-3Zm8 3 9-11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
