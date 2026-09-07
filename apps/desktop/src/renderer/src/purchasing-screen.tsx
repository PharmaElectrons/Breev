import { useEffect, useRef, useState } from "react";
import type {
  PurchaseDraft,
  PurchaseDraftDetail,
  PurchaseDraftResult,
  Supplier,
} from "@breev/contracts/local-rest";
import { PurchaseRowEntry } from "./purchase-row-entry";
import { useIdentityState } from "./identity-state-provider";
import {
  createPurchaseDraft,
  discardPurchaseDraft,
  PurchasingApiDenied,
  purchasingCommandAttempt,
  requestPurchaseDrafts,
  requestPurchaseDraft,
  requestSuppliers,
  updatePurchaseDraft,
  type PurchasingCommandAttempt,
} from "./purchasing-api";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";
import { SuppliersWorkspace } from "./suppliers-workspace";

const today = (): string => {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

export function PurchasingRouteView({
  baseUrl,
}: {
  readonly baseUrl: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const { state: identity } = useIdentityState();
  const copy = purchasingMessages[locale];
  const canManageSuppliers =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("suppliers.manage");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [drafts, setDrafts] = useState<PurchaseDraft[]>([]);
  const [activeDraft, setActiveDraft] = useState<PurchaseDraftDetail | null>(
    null,
  );
  const [warning, setWarning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"invoice" | "suppliers">("invoice");
  const invoiceRef = useRef<HTMLInputElement>(null);
  const registerRef = useRef<HTMLDialogElement>(null);
  const supplierRef = useRef<HTMLSelectElement>(null);
  const draftCommandAttempt = useRef<PurchasingCommandAttempt | null>(null);

  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [settlementContext, setSettlementContext] = useState<"cash" | "debt">(
    "cash",
  );
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [draftQuery, setDraftQuery] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftContext, setDraftContext] = useState<"all" | "cash" | "debt">(
    "all",
  );

  async function reload(): Promise<void> {
    const [supplierResult, draftResult] = await Promise.all([
      requestSuppliers(baseUrl),
      requestPurchaseDrafts(baseUrl),
    ]);
    setSuppliers(supplierResult.suppliers);
    setDrafts(draftResult.drafts);
  }

  useEffect(() => {
    let live = true;
    void reload()
      .catch(() => live && setError(copy.error))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [baseUrl, copy.error]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isInsideEditor =
        target instanceof HTMLElement &&
        target.closest("[data-purchase-editor]") !== null;
      if (event.key === "Escape" && activeDraft !== null && isInsideEditor) {
        event.preventDefault();
        void confirmDiscard();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function showDraft(draft: PurchaseDraft): Promise<void> {
    registerRef.current?.close();
    setView("invoice");

    draftCommandAttempt.current = null;
    try {
      const detail = await requestPurchaseDraft(baseUrl, draft.id);
      setActiveDraft(detail);
      setSupplierInvoiceNumber(detail.supplierInvoiceNumber);
      setSupplierId(detail.supplierId);
      setSettlementContext(detail.settlementContext);
      setInvoiceDate(detail.invoiceDate);
      setWarning(false);
      setError(null);
      setStatus(null);
      queueMicrotask(() => invoiceRef.current?.focus());
    } catch {
      setError(copy.error);
    }
  }

  function newDraft(): void {
    setView("invoice");
    draftCommandAttempt.current = null;
    setActiveDraft(null);
    setSupplierInvoiceNumber("");
    setSupplierId("");
    setSettlementContext("cash");
    setInvoiceDate(today());
    setWarning(false);
    setError(null);
    setStatus(null);
    queueMicrotask(() => invoiceRef.current?.focus());
  }

  async function saveDraft(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (supplierId === "") {
      setError(copy.error);
      supplierRef.current?.focus();
      return;
    }
    try {
      const header = {
        invoiceDate,
        settlementContext,
        supplierId,
        supplierInvoiceNumber,
      };
      const attempt = purchasingCommandAttempt(
        draftCommandAttempt.current,
        JSON.stringify({
          action: activeDraft === null ? "create" : "update",
          draftId: activeDraft?.id,
          expectedVersion: activeDraft?.version,
          header,
        }),
      );
      draftCommandAttempt.current = attempt;
      const result: PurchaseDraftResult =
        activeDraft === null
          ? await createPurchaseDraft(baseUrl, {
              ...header,
              idempotencyKey: attempt.idempotencyKey,
            })
          : await updatePurchaseDraft(baseUrl, activeDraft.id, {
              ...header,
              expectedVersion: activeDraft.version,
              idempotencyKey: attempt.idempotencyKey,
            });
      draftCommandAttempt.current = null;
      const detail = await requestPurchaseDraft(baseUrl, result.draft.id);
      setActiveDraft(detail);
      setWarning(result.warnings.length > 0);
      setStatus(copy.saved);
      await reload();
    } catch (caught) {
      setError(copy.error);
      if (
        caught instanceof PurchasingApiDenied &&
        (caught.denial.code === "supplier-archived" ||
          caught.denial.code === "supplier-merged" ||
          caught.denial.code === "supplier-not-found" ||
          caught.denial.fieldErrors.some(
            (fieldError) => fieldError.path[0] === "supplierId",
          ))
      ) {
        supplierRef.current?.focus();
      }
    }
  }

  async function confirmDiscard(): Promise<void> {
    if (activeDraft === null || !window.confirm(copy.confirmDiscard)) return;
    try {
      const attempt = purchasingCommandAttempt(
        draftCommandAttempt.current,
        JSON.stringify({
          action: "discard",
          draftId: activeDraft.id,
          expectedVersion: activeDraft.version,
        }),
      );
      draftCommandAttempt.current = attempt;
      await discardPurchaseDraft(baseUrl, activeDraft.id, {
        confirmation: "discard-populated-purchase-draft",
        expectedVersion: activeDraft.version,
        idempotencyKey: attempt.idempotencyKey,
      });
      draftCommandAttempt.current = null;
      newDraft();
      setStatus(copy.discarded);
      await reload();
    } catch {
      setError(copy.error);
    }
  }

  const activeSuppliers = suppliers.filter(
    (supplier) => supplier.status === "active",
  );
  const currentInactiveSupplier = suppliers.find(
    (supplier) =>
      supplier.id === activeDraft?.supplierId && supplier.status !== "active",
  );
  const headerSuppliers =
    currentInactiveSupplier === undefined
      ? activeSuppliers
      : [...activeSuppliers, currentInactiveSupplier];

  const normalizedQuery = draftQuery.trim().toLocaleLowerCase(locale);
  const filteredDrafts = drafts.filter((draft) => {
    const matchesQuery =
      normalizedQuery === "" ||
      draft.supplierInvoiceNumber
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery) ||
      draft.supplierNameSnapshot
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery);
    const matchesDate = draftDate === "" || draft.invoiceDate === draftDate;
    const matchesContext =
      draftContext === "all" || draft.settlementContext === draftContext;
    return matchesQuery && matchesDate && matchesContext;
  });

  function clearDraftFilters(): void {
    setDraftQuery("");
    setDraftDate("");
    setDraftContext("all");
  }

  function focusDraftRegister(): void {
    registerRef.current?.showModal();
    const heading = document.getElementById("draft-list-title");
    heading?.scrollIntoView({ block: "start" });
    heading?.focus();
  }

  const activeIndex = drafts.findIndex((draft) => draft.id === activeDraft?.id);
  const canUseOcr =
    identity?.state === "authenticated" &&
    identity.entitlement.capabilities.includes("purchase-invoice-ocr");
  const columns = [
    copy.item,
    copy.quantity,
    copy.returned,
    copy.unit,
    copy.cost,
    copy.expiry,
    copy.margin,
    copy.retail,
    copy.special,
    copy.total,
    copy.actions,
  ];

  return (
    <section className="purchasing-workspace" aria-label={copy.title}>
      <div className="purchase-view-tabs" aria-label={copy.title}>
        <button
          type="button"
          className="purchase-view-tab"
          aria-pressed={view === "invoice"}
          aria-controls="purchase-invoice-view"
          onClick={() => setView("invoice")}
        >
          <span aria-hidden="true">🧾</span> {copy.invoiceWorkspace}
        </button>
        <button
          type="button"
          className="purchase-view-tab"
          onClick={focusDraftRegister}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">📑</span> {copy.savedInvoices}
        </button>
        <button
          type="button"
          className="purchase-view-tab"
          disabled
          title={copy.unavailable}
        >
          <span aria-hidden="true">↩</span> {copy.returnInvoice}
        </button>
        {canManageSuppliers ? (
          <button
            type="button"
            className="purchase-view-tab"
            aria-pressed={view === "suppliers"}
            aria-controls="purchase-suppliers-view"
            onClick={() => setView("suppliers")}
          >
            <span aria-hidden="true">🏬</span> {copy.suppliers}
          </button>
        ) : null}
        <div className="purchase-document-actions">
          <button
            type="button"
            className="purchase-return-button"
            disabled
            title={copy.unavailable}
          >
            {copy.returnInvoice}
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled
            title={copy.unavailable}
            aria-label={copy.print}
          >
            <span aria-hidden="true">🖨</span>
          </button>
          <button
            type="button"
            className="purchase-adjust-button"
            disabled
            title={copy.unavailable}
          >
            {copy.adjustInvoice}
          </button>
        </div>
      </div>
      <div id="purchase-invoice-view" hidden={view !== "invoice"}>
        <form
          id="purchase-header-form"
          className="purchase-header-form"
          data-purchase-editor
          onSubmit={(event) => void saveDraft(event)}
        >
          <fieldset>
            <legend className="visually-hidden">{copy.invoiceWorkspace}</legend>
            <div className="purchase-header-fields">
              <label>
                {copy.invoiceDate}
                <input
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                />
              </label>
              <label>
                {copy.invoiceNumber}
                <input
                  ref={invoiceRef}
                  required
                  maxLength={120}
                  placeholder={copy.invoiceNumberHint}
                  value={supplierInvoiceNumber}
                  onChange={(event) =>
                    setSupplierInvoiceNumber(event.target.value)
                  }
                />
              </label>
              <label>
                {copy.supplier}
                <select
                  ref={supplierRef}
                  required
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  <option value="">{copy.select}</option>
                  {headerSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                      {supplier.status === "active"
                        ? ""
                        : ` · ${copy[supplier.status]}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="purchase-header-value">
                <span>{copy.supplierDebt}</span>
                <output aria-label={copy.supplierDebt} title={copy.unavailable}>
                  — {copy.iqd}
                </output>
              </div>
              <label className="purchase-item-search">
                {copy.itemSearch}
                <input
                  type="search"
                  disabled
                  placeholder={copy.itemSearchHint}
                  aria-describedby="purchase-lines-state"
                />
              </label>
            </div>
          </fieldset>
          {loading ? <p role="status">{copy.loading}</p> : null}
          {warning ? (
            <div className="purchase-warning" role="alert">
              <strong>{copy.duplicate}</strong>
              <span>{copy.openDecision}</span>
            </div>
          ) : null}
          {error === null ? null : (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {status === null ? null : (
            <p className="form-success" role="status">
              {status}
            </p>
          )}
          {!loading && activeSuppliers.length === 0 ? (
            <p role="status">{copy.noSuppliers}</p>
          ) : null}
        </form>

        {activeDraft === null ? (
          <div
            className="purchase-lines-wrap"
            role="group"
            aria-label={copy.scrollLines}
            tabIndex={0}
          >
            <table className="purchase-lines-table">
              <caption className="visually-hidden">{copy.invoiceItems}</caption>
              <colgroup>
                <col className="purchase-line-number" />
                <col className="purchase-line-name" />
                {columns.slice(1).map((column) => (
                  <col key={column} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {columns.map((column) => (
                    <th scope="col" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={12} className="purchase-lines-empty">
                    <p>{copy.noItems}</p>
                    <p id="purchase-lines-state">{copy.lineEntryUnavailable}</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <PurchaseRowEntry
            baseUrl={baseUrl}
            draft={activeDraft}
            onDraftChanged={(nextDraft) => {
              setActiveDraft(nextDraft);
              setDrafts((current) =>
                current.map((draft) =>
                  draft.id === nextDraft.id ? nextDraft : draft,
                ),
              );
            }}
          />
        )}

        <footer className="purchase-footer" data-purchase-editor>
          <div className="purchase-totals" aria-label={copy.invoiceTotals}>
            <div className="purchase-total">
              <span>{copy.itemsCost}</span>
              <output title={copy.unavailable}>
                — <small>{copy.iqd}</small>
              </output>
            </div>
            <label>
              {copy.expenses}
              <input disabled value="" placeholder="—" />
            </label>
            <label>
              {copy.discountPercentage}
              <input
                disabled
                value={activeDraft?.allowanceSnapshot.percentage ?? ""}
                placeholder="—"
              />
            </label>
            <label>
              {copy.discountAmount}
              <input disabled value="" placeholder="—" />
            </label>
            <div className="purchase-total">
              <span>{copy.afterDiscount}</span>
              <output title={copy.unavailable}>
                — <small>{copy.iqd}</small>
              </output>
            </div>
            <div className="purchase-total purchase-grand-total">
              <span>{copy.grandTotal}</span>
              <output title={copy.unavailable}>
                — <small>{copy.iqd}</small>
              </output>
            </div>
            <div className="purchase-total purchase-return-total">
              <span>{copy.returnTotal}</span>
              <output title={copy.unavailable}>
                — <small>{copy.iqd}</small>
              </output>
            </div>
          </div>
          {activeDraft === null ? null : (
            <dl className="purchase-snapshot" aria-label={copy.activeInvoice}>
              <div>
                <dt>{copy.snapshot}</dt>
                <dd>{activeDraft.allowanceSnapshot.percentage}%</dd>
              </div>
              <div>
                <dt>{copy.basis}</dt>
                <dd>
                  <bdi>{activeDraft.allowanceSnapshot.basisFils}</bdi>{" "}
                  {copy.fils}
                </dd>
              </div>
              <div>
                <dt>{copy.version}</dt>
                <dd>{activeDraft.version}</dd>
              </div>
            </dl>
          )}
          <div className="purchase-actions">
            <button
              className="quiet-button"
              type="button"
              disabled={
                drafts.length === 0 || activeIndex === drafts.length - 1
              }
              onClick={() => {
                const draft = drafts[activeIndex + 1];
                if (draft) void showDraft(draft);
              }}
            >
              <span aria-hidden="true">‹</span> {copy.previous}
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={activeIndex < 0}
              onClick={() => {
                const draft = drafts[activeIndex - 1];
                if (draft) void showDraft(draft);
                else newDraft();
              }}
            >
              {copy.next} <span aria-hidden="true">›</span>
            </button>
            <button
              className="quiet-button"
              type="button"
              onClick={focusDraftRegister}
              aria-haspopup="dialog"
            >
              <span aria-hidden="true">🔍</span> {copy.searchDrafts}
            </button>
            <button className="quiet-button" type="button" onClick={newDraft}>
              <span aria-hidden="true">＋</span> {copy.newDraft}
            </button>
            {canUseOcr ? (
              <button
                className="purchase-ocr-button"
                type="button"
                disabled
                title={copy.unavailable}
              >
                <span aria-hidden="true">📷</span> {copy.importImage}
              </button>
            ) : null}
            <button
              className="quiet-button"
              type="button"
              disabled
              title={copy.unavailable}
            >
              <span aria-hidden="true">🖨</span> {copy.print}
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled
              title={copy.unavailable}
            >
              <span aria-hidden="true">↩</span> {copy.printReturn}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={activeDraft === null}
              onClick={() => void confirmDiscard()}
            >
              <span aria-hidden="true">⌫</span> {copy.discard}
            </button>
            <div className="purchase-payment-actions">
              <label className="purchase-payment">
                <span className="visually-hidden">{copy.context}</span>
                <select
                  value={settlementContext}
                  onChange={(event) =>
                    setSettlementContext(event.target.value as "cash" | "debt")
                  }
                >
                  <option value="cash">{copy.cash}</option>
                  <option value="debt">{copy.debt}</option>
                </select>
              </label>
              <button
                className="primary-button"
                type="submit"
                form="purchase-header-form"
                disabled={activeSuppliers.length === 0}
              >
                <span aria-hidden="true">▣</span>{" "}
                {activeDraft === null ? copy.createDraft : copy.saveHeader}
              </button>
            </div>
          </div>
        </footer>
      </div>
      {canManageSuppliers ? (
        <div id="purchase-suppliers-view" hidden={view !== "suppliers"}>
          <SuppliersWorkspace
            baseUrl={baseUrl}
            suppliers={suppliers}
            drafts={drafts}
            onChanged={reload}
          />
        </div>
      ) : null}
      <aside
        className="purchase-item-sidebar"
        aria-label={copy.itemDetails}
        hidden={view !== "invoice"}
      >
        <div className="purchase-item-empty">
          <span className="purchase-item-symbol" aria-hidden="true">
            <span />
          </span>
          <p>{copy.noSelectedItem}</p>
        </div>
      </aside>
      <dialog
        ref={registerRef}
        className="purchase-register-dialog"
        aria-labelledby="draft-list-title"
      >
        <button
          type="button"
          className="quiet-button purchase-register-close"
          onClick={() => registerRef.current?.close()}
        >
          {copy.close}
        </button>
        <section
          className="purchase-register"
          id="purchase-draft-register"
          aria-labelledby="draft-list-title"
        >
          <div className="purchase-register-heading">
            <div>
              <h2 id="draft-list-title" tabIndex={-1}>
                {copy.draftRegister}
              </h2>
              <p aria-live="polite">
                {filteredDrafts.length} {copy.results}
              </p>
            </div>
          </div>
          <div className="purchase-filters">
            <label className="purchase-search-filter">
              {copy.searchDrafts}
              <input
                type="search"
                placeholder={copy.searchDraftsHint}
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
            </label>
            <label>
              {copy.filterDate}
              <input
                type="date"
                value={draftDate}
                onChange={(event) => setDraftDate(event.target.value)}
              />
            </label>
            <label>
              {copy.filterContext}
              <select
                value={draftContext}
                onChange={(event) =>
                  setDraftContext(event.target.value as "all" | "cash" | "debt")
                }
              >
                <option value="all">{copy.allContexts}</option>
                <option value="cash">{copy.cash}</option>
                <option value="debt">{copy.debt}</option>
              </select>
            </label>
            <button
              className="quiet-button purchase-filter-clear"
              type="button"
              disabled={
                draftQuery === "" && draftDate === "" && draftContext === "all"
              }
              onClick={clearDraftFilters}
            >
              {copy.clearFilters}
            </button>
          </div>

          <div
            className="purchase-table-wrap"
            role="group"
            aria-label={copy.scrollDrafts}
            tabIndex={0}
          >
            <table className="purchase-draft-table">
              <caption className="visually-hidden">
                {copy.draftRegister}
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{copy.invoiceNumber}</th>
                  <th scope="col">{copy.supplier}</th>
                  <th scope="col">{copy.invoiceDate}</th>
                  <th scope="col">{copy.context}</th>
                  <th scope="col">{copy.snapshot}</th>
                  <th scope="col">{copy.version}</th>
                  <th scope="col">{copy.updatedAt}</th>
                  <th scope="col">{copy.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrafts.length === 0 ? (
                  <tr>
                    <td className="purchase-table-empty" colSpan={9}>
                      {drafts.length === 0
                        ? copy.noDrafts
                        : copy.noMatchingDrafts}
                    </td>
                  </tr>
                ) : (
                  filteredDrafts.map((draft, index) => (
                    <tr
                      key={draft.id}
                      data-selected={activeDraft?.id === draft.id}
                    >
                      <td>{index + 1}</td>
                      <th scope="row">
                        <bdi>{draft.supplierInvoiceNumber}</bdi>
                      </th>
                      <td>{draft.supplierNameSnapshot}</td>
                      <td>
                        <bdi>{draft.invoiceDate}</bdi>
                      </td>
                      <td>{copy[draft.settlementContext]}</td>
                      <td>{draft.allowanceSnapshot.percentage}%</td>
                      <td>{draft.version}</td>
                      <td>
                        <bdi>
                          {formatDraftTimestamp(draft.updatedAt, locale)}
                        </bdi>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="purchase-open-draft"
                          aria-current={
                            activeDraft?.id === draft.id ? "true" : undefined
                          }
                          onClick={() => void showDraft(draft)}
                        >
                          {copy.resume} {draft.supplierInvoiceNumber}
                          {activeDraft?.id === draft.id ? (
                            <span className="visually-hidden">
                              {" "}
                              · {copy.activeInvoice}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </dialog>
    </section>
  );
}

function formatDraftTimestamp(value: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
