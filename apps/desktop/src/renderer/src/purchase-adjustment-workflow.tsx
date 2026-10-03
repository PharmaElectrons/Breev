/*!
 * FilePen SVG paths from lucide-react 0.575.0, matching the prototype icon.
 * ISC License
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2026 as
 * part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2026.
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * The MIT License (MIT) (for portions derived from Feather)
 * Copyright (c) 2013-2026 Cole Bemis
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  PURCHASE_ADJUSTMENT_REASONS,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentReason,
  type PurchaseAdjustmentPostRequest,
  type PurchaseAdjustmentSummary,
  type PurchasePostedDetail,
  type Supplier,
} from "@breev/contracts/local-rest";
import {
  PurchasingApiDenied,
  createPurchaseAdjustmentDraft,
  discardPurchaseAdjustmentDraft,
  newPurchasingIdempotencyKey,
  postPurchaseAdjustment,
  requestPurchaseAdjustmentDraft,
  requestPurchaseAdjustmentSummary,
  requestSuppliers,
  updatePurchaseAdjustmentDraft,
} from "./purchasing-api";
import { useCommittedFocus } from "./committed-focus";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { usePreferences } from "./preferences-provider";
import { formatFilsToIqd } from "./product-record";
import { PurchaseAdjustmentHeaderComparisonTable } from "./purchase-adjustment-header-comparison";
import { formatAdjustmentFils } from "./purchase-adjustment-money";
import { PurchasingSupportDetails } from "./purchasing-support-details";
import { PurchaseInvoiceOfferFields } from "./purchase-invoice-offer-fields";
import {
  getAdjustmentReasonLabel,
  getPurchasingDenialMessage,
  purchasingMessages,
  purchaseAdjustmentMessages,
} from "./purchasing-messages";

type Stage = "start" | "unfinished" | "edit" | "summary" | "posted";

export function PurchaseAdjustmentWorkflow({
  baseUrl,
  detail,
  leaveRequest,
  onBack,
  onDraftActive,
  onPosted,
  navigation,
  onNavigate,
  onSearch,
  onReturn,
  onNewInvoice,
}: {
  readonly baseUrl: string;
  readonly detail: PurchasePostedDetail;
  readonly leaveRequest: number;
  readonly onBack: () => void;
  readonly onDraftActive: (active: boolean) => void;
  readonly onPosted: (purchaseId: string) => Promise<void>;
  readonly navigation: PurchasePostedDetail["navigation"];
  readonly onNavigate: (direction: "previous" | "next") => void;
  readonly onSearch: () => void;
  readonly onReturn: () => void;
  readonly onNewInvoice?: (() => void) | undefined;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchaseAdjustmentMessages[locale];
  const [stage, setStage] = useState<Stage>(
    detail.activeAdjustmentDrafts.length > 0 ? "unfinished" : "start",
  );
  const [draft, setDraft] = useState<PurchaseAdjustmentDraft | null>(null);
  const [summary, setSummary] = useState<PurchaseAdjustmentSummary | null>(
    null,
  );
  const [reason, setReason] =
    useState<PurchaseAdjustmentReason>("quantity error");
  const [evidence, setEvidence] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    readonly message: string;
    readonly tracking?: string | undefined;
  } | null>(null);
  const [leaveWarning, setLeaveWarning] = useState(false);
  const [deleteOnly, setDeleteOnly] = useState(false);
  const [savedDraft, setSavedDraft] = useState<PurchaseAdjustmentDraft | null>(
    null,
  );
  const pendingLeave = useRef<() => void>(onBack);
  const leaveOpener = useRef<HTMLElement | null>(null);
  const warningRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const [postedNumber, setPostedNumber] = useState("");
  const [previewCurrent, setPreviewCurrent] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [postUncertain, setPostUncertain] = useState(false);
  const postAttempt = useRef<PurchaseAdjustmentPostRequest | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const requestFocus = useCommittedFocus();

  const originalNumberDisplay =
    detail.supplierInvoiceNumber || formatOriginalInvoiceNumber(detail);
  const nextSuffix = getNextAdjustmentSuffix(detail);
  const cleanOriginalNumber = originalNumberDisplay.replace(/^A\d+[- ]*/iu, "");

  useEffect(() => {
    void requestSuppliers(baseUrl)
      .then((result) => setSuppliers(result.suppliers))
      .catch(handleError);
  }, [baseUrl]);

  useEffect(() => {
    onDraftActive(detail.activeAdjustmentDrafts.length > 0);
  }, [detail.activeAdjustmentDrafts.length, onDraftActive]);

  useEffect(() => {
    if (leaveRequest > 0) leave();
  }, [leaveRequest]);

  /**
   * Refusal notification with committed focus for accessibility.
   */
  function refuse(message: string, tracking?: string): void {
    setError(tracking !== undefined ? { message, tracking } : { message });
    requestFocus(() => {
      errorRef.current?.scrollIntoView({ block: "center" });
      return errorRef.current;
    });
  }

  function handleError(caught: unknown): void {
    if (
      caught instanceof PurchasingApiDenied &&
      caught.denial.fieldErrors.some(
        (field) => field.path[0] === "invoiceOffer",
      )
    ) {
      refuse(
        purchasingMessages[locale].invoiceOfferInvalid,
        caught.denial.requestId,
      );
      return;
    }
    if (
      caught instanceof IdentityApiDenied &&
      caught.denial.code.startsWith("session-")
    ) {
      refuse(copy.sessionEnded, caught.denial.requestId);
      return;
    }
    if (
      caught instanceof IdentityApiDenied ||
      caught instanceof LicensingApiDenied
    ) {
      refuse(copy.authorityDenied, caught.denial.requestId);
      return;
    }
    if (
      caught instanceof PurchasingApiDenied &&
      (caught.denial.code === "version-conflict" ||
        caught.denial.code === "adjustment-summary-stale")
    ) {
      setPreviewCurrent(false);
      setReloadRequired(true);
    }
    if (
      caught instanceof PurchasingApiDenied &&
      caught.denial.code === "adjustment-batch-conflict"
    ) {
      refuse(copy.blocked, caught.denial.requestId);
      return;
    }
    if (caught instanceof PurchasingApiDenied) {
      refuse(
        getPurchasingDenialMessage(caught.denial.code, locale),
        caught.denial.requestId,
      );
      return;
    }
    refuse(copy.unavailableRequest);
  }

  function invalidatePreview(): void {
    setPreviewCurrent(false);
    postAttempt.current = null;
  }

  function editDraft(next: PurchaseAdjustmentDraft): void {
    invalidatePreview();
    setDraft(next);
  }

  function editEvidence(value: string): void {
    invalidatePreview();
    setEvidence(value);
  }

  async function reloadSavedDraft(): Promise<void> {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await requestPurchaseAdjustmentDraft(baseUrl, draft.id);
      setDraft(loaded);
      setSavedDraft(loaded);
      setReason(loaded.reason);
      setEvidence(loaded.evidence ?? "");
      setSummary(null);
      invalidatePreview();
      setReloadRequired(false);
      setStage("edit");
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(
    overrideReason?: PurchaseAdjustmentReason,
  ): Promise<PurchaseAdjustmentDraft | null> {
    if (busy) return null;
    const chosenReason = overrideReason ?? reason ?? "quantity error";
    setBusy(true);
    setError(null);
    try {
      const created = await createPurchaseAdjustmentDraft(baseUrl, detail.id, {
        evidence: evidence.trim() === "" ? null : evidence.trim(),
        idempotencyKey: newPurchasingIdempotencyKey(),
        reason: chosenReason,
      });
      setDraft(created);
      setSavedDraft(created);
      setReason(created.reason);
      setEvidence(created.evidence ?? "");
      onDraftActive(true);
      setStage("edit");
      return created;
    } catch (caught) {
      handleError(caught);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function continueDraft(): Promise<void> {
    const active = detail.activeAdjustmentDrafts[0];
    if (active === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await requestPurchaseAdjustmentDraft(baseUrl, active.id);
      setDraft(loaded);
      setSavedDraft(loaded);
      onDraftActive(true);
      setReason(loaded.reason);
      setEvidence(loaded.evidence ?? "");
      setStage("edit");
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft(): Promise<void> {
    const activeId = draft?.id ?? detail.activeAdjustmentDrafts[0]?.id;
    const version = draft?.version ?? detail.activeAdjustmentDrafts[0]?.version;
    if (activeId === undefined || version === undefined) {
      setLeaveWarning(false);
      pendingLeave.current();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await discardPurchaseAdjustmentDraft(baseUrl, activeId, {
        confirmation: "discard-purchase-adjustment-draft",
        expectedVersion: version,
        idempotencyKey: newPurchasingIdempotencyKey(),
      });
      await onPosted(detail.id);
      onDraftActive(false);
      setLeaveWarning(false);
      pendingLeave.current();
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndReview(review = true): Promise<void> {
    if (busy || postUncertain || reloadRequired) return;
    let currentDraft = draft;
    if (currentDraft === null) {
      // In stage === "start", clicking save directly creates draft first
      currentDraft = await createDraft();
      if (currentDraft === null) return;
    }
    setBusy(true);
    setError(null);
    invalidatePreview();
    try {
      const updated = await updatePurchaseAdjustmentDraft(
        baseUrl,
        currentDraft.id,
        {
          evidence: evidence.trim() === "" ? null : evidence.trim(),
          expectedVersion: currentDraft.version,
          idempotencyKey: newPurchasingIdempotencyKey(),
          reason,
          rows: currentDraft.rows.map((row) => ({
            costFils: row.costFils,
            enteredQuantity: row.enteredQuantity,
            expiryDate: row.expiryDate,
            itemId: row.itemId,
            lineageId: row.lineageId,
            lotNumber: row.lotNumber,
            notes: row.notes,
            originalRowId: row.originalRowId,
            pricing:
              row.pricingMethod === "by-price"
                ? { method: "by-price", retailPriceFils: row.retailPriceFils }
                : {
                    marginPercentage: row.marginPercentage ?? "0",
                    method: "by-percentage",
                  },
            unit: row.unit,
          })),
          supplierId: currentDraft.supplierId,
          supplierInvoiceNumber: currentDraft.supplierInvoiceNumber,
          invoiceOffer: currentDraft.invoiceOffer,
        },
      );
      setDraft(updated);
      setSavedDraft(updated);
      setReason(updated.reason);
      setEvidence(updated.evidence ?? "");
      if (!review) {
        setLeaveWarning(false);
        onDraftActive(false);
        await onPosted(detail.id);
        pendingLeave.current();
        return;
      }
      const reviewed = await requestPurchaseAdjustmentSummary(
        baseUrl,
        updated.id,
      );
      setSummary(reviewed);
      setPreviewCurrent(
        reviewed.draftId === updated.id &&
          reviewed.draftVersion === updated.version,
      );
      setStage("summary");
      requestFocus(() =>
        summaryRef.current?.querySelector<HTMLElement>(
          'button[data-adjustment-action="close-summary"]',
        ),
      );
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function post(): Promise<void> {
    if (
      busy ||
      draft === null ||
      summary === null ||
      !previewCurrent ||
      summary.draftId !== draft.id ||
      summary.draftVersion !== draft.version
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const attempt = postAttempt.current ?? {
        confirmationHash: summary.confirmationHash,
        expectedVersion: summary.draftVersion,
        idempotencyKey: newPurchasingIdempotencyKey(),
      };
      postAttempt.current = attempt;
      const result = await postPurchaseAdjustment(baseUrl, draft.id, attempt);
      postAttempt.current = null;
      setPostUncertain(false);
      setPostedNumber(formatAdjustmentNumber(result.posted.number));
      setStage("posted");
      onDraftActive(false);
      // Refresh failure cannot make an acknowledged Post uncertain.
      await onPosted(detail.id).catch(handleError);
    } catch (caught) {
      if (
        caught instanceof PurchasingApiDenied ||
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        postAttempt.current = null;
        setPostUncertain(false);
        setPreviewCurrent(false);
        handleError(caught);
      } else {
        setPostUncertain(true);
        refuse(copy.retryPost);
      }
    } finally {
      setBusy(false);
    }
  }

  function leave(destination: () => void = onBack, deleting = false): void {
    if (busy || postUncertain) return;
    if (stage === "posted") {
      destination();
      return;
    }
    pendingLeave.current = destination;
    leaveOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (
      draft !== null ||
      stage === "unfinished" ||
      reason !== "quantity error" ||
      evidence !== ""
    ) {
      setDeleteOnly(deleting);
      setLeaveWarning(true);
      requestFocus(() =>
        warningRef.current?.querySelector<HTMLElement>("button"),
      );
    } else {
      destination();
    }
  }

  function dismissWarning(): void {
    setLeaveWarning(false);
    requestFocus(() => leaveOpener.current);
  }

  function closeSummary(): void {
    setStage("edit");
    requestFocus(() => saveRef.current);
  }

  function modalKeys(event: KeyboardEvent<HTMLElement>): void {
    const modal = leaveWarning
      ? warningRef.current
      : stage === "summary"
        ? summaryRef.current
        : null;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (busy || postUncertain) return;
      if (leaveWarning) dismissWarning();
      else if (stage === "summary") closeSummary();
      else leave();
    } else if (event.key === "Tab" && modal !== null) {
      const targets = [
        ...modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
        ),
      ].filter((target) => target.getClientRects().length > 0);
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  const dirty =
    draft === null
      ? reason !== "quantity error" || evidence !== ""
      : savedDraft === null ||
        JSON.stringify(draft) !== JSON.stringify(savedDraft) ||
        reason !== savedDraft.reason ||
        (evidence.trim() || null) !== savedDraft.evidence;
  const reviewedTotals = previewCurrent
    ? summary?.totalsComparison.after
    : null;
  const displayMoney = (value: string | null | undefined) =>
    value == null
      ? draft === null
        ? copy.unavailable
        : copy.calculate
      : formatAdjustmentFils(value, locale);

  const draftSupplierName =
    suppliers.find((s) => s.id === (draft?.supplierId ?? detail.supplierId))
      ?.name ?? detail.supplierNameSnapshot;

  if (!detail.canAdjust) {
    return (
      <section className="purchase-adjustment" aria-label={copy.title}>
        <p className="form-error" role="alert">
          {copy.authorityDenied}
        </p>
        <button type="button" className="quiet-button" onClick={onBack}>
          {copy.back}
        </button>
      </section>
    );
  }

  return (
    <section
      className="purchase-adjustment"
      aria-labelledby="adjustment-title"
      onKeyDownCapture={modalKeys}
      aria-busy={busy}
    >
      {/* Accessible Title */}
      <h3 id="adjustment-title" className="visually-hidden">
        {copy.title}
      </h3>
      <p className="visually-hidden" role="status" aria-live="polite">
        {busy
          ? copy.saving
          : draft !== null
            ? dirty
              ? copy.dirty
              : copy.saved
            : ""}
      </p>

      {error === null || stage === "summary" || leaveWarning ? null : (
        <div className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
          <span>{error.message}</span>
          {error.tracking ? (
            <PurchasingSupportDetails reference={error.tracking} />
          ) : null}
        </div>
      )}
      {reloadRequired && stage !== "summary" ? (
        <button
          type="button"
          className="quiet-button"
          disabled={busy}
          onClick={() => void reloadSavedDraft()}
        >
          {copy.reloadDraft}
        </button>
      ) : null}

      {leaveWarning ? (
        <div className="delta-summary-backdrop" role="presentation">
          <div
            className="adjustment-warning"
            ref={warningRef}
            role="alertdialog"
            aria-label={deleteOnly ? copy.discardOnly : copy.discardQuestion}
            aria-modal="true"
          >
            <p>{deleteOnly ? copy.discardOnly : copy.discardQuestion}</p>
            <p>{dirty ? copy.dirty : copy.saved}</p>
            {error === null ? null : (
              <div
                className="form-error"
                role="alert"
                ref={errorRef}
                tabIndex={-1}
              >
                <span>{error.message}</span>
                {error.tracking ? (
                  <PurchasingSupportDetails reference={error.tracking} />
                ) : null}
              </div>
            )}
            <div className="adjustment-actions">
              <button
                type="button"
                className="quiet-button"
                disabled={busy}
                data-adjustment-action="continue-editing"
                onClick={dismissWarning}
              >
                {copy.continue}
              </button>
              {!deleteOnly && !dirty ? (
                <button
                  type="button"
                  className="quiet-button"
                  disabled={busy}
                  data-adjustment-action="keep-leave"
                  onClick={() => {
                    setLeaveWarning(false);
                    onDraftActive(false);
                    pendingLeave.current();
                  }}
                >
                  {copy.keepLeave}
                </button>
              ) : null}
              {!deleteOnly && stage !== "unfinished" ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || reloadRequired || postUncertain}
                  data-adjustment-action="save-leave"
                  onClick={() => void saveAndReview(false)}
                >
                  {copy.saveLeave}
                </button>
              ) : null}
              <button
                type="button"
                className="danger-button"
                disabled={busy || postUncertain}
                data-adjustment-action="discard-leave"
                onClick={() => void discardDraft()}
              >
                {copy.delete}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stage === "unfinished" ? (
        <div className="adjustment-warning" role="alert" inert={leaveWarning}>
          <p>{copy.unfinished}</p>
          <div className="adjustment-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void continueDraft()}
              disabled={busy}
            >
              {copy.continue}
            </button>
            <button
              type="button"
              className="quiet-button"
              disabled={busy}
              onClick={() => leave()}
            >
              {copy.back}
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => leave(onBack, true)}
              disabled={busy}
            >
              {copy.delete}
            </button>
          </div>
        </div>
      ) : null}

      {stage === "posted" ? (
        <div role="status" className="adjustment-posted-success-card">
          <div className="adjustment-posted-icon" aria-hidden="true">
            ✅
          </div>
          <h3 id="posted-adjustment-title" className="adjustment-posted-title">
            {copy.posted}
          </h3>
          <p className="adjustment-posted-subtitle">
            {locale === "ar"
              ? "تم ترحيل فروقات التعديل بنجاح وتحديث قيود المخزون والحسابات."
              : "Delta adjustment was posted successfully and ledger entries updated."}
          </p>
          <div className="adjustment-posted-badge">
            <span className="adjustment-posted-badge-label">
              {locale === "ar" ? "رقم حركة التعديل:" : "Adjustment Reference:"}
            </span>
            <bdi className="font-mono font-bold adjustment-posted-ref">
              {postedNumber}
            </bdi>
          </div>
          <div className="adjustment-posted-actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={onBack}
            >
              {copy.back}
            </button>
          </div>
        </div>
      ) : stage === "unfinished" ? null : (
        /* Main In-Place Adjustment View (Screenshots 3, 4, 5) */
        <div
          className="posted-purchase-review"
          inert={leaveWarning || stage === "summary"}
        >
          {/* Top Adjustment Banner */}
          <div className="adjustment-draft-banner">
            <span className="adjustment-banner-badge-orange">
              {copy.adjustmentDraftBadge} — {cleanOriginalNumber} - {nextSuffix}
            </span>

            <button
              type="button"
              className="adjustment-banner-badge-blue"
              disabled={busy || postUncertain}
              onClick={() => leave()}
              title={copy.back}
            >
              {copy.originalInvoiceBadge} {cleanOriginalNumber}
            </button>

            {stage === "start" ? (
              <>
                <div className="adjustment-banner-reason-wrap">
                  <label
                    className="visually-hidden"
                    htmlFor="start-reason-select"
                  >
                    {copy.reason}
                  </label>
                  <select
                    id="start-reason-select"
                    aria-label={copy.reason}
                    className="adjustment-banner-reason-select"
                    required
                    disabled={busy || postUncertain}
                    value={reason}
                    onChange={(event) => {
                      invalidatePreview();
                      setReason(event.target.value as PurchaseAdjustmentReason);
                    }}
                  >
                    {PURCHASE_ADJUSTMENT_REASONS.map((value) => (
                      <option key={value} value={value}>
                        {getAdjustmentReasonLabel(value, locale)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adjustment-banner-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void createDraft()}
                  >
                    <span>📝</span> {copy.start}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="adjustment-banner-reason-wrap">
                  <select
                    className="adjustment-banner-reason-select"
                    aria-label={copy.reason}
                    disabled={busy || postUncertain}
                    value={reason}
                    onChange={(event) => {
                      invalidatePreview();
                      setReason(event.target.value as PurchaseAdjustmentReason);
                    }}
                  >
                    {PURCHASE_ADJUSTMENT_REASONS.map((value) => (
                      <option key={value} value={value}>
                        {getAdjustmentReasonLabel(value, locale)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="adjustment-banner-reason-input"
                    aria-label={copy.evidence}
                    placeholder={copy.addEvidence}
                    disabled={busy || postUncertain}
                    value={evidence}
                    onChange={(event) => editEvidence(event.target.value)}
                  />
                </div>
                <div className="adjustment-banner-actions">
                  <button
                    type="button"
                    className="purchase-return-button"
                    disabled={busy || postUncertain || !detail.canReturn}
                    data-adjustment-action="return"
                    onClick={() => leave(onReturn)}
                  >
                    <span>↩️</span> {copy.returnInvoice}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Subtitle Alert */}
          <div className="adjustment-subtitle-alert">
            <span>
              «{copy.adjustmentSubtitleAlert} {nextSuffix} {cleanOriginalNumber}{" "}
              —{" "}
              {locale === "ar"
                ? "الفاتورة الأصلية محفوظة كما هي، وسيُرحّل الفرق فقط."
                : "The original invoice is preserved as-is, and only the delta will be posted."}
              »
            </span>
          </div>

          {/* Invoice Header Metadata Row (Screenshot 3) */}
          <div className="adjustment-metadata-row">
            <div className="adjustment-metadata-field">
              <span className="adjustment-metadata-label">{copy.date}:</span>
              <bdi className="adjustment-metadata-value">
                {draft?.invoiceDate ?? detail.invoiceDate}
              </bdi>
            </div>
            <div className="adjustment-metadata-field">
              <span className="adjustment-metadata-label">{copy.invoice}:</span>
              {draft === null ? (
                <bdi className="adjustment-metadata-value font-mono">
                  {detail.supplierInvoiceNumber}
                </bdi>
              ) : (
                <input
                  className="adjustment-header-input"
                  aria-label={copy.invoice}
                  value={draft.supplierInvoiceNumber}
                  maxLength={120}
                  disabled={busy || postUncertain}
                  onChange={(event) =>
                    editDraft({
                      ...draft,
                      supplierInvoiceNumber: event.target.value,
                    })
                  }
                />
              )}
            </div>
            <div className="adjustment-metadata-field">
              <span className="adjustment-metadata-label">
                {copy.supplier}:
              </span>
              {draft === null ? (
                <strong className="adjustment-metadata-value">
                  {draftSupplierName}
                </strong>
              ) : (
                <select
                  className="adjustment-header-input"
                  aria-label={copy.supplier}
                  value={draft.supplierId}
                  disabled={busy || postUncertain}
                  onChange={(event) =>
                    editDraft({
                      ...draft,
                      supplierId: event.target.value,
                      supplierNameSnapshot:
                        suppliers.find(
                          (supplier) => supplier.id === event.target.value,
                        )?.name ?? draft.supplierNameSnapshot,
                    })
                  }
                >
                  {suppliers.some(
                    (supplier) => supplier.id === draft.supplierId,
                  ) ? null : (
                    <option value={draft.supplierId}>
                      {draft.supplierNameSnapshot}
                    </option>
                  )}
                  {suppliers
                    .filter((supplier) => supplier.status === "active")
                    .map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.id === draft.supplierId
                          ? draft.supplierNameSnapshot
                          : supplier.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
            <div className="adjustment-metadata-search">
              <p id="adjustment-protected-fields">{copy.protectedFields}</p>
            </div>
          </div>

          {/* Full 12-Column Table (Screenshots 2 & 3) */}
          <div
            className="posted-purchase-table-wrap purchase-table-wrap"
            role="group"
            aria-label={copy.title}
            tabIndex={0}
          >
            <table className="posted-purchase-table">
              <thead>
                <tr>
                  <th scope="col" style={{ inlineSize: "2.5rem" }}>
                    #
                  </th>
                  <th scope="col">{copy.item}</th>
                  <th scope="col">{copy.quantity}</th>
                  <th scope="col">{copy.returned}</th>
                  <th scope="col">{copy.unit}</th>
                  <th scope="col">{copy.cost}</th>
                  <th scope="col">{copy.expiry}</th>
                  <th scope="col">{copy.margin}</th>
                  <th scope="col">{copy.retail}</th>
                  <th scope="col">{copy.special}</th>
                  <th scope="col">{copy.total}</th>
                  <th scope="col">
                    <span className="visually-hidden">{copy.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft
                  ? draft.rows.map((row, index) => {
                      const lineTotalFils = previewCurrent
                        ? summary?.rowTotals.find(
                            (total) => total.lineageId === row.lineageId,
                          )?.primarySupplierCostFils
                        : null;
                      const unitName =
                        row.unit.kind === "package-unit"
                          ? row.unit.packageUnitName
                          : row.inventoryUnitName;
                      return (
                        <tr key={row.lineageId}>
                          <td style={{ color: "var(--muted-foreground)" }}>
                            {String(index + 1).padStart(2, "0")}
                          </td>
                          <th scope="row">
                            <span className="purchase-item-name-pill">
                              {row.itemDisplayName}
                            </span>
                          </th>
                          <td>
                            <input
                              aria-label={`${copy.quantity} ${row.itemDisplayName}`}
                              disabled={busy || postUncertain}
                              inputMode="numeric"
                              value={row.enteredQuantity}
                              onChange={(event) =>
                                editDraft({
                                  ...draft,
                                  rows: draft.rows.map((candidate) =>
                                    candidate.lineageId === row.lineageId
                                      ? {
                                          ...candidate,
                                          enteredQuantity: event.target.value,
                                        }
                                      : candidate,
                                  ),
                                })
                              }
                            />
                          </td>
                          <td>{copy.unavailable}</td>
                          <td>
                            <bdi>{unitName}</bdi>
                          </td>
                          <td>
                            <input
                              aria-label={`${copy.cost} ${row.itemDisplayName}`}
                              disabled={busy || postUncertain}
                              inputMode="numeric"
                              value={row.costFils}
                              onChange={(event) =>
                                editDraft({
                                  ...draft,
                                  rows: draft.rows.map((candidate) =>
                                    candidate.lineageId === row.lineageId
                                      ? {
                                          ...candidate,
                                          costFils: event.target.value,
                                        }
                                      : candidate,
                                  ),
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="YYYY-MM-DD"
                              aria-label={`${copy.expiry} ${row.itemDisplayName}`}
                              aria-describedby="adjustment-protected-fields"
                              readOnly
                              value={row.expiryDate ?? ""}
                            />
                            {row.lotNumber === null ? null : (
                              <small>
                                {copy.lot}: <bdi>{row.lotNumber}</bdi>
                              </small>
                            )}
                          </td>
                          <td>
                            <bdi>
                              {row.marginPercentage
                                ? `${row.marginPercentage}%`
                                : copy.unavailable}
                            </bdi>
                          </td>
                          <td>
                            <input
                              aria-label={`${copy.retail} ${row.itemDisplayName}`}
                              disabled={busy || postUncertain}
                              readOnly={row.pricingMethod === "by-percentage"}
                              inputMode="numeric"
                              value={row.retailPriceFils}
                              onChange={(event) =>
                                editDraft({
                                  ...draft,
                                  rows: draft.rows.map((candidate) =>
                                    candidate.lineageId === row.lineageId
                                      ? {
                                          ...candidate,
                                          retailPriceFils: event.target.value,
                                        }
                                      : candidate,
                                  ),
                                })
                              }
                            />
                          </td>
                          <td>{copy.unavailable}</td>
                          <td>
                            <bdi className="font-mono">
                              {displayMoney(lineTotalFils)}
                            </bdi>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="quiet-button"
                              aria-label={`${copy.remove} ${row.itemDisplayName}`}
                              data-adjustment-action="remove-row"
                              disabled={busy || postUncertain}
                              onClick={() => {
                                editDraft({
                                  ...draft,
                                  rows: draft.rows.filter(
                                    (candidate) =>
                                      candidate.lineageId !== row.lineageId,
                                  ),
                                });
                                requestFocus(() => saveRef.current);
                              }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  : detail.rows.map((row, index) => {
                      const unitName =
                        row.unit.kind === "package-unit"
                          ? row.unit.packageUnitName
                          : row.inventoryUnitName;
                      return (
                        <tr key={row.id}>
                          <td style={{ color: "var(--muted-foreground)" }}>
                            {String(index + 1).padStart(2, "0")}
                          </td>
                          <th scope="row">
                            <span className="purchase-item-name-pill">
                              {row.itemDisplayName}
                            </span>
                          </th>
                          <td>
                            <input
                              aria-label={`${copy.quantity} ${row.itemDisplayName}`}
                              inputMode="numeric"
                              value={row.enteredQuantity}
                              readOnly
                            />
                          </td>
                          <td>{copy.unavailable}</td>
                          <td>
                            <bdi>{unitName}</bdi>
                          </td>
                          <td>
                            <input
                              aria-label={`${copy.cost} ${row.itemDisplayName}`}
                              inputMode="numeric"
                              value={
                                row.primarySupplierCostFils ?? copy.unavailable
                              }
                              readOnly
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="YYYY-MM-DD"
                              value={row.expiryDate ?? ""}
                              aria-label={`${copy.expiry} ${row.itemDisplayName}`}
                              aria-describedby="adjustment-protected-fields"
                              readOnly
                            />
                            {row.lotNumber === null ? null : (
                              <small>
                                {copy.lot}: <bdi>{row.lotNumber}</bdi>
                              </small>
                            )}
                          </td>
                          <td>{copy.unavailable}</td>
                          <td>
                            <input
                              aria-label={`${copy.retail} ${row.itemDisplayName}`}
                              inputMode="numeric"
                              value={row.retailPriceFils}
                              readOnly
                            />
                          </td>
                          <td>{copy.unavailable}</td>
                          <td>
                            <bdi className="font-mono">
                              {displayMoney(row.linePrimarySupplierCostFils)}
                            </bdi>
                          </td>
                          <td />
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>

          {/* Totals Section (Screenshot 3) */}
          <div className="adjustment-totals-bar">
            <div className="adjustment-totals-group">
              <div className="adjustment-totals-item">
                <span className="adjustment-metadata-label">
                  {copy.totalCost}:
                </span>
                <strong>
                  <bdi className="font-mono">
                    {displayMoney(
                      draft === null
                        ? detail.primarySupplierCostFils
                        : reviewedTotals?.primarySupplierCostFils,
                    )}
                  </bdi>
                </strong>
              </div>
              <div className="adjustment-totals-item">
                <span className="adjustment-metadata-label">
                  {purchasingMessages[locale].invoiceOffer}:
                </span>
                <bdi className="font-mono">
                  {displayMoney(
                    draft === null
                      ? detail.invoiceOffer?.offerFils
                      : reviewedTotals?.offerFils,
                  )}
                </bdi>
              </div>
              <div className="adjustment-totals-item">
                <span className="adjustment-metadata-label">
                  {copy.discountPercentage}:
                </span>
                <bdi className="font-mono">
                  {draft?.allowancePercentageSnapshot ??
                    detail.allowancePercentageSnapshot ??
                    copy.unavailable}
                </bdi>
              </div>
              <div className="adjustment-totals-item">
                <span className="adjustment-metadata-label">
                  {copy.discountAmount}:
                </span>
                <bdi className="font-mono">
                  {displayMoney(
                    draft === null
                      ? detail.allowanceFils
                      : reviewedTotals?.allowanceFils,
                  )}
                </bdi>
              </div>
            </div>

            <div className="adjustment-totals-group">
              {draft === null ? null : (
                <div className="purchase-invoice-offer adjustment-offer-inputs">
                  <PurchaseInvoiceOfferFields
                    key={`${draft.id}:${draft.version}`}
                    value={draft.invoiceOffer}
                    onChange={(invoiceOffer) =>
                      editDraft({ ...draft, invoiceOffer })
                    }
                    disabled={busy || postUncertain}
                  />
                </div>
              )}
              <div className="adjustment-totals-item">
                <span className="adjustment-metadata-label">
                  {copy.afterDiscount}:
                </span>
                <strong>
                  <bdi className="font-mono">
                    {displayMoney(
                      draft === null
                        ? detail.costAfterDiscountFils
                        : reviewedTotals?.costAfterDiscountFils,
                    )}
                  </bdi>
                </strong>
              </div>
              <div className="adjustment-totals-item">
                <span className="adjustment-metadata-label">
                  {copy.remainingTotal}:
                </span>
                <strong className="adjustment-totals-grand">
                  <bdi>
                    {displayMoney(
                      previewCurrent
                        ? summary?.primarySupplierCostDeltaFils
                        : null,
                    )}
                  </bdi>
                </strong>
              </div>
              <div className="adjustment-totals-item">
                <span className="adjustment-metadata-label">
                  {copy.returnTotal}:
                </span>
                <bdi className="font-mono">
                  {displayMoney(
                    previewCurrent ? summary?.costAfterDiscountDeltaFils : null,
                  )}
                </bdi>
              </div>
            </div>
          </div>

          {/* Bottom Actions Bar (Screenshot 3) */}
          <div className="adjustment-bottom-actions">
            <div className="adjustment-bottom-toolbar">
              <div className="adjustment-bottom-toolbar-group">
                <button
                  type="button"
                  className="adjustment-toolbar-btn"
                  disabled={
                    busy || postUncertain || navigation.previousId === null
                  }
                  data-adjustment-action="previous"
                  onClick={() => leave(() => onNavigate("previous"))}
                >
                  {copy.previous}
                </button>
                <button
                  type="button"
                  className="adjustment-toolbar-btn"
                  disabled={busy || postUncertain || navigation.nextId === null}
                  data-adjustment-action="next"
                  onClick={() => leave(() => onNavigate("next"))}
                >
                  {copy.next}
                </button>
                <button
                  type="button"
                  className="adjustment-toolbar-btn"
                  disabled={busy || postUncertain}
                  data-adjustment-action="search"
                  onClick={() => leave(onSearch)}
                >
                  🔍 {copy.searchInvoice}
                </button>
                {onNewInvoice === undefined ? null : (
                  <button
                    type="button"
                    className="adjustment-toolbar-btn"
                    disabled={busy || postUncertain}
                    data-adjustment-action="new-invoice"
                    onClick={() => leave(onNewInvoice)}
                  >
                    + {copy.newInvoice}
                  </button>
                )}
              </div>
              <div className="adjustment-bottom-toolbar-group">
                <button
                  type="button"
                  className="adjustment-toolbar-btn adjustment-toolbar-btn-danger"
                  disabled={busy || postUncertain}
                  data-adjustment-action="cancel-adjustment"
                  onClick={() => leave(onBack, true)}
                >
                  🗑️ {copy.cancelAdjustment}
                </button>
              </div>
            </div>

            <div className="adjustment-save-row">
              <button
                type="button"
                className="quiet-button"
                disabled={busy || postUncertain}
                data-adjustment-action="back"
                onClick={() => leave()}
              >
                {copy.back}
              </button>
              <button
                type="button"
                className="primary-button purchase-save-draft-btn"
                ref={saveRef}
                data-adjustment-action="save-review"
                disabled={busy || postUncertain || reloadRequired}
                onClick={() => void saveAndReview()}
              >
                <span>💾</span> {copy.saveReview}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delta Summary Modal (Screenshot 1) */}
      {stage === "summary" && summary !== null ? (
        <div className="delta-summary-backdrop" role="presentation">
          <div
            className="delta-summary-dialog"
            inert={leaveWarning}
            ref={summaryRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delta-summary-title"
          >
            {/* Header */}
            <div className="delta-summary-header">
              <h3 id="delta-summary-title" className="delta-summary-title">
                <svg
                  className="delta-summary-icon"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34" />
                  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
                  <path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z" />
                </svg>
                <span>{copy.difference}</span>
              </h3>
              <span className="delta-summary-badge">
                {copy.deltaSummarySubtitle} {originalNumberDisplay} —{" "}
                {nextSuffix}-{originalNumberDisplay}
              </span>
            </div>

            {/* Comparison Table */}
            <div
              className="delta-summary-table-wrap"
              role="group"
              aria-label={copy.difference}
              tabIndex={0}
            >
              <PurchaseAdjustmentHeaderComparisonTable
                comparison={summary.headerComparison}
              />
              <table
                className="delta-summary-table"
                data-adjustment-totals="comparison"
              >
                <thead>
                  <tr>
                    <th scope="col">{copy.total}</th>
                    <th scope="col">{copy.before}</th>
                    <th scope="col">{copy.after}</th>
                    <th scope="col">{copy.valueDelta}</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      [
                        "primarySupplierCostFils",
                        copy.totalCost,
                        summary.primarySupplierCostDeltaFils,
                      ],
                      [
                        "allowanceFils",
                        copy.discountAmount,
                        summary.allowanceDeltaFils,
                      ],
                      [
                        "offerFils",
                        purchasingMessages[locale].invoiceOffer,
                        summary.offerDeltaFils,
                      ],
                      [
                        "costAfterDiscountFils",
                        copy.afterDiscount,
                        summary.costAfterDiscountDeltaFils,
                      ],
                    ] as const
                  ).map(([field, label, delta]) => (
                    <tr key={field}>
                      <th scope="row">{label}</th>
                      <td>
                        <bdi>
                          {formatAdjustmentFils(
                            summary.totalsComparison.before[field],
                            locale,
                          )}
                        </bdi>
                      </td>
                      <td>
                        <bdi>
                          {formatAdjustmentFils(
                            summary.totalsComparison.after[field],
                            locale,
                          )}
                        </bdi>
                      </td>
                      <td>
                        <bdi>{formatAdjustmentFils(delta, locale)}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.warnings.length > 0 ? (
                <p role="status" className="adjustment-warning">
                  {purchasingMessages[locale].duplicate}{" "}
                  {purchasingMessages[locale].openDecision}
                </p>
              ) : null}
              <div>
                <p>{copy.stockImpact}</p>
                {summary.stockEffects.length === 0 ? (
                  <p>{copy.noStockImpact}</p>
                ) : (
                  <ul className="adjustment-supplier-effects">
                    {summary.stockEffects.map((effect, index) => (
                      <li key={`${effect.itemId}-${index}`}>
                        {effect.itemDisplayName}: {copy.qtyDelta}{" "}
                        <bdi>{effect.quantityDelta}</bdi>; {copy.valueDelta}{" "}
                        <bdi>
                          {formatAdjustmentFils(
                            effect.primarySupplierCostDeltaFils,
                            locale,
                          )}
                        </bdi>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {summary.supplierEffects.length > 0 ? (
                <div>
                  <p>{copy.supplierImpact}</p>
                  <ul className="adjustment-supplier-effects">
                    {summary.supplierEffects.map((effect) => (
                      <li key={effect.supplierId}>
                        {effect.supplierNameSnapshot}:{" "}
                        <bdi>
                          {formatAdjustmentFils(effect.deltaFils, locale)}
                        </bdi>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>{copy.noSupplierImpact}</p>
              )}
              {summary.rowDeltas.length === 0 ? (
                <p>{copy.unchanged}</p>
              ) : (
                <table className="delta-summary-table">
                  <thead>
                    <tr>
                      <th scope="col">{copy.item}</th>
                      <th scope="col">{copy.qtyBefore}</th>
                      <th scope="col">{copy.qtyAfter}</th>
                      <th scope="col">{copy.qtyDelta}</th>
                      <th scope="col">{copy.costBefore}</th>
                      <th scope="col">{copy.costAfter}</th>
                      <th scope="col">{copy.valueDelta}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rowDeltas.map((row) => {
                      const itemName =
                        row.after?.itemDisplayName ??
                        row.before?.itemDisplayName ??
                        copy.item;
                      const beforeQty = row.before?.enteredQuantity ?? "0";
                      const afterQty = row.after?.enteredQuantity ?? "0";
                      const qtyDeltaNum = BigInt(row.quantityDelta);
                      const formattedQtyDelta =
                        qtyDeltaNum > 0n
                          ? `+${row.quantityDelta}`
                          : `${row.quantityDelta}`;
                      const costBeforeFils = row.before?.costFils ?? "0";
                      const costAfterFils = row.after?.costFils ?? "0";
                      const costDeltaFils = row.primarySupplierCostDeltaFils;
                      const isPositiveCost =
                        BigInt(costDeltaFils.replace(/^-/u, "") || "0") > 0n &&
                        !costDeltaFils.startsWith("-");

                      return (
                        <tr key={row.lineageId}>
                          <th scope="row">
                            <span>{itemName}</span>
                            {row.changes.some(
                              (change) => change.field === "retail-price",
                            ) ? (
                              <p>
                                {purchasingMessages[locale].sellingPrice}:{" "}
                                <bdi>
                                  {formatFilsToIqd(
                                    row.before?.retailPriceFils ?? "0",
                                    locale,
                                  )}
                                </bdi>{" "}
                                →{" "}
                                <bdi>
                                  {formatFilsToIqd(
                                    row.after?.retailPriceFils ?? "0",
                                    locale,
                                  )}
                                </bdi>
                              </p>
                            ) : null}
                          </th>
                          <td>
                            <bdi>{beforeQty}</bdi>
                          </td>
                          <td>
                            <bdi>{afterQty}</bdi>
                          </td>
                          <td>
                            {/* Accessible quantity comparison includes the signed movement. */}
                            <span className="visually-hidden">
                              {beforeQty} → {afterQty} ({row.quantityDelta})
                            </span>
                            <bdi
                              className={
                                qtyDeltaNum > 0n
                                  ? "delta-positive"
                                  : qtyDeltaNum < 0n
                                    ? "delta-negative"
                                    : ""
                              }
                            >
                              {formattedQtyDelta}
                            </bdi>
                          </td>
                          <td>
                            <bdi>{formatFilsToIqd(costBeforeFils, locale)}</bdi>
                          </td>
                          <td>
                            <bdi>{formatFilsToIqd(costAfterFils, locale)}</bdi>
                          </td>
                          <td>
                            <bdi
                              className={
                                isPositiveCost
                                  ? "delta-positive"
                                  : costDeltaFils.startsWith("-")
                                    ? "delta-negative"
                                    : ""
                              }
                            >
                              {formatAdjustmentFils(costDeltaFils, locale)}
                            </bdi>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="delta-summary-footer">
              {error === null ? null : (
                <div
                  className="form-error"
                  role="alert"
                  ref={errorRef}
                  tabIndex={-1}
                >
                  <span>{error.message}</span>
                  {error.tracking ? (
                    <PurchasingSupportDetails reference={error.tracking} />
                  ) : null}
                </div>
              )}
              <div className="delta-summary-net">
                <span>{copy.netDeltaPosted}</span>
                <span className="delta-summary-grand-total">
                  <bdi>
                    {formatAdjustmentFils(
                      summary.primarySupplierCostDeltaFils,
                      locale,
                    )}
                  </bdi>
                </span>
              </div>

              <div className="delta-summary-reason-field">
                <input
                  type="text"
                  className="delta-summary-reason-input"
                  placeholder={copy.addEvidence}
                  aria-label={copy.evidence}
                  value={evidence}
                  disabled={busy || postUncertain}
                  onChange={(event) => editEvidence(event.target.value)}
                />
              </div>

              <p>{getAdjustmentReasonLabel(summary.reason, locale)}</p>
              {!previewCurrent ? (
                <p role="status">{copy.previewChanged}</p>
              ) : null}

              <div className="delta-summary-actions">
                <button
                  type="button"
                  className="quiet-button"
                  data-adjustment-action="close-summary"
                  disabled={busy || postUncertain}
                  onClick={closeSummary}
                >
                  {copy.cancel}
                </button>
                {reloadRequired ? (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => void reloadSavedDraft()}
                  >
                    {copy.reloadDraft}
                  </button>
                ) : !previewCurrent ? (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={busy || postUncertain}
                    onClick={() => void saveAndReview()}
                  >
                    {copy.saveReview}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-button"
                  data-adjustment-action="confirm"
                  disabled={busy || !previewCurrent}
                  onClick={() => void post()}
                >
                  {copy.confirm}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatOriginalInvoiceNumber(detail: PurchasePostedDetail): string {
  return `${detail.number.series}${detail.number.value}/${detail.number.year}`;
}

function getNextAdjustmentSuffix(detail: PurchasePostedDetail): string {
  const nextNum = detail.adjustments.length + 1;
  return `A${String(nextNum).padStart(2, "0")}`;
}

function formatAdjustmentNumber(number: {
  readonly original: {
    readonly series: "P";
    readonly value: string;
    readonly year: number;
  };
  readonly suffix: string;
}): string {
  return `${number.original.series}${number.original.value}-A${number.suffix.padStart(2, "0")}/${number.original.year}`;
}
