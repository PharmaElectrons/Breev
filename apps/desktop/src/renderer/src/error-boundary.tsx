import { Component, type ReactNode } from "react";

import { messages, type CrashMessage } from "./messages";
import type { Locale } from "./preferences";
import { usePreferences } from "./preferences-provider";

export type ErrorBoundaryLevel = "application" | "bootstrap" | "workspace";

interface IncidentSummary {
  readonly code: string;
  readonly level: ErrorBoundaryLevel;
}

interface DiagnosticErrorBoundaryProps {
  readonly children: ReactNode;
  readonly copy: CrashMessage;
  readonly level: ErrorBoundaryLevel;
  readonly onContactSupport?: () => void;
  readonly onExportDiagnostics?: () => void;
  readonly onIncident?: (summary: IncidentSummary) => void;
  readonly resetKey?: string;
  readonly secondaryCopy?: CrashMessage;
}

interface DiagnosticErrorBoundaryState {
  readonly copiedState: "failed" | "idle" | "succeeded";
  readonly incidentCode: string | null;
  readonly retryCount: number;
}

export class DiagnosticErrorBoundary extends Component<
  DiagnosticErrorBoundaryProps,
  DiagnosticErrorBoundaryState
> {
  override state: DiagnosticErrorBoundaryState = {
    copiedState: "idle",
    incidentCode: null,
    retryCount: 0,
  };

  private heading: HTMLHeadingElement | null = null;

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<DiagnosticErrorBoundaryState> {
    return { incidentCode: createIncidentCode(error, "application") };
  }

  override componentDidCatch(error: unknown): void {
    const code = createIncidentCode(error, this.props.level);
    if (code !== this.state.incidentCode) {
      this.setState({ incidentCode: code });
    }
    this.props.onIncident?.({ code, level: this.props.level });
  }

  override componentDidUpdate(
    previousProps: DiagnosticErrorBoundaryProps,
    previousState: DiagnosticErrorBoundaryState,
  ): void {
    if (
      previousProps.resetKey !== this.props.resetKey &&
      this.state.incidentCode !== null
    ) {
      this.setState({
        copiedState: "idle",
        incidentCode: null,
        retryCount: 0,
      });
      return;
    }
    if (
      previousState.incidentCode === null &&
      this.state.incidentCode !== null
    ) {
      this.heading?.focus();
    }
  }

  override render(): ReactNode {
    const { incidentCode, retryCount } = this.state;
    if (incidentCode === null) {
      return this.props.children;
    }

    return (
      <CrashFallback
        copiedState={this.state.copiedState}
        copy={this.props.copy}
        incidentCode={incidentCode}
        level={this.props.level}
        onContactSupport={this.props.onContactSupport}
        onCopy={() => void this.copySummary()}
        onExportDiagnostics={this.props.onExportDiagnostics}
        onHeading={(heading) => {
          this.heading = heading;
        }}
        onReload={() => window.location.reload()}
        onRetry={
          retryCount === 0
            ? () =>
                this.setState({
                  copiedState: "idle",
                  incidentCode: null,
                  retryCount: 1,
                })
            : undefined
        }
        secondaryCopy={this.props.secondaryCopy}
      />
    );
  }

  private async copySummary(): Promise<void> {
    const incidentCode = this.state.incidentCode;
    if (incidentCode === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText("Breev " + incidentCode);
      this.setState({ copiedState: "succeeded" });
    } catch {
      this.setState({ copiedState: "failed" });
    }
  }
}

export function BootstrapErrorBoundary({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <DiagnosticErrorBoundary
      copy={messages.en.crash}
      level="bootstrap"
      secondaryCopy={messages.ar.crash}
    >
      {children}
    </DiagnosticErrorBoundary>
  );
}

export function LocalizedAppErrorBoundary({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const { locale } = usePreferences();
  return (
    <DiagnosticErrorBoundary
      copy={messages[locale].crash}
      level="application"
      resetKey={locale}
    >
      {children}
    </DiagnosticErrorBoundary>
  );
}

export function WorkspaceErrorBoundary({
  children,
  resetKey,
}: {
  readonly children: ReactNode;
  readonly resetKey: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  return (
    <DiagnosticErrorBoundary
      copy={messages[locale].crash}
      level="workspace"
      resetKey={resetKey}
    >
      {children}
    </DiagnosticErrorBoundary>
  );
}

export function createIncidentCode(
  error: unknown,
  level: ErrorBoundaryLevel,
): string {
  const prefix =
    level === "bootstrap" ? "BOOT" : level === "workspace" ? "VIEW" : "APP";
  const source =
    error instanceof Error
      ? [error.name, error.stack ?? ""].join("\n")
      : typeof error;
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (
    prefix + "-" + (hash >>> 0).toString(16).padStart(8, "0").toUpperCase()
  );
}

function CrashFallback({
  copiedState,
  copy,
  incidentCode,
  level,
  onContactSupport,
  onCopy,
  onExportDiagnostics,
  onHeading,
  onReload,
  onRetry,
  secondaryCopy,
}: {
  readonly copiedState: DiagnosticErrorBoundaryState["copiedState"];
  readonly copy: CrashMessage;
  readonly incidentCode: string;
  readonly level: ErrorBoundaryLevel;
  readonly onContactSupport: (() => void) | undefined;
  readonly onCopy: () => void;
  readonly onExportDiagnostics: (() => void) | undefined;
  readonly onHeading: (heading: HTMLHeadingElement | null) => void;
  readonly onReload: () => void;
  readonly onRetry: (() => void) | undefined;
  readonly secondaryCopy: CrashMessage | undefined;
}): React.JSX.Element {
  return (
    <section
      className={"crash-fallback crash-fallback-" + level}
      role="alert"
      aria-labelledby={"crash-title-" + level}
    >
      <div className="crash-fallback-copy">
        <p className="status-kicker">Breev</p>
        <h1 id={"crash-title-" + level} ref={onHeading} tabIndex={-1}>
          {copy.title}
        </h1>
        <p>{copy.description}</p>
        <p className="crash-incident">
          <span>{copy.incidentLabel}</span>
          <code dir="ltr">{incidentCode}</code>
        </p>
        {secondaryCopy === undefined ? null : (
          <div className="crash-secondary-copy" dir="rtl" lang="ar">
            <h2>{secondaryCopy.title}</h2>
            <p>{secondaryCopy.description}</p>
            <span>{secondaryCopy.incidentLabel}</span>
          </div>
        )}
      </div>
      <div className="crash-actions">
        {onRetry === undefined ? (
          <p>{copy.retryUnavailable}</p>
        ) : (
          <button className="primary-button" type="button" onClick={onRetry}>
            {copy.retryView}
          </button>
        )}
        <button className="quiet-button" type="button" onClick={onReload}>
          {copy.reloadTerminal}
        </button>
        <button className="quiet-button" type="button" onClick={onCopy}>
          {copy.copySummary}
        </button>
        {onExportDiagnostics === undefined ? null : (
          <button
            className="quiet-button"
            type="button"
            onClick={onExportDiagnostics}
          >
            {copy.exportDiagnostics}
          </button>
        )}
        {onContactSupport === undefined ? null : (
          <button
            className="quiet-button"
            type="button"
            onClick={onContactSupport}
          >
            {copy.contactSupport}
          </button>
        )}
      </div>
      <p className="crash-copy-status" role="status" aria-live="polite">
        {copiedState === "succeeded"
          ? copy.copied
          : copiedState === "failed"
            ? copy.copyFailed
            : ""}
      </p>
    </section>
  );
}

export function crashCopyForLocale(locale: Locale): CrashMessage {
  return messages[locale].crash;
}
