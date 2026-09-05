import {
  Component,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  DesktopExportDiagnosticsResponse,
  DesktopOpenSupportResponse,
  DesktopSubmitDiagnosticsResponse,
} from "@breev/contracts/desktop-preload";

import { messages, type CrashMessage } from "./messages";
import type { Locale } from "./preferences";
import { usePreferences } from "./preferences-provider";

export type ErrorBoundaryLevel = "application" | "bootstrap" | "workspace";

interface IncidentSummary {
  readonly code: string;
  readonly level: ErrorBoundaryLevel;
}

export function reportRendererIncident(summary: IncidentSummary): void {
  void window.breevDesktop
    .reportRendererIncident({ code: summary.code, source: summary.level })
    .catch(() => undefined);
}

interface DiagnosticErrorBoundaryProps {
  readonly children: ReactNode;
  readonly copy: CrashMessage;
  readonly level: ErrorBoundaryLevel;
  readonly onContactSupport?: (
    incidentCode: string,
  ) => Promise<DesktopOpenSupportResponse>;
  readonly onExportDiagnostics?: (
    incidentCode: string,
  ) => Promise<DesktopExportDiagnosticsResponse>;
  readonly onIncident?: (summary: IncidentSummary) => void;
  readonly onSubmitDiagnostics?: (
    incidentCode: string,
  ) => Promise<DesktopSubmitDiagnosticsResponse>;
  readonly resetKey?: string;
  readonly secondaryCopy?: CrashMessage;
}

interface DiagnosticErrorBoundaryState {
  readonly copiedState: "failed" | "idle" | "succeeded";
  readonly contactState:
    "failed" | "idle" | "opened" | "opening" | "unavailable";
  readonly exportState: "cancelled" | "failed" | "idle" | "saved" | "saving";
  readonly incidentCode: string | null;
  readonly retryCount: number;
  readonly submissionReportId: string | null;
  readonly submissionState:
    | "confirming"
    | "failed"
    | "idle"
    | "submitted"
    | "submitting"
    | "unavailable";
}

export class DiagnosticErrorBoundary extends Component<
  DiagnosticErrorBoundaryProps,
  DiagnosticErrorBoundaryState
> {
  override state: DiagnosticErrorBoundaryState = {
    copiedState: "idle",
    contactState: "idle",
    exportState: "idle",
    incidentCode: null,
    retryCount: 0,
    submissionReportId: null,
    submissionState: "idle",
  };

  private heading: HTMLHeadingElement | null = null;
  private confirmationButton: HTMLButtonElement | null = null;

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<DiagnosticErrorBoundaryState> {
    return { incidentCode: createIncidentCode(error, "application") };
  }

  override componentDidCatch(error: unknown): void {
    const code = createIncidentCode(error, this.props.level);
    this.setState({ incidentCode: code }, () => this.heading?.focus());
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
        contactState: "idle",
        exportState: "idle",
        incidentCode: null,
        retryCount: 0,
        submissionReportId: null,
        submissionState: "idle",
      });
      return;
    }
    if (
      previousState.incidentCode === null &&
      this.state.incidentCode !== null
    ) {
      this.heading?.focus();
    }
    if (
      previousState.submissionState !== "confirming" &&
      this.state.submissionState === "confirming"
    ) {
      this.confirmationButton?.focus();
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
        contactState={this.state.contactState}
        copy={this.props.copy}
        incidentCode={incidentCode}
        level={this.props.level}
        onContactSupport={
          this.props.onContactSupport === undefined
            ? undefined
            : () => void this.contactSupport()
        }
        onCopy={() => void this.copySummary()}
        exportState={this.state.exportState}
        onExportDiagnostics={
          this.props.onExportDiagnostics === undefined
            ? undefined
            : () => void this.exportDiagnostics()
        }
        onHeading={(heading) => {
          this.heading = heading;
        }}
        onReload={() => window.location.reload()}
        onSubmitDiagnostics={
          this.props.onSubmitDiagnostics === undefined
            ? undefined
            : () => this.setState({ submissionState: "confirming" })
        }
        onCancelSubmission={() => this.setState({ submissionState: "idle" })}
        onConfirmSubmission={() => void this.submitDiagnostics()}
        onConfirmationButton={(button) => {
          this.confirmationButton = button;
        }}
        onRetry={
          retryCount === 0
            ? () =>
                this.setState({
                  copiedState: "idle",
                  contactState: "idle",
                  exportState: "idle",
                  incidentCode: null,
                  retryCount: 1,
                  submissionReportId: null,
                  submissionState: "idle",
                })
            : undefined
        }
        secondaryCopy={this.props.secondaryCopy}
        submissionReportId={this.state.submissionReportId}
        submissionState={this.state.submissionState}
      />
    );
  }

  private async copySummary(): Promise<void> {
    const incidentCode = this.state.incidentCode;
    if (incidentCode === null) {
      return;
    }
    try {
      const reportReference =
        this.state.submissionReportId === null
          ? ""
          : `\n${this.props.copy.reportReference}: ${this.state.submissionReportId}`;
      await navigator.clipboard.writeText(
        "Breev " + incidentCode + reportReference,
      );
      this.setState({ copiedState: "succeeded" });
    } catch {
      this.setState({ copiedState: "failed" });
    }
  }

  private async exportDiagnostics(): Promise<void> {
    const incidentCode = this.state.incidentCode;
    if (incidentCode === null || this.props.onExportDiagnostics === undefined) {
      return;
    }
    this.setState({ exportState: "saving" });
    try {
      const result = await this.props.onExportDiagnostics(incidentCode);
      this.setState({ exportState: result.status });
    } catch {
      this.setState({ exportState: "failed" });
    }
  }

  private async contactSupport(): Promise<void> {
    const incidentCode = this.state.incidentCode;
    if (incidentCode === null || this.props.onContactSupport === undefined) {
      return;
    }
    this.setState({ contactState: "opening" });
    try {
      const result = await this.props.onContactSupport(incidentCode);
      this.setState({ contactState: result.status });
    } catch {
      this.setState({ contactState: "failed" });
    }
  }

  private async submitDiagnostics(): Promise<void> {
    const incidentCode = this.state.incidentCode;
    if (incidentCode === null || this.props.onSubmitDiagnostics === undefined) {
      return;
    }
    this.setState({ submissionReportId: null, submissionState: "submitting" });
    try {
      const result = await this.props.onSubmitDiagnostics(incidentCode);
      this.setState({
        submissionReportId:
          result.status === "submitted" ? result.reportId : null,
        submissionState: result.status,
      });
    } catch {
      this.setState({ submissionState: "failed" });
    }
  }
}

