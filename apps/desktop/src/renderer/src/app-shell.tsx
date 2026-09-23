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
import { logoutIdentity } from "./identity-api";
import { BasketRouteView } from "./basket-screen";
import { SalesRouteView } from "./sales-screen";
import { InventoryRouteView } from "./inventory-screen";
import { messages } from "./messages";
import { ModuleNavigation } from "./module-navigation";
import { NavbarCollapseMenu } from "./navbar-collapse-menu";
import { SettingsRouteView } from "./settings-screen";
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
 * Purchasing puts Ready connection details in a header disclosure to preserve
 * the client's invoice canvas. Other modules keep the status strip; startup
 * and recovery states keep their full connection details.
 */
export function AppShell({
  startup,
}: {
  readonly startup: StartupConnection;
}): React.JSX.Element {
  const { locale, setLocale, setTheme, theme } = usePreferences();
  const { setState: setIdentityState, state: identityState } =
    useIdentityState();
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

  const handleLogout = async (): Promise<void> => {
    if (localApiOrigin === null) {
      return;
    }
    try {
      await logoutIdentity(localApiOrigin);
    } finally {
      setIdentityState({ state: "unauthenticated" });
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

  const isWorkspace = state === "ready" && authenticated;
  const purchaseWorkspace = isWorkspace && activeModuleId === "purchases";
  const inventoryWorkspace = isWorkspace && activeModuleId === "inventory";
  const basketWorkspace = isWorkspace && activeModuleId === "basket";
  const salesWorkspace = isWorkspace && activeModuleId === "sales";
  const settingsWorkspace = isWorkspace && activeModuleId === "settings";
  const dashboardWorkspace = isWorkspace && activeModuleId === "dashboard";
  const productsWorkspace = isWorkspace && activeModuleId === "products";
  const connectionCard = (
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
          <p className="device-proof-status" role="status" aria-live="polite">
            {copy.deviceProof[deviceProof]}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <main
      className="shell-page"
      data-workspace={isWorkspace || undefined}
      data-basket-workspace={basketWorkspace || undefined}
      data-dashboard-workspace={dashboardWorkspace || undefined}
      data-inventory-workspace={inventoryWorkspace || undefined}
      data-products-workspace={productsWorkspace || undefined}
      data-purchase-workspace={purchaseWorkspace || undefined}
      data-sales-workspace={salesWorkspace || undefined}
      data-settings-workspace={settingsWorkspace || undefined}
    >
      <header
        className="shell-header"
        data-testid="shell-header"
        aria-label="Breev"
      >
        <div className="brand-lockup" data-testid="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong className="brand-name">Breev</strong>
            <span className="brand-description">{copy.brandDescription}</span>
            <h1 className="visually-hidden">
              {navigationCopy.modules[activeModuleId].label}
            </h1>
          </span>
        </div>

        <ModuleNavigation activeModuleId={activeModuleId} modules={modules} />

        <div className="shell-header-end" data-testid="shell-header-end">
          <div className="preference-controls">
            <NavbarCollapseMenu
              activeModuleId={activeModuleId}
              authenticated={authenticated}
              centralSubmissionEnabled={centralSubmissionEnabled}
              diagnosticAction={diagnosticAction}
              exportDiagnostics={exportDiagnostics}
              locale={locale}
              onLogout={handleLogout}
              onOpenSubmissionConfirmation={() =>
                setSubmissionAction("confirming")
              }
              openSupport={openSupport}
              setLocale={setLocale}
              setTheme={setTheme}
              submissionAction={submissionAction}
              supportAction={supportAction}
              theme={theme}
            />
            {authenticated ? (
              <details
                className="purchase-connection"
                aria-label={copy.connectionStatus}
              >
                <summary>
                  <StatusIcon state={state} />
                  <span className="visually-hidden">
                    {copy.connectionStatus}
                  </span>
                </summary>
                {connectionCard}
              </details>
            ) : null}
          </div>
          {authenticated ? <PurchaseClock locale={locale} /> : null}
        </div>
      </header>

      {submissionAction === "confirming" ? (
        <DiagnosticSubmissionConfirmation
          copy={copy.crash}
          onCancel={() => setSubmissionAction("idle")}
          onConfirm={() => void submitDiagnostics()}
        />
      ) : null}

      {diagnosticAction === "saved" ||
      diagnosticAction === "failed" ||
      diagnosticAction === "cancelled" ||
      supportAction === "opened" ||
      supportAction === "failed" ||
      supportAction === "unavailable" ||
      submissionAction === "submitted" ||
      submissionAction === "failed" ||
      submissionAction === "unavailable" ? (
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
      ) : null}

      {isWorkspace ? null : (
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
      )}

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
            (activeModuleId === "products"
              ? catalogHash(currentHash)
              : activeModuleId === "inventory"
                ? currentHash
                : activeModuleId === "basket"
                  ? currentHash
                  : activeModuleId === "sales"
                    ? currentHash
                    : "")
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
          ) : activeModuleId === "inventory" ? (
            <InventoryRouteView
              baseUrl={localApiOrigin}
              checkNow={async () => {
                await checkNow();
              }}
              hash={currentHash}
            />
          ) : activeModuleId === "sales" ? (
            <SalesRouteView baseUrl={localApiOrigin} hash={currentHash} />
          ) : activeModuleId === "basket" ? (
            <BasketRouteView
              baseUrl={localApiOrigin}
              checkNow={async () => {
                await checkNow();
              }}
              hash={currentHash}
            />
          ) : activeModuleId === "settings" ? (
            <SettingsRouteView baseUrl={localApiOrigin} hash={currentHash} />
          ) : (
            <UnavailableSurface moduleId={activeModuleId} />
          )}
        </WorkspaceErrorBoundary>
      ) : null}

      {isWorkspace ? null : <footer className="shell-footer">Breev</footer>}
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

function PurchaseClock({
  locale,
}: {
  readonly locale: "ar" | "en";
}): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time className="purchase-clock" dateTime={now.toISOString()}>
      <span>
        {new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(now)}
      </span>
      <span>
        {new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-GB", {
          dateStyle: "medium",
        }).format(now)}
      </span>
    </time>
  );
}
