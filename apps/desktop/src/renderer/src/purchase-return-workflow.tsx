import { useEffect, useState } from "react";
import type {
  PurchasePostedDetail,
  PurchaseReturnDraft,
  PurchaseReturnSummary,
} from "@breev/contracts/local-rest";

import { approveStepUpChallenge, createStepUpChallenge } from "./identity-api";
import {
  PurchasingApiDenied,
  createPurchaseReturnDraft,
  discardPurchaseReturnDraft,
  newPurchasingIdempotencyKey,
  postPurchaseReturn,
  requestPurchaseReturnDraft,
  requestPurchaseReturnSummary,
  updatePurchaseReturnDraft,
} from "./purchasing-api";
import { usePreferences } from "./preferences-provider";

type Stage = "start" | "unfinished" | "edit" | "summary" | "posted";

const text = {
  en: {
    back: "Back to original invoice",
    carrying: "Inventory carrying amount",
    confirm: "Approve and post return",
    continue: "Continue draft",
    delete: "Delete draft",
    difference: "Difference pending G-01 approval",
    discardQuestion:
      "This physical return is unfinished. Continue it or delete its draft before leaving.",
    evidence: "Disposition evidence",
    evidenceHint: "Required proof of why and how these goods left",
    item: "Item and batch",
    password: "Your password",
    posted: "Purchase Return posted",
    quantity: "Return quantity",
    reason: "Return reason",
    saveReview: "Save and review physical return",
    start: "Create Purchase Return",
    supplier: "Supplier balance reduction",
    title: "Purchase Return · goods physically leave stock",
    unfinished:
      "An unfinished Purchase Return already exists for this invoice.",
  },
  ar: {
    back: "العودة إلى الفاتورة الأصلية",
    carrying: "القيمة الدفترية الخارجة من المخزون",
    confirm: "الموافقة وترحيل مردود الشراء",
    continue: "متابعة المسودة",
    delete: "حذف المسودة",
    difference: "الفرق بانتظار اعتماد G-01",
    discardQuestion:
      "مردود البضاعة الفعلي غير مكتمل. تابع المسودة أو احذفها قبل المغادرة.",
    evidence: "دليل التصرف بالبضاعة",
    evidenceHint: "إثبات إلزامي لسبب وكيفية خروج البضاعة",
    item: "المادة والتشغيلة",
    password: "كلمة مرورك",
    posted: "تم ترحيل مردود الشراء",
    quantity: "كمية المردود",
    reason: "سبب المردود",
    saveReview: "حفظ ومراجعة مردود البضاعة",
    start: "إنشاء مردود شراء",
    supplier: "تخفيض رصيد المورد",
    title: "مردود شراء · بضاعة تغادر المخزون فعلياً",
    unfinished: "توجد مسودة مردود شراء غير مكتملة لهذه الفاتورة.",
  },
} as const;