async function exportDiagnostics(
  incidentCode: string,
  locale: Locale,
): Promise<DesktopExportDiagnosticsResponse> {
  return window.breevDesktop.exportDiagnostics({ incidentCode, locale });
}

async function contactSupport(
  incidentCode: string,
  locale: Locale,
): Promise<DesktopOpenSupportResponse> {
  return window.breevDesktop.openSupport({ incidentCode, locale });
}

async function submitDiagnostics(
  incidentCode: string,
): Promise<DesktopSubmitDiagnosticsResponse> {
  return window.breevDesktop.submitDiagnostics({ incidentCode });
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
      onIncident={reportRendererIncident}
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
      onIncident={reportRendererIncident}
      resetKey={locale}
    >
      {children}
    </DiagnosticErrorBoundary>
  );
}

export function WorkspaceErrorBoundary({
  actionsEnabled,
  centralSubmissionEnabled,
  children,
  resetKey,
}: {
  readonly actionsEnabled: boolean;
  readonly centralSubmissionEnabled: boolean;
  readonly children: ReactNode;
  readonly resetKey: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  return (
    <DiagnosticErrorBoundary
      copy={messages[locale].crash}
      level="workspace"
      {...(actionsEnabled
        ? {
            onContactSupport: (incidentCode: string) =>
              contactSupport(incidentCode, locale),
            onExportDiagnostics: (incidentCode: string) =>
              exportDiagnostics(incidentCode, locale),
          }
        : {})}
      onIncident={reportRendererIncident}
      {...(actionsEnabled && centralSubmissionEnabled
        ? { onSubmitDiagnostics: submitDiagnostics }
        : {})}
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
  const source = safeFingerprintMaterial(error);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (
    prefix + "-" + (hash >>> 0).toString(16).padStart(8, "0").toUpperCase()
  );
}

export function safeFingerprintMaterial(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const safeName = /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
    ? error.name
    : "Error";
  const frames = (error.stack ?? "")
    .split(/\r?\n/gu)
    .slice(1, 17)
    .flatMap((line) => {
      const match =
        /^\s*at\s+(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$.[\]<> ]{0,80})\s+\(/u.exec(
          line,
        );
      return match?.[1] === undefined ? [] : [match[1].replace(/\s+/gu, " ")];
    });
  return [safeName, ...frames].join("\n");
}

export function createAsyncIncidentCode(error: unknown): string {
  return createIncidentCode(error, "application").replace(/^APP-/u, "ASYNC-");
}

export function CrashFallback({
  copiedState,
  contactState,
  copy,
  exportState,
  incidentCode,
  level,
  onContactSupport,
  onCancelSubmission,
  onConfirmSubmission,
  onConfirmationButton,
  onCopy,
  onExportDiagnostics,
  onHeading,
  onReload,
  onRetry,
  onSubmitDiagnostics,
  secondaryCopy,
  submissionReportId,
  submissionState,
}: {
  readonly copiedState: DiagnosticErrorBoundaryState["copiedState"];
  readonly contactState: DiagnosticErrorBoundaryState["contactState"];
  readonly copy: CrashMessage;
  readonly exportState: DiagnosticErrorBoundaryState["exportState"];
  readonly incidentCode: string;
  readonly level: ErrorBoundaryLevel;
  readonly onContactSupport: (() => void) | undefined;
  readonly onCancelSubmission: () => void;
  readonly onConfirmSubmission: () => void;
  readonly onConfirmationButton: (button: HTMLButtonElement | null) => void;
  readonly onCopy: () => void;
  readonly onExportDiagnostics: (() => void) | undefined;
  readonly onHeading: (heading: HTMLHeadingElement | null) => void;
  readonly onReload: () => void;
  readonly onRetry: (() => void) | undefined;
  readonly onSubmitDiagnostics: (() => void) | undefined;
  readonly secondaryCopy: CrashMessage | undefined;
  readonly submissionReportId: string | null;
  readonly submissionState: DiagnosticErrorBoundaryState["submissionState"];
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
        <p>{copy.privacyNotice}</p>
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
      {submissionState === "confirming" ? (
        <DiagnosticSubmissionConfirmation
          copy={copy}
          onCancel={onCancelSubmission}
          onConfirm={onConfirmSubmission}
          onConfirmButton={onConfirmationButton}
        />
      ) : null}
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
            disabled={exportState === "saving"}
            type="button"
            onClick={onExportDiagnostics}
          >
            {copy.exportDiagnostics}
          </button>
        )}
        {onContactSupport === undefined ? null : (
          <button
            className="quiet-button"
            disabled={contactState === "opening"}
            type="button"
            onClick={onContactSupport}
          >
            {copy.contactSupport}
          </button>
        )}
        {onSubmitDiagnostics === undefined ? null : (
          <button
            className="quiet-button"
            disabled={submissionState === "submitting"}
            type="button"
            onClick={onSubmitDiagnostics}
          >
            {copy.submitDiagnostics}
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
      <p className="crash-copy-status" role="status" aria-live="polite">
        {exportState === "saved"
          ? copy.exportSaved
          : exportState === "failed"
            ? copy.exportFailed
            : exportState === "cancelled"
              ? copy.exportCancelled
              : ""}
      </p>
      <p className="crash-copy-status" role="status" aria-live="polite">
        {contactState === "opened"
          ? copy.contactOpened
          : contactState === "failed"
            ? copy.contactFailed
            : contactState === "unavailable"
              ? `${copy.contactUnavailable} ${copy.manualSupportInstructions}`
              : ""}
      </p>
      <p className="crash-copy-status" role="status" aria-live="polite">
        {submissionState === "submitted"
          ? `${copy.submitted} ${copy.reportReference}: ${submissionReportId ?? ""}`
          : submissionState === "failed"
            ? copy.submitFailed
            : submissionState === "unavailable"
              ? copy.submitUnavailable
              : ""}
      </p>
    </section>
  );
}

export function DiagnosticSubmissionConfirmation({
  copy,
  onCancel,
  onConfirm,
  onConfirmButton,
}: {
  readonly copy: CrashMessage;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onConfirmButton?: (button: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmButton.current?.focus();
  }, []);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === confirmButton.current) {
      event.preventDefault();
      cancelButton.current?.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === cancelButton.current
    ) {
      event.preventDefault();
      confirmButton.current?.focus();
    }
  };
  return (
    <div
      aria-describedby="diagnostic-confirm-description"
      aria-labelledby="diagnostic-confirm-title"
      aria-modal="true"
      className="crash-confirmation"
      onKeyDown={handleKeyDown}
      role="alertdialog"
    >
      <h2 id="diagnostic-confirm-title">{copy.confirmSubmissionTitle}</h2>
      <p id="diagnostic-confirm-description">
        {copy.confirmSubmissionDescription}
      </p>
      <button
        className="primary-button"
        onClick={onConfirm}
        ref={(button) => {
          confirmButton.current = button;
          onConfirmButton?.(button);
        }}
        type="button"
      >
        {copy.confirmSubmission}
      </button>
      <button
        className="quiet-button"
        onClick={onCancel}
        ref={cancelButton}
        type="button"
      >
        {copy.cancelSubmission}
      </button>
    </div>
  );
}

export function crashCopyForLocale(locale: Locale): CrashMessage {
  return messages[locale].crash;
}
