import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PostedAdjustmentView,
  PostedReturnView,
  PostedPurchaseSnapshot,
  formatNumber,
  formatAdjustmentNumber,
  formatReturnNumber,
  formatTimestamp,
} from "./posted-purchase-snapshots";
import type {
  PostedPurchaseAdjustment,
  PostedPurchaseReturn,
  Product,
  PurchasePostedDetail,
  PurchasePostedListItem,
  PurchasePostedListRequest,
  PurchasePostedListResponse,
  Supplier,
} from "@breev/contracts/local-rest";
import { CatalogApiDenied, requestProduct } from "./catalog-api";
import { useCommittedFocus } from "./committed-focus";
import { IdentityApiDenied } from "./identity-api";
import {
  PurchasingApiDenied,
  requestPostedPurchase,
  requestPostedPurchaseAdjustment,
  requestPostedPurchaseReturn,
  requestPostedPurchases,
  requestSupplier,
} from "./purchasing-api";
import { PurchaseAdjustmentWorkflow } from "./purchase-adjustment-workflow";
import { PurchaseReturnWorkflow } from "./purchase-return-workflow";
import { panelUnitLabel, unitQuantity } from "./panel-unit-label";
import {
  getAdjustmentReasonLabel,
  purchasingMessages,
} from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";
import { formatFilsToIqd } from "./product-record";

type CorrectionKind = "adjustment" | "return";
type CurrentRecord =
  | { readonly kind: "item"; readonly value: Product }
  | { readonly kind: "supplier"; readonly value: Supplier };

function formatProtoMoney(filsStr: string | null | undefined): {
  readonly text: string;
  readonly isNegative: boolean;
} {
  if (filsStr === null || filsStr === undefined || filsStr === "") {
    return { text: "—", isNegative: false };
  }
  const fils = BigInt(filsStr);
  const isNegative = fils < 0n;
  const absFils = isNegative ? -fils : fils;
  const wholeIqd = absFils / 1000n;
  const remainderFils = absFils % 1000n;
  const wholeFormatted = wholeIqd
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let display = wholeFormatted;
  if (remainderFils > 0n) {
    const frac = remainderFils.toString().padStart(3, "0").replace(/0+$/, "");
    display = `${wholeFormatted}.${frac}`;
  }
  return {
    text: isNegative ? `${display}-` : display,
    isNegative,
  };
}

function renderTypeBadge(
  purchase: PurchasePostedListItem,
  copy: (typeof purchasingMessages)[keyof typeof purchasingMessages],
): React.JSX.Element {
  if (purchase.rowKind === "return") {
    return (
      <span className="proto-badge proto-badge-return">{copy.typeReturn}</span>
    );
  }
  if (purchase.rowKind === "adjustment") {
    return (
      <span className="proto-badge proto-badge-adjustment">
        {copy.typeAdjustment}
      </span>
    );
  }
  if (purchase.rowKind === "purchase" && purchase.hasAdjustments) {
    return (
      <span className="proto-badge proto-badge-modified">
        {copy.typeModified}
      </span>
    );
  }
  return (
    <span className="proto-badge proto-badge-purchase">
      {copy.typePurchase}
    </span>
  );
}

