import { useEffect, useRef, useState } from "react";
import type {
  PurchaseDraft,
  PurchaseDraftResult,
  Supplier,
} from "@breev/contracts/local-rest";
import { useIdentityState } from "./identity-state-provider";
import {
  archiveSupplier,
  createPurchaseDraft,
  createSupplier,
  discardPurchaseDraft,
  editSupplier,
  mergeSupplier,
  PurchasingApiDenied,
  purchasingCommandAttempt,
  requestPurchaseDrafts,
  requestSuppliers,
  updatePurchaseDraft,
  type PurchasingCommandAttempt,
} from "./purchasing-api";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";

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
  const [activeDraft, setActiveDraft] = useState<PurchaseDraft | null>(null);
  const [warning, setWarning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const invoiceRef = useRef<HTMLInputElement>(null);
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

  function showDraft(draft: PurchaseDraft): void {
    draftCommandAttempt.current = null;
    setActiveDraft(draft);
    setSupplierInvoiceNumber(draft.supplierInvoiceNumber);
    setSupplierId(draft.supplierId);
    setSettlementContext(draft.settlementContext);
    setInvoiceDate(draft.invoiceDate);
    setWarning(false);
    setError(null);
    setStatus(null);
    queueMicrotask(() => invoiceRef.current?.focus());
  }

  function newDraft(): void {
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
      setActiveDraft(result.draft);
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
    const heading = document.getElementById("draft-list-title");
    heading?.scrollIntoView({ block: "start" });
    heading?.focus();
  }

  return (
    <section
      className="purchasing-workspace"
      aria-labelledby="purchasing-title"
    >
      <header className="purchasing-heading">
        <div>
          <h1 id="purchasing-title">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <button className="primary-button" type="button" onClick={newDraft}>
          {copy.newDraft}
        </button>
      </header>
      {loading ? <p role="status">…</p> : null}
      <div className="purchase-view-tabs" aria-label={copy.title}>
        <button
          type="button"
          className="purchase-view-tab"
          onClick={() => invoiceRef.current?.focus()}
        >
          {copy.invoiceWorkspace}
        </button>
        <button
          type="button"
          className="purchase-view-tab"
          onClick={focusDraftRegister}
        >
          {copy.savedInvoices}
          <span className="purchase-tab-count">{drafts.length}</span>
        </button>
      </div>
      <div className="purchasing-grid">
        <aside className="purchase-draft-rail" aria-label={copy.activeInvoice}>
          <p className="purchase-context-label">{copy.activeInvoice}</p>
          {activeDraft === null ? (
            <div className="purchase-context-empty">
              <strong>{copy.noActiveInvoice}</strong>
              <span>{copy.noActiveInvoiceHint}</span>
            </div>
          ) : (
            <>
              <h2>{activeDraft.supplierNameSnapshot}</h2>
              <p className="purchase-context-number">
                <bdi>{activeDraft.supplierInvoiceNumber}</bdi>
              </p>
              <dl className="purchase-snapshot">
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
            </>
          )}
        </aside>

        <div className="purchase-main">
          <form
            className="purchase-header-form"
            data-purchase-editor
            onSubmit={(event) => void saveDraft(event)}
          >
            <fieldset>
              <legend>
                {activeDraft === null
                  ? copy.newDraft
                  : `${copy.drafts} · ${activeDraft.supplierInvoiceNumber}`}
              </legend>
              <div className="purchase-header-fields">
                <label>
                  {copy.invoiceNumber}
                  <input
                    ref={invoiceRef}
                    required
                    maxLength={120}
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
                <label>
                  {copy.context}
                  <select
                    value={settlementContext}
                    onChange={(event) =>
                      setSettlementContext(
                        event.target.value as "cash" | "debt",
                      )
                    }
                  >
                    <option value="cash">{copy.cash}</option>
                    <option value="debt">{copy.debt}</option>
                  </select>
                </label>
                <label>
                  {copy.invoiceDate}
                  <input
                    type="date"
                    required
                    value={invoiceDate}
                    onChange={(event) => setInvoiceDate(event.target.value)}
                  />
                </label>
              </div>
            </fieldset>
            {warning ? (
              <div
                className="purchase-warning"
                role="alert"
                aria-live="assertive"
              >
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
              <p className="form-success" role="status" aria-live="polite">
                {status}
              </p>
            )}
            <div className="purchase-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={activeSuppliers.length === 0}
              >
                {activeDraft === null ? copy.createDraft : copy.saveHeader}
              </button>
              {activeDraft === null ? null : (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void confirmDiscard()}
                >
                  {copy.discard}
                </button>
              )}
            </div>
            {activeSuppliers.length === 0 ? (
              <p role="status">{copy.noSuppliers}</p>
            ) : null}
          </form>
          {canManageSuppliers ? (
            <details className="purchase-supplier-drawer">
              <summary>{copy.manageSuppliers}</summary>
              <SupplierManager
                baseUrl={baseUrl}
                suppliers={suppliers}
                onChanged={reload}
              />
            </details>
          ) : null}
        </div>
      </div>

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
            <caption className="visually-hidden">{copy.draftRegister}</caption>
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
                      <bdi>{formatDraftTimestamp(draft.updatedAt, locale)}</bdi>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="purchase-open-draft"
                        aria-current={
                          activeDraft?.id === draft.id ? "true" : undefined
                        }
                        onClick={() => showDraft(draft)}
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
    </section>
  );
}