export function PurchaseReturnWorkflow({
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
    detail.activeReturnDrafts.length > 0 ? "unfinished" : "start",
  );
  const [draft, setDraft] = useState<PurchaseReturnDraft | null>(null);
  const [summary, setSummary] = useState<PurchaseReturnSummary | null>(null);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaveWarning, setLeaveWarning] = useState(false);
  const [postedNumber, setPostedNumber] = useState("");

  useEffect(() => {
    onDraftActive(detail.activeReturnDrafts.length > 0);
  }, [detail.activeReturnDrafts.length, onDraftActive]);
  useEffect(() => {
    if (leaveRequest > 0) setLeaveWarning(true);
  }, [leaveRequest]);

  function handleError(caught: unknown): void {
    setError(
      caught instanceof PurchasingApiDenied
        ? `${caught.denial.code} · ${caught.denial.requestId}`
        : String(caught),
    );
  }

  async function createDraft(): Promise<void> {
    if (reason.trim() === "" || evidence.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPurchaseReturnDraft(baseUrl, detail.id, {
        evidence: evidence.trim(),
        idempotencyKey: newPurchasingIdempotencyKey(),
        reason: reason.trim(),
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
    const active = detail.activeReturnDrafts[0];
    if (active === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await requestPurchaseReturnDraft(baseUrl, active.id);
      setDraft(loaded);
      setReason(loaded.reason);
      setEvidence(loaded.evidence);
      onDraftActive(true);
      setStage("edit");
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft(): Promise<void> {
    const active = draft ?? detail.activeReturnDrafts[0];
    if (active === undefined) return;
    setBusy(true);
    try {
      await discardPurchaseReturnDraft(baseUrl, active.id, {
        confirmation: "discard-purchase-return-draft",
        expectedVersion: active.version,
        idempotencyKey: newPurchasingIdempotencyKey(),
      });
      onDraftActive(false);
      await onPosted(detail.id);
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
      const updated = await updatePurchaseReturnDraft(baseUrl, draft.id, {
        evidence: evidence.trim(),
        expectedVersion: draft.version,
        idempotencyKey: newPurchasingIdempotencyKey(),
        reason: reason.trim(),
        rows: draft.rows.map((row) => ({
          originalPurchaseRowId: row.originalPurchaseRowId,
          returnQuantity: row.returnQuantity,
        })),
      });
      setDraft(updated);
      setSummary(await requestPurchaseReturnSummary(baseUrl, updated.id));
      setStage("summary");
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function post(): Promise<void> {
    if (draft === null || summary === null || password === "") return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await createStepUpChallenge(baseUrl, {
        action: "purchase.return.post",
        idempotencyKey: newPurchasingIdempotencyKey(),
        subjectId: draft.id,
      });
      const approved = await approveStepUpChallenge(baseUrl, challenge.id, {
        idempotencyKey: newPurchasingIdempotencyKey(),
        password,
      });
      const result = await postPurchaseReturn(baseUrl, draft.id, {
        confirmationHash: summary.confirmationHash,
        expectedVersion: draft.version,
        idempotencyKey: newPurchasingIdempotencyKey(),
        stepUpChallengeId: approved.id,
      });
      setPostedNumber(
        `${result.posted.number.series}${result.posted.number.value}/${result.posted.number.year}`,
      );
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
    } else onBack();
  }

  return (
    <section className="purchase-return" aria-labelledby="return-title">
      <h3 id="return-title">{copy.title}</h3>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {leaveWarning ? (
        <div
          className="return-warning"
          role="alertdialog"
          aria-label={copy.discardQuestion}
          aria-modal="true"
        >
          <p>{copy.discardQuestion}</p>
          <div className="return-actions">
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
        <div className="return-warning" role="alert">
          <p>{copy.unfinished}</p>
          <div className="return-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void continueDraft()}
            >
              {copy.continue}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void discardDraft()}
            >
              {copy.delete}
            </button>
          </div>
        </div>
      ) : null}
      {stage === "start" ? (
        <div className="return-form">
          <label>
            {copy.reason}
            <textarea
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label>
            {copy.evidence}
            <span className="field-hint">{copy.evidenceHint}</span>
            <textarea
              required
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || reason.trim() === "" || evidence.trim() === ""}
            onClick={() => void createDraft()}
          >
            {copy.start}
          </button>
        </div>
      ) : null}
      {stage === "edit" && draft !== null ? (
        <div className="return-form">
          <label>
            {copy.reason}
            <textarea
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label>
            {copy.evidence}
            <textarea
              required
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
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
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      {row.itemDisplayName}
                      <small>{row.batchId}</small>
                    </th>
                    <td>
                      <input
                        aria-label={`${copy.quantity} ${row.itemDisplayName}`}
                        inputMode="numeric"
                        min="0"
                        max={row.remainingEligibleQuantity}
                        value={row.returnQuantity}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            rows: draft.rows.map((candidate) =>
                              candidate.id === row.id
                                ? {
                                    ...candidate,
                                    returnQuantity: event.target.value,
                                  }
                                : candidate,
                            ),
                          })
                        }
                      />
                      <small>/ {row.remainingEligibleQuantity}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={
              busy ||
              reason.trim() === "" ||
              evidence.trim() === "" ||
              !draft.rows.some((row) => isPositiveQuantity(row.returnQuantity))
            }
            onClick={() => void saveAndReview()}
          >
            {copy.saveReview}
          </button>
        </div>
      ) : null}
      {stage === "summary" && summary !== null ? (
        <div className="return-summary">
          <dl>
            <div>
              <dt>{copy.carrying}</dt>
              <dd>
                <bdi>{summary.inventoryCarryingAmountFils}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.supplier}</dt>
              <dd>
                <bdi>{summary.supplierReductionFils}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.difference}</dt>
              <dd>
                <bdi>
                  {(
                    BigInt(summary.supplierReductionFils) -
                    BigInt(summary.inventoryCarryingAmountFils)
                  ).toString()}
                </bdi>
              </dd>
            </div>
          </dl>
          <ul>
            {summary.rows.map((row) => (
              <li key={row.originalPurchaseRowId}>
                {row.itemDisplayName}: {row.quantity} · {row.carryingAmountFils}{" "}
                / {row.supplierReductionFils}
              </li>
            ))}
          </ul>
          <label>
            {copy.password}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || password === ""}
            onClick={() => void post()}
          >
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

function isPositiveQuantity(value: string): boolean {
  return /^\d+$/u.test(value) && BigInt(value) > 0n;
}
