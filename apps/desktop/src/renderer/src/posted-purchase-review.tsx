import { useEffect, useRef, useState } from "react";
import type {
  PostedPurchaseAdjustment,
  Product,
  PurchasePostedDetail,
  PurchasePostedListRequest,
  PurchasePostedListResponse,
  Supplier,
} from "@breev/contracts/local-rest";
import { CatalogApiDenied, requestProduct } from "./catalog-api";
import { IdentityApiDenied } from "./identity-api";
import {
  PurchasingApiDenied,
  requestPostedPurchase,
  requestPostedPurchaseAdjustment,
  requestPostedPurchases,
  requestSupplier,
} from "./purchasing-api";
import { PurchaseAdjustmentWorkflow } from "./purchase-adjustment-workflow";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";

type CorrectionKind = "adjustment" | "return";
type CurrentRecord =
  | { readonly kind: "item"; readonly value: Product }
  | { readonly kind: "supplier"; readonly value: Supplier };

export function PostedPurchaseReview({
  baseUrl,
  onClose,
  open,
}: {
  readonly baseUrl: string;
  readonly onClose: () => void;
  readonly open: boolean;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const drilldownOpenerRef = useRef<HTMLElement | null>(null);
  const correctionOpenerRef = useRef<HTMLElement | null>(null);
  const postedAdjustmentOpenerRef = useRef<HTMLElement | null>(null);
  const [list, setList] = useState<PurchasePostedListResponse | null>(null);
  const [detail, setDetail] = useState<PurchasePostedDetail | null>(null);
  const [postedAdjustment, setPostedAdjustment] =
    useState<PostedPurchaseAdjustment | null>(null);
  const [currentRecord, setCurrentRecord] = useState<CurrentRecord | null>(
    null,
  );
  const [correction, setCorrection] = useState<CorrectionKind | null>(null);
  const [adjustmentDraftActive, setAdjustmentDraftActive] = useState(false);
  const [adjustmentLeaveRequest, setAdjustmentLeaveRequest] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denial, setDenial] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] =
    useState<NonNullable<PurchasePostedListRequest["sort"]>>("number");
  const [direction, setDirection] =
    useState<NonNullable<PurchasePostedListRequest["direction"]>>("descending");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog !== null && !dialog.open) {
      dialog.showModal();
      setDetail(null);
      setCurrentRecord(null);
      setPostedAdjustment(null);
      setCorrection(null);
      setAdjustmentDraftActive(false);
      setAdjustmentLeaveRequest(0);
      setAnnouncement("");
      const addressed = postedPurchaseAddress(window.location.hash);
      if (addressed === null) {
        void loadList({});
        queueMicrotask(() => searchRef.current?.focus());
      } else {
        void loadDetail(addressed.id, undefined, addressed.correction);
      }
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [baseUrl, open]);

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
      setCurrentRecord(null);
      setCorrection(addressedCorrection);
      window.history.replaceState(
        null,
        "",
        `#/purchases/posted/${purchaseId}${
          addressedCorrection === null ? "" : `/${addressedCorrection}`
        }`,
      );
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
    window.history.replaceState(null, "", "#/purchases");
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
    window.history.replaceState(null, "", `#/purchases/posted/${detail.id}`);
    focusAfterRender(opener);
  }

  function focusAfterRender(opener: HTMLElement | null): void {
    const focusKey = opener?.dataset.reviewFocus;
    if (focusKey === undefined) return;
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(`[data-review-focus="${focusKey}"]`)
        ?.focus();
    });
  }

  function handleDialogClose(): void {
    if (window.location.hash.startsWith("#/purchases/posted/")) {
      window.history.replaceState(null, "", "#/purchases");
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

  const costsVisible =
    (detail?.costVisibility ?? list?.costVisibility) === "visible";

  return (
    <dialog
      ref={dialogRef}
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
        } else if (correction !== null) {
          event.preventDefault();
          if (correction === "adjustment" && adjustmentDraftActive) {
            setAdjustmentLeaveRequest((value) => value + 1);
          } else {
            closeCorrection();
          }
        }
      }}
      onClose={handleDialogClose}
    >
      <header className="posted-review-heading">
        <div>
          <p className="purchase-context-label">{copy.historicalSnapshot}</p>
          <h2 id="posted-purchase-review-title">
            {copy.postedPurchaseRegister}
          </h2>
        </div>
        <button
          type="button"
          className="quiet-button"
          onClick={() => {
            if (correction === "adjustment" && adjustmentDraftActive) {
              setAdjustmentLeaveRequest((value) => value + 1);
            } else {
              dialogRef.current?.close();
            }
          }}
        >
          {copy.close}
        </button>
      </header>

      <p
        id="posted-purchase-review-boundary"
        className="posted-review-boundary"
      >
        {copy.snapshotBoundary}
      </p>
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
            <>
              <h3 id="correction-stage-title">{copy.returnStageTitle}</h3>
              <p>{copy.correctionStageUnavailable}</p>
              <p>
                {copy.originalRemainsUntouched}{" "}
                <bdi>{formatNumber(detail)}</bdi>
              </p>
              <button
                type="button"
                className="quiet-button"
                onClick={closeCorrection}
              >
                {copy.backToInvoice}
              </button>
            </>
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
          onItem={(itemId, opener) => void openItem(itemId, opener)}
          onSupplier={(opener) => void openSupplier(opener)}
        />
      ) : (
        <section aria-label={copy.postedPurchaseRegister}>
          <form
            className="purchase-filters posted-purchase-filters"
            onSubmit={(event) => {
              event.preventDefault();
              void loadList({
                direction,
                ...(from === "" ? {} : { from }),
                ...(query.trim() === "" ? {} : { query: query.trim() }),
                sort,
                ...(to === "" ? {} : { to }),
              });
            }}
          >
            <label className="purchase-search-filter">
              {copy.searchPosted}
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={copy.searchPostedHint}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              {copy.fromDate}
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              {copy.toDate}
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <label>
              {copy.sortBy}
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as typeof sort)}
              >
                <option value="number">{copy.documentNumber}</option>
                <option value="invoice-date">{copy.invoiceDate}</option>
                <option value="supplier">{copy.supplier}</option>
                {costsVisible ? (
                  <option value="primary-cost">
                    {copy.primarySupplierCost}
                  </option>
                ) : null}
              </select>
            </label>
            <label>
              {copy.sortDirection}
              <select
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as typeof direction)
                }
              >
                <option value="descending">{copy.descending}</option>
                <option value="ascending">{copy.ascending}</option>
              </select>
            </label>
            <button type="submit" className="primary-button">
              {copy.search}
            </button>
          </form>

          {list?.costVisibility === "hidden-by-permission" ? (
            <p role="status">{copy.costsHiddenByPermission}</p>
          ) : list?.costVisibility === "hidden-by-setting" ? (
            <p role="status">{copy.costsHiddenBySetting}</p>
          ) : null}
          <div
            className="purchase-table-wrap"
            role="group"
            aria-label={copy.scrollPosted}
            tabIndex={0}
          >
            <table className="posted-purchase-list">
              <caption className="visually-hidden">
                {copy.postedPurchaseRegister}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{copy.documentNumber}</th>
                  <th scope="col">{copy.invoiceDate}</th>
                  <th scope="col">{copy.supplier}</th>
                  <th scope="col">{copy.supplierInvoice}</th>
                  <th scope="col">{copy.items}</th>
                  {costsVisible ? (
                    <th scope="col">{copy.primarySupplierCost}</th>
                  ) : null}
                  {costsVisible ? (
                    <th scope="col">{copy.costAfterDiscount}</th>
                  ) : null}
                  <th scope="col">{copy.actions}</th>
                </tr>
              </thead>
              <tbody>
                {list?.purchases.length === 0 ? (
                  <tr>
                    <td colSpan={costsVisible ? 8 : 6}>
                      {copy.noPostedPurchases}
                    </td>
                  </tr>
                ) : (
                  list?.purchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <th scope="row">
                        <bdi>{formatNumber(purchase)}</bdi>
                      </th>
                      <td>
                        <bdi>{purchase.invoiceDate}</bdi>
                      </td>
                      <td>{purchase.supplierNameSnapshot}</td>
                      <td>
                        <bdi>{purchase.supplierInvoiceNumber}</bdi>
                      </td>
                      <td>{purchase.itemCount}</td>
                      {costsVisible ? (
                        <td>
                          <bdi>{purchase.primarySupplierCostFils}</bdi>
                        </td>
                      ) : null}
                      {costsVisible ? (
                        <td>
                          <bdi>{purchase.costAfterDiscountFils}</bdi>
                        </td>
                      ) : null}
                      <td>
                        <button
                          type="button"
                          className="purchase-open-posted"
                          data-review-focus={`posted-${purchase.id}`}
                          onClick={(event) =>
                            void loadDetail(purchase.id, event.currentTarget)
                          }
                        >
                          {copy.openInvoice} {formatNumber(purchase)}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </dialog>
  );
}