export function PostedPurchaseReview({
  address,
  baseUrl,
  inline = false,
  onClose,
  open,
  returnHash = "#/purchases",
}: {
  readonly address?: { readonly id: string };
  readonly baseUrl: string;
  readonly inline?: boolean;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly returnHash?: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const drilldownOpenerRef = useRef<HTMLElement | null>(null);
  const correctionOpenerRef = useRef<HTMLElement | null>(null);
  const postedAdjustmentOpenerRef = useRef<HTMLElement | null>(null);
  const postedReturnOpenerRef = useRef<HTMLElement | null>(null);
  const requestCommittedFocus = useCommittedFocus();
  const [list, setList] = useState<PurchasePostedListResponse | null>(null);
  const [detail, setDetail] = useState<PurchasePostedDetail | null>(null);
  const [postedAdjustment, setPostedAdjustment] =
    useState<PostedPurchaseAdjustment | null>(null);
  const [postedReturn, setPostedReturn] = useState<PostedPurchaseReturn | null>(
    null,
  );
  const [currentRecord, setCurrentRecord] = useState<CurrentRecord | null>(
    null,
  );
  const [correction, setCorrection] = useState<CorrectionKind | null>(null);
  const [adjustmentDraftActive, setAdjustmentDraftActive] = useState(false);
  const [adjustmentLeaveRequest, setAdjustmentLeaveRequest] = useState(0);
  const [returnDraftActive, setReturnDraftActive] = useState(false);
  const [returnLeaveRequest, setReturnLeaveRequest] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denial, setDenial] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || detail !== null) return;

    const timer = setTimeout(
      () => {
        void loadList({
          dateType: "posted-at",
          direction: "descending",
          ...(query.trim() === "" ? {} : { query: query.trim() }),
          sort: "posted-at",
        });
      },
      query.trim() !== "" ? 250 : 0,
    );

    return () => clearTimeout(timer);
  }, [baseUrl, detail, open, query]);

  useEffect(() => {
    if (inline) {
      if (open) {
        setDetail(null);
        setCurrentRecord(null);
        setPostedAdjustment(null);
        setPostedReturn(null);
        setCorrection(null);
        setAdjustmentDraftActive(false);
        setAdjustmentLeaveRequest(0);
        setReturnDraftActive(false);
        setReturnLeaveRequest(0);
        setAnnouncement("");
        const addressed =
          address === undefined
            ? postedPurchaseAddress(window.location.hash)
            : { correction: null, id: address.id };
        if (addressed === null) {
          queueMicrotask(() => searchRef.current?.focus());
        } else {
          void loadDetail(addressed.id, undefined, addressed.correction);
        }
      }
      return;
    }
    const dialog = dialogRef.current;
    if (open && dialog !== null && !dialog.open) {
      dialog.showModal();
      setDetail(null);
      setCurrentRecord(null);
      setPostedAdjustment(null);
      setPostedReturn(null);
      setCorrection(null);
      setAdjustmentDraftActive(false);
      setAdjustmentLeaveRequest(0);
      setReturnDraftActive(false);
      setReturnLeaveRequest(0);
      setAnnouncement("");
      const addressed =
        address === undefined
          ? postedPurchaseAddress(window.location.hash)
          : { correction: null, id: address.id };
      if (addressed === null) {
        queueMicrotask(() => searchRef.current?.focus());
      } else {
        void loadDetail(addressed.id, undefined, addressed.correction);
      }
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [address, baseUrl, inline, open, returnHash]);

  async function loadList(input: PurchasePostedListRequest): Promise<void> {
    setLoading(true);
    setError(null);
    setDenial(null);
    try {
      setList(await requestPostedPurchases(baseUrl, input));
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(
    purchaseId: string,
    opener?: HTMLElement,
    addressedCorrection: CorrectionKind | null = null,
  ): Promise<void> {
    if (opener !== undefined) detailOpenerRef.current = opener;
    setLoading(true);
    setError(null);
    setDenial(null);
    setAnnouncement("");
    try {
      setDetail(await requestPostedPurchase(baseUrl, purchaseId));
      setPostedAdjustment(null);
      setPostedReturn(null);
      setCurrentRecord(null);
      setCorrection(addressedCorrection);
      if (address === undefined) {
        window.history.replaceState(
          null,
          "",
          `#/purchases/posted/${purchaseId}${
            addressedCorrection === null ? "" : `/${addressedCorrection}`
          }`,
        );
      }
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setLoading(false);
    }
  }

  function handleFailure(caught: unknown): void {
    if (caught instanceof IdentityApiDenied) {
      setDenial(`${copy.reviewPermissionDenied} ${caught.denial.requestId}`);
    } else if (
      caught instanceof PurchasingApiDenied ||
      caught instanceof CatalogApiDenied
    ) {
      setDenial(`${copy.reviewDenied} ${caught.denial.requestId}`);
    } else {
      setError(copy.reviewUnavailable);
    }
  }

  function backToList(): void {
    const opener = detailOpenerRef.current;
    setDetail(null);
    setCurrentRecord(null);
    setCorrection(null);
    window.history.replaceState(null, "", returnHash);
    if (address !== undefined) {
      dialogRef.current?.close();
      return;
    }
    focusAfterRender(opener);
  }

  function closeDrilldown(): void {
    const opener = drilldownOpenerRef.current;
    setCurrentRecord(null);
    setDenial(null);
    setError(null);
    focusAfterRender(opener);
  }

  async function openItem(itemId: string, opener: HTMLElement): Promise<void> {
    drilldownOpenerRef.current = opener;
    setLoading(true);
    setDenial(null);
    setError(null);
    try {
      setCurrentRecord({
        kind: "item",
        value: await requestProduct(baseUrl, itemId),
      });
      requestCommittedFocus(() =>
        containerRef.current?.querySelector<HTMLElement>(
          '[data-review-focus="current-record-back"]',
        ),
      );
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setLoading(false);
    }
  }

  async function openSupplier(opener: HTMLElement): Promise<void> {
    if (detail === null) return;
    drilldownOpenerRef.current = opener;
    setLoading(true);
    setDenial(null);
    setError(null);
    try {
      setCurrentRecord({
        kind: "supplier",
        value: await requestSupplier(baseUrl, detail.supplierId),
      });
      requestCommittedFocus(() =>
        containerRef.current?.querySelector<HTMLElement>(
          '[data-review-focus="current-record-back"]',
        ),
      );
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setLoading(false);
    }
  }

  async function openPostedAdjustment(
    adjustmentId: string,
    opener: HTMLElement,
  ): Promise<void> {
    postedAdjustmentOpenerRef.current = opener;
    setLoading(true);
    setError(null);
    setDenial(null);
    try {
      setPostedAdjustment(
        await requestPostedPurchaseAdjustment(baseUrl, adjustmentId),
      );
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setLoading(false);
    }
  }

  function closePostedAdjustment(): void {
    const opener = postedAdjustmentOpenerRef.current;
    setPostedAdjustment(null);
    focusAfterRender(opener);
  }

  async function openPostedReturn(
    returnId: string,
    opener: HTMLElement,
  ): Promise<void> {
    postedReturnOpenerRef.current = opener;
    setLoading(true);
    setError(null);
    setDenial(null);
    try {
      setPostedReturn(await requestPostedPurchaseReturn(baseUrl, returnId));
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setLoading(false);
    }
  }

  function closePostedReturn(): void {
    const opener = postedReturnOpenerRef.current;
    setPostedReturn(null);
    focusAfterRender(opener);
  }

  function openCorrection(kind: CorrectionKind, opener: HTMLElement): void {
    if (detail === null) return;
    correctionOpenerRef.current = opener;
    setCorrection(kind);
    window.location.hash = `#/purchases/posted/${detail.id}/${kind}`;
  }

  function closeCorrection(): void {
    if (detail === null) return;
    const opener = correctionOpenerRef.current;
    setCorrection(null);
    setAdjustmentDraftActive(false);
    setReturnDraftActive(false);
    window.history.replaceState(null, "", `#/purchases/posted/${detail.id}`);
    focusAfterRender(opener);
  }

  // Focus returns to the opener in the same commit that renders the view it
  // belongs to, so the restored view is never actionable with stale focus.
  function focusAfterRender(opener: HTMLElement | null): void {
    const focusKey = opener?.dataset.reviewFocus;
    if (focusKey === undefined) return;
    requestCommittedFocus(() =>
      (inline
        ? containerRef.current
        : dialogRef.current
      )?.querySelector<HTMLElement>(`[data-review-focus="${focusKey}"]`),
    );
  }

  function handleDialogClose(): void {
    if (
      address !== undefined ||
      window.location.hash.startsWith("#/purchases/posted/")
    ) {
      window.history.replaceState(null, "", returnHash);
    }
    onClose();
  }

  function navigate(directionToUse: "next" | "previous"): void {
    if (detail === null) return;
    const id =
      directionToUse === "previous"
        ? detail.navigation.previousId
        : detail.navigation.nextId;
    if (id === null) {
      setAnnouncement(
        directionToUse === "previous"
          ? copy.reviewFirstBoundary
          : copy.reviewLastBoundary,
      );
      return;
    }
    void loadDetail(id);
  }

  function handleRowOpen(
    purchase: PurchasePostedListItem,
    opener: HTMLElement,
  ): void {
    if (purchase.rowKind === "adjustment") {
      void openPostedAdjustment(purchase.id, opener);
    } else if (purchase.rowKind === "return") {
      void openPostedReturn(purchase.id, opener);
    } else {
      void loadDetail(purchase.id, opener);
    }
  }

  const costsVisible =
    (detail?.costVisibility ?? list?.costVisibility) === "visible";

  const content = (
    <>
      {correction === "adjustment" ? (
        <h2 id="posted-purchase-review-title" className="visually-hidden">
          {copy.postedPurchaseRegister}
        </h2>
      ) : (
        <>
          <header
            className={inline ? "visually-hidden" : "posted-review-heading"}
          >
            <div>
              <p className="purchase-context-label">
                {copy.historicalSnapshot}
              </p>
              <h2 id="posted-purchase-review-title">
                {copy.postedPurchaseRegister}
              </h2>
            </div>
          </header>

          <p
            id="posted-purchase-review-boundary"
            className={inline ? "visually-hidden" : "posted-review-boundary"}
          >
            <span aria-hidden="true">ℹ</span>
            <span>{copy.snapshotBoundary}</span>
          </p>
        </>
      )}
      <p role="status" aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
      {loading ? <p role="status">{copy.loading}</p> : null}
      {denial === null ? null : (
        <div className="form-error" role="alert">
          <p>{denial}</p>
          <button
            type="button"
            className="quiet-button"
            onClick={() => void loadList({})}
          >
            {copy.retry}
          </button>
        </div>
      )}
      {error === null ? null : (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="quiet-button"
            onClick={() => void loadList({})}
          >
            {copy.retry}
          </button>
        </div>
      )}

      {postedAdjustment !== null ? (
        <PostedAdjustmentView
          adjustment={postedAdjustment}
          onBack={closePostedAdjustment}
        />
      ) : postedReturn !== null ? (
        <PostedReturnView
          purchaseReturn={postedReturn}
          onBack={closePostedReturn}
        />
      ) : correction !== null && detail !== null ? (
        <section
          className="posted-correction-stage"
          aria-label={
            correction === "adjustment"
              ? copy.adjustmentStageTitle
              : copy.returnStageTitle
          }
        >
          {correction === "adjustment" ? (
            <PurchaseAdjustmentWorkflow
              baseUrl={baseUrl}
              detail={detail}
              leaveRequest={adjustmentLeaveRequest}
              onBack={closeCorrection}
              onDraftActive={setAdjustmentDraftActive}
              onPosted={async (purchaseId) => {
                setDetail(await requestPostedPurchase(baseUrl, purchaseId));
              }}
            />
          ) : (
            <PurchaseReturnWorkflow
              baseUrl={baseUrl}
              detail={detail}
              leaveRequest={returnLeaveRequest}
              onBack={closeCorrection}
              onDraftActive={setReturnDraftActive}
              onPosted={async (purchaseId) => {
                setDetail(await requestPostedPurchase(baseUrl, purchaseId));
              }}
            />
          )}
        </section>
      ) : currentRecord !== null ? (
        <CurrentRecordView record={currentRecord} onBack={closeDrilldown} />
      ) : detail !== null ? (
        <PostedPurchaseDetailView
          detail={detail}
          navigate={navigate}
          onBack={backToList}
          onCorrection={openCorrection}
          onAdjustment={(adjustmentId, opener) =>
            void openPostedAdjustment(adjustmentId, opener)
          }
          onReturn={(returnId, opener) =>
            void openPostedReturn(returnId, opener)
          }
          onItem={(itemId, opener) => void openItem(itemId, opener)}
          onSupplier={(opener) => void openSupplier(opener)}
        />
      ) : (
        <section
          aria-label={copy.postedPurchaseRegister}
          className="proto-posted-purchase-section"
        >
          <form
            className="proto-posted-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              void loadList({
                dateType: "posted-at",
                direction: "descending",
                ...(query.trim() === "" ? {} : { query: query.trim() }),
                sort: "posted-at",
              });
            }}
          >
            <div className="proto-toolbar-start">
              <div className="proto-toolbar-search-wrap">
                <input
                  ref={searchRef}
                  type="search"
                  className="proto-search-input"
                  aria-label={copy.searchPosted}
                  value={query}
                  placeholder={copy.searchPostedHint}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <span className="proto-count-badge">
                {list ? list.purchases.length : 0} {copy.invoiceCountUnit}
              </span>
            </div>
            <div className="proto-toolbar-hint">
              <span>{copy.doubleClickHint}</span>
            </div>
          </form>

          {list?.costVisibility === "hidden-by-permission" ? (
            <p role="status">{copy.costsHiddenByPermission}</p>
          ) : list?.costVisibility === "hidden-by-setting" ? (
            <p role="status">{copy.costsHiddenBySetting}</p>
          ) : null}

          <div
            className="proto-table-wrap"
            role="group"
            aria-label={copy.scrollPosted}
            tabIndex={0}
          >
            <table className="posted-purchase-list proto-posted-table">
              <caption className="visually-hidden">
                {copy.postedPurchaseRegister}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="proto-th-num">
                    #
                  </th>
                  <th scope="col" className="proto-th-type">
                    {copy.invoiceType}
                  </th>
                  <th scope="col" className="proto-th-doc-num">
                    {copy.supplierPurchaseInvoiceNumber}
                  </th>
                  <th scope="col" className="proto-th-ref">
                    {copy.refNumber}
                  </th>
                  <th scope="col" className="proto-th-date">
                    {copy.invoiceDate}
                  </th>
                  <th scope="col" className="proto-th-pay">
                    {copy.paymentTerms}
                  </th>
                  <th scope="col" className="proto-th-supplier">
                    {copy.supplierStore}
                  </th>
                  <th scope="col" className="proto-th-cost">
                    {copy.primarySupplierCost}
                  </th>
                  <th scope="col" className="proto-th-after-discount">
                    {copy.costAfterDiscount}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list?.purchases.length === 0 ? (
                  <tr>
                    <td className="purchase-table-empty" colSpan={9}>
                      {copy.noPostedPurchases}
                    </td>
                  </tr>
                ) : (
                  list?.purchases.map((purchase, index) => {
                    const primaryCost = formatProtoMoney(
                      purchase.primarySupplierCostFils,
                    );
                    const costAfterDiscount = formatProtoMoney(
                      purchase.costAfterDiscountFils,
                    );

                    return (
                      <tr
                        key={purchase.id}
                        tabIndex={0}
                        className="proto-table-row"
                        onDoubleClick={(event) => {
                          handleRowOpen(purchase, event.currentTarget);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            if (
                              (event.target as HTMLElement).tagName !== "BUTTON"
                            ) {
                              event.preventDefault();
                              handleRowOpen(purchase, event.currentTarget);
                            }
                          }
                        }}
                      >
                        <td className="proto-td-num">
                          <bdi>{index + 1}</bdi>
                        </td>
                        <td className="proto-td-type">
                          {renderTypeBadge(purchase, copy)}
                        </td>
                        <td className="proto-td-doc-num">
                          <button
                            type="button"
                            className="proto-doc-btn"
                            aria-label={
                              purchase.rowKind === "adjustment"
                                ? `${copy.openDocument} ${formatNumber(purchase)}`
                                : `${copy.openInvoice} ${formatNumber(purchase)}`
                            }
                            data-review-focus={`posted-${purchase.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRowOpen(purchase, event.currentTarget);
                            }}
                          >
                            <bdi className="proto-font-mono">
                              {purchase.supplierInvoiceNumber}
                            </bdi>
                          </button>
                        </td>
                        <td className="proto-td-ref">
                          {purchase.refNumber ? (
                            <button
                              type="button"
                              className="proto-ref-link"
                              title={copy.originalInvoice}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (purchase.originalPurchaseId) {
                                  void loadDetail(
                                    purchase.originalPurchaseId,
                                    event.currentTarget,
                                  );
                                } else {
                                  setQuery(purchase.refNumber!);
                                }
                              }}
                            >
                              {purchase.refNumber}
                            </button>
                          ) : (
                            <span className="proto-dash">—</span>
                          )}
                        </td>
                        <td className="proto-td-date">
                          <bdi>
                            {purchase.invoiceDate ||
                              purchase.postedAt.slice(0, 10)}
                          </bdi>
                        </td>
                        <td className="proto-td-pay">
                          <span>
                            {purchase.settlementContext === "cash"
                              ? copy.cashShort
                              : copy.debtShort}
                          </span>
                        </td>
                        <td className="proto-td-supplier">
                          <span className="proto-supplier-name">
                            {purchase.supplierNameSnapshot}
                          </span>
                        </td>
                        <td className="proto-td-cost">
                          <bdi
                            className={`proto-money ${
                              primaryCost.isNegative
                                ? "proto-money-negative"
                                : ""
                            }`}
                          >
                            {costsVisible ? primaryCost.text : "***"}
                          </bdi>
                        </td>
                        <td className="proto-td-after-discount">
                          <bdi
                            className={`proto-money ${
                              costAfterDiscount.isNegative
                                ? "proto-money-negative"
                                : ""
                            }`}
                          >
                            {costsVisible ? costAfterDiscount.text : "***"}
                          </bdi>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {list && list.purchases.length > 0 ? (
                <tfoot className="proto-table-tfoot">
                  <tr>
                    <td colSpan={7} className="proto-tfoot-label">
                      <strong>{copy.totalSummary}</strong>
                    </td>
                    <td className="proto-tfoot-cost">
                      {costsVisible ? (
                        (() => {
                          const totalPrimary = list.purchases.reduce(
                            (acc, p) => {
                              if (!p.primarySupplierCostFils) return acc;
                              return acc + BigInt(p.primarySupplierCostFils);
                            },
                            0n,
                          );
                          const formatted = formatProtoMoney(
                            totalPrimary.toString(),
                          );
                          return (
                            <bdi
                              className={`proto-money ${
                                formatted.isNegative
                                  ? "proto-money-negative"
                                  : ""
                              }`}
                            >
                              <strong>{formatted.text}</strong>
                            </bdi>
                          );
                        })()
                      ) : (
                        <bdi className="proto-money">***</bdi>
                      )}
                    </td>
                    <td className="proto-tfoot-cost">
                      {costsVisible ? (
                        (() => {
                          const totalDiscount = list.purchases.reduce(
                            (acc, p) => {
                              if (!p.costAfterDiscountFils) return acc;
                              return acc + BigInt(p.costAfterDiscountFils);
                            },
                            0n,
                          );
                          const formatted = formatProtoMoney(
                            totalDiscount.toString(),
                          );
                          return (
                            <bdi
                              className={`proto-money ${
                                formatted.isNegative
                                  ? "proto-money-negative"
                                  : ""
                              }`}
                            >
                              <strong>{formatted.text}</strong>
                            </bdi>
                          );
                        })()
                      ) : (
                        <bdi className="proto-money">***</bdi>
                      )}
                    </td>
                    <td className="proto-tfoot-empty"></td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      )}
      {detail !== null &&
      postedAdjustment === null &&
      postedReturn === null &&
      correction === null &&
      currentRecord === null ? (
        <PurchaseSnapshotPrint detail={detail} />
      ) : null}
      {inline && (detail !== null || correction !== null) ? null : (
        <footer className="posted-dialog-footer">
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              if (correction === "adjustment" && adjustmentDraftActive) {
                setAdjustmentLeaveRequest((value) => value + 1);
              } else if (correction === "return" && returnDraftActive) {
                setReturnLeaveRequest((value) => value + 1);
              } else if (inline) {
                handleDialogClose();
              } else {
                dialogRef.current?.close();
              }
            }}
          >
            {copy.close}
          </button>
        </footer>
      )}
    </>
  );

  if (inline) {
    return (
      <section
        ref={(el) => {
          containerRef.current = el;
        }}
        className="posted-purchase-view"
        role="region"
        aria-label={copy.postedPurchaseRegister}
        aria-labelledby="posted-purchase-review-title"
        aria-describedby="posted-purchase-review-boundary"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (currentRecord !== null) {
              event.preventDefault();
              closeDrilldown();
            } else if (postedAdjustment !== null) {
              event.preventDefault();
              closePostedAdjustment();
            } else if (postedReturn !== null) {
              event.preventDefault();
              closePostedReturn();
            } else if (correction !== null) {
              event.preventDefault();
              if (correction === "adjustment" && adjustmentDraftActive) {
                setAdjustmentLeaveRequest((value) => value + 1);
              } else if (correction === "return" && returnDraftActive) {
                setReturnLeaveRequest((value) => value + 1);
              } else {
                closeCorrection();
              }
            } else {
              handleDialogClose();
            }
          }
        }}
      >
        {content}
      </section>
    );
  }

  return (
    <dialog
      ref={(el) => {
        dialogRef.current = el;
        containerRef.current = el;
      }}
      className="posted-purchase-dialog"
      aria-labelledby="posted-purchase-review-title"
      aria-describedby="posted-purchase-review-boundary"
      onCancel={(event) => {
        if (currentRecord !== null) {
          event.preventDefault();
          closeDrilldown();
        } else if (postedAdjustment !== null) {
          event.preventDefault();
          closePostedAdjustment();
        } else if (postedReturn !== null) {
          event.preventDefault();
          closePostedReturn();
        } else if (correction !== null) {
          event.preventDefault();
          if (correction === "adjustment" && adjustmentDraftActive) {
            setAdjustmentLeaveRequest((value) => value + 1);
          } else if (correction === "return" && returnDraftActive) {
            setReturnLeaveRequest((value) => value + 1);
          } else {
            closeCorrection();
          }
        }
      }}
      onClose={handleDialogClose}
    >
      {content}
    </dialog>
  );
}

function PostedPurchaseDetailView({
  detail,
  navigate,
  onBack,
  onCorrection,
  onAdjustment,
  onReturn,
  onItem,
  onSupplier,
}: {
  readonly detail: PurchasePostedDetail;
  readonly navigate: (direction: "next" | "previous") => void;
  readonly onBack: () => void;
  readonly onCorrection: (kind: CorrectionKind, opener: HTMLElement) => void;
  readonly onAdjustment: (adjustmentId: string, opener: HTMLElement) => void;
  readonly onReturn: (returnId: string, opener: HTMLElement) => void;
  readonly onItem: (itemId: string, opener: HTMLElement) => void;
  readonly onSupplier: (opener: HTMLElement) => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const costsVisible = detail.costVisibility === "visible";
  return (
    <article
      className="posted-purchase-review"
      aria-labelledby="posted-detail-title"
    >
      <div className="posted-detail-toolbar">
        {detail.canAdjust ? (
          <button
            type="button"
            className="purchase-adjust-button"
            data-review-focus={`adjustment-${detail.id}`}
            onClick={(event) => onCorrection("adjustment", event.currentTarget)}
          >
            <span>📝</span> {copy.editInvoice}
          </button>
        ) : null}
        {detail.canReturn ? (
          <button
            type="button"
            className="purchase-return-button"
            data-review-focus={`return-${detail.id}`}
            onClick={(event) => onCorrection("return", event.currentTarget)}
          >
            <span>↩️</span> {copy.returnInvoice}
          </button>
        ) : null}
        <button type="button" className="quiet-button" onClick={onBack}>
          {copy.backToResults}
        </button>
        <p>
          <bdi dir="ltr">
            {detail.navigation.position} / {detail.navigation.total}
          </bdi>
        </p>
        <button
          type="button"
          className="quiet-button"
          aria-disabled={detail.navigation.previousId === null}
          onClick={() => navigate("previous")}
          title={copy.reviewPrevious}
        >
          {copy.reviewPrevious}
        </button>
        <button
          type="button"
          className="quiet-button"
          aria-disabled={detail.navigation.nextId === null}
          onClick={() => navigate("next")}
          title={copy.reviewNext}
        >
          {copy.reviewNext}
        </button>
      </div>
      {detail.adjustments.length > 0 ? (
        <section
          className="linked-adjustments-card"
          aria-label={copy.linkedAdjustmentsTitle}
        >
          <div className="linked-adjustments-header">
            <span className="linked-adjustments-icon" aria-hidden="true">
              🕒
            </span>
            <span>
              {copy.linkedAdjustmentsTitle} ({detail.adjustments.length})
            </span>
          </div>
          <div
            className="linked-adjustments-table-wrap"
            role="group"
            aria-label={copy.linkedAdjustmentsTitle}
            tabIndex={0}
          >
            <table className="linked-adjustments-table">
              <thead>
                <tr>
                  <th scope="col">{copy.adjustmentNumber}</th>
                  <th scope="col">{copy.adjustmentDateTime}</th>
                  <th scope="col">{copy.adjustmentReason}</th>
                  <th scope="col">{copy.adjustmentNetDelta}</th>
                  <th scope="col">{copy.actions}</th>
                </tr>
              </thead>
              <tbody>
                {detail.adjustments.map((adjustment) => {
                  const formattedAdjNumber = formatAdjustmentNumber(
                    adjustment.number,
                  );
                  return (
                    <tr key={adjustment.id}>
                      <th scope="row">
                        <bdi className="font-mono">{formattedAdjNumber}</bdi>
                      </th>
                      <td>
                        <bdi>
                          {formatTimestamp(adjustment.postedAt, locale)}
                        </bdi>
                      </td>
                      <td>
                        {getAdjustmentReasonLabel(adjustment.reason, locale) ||
                          copy.reasonOther}
                      </td>
                      <td>
                        <bdi className="font-mono">
                          {adjustment.primarySupplierCostDeltaFils !== null
                            ? formatFilsToIqd(
                                adjustment.primarySupplierCostDeltaFils,
                                locale,
                              )
                            : `0 ${copy.iqd}`}
                        </bdi>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="purchase-open-adjustment-pill"
                          data-review-focus={`posted-adjustment-${adjustment.id}`}
                          onClick={(event) =>
                            onAdjustment(adjustment.id, event.currentTarget)
                          }
                          aria-label={`${copy.openDocument} ${formattedAdjNumber}`}
                        >
                          {copy.openDocument}
                          <span className="visually-hidden">
                            {" "}
                            {formattedAdjNumber}
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <header>
        <p className="purchase-context-label">{copy.historicalSnapshot}</p>
        <h3 id="posted-detail-title">{formatNumber(detail)}</h3>
        <p>
          <bdi>{detail.invoiceDate}</bdi> · {detail.supplierNameSnapshot}
        </p>
      </header>
      <dl className="posted-purchase-totals">
        <div>
          <dt>{copy.supplierInvoice}</dt>
          <dd>
            <bdi>{detail.supplierInvoiceNumber}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.postedAt}</dt>
          <dd>
            <bdi>{formatTimestamp(detail.postedAt, locale)}</bdi>
          </dd>
        </div>
        {costsVisible ? (
          <div>
            <dt>{copy.primarySupplierCost}</dt>
            <dd>
              <bdi>
                {formatFilsToIqd(detail.primarySupplierCostFils, locale)}
              </bdi>
            </dd>
          </div>
        ) : null}
        {costsVisible ? (
          <div>
            <dt>{copy.allowanceAmount}</dt>
            <dd>
              <bdi>{formatFilsToIqd(detail.allowanceFils, locale)}</bdi>
            </dd>
          </div>
        ) : null}
        {costsVisible ? (
          <div>
            <dt>{copy.costAfterDiscount}</dt>
            <dd>
              <bdi>{formatFilsToIqd(detail.costAfterDiscountFils, locale)}</bdi>
            </dd>
          </div>
        ) : null}
        {costsVisible ? (
          <div>
            <dt>{copy.snapshot}</dt>
            <dd>{detail.allowancePercentageSnapshot}%</dd>
          </div>
        ) : null}
      </dl>
      {!costsVisible ? (
        <p role="status">
          {detail.costVisibility === "hidden-by-permission"
            ? copy.costsHiddenByPermission
            : copy.costsHiddenBySetting}
        </p>
      ) : null}
      <button
        type="button"
        className="quiet-button"
        data-review-focus="supplier"
        onClick={(event) => onSupplier(event.currentTarget)}
      >
        {copy.openCurrentSupplier}
      </button>
      <div
        className="posted-purchase-table-wrap"
        role="group"
        aria-label={copy.postedRows}
        tabIndex={0}
      >
        <table className="posted-purchase-table">
          <caption className="visually-hidden">{copy.postedRows}</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{copy.item}</th>
              <th scope="col">{copy.quantity}</th>
              <th scope="col">{copy.unit}</th>
              <th scope="col">{copy.retail}</th>
              {costsVisible ? (
                <th scope="col">{copy.primarySupplierCost}</th>
              ) : null}
              {costsVisible ? (
                <th scope="col">{copy.costAfterDiscount}</th>
              ) : null}
              <th scope="col">{copy.expiry}</th>
              <th scope="col">{copy.lot}</th>
              <th scope="col">{copy.actions}</th>
            </tr>
          </thead>
          <tbody>
            {detail.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.ordinal}</th>
                <td>{row.itemDisplayName}</td>
                <td>
                  <bdi>{row.inventoryUnitQuantity}</bdi>
                </td>
                <td>
                  {panelUnitLabel(
                    row.inventoryUnitName,
                    unitQuantity(row.inventoryUnitQuantity),
                    locale,
                  )}
                </td>
                <td>
                  <bdi>{formatFilsToIqd(row.retailPriceFils, locale)}</bdi>
                </td>
                {costsVisible ? (
                  <td>
                    <bdi>
                      {formatFilsToIqd(row.linePrimarySupplierCostFils, locale)}
                    </bdi>
                  </td>
                ) : null}
                {costsVisible ? (
                  <td>
                    <bdi>
                      {formatFilsToIqd(row.costAfterDiscountFils, locale)}
                    </bdi>
                  </td>
                ) : null}
                <td>
                  <bdi>{row.expiryDate ?? copy.noExpiry}</bdi>
                </td>
                <td>{row.lotNumber ?? copy.notSet}</td>
                <td>
                  <button
                    type="button"
                    className="quiet-button"
                    data-review-focus={`item-${row.id}`}
                    onClick={(event) => onItem(row.itemId, event.currentTarget)}
                  >
                    {copy.openCurrentItem} {row.itemDisplayName}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.returns.length > 0 ? (
        <section
          className="posted-return-links"
          aria-label={copy.returnStageTitle}
        >
          <h4>{copy.returnStageTitle}</h4>
          <ul>
            {detail.returns.map((purchaseReturn) => (
              <li key={purchaseReturn.id}>
                <button
                  type="button"
                  className="quiet-button purchase-return-link"
                  data-review-focus={`posted-return-${purchaseReturn.id}`}
                  onClick={(event) =>
                    onReturn(purchaseReturn.id, event.currentTarget)
                  }
                >
                  {formatReturnNumber(purchaseReturn.number)} ·{" "}
                  {purchaseReturn.reason}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function CurrentRecordView({
  onBack,
  record,
}: {
  readonly onBack: () => void;
  readonly record: CurrentRecord;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  return (
    <section
      className="posted-current-record"
      aria-labelledby="current-record-title"
    >
      <p className="purchase-context-label">{copy.currentMasterRecord}</p>
      <h3 id="current-record-title">
        {record.kind === "item" ? record.value.displayName : record.value.name}
      </h3>
      <p>{copy.currentRecordBoundary}</p>
      <dl>
        {record.kind === "item" ? (
          <>
            <div>
              <dt>{copy.status}</dt>
              <dd>{copy[record.value.status]}</dd>
            </div>
            <div>
              <dt>{copy.arabicName}</dt>
              <dd dir="rtl">{record.value.arabicSearchName ?? copy.notSet}</dd>
            </div>
            <div>
              <dt>{copy.version}</dt>
              <dd>{record.value.revision}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>{copy.status}</dt>
              <dd>{copy[record.value.status]}</dd>
            </div>
            <div>
              <dt>{copy.allowance}</dt>
              <dd>{record.value.defaultAllowancePercentage}%</dd>
            </div>
            <div>
              <dt>{copy.terms}</dt>
              <dd>{record.value.terms ?? copy.notSet}</dd>
            </div>
            <div>
              <dt>{copy.version}</dt>
              <dd>{record.value.revision}</dd>
            </div>
          </>
        )}
      </dl>
      <button
        type="button"
        className="quiet-button"
        data-review-focus="current-record-back"
        onClick={onBack}
      >
        {copy.backToInvoice}
      </button>
    </section>
  );
}

function PurchaseSnapshotPrint({
  detail,
}: {
  readonly detail: PurchasePostedDetail;
}): React.JSX.Element | null {
  return typeof document === "undefined"
    ? null
    : createPortal(
        <PostedPurchaseSnapshot detail={detail} print />,
        document.body,
      );
}

function postedPurchaseAddress(hash: string): {
  readonly correction: CorrectionKind | null;
  readonly id: string;
} | null {
  const match =
    /^#\/purchases\/posted\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(adjustment|return))?$/iu.exec(
      hash,
    );
  if (match?.[1] === undefined) return null;
  return {
    correction:
      match[2] === "adjustment" || match[2] === "return" ? match[2] : null,
    id: match[1],
  };
}
