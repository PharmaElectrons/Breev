import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Menu, Settings, Wallet } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { messages } from "./messages";
import type { ModuleId } from "./navigation";
import { navigationMessages } from "./navigation-messages";
import type { Locale, Theme } from "./preferences";

import type { LocalHealthSuccess } from "@breev/contracts/local-rest";
import type { StartupState } from "./startup-state";
import { formatDateTime } from "./preferences";
import { StatusIcon } from "./status-icon";

export interface NavbarConnectionInfo {
  readonly checkNow: () => Promise<void> | void;
  readonly deviceProof: "committed" | "denied" | "failed" | "idle" | "running";
  readonly handshake: LocalHealthSuccess | null;
  readonly isChecking?: boolean;
  readonly lastCheckedAt: Date | null;
  readonly runDeviceProof: () => Promise<void> | void;
  readonly state: StartupState;
}

export interface NavbarCollapseMenuProps {
  readonly activeModuleId: ModuleId;
  readonly authenticated: boolean;
  readonly centralSubmissionEnabled: boolean;
  readonly connectionInfo?: NavbarConnectionInfo | undefined;
  readonly diagnosticAction:
    "cancelled" | "failed" | "idle" | "saved" | "saving";
  readonly exportDiagnostics: () => Promise<void>;
  readonly locale: Locale;
  readonly openSupport: () => Promise<void>;
  readonly setLocale: (locale: Locale) => void;
  readonly setTheme: (theme: Theme) => void;
  readonly submissionAction:
    | "confirming"
    | "failed"
    | "idle"
    | "submitted"
    | "submitting"
    | "unavailable";
  readonly supportAction:
    "failed" | "idle" | "opened" | "opening" | "unavailable";
  readonly theme: Theme;
  readonly defaultOpen?: boolean;
  readonly onLogout?: () => Promise<void> | void;
  readonly onOpenSubmissionConfirmation: () => void;
}

