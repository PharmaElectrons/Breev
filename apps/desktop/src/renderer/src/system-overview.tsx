import type { DesktopStartupConfig } from "@breev/contracts/desktop-preload";
import type { LocalHealthSuccess } from "@breev/contracts/local-rest";
import { useEffect, useRef, useState } from "react";

import { useIdentityState } from "./identity-state-provider";
import { messages } from "./messages";
import { usePreferences } from "./preferences-provider";

export function SystemOverview({
  handshake,
  startupConfig,
}: {
  readonly handshake: LocalHealthSuccess;
  readonly startupConfig: DesktopStartupConfig;
}): React.JSX.Element | null {
  const { state } = useIdentityState();
  const { locale } = usePreferences();
  if (state === null || state.state !== "authenticated") {
    return null;
  }
  const copy = messages[locale].systemOverview;

  return (
    <section
      aria-labelledby="system-overview-heading"
      className="system-overview animate-reveal"
    >
      <header className="system-overview-header">
        <div>
          <p className="system-overview-kicker">
            {messages[locale].connectionStatus}
          </p>
          <h2 id="system-overview-heading">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
      </header>

      <dl className="system-information-list">
        <InformationRow label={copy.pharmacyName} value={state.pharmacy.name} />
        <IdentifierRow
          copyLabel={copy.copy}
          copiedLabel={copy.copied}
          label={copy.pharmacyId}
          value={state.pharmacy.id}
        />
        <InformationRow
          label={copy.localDeviceRole}
          value={
            startupConfig.role === "main" ? copy.mainRole : copy.terminalRole
          }
        />
        <IdentifierRow
          copyLabel={copy.copy}
          copiedLabel={copy.copied}
          emptyLabel={copy.notAvailable}
          label={copy.deviceId}
          value={startupConfig.deviceId}
        />
        <IdentifierRow
          copyLabel={copy.copy}
          copiedLabel={copy.copied}
          emptyLabel={copy.notAvailable}
          label={copy.installationId}
          value={startupConfig.installationId}
        />
        <InformationRow
          label={copy.localServer}
          status="available"
          value={copy.connected}
        />
        <InformationRow
          label={copy.database}
          status="available"
          value={copy.databaseAvailable}
        />
        <InformationRow
          label={copy.apiVersion}
          mono
          value={handshake.apiVersion}
        />
        <InformationRow
          label={copy.schemaVersion}
          mono
          value={handshake.schemaVersion}
        />
      </dl>
    </section>
  );
}

function InformationRow({
  label,
  mono = false,
  status,
  value,
}: {
  readonly label: string;
  readonly mono?: boolean;
  readonly status?: "available";
  readonly value: string;
}): React.JSX.Element {
  return (
    <div className="system-information-row">
      <dt>{label}</dt>
      <dd className={mono ? "system-information-value is-mono" : undefined}>
        {status === undefined ? null : (
          <span className="connection-dot" aria-hidden="true" />
        )}
        {value}
      </dd>
    </div>
  );
}

function IdentifierRow({
  copyLabel,
  copiedLabel,
  emptyLabel = "",
  label,
  value,
}: {
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly emptyLabel?: string;
  readonly label: string;
  readonly value: string | undefined;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) {
        clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const copyValue = async (): Promise<void> => {
    if (value === undefined) {
      return;
    }
    try {
      await window.breevDesktop.copyIdentifier({ identifier: value });
      setCopied(true);
      if (resetTimer.current !== undefined) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="system-information-row">
      <dt>{label}</dt>
      <dd className="identifier-value">
        {value === undefined ? (
          <span>{emptyLabel}</span>
        ) : (
          <>
            <bdi className="identifier-text" dir="ltr">
              {value}
            </bdi>
            <button
              aria-label={`${copyLabel} ${label}`}
              className="identifier-copy-button"
              type="button"
              onClick={() => void copyValue()}
            >
              {copied ? copiedLabel : copyLabel}
            </button>
            <span className="visually-hidden" role="status" aria-live="polite">
              {copied ? copiedLabel : ""}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}
