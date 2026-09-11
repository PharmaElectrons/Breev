import type {
  IdentityDenial,
  InventoryDenial,
  InventoryBatchSafetyReview,
  InventoryBatchSafetyStatus,
  LicensingDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useState } from "react";

import {
  InventoryApiDenied,
  readBatchSafetyReview,
  readBatchSafetyStatus,
  triggerBatchSafetyRun,
} from "./inventory-api";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { useIdentityState } from "./identity-state-provider";
import { inventoryMessages } from "./inventory-messages";
import { usePreferences } from "./preferences-provider";
import { formatCurrencyFromFils, formatNumber } from "./preferences";
import { StateIndicator } from "./state-indicator";

type ReviewDenial = IdentityDenial | InventoryDenial | LicensingDenial;

export function BatchSafetyReview({
  baseUrl,
  checkNow,
  month,
}: {
  readonly baseUrl: string;
  readonly checkNow: () => Promise<void>;
  readonly month: string | undefined;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale];
  const { state: identity } = useIdentityState();
  const [review, setReview] = useState<InventoryBatchSafetyReview | null>(null);
  const [status, setStatus] = useState<InventoryBatchSafetyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denial, setDenial] = useState<ReviewDenial | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.batch_safety.manage");

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setDenial(null);
    try {
      const [nextReview, nextStatus] = await Promise.all([
        readBatchSafetyReview(baseUrl, month),
        readBatchSafetyStatus(baseUrl),
      ]);
      setReview(nextReview);
      setStatus(nextStatus);
    } catch (caught) {
      if (caught instanceof InventoryApiDenied) {
        setDenial(caught.denial);
      } else if (
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        setDenial(caught.denial);
      } else {
        setError(copy.safety.reviewUnavailable);
      }
    }
  }, [baseUrl, copy.safety.reviewUnavailable, month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow(): Promise<void> {
    setBusy(true);
    setError(null);
    setDenial(null);
    try {
      const nextStatus = await triggerBatchSafetyRun(baseUrl);
      setStatus(nextStatus);
      setAnnouncement(copy.safety.runQueued);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await load();
        if (attempt < 3) await delay(150);
      }
    } catch (caught) {
      if (caught instanceof InventoryApiDenied) {
        setDenial(caught.denial);
        setError(
          caught.denial.code === "job-runtime-unavailable"
            ? copy.safety.jobUnavailable
            : copy.safety.reviewUnavailable,
        );
      } else {
        setError(copy.safety.reviewUnavailable);
      }
    } finally {
      setBusy(false);
    }
  }

  if (review === null) {
    return (
      <section
        className="inventory-workspace batch-safety-review"
        aria-labelledby="batch-review-title"
      >
        <p>
          <a href="#/inventory">{copy.safety.backToInventory}</a>
        </p>
        <h2 id="batch-review-title">{copy.safety.review}</h2>
        {error === null && denial === null ? (
          <p role="status">{copy.loading}</p>
        ) : (
          <>
            <p className="denial-alert" role="alert">
              {error ?? copy.permissionDenied + " " + denial?.requestId}
            </p>
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                void checkNow().then(() => load());
              }}
            >
              {copy.retry}
            </button>
          </>
        )}
      </section>
    );
  }

  const currentStatus = status ?? {
    businessTimeZone: "",
    jobRuntime: "unavailable" as const,
    lastCompletedBusinessDate: null,
    missedBusinessDates: review.runs.missedBusinessDates,
    scheduled: false,
    state: "never-run" as const,
    thresholds: { classes: [], pendingGate: "G-02" as const },
    todayBusinessDate: review.businessDate,
  };

  return (
    <section
      className="inventory-workspace batch-safety-review"
      aria-labelledby="batch-review-title"
    >
      <header className="batch-safety-review-heading">
        <div>
          <p>
            <a href="#/inventory">{copy.safety.backToInventory}</a>
          </p>
          <h2 id="batch-review-title">{copy.safety.review}</h2>
        </div>
        {canManage ? (
          <button
            className="primary-button"
            disabled={busy}
            type="button"
            onClick={() => void runNow()}
          >
            {copy.safety.runNow}
          </button>
        ) : null}
      </header>
      <div className="batch-safety-review-controls">
        <button
          aria-label={copy.safety.previousMonth}
          className="quiet-button"
          type="button"
          onClick={() => navigateMonth(review.month, -1)}
        >
          ← <span className="visually-hidden">{copy.safety.previousMonth}</span>
        </button>
        <label className="field-label">
          <span>{copy.safety.reviewMonth}</span>
          <input
            type="month"
            value={review.month}
            onChange={(event) => navigateToMonth(event.target.value)}
          />
        </label>
        <button
          aria-label={copy.safety.nextMonth}
          className="quiet-button"
          type="button"
          onClick={() => navigateMonth(review.month, 1)}
        >
          → <span className="visually-hidden">{copy.safety.nextMonth}</span>
        </button>
      </div>
      <p className="batch-safety-gate">{copy.safety.gate}</p>
      <p>{copy.safety.dispositionNote}</p>
      {currentStatus.missedBusinessDates.length > 0 ? (
        <p className="batch-safety-missed-banner" role="alert">
          {copy.safety.missedRuns(
            currentStatus.missedBusinessDates.length,
            currentStatus.lastCompletedBusinessDate,
          )}
        </p>
      ) : null}
      {currentStatus.jobRuntime === "unavailable" ? (
        <p className="denial-alert" role="alert">
          {copy.safety.jobUnavailable}
        </p>
      ) : null}
      {error === null ? null : (
        <p className="denial-alert" role="alert">
          {error}
        </p>
      )}
      {denial === null ? null : (
        <p className="denial-alert" role="alert">
          {copy.permissionDenied} {denial.requestId}
        </p>
      )}
      <div
        className="batch-safety-announcement"
        role="status"
        aria-live="polite"
      >
        {announcement}
      </div>
      <p className="batch-safety-run-summary">
        {copy.safety.runSummary(
          review.runs.completedBusinessDates.length,
          review.runs.missedBusinessDates.length,
        )}
      </p>
      {review.rows.length === 0 ? (
        <p role="status">{copy.safety.reviewEmpty}</p>
      ) : (
        <div className="batch-safety-review-table-scroll">
          <table className="batch-safety-review-table">
            <caption className="visually-hidden">{copy.safety.review}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.safety.reviewColumns.item}</th>
                <th scope="col">{copy.safety.reviewColumns.batch}</th>
                <th scope="col">{copy.safety.reviewColumns.effectiveExpiry}</th>
                <th aria-sort="ascending" scope="col">
                  {copy.safety.reviewColumns.status}
                </th>
                <th scope="col">{copy.safety.reviewColumns.detected}</th>
                <th scope="col">{copy.safety.reviewColumns.blockedDays}</th>
                <th scope="col">{copy.safety.reviewColumns.carryingAmount}</th>
              </tr>
            </thead>
            <tbody>
              {review.rows.map((row) => (
                <tr key={row.batch.batchId}>
                  <td>{row.productDisplayName}</td>
                  <td>
                    <bdi>{row.batch.lotNumber ?? row.batch.batchId}</bdi>
                  </td>
                  <td>
                    <bdi>{row.batch.effectiveExpiryDate ?? "—"}</bdi>
                  </td>
                  <td>
                    <StateIndicator
                      assistiveLabel={copy.safety.statusSentence(
                        row.batch.status,
                        row.batch.daysToExpiry,
                      )}
                      kind="eligibility"
                      label={copy.safety.statusLabels[row.batch.status]}
                      status={row.batch.status}
                    />
                  </td>
                  <td>
                    <bdi>{row.detectedOnBusinessDate}</bdi>
                  </td>
                  <td>
                    <bdi>{formatNumber(BigInt(row.daysBlocked), locale)}</bdi>
                  </td>
                  <td>
                    {row.carryingAmountFils === null ? (
                      "—"
                    ) : (
                      <bdi>
                        {formatCurrencyFromFils(
                          BigInt(row.carryingAmountFils),
                          locale,
                        )}
                      </bdi>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function navigateToMonth(month: string): void {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)) return;
  window.location.hash = "#/inventory/safety-review/" + month;
}

function navigateMonth(month: string, offset: number): void {
  const yearValue = Number(month.slice(0, 4));
  const monthValue = Number(month.slice(5, 7));
  const total = yearValue * 12 + monthValue - 1 + offset;
  const year = Math.floor(total / 12);
  const nextMonth = (((total % 12) + 12) % 12) + 1;
  navigateToMonth(
    String(year).padStart(4, "0") + "-" + String(nextMonth).padStart(2, "0"),
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