export function NavbarCollapseMenu({
  activeModuleId,
  authenticated,
  centralSubmissionEnabled,
  connectionInfo,
  defaultOpen = false,
  diagnosticAction,
  exportDiagnostics,
  locale,
  onLogout,
  openSupport,
  setLocale,
  setTheme,
  submissionAction,
  supportAction,
  theme,
  onOpenSubmissionConfirmation,
}: NavbarCollapseMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const copy = messages[locale];
  const navigationCopy = navigationMessages[locale];

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="collapse-menu">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          ref={triggerRef}
          className="quiet-button collapse-menu-trigger"
          aria-label={locale === "ar" ? "قائمة الخيارات" : "Menu"}
          data-testid="collapse-menu-trigger"
        >
          <Menu className="size-4" aria-hidden="true" />
          <span>{locale === "ar" ? "القائمة" : "Menu"}</span>
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>

        <CollapsibleContent
          className="collapse-menu-dropdown"
          data-testid="collapse-menu-dropdown"
        >
          {authenticated && connectionInfo ? (
            <div
              className="collapse-menu-connection"
              data-state={connectionInfo.state}
            >
              <div className="collapse-menu-connection-header">
                <StatusIcon state={connectionInfo.state} />
                <div className="collapse-menu-connection-text">
                  <span className="collapse-menu-connection-kicker">
                    {copy.connectionStatus}
                  </span>
                  <strong data-testid="shell-state">
                    {copy.status[connectionInfo.state]?.title ??
                      connectionInfo.state}
                  </strong>
                  <p>{copy.status[connectionInfo.state]?.description ?? ""}</p>
                </div>
              </div>

              {connectionInfo.state === "ready" &&
              connectionInfo.handshake !== null ? (
                <div className="collapse-menu-versions">
                  <div className="collapse-menu-version-pill">
                    <span className="version-label">{copy.apiVersion}</span>
                    <span className="version-val">
                      {connectionInfo.handshake.apiVersion}
                    </span>
                  </div>
                  <div className="collapse-menu-version-pill">
                    <span className="version-label">{copy.schemaVersion}</span>
                    <span className="version-val">
                      {connectionInfo.handshake.schemaVersion}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="collapse-menu-connection-actions">
                <p className="collapse-menu-last-checked">
                  {connectionInfo.lastCheckedAt === null
                    ? ""
                    : `${copy.lastChecked}: ${formatDateTime(connectionInfo.lastCheckedAt, locale)}`}
                </p>
                <div className="collapse-menu-buttons">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={connectionInfo.isChecking}
                    onClick={() => void connectionInfo.checkNow()}
                  >
                    {connectionInfo.isChecking
                      ? copy.checking
                      : copy.checkAgain}
                  </button>
                  {connectionInfo.state === "ready" ? (
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={connectionInfo.deviceProof === "running"}
                      onClick={() => void connectionInfo.runDeviceProof()}
                    >
                      {copy.deviceProofAction}
                    </button>
                  ) : null}
                </div>
              </div>

              {connectionInfo.deviceProof === "idle" ? null : (
                <p
                  className="collapse-menu-device-proof"
                  role="status"
                  aria-live="polite"
                  data-proof-status={connectionInfo.deviceProof}
                >
                  {copy.deviceProof[connectionInfo.deviceProof]}
                </p>
              )}

              <hr className="collapse-menu-separator" />
            </div>
          ) : null}

          {authenticated ? (
            <>
              <a
                href="#/accounts"
                className={cn(
                  "collapse-menu-item",
                  activeModuleId === "accounts" && "active",
                )}
                aria-current={
                  activeModuleId === "accounts" ? "page" : undefined
                }
                onClick={() => setOpen(false)}
              >
                <Wallet className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  {navigationCopy.modules.accounts.label}
                </span>
                <span className="visually-hidden">
                  {` — ${navigationCopy.unavailableBadge}`}
                </span>
              </a>

              <a
                href="#/settings"
                className={cn(
                  "collapse-menu-item",
                  activeModuleId === "settings" && "active",
                )}
                aria-current={
                  activeModuleId === "settings" ? "page" : undefined
                }
                onClick={() => setOpen(false)}
              >
                <Settings className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  {navigationCopy.modules.settings.label}
                </span>
              </a>

              <hr className="collapse-menu-separator" />

              <button
                className="collapse-menu-item"
                type="button"
                aria-label={copy.crash.exportDiagnostics}
                disabled={diagnosticAction === "saving"}
                onClick={() => {
                  void exportDiagnostics();
                  setOpen(false);
                }}
              >
                <DiagnosticsIcon />
                <span>{copy.crash.exportDiagnostics}</span>
              </button>

              <button
                className="collapse-menu-item"
                type="button"
                aria-label={copy.crash.contactSupport}
                disabled={supportAction === "opening"}
                onClick={() => {
                  void openSupport();
                  setOpen(false);
                }}
              >
                <SupportIcon />
                <span>{copy.crash.contactSupport}</span>
              </button>

              {centralSubmissionEnabled ? (
                <button
                  className="collapse-menu-item"
                  type="button"
                  aria-label={copy.crash.submitDiagnostics}
                  disabled={submissionAction === "submitting"}
                  onClick={() => {
                    onOpenSubmissionConfirmation();
                    setOpen(false);
                  }}
                >
                  <SendIcon />
                  <span>{copy.crash.submitDiagnostics}</span>
                </button>
              ) : null}

              <hr className="collapse-menu-separator" />
            </>
          ) : null}

          <button
            className="collapse-menu-item"
            type="button"
            aria-label={copy.switchLanguage}
            onClick={() => {
              setLocale(locale === "en" ? "ar" : "en");
              setOpen(false);
            }}
          >
            <LanguageIcon />
            <span>{locale === "en" ? "العربية" : "English"}</span>
          </button>

          <button
            className="collapse-menu-item"
            type="button"
            aria-label={
              theme === "light"
                ? copy.switchToDarkTheme
                : copy.switchToLightTheme
            }
            onClick={() => {
              setTheme(theme === "light" ? "dark" : "light");
              setOpen(false);
            }}
          >
            <ThemeIcon theme={theme} />
            <span>{theme === "light" ? copy.themeLight : copy.themeDark}</span>
          </button>

          {authenticated && onLogout ? (
            <>
              <hr className="collapse-menu-separator" />
              <button
                className="collapse-menu-item text-destructive hover:text-destructive"
                type="button"
                aria-label={locale === "ar" ? "تسجيل الخروج" : "Sign out"}
                onClick={() => {
                  setOpen(false);
                  void onLogout();
                }}
              >
                <LogOut className="size-4 shrink-0" aria-hidden="true" />
                <span>{locale === "ar" ? "تسجيل الخروج" : "Sign out"}</span>
              </button>
            </>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
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

function LanguageIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
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
      width="16"
      height="16"
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