function PostedPurchaseDetailView({
  detail,
  navigate,
  onBack,
  onCorrection,
  onAdjustment,
  onItem,
  onSupplier,
}: {
  readonly detail: PurchasePostedDetail;
  readonly navigate: (direction: "next" | "previous") => void;
  readonly onBack: () => void;
  readonly onCorrection: (kind: CorrectionKind, opener: HTMLElement) => void;
  readonly onAdjustment: (adjustmentId: string, opener: HTMLElement) => void;
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
        >
          ← {copy.previous}
        </button>
        <button
          type="button"
          className="quiet-button"
          aria-disabled={detail.navigation.nextId === null}
          onClick={() => navigate("next")}
        >
          {copy.next} →
        </button>
      </div>
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
              <bdi>{detail.primarySupplierCostFils}</bdi> {copy.fils}
            </dd>
          </div>
        ) : null}
        {costsVisible ? (
          <div>
            <dt>{copy.allowanceAmount}</dt>
            <dd>
              <bdi>{detail.allowanceFils}</bdi> {copy.fils}
            </dd>
          </div>
        ) : null}
        {costsVisible ? (
          <div>
            <dt>{copy.costAfterDiscount}</dt>
            <dd>
              <bdi>{detail.costAfterDiscountFils}</bdi> {copy.fils}
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
                <td>{row.inventoryUnitName}</td>
                <td>
                  <bdi>{row.retailPriceFils}</bdi>
                </td>
                {costsVisible ? (
                  <td>
                    <bdi>{row.linePrimarySupplierCostFils}</bdi>
                  </td>
                ) : null}
                {costsVisible ? (
                  <td>
                    <bdi>{row.costAfterDiscountFils}</bdi>
                  </td>
                ) : null}
                <td>
                  <bdi>{row.expiryDate ?? "—"}</bdi>
                </td>
                <td>{row.lotNumber ?? "—"}</td>
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
      {detail.adjustments.length > 0 ? (
        <section
          className="posted-adjustment-links"
          aria-label={copy.adjustmentStageTitle}
        >
          <h4>{copy.adjustmentStageTitle}</h4>
          <ul>
            {detail.adjustments.map((adjustment) => (
              <li key={adjustment.id}>
                <button
                  type="button"
                  className="quiet-button"
                  data-review-focus={`posted-adjustment-${adjustment.id}`}
                  onClick={(event) =>
                    onAdjustment(adjustment.id, event.currentTarget)
                  }
                >
                  {formatAdjustmentNumber(adjustment.number)} ·{" "}
                  {adjustment.reason} · {adjustment.quantityDelta}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div
        className="posted-correction-actions"
        aria-label={copy.correctionActions}
      >
        {detail.canAdjust ? (
          <button
            type="button"
            className="purchase-adjust-button"
            data-review-focus={`adjustment-${detail.id}`}
            onClick={(event) => onCorrection("adjustment", event.currentTarget)}
          >
            {copy.editInvoice}
          </button>
        ) : null}
        <button
          type="button"
          className="purchase-return-button"
          data-review-focus={`return-${detail.id}`}
          onClick={(event) => onCorrection("return", event.currentTarget)}
        >
          {copy.returnInvoice}
        </button>
      </div>
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
              <dd dir="rtl">{record.value.arabicSearchName ?? "—"}</dd>
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
              <dd>{record.value.terms ?? "—"}</dd>
            </div>
            <div>
              <dt>{copy.version}</dt>
              <dd>{record.value.revision}</dd>
            </div>
          </>
        )}
      </dl>
      <button type="button" className="quiet-button" onClick={onBack}>
        {copy.backToInvoice}
      </button>
    </section>
  );
}

function PostedAdjustmentView({
  adjustment,
  onBack,
}: {
  readonly adjustment: PostedPurchaseAdjustment;
  readonly onBack: () => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  return (
    <article
      className="posted-adjustment-view"
      aria-labelledby="posted-adjustment-title"
    >
      <p className="purchase-context-label">{copy.historicalSnapshot}</p>
      <h3 id="posted-adjustment-title">
        {formatAdjustmentNumber(adjustment.number)}
      </h3>
      <p>
        {adjustment.reason} · {formatTimestamp(adjustment.postedAt, locale)}
      </p>
      <dl className="posted-purchase-totals">
        <div>
          <dt>{copy.quantity}</dt>
          <dd>
            <bdi>{adjustment.quantityDelta}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.primarySupplierCost}</dt>
          <dd>
            <bdi>{adjustment.primarySupplierCostDeltaFils}</bdi> {copy.fils}
          </dd>
        </div>
      </dl>
      <ul>
        {adjustment.rowDeltas.map((row) => (
          <li key={row.lineageId}>
            {row.after?.itemDisplayName ?? row.before?.itemDisplayName}:{" "}
            {row.before?.enteredQuantity ?? "0"} →{" "}
            {row.after?.enteredQuantity ?? "0"} ({row.quantityDelta})
          </li>
        ))}
      </ul>
      <button type="button" className="quiet-button" onClick={onBack}>
        {copy.backToInvoice}
      </button>
      <button
        type="button"
        className="quiet-button"
        onClick={() => window.print()}
      >
        {copy.print}
      </button>
    </article>
  );
}

function formatNumber(value: {
  readonly number: {
    readonly series: "P";
    readonly value: string;
    readonly year: number;
  };
}): string {
  return `${value.number.series}${value.number.value}/${value.number.year}`;
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

function formatTimestamp(value: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
