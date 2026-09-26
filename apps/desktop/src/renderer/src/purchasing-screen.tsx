import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PurchaseDraft,
  PurchaseDraftDetail,
  PurchaseDraftResult,
  PurchasePostResult,
  PurchasingDenial,
  Supplier,
} from "@breev/contracts/local-rest";
import {
  PurchaseItemPanel,
  type PurchaseItemSelection,
} from "./purchase-item-details";
import { PurchaseRowEntry } from "./purchase-row-entry";
import { formatFilsToIqd } from "./product-record";
import { useIdentityState } from "./identity-state-provider";
import {
  clearPendingPurchasePost,
  createPurchaseDraft,
  discardPurchaseDraft,
  postPurchase,
  PurchasingApiDenied,
  purchasingCommandAttempt,
  readPendingPurchasePost,
  rememberPurchasePost,
  requestPurchaseDrafts,
  requestPurchaseDraft,
  requestSuppliers,
  updatePurchaseDraft,
  type PurchasingCommandAttempt,
} from "./purchasing-api";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";
import { PostedPurchaseReview } from "./posted-purchase-review";
import { SuppliersWorkspace } from "./suppliers-workspace";
import { useCommittedFocus } from "./committed-focus";

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
  const canManageDrafts =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("purchases.drafts.manage");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [drafts, setDrafts] = useState<PurchaseDraft[]>([]);
  const [activeDraft, setActiveDraft] = useState<PurchaseDraftDetail | null>(
    null,
  );
  const [postedPurchase, setPostedPurchase] =
    useState<PurchasePostResult | null>(null);
  const [itemSelection, setItemSelection] =
    useState<PurchaseItemSelection | null>(null);
  const [postDenial, setPostDenial] = useState<PurchasingDenial | null>(null);
  const [posting, setPosting] = useState(false);
  const [warning, setWarning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  type PurchasingView = "invoice" | "drafts" | "posted" | "suppliers" | "idle";
  const [view, setView] = useState<PurchasingView>(() => {
    if (window.location.hash.startsWith("#/purchases/posted/")) {
      return "posted";
    }
    return !canManageDrafts ? "posted" : "invoice";
  });
  const invoiceRef = useRef<HTMLInputElement>(null);
  const discardDialogRef = useRef<HTMLDialogElement>(null);
  const supplierRef = useRef<HTMLInputElement>(null);
  const draftCommandAttempt = useRef<PurchasingCommandAttempt | null>(null);
  const postRecoveryStarted = useRef(false);
  const requestCommittedFocus = useCommittedFocus();
  const [discarding, setDiscarding] = useState(false);

  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [isSupplierOpen, setIsSupplierOpen] = useState(false);
  const [supplierSearchText, setSupplierSearchText] = useState("");
  const [highlightedSupplierIndex, setHighlightedSupplierIndex] = useState(-1);
  const supplierComboboxRef = useRef<HTMLDivElement>(null);
  const supplierOptionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [draftSaving, setDraftSaving] = useState(false);
  const draftSavingRef = useRef(false);
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
    if (!canManageDrafts) {
      setSuppliers([]);
      setDrafts([]);
      return;
    }
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
  }, [baseUrl, canManageDrafts, copy.error]);

  useEffect(() => {
    if (
      identity?.state === "authenticated" &&
      !canManageDrafts &&
      view !== "suppliers" &&
      view !== "idle"
    ) {
      setView("posted");
    }
  }, [canManageDrafts, identity?.state, view]);

  useEffect(() => {
    const handleHashChange = (): void => {
      if (window.location.hash.startsWith("#/purchases/posted/")) {
        setView("posted");
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (postRecoveryStarted.current) return;
    postRecoveryStarted.current = true;
    const pending = readPendingPurchasePost(purchasePostAddress());
    if (pending === null) return;
    void (async () => {
      try {
        const detail = await requestPurchaseDraft(baseUrl, pending.draftId);
        if (detail.status === "posted") {
          // The original request may have committed before its response was
          // lost. Replaying its key retrieves that exact stored receipt.
          await performPost(pending);
          return;
        }
        if (detail.status !== "active") {
          clearPendingPurchasePost(purchasePostAddress());
          return;
        }
        setActiveDraft(detail);
        setSupplierInvoiceNumber(detail.supplierInvoiceNumber);
        setSupplierId(detail.supplierId);
        setSettlementContext(detail.settlementContext);
        setInvoiceDate(detail.invoiceDate);
        if (detail.version !== pending.expectedVersion) {
          clearPendingPurchasePost(purchasePostAddress());
          setPostDenial({
            code: "version-conflict",
            fieldErrors: [],
            requestId: crypto.randomUUID(),
            status: "denied",
          });
          return;
        }
        if (detail.rows.length === 0) {
          clearPendingPurchasePost(purchasePostAddress());
          return;
        }
        await performPost(pending);
      } catch {
        clearPendingPurchasePost(purchasePostAddress());
      }
    })();
  }, [baseUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isInsideEditor =
        target instanceof HTMLElement &&
        target.closest("[data-purchase-editor]") !== null;
      if (event.key === "Escape" && activeDraft !== null && isInsideEditor) {
        event.preventDefault();
        promptDiscard();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function showDraft(draft: PurchaseDraft): Promise<void> {
    setView("invoice");
    clearPendingPurchasePost(purchasePostAddress());

    draftCommandAttempt.current = null;
    try {
      const detail = await requestPurchaseDraft(baseUrl, draft.id);
      setActiveDraft(detail);
      setSupplierInvoiceNumber(detail.supplierInvoiceNumber);
      setSupplierId(detail.supplierId);
      setSupplierSearchText(detail.supplierNameSnapshot);
      setSettlementContext(detail.settlementContext);
      setInvoiceDate(detail.invoiceDate);
      setWarning(false);
      setPostedPurchase(null);
      setPostDenial(null);
      setError(null);
      setStatus(null);
      queueMicrotask(() => invoiceRef.current?.focus());
    } catch {
      setError(copy.error);
    }
  }

  function newDraft(): void {
    setView("invoice");
    resetDraftFields();
    setPostedPurchase(null);
    requestAnimationFrame(() => invoiceRef.current?.focus());
  }

  function resetDraftFields(): void {
    clearPendingPurchasePost(purchasePostAddress());
    draftCommandAttempt.current = null;
    setActiveDraft(null);
    setSupplierInvoiceNumber("");
    setSupplierId("");
    setSupplierSearchText("");
    setIsSupplierOpen(false);
    setHighlightedSupplierIndex(-1);
    setSettlementContext("cash");
    setInvoiceDate(today());
    setWarning(false);
    setPostDenial(null);
    setError(null);
    setStatus(null);
  }

  async function requestPost(): Promise<void> {
    if (activeDraft === null || posting || activeDraft.rows.length === 0)
      return;
    const attempt = rememberPurchasePost(
      purchasePostAddress(),
      activeDraft.id,
      activeDraft.version,
    );
    await performPost(attempt);
  }

  async function performPost(attempt: {
    readonly draftId: string;
    readonly expectedVersion: string;
    readonly idempotencyKey: string;
  }): Promise<void> {
    setPosting(true);
    setPostDenial(null);
    setError(null);
    setStatus(null);
    try {
      const result = await postPurchase(baseUrl, attempt.draftId, {
        expectedVersion: attempt.expectedVersion,
        idempotencyKey: attempt.idempotencyKey,
      });
      clearPendingPurchasePost(purchasePostAddress());
      resetDraftFields();
      setPostedPurchase(result);
      void reload().catch(() => setError(copy.error));
    } catch (caught) {
      if (caught instanceof PurchasingApiDenied) {
        clearPendingPurchasePost(purchasePostAddress());
        setPostDenial(caught.denial);
        if (caught.denial.code === "version-conflict") {
          try {
            const latest = await requestPurchaseDraft(baseUrl, attempt.draftId);
            setActiveDraft(latest);
            setSupplierInvoiceNumber(latest.supplierInvoiceNumber);
            setSupplierId(latest.supplierId);
            setSettlementContext(latest.settlementContext);
            setInvoiceDate(latest.invoiceDate);
            setDrafts((current) =>
              current.map((draft) => (draft.id === latest.id ? latest : draft)),
            );
          } catch {
            // Keep existing draft in place if fetch fails
          }
        }
      } else {
        setError(copy.postRetryPending);
      }
    } finally {
      setPosting(false);
    }
  }

  async function saveDraft(
    event?: React.FormEvent,
    overrides?: {
      invoiceDate?: string;
      settlementContext?: "cash" | "debt";
      supplierId?: string;
      supplierInvoiceNumber?: string;
    },
  ): Promise<PurchaseDraftDetail | null> {
    if (event !== undefined) event.preventDefault();
    if (draftSavingRef.current) return null;
    setError(null);
    setStatus(null);

    const effectiveInvoiceNumber = (
      overrides?.supplierInvoiceNumber ?? supplierInvoiceNumber
    ).trim();
    const effectiveSupplierId = overrides?.supplierId ?? supplierId;
    const effectiveInvoiceDate = overrides?.invoiceDate ?? invoiceDate;
    const effectiveSettlementContext =
      overrides?.settlementContext ?? settlementContext;

    if (effectiveInvoiceNumber === "") {
      setError(copy.invoiceNumberRequired);
      invoiceRef.current?.focus();
      return null;
    }
    if (effectiveSupplierId === "") {
      setError(copy.supplierRequired);
      supplierRef.current?.focus();
      return null;
    }
    const isNewDraft = activeDraft === null;
    let focusSupplierAfterFailure = false;
    draftSavingRef.current = true;
    setDraftSaving(true);
    try {
      const header = {
        invoiceDate: effectiveInvoiceDate,
        settlementContext: effectiveSettlementContext,
        supplierId: effectiveSupplierId,
        supplierInvoiceNumber: effectiveInvoiceNumber,
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
      clearPendingPurchasePost(purchasePostAddress());
      setPostDenial(null);
      setWarning(result.warnings.length > 0);
      setStatus(copy.saved);
      if (isNewDraft) {
        requestCommittedFocus(() =>
          document.querySelector<HTMLInputElement>(
            'input[data-enter-field="item"]',
          ),
        );
      }
      await reload();
      return detail;
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
        focusSupplierAfterFailure = true;
      }
      return null;
    } finally {
      draftSavingRef.current = false;
      setDraftSaving(false);
      if (focusSupplierAfterFailure) {
        requestCommittedFocus(() => supplierRef.current);
      }
    }
  }

  function promptDiscard(): void {
    if (activeDraft === null || discarding) return;
    discardDialogRef.current?.showModal();
  }

  function closeDiscardDialog(): void {
    discardDialogRef.current?.close();
  }

  async function executeDiscard(): Promise<void> {
    if (activeDraft === null || discarding) return;
    closeDiscardDialog();
    setDiscarding(true);
    clearPendingPurchasePost(purchasePostAddress());
    setPostDenial(null);
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
      resetDraftFields();
      setStatus(copy.discarded);
      await reload();
    } catch {
      setError(copy.error);
    } finally {
      draftCommandAttempt.current = null;
      setDiscarding(false);
      requestAnimationFrame(() => {
        invoiceRef.current?.focus();
      });
    }
  }

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.status === "active"),
    [suppliers],
  );
  const currentInactiveSupplier = useMemo(
    () =>
      suppliers.find(
        (supplier) =>
          supplier.id === activeDraft?.supplierId &&
          supplier.status !== "active",
      ),
    [suppliers, activeDraft?.supplierId],
  );
  const headerSuppliers = useMemo(
    () =>
      currentInactiveSupplier === undefined
        ? activeSuppliers
        : [...activeSuppliers, currentInactiveSupplier],
    [activeSuppliers, currentInactiveSupplier],
  );

  useEffect(() => {
    if (supplierId !== "") {
      const found = headerSuppliers.find((s) => s.id === supplierId);
      if (found) {
        setSupplierSearchText(found.name);
      }
    }
  }, [supplierId, headerSuppliers]);

  useEffect(() => {
    if (!isSupplierOpen) return;

    function handlePointerDown(event: PointerEvent): void {
      if (
        supplierComboboxRef.current &&
        !supplierComboboxRef.current.contains(event.target as Node)
      ) {
        setIsSupplierOpen(false);
        const current = headerSuppliers.find((s) => s.id === supplierId);
        setSupplierSearchText(current?.name ?? "");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isSupplierOpen, headerSuppliers, supplierId]);

  useEffect(() => {
    if (
      isSupplierOpen &&
      highlightedSupplierIndex >= 0 &&
      supplierOptionRefs.current[highlightedSupplierIndex]
    ) {
      supplierOptionRefs.current[highlightedSupplierIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [isSupplierOpen, highlightedSupplierIndex]);

  const searchWords = useMemo(
    () =>
      supplierSearchText
        .trim()
        .toLocaleLowerCase(locale)
        .split(/\s+/)
        .filter(Boolean),
    [supplierSearchText, locale],
  );

  const currentSelectedSupplier = useMemo(
    () => headerSuppliers.find((s) => s.id === supplierId),
    [headerSuppliers, supplierId],
  );

  const filteredSuppliers = useMemo(() => {
    return headerSuppliers.filter((supplier) => {
      if (searchWords.length === 0) return true;
      if (
        currentSelectedSupplier &&
        supplierSearchText.trim().toLocaleLowerCase(locale) ===
          currentSelectedSupplier.name.trim().toLocaleLowerCase(locale)
      ) {
        return true;
      }
      const nameLower = supplier.name.toLocaleLowerCase(locale);
      return searchWords.every((word) => nameLower.includes(word));
    });
  }, [
    headerSuppliers,
    searchWords,
    currentSelectedSupplier,
    supplierSearchText,
    locale,
  ]);

  function chooseSupplier(chosen: Supplier): void {
    setSupplierId(chosen.id);
    setSupplierSearchText(chosen.name);
    setIsSupplierOpen(false);
    setHighlightedSupplierIndex(-1);
    if (error !== null) setError(null);

    if (supplierInvoiceNumber.trim() !== "") {
      void saveDraft(undefined, {
        supplierId: chosen.id,
      });
    } else {
      setError(copy.invoiceNumberRequired);
      requestAnimationFrame(() => {
        invoiceRef.current?.focus();
      });
    }
  }

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
    setView("drafts");
    queueMicrotask(() => {
      const heading = document.getElementById("draft-list-title");
      heading?.scrollIntoView({ block: "start" });
      heading?.focus();
    });
  }

  const activeIndex = drafts.findIndex((draft) => draft.id === activeDraft?.id);
  // const canUseOcr =
  //   identity?.state === "authenticated" &&
  //   identity.entitlement.capabilities.includes("purchase-invoice-ocr");
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
        {canManageDrafts ? (
          <button
            type="button"
            className="purchase-view-tab"
            aria-pressed={view === "invoice"}
            aria-controls="purchase-invoice-view"
            onClick={() => setView("invoice")}
          >
            <span aria-hidden="true">🧾</span> {copy.invoiceWorkspace}
          </button>
        ) : null}
        {canManageDrafts ? (
          <button
            type="button"
            className="purchase-view-tab"
            aria-pressed={view === "drafts"}
            aria-controls="purchase-drafts-view"
            onClick={focusDraftRegister}
          >
            <span aria-hidden="true">📂</span> {copy.savedInvoices}
          </button>
        ) : null}
        <button
          type="button"
          className="purchase-view-tab"
          aria-pressed={view === "posted"}
          aria-controls="purchase-posted-view"
          onClick={() => setView("posted")}
        >
          <span aria-hidden="true">🔍</span> {copy.postedInvoices}
        </button>
        {/* Purchase Return workflow is accessed via Posted Invoices (Milestone 2) */}
        {/* {canManageDrafts ? (
          <button
            type="button"
            className="purchase-view-tab"
            disabled
            title={copy.unavailable}
          >
            <span aria-hidden="true">↩</span> {copy.returnInvoice}
          </button>
        ) : null} */}
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
        {/* Document adjustments and returns are accessed via Posted Invoices; print is Milestone 3/4 */}
        {/* {canManageDrafts && view === "invoice" ? (
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
        ) : null} */}
      </div>
      {!canManageDrafts ? <p role="status">{copy.postedReviewOnly}</p> : null}
      <div
        id="purchase-invoice-view"
        data-purchase-editor
        hidden={!canManageDrafts || view !== "invoice"}
      >
        <form
          id="purchase-header-form"
          className="purchase-header-form"
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      invoiceRef.current?.focus();
                    }
                  }}
                />
              </label>
              <label>
                {copy.invoiceNumber}
                <input
                  ref={invoiceRef}
                  required
                  disabled={draftSaving}
                  maxLength={120}
                  placeholder={copy.invoiceNumberHint}
                  value={supplierInvoiceNumber}
                  onChange={(event) => {
                    setSupplierInvoiceNumber(event.target.value);
                    if (error !== null) setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const trimmedNumber = supplierInvoiceNumber.trim();
                      if (trimmedNumber === "") {
                        setError(copy.invoiceNumberRequired);
                        return;
                      }
                      setError(null);
                      if (supplierId !== "") {
                        void saveDraft(undefined, {
                          supplierInvoiceNumber: trimmedNumber,
                        });
                      } else {
                        supplierRef.current?.focus();
                      }
                    }
                  }}
                />
              </label>
              <label>
                <span className="purchase-supplier-label-row">
                  <span>{copy.supplier}</span>
                  {draftSaving ? (
                    <span
                      className="status-spinner purchase-supplier-spinner"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                <div
                  ref={supplierComboboxRef}
                  className="purchase-supplier-combobox"
                >
                  <div className="purchase-supplier-control">
                    <input
                      ref={supplierRef}
                      type="text"
                      role="combobox"
                      aria-expanded={isSupplierOpen}
                      aria-haspopup="listbox"
                      aria-controls="purchase-supplier-listbox"
                      aria-autocomplete="list"
                      aria-label={copy.supplier}
                      aria-activedescendant={
                        highlightedSupplierIndex >= 0 &&
                        filteredSuppliers[highlightedSupplierIndex]
                          ? `purchase-supplier-opt-${filteredSuppliers[highlightedSupplierIndex]!.id}`
                          : undefined
                      }
                      required
                      disabled={draftSaving}
                      className="purchase-supplier-search-input"
                      placeholder={copy.select}
                      value={supplierSearchText}
                      onFocus={(event) => {
                        setIsSupplierOpen(true);
                        const currentIndex = filteredSuppliers.findIndex(
                          (s) => s.id === supplierId,
                        );
                        setHighlightedSupplierIndex(
                          currentIndex >= 0 ? currentIndex : 0,
                        );
                        event.target.select();
                      }}
                      onClick={() => {
                        if (!isSupplierOpen) {
                          setIsSupplierOpen(true);
                          const currentIndex = filteredSuppliers.findIndex(
                            (s) => s.id === supplierId,
                          );
                          setHighlightedSupplierIndex(
                            currentIndex >= 0 ? currentIndex : 0,
                          );
                        }
                      }}
                      onChange={(event) => {
                        setSupplierSearchText(event.target.value);
                        if (!isSupplierOpen) setIsSupplierOpen(true);
                        setHighlightedSupplierIndex(0);
                        if (error !== null) setError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          if (!isSupplierOpen) {
                            setIsSupplierOpen(true);
                            const currentIndex = filteredSuppliers.findIndex(
                              (s) => s.id === supplierId,
                            );
                            setHighlightedSupplierIndex(
                              currentIndex >= 0 ? currentIndex : 0,
                            );
                          } else {
                            setHighlightedSupplierIndex((prev) =>
                              prev < filteredSuppliers.length - 1
                                ? prev + 1
                                : 0,
                            );
                          }
                          return;
                        }
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          if (!isSupplierOpen) {
                            setIsSupplierOpen(true);
                            setHighlightedSupplierIndex(
                              filteredSuppliers.length - 1,
                            );
                          } else {
                            setHighlightedSupplierIndex((prev) =>
                              prev > 0
                                ? prev - 1
                                : filteredSuppliers.length - 1,
                            );
                          }
                          return;
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (
                            isSupplierOpen &&
                            highlightedSupplierIndex >= 0 &&
                            highlightedSupplierIndex < filteredSuppliers.length
                          ) {
                            const chosen =
                              filteredSuppliers[highlightedSupplierIndex];
                            if (chosen) {
                              chooseSupplier(chosen);
                              return;
                            }
                          }
                          if (
                            isSupplierOpen &&
                            filteredSuppliers.length === 1
                          ) {
                            const chosen = filteredSuppliers[0];
                            if (chosen) {
                              chooseSupplier(chosen);
                              return;
                            }
                          }
                          if (supplierId !== "") {
                            const current = headerSuppliers.find(
                              (s) => s.id === supplierId,
                            );
                            if (current) {
                              chooseSupplier(current);
                              return;
                            }
                          }
                          if (supplierInvoiceNumber.trim() === "") {
                            setError(copy.invoiceNumberRequired);
                            invoiceRef.current?.focus();
                          } else {
                            setError(copy.supplierRequired);
                          }
                          return;
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setIsSupplierOpen(false);
                          const current = headerSuppliers.find(
                            (s) => s.id === supplierId,
                          );
                          setSupplierSearchText(current?.name ?? "");
                          return;
                        }
                        if (event.key === "Tab") {
                          setIsSupplierOpen(false);
                          const current = headerSuppliers.find(
                            (s) => s.id === supplierId,
                          );
                          setSupplierSearchText(current?.name ?? "");
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="purchase-supplier-toggle"
                      tabIndex={-1}
                      aria-label={copy.select}
                      onClick={() => {
                        setIsSupplierOpen((prev) => {
                          const next = !prev;
                          if (next) {
                            supplierRef.current?.focus();
                            const currentIndex = filteredSuppliers.findIndex(
                              (s) => s.id === supplierId,
                            );
                            setHighlightedSupplierIndex(
                              currentIndex >= 0 ? currentIndex : 0,
                            );
                          }
                          return next;
                        });
                      }}
                    >
                      <span aria-hidden="true">▾</span>
                    </button>
                  </div>
                  {isSupplierOpen ? (
                    <div className="purchase-supplier-dropdown">
                      <ul
                        id="purchase-supplier-listbox"
                        className="purchase-supplier-menu"
                        role="listbox"
                        aria-label={copy.supplier}
                      >
                        {filteredSuppliers.length === 0 ? (
                          <li
                            className="purchase-supplier-empty"
                            role="presentation"
                          >
                            {copy.noMatchingSuppliers}
                          </li>
                        ) : (
                          filteredSuppliers.map((supplier, idx) => {
                            const isHighlighted =
                              idx === highlightedSupplierIndex;
                            const isSelected = supplier.id === supplierId;
                            return (
                              <li
                                key={supplier.id}
                                id={`purchase-supplier-opt-${supplier.id}`}
                                ref={(el) => {
                                  supplierOptionRefs.current[idx] = el;
                                }}
                                role="option"
                                data-supplier-id={supplier.id}
                                aria-selected={isSelected}
                                className={`purchase-supplier-option ${
                                  isHighlighted ? "is-highlighted" : ""
                                }`}
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                }}
                                onClick={() => {
                                  chooseSupplier(supplier);
                                }}
                                onMouseEnter={() => {
                                  setHighlightedSupplierIndex(idx);
                                }}
                              >
                                <span className="purchase-supplier-option-name">
                                  {supplier.name}
                                </span>
                                {supplier.status !== "active" ? (
                                  <span className="purchase-supplier-option-status">
                                    {copy[supplier.status]}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <span className="visually-hidden" aria-live="polite">
                  {draftSaving ? copy.creatingDraft : ""}
                </span>
              </label>
              {activeDraft === null ? (
                <div className="purchase-header-actions">
                  <button
                    type="submit"
                    className="primary-button purchase-header-submit"
                    disabled={activeSuppliers.length === 0 || draftSaving}
                    title={copy.startItemEntry}
                  >
                    <span aria-hidden="true">↵</span> {copy.startItemEntry}
                  </button>
                </div>
              ) : null}
              {/* Supplier live debt belongs to Milestone 3 accounting */}
              {/* <div className="purchase-header-value">
                <span>{copy.supplierDebt}</span>
                <output aria-label={copy.supplierDebt} title={copy.unavailable}>
                  — {copy.iqd}
                </output>
              </div> */}
              {/* Item search is handled in-table via PurchaseRowEntry (Milestone 2) */}
              {/* <label className="purchase-item-search">
                {copy.itemSearch}
                <input
                  type="search"
                  disabled
                  placeholder={copy.itemSearchHint}
                  aria-describedby="purchase-lines-state"
                />
              </label> */}
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

        <PurchaseItemPanel
          hidden={!canManageDrafts || view !== "invoice"}
          selection={itemSelection}
        />

        {postedPurchase !== null ? (
          <PostedPurchaseResult
            result={postedPurchase}
            onContinue={() => {
              setPostedPurchase(null);
              setStatus(null);
              queueMicrotask(() => invoiceRef.current?.focus());
            }}
          />
        ) : (
          <>
            {activeDraft === null ? (
              <div
                className="purchase-lines-wrap"
                role="group"
                aria-label={copy.scrollLines}
                tabIndex={0}
              >
                <table className="purchase-lines-table">
                  <caption className="visually-hidden">
                    {copy.invoiceItems}
                  </caption>
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
                        <p id="purchase-lines-state">{copy.headerPrompt}</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <PurchaseRowEntry
                baseUrl={baseUrl}
                draft={activeDraft}
                onPost={requestPost}
                postDenial={postDenial}
                posting={posting}
                onItemSelectionChanged={setItemSelection}
                onDraftChanged={(nextDraft) => {
                  clearPendingPurchasePost(purchasePostAddress());
                  setPostDenial(null);
                  setActiveDraft(nextDraft);
                  setDrafts((current) =>
                    current.map((draft) =>
                      draft.id === nextDraft.id ? nextDraft : draft,
                    ),
                  );
                }}
              />
            )}

            <footer className="purchase-footer">
              {activeDraft === null ? null : (
                <dl
                  className="purchase-snapshot"
                  aria-label={copy.activeInvoice}
                >
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
                    if (activeIndex < drafts.length - 1) {
                      void showDraft(drafts[activeIndex + 1]!);
                    }
                  }}
                >
                  <span aria-hidden="true">◀</span> {copy.previous}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  disabled={activeIndex <= 0}
                  onClick={() => {
                    if (activeIndex > 0) {
                      void showDraft(drafts[activeIndex - 1]!);
                    }
                  }}
                >
                  {copy.next} <span aria-hidden="true">▶</span>
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={focusDraftRegister}
                >
                  <span aria-hidden="true">🔍</span> {copy.searchDrafts}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => setView("posted")}
                >
                  <span aria-hidden="true">🧾</span> {copy.postedInvoices}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={newDraft}
                >
                  <span aria-hidden="true">＋</span> {copy.newDraft}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={activeDraft === null || discarding}
                  onClick={promptDiscard}
                >
                  <span aria-hidden="true">⌫</span> {copy.discard}
                </button>
                <div className="purchase-payment-actions">
                  <label className="purchase-payment">
                    <span className="visually-hidden">{copy.context}</span>
                    <select
                      value={settlementContext}
                      onChange={(event) => {
                        clearPendingPurchasePost(purchasePostAddress());
                        setPostDenial(null);
                        setSettlementContext(
                          event.target.value as "cash" | "debt",
                        );
                      }}
                    >
                      <option value="cash">{copy.cash}</option>
                      <option value="debt">{copy.debt}</option>
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    type="submit"
                    form="purchase-header-form"
                    disabled={activeSuppliers.length === 0 || draftSaving}
                  >
                    <span aria-hidden="true">▣</span>{" "}
                    {activeDraft === null ? copy.createDraft : copy.saveHeader}
                  </button>
                </div>
              </div>
            </footer>
          </>
        )}
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
      {canManageDrafts ? (
        <div id="purchase-drafts-view" hidden={view !== "drafts"}>
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
              </div>
              <button
                type="button"
                className="quiet-button"
                onClick={() => setView("invoice")}
              >
                {copy.close}
              </button>
            </div>
            <div className="purchase-filters">
              <div className="purchase-draft-toolbar-top">
                <label className="purchase-search-filter purchase-draft-search-wrap">
                  <span className="visually-hidden">{copy.searchDrafts}</span>
                  <input
                    type="search"
                    aria-label={copy.searchDrafts}
                    placeholder={copy.searchDraftsHint}
                    value={draftQuery}
                    onChange={(event) => setDraftQuery(event.target.value)}
                  />
                </label>
                <div className="purchase-draft-filter-controls">
                  <label>
                    <span>{copy.filterDate}</span>
                    <input
                      type="date"
                      value={draftDate}
                      onChange={(event) => setDraftDate(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>{copy.filterContext}</span>
                    <select
                      value={draftContext}
                      onChange={(event) =>
                        setDraftContext(
                          event.target.value as "all" | "cash" | "debt",
                        )
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
                      draftQuery === "" &&
                      draftDate === "" &&
                      draftContext === "all"
                    }
                    onClick={clearDraftFilters}
                  >
                    {copy.clearFilters}
                  </button>
                </div>
              </div>

              <div className="purchase-draft-status-strip">
                <div className="purchase-table-count-badge">
                  <span aria-hidden="true">📂</span>
                  <span>
                    {filteredDrafts.length} {copy.draftCountUnit}
                  </span>
                </div>
                <div className="purchase-table-hint">
                  <span aria-hidden="true">💡</span>
                  <span>{copy.doubleClickDraftHint}</span>
                </div>
              </div>
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
                    <th scope="col">{copy.invoiceType}</th>
                    <th scope="col">{copy.supplierDocketNumber}</th>
                    <th scope="col">{copy.supplier}</th>
                    <th scope="col">{copy.invoiceDate}</th>
                    <th scope="col">{copy.paymentTerms}</th>
                    <th scope="col">{copy.discountPercentage}</th>
                    <th scope="col">{copy.settlementStatus}</th>
                    <th scope="col">{copy.version}</th>
                    <th scope="col">{copy.updatedAt}</th>
                    <th scope="col">{copy.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrafts.length === 0 ? (
                    <tr>
                      <td className="purchase-table-empty" colSpan={11}>
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
                        tabIndex={0}
                        onDoubleClick={() => void showDraft(draft)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            if (
                              (event.target as HTMLElement).tagName !== "BUTTON"
                            ) {
                              event.preventDefault();
                              void showDraft(draft);
                            }
                          }
                        }}
                      >
                        <th scope="row">
                          <bdi>{index + 1}</bdi>
                        </th>
                        <td>
                          <span className="purchase-badge purchase-badge-type-purchase">
                            {copy.typePurchase}
                          </span>
                        </td>
                        <td>
                          <bdi className="font-mono">
                            {draft.supplierInvoiceNumber}
                          </bdi>
                        </td>
                        <td>{draft.supplierNameSnapshot}</td>
                        <td>
                          <bdi>{draft.invoiceDate}</bdi>
                        </td>
                        <td>
                          <span className="purchase-terms-text">
                            {copy[draft.settlementContext]}
                          </span>
                        </td>
                        <td>
                          <bdi>{draft.allowanceSnapshot.percentage}%</bdi>
                        </td>
                        <td>
                          {draft.settlementContext === "cash" ? (
                            <span className="purchase-badge purchase-badge-settled">
                              {copy.draftBadge} · {copy.cash}
                            </span>
                          ) : (
                            <span className="purchase-badge purchase-badge-unpaid">
                              {copy.draftBadge} · {copy.debt}
                            </span>
                          )}
                        </td>
                        <td>
                          <bdi>{draft.version}</bdi>
                        </td>
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
                            onClick={(event) => {
                              event.stopPropagation();
                              void showDraft(draft);
                            }}
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
        </div>
      ) : null}
      <div id="purchase-posted-view" hidden={view !== "posted"}>
        <PostedPurchaseReview
          baseUrl={baseUrl}
          inline={true}
          open={view === "posted"}
          onClose={() => {
            setView(canManageDrafts ? "invoice" : "idle");
            requestCommittedFocus(() =>
              document.querySelector<HTMLButtonElement>(
                'button.purchase-view-tab[aria-controls="purchase-posted-view"]',
              ),
            );
          }}
        />
      </div>
      <dialog
        ref={discardDialogRef}
        className="purchase-discard-dialog"
        aria-labelledby="discard-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDiscardDialog();
        }}
      >
        <section className="purchase-discard-card">
          <h2 id="discard-dialog-title">{copy.discard}</h2>
          <p>{copy.confirmDiscard}</p>
          <div className="purchase-discard-actions">
            <button
              type="button"
              className="quiet-button"
              onClick={closeDiscardDialog}
            >
              {copy.close}
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={discarding}
              onClick={() => void executeDiscard()}
            >
              {copy.discard}
            </button>
          </div>
        </section>
      </dialog>
    </section>
  );
}

function formatAccountName(accountCode: string, locale: "ar" | "en"): string {
  const copy = purchasingMessages[locale];
  switch (accountCode) {
    case "cash":
      return copy.accountCash;
    case "inventory":
      return copy.accountInventory;
    case "supplier-payable":
      return copy.accountSupplierPayable;
    case "inventory-count-variance":
      return copy.accountInventoryCountVariance;
    default:
      return accountCode;
  }
}

function PostedPurchaseResult({
  result,
  onContinue,
}: {
  readonly result: PurchasePostResult;
  readonly onContinue: () => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const { posted } = result;
  const settlementAmount =
    posted.settlementEffect.context === "cash"
      ? posted.settlementEffect.tenderFils
      : posted.settlementEffect.payableFils;
  return (
    <section
      className="posted-purchase-result"
      aria-labelledby="posted-purchase-title"
    >
      <header className="posted-purchase-heading">
        <div>
          <p className="purchase-context-label">{copy.postedSuccess}</p>
          <h2 id="posted-purchase-title">{copy.postedPurchase}</h2>
          <p>
            {posted.supplierNameSnapshot} · {copy.supplierInvoice}{" "}
            <bdi>{posted.supplierInvoiceNumber}</bdi>
          </p>
        </div>
        <button className="primary-button" type="button" onClick={onContinue}>
          {copy.dismissPosted}
        </button>
      </header>

      <div className="posted-purchase-number" aria-label={copy.documentNumber}>
        <strong>{copy.documentNumber}</strong>
        <dl>
          <div>
            <dt>{copy.documentSeries}</dt>
            <dd>{posted.number.series}</dd>
          </div>
          <div>
            <dt>{copy.documentSequence}</dt>
            <dd>
              <bdi>{posted.number.value}</bdi>
            </dd>
          </div>
          <div>
            <dt>{copy.documentYear}</dt>
            <dd>
              <bdi>{posted.number.year}</bdi>
            </dd>
          </div>
          <div>
            <dt>{copy.postedAt}</dt>
            <dd>
              <bdi>{formatDraftTimestamp(posted.postedAt, locale)}</bdi>
            </dd>
          </div>
        </dl>
      </div>

      {result.warnings.length === 0 ? null : (
        <div className="purchase-warning" role="status">
          <strong>{copy.duplicatePostWarning}</strong>
          <span>
            {result.warnings
              .flatMap((warning) => warning.existingPostingIds)
              .map((id) => (
                <bdi key={id}>{id}</bdi>
              ))}
          </span>
        </div>
      )}

      <dl className="posted-purchase-totals">
        <div>
          <dt>{copy.primarySupplierCost}</dt>
          <dd>
            <bdi>{formatFilsToIqd(posted.primarySupplierCostFils, locale)}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.allowanceAmount}</dt>
          <dd>
            <bdi>{formatFilsToIqd(posted.allowanceFils, locale)}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.costAfterDiscount}</dt>
          <dd>
            <bdi>{formatFilsToIqd(posted.costAfterDiscountFils, locale)}</bdi>
          </dd>
        </div>
        <div>
          <dt>
            {posted.settlementEffect.context === "cash"
              ? copy.tenderEffect
              : copy.payableEffect}
          </dt>
          <dd>
            <bdi>{formatFilsToIqd(settlementAmount, locale)}</bdi>
          </dd>
        </div>
      </dl>

      <div
        className="posted-purchase-table-wrap"
        role="group"
        aria-label={copy.postedRows}
        tabIndex={0}
      >
        <h3>{copy.postedRows}</h3>
        <table className="posted-purchase-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{copy.itemBarcode}</th>
              <th scope="col">{copy.quantity}</th>
              <th scope="col">{copy.primarySupplierCost}</th>
              <th scope="col">{copy.costAfterDiscount}</th>
              <th scope="col">{copy.retail}</th>
              <th scope="col">{copy.expiry}</th>
              <th scope="col">{copy.lot}</th>
            </tr>
          </thead>
          <tbody>
            {posted.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.ordinal}</th>
                <td>{row.itemDisplayName}</td>
                <td>
                  <bdi>{row.inventoryUnitQuantity}</bdi> {row.inventoryUnitName}
                </td>
                <td>
                  <bdi>
                    {formatFilsToIqd(row.linePrimarySupplierCostFils, locale)}
                  </bdi>
                </td>
                <td>
                  <bdi>
                    {formatFilsToIqd(row.costAfterDiscountFils, locale)}
                  </bdi>
                </td>
                <td>
                  <bdi>{formatFilsToIqd(row.retailPriceFils, locale)}</bdi>
                </td>
                <td>
                  <bdi>{row.expiryDate ?? "—"}</bdi>
                </td>
                <td>
                  <bdi>{row.lotNumber ?? "—"}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="posted-purchase-audit-details">
        <summary>{copy.accountingAuditDetails}</summary>
        <div
          className="posted-purchase-table-wrap"
          role="group"
          aria-label={copy.journal}
          tabIndex={0}
        >
          <table className="posted-purchase-table posted-purchase-journal">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{copy.account}</th>
                <th scope="col">{copy.debit}</th>
                <th scope="col">{copy.credit}</th>
              </tr>
            </thead>
            <tbody>
              {posted.journal.lines.map((line) => (
                <tr key={line.ordinal}>
                  <th scope="row">{line.ordinal}</th>
                  <td>
                    <bdi>{formatAccountName(line.accountCode, locale)}</bdi>
                  </td>
                  <td>
                    <bdi>{formatFilsToIqd(line.debitFils, locale)}</bdi>
                  </td>
                  <td>
                    <bdi>{formatFilsToIqd(line.creditFils, locale)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function purchasePostAddress(): {
  readonly hash: string;
  replace(hash: string): void;
} {
  return {
    get hash() {
      return window.location.hash;
    },
    replace(hash) {
      window.history.replaceState(null, "", hash);
    },
  };
}

function formatDraftTimestamp(value: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
