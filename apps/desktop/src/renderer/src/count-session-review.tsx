import type { CountLine, CountSession } from "@breev/contracts/local-rest";
import { useEffect, useRef, useState } from "react";

import { useCommittedFocus } from "./committed-focus";
import { countEntryLabelParts } from "./count-entry";
import { InventoryApiDenied, readCountSession } from "./inventory-api";
import { inventoryMessages } from "./inventory-messages";
import { formatDateTime, formatNumber } from "./preferences";
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
  const copy = inventoryMessages[locale].count;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestCommittedFocus = useCommittedFocus();
  const [session, setSession] = useState<CountSession | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setError(copy.unavailable);
      } else {
        void readCountSession(baseUrl, sessionId)
          .then(setSession)
          .catch((caught: unknown) => {
            setError(
              caught instanceof InventoryApiDenied &&
                caught.denial.code in copy.denialMessages
                ? copy.denialMessages[
                    caught.denial.code as keyof typeof copy.denialMessages
                  ]
                : copy.unavailable,
            );
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
  }, [address, baseUrl, copy, open, requestCommittedFocus]);

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
                <bdi>{formatDateTime(new Date(session.startedAt), locale)}</bdi>
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
}: {
  readonly copy: typeof inventoryMessages.en.count;
  readonly line: CountLine;
  readonly locale: "ar" | "en";
}): React.JSX.Element {
  const application = line.application;
  const after = application?.balanceAfter ?? line.countedQuantity;
  const variance = application?.variance ?? line.varianceAtObservation;
  return (
    <>
      <tr>
        <th scope="row">{line.itemDisplayName}</th>
        <td>
          <CountEntryLabel label={line.enteredLabel} locale={locale} />
        </td>
        <td>
          <bdi>{formatNumber(BigInt(line.countedQuantity), locale)}</bdi>{" "}
          {line.inventoryUnitName}
        </td>
        <td>
          <bdi>{formatNumber(BigInt(line.balanceAtObservation), locale)}</bdi>
        </td>
        <td>
          <bdi>{formatNumber(BigInt(after), locale)}</bdi>
        </td>
        <td>
          <bdi>{formatSignedNumber(BigInt(variance), locale)}</bdi>
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
                    {formatDateTime(new Date(application.appliedAt), locale)}
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

function CountEntryLabel({
  label,
  locale,
}: {
  readonly label: string;
  readonly locale: "ar" | "en";
}): React.JSX.Element {
  return (
    <>
      {countEntryLabelParts(label).map((part, index) =>
        typeof part === "bigint" ? (
          <bdi key={`${part.toString()}-${index}`}>
            {formatNumber(part, locale)}
          </bdi>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
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

function formatSignedNumber(value: bigint, locale: "ar" | "en"): string {
  return value > 0n
    ? `+${formatNumber(value, locale)}`
    : formatNumber(value, locale);
}

function countSessionIdFromHash(hash: string): string | null {
  const match = /\/count-sessions\/([^/]+)$/u.exec(hash);
  return match?.[1] ?? null;
}
