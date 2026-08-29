import type {
  DesktopManualEndpointRequest,
  TerminalPairingStage,
  TerminalPairingState,
} from "@breev/contracts/desktop-preload";
import { useEffect, useRef, useState } from "react";

import { FingerprintDigits } from "./fingerprint-digits";
import { usePreferences } from "./preferences-provider";
import {
  acceptsPairingInvitation,
  isPairingInProgress,
  isPairingInvitation,
  isPairingRetryable,
  pairingFingerprintDigits,
  pairingProgressIndex,
  parseEndpointPort,
  TERMINAL_PAIRING_PROGRESS_STEPS,
} from "./terminal-pairing";
import {
  terminalPairingMessages,
  type TerminalPairingCopy,
} from "./terminal-pairing-messages";

type FieldError = "host" | "invitation" | "port" | null;

const HOST_PATTERN = /^[A-Za-z0-9.:[\]_-]{1,255}$/u;

export function TerminalPairingScreen({
  onCancel,
  onSubmitEndpoint,
  onSubmitInvitation,
  pairing,
}: {
  readonly onCancel: () => Promise<void>;
  readonly onSubmitEndpoint: (
    endpoint: DesktopManualEndpointRequest,
  ) => Promise<void>;
  readonly onSubmitInvitation: (invitation: string) => Promise<void>;
  readonly pairing: TerminalPairingState | null;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = terminalPairingMessages[locale];
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [fieldError, setFieldError] = useState<FieldError>(null);
  const invitationRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLInputElement>(null);
  const portRef = useRef<HTMLInputElement>(null);
  const stage = pairing?.stage;

  useEffect(() => {
    if (stage === "failed") {
      invitationRef.current?.focus();
    }
  }, [stage]);

  if (pairing === null) {
    return (
      <section className="identity-region" aria-live="polite">
        <div className="identity-card identity-loading" role="status">
          <span className="status-spinner" aria-hidden="true" />
          <p>{copy.title}</p>
        </div>
      </section>
    );
  }

  const canSubmit = acceptsPairingInvitation(pairing);
  const digits = pairingFingerprintDigits(pairing);

  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    void work().finally(() => setBusy(false));
  };

  const submitInvitation = (): void => {
    const value = invitation.trim();
    if (!isPairingInvitation(value)) {
      setFieldError("invitation");
      invitationRef.current?.focus();
      return;
    }
    setFieldError(null);
    run(() => onSubmitInvitation(value));
  };

  const submitEndpoint = (): void => {
    const trimmedHost = host.trim();
    if (!HOST_PATTERN.test(trimmedHost)) {
      setFieldError("host");
      hostRef.current?.focus();
      return;
    }
    const parsedPort = parseEndpointPort(port.trim());
    if (parsedPort === null) {
      setFieldError("port");
      portRef.current?.focus();
      return;
    }
    const value = invitation.trim();
    if (!isPairingInvitation(value)) {
      setFieldError("invitation");
      invitationRef.current?.focus();
      return;
    }
    setFieldError(null);
    run(() =>
      onSubmitEndpoint({
        host: trimmedHost,
        invitation: value,
        port: parsedPort,
      }),
    );
  };

  return (
    <section
      className="identity-region pairing-region"
      aria-label={copy.title}
      data-pairing-stage={pairing.stage}
      data-testid="terminal-pairing"
    >
      <article className="identity-card pairing-card">
        <div className="identity-heading">
          <span className="identity-symbol" aria-hidden="true">
            ⌁
          </span>
          <div>
            <h2>{copy.title}</h2>
            <p>{copy.description}</p>
          </div>
        </div>

        {pairing.stage === "failed" ? (
          <div
            className="denial-alert pairing-failure"
            data-retryable={isPairingRetryable(pairing.reason)}
            role="alert"
          >
            <span className="denial-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>
                {isPairingRetryable(pairing.reason)
                  ? copy.failureTitle
                  : copy.failureUnrecoverableTitle}
              </strong>
              <p>{copy.failures[pairing.reason]}</p>
            </div>
            {/*
             * A failure the machine itself causes offers no retry: the button
             * would only run the same refusal again. The message carries the
             * repair instead.
             */}
            {isPairingRetryable(pairing.reason) ? (
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={() => run(onCancel)}
              >
                {copy.retry}
              </button>
            ) : null}
          </div>
        ) : null}

        {pairing.stage === "paired" ? (
          <div className="pairing-done" role="status">
            <h3>{copy.pairedTitle}</h3>
            <p>{copy.pairedDescription}</p>
          </div>
        ) : null}

        {isPairingInProgress(pairing) ? (
          <PairingProgress copy={copy} stage={pairing.stage} />
        ) : null}

        {digits === null ? null : (
          <div className="pairing-fingerprint">
            <h3>{copy.fingerprintTitle}</h3>
            <FingerprintDigits digits={digits} />
            {pairing.stage === "awaiting-confirmation" ? (
              <p className="pairing-terminal-name">
                {copy.terminalNameLabel}: {pairing.deviceName}
              </p>
            ) : null}
            <p>{copy.fingerprintHelp}</p>
          </div>
        )}

        {isPairingInProgress(pairing) ? (
          <div className="form-actions">
            <button
              className="quiet-button"
              disabled={busy}
              type="button"
              onClick={() => run(onCancel)}
            >
              {copy.cancel}
            </button>
          </div>
        ) : null}

        {canSubmit ? (
          <>
            <form
              className="identity-form pairing-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitInvitation();
              }}
            >
              <h3>{copy.invitationTitle}</h3>
              <label className="field-label">
                <span>{copy.invitation}</span>
                <input
                  autoComplete="off"
                  autoFocus
                  dir="ltr"
                  aria-describedby="pairing-invitation-help"
                  aria-invalid={fieldError === "invitation" ? true : undefined}
                  maxLength={2_048}
                  name="invitation"
                  ref={invitationRef}
                  required
                  spellCheck={false}
                  value={invitation}
                  onChange={(event) => setInvitation(event.target.value)}
                />
              </label>
              <p className="pairing-hint" id="pairing-invitation-help">
                {copy.invitationHelp}
              </p>
              <button className="primary-button" disabled={busy} type="submit">
                {copy.submit}
              </button>
            </form>

            <section
              className="pairing-discovery"
              aria-label={copy.candidatesTitle}
            >
              <h3>{copy.candidatesTitle}</h3>
              <p className="pairing-hint">{copy.discoveryNote}</p>
              {pairing.candidates.length === 0 ? (
                <p className="pairing-empty" role="status">
                  {copy.candidatesEmpty}
                </p>
              ) : (
                <ul className="pairing-candidates">
                  {pairing.candidates.map((candidate) => (
                    <li key={`${candidate.host}:${candidate.port}`}>
                      <div>
                        <strong>{candidate.name}</strong>
                        <span dir="ltr" className="pairing-endpoint">
                          {candidate.host}:{candidate.port}
                        </span>
                        <span className="pairing-installation">
                          {copy.installationLabel}:{" "}
                          <span dir="ltr">{candidate.installationId}</span>
                        </span>
                      </div>
                      <button
                        className="quiet-button"
                        disabled={busy}
                        type="button"
                        onClick={() => {
                          setHost(candidate.host);
                          setPort(String(candidate.port));
                          setFieldError(null);
                          hostRef.current?.focus();
                        }}
                      >
                        {copy.candidateUse}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <form
              className="identity-form pairing-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitEndpoint();
              }}
            >
              <h3>{copy.manualTitle}</h3>
              <p className="pairing-hint">{copy.manualDescription}</p>
              <div className="pairing-endpoint-fields">
                <label className="field-label">
                  <span>{copy.host}</span>
                  <input
                    autoComplete="off"
                    dir="ltr"
                    aria-invalid={fieldError === "host" ? true : undefined}
                    maxLength={255}
                    name="host"
                    ref={hostRef}
                    required
                    spellCheck={false}
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  <span>{copy.port}</span>
                  <input
                    autoComplete="off"
                    dir="ltr"
                    aria-invalid={fieldError === "port" ? true : undefined}
                    inputMode="numeric"
                    maxLength={5}
                    name="port"
                    ref={portRef}
                    required
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                  />
                </label>
              </div>
              <button className="quiet-button" disabled={busy} type="submit">
                {copy.manualSubmit}
              </button>
            </form>

            <p className="pairing-validation" role="alert">
              {fieldError === null ? "" : validationMessage(copy, fieldError)}
            </p>
          </>
        ) : null}
      </article>
    </section>
  );
}

function PairingProgress({
  copy,
  stage,
}: {
  readonly copy: TerminalPairingCopy;
  readonly stage: TerminalPairingStage;
}): React.JSX.Element {
  const current = pairingProgressIndex(stage);
  const currentStep = TERMINAL_PAIRING_PROGRESS_STEPS[current];
  return (
    <div className="pairing-progress">
      <h3 id="pairing-progress-title">{copy.progressTitle}</h3>
      <ol aria-labelledby="pairing-progress-title">
        {TERMINAL_PAIRING_PROGRESS_STEPS.map((step, index) => {
          const stepState =
            index < current
              ? "done"
              : index === current
                ? "current"
                : "pending";
          return (
            <li key={step} data-step-state={stepState}>
              <span aria-hidden="true" className="pairing-step-marker">
                {stepState === "done"
                  ? "✓"
                  : stepState === "current"
                    ? "●"
                    : "○"}
              </span>
              <span>{copy.steps[step]}</span>
              <span className="pairing-step-state">
                {copy.stepState[stepState]}
              </span>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="pairing-progress-live" role="status">
        {currentStep === undefined ? "" : copy.steps[currentStep]}
      </p>
    </div>
  );
}

function validationMessage(
  copy: TerminalPairingCopy,
  error: Exclude<FieldError, null>,
): string {
  switch (error) {
    case "host":
      return copy.hostInvalid;
    case "invitation":
      return copy.invitationInvalid;
    case "port":
      return copy.portInvalid;
  }
}
