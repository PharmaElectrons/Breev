import type {
  DeviceInventory,
  DevicesDenial,
  IdentityDenial,
  LicensingDenial,
  PairingCancellationReason,
  PairingSessionView,
  StepUpAction,
  TerminalDeviceSummary,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";

import {
  approveSeatRelease,
  cancelPairingSession,
  confirmPairingSession,
  DevicesApiDenied,
  newIdempotencyKey,
  requestCurrentPairingSession,
  requestDeviceInventory,
  requestSeatRelease,
  revokeDevice,
  startPairingSession,
} from "./devices-api";
import { devicesMessages, type DevicesCopy } from "./devices-messages";
import { FingerprintDigits } from "./fingerprint-digits";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import type { IdentityCopy } from "./identity-messages";
import type { LicensingCopy } from "./licensing-messages";
import { formatCountdown, remainingSeconds } from "./pairing-format";
import { formatDateTime, formatNumber } from "./preferences";
import { usePreferences } from "./preferences-provider";

const DEVICES_POLL_INTERVAL_MS = 5_000;
const PAIRING_SESSION_POLL_INTERVAL_MS = 2_000;
const COUNTDOWN_TICK_MS = 1_000;

type DevicesSection = "devices" | "pairing";
type PanelDenial = DevicesDenial | IdentityDenial | LicensingDenial;

interface PendingSeatRelease {
  readonly deviceName: string;
  readonly requestId: string;
}

export function DevicesPanel({
  baseUrl,
  beginStepUp,
  identityCopy,
  licensingCopy,
}: {
  readonly baseUrl: string;
  readonly beginStepUp: (
    action: StepUpAction,
    subjectId: string | undefined,
    afterApproval: (challengeId: string) => Promise<void>,
  ) => Promise<void>;
  readonly identityCopy: IdentityCopy;
  readonly licensingCopy: LicensingCopy;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = devicesMessages[locale];
  const [section, setSection] = useState<DevicesSection>("pairing");
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [session, setSession] = useState<PairingSessionView | null>(null);
  const [denial, setDenial] = useState<PanelDenial | null>(null);
  const [commandFailed, setCommandFailed] = useState(false);
  const [devicesStale, setDevicesStale] = useState(false);
  const [sessionStale, setSessionStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [seatRelease, setSeatRelease] = useState<PendingSeatRelease | null>(
    null,
  );
  const [now, setNow] = useState(() => new Date());
  const restoreFocus = useRef<HTMLElement | null>(null);

  /**
   * A command either commits, is denied for a reason the contract names, or
   * fails in a way no one translated — a timeout, a proxy error, a malformed
   * body. The third case used to return the screen to idle in silence, which
   * left the operator unable to tell whether the command ran.
   */
  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setDenial(null);
      setCommandFailed(false);
      try {
        return await work();
      } catch (error) {
        if (
          error instanceof DevicesApiDenied ||
          error instanceof IdentityApiDenied ||
          error instanceof LicensingApiDenied
        ) {
          setDenial(error.denial);
        } else {
          setCommandFailed(true);
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /**
   * Polling never raises a denial banner — user-initiated commands own that
   * surface. It does mark the panel stale, because a list that stopped
   * refreshing is a list whose buttons would act on a guess.
   */
  const loadDevices = useCallback(async (): Promise<void> => {
    try {
      setInventory(await requestDeviceInventory(baseUrl));
      setDevicesStale(false);
    } catch {
      setDevicesStale(true);
    }
  }, [baseUrl]);

  const loadSession = useCallback(async (): Promise<void> => {
    try {
      setSession(await requestCurrentPairingSession(baseUrl));
      setSessionStale(false);
    } catch {
      setSessionStale(true);
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadDevices();
    const timer = setInterval(
      () => void loadDevices(),
      DEVICES_POLL_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [loadDevices]);

  useEffect(() => {
    void loadSession();
    const timer = setInterval(
      () => void loadSession(),
      PAIRING_SESSION_POLL_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [loadSession]);

  const counting =
    session?.state === "open" || session?.state === "awaiting-confirmation";

  useEffect(() => {
    if (!counting) {
      return;
    }
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [counting]);

  /**
   * The start response carries no invitation when the Main installation
   * replayed a recorded idempotency result, because nothing that can rebuild a
   * live QR is ever written to the database. The invitation therefore always
   * comes from the current-session poll, which serves it from memory while the
   * session is open, and this screen reads no field of the start response.
   */
  const startPairing = (): void => {
    void beginStepUp(
      "devices.pairing.start",
      undefined,
      async (challengeId) => {
        const started = await run(() =>
          startPairingSession(baseUrl, {
            idempotencyKey: newIdempotencyKey(),
            stepUpChallengeId: challengeId,
          }),
        );
        if (started !== undefined) {
          setSection("pairing");
          await loadSession();
        }
      },
    );
  };

  const confirmSession = (sessionId: string): void => {
    void run(() =>
      confirmPairingSession(baseUrl, sessionId, {
        idempotencyKey: newIdempotencyKey(),
      }),
    ).then(async (confirmed) => {
      if (confirmed !== undefined) {
        await loadSession();
        await loadDevices();
      }
    });
  };

  const cancelSession = (
    sessionId: string,
    reason: PairingCancellationReason,
  ): void => {
    void run(() =>
      cancelPairingSession(baseUrl, sessionId, {
        idempotencyKey: newIdempotencyKey(),
        reason,
      }),
    ).then(() => void loadSession());
  };

  const revoke = (device: TerminalDeviceSummary, reason: string): void => {
    void beginStepUp("devices.revoke", device.id, async (challengeId) => {
      const revoked = await run(() =>
        revokeDevice(baseUrl, device.id, {
          idempotencyKey: newIdempotencyKey(),
          reason,
          stepUpChallengeId: challengeId,
        }),
      );
      if (revoked !== undefined) {
        setRevoking(null);
        await loadDevices();
      }
    });
  };

  const openSeatRelease = (device: TerminalDeviceSummary): void => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    void beginStepUp(
      "devices.seat.release.request",
      device.id,
      async (challengeId) => {
        const requested = await run(() =>
          requestSeatRelease(baseUrl, {
            deviceId: device.id,
            idempotencyKey: newIdempotencyKey(),
            stepUpChallengeId: challengeId,
          }),
        );
        if (requested !== undefined) {
          setSeatRelease({
            deviceName: device.displayName,
            requestId: requested.requestId,
          });
        }
      },
    );
  };

  const closeSeatRelease = (): void => {
    setSeatRelease(null);
    queueMicrotask(() => restoreFocus.current?.focus());
  };

  const stale = devicesStale || sessionStale;
  const seats = inventory?.seatUsage ?? null;

  return (
    <>
      <article
        aria-labelledby="devices-title"
        className="identity-card admin-card devices-card"
        data-stale={stale ? "true" : undefined}
        inert={seatRelease === null ? undefined : true}
      >
        <div className="admin-heading">
          <div>
            <h3 id="devices-title">{copy.title}</h3>
            <p>{copy.description}</p>
          </div>
          <p aria-live="polite" className="seat-usage" role="status">
            <span>{copy.seatUsage}</span>
            {/*
             * The permitted count is licence data. With no valid licence there
             * is no count to show, and inventing one would be a claim about
             * entitlement the Main installation never made.
             */}
            {inventory !== null && seats === null ? (
              <strong className="seat-usage-unlicensed">
                {copy.seatUsageUnlicensed}
              </strong>
            ) : (
              <strong dir="ltr">
                {seats === null
                  ? "—"
                  : `${formatNumber(seats.used, locale)} / ${formatNumber(
                      seats.permitted,
                      locale,
                    )}`}
              </strong>
            )}
          </p>
        </div>

        {stale ? (
          <p className="devices-stale" role="status">
            {copy.staleData}
          </p>
        ) : null}

        <nav aria-label={copy.sectionsLabel} className="devices-navigation">
          <ul>
            <li>
              <button
                aria-current={section === "pairing" ? "page" : undefined}
                type="button"
                onClick={() => setSection("pairing")}
              >
                {copy.pairingTitle}
              </button>
            </li>
            <li>
              <button
                aria-current={section === "devices" ? "page" : undefined}
                type="button"
                onClick={() => setSection("devices")}
              >
                {copy.deviceListTitle}
              </button>
            </li>
          </ul>
        </nav>

        {denial === null ? null : (
          <DevicesDenialAlert
            copy={copy}
            denial={denial}
            identityCopy={identityCopy}
            licensingCopy={licensingCopy}
            onDismiss={() => setDenial(null)}
          />
        )}

        {commandFailed ? (
          <DevicesFailureAlert
            copy={copy}
            onDismiss={() => setCommandFailed(false)}
          />
        ) : null}

        {section === "pairing" ? (
          <PairingSection
            busy={busy || stale}
            copy={copy}
            now={now}
            session={session}
            onCancel={cancelSession}
            onConfirm={confirmSession}
            onStart={startPairing}
            onViewDevices={() => setSection("devices")}
          />
        ) : (
          <DeviceList
            busy={busy || stale}
            copy={copy}
            devices={inventory?.devices ?? null}
            revoking={revoking}
            onRequestSeatRelease={openSeatRelease}
            onRevoke={revoke}
            onRevokeCancel={() => setRevoking(null)}
            onRevokeStart={setRevoking}
          />
        )}
      </article>

      {seatRelease === null ? null : (
        <SeatReleaseDialog
          busy={busy}
          commandFailed={commandFailed}
          copy={copy}
          denial={denial}
          deviceName={seatRelease.deviceName}
          identityCopy={identityCopy}
          licensingCopy={licensingCopy}
          onCancel={closeSeatRelease}
          onDismissDenial={() => setDenial(null)}
          onDismissFailure={() => setCommandFailed(false)}
          onSubmit={async (approverUsername, approverPassword) => {
            const approved = await run(() =>
              approveSeatRelease(baseUrl, seatRelease.requestId, {
                approverPassword,
                approverUsername,
                idempotencyKey: newIdempotencyKey(),
              }),
            );
            if (approved === undefined) {
              return false;
            }
            closeSeatRelease();
            await loadDevices();
            return true;
          }}
        />
      )}
    </>
  );
}

function PairingSection({
  busy,
  copy,
  now,
  onCancel,
  onConfirm,
  onStart,
  onViewDevices,
  session,
}: {
  readonly busy: boolean;
  readonly copy: DevicesCopy;
  readonly now: Date;
  readonly onCancel: (
    sessionId: string,
    reason: PairingCancellationReason,
  ) => void;
  readonly onConfirm: (sessionId: string) => void;
  readonly onStart: () => void;
  readonly onViewDevices: () => void;
  readonly session: PairingSessionView | null;
}): React.JSX.Element {
  if (session === null) {
    return (
      <div className="identity-loading" role="status">
        <span className="status-spinner" aria-hidden="true" />
        <p>{copy.loading}</p>
      </div>
    );
  }

  switch (session.state) {
    case "none":
      return (
        <div className="pairing-start">
          <p>{copy.sessionNone}</p>
          <button
            className="primary-button"
            disabled={busy}
            type="button"
            onClick={onStart}
          >
            {copy.startPairing}
          </button>
        </div>
      );
    case "open":
      return (
        <div className="pairing-invitation">
          <PairingQr copy={copy} uri={session.qrUri} />
          <div className="pairing-invitation-detail">
            <p className="pairing-countdown">
              {copy.expiresIn}{" "}
              <strong dir="ltr">
                {formatCountdown(remainingSeconds(session.expiresAt, now))}
              </strong>
            </p>
            <p className="pairing-uri-label" id="pairing-uri-label">
              {copy.invitationUri}
            </p>
            <code
              aria-labelledby="pairing-uri-label"
              className="pairing-uri"
              dir="ltr"
              tabIndex={0}
            >
              {session.qrUri}
            </code>
            <div className="form-actions">
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={() => onCancel(session.sessionId, "user-cancelled")}
              >
                {copy.cancelSession}
              </button>
            </div>
          </div>
        </div>
      );
    case "awaiting-confirmation":
      return (
        <div className="pairing-confirmation">
          <div role="status">
            <h4>{copy.awaitingConfirmationTitle}</h4>
            <p>{copy.awaitingConfirmationDescription}</p>
          </div>
          <div className="pairing-invitation">
            <PairingQr copy={copy} uri={session.qrV2Uri} />
            <div className="pairing-invitation-detail">
              <p className="pairing-terminal-name">
                {copy.terminalName}: <strong>{session.terminalName}</strong>
              </p>
              <h5>{copy.fingerprintTitle}</h5>
              <FingerprintDigits digits={session.fingerprintDigits} />
              <p className="pairing-countdown">
                {copy.expiresIn}{" "}
                <strong dir="ltr">
                  {formatCountdown(remainingSeconds(session.expiresAt, now))}
                </strong>
              </p>
              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  type="button"
                  onClick={() => onConfirm(session.sessionId)}
                >
                  {copy.confirmPairing}
                </button>
                <button
                  className="quiet-button"
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    onCancel(session.sessionId, "fingerprint-mismatch")
                  }
                >
                  {copy.cancelMismatch}
                </button>
                <button
                  className="quiet-button"
                  disabled={busy}
                  type="button"
                  onClick={() => onCancel(session.sessionId, "user-cancelled")}
                >
                  {copy.cancelSession}
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    case "confirmed":
      return (
        <div className="pairing-outcome" data-outcome="confirmed" role="status">
          <p>
            {copy.sessionConfirmed} <strong>{session.displayName}</strong>
          </p>
          <div className="form-actions">
            <button
              className="quiet-button"
              type="button"
              onClick={onViewDevices}
            >
              {copy.viewDevices}
            </button>
            <button
              className="primary-button"
              disabled={busy}
              type="button"
              onClick={onStart}
            >
              {copy.startAgain}
            </button>
          </div>
        </div>
      );
    case "cancelled":
      return (
        <PairingOutcome
          busy={busy}
          copy={copy}
          message={copy.sessionCancelled[session.reason]}
          outcome="cancelled"
          onStart={onStart}
        />
      );
    case "expired":
      return (
        <PairingOutcome
          busy={busy}
          copy={copy}
          message={copy.sessionExpired}
          outcome="expired"
          onStart={onStart}
        />
      );
    case "failed":
      return (
        <PairingOutcome
          busy={busy}
          copy={copy}
          message={copy.sessionFailed[session.reason]}
          outcome="failed"
          onStart={onStart}
        />
      );
  }
}

function PairingOutcome({
  busy,
  copy,
  message,
  onStart,
  outcome,
}: {
  readonly busy: boolean;
  readonly copy: DevicesCopy;
  readonly message: string;
  readonly onStart: () => void;
  readonly outcome: "cancelled" | "expired" | "failed";
}): React.JSX.Element {
  return (
    <div className="pairing-outcome" data-outcome={outcome} role="status">
      <p>{message}</p>
      <button
        className="primary-button"
        disabled={busy}
        type="button"
        onClick={onStart}
      >
        {copy.startAgain}
      </button>
    </div>
  );
}

function DeviceList({
  busy,
  copy,
  devices,
  onRequestSeatRelease,
  onRevoke,
  onRevokeCancel,
  onRevokeStart,
  revoking,
}: {
  readonly busy: boolean;
  readonly copy: DevicesCopy;
  readonly devices: readonly TerminalDeviceSummary[] | null;
  readonly onRequestSeatRelease: (device: TerminalDeviceSummary) => void;
  readonly onRevoke: (device: TerminalDeviceSummary, reason: string) => void;
  readonly onRevokeCancel: () => void;
  readonly onRevokeStart: (deviceId: string) => void;
  readonly revoking: string | null;
}): React.JSX.Element {
  const { locale } = usePreferences();

  if (devices === null) {
    return (
      <div className="identity-loading" role="status">
        <span className="status-spinner" aria-hidden="true" />
        <p>{copy.loading}</p>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <p className="devices-empty" role="status">
        {copy.devicesEmpty}
      </p>
    );
  }

  return (
    <ul className="user-list device-list">
      {devices.map((device) => {
        const revoked = device.revokedAt !== null;
        const released = device.seatReleasedAt !== null;
        return (
          <li key={device.id}>
            <div>
              <strong>{device.displayName}</strong>
              <span>
                {copy.pairedAt}:{" "}
                {formatDateTime(new Date(device.pairedAt), locale)}
              </span>
              <span>
                {copy.validUntil}:{" "}
                {formatDateTime(new Date(device.certNotAfter), locale)}
              </span>
              {device.revocationReason === null ? null : (
                <span>
                  {copy.revocationReason}: {device.revocationReason}
                </span>
              )}
              {revoked && !released ? (
                <span>{copy.seatReleasePending}</span>
              ) : null}
            </div>
            <div className="user-actions">
              <span
                className="state-chip"
                data-status={revoked ? "locked" : "active"}
              >
                <span aria-hidden="true">{revoked ? "!" : "✓"}</span>
                {revoked ? copy.revoked : copy.active}
              </span>
              {device.connected && !revoked ? (
                <span className="state-chip" data-status="active">
                  <span aria-hidden="true">●</span>
                  {copy.connected}
                </span>
              ) : null}
              {released ? (
                <span className="state-chip" data-status="released">
                  <span aria-hidden="true">↺</span>
                  {copy.seatReleased}
                </span>
              ) : null}
              {revoked ? null : (
                <button
                  aria-label={`${copy.revoke}: ${device.displayName}`}
                  className="quiet-button"
                  disabled={busy}
                  type="button"
                  onClick={() => onRevokeStart(device.id)}
                >
                  {copy.revoke}
                </button>
              )}
              {revoked && !released ? (
                <button
                  aria-label={`${copy.requestSeatRelease}: ${device.displayName}`}
                  className="quiet-button"
                  disabled={busy}
                  type="button"
                  onClick={() => onRequestSeatRelease(device)}
                >
                  {copy.requestSeatRelease}
                </button>
              ) : null}
            </div>
            {revoking === device.id ? (
              <form
                className="identity-form revoke-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const reason = new FormData(form).get("reason");
                  if (
                    typeof reason !== "string" ||
                    reason.trim().length === 0
                  ) {
                    return;
                  }
                  onRevoke(device, reason.trim());
                }}
              >
                <p>{copy.revokeDescription}</p>
                <label className="field-label">
                  <span>{copy.revocationReason}</span>
                  <input
                    autoFocus
                    maxLength={128}
                    name="reason"
                    required
                    type="text"
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={busy}
                    type="submit"
                  >
                    {copy.revokeSubmit}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={onRevokeCancel}
                  >
                    {copy.cancel}
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SeatReleaseDialog({
  busy,
  commandFailed,
  copy,
  denial,
  deviceName,
  identityCopy,
  licensingCopy,
  onCancel,
  onDismissDenial,
  onDismissFailure,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly commandFailed: boolean;
  readonly copy: DevicesCopy;
  readonly denial: PanelDenial | null;
  readonly deviceName: string;
  readonly identityCopy: IdentityCopy;
  readonly licensingCopy: LicensingCopy;
  readonly onCancel: () => void;
  readonly onDismissDenial: () => void;
  readonly onDismissFailure: () => void;
  readonly onSubmit: (username: string, password: string) => Promise<boolean>;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  return (
    <div
      aria-describedby="seat-release-description"
      aria-labelledby="seat-release-title"
      aria-modal="true"
      className="dialog-backdrop"
      ref={dialog}
      role="dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel();
          return;
        }
        if (event.key === "Tab") {
          const focusable = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable === undefined || focusable.length === 0) {
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="identity-card step-up-dialog">
        <h2 id="seat-release-title">{copy.seatReleaseApprovalTitle}</h2>
        <p id="seat-release-description">
          {copy.seatReleaseApprovalDescription}
        </p>
        <p className="seat-release-device">
          {copy.terminalName}: <strong>{deviceName}</strong>
        </p>
        {denial === null ? null : (
          <DevicesDenialAlert
            copy={copy}
            denial={denial}
            identityCopy={identityCopy}
            licensingCopy={licensingCopy}
            onDismiss={onDismissDenial}
          />
        )}
        {commandFailed ? (
          <DevicesFailureAlert copy={copy} onDismiss={onDismissFailure} />
        ) : null}
        <form
          className="identity-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const username = data.get("approverUsername");
            const password = data.get("approverPassword");
            if (typeof username !== "string" || typeof password !== "string") {
              return;
            }
            void onSubmit(username.trim(), password).then((succeeded) => {
              if (succeeded) {
                return;
              }
              const passwordInput = form.elements.namedItem("approverPassword");
              if (passwordInput instanceof HTMLInputElement) {
                passwordInput.focus();
              }
            });
          }}
        >
          <label className="field-label">
            <span>{copy.approverUsername}</span>
            <input
              autoComplete="off"
              autoFocus
              maxLength={64}
              minLength={3}
              name="approverUsername"
              required
            />
          </label>
          <label className="field-label">
            <span>{copy.approverPassword}</span>
            <input
              autoComplete="off"
              maxLength={128}
              name="approverPassword"
              required
              type="password"
            />
          </label>
          <div className="form-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {copy.approvalSubmit}
            </button>
            <button className="quiet-button" type="button" onClick={onCancel}>
              {copy.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DevicesDenialAlert({
  copy,
  denial,
  identityCopy,
  licensingCopy,
  onDismiss,
}: {
  readonly copy: DevicesCopy;
  readonly denial: PanelDenial;
  readonly identityCopy: IdentityCopy;
  readonly licensingCopy: LicensingCopy;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="denial-alert" role="alert">
      <span className="denial-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{copy.denial}</strong>
        <p>{denialMessage(copy, identityCopy, licensingCopy, denial)}</p>
        <small>
          {copy.requestReference}: {denial.requestId}
        </small>
      </div>
      <button
        aria-label={copy.cancel}
        className="dismiss-button"
        type="button"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

/**
 * The failure the contract has no code for: the command left this screen and
 * no answer came back that anyone can read. It says exactly that, and says the
 * outcome is unknown, because claiming either outcome would be a guess.
 */
function DevicesFailureAlert({
  copy,
  onDismiss,
}: {
  readonly copy: DevicesCopy;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="denial-alert devices-failure" role="alert">
      <span className="denial-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{copy.commandFailedTitle}</strong>
        <p>{copy.commandFailed}</p>
      </div>
      <button
        aria-label={copy.cancel}
        className="dismiss-button"
        type="button"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

/**
 * An empty invitation is never drawn as a code: a scannable square that
 * carries nothing would send the terminal operator to a session that does not
 * exist. Missing means saying so.
 */
function PairingQr({
  copy,
  uri,
}: {
  readonly copy: DevicesCopy;
  readonly uri: string;
}): React.JSX.Element {
  const label = copy.qrLabel;
  const svg = useMemo(() => {
    if (uri.length === 0) {
      return null;
    }
    try {
      return renderSVG(uri, {
        blackColor: "#000000",
        border: 2,
        ecc: "M",
        pixelSize: 6,
        whiteColor: "#ffffff",
      });
    } catch {
      return null;
    }
  }, [uri]);

  if (svg === null) {
    return (
      <p className="pairing-qr pairing-qr-failed" role="status">
        {copy.qrUnavailable}
      </p>
    );
  }

  return (
    <div
      aria-label={label}
      className="pairing-qr"
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
    />
  );
}

function denialMessage(
  copy: DevicesCopy,
  identityCopy: IdentityCopy,
  licensingCopy: LicensingCopy,
  denial: PanelDenial,
): string {
  if (denial.code in copy.denials) {
    return copy.denials[denial.code as keyof DevicesCopy["denials"]];
  }
  if (denial.code in licensingCopy.denials) {
    return licensingCopy.denials[denial.code as keyof LicensingCopy["denials"]];
  }
  return identityCopy.denials[denial.code as IdentityDenial["code"]];
}