function formatDraftTimestamp(value: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function SupplierManager({
  baseUrl,
  suppliers,
  onChanged,
}: {
  readonly baseUrl: string;
  readonly suppliers: readonly Supplier[];
  readonly onChanged: () => Promise<void>;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [percentage, setPercentage] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [terms, setTerms] = useState("");
  const [survivorId, setSurvivorId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const supplierCommandAttempt = useRef<PurchasingCommandAttempt | null>(null);

  function choose(supplier: Supplier | null): void {
    supplierCommandAttempt.current = null;
    setSelected(supplier);
    setName(supplier?.name ?? "");
    setPercentage(supplier?.defaultAllowancePercentage ?? "0");
    setEffectiveFrom(supplier?.allowanceEffectiveFrom ?? today());
    setTerms(supplier?.terms ?? "");
    setSurvivorId("");
    setMessage(null);
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const fields = {
      allowanceEffectiveFrom: effectiveFrom,
      defaultAllowancePercentage: percentage,
      name,
      terms: terms.trim() === "" ? null : terms.trim(),
    };
    try {
      const attempt = purchasingCommandAttempt(
        supplierCommandAttempt.current,
        JSON.stringify({
          action: selected === null ? "create" : "edit",
          fields,
          supplierId: selected?.id,
          expectedRevision: selected?.revision,
        }),
      );
      supplierCommandAttempt.current = attempt;
      const saved =
        selected === null
          ? await createSupplier(baseUrl, {
              ...fields,
              idempotencyKey: attempt.idempotencyKey,
            })
          : await editSupplier(baseUrl, selected.id, {
              ...fields,
              expectedRevision: selected.revision,
              idempotencyKey: attempt.idempotencyKey,
            });
      choose(saved);
      setMessage(copy.supplierSaved);
      await onChanged();
    } catch {
      setMessage(copy.error);
    }
  }

  async function archive(): Promise<void> {
    if (selected === null || !window.confirm(copy.archiveSupplier)) return;
    try {
      const attempt = purchasingCommandAttempt(
        supplierCommandAttempt.current,
        JSON.stringify({
          action: "archive",
          supplierId: selected.id,
          expectedRevision: selected.revision,
        }),
      );
      supplierCommandAttempt.current = attempt;
      await archiveSupplier(baseUrl, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: attempt.idempotencyKey,
      });
      choose(null);
      setMessage(copy.supplierSaved);
      await onChanged();
    } catch {
      setMessage(copy.error);
    }
  }

  async function merge(): Promise<void> {
    if (selected === null || survivorId === "") return;
    try {
      const attempt = purchasingCommandAttempt(
        supplierCommandAttempt.current,
        JSON.stringify({
          action: "merge",
          supplierId: selected.id,
          expectedRevision: selected.revision,
          survivorSupplierId: survivorId,
        }),
      );
      supplierCommandAttempt.current = attempt;
      await mergeSupplier(baseUrl, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: attempt.idempotencyKey,
        survivorSupplierId: survivorId,
      });
      choose(null);
      setMessage(copy.supplierSaved);
      await onChanged();
    } catch {
      setMessage(copy.error);
    }
  }

  const active = suppliers.filter((supplier) => supplier.status === "active");
  return (
    <section className="supplier-manager" aria-labelledby="supplier-title">
      <div className="supplier-manager-heading">
        <h2 id="supplier-title">{copy.suppliers}</h2>
        <button
          className="quiet-button"
          type="button"
          onClick={() => choose(null)}
        >
          {copy.newSupplier}
        </button>
      </div>
      <div className="supplier-manager-grid">
        <ul className="supplier-list">
          {suppliers.map((supplier) => (
            <li key={supplier.id}>
              <button
                type="button"
                aria-pressed={selected?.id === supplier.id}
                onClick={() => choose(supplier)}
              >
                <strong>{supplier.name}</strong>
                <span>
                  {supplier.defaultAllowancePercentage}% ·{" "}
                  {copy[supplier.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <form className="supplier-form" onSubmit={(event) => void save(event)}>
          <label>
            {copy.supplierName}
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {copy.allowance}
            <input
              required
              inputMode="decimal"
              pattern="(?:100(?:\.0{1,6})?|(?:0|[1-9][0-9]?)(?:\.[0-9]{1,6})?)"
              value={percentage}
              onChange={(event) => setPercentage(event.target.value)}
            />
          </label>
          <label>
            {copy.effectiveFrom}
            <input
              required
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </label>
          <label>
            {copy.terms}
            <textarea
              maxLength={1000}
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
            />
          </label>
          <div className="purchase-actions">
            <button className="primary-button" type="submit">
              {selected === null ? copy.saveSupplier : copy.updateSupplier}
            </button>
            {selected?.status === "active" ? (
              <button
                className="danger-button"
                type="button"
                onClick={() => void archive()}
              >
                {copy.archiveSupplier}
              </button>
            ) : null}
          </div>
          {selected?.status === "active" && active.length > 1 ? (
            <div className="supplier-merge-row">
              <label>
                {copy.mergeInto}
                <select
                  value={survivorId}
                  onChange={(event) => setSurvivorId(event.target.value)}
                >
                  <option value="">{copy.select}</option>
                  {active
                    .filter((supplier) => supplier.id !== selected.id)
                    .map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="quiet-button"
                type="button"
                disabled={survivorId === ""}
                onClick={() => void merge()}
              >
                {copy.mergeSupplier}
              </button>
            </div>
          ) : null}
          {message === null ? null : (
            <p role="status" aria-live="polite">
              {message}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
