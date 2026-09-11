import type {
  IdentityDenial,
  InventoryAllocationPreview,
  InventoryBatch,
  InventoryDenial,
  LicensingDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCommittedFocus } from "./committed-focus";

import {
  changeBatchStatus,
  correctBatchExpiry,
  InventoryApiDenied,
  listBatches,
  previewAllocation,
} from "./inventory-api";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { identityMessages } from "./identity-messages";
import { useIdentityState } from "./identity-state-provider";
import { inventoryMessages } from "./inventory-messages";
import { usePreferences } from "./preferences-provider";
import { formatNumber } from "./preferences";
import { licensingMessages } from "./licensing-messages";
import { StateIndicator } from "./state-indicator";
import { StepUpDialog, useStepUp } from "./step-up";

type SafetyDenial = IdentityDenial | InventoryDenial | LicensingDenial;
type ActionKind = "correction" | "quarantine" | "recall";
type ActionDialog = {
  readonly batch: InventoryBatch;
  readonly kind: ActionKind;
  readonly originId: string;
};

export function BatchSafetyPanel({
  baseUrl,
  checkNow,
  productId,
}: {
  readonly baseUrl: string;
  readonly checkNow: () => Promise<void>;
  readonly productId: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale];
  const { state: identity } = useIdentityState();
  const [batches, setBatches] = useState<InventoryBatch[] | null>(null);
  const [businessDate, setBusinessDate] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [preview, setPreview] = useState<InventoryAllocationPreview | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [denial, setDenial] = useState<SafetyDenial | null>(null);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpDenial, setStepUpDenial] = useState<
    IdentityDenial | LicensingDenial | null
  >(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const requestCommittedFocus = useCommittedFocus();

  const canManage =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.batch_safety.manage");

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setDenial(null);
    try {
      const result = await listBatches(baseUrl, productId);
      setBatches(result.batches);
      setBusinessDate(result.businessDate);
    } catch (caught) {
      if (caught instanceof InventoryApiDenied || caught instanceof Error) {
        if (caught instanceof InventoryApiDenied) {
          setDenial(caught.denial);
        } else {
          setError(copy.safety.unavailable);
        }
      } else {
        setError(copy.safety.unavailable);
      }
    }
  }, [baseUrl, copy.safety.unavailable, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const batchById = useMemo(
    () => new Map((batches ?? []).map((batch) => [batch.batchId, batch])),
    [batches],
  );

  function updateBatch(next: InventoryBatch): void {
    setBatches((current) =>
      current === null
        ? current
        : current.map((batch) =>
            batch.batchId === next.batchId ? next : batch,
          ),
    );
  }

  function openAction(
    kind: ActionKind,
    batch: InventoryBatch,
    originId: string,
  ): void {
    setError(null);
    setDenial(null);
    setDialog({ batch, kind, originId });
  }

  function closeAction(): void {
    const originId = dialog?.originId;
    const batchId = dialog?.batch.batchId;
    setDialog(null);
    if (originId === undefined || batchId === undefined) return;
    // The target resolves at commit time: a committed recall or quarantine
    // removes its own button, so focus falls back to the row's correction
    // control, which always stays.
    requestCommittedFocus(
      () =>
        document.getElementById(originId) ??
        document.getElementById("batch-" + batchId + "-correction"),
    );
  }

  async function submitStatusChange(
    kind: "recall" | "quarantine",
    reason: string,
    evidence: string,
  ): Promise<void> {
    if (dialog === null) return;
    setBusy(true);
    setError(null);
    setDenial(null);
    try {
      const updated = await changeBatchStatus(baseUrl, dialog.batch.batchId, {
        evidence,
        idempotencyKey: crypto.randomUUID(),
        kind,
        reason,
      });
      updateBatch(updated);
      setAnnouncement(
        kind === "recall"
          ? copy.safety.recall +
              " — " +
              copy.safety.statusLabels[updated.status]
          : copy.safety.quarantine +
              " — " +
              copy.safety.statusLabels[updated.status],
      );
      closeAction();
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const runStepUp = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await work();
      } catch (caught) {
        handleFailure(caught);
        return undefined;
      }
    },
    [copy.safety.unavailable],
  );
  const stepUp = useStepUp(baseUrl, runStepUp);

  useEffect(() => {
    if (stepUp.pendingFocusId === null) return;
    const focusId = stepUp.pendingFocusId;
    requestCommittedFocus(() => document.getElementById(focusId));
    stepUp.setPendingFocusId(null);
  }, [requestCommittedFocus, stepUp]);

  async function submitCorrection(
    correctedExpiryDate: string,
    reason: string,
    evidence: string,
  ): Promise<void> {
    if (dialog === null) return;
    const currentDialog = dialog;
    setBusy(true);
    setError(null);
    setDenial(null);
    document.getElementById(currentDialog.originId)?.focus();
    await stepUp.begin(
      "inventory.batch_expiry.correct",
      currentDialog.batch.batchId,
      async (challengeId) => {
        try {
          const updated = await correctBatchExpiry(
            baseUrl,
            currentDialog.batch.batchId,
            {
              challengeId,
              correctedExpiryDate,
              evidence,
              idempotencyKey: crypto.randomUUID(),
              reason,
            },
          );
          updateBatch(updated);
          setAnnouncement(copy.safety.correctionSaved);
        } catch (caught) {
          handleFailure(caught);
        }
      },
    );
    setDialog(null);
    setBusy(false);
  }

  function handleFailure(caught: unknown): void {
    if (caught instanceof InventoryApiDenied) {
      setDenial(caught.denial);
      return;
    }
    if (
      caught instanceof IdentityApiDenied ||
      caught instanceof LicensingApiDenied
    ) {
      setStepUpDenial(caught.denial);
      return;
    }
    if (caught instanceof Error) {
      setError(copy.safety.unavailable);
      return;
    }
    setError(copy.safety.unavailable);
  }

  async function runPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[1-9]\d*$/u.test(quantity.trim())) {
      setPreviewError(copy.safety.noPreview);
      setPreview(null);
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const result = await previewAllocation(baseUrl, {
        lines: [{ productId, quantity: quantity.trim() }],
      });
      setPreview(result);
      setAnnouncement(copy.safety.previewResult);
    } catch (caught) {
      if (caught instanceof InventoryApiDenied) {
        setPreviewError(copy.safety.unavailable);
        setDenial(caught.denial);
      } else {
        setPreviewError(copy.safety.unavailable);
      }
    } finally {
      setPreviewBusy(false);
    }
  }

  if (batches === null) {
    return (
      <section
        className="batch-safety-panel"
        aria-labelledby="batch-safety-title"
      >
        <h3 id="batch-safety-title">{copy.safety.safetyStatus}</h3>
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

  return (
    <section
      className="batch-safety-panel"
      aria-labelledby="batch-safety-title"
    >
      <header className="batch-safety-heading">
        <div>
          <h3 id="batch-safety-title">{copy.safety.safetyStatus}</h3>
          <p>{businessDate === null ? "" : <bdi>{businessDate}</bdi>}</p>
        </div>
        <a href="#/inventory/safety-review">{copy.safety.review}</a>
      </header>
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
      {batches.length === 0 ? (
        <p role="status">{copy.safety.noBatches}</p>
      ) : (
        <div className="batch-safety-table-scroll">
          <table className="batch-safety-table">
            <caption className="visually-hidden">
              {copy.safety.tableCaption}
            </caption>
            <thead>
              <tr>
                <th scope="col">{copy.safety.lot}</th>
                <th scope="col">{copy.safety.originalExpiry}</th>
                <th aria-sort="ascending" scope="col">
                  {copy.safety.reviewColumns.effectiveExpiry}
                </th>
                <th scope="col">{copy.safety.status}</th>
                <th scope="col">{copy.columns.balance}</th>
                <th scope="col">{copy.safety.blockedSince}</th>
                <th scope="col">{copy.safety.events}</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <BatchRow
                  batch={batch}
                  canManage={canManage}
                  copy={copy}
                  key={batch.batchId}
                  locale={locale}
                  onAction={openAction}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="batch-safety-preview" aria-labelledby="fefo-title">
        <div>
          <h3 id="fefo-title">{copy.safety.fefo}</h3>
          <p>{copy.safety.fefoDescription}</p>
        </div>
        <form className="batch-safety-preview-form" onSubmit={runPreview}>
          <label className="field-label" htmlFor="batch-preview-quantity">
            <span>{copy.safety.quantity}</span>
            <input
              id="batch-preview-quantity"
              inputMode="numeric"
              min="1"
              required
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            disabled={previewBusy}
            type="submit"
          >
            {copy.safety.previewPick}
          </button>
        </form>
        {previewError === null ? null : (
          <p className="form-error" role="alert">
            {previewError}
          </p>
        )}
        <div
          className="batch-safety-announcement"
          role="status"
          aria-live="polite"
        >
          {announcement}
        </div>
        {preview === null ? (
          <p>{copy.safety.noPreview}</p>
        ) : (
          <PreviewResult
            batches={batchById}
            copy={copy}
            locale={locale}
            preview={preview}
          />
        )}
      </section>
      {dialog === null ? null : (
        <BatchActionDialog
          batch={dialog.batch}
          busy={busy}
          copy={copy}
          kind={dialog.kind}
          onCancel={closeAction}
          onCorrection={submitCorrection}
          onStatusChange={submitStatusChange}
        />
      )}
      {stepUp.pending === null ? null : (
        <StepUpDialog
          busy={false}
          copy={identityMessages[locale]}
          denial={stepUpDenial}
          licensingCopy={licensingMessages[locale]}
          onCancel={stepUp.cancel}
          onDismissDenial={() => setStepUpDenial(null)}
          onSubmit={stepUp.approve}
        />
      )}
    </section>
  );
}

function BatchRow({
  batch,
  canManage,
  copy,
  locale,
  onAction,
}: {
  readonly batch: InventoryBatch;
  readonly canManage: boolean;
  readonly copy: typeof inventoryMessages.en;
  readonly locale: "ar" | "en";
  readonly onAction: (
    kind: ActionKind,
    batch: InventoryBatch,
    originId: string,
  ) => void;
}): React.JSX.Element {
  const origin = (kind: ActionKind): string =>
    "batch-" + batch.batchId + "-" + kind;
  const assistive = copy.safety.statusSentence(
    batch.status,
    batch.daysToExpiry,
  );
  return (
    <tr>
      <td>
        <bdi>{batch.lotNumber ?? "—"}</bdi>
      </td>
      <td>
        <bdi>{batch.originalExpiryDate ?? "—"}</bdi>
      </td>
      <td>
        <bdi>{batch.effectiveExpiryDate ?? "—"}</bdi>
        {batch.expiryCorrected ? (
          <span className="batch-safety-corrected">
            {" "}
            ({copy.safety.corrected})
          </span>
        ) : null}
      </td>
      <td>
        <StateIndicator
          assistiveLabel={assistive}
          kind="eligibility"
          label={copy.safety.statusLabels[batch.status]}
          status={batch.status}
        />
      </td>
      <td>
        <bdi>{formatNumber(BigInt(batch.balance), locale)}</bdi>
      </td>
      <td>
        <bdi>{batch.blockedSinceBusinessDate ?? "—"}</bdi>
      </td>
      {canManage ? (
        <td className="batch-safety-actions">
          <div>
            {batch.status !== "recalled" ? (
              <button
                className="quiet-button"
                id={origin("recall")}
                type="button"
                onClick={() => onAction("recall", batch, origin("recall"))}
              >
                {copy.safety.recall}
              </button>
            ) : null}
            {batch.status !== "recalled" && batch.status !== "quarantined" ? (
              <button
                className="quiet-button"
                id={origin("quarantine")}
                type="button"
                onClick={() =>
                  onAction("quarantine", batch, origin("quarantine"))
                }
              >
                {copy.safety.quarantine}
              </button>
            ) : null}
            <button
              className="quiet-button"
              id={origin("correction")}
              type="button"
              onClick={() =>
                onAction("correction", batch, origin("correction"))
              }
            >
              {copy.safety.correction}
            </button>
          </div>
          <details className="batch-safety-history">
            <summary>{copy.safety.history}</summary>
            <History batch={batch} copy={copy} />
          </details>
        </td>
      ) : null}
      {!canManage ? (
        <td>
          <details className="batch-safety-history">
            <summary>{copy.safety.history}</summary>
            <History batch={batch} copy={copy} />
          </details>
        </td>
      ) : null}
    </tr>
  );
}

function History({
  batch,
  copy,
}: {
  readonly batch: InventoryBatch;
  readonly copy: typeof inventoryMessages.en;
}): React.JSX.Element {
  if (batch.statusEvents.length === 0 && batch.expiryAmendments.length === 0) {
    return <p>{copy.safety.emptyHistory}</p>;
  }
  return (
    <div className="batch-safety-history-content">
      <p>
        {copy.safety.originalExpiry}:{" "}
        <bdi>{batch.originalExpiryDate ?? "—"}</bdi>
      </p>
      {batch.statusEvents.map((event) => (
        <p key={event.id}>
          <StateIndicator
            assistiveLabel={copy.safety.statusSentence(
              event.kind === "expired" ? "expired" : event.kind,
              null,
            )}
            kind="eligibility"
            label={copy.safety.eventKinds[event.kind]}
            status={event.kind === "expired" ? "expired" : event.kind}
          />{" "}
          <bdi>{event.businessDate}</bdi>
          {event.reason === null ? null : " — " + event.reason}
        </p>
      ))}
      {batch.expiryAmendments.map((amendment) => (
        <p key={amendment.id}>
          {copy.safety.correction}:{" "}
          <bdi>{amendment.originalExpiryDate ?? "—"}</bdi>
          {" → "}
          <bdi>{amendment.correctedExpiryDate}</bdi>
          {" — "}
          {amendment.reason}
        </p>
      ))}
    </div>
  );
}

function PreviewResult({
  batches,
  copy,
  locale,
  preview,
}: {
  readonly batches: ReadonlyMap<string, InventoryBatch>;
  readonly copy: typeof inventoryMessages.en;
  readonly locale: "ar" | "en";
  readonly preview: InventoryAllocationPreview;
}): React.JSX.Element {
  return (
    <div
      aria-labelledby="batch-preview-result-title"
      className="batch-safety-preview-result"
      role="region"
      tabIndex={0}
    >
      <h4 id="batch-preview-result-title">{copy.safety.previewResult}</h4>
      {preview.allocations.length === 0 ? null : (
        <ul>
          {preview.allocations.map((allocation) => (
            <li key={allocation.batchId}>
              <StateIndicator
                assistiveLabel={copy.safety.statusSentence(
                  allocation.status,
                  batches.get(allocation.batchId)?.daysToExpiry ?? null,
                )}
                kind="eligibility"
                label={copy.safety.statusLabels[allocation.status]}
                status={allocation.status}
              />{" "}
              <bdi>{formatNumber(BigInt(allocation.quantity), locale)}</bdi>
              {" — "}
              <bdi>{allocation.effectiveExpiryDate ?? "—"}</bdi>
              {allocation.status === "near-expiry" ? (
                <span className="batch-safety-warning">
                  {copy.safety.warning}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {preview.blocked.length === 0 ? null : (
        <div>
          <h5>{copy.safety.previewBlocked}</h5>
          <ul>
            {preview.blocked.map((blocked) => (
              <li key={blocked.batchId}>
                <StateIndicator
                  assistiveLabel={copy.safety.statusSentence(
                    blocked.status,
                    batches.get(blocked.batchId)?.daysToExpiry ?? null,
                  )}
                  kind="eligibility"
                  label={copy.safety.statusLabels[blocked.status]}
                  status={blocked.status}
                />{" "}
                <bdi>
                  {batches.get(blocked.batchId)?.lotNumber ?? blocked.batchId}
                </bdi>
                {" · "}
                <bdi>{formatNumber(BigInt(blocked.balance), locale)}</bdi>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.shortfalls.map((shortfall) => (
        <p key={shortfall.productId} role="alert">
          {copy.safety.quantity}: <bdi>{shortfall.requested}</bdi> —{" "}
          <bdi>{shortfall.allocatable}</bdi>
        </p>
      ))}
    </div>
  );
}

function BatchActionDialog({
  batch,
  busy,
  copy,
  kind,
  onCancel,
  onCorrection,
  onStatusChange,
}: {
  readonly batch: InventoryBatch;
  readonly busy: boolean;
  readonly copy: typeof inventoryMessages.en;
  readonly kind: ActionKind;
  readonly onCancel: () => void;
  readonly onCorrection: (
    correctedExpiryDate: string,
    reason: string,
    evidence: string,
  ) => Promise<void>;
  readonly onStatusChange: (
    kind: "recall" | "quarantine",
    reason: string,
    evidence: string,
  ) => Promise<void>;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [correctedExpiryDate, setCorrectedExpiryDate] = useState(
    batch.effectiveExpiryDate ?? "",
  );
  const title =
    kind === "recall"
      ? copy.safety.recall
      : kind === "quarantine"
        ? copy.safety.quarantine
        : copy.safety.correction;
  const description =
    kind === "recall"
      ? copy.safety.recallDescription
      : kind === "quarantine"
        ? copy.safety.quarantineDescription
        : copy.safety.correctionDescription;

  return (
    <div
      aria-labelledby="batch-action-title"
      aria-modal="true"
      className="dialog-backdrop"
      ref={dialog}
      role="dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable === undefined || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <section className="identity-card batch-safety-dialog">
        <h2 id="batch-action-title">{title}</h2>
        <p>{description}</p>
        {kind === "correction" ? (
          <>
            <p>
              {copy.safety.originalExpiry}:{" "}
              <bdi>{batch.effectiveExpiryDate ?? "—"}</bdi>
            </p>
            <p className="batch-safety-step-up-note">
              {copy.safety.correctionStepUp}
            </p>
          </>
        ) : null}
        <form
          className="batch-safety-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const reason = String(data.get("reason") ?? "").trim();
            const evidence = String(data.get("evidence") ?? "").trim();
            if (kind === "correction") {
              void onCorrection(correctedExpiryDate, reason, evidence);
            } else {
              void onStatusChange(kind, reason, evidence);
            }
          }}
        >
          {kind === "correction" ? (
            <label className="field-label">
              <span>{copy.safety.reviewColumns.effectiveExpiry}</span>
              <input
                autoFocus
                name="correctedExpiryDate"
                required
                type="date"
                value={correctedExpiryDate}
                onChange={(event) => setCorrectedExpiryDate(event.target.value)}
              />
            </label>
          ) : null}
          <label className="field-label">
            <span>{copy.safety.reason}</span>
            <textarea
              autoFocus={kind !== "correction"}
              name="reason"
              required
            />
          </label>
          <label className="field-label" htmlFor="batch-action-evidence">
            <span>{copy.safety.evidence}</span>
          </label>
          <p className="field-hint" id="batch-action-evidence-hint">
            {copy.safety.evidenceHint}
          </p>
          <textarea
            aria-describedby="batch-action-evidence-hint"
            id="batch-action-evidence"
            name="evidence"
            required
          />
          <div className="form-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {copy.safety.submit}
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              type="button"
              onClick={onCancel}
            >
              {copy.safety.backToInventory}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
