import { useEffect, useState } from "react";
import {
  PURCHASE_ADJUSTMENT_REASONS,
  type PurchaseAdjustmentDraft,
  type PurchaseAdjustmentReason,
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
import { usePreferences } from "./preferences-provider";

type Stage = "start" | "unfinished" | "edit" | "summary" | "posted";

const text = {
  en: {
    addEvidence: "Evidence or note (optional)",
    back: "Back to original invoice",
    blocked:
      "This Delta is not valid against current stock. Resolve it through a stock count, a Purchase Return, or another correction, then retry.",
    confirm: "Confirm and post Delta",
    continue: "Continue draft",
    cost: "Primary supplier cost (fils)",
    delete: "Delete draft",
    difference: "Difference and impact",
    discardQuestion:
      "This adjustment is unfinished. Continue it or delete the draft before leaving.",
    evidence: "Reason evidence",
    invoice: "Supplier invoice number",
    item: "Item",
    posted: "Adjustment posted",
    quantity: "Quantity",
    reason: "Reason",
    remove: "Remove line",
    retail: "Retail price (fils)",
    saveReview: "Save and review Delta",
    start: "Create adjustment copy",
    supplier: "Supplier",
    title: "Purchase Invoice Adjustment",
    unchanged: "Unchanged lines create no stock or value effects.",
    unfinished:
      "An unfinished adjustment draft already exists for this invoice.",
  },
  ar: {
    addEvidence: "دليل السبب أو ملاحظة (اختياري)",
    back: "العودة إلى الفاتورة الأصلية",
    blocked:
      "هذا الفرق غير صالح مقابل المخزون الحالي. عالجه بجرد المخزون أو مردود شراء أو تصحيح آخر، ثم أعد المحاولة.",
    confirm: "تأكيد وترحيل الفرق",
    continue: "متابعة المسودة",
    cost: "كلفة المورد الأساسية (فلس)",
    delete: "حذف المسودة",
    difference: "الفرق والأثر",
    discardQuestion:
      "هذا التعديل غير مكتمل. تابع المسودة أو احذفها قبل المغادرة.",
    evidence: "دليل السبب",
    invoice: "رقم فاتورة المورد",
    item: "المادة",
    posted: "تم ترحيل التعديل",
    quantity: "الكمية",
    reason: "السبب",
    remove: "حذف السطر",
    retail: "سعر البيع (فلس)",
    saveReview: "حفظ ومراجعة الفرق",
    start: "إنشاء نسخة التعديل",
    supplier: "المورد",
    title: "تعديل فاتورة شراء",
    unchanged: "الأسطر التي لم تتغير لا تنشئ حركة مخزون أو أثر قيمة.",
    unfinished: "توجد مسودة تعديل غير مكتملة لهذه الفاتورة.",
  },
} as const;

export function PurchaseAdjustmentWorkflow({
  baseUrl,
  detail,
  leaveRequest,
  onBack,
  onDraftActive,
  onPosted,
}: {
  readonly baseUrl: string;
  readonly detail: PurchasePostedDetail;
  readonly leaveRequest: number;
  readonly onBack: () => void;
  readonly onDraftActive: (active: boolean) => void;
  readonly onPosted: (purchaseId: string) => Promise<void>;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = text[locale];
  const [stage, setStage] = useState<Stage>(
    detail.activeAdjustmentDrafts.length > 0 ? "unfinished" : "start",
  );
  const [draft, setDraft] = useState<PurchaseAdjustmentDraft | null>(null);
  const [summary, setSummary] = useState<PurchaseAdjustmentSummary | null>(
    null,
  );
  const [reason, setReason] = useState<PurchaseAdjustmentReason | "">("");
  const [evidence, setEvidence] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaveWarning, setLeaveWarning] = useState(false);
  const [postedNumber, setPostedNumber] = useState("");

  useEffect(() => {
    if (stage === "edit") {
      void requestSuppliers(baseUrl)
        .then((result) => setSuppliers(result.suppliers))
        .catch(handleError);
    }
  }, [baseUrl, stage]);

  useEffect(() => {
    onDraftActive(detail.activeAdjustmentDrafts.length > 0);
  }, [detail.activeAdjustmentDrafts.length, onDraftActive]);

  useEffect(() => {
    if (leaveRequest > 0) setLeaveWarning(true);
  }, [leaveRequest]);

  function handleError(caught: unknown): void {
    if (
      caught instanceof PurchasingApiDenied &&
      caught.denial.code === "adjustment-batch-conflict"
    ) {
      setError(copy.blocked);
      return;
    }
    setError(
      caught instanceof PurchasingApiDenied
        ? `${caught.denial.code} · ${caught.denial.requestId}`
        : String(caught),
    );
  }

  async function createDraft(): Promise<void> {
    if (reason === "") return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPurchaseAdjustmentDraft(baseUrl, detail.id, {
        evidence: evidence.trim() === "" ? null : evidence.trim(),
        idempotencyKey: newPurchasingIdempotencyKey(),
        reason,
      });
      setDraft(created);
      onDraftActive(true);
      setStage("edit");
    } catch (caught) {
      handleError(caught);
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
    if (activeId === undefined || version === undefined) return;
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
      onBack();
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndReview(): Promise<void> {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updatePurchaseAdjustmentDraft(baseUrl, draft.id, {
        evidence: evidence.trim() === "" ? null : evidence.trim(),
        expectedVersion: draft.version,
        idempotencyKey: newPurchasingIdempotencyKey(),
        reason: reason === "" ? draft.reason : reason,
        rows: draft.rows.map((row) => ({
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
        supplierId: draft.supplierId,
        supplierInvoiceNumber: draft.supplierInvoiceNumber,
      });
      setDraft(updated);
      setSummary(await requestPurchaseAdjustmentSummary(baseUrl, updated.id));
      setStage("summary");
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function post(): Promise<void> {
    if (draft === null || summary === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postPurchaseAdjustment(baseUrl, draft.id, {
        confirmationHash: summary.confirmationHash,
        expectedVersion: draft.version,
        idempotencyKey: newPurchasingIdempotencyKey(),
      });
      setPostedNumber(formatAdjustmentNumber(result.posted.number));
      setStage("posted");
      onDraftActive(false);
      await onPosted(detail.id);
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  function leave(): void {
    if (stage === "unfinished" || stage === "edit" || stage === "summary") {
      setLeaveWarning(true);
    } else {
      onBack();
    }
  }

  return (
    <section className="purchase-adjustment" aria-labelledby="adjustment-title">
      <h3 id="adjustment-title">{copy.title}</h3>
      <p>{copy.unchanged}</p>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {leaveWarning ? (
        <div
          className="adjustment-warning"
          role="alertdialog"
          aria-label={copy.discardQuestion}
          aria-modal="true"
        >
          <p>{copy.discardQuestion}</p>
          <div className="adjustment-actions">
            <button
              type="button"
              autoFocus
              onClick={() => setLeaveWarning(false)}
            >
              {copy.continue}
            </button>
            <button type="button" onClick={() => void discardDraft()}>
              {copy.delete}
            </button>
          </div>
        </div>
      ) : null}
      {stage === "unfinished" ? (
        <div className="adjustment-warning" role="alert">
          <p>{copy.unfinished}</p>
          <div className="adjustment-actions">
            <button
              type="button"
              onClick={() => void continueDraft()}
              disabled={busy}
            >
              {copy.continue}
            </button>
            <button
              type="button"
              onClick={() => void discardDraft()}
              disabled={busy}
            >
              {copy.delete}
            </button>
          </div>
        </div>
      ) : null}
      {stage === "start" ? (
        <div className="adjustment-form">
          <label>
            {copy.reason}
            <select
              required
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as PurchaseAdjustmentReason | "")
              }
            >
              <option value="">—</option>
              {PURCHASE_ADJUSTMENT_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.addEvidence}
            <textarea
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || reason === ""}
            onClick={() => void createDraft()}
          >
            {copy.start}
          </button>
        </div>
      ) : null}
      {stage === "edit" && draft !== null ? (
        <div className="adjustment-form">
          <label>
            {copy.reason}
            <select
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as PurchaseAdjustmentReason)
              }
            >
              {PURCHASE_ADJUSTMENT_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.evidence}
            <textarea
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </label>
          <label>
            {copy.supplier}
            <select
              value={draft.supplierId}
              onChange={(event) =>
                setDraft({ ...draft, supplierId: event.target.value })
              }
            >
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.invoice}
            <input
              value={draft.supplierInvoiceNumber}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  supplierInvoiceNumber: event.target.value,
                })
              }
            />
          </label>
          <div
            className="purchase-table-wrap"
            role="group"
            aria-label={copy.title}
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>{copy.item}</th>
                  <th>{copy.quantity}</th>
                  <th>{copy.cost}</th>
                  <th>{copy.retail}</th>
                  <th>
                    <span className="visually-hidden">{copy.remove}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row) => (
                  <tr key={row.lineageId}>
                    <th scope="row">{row.itemDisplayName}</th>
                    <td>
                      <input
                        aria-label={`${copy.quantity} ${row.itemDisplayName}`}
                        inputMode="numeric"
                        value={row.enteredQuantity}
                        onChange={(event) =>
                          setDraft({
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
                    <td>
                      <input
                        aria-label={`${copy.cost} ${row.itemDisplayName}`}
                        inputMode="numeric"
                        value={row.costFils}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            rows: draft.rows.map((candidate) =>
                              candidate.lineageId === row.lineageId
                                ? { ...candidate, costFils: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${copy.retail} ${row.itemDisplayName}`}
                        inputMode="numeric"
                        value={row.retailPriceFils}
                        onChange={(event) =>
                          setDraft({
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
                    <td>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            rows: draft.rows.filter(
                              (candidate) =>
                                candidate.lineageId !== row.lineageId,
                            ),
                          })
                        }
                      >
                        {copy.remove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveAndReview()}
          >
            {copy.saveReview}
          </button>
        </div>
      ) : null}
      {stage === "summary" && summary !== null ? (
        <div className="adjustment-summary">
          <h4>{copy.difference}</h4>
          <dl>
            <div>
              <dt>{copy.quantity}</dt>
              <dd>
                <bdi>{summary.quantityDelta}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.cost}</dt>
              <dd>
                <bdi>{summary.primarySupplierCostDeltaFils}</bdi>
              </dd>
            </div>
          </dl>
          <ul>
            {summary.rowDeltas.map((row) => (
              <li key={row.lineageId}>
                {row.after?.itemDisplayName ?? row.before?.itemDisplayName}:{" "}
                {row.before?.enteredQuantity ?? "0"} →{" "}
                {row.after?.enteredQuantity ?? "0"} ({row.quantityDelta})
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy} onClick={() => void post()}>
            {copy.confirm}
          </button>
        </div>
      ) : null}
      {stage === "posted" ? (
        <div role="status">
          <h4>{copy.posted}</h4>
          <p>
            <bdi>{postedNumber}</bdi>
          </p>
        </div>
      ) : null}
      <button
        type="button"
        className="quiet-button"
        disabled={busy}
        onClick={leave}
      >
        {copy.back}
      </button>
    </section>
  );
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
