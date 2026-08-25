import { useEffect, useRef } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { messages } from "./messages";
import { formatDateTime } from "./preferences";
import { usePreferences } from "./preferences-provider";
import type { StartupState } from "./startup-state";
import { useStartupConnection } from "./use-startup-connection";

export function App(): React.JSX.Element {
  const { locale, setLocale, setTheme, theme } = usePreferences();
  const { checkNow, handshake, lastCheckedAt, state } = useStartupConnection();
  const checkButtonRef = useRef<HTMLButtonElement>(null);
  const copy = messages[locale];
  const status = copy.status[state];
  const isChecking = state === "starting" || state === "connecting";

  useEffect(() => {
    if (!isChecking && document.activeElement === document.body) {
      checkButtonRef.current?.focus();
    }
  }, [isChecking, state]);

  return (
    <main className="shell-page">
      <div className="shell-orb shell-orb-start" aria-hidden="true" />
      <div className="shell-orb shell-orb-end" aria-hidden="true" />

      <header className="shell-header" aria-label="Breev">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong className="brand-name">Breev</strong>
            <span className="brand-description">{copy.brandDescription}</span>
          </span>
        </div>

        <div className="preference-controls">
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
                  ? "\u00a0"
                  : `${copy.lastChecked}: ${formatDateTime(lastCheckedAt, locale)}`}
              </p>
              <button
                ref={checkButtonRef}
                className="primary-button"
                type="button"
                disabled={isChecking}
                onClick={checkNow}
              >
                {isChecking ? copy.checking : copy.checkAgain}
              </button>
            </div>
          </CardContent>
        </Card>
      </section>

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
