import {
  countFailure,
  countNoticeText,
  type CountNotice,
} from "./count-notice";
import {
  useInventoryTimeZone,
  formatInventoryTimestamp,
} from "./inventory-time";
import type { CountLine, CountSession } from "@breev/contracts/local-rest";
import { useEffect, useRef, useState } from "react";

import { useCommittedFocus } from "./committed-focus";
import { CountEntryLabel, CountMeasure } from "./count-entry-label";
import { readCountSession } from "./inventory-api";
import { inventoryMessages } from "./inventory-messages";
import { panelUnitLabel } from "./panel-unit-label";
import { formatNumber } from "./preferences";
import { usePreferences } from "./preferences-provider";

export function CountSessionReview({
  address,
  baseUrl,
  onClose,
  open,
  returnHash = "#/inventory/count",
}: {
  readonly address?: { readonly id: string };
  readonly baseUrl: string;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly returnHash?: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const timeZone = useInventoryTimeZone(baseUrl, open);
  const copy = inventoryMessages[locale].count;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestCommittedFocus = useCommittedFocus();
  const [session, setSession] = useState<CountSession | null>(null);
  const [errorState, setError] = useState<CountNotice | null>(null);
  const error =
    errorState === null ? null : countNoticeText(errorState, locale);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog !== null && !dialog.open) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      setSession(null);
      setError(null);
      const sessionId =
        address?.id ?? countSessionIdFromHash(window.location.hash);
      if (sessionId === null) {
        setError({ kind: "message", key: "unavailable" });
      } else {
        void readCountSession(baseUrl, sessionId)
          .then(setSession)
          .catch((caught: unknown) => {
            setError(countFailure(caught));
          });
      }
      requestCommittedFocus(() =>
        dialog.querySelector<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled])",
        ),
      );
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [address, baseUrl, open, requestCommittedFocus]);

  function handleDialogClose(): void {
    if (
      address !== undefined ||
      window.location.hash.includes("/movements/count-sessions/")
    ) {
      window.history.replaceState(null, "", returnHash);
    }
    onClose();
    requestCommittedFocus(() => openerRef.current);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-describedby="count-session-review-boundary"
      aria-labelledby="count-session-review-title"
      className="posted-purchase-dialog count-session-review-dialog"
      onClose={handleDialogClose}
    >
      <header className="posted-review-heading">
        <div>
          <p className="purchase-context-label">{copy.title}</p>
          <h2 id="count-session-review-title">{copy.loopTitle}</h2>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          {copy.close}
        </button>
      </header>
      <p className="posted-review-boundary" id="count-session-review-boundary">
        {copy.description}
      </p>
      {error === null && session === null ? (
        <p role="status">{inventoryMessages[locale].loading}</p>
      ) : null}
      {error === null ? null : (
        <p aria-live="assertive" className="denial-alert" role="alert">
          {error}
        </p>
      )}
      {session === null ? null : (
        <div className="count-review-content">
          <dl className="count-session-summary">
            <div>
              <dt>{copy.number}</dt>
              <dd>
                {session.number === null
                  ? "—"
                  : `C${session.number.value}/${session.number.year}`}
              </dd>
            </div>
            <div>
              <dt>{copy.status}</dt>
              <dd>
                {session.status === "active"
                  ? copy.activeSessions
                  : copy.completedSessions}
              </dd>
            </div>
            <div>
              <dt>{copy.startedAt}</dt>
              <dd>
                <bdi>
                  {formatInventoryTimestamp(
                    session.startedAt,
                    locale,
                    timeZone,
                  )}
                </bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.startedBy}</dt>
              <dd>{session.startedBy.displayName}</dd>
            </div>
          </dl>
          <div className="count-review-table-wrap">
            <table className="count-lines-table">
              <caption className="visually-hidden">{copy.tableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.columns.item}</th>
                  <th scope="col">{copy.columns.recorded}</th>
                  <th scope="col">{copy.columns.counted}</th>
                  <th scope="col">{copy.columns.before}</th>
                  <th scope="col">{copy.columns.after}</th>
                  <th scope="col">{copy.columns.variance}</th>
                  <th scope="col">{copy.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {session.lines.map((line) => (
                  <CountReviewLine
                    copy={copy}
                    key={line.id}
                    line={line}
                    locale={locale}
                    timeZone={timeZone}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </dialog>
  );
}

function CountReviewLine({
  copy,
  line,
  locale,
  timeZone,
}: {
  readonly copy: typeof inventoryMessages.en.count;
  readonly line: CountLine;
  readonly locale: "ar" | "en";
  readonly timeZone: string | null;
}): React.JSX.Element {
  const application = line.application;
  const after = application?.balanceAfter ?? line.countedQuantity;
  const variance = application?.variance ?? line.varianceAtObservation;
  return (
    <>
      <tr>
        <th scope="row">{line.itemDisplayName}</th>
        <td>
          <CountEntryLabel
            entries={line.entries}
            inventoryUnitName={line.inventoryUnitName}
            locale={locale}
          />
        </td>
        <td>
          <bdi>{formatNumber(BigInt(line.countedQuantity), locale)}</bdi>{" "}
          {panelUnitLabel(
            line.inventoryUnitName,
            BigInt(line.countedQuantity),
            locale,
          )}
        </td>
        <td>
          <CountMeasure
            count={BigInt(line.balanceAtObservation)}
            locale={locale}
            unit={line.inventoryUnitName}
          />
        </td>
        <td>
          <CountMeasure
            count={BigInt(after)}
            locale={locale}
            unit={line.inventoryUnitName}
          />
        </td>
        <td>
          <CountMeasure
            count={BigInt(variance)}
            locale={locale}
            signed
            unit={line.inventoryUnitName}
          />
        </td>
        <td>
          <span aria-hidden="true">{statusIcon(line.status)}</span>{" "}
          {copy.statusLabels[line.status]}
        </td>
      </tr>
      {application === null ? null : (
        <tr className="count-application-row">
          <td colSpan={7}>
            <dl className="count-application-details">
              <div>
                <dt>{copy.applicationReason}</dt>
                <dd>{application.reason}</dd>
              </div>
              <div>
                <dt>{copy.applicationEvidence}</dt>
                <dd>{application.evidence}</dd>
              </div>
              <div>
                <dt>{copy.applicationAppliedBy}</dt>
                <dd>
                  {application.appliedBy.displayName} ·{" "}
                  <bdi>
                    {formatInventoryTimestamp(
                      application.appliedAt,
                      locale,
                      timeZone,
                    )}
                  </bdi>
                </dd>
              </div>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function statusIcon(status: CountLine["status"]): string {
  switch (status) {
    case "matched":
      return "✓";
    case "pending":
      return "•";
    case "stale":
      return "!";
    case "applied":
      return "✓";
  }
}

function countSessionIdFromHash(hash: string): string | null {
  const match = /\/count-sessions\/([^/]+)$/u.exec(hash);
  return match?.[1] ?? null;
}
